// Blocklist fetcher—handles fetching, validation, and conversion of external blocklists

// Fetch external blocklist with timeout and retries
async function fetchExternalBlocklist(config, retries = 3) {
  let url = config.url;

  // Convert GitHub blob URLs to raw URLs
  const originalUrl = url;
  url = convertGitHubBlobUrl(url);
  if (originalUrl !== url) {
    console.log(`AWAGAM: Converted URL: ${originalUrl} → ${url}`);
  }

  // Validate URL
  if (!isValidBlocklistURL(url)) {
    throw new Error('Invalid or insecure URL. Only HTTPS URLs are allowed.');
  }

  let lastError;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout

      const headers = {
        'User-Agent': 'AWAGAM-Extension/2.0',
        'Accept': 'application/json, text/plain',
        'Cache-Control': 'no-cache'
      };

      let response;

      // Use GitHub-specific fallback logic if it's a GitHub URL
      if (url.includes('github.com') || url.includes('raw.githubusercontent.com')) {
        response = await fetchFromGitHubWithFallbacks(url, headers, controller.signal);
      } else {
        response = await fetch(url, {
          method: 'GET',
          headers: headers,
          signal: controller.signal
        });
      }

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      // Check content type (be flexible with content types)
      const contentType = response.headers.get('content-type');
      if (contentType &&
          !contentType.includes('json') &&
          !contentType.includes('text') &&
          !contentType.includes('application/octet-stream') && // Some servers send this for JSON
          !contentType.includes('*/*')) { // Generic content type
        console.warn(`AWAGAM: Unexpected content type: ${contentType}, but continuing…`);
        // Don’t throw error—some servers have incorrect content types
      }

      // Check content length
      const contentLength = response.headers.get('content-length');
      if (contentLength && parseInt(contentLength) > 10 * 1024 * 1024) { // 10 MB limit
        throw new Error('Blocklist too large—maximum size is 10 MB');
      }

      const text = await response.text();

      // Additional size check after download
      if (text.length > 10 * 1024 * 1024) {
        throw new Error('Blocklist too large—maximum size is 10 MB');
      }

      let data;
      try {
        data = JSON.parse(text);

        // Validate JSON depth to prevent JSON bomb DoS attacks
        const maxDepth = 20;
        const depth = getObjectDepth(data);
        if (depth > maxDepth) {
          throw new Error(`JSON structure too deeply nested (depth: ${depth}, max: ${maxDepth})`);
        }
      } catch (parseError) {
        throw new Error('Invalid JSON format: ' + parseError.message);
      }

      // Validate format
      const validationResult = validateBlocklistFormat(data, config.format);
      if (!validationResult.valid) {
        throw new Error('Validation failed: ' + validationResult.error);
      }

      // Data is already in AWAGAM format
      const standardizedData = data;

      // Return with metadata (combining validation metadata with fetch metadata)
      return {
        data: standardizedData,
        metadata: {
          // Validation metadata (counts)
          ...validationResult.metadata,
          // Fetch metadata (caching info)
          etag: response.headers.get('etag'),
          size: text.length,
          fetchedAt: new Date().toISOString()
        }
      };

    } catch (error) {
      lastError = error;

      if (attempt < retries) {
        // Exponential backoff: wait 2^attempt seconds
        const delay = Math.pow(2, attempt) * 1000;
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
    }
  }

  throw lastError;
}

// Convert GitHub blob URLs to raw URLs
function convertGitHubBlobUrl(url) {
  try {
    const urlObj = new URL(url);

    // Handle github.com blob URLs
    if (urlObj.hostname === 'github.com' && url.includes('/blob/')) {
      // Convert github.com/user/repo/blob/branch/file.json to raw.githubusercontent.com/user/repo/branch/file.json
      const rawUrl = url.replace('github.com', 'raw.githubusercontent.com')
                        .replace('/blob/', '/');
      console.log(`AWAGAM: Converted GitHub blob URL: ${url} -> ${rawUrl}`);
      return rawUrl;
    }

    // Handle github.com tree URLs (for directories—not supported)
    if (urlObj.hostname === 'github.com' && url.includes('/tree/')) {
      throw new Error('Directory URLs are not supported. Please link to a specific file.');
    }

    return url;
  } catch (error) {
    console.warn('AWAGAM: Error converting GitHub URL:', error);
    return url;
  }
}

// Try multiple GitHub access methods
async function fetchFromGitHubWithFallbacks(originalUrl, headers, signal) {
  const errors = [];

  // Method 1: Try the converted raw URL
  try {
    const response = await fetch(originalUrl, { headers, signal });
    if (response.ok) return response;
    errors.push(`Raw URL failed: ${response.status}`);
  } catch (error) {
    errors.push(`Raw URL error: ${error.message}`);
  }

  // Method 2: Try jsDelivr CDN
  if (originalUrl.includes('raw.githubusercontent.com')) {
    try {
      const jsdelivrUrl = originalUrl.replace(
        'raw.githubusercontent.com',
        'cdn.jsdelivr.net/gh'
      ).replace(/\/([^\/]+)\//, '/$1@');

      const response = await fetch(jsdelivrUrl, { headers, signal });
      if (response.ok) {
        console.log(`AWAGAM: Fallback to jsDelivr successful: ${jsdelivrUrl}`);
        return response;
      }
      errors.push(`jsDelivr failed: ${response.status}`);
    } catch (error) {
      errors.push(`jsDelivr error: ${error.message}`);
    }
  }

  // Method 3: Try GitHub API (for public repos)
  if (originalUrl.includes('raw.githubusercontent.com')) {
    try {
      const apiUrl = originalUrl
        .replace('raw.githubusercontent.com', 'api.github.com/repos')
        .replace(/\/([^\/]+)\/([^\/]+)\/([^\/]+)\/(.+)/, '/$1/$2/contents/$4');

      const response = await fetch(apiUrl, { headers, signal });
      if (response.ok) {
        const apiData = await response.json();
        if (apiData.content && apiData.encoding === 'base64') {
          // Create a mock response with decoded content
          const decodedContent = atob(apiData.content);
          const mockResponse = new Response(decodedContent, {
            status: 200,
            headers: { 'content-type': 'application/json' }
          });
          console.log(`AWAGAM: GitHub API fallback successful: ${apiUrl}`);
          return mockResponse;
        }
      }
      errors.push(`GitHub API failed: ${response.status}`);
    } catch (error) {
      errors.push(`GitHub API error: ${error.message}`);
    }
  }

  // All methods failed
  throw new Error(`All GitHub access methods failed: ${errors.join(', ')}`);
}

// Validate blocklist URL
function isValidBlocklistURL(url) {
  try {
    const urlObj = new URL(url);

    // Only allow HTTPS
    if (urlObj.protocol !== 'https:') {
      return false;
    }

    // Block internal/private network URLs
    const hostname = urlObj.hostname.toLowerCase();

    // Block localhost
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      return false;
    }

    // Block private IP ranges
    const ipRegex = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
    const ipMatch = hostname.match(ipRegex);
    if (ipMatch) {
      const parts = ipMatch.slice(1).map(Number);

      // Private ranges: 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16
      if (parts[0] === 10 ||
          (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
          (parts[0] === 192 && parts[1] === 168)) {
        return false;
      }
    }

    // Block internal domains
    const internalDomains = ['.local', '.internal', '.corp', '.home'];
    if (internalDomains.some(domain => hostname.endsWith(domain))) {
      return false;
    }

    return true;
  } catch (error) {
    return false;
  }
}

// Validate blocklist format
function validateBlocklistFormat(data, format) {
  try {
    if (format === 'awagam-json') {
      return validateAwagamFormat(data);
    } else {
      return { valid: false, error: 'Unsupported format: ' + format };
    }
  } catch (error) {
    return { valid: false, error: 'Validation error: ' + error.message };
  }
}

// Validate AWAGAM JSON format
function validateAwagamFormat(data) {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return { valid: false, error: 'Root must be an object' };
  }

  let totalRules = 0;
  let totalTlds = 0;
  let totalDomains = 0;
  let totalUrls = 0;
  let groups = 0;

  for (const [groupId, group] of Object.entries(data)) {
    groups++;

    if (typeof group !== 'object' || group === null || Array.isArray(group)) {
      return { valid: false, error: `Group “${groupId}” must be an object` };
    }

    // Required fields
    if (typeof group.name !== 'string') {
      return { valid: false, error: `Group “${groupId}” missing required "name" field` };
    }

    // Optional arrays
    const arrayFields = ['tlds', 'domains', 'urls'];
    for (const field of arrayFields) {
      if (group[field] !== undefined) {
        if (!Array.isArray(group[field])) {
          return { valid: false, error: `Group “${groupId}”.${field} must be an array` };
        }

        // Validate array items
        for (const item of group[field]) {
          if (typeof item !== 'string') {
            return { valid: false, error: `Group “${groupId}”.${field} contains non-string item` };
          }

          // Sanitize and validate based on field type
          if (field === 'tlds' && !isValidTLD(item)) {
            return { valid: false, error: `Invalid TLD in group “${groupId}”: ${item}` };
          } else if (field === 'domains' && !isValidDomain(item)) {
            return { valid: false, error: `Invalid domain in group “${groupId}”: ${item}` };
          } else if (field === 'urls' && !isValidURL(item)) {
            return { valid: false, error: `Invalid URL in group “${groupId}”: ${item}` };
          }
        }

        // Count by type
        if (field === 'tlds') {
          totalTlds += group[field].length;
        } else if (field === 'domains') {
          totalDomains += group[field].length;
        } else if (field === 'urls') {
          totalUrls += group[field].length;
        }

        totalRules += group[field].length;
      }
    }
  }

  // Reasonable limits
  if (groups > 100) {
    return { valid: false, error: 'Too many groups (max 100)' };
  }

  // Get dynamic rule limit from Chrome API (30,000 in Chrome 121+, 5,000 in earlier versions)
  const dynamicRuleLimit = chrome.declarativeNetRequest?.MAX_NUMBER_OF_DYNAMIC_RULES || 30000;

  if (totalRules > dynamicRuleLimit) {
    return { valid: false, error: `This blocklist contains too many rules (${totalRules.toLocaleString()} rules). Your limit: ${dynamicRuleLimit.toLocaleString()} dynamic rules per extension.` };
  }

  return {
    valid: true,
    metadata: { totalRules, tlds: totalTlds, domains: totalDomains, urls: totalUrls, groups }
  };
}


// Validation helpers
function isValidTLD(tld) {
  if (!tld.startsWith('.')) return false;
  const cleanTld = tld.substring(1);

  // Check overall length (RFC 1035: max 253 characters for full domain name)
  if (cleanTld.length === 0 || cleanTld.length > 253) return false;

  // Split into labels (for multi-level TLDs like .ac.uk, .com.au)
  const labels = cleanTld.split('.');

  // Each label must be valid according to RFC 1035/1123
  for (const label of labels) {
    if (!isValidDNSLabel(label)) return false;
  }

  return true;
}

// Validate individual DNS labels according to RFC 1035/1123
function isValidDNSLabel(label) {
  // Label must not be empty and must be 63 characters or less (RFC 1035)
  if (label.length === 0 || label.length > 63) return false;

  // Must not start or end with hyphen (RFC 1035)
  if (label.startsWith('-') || label.endsWith('-')) return false;

  // Check for valid characters:
  // - ASCII letters (a-z, A-Z)
  // - ASCII digits (0-9)
  // - Hyphens (-)
  // - Unicode characters for internationalized domains
  if (!/^[a-zA-Z0-9\u00a1-\uffff-]+$/.test(label)) return false;

  // Additional check for punycode labels (“xn--” prefix)
  if (label.startsWith('xn--')) {
    // Punycode labels: “xn--” followed by ASCII letters, digits, hyphens
    // Maximum 59 characters after “xn--” prefix (total 63 – 4 = 59)
    const punycodeData = label.substring(4);
    if (punycodeData.length === 0 || punycodeData.length > 59) return false;
    if (!/^[a-zA-Z0-9-]+$/.test(punycodeData)) return false;
  }

  return true;
}

function isValidDomain(domain) {
  try {
    // Check for partial IP patterns (e.g., “142.91.159.” for blocking IP ranges)
    // These are valid in blocklists, but URL constructor will fail
    const partialIPPattern = /^(\d{1,3}\.){1,3}\d{0,3}\.?$/;
    if (partialIPPattern.test(domain)) {
      // Validate each octet is <= 255
      const octets = domain.replace(/\.$/, '').split('.');
      return octets.every(octet => {
        const num = parseInt(octet);
        return !isNaN(num) && num >= 0 && num <= 255;
      });
    }

    // Validate domain using URL constructor
    // This handles both ASCII domains and IDNs
    const url = new URL(`https://${domain}`);

    // URL constructor automatically converts IDN to punycode (e.g., “casinonæstved.dk” → “xn--casinonstved-ddb.dk”)
    // Two valid cases:
    // 1. ASCII domain: url.hostname === domain (e.g., “example.com === example.com”)
    // 2. IDN domain: url.hostname !== domain AND hostname is valid ASCII (successful punycode conversion—e.g., “casinonæstved.dk !== xn--casinonstved-ddb.dk” but hostname matches ASCII pattern)
    const isValidHostname = url.hostname === domain ||
                           (url.hostname !== domain && /^[a-zA-Z0-9.-]+$/.test(url.hostname));

    return isValidHostname &&
           domain.length <= 253 &&
           !domain.includes('..') &&
           /^[a-zA-Z0-9\u00a1-\uffff.-]+$/.test(domain);
  } catch {
    return false;
  }
}

function isValidURL(url) {
  try {
    // Quick check: URLs should not contain spaces
    if (/\s/.test(url)) {
      return false;
    }

    // Support protocol-less URLs (e.g., “example.com/path/*”)
    // Try parsing as-is first
    let urlObj;
    try {
      urlObj = new URL(url);
      // If it parses, verify it has http/https protocol
      return urlObj.protocol === 'https:' || urlObj.protocol === 'http:';
    } catch {
      // If it fails, it might be a protocol-less URL
      // Try adding “https://” prefix and validate
      try {
        urlObj = new URL('https://' + url);

        // Basic validation for protocol-less URLs:
        // - Must have a valid hostname
        // - Path is optional
        // - Wildcards (“*”) and query parameters are allowed
        const hostname = urlObj.hostname;

        // Hostname must be valid (same logic as “isValidDomain”)
        if (!hostname || hostname.length > 253 || hostname.includes('..')) {
          return false;
        }

        // Check hostname contains only valid characters (including wildcards)
        // Allow: letters, numbers, dots, hyphens, Unicode, and wildcards
        if (!/^[a-zA-Z0-9\u00a1-\uffff.*-]+$/.test(hostname)) {
          return false;
        }

        // Pathname can contain wildcards and special characters
        // Just verify it doesn’t contain obviously invalid characters
        const pathname = urlObj.pathname + urlObj.search + urlObj.hash;

        // Allow standard URL characters plus wildcards
        // Disallow control characters (spaces already checked above)
        if (/[\x00-\x1F]/.test(pathname)) {
          return false;
        }

        return true;
      } catch {
        return false;
      }
    }
  } catch {
    return false;
  }
}

// Calculate maximum depth of nested objects/arrays to prevent JSON bomb DoS
function getObjectDepth(obj, currentDepth = 1) {
  if (obj === null || typeof obj !== 'object') {
    return currentDepth;
  }

  let maxChildDepth = currentDepth;

  for (const key in obj) {
    if (obj.hasOwnProperty(key)) {
      const childDepth = getObjectDepth(obj[key], currentDepth + 1);
      if (childDepth > maxChildDepth) {
        maxChildDepth = childDepth;
      }
    }
  }

  return maxChildDepth;
}

// Export functions for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  // Node.js environment (for testing)
  module.exports = {
    fetchExternalBlocklist,
    validateBlocklistFormat,
    isValidBlocklistURL
  };
}