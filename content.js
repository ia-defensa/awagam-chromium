// Content script—highlights blocked links and handles blocked page detection

let blocklist = null;
let dynamicStylesInjected = false;
let extensionEnabled = true;

// Load blocklist data and extension state
async function loadBlocklist() {
  try {
    // Get both blocklist and enabled state from background
    const response = await chrome.runtime.sendMessage({ action: 'getBlocklist' });
    blocklist = response.blocklist;
    extensionEnabled = response.enabled;

    // console.log('AWAGAM: Content script loaded, extension enabled:', extensionEnabled);

    if (extensionEnabled) {
      await injectDynamicCSS();
    }
  } catch (error) {
    console.error('AWAGAM: Failed to load blocklist:', error);
  }
}

// Generate and inject dynamic CSS based on blocklist
async function injectDynamicCSS() {
  if (!blocklist || dynamicStylesInjected) return;

  let cssRules = `
/* AWAGAM base styles—link highlighting applied by JavaScript */

.awagam-blocked {
  cursor: not-allowed !important;
}

.awagam-blocked::after {
  content: " 🛑" !important;
}
`;

  // Note: Link highlighting is handled by JavaScript in highlightBlockedLinks()
  // for more accurate URL parsing and subdomain detection

  // CSS now only contains base styles, no dynamic selectors needed

  // Inject the CSS into the page
  const styleElement = document.createElement('style');
  styleElement.id = 'awagam-dynamic-styles';
  styleElement.textContent = cssRules;
  document.head.appendChild(styleElement);

  dynamicStylesInjected = true;
  // console.log('AWAGAM: Dynamic CSS injected');
}

// Convert Cyrillic domains to punycode for comparison
function normalizeHostname(hostname) {
  try {
    // Create a temporary URL to let the browser handle punycode conversion
    const tempUrl = new URL(`https://${hostname}`);
    return tempUrl.hostname.toLowerCase();
  } catch (error) {
    return hostname.toLowerCase();
  }
}

// Match URL against pattern with wildcard support
// Supports EasyList-style wildcards: “*” matches any characters
function matchesUrlPattern(url, pattern) {
  // Auto-append wildcard to query parameter patterns (e.g., “?param=” becomes “?param=*”)
  // This allows patterns like “site.com/?tracking=” to match “site.com/?tracking=value”
  let normalizedPattern = pattern;
  if (pattern.includes('=') && !pattern.endsWith('*')) {
    // Check if pattern ends with “=” (query parameter without value wildcard)
    const parts = pattern.split('=');
    const lastPart = parts[parts.length - 1];
    if (lastPart === '' || (!lastPart.includes('&') && !lastPart.includes('/'))) {
      normalizedPattern = pattern + '*';
    }
  }

  // Escape special regex characters except “*”
  const escapedPattern = normalizedPattern
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*');

  // Create regex that matches the entire string
  const regex = new RegExp(`^${escapedPattern}$`, 'i');
  return regex.test(url);
}

/**
 * URL MATCHING ALGORITHM—KEEP SYNCHRONIZED with background.js setupBlockingRules()
 *
 * TLD matching: hostname === tld || hostname.endsWith('.' + tld) (content) / *.tld^ (declarativeNetRequest)
 *   ✓ Blocks: example.ru, sub.example.ru
 *   ✗ Avoids: validator.w3.org?uri=example.ru
 *
 * Domain matching: hostname === domain || hostname.endsWith('.' + domain) (content) / ||domain^ (declarativeNetRequest)
 *   ✓ Blocks: example.com, sub.example.com
 *   ✗ Avoids: example.com.tr, notexample.com
 *
 * URL matching: supports wildcards and protocol-agnostic patterns
 *   - Full URL: “https://example.com/page” (blocks both “http://” and “https://”)
 *   - Protocol-agnostic: “example.com/page” (blocks both “http://” and “https://”)
 *   - Both formats are equivalent and produce the same blocking behavior
 *   - Wildcards: “example.com/*?param=” (matches any path before “?param=”)
 *   ✓ Blocks: “example.com/*?affiliate=” matches both protocols and any path
 *   ✗ Avoids: “https://other.com?ref=https://example.com/page”
 */

// Check if a URL matches any blocked item
function isBlocked(url) {
  if (!blocklist) return false;

  try {
    const urlObj = new URL(url);
    const hostname = normalizeHostname(urlObj.hostname);
    const fullUrl = url.toLowerCase();

    // Check all groups in the blocklist
    const allGroups = Object.values(blocklist);

    for (const group of allGroups) {
      // Check TLDs
      for (const tld of group.tlds || []) {
        const normalizedTld = tld.toLowerCase();
        // Remove leading dot if present
        const tldWithoutDot = normalizedTld.startsWith('.') ? normalizedTld.substring(1) : normalizedTld;

        // Check if hostname ends with the TLD at a domain boundary
        if (hostname === tldWithoutDot || hostname.endsWith('.' + tldWithoutDot)) {
          return true;
        }
      }

      // Check domains
      for (const domain of group.domains || []) {
        const normalizedDomain = normalizeHostname(domain);
        if (hostname === normalizedDomain || hostname.endsWith('.' + normalizedDomain)) {
          return true;
        }
      }

      // Check specific URLs
      for (const blockedUrl of group.urls || []) {
        const normalizedBlockedUrl = blockedUrl.toLowerCase();

        // Support both full URLs and protocol-agnostic URLs with wildcard matching
        const hasProtocol = normalizedBlockedUrl.startsWith('http://') || normalizedBlockedUrl.startsWith('https://');

        if (hasProtocol) {
          // Full URL—match with wildcards
          if (matchesUrlPattern(fullUrl, normalizedBlockedUrl)) {
            return true;
          }
        } else {
          // Protocol-agnostic URL—strip protocol from current URL and match
          const urlWithoutProtocol = fullUrl.replace(/^https?:\/\//, '');
          if (matchesUrlPattern(urlWithoutProtocol, normalizedBlockedUrl)) {
            return true;
          }
        }
      }
    }
  } catch (error) {
    console.error('AWAGAM: Error checking URL:', error);
  }

  return false;
}

// Check if current page is blocked and show message
function checkCurrentPage() {
  if (extensionEnabled && isBlocked(window.location.href)) {
    showBlockedMessage();
  }
}

// Show blocked page message
function showBlockedMessage() {
  // Remove existing content
  document.documentElement.innerHTML = `
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Access Blocked · AWAGAM</title>
        <style>
          body {
            background: oklch(98.5% 0.002 247.839);
            color: oklch(21% 0.034 264.665);
            font-family: ui-sans-serif, system-ui, sans-serif, 'Apple Color Emoji', 'Segoe UI Emoji', 'Segoe UI Symbol', 'Noto Color Emoji';
            margin: 0;
            padding: 32px;
            text-align: center;
          }

          h1 {
            color: #d32f2f;
            margin-bottom: 16px;
          }

          button {
            background: #000;
            border: none;
            border-radius: 6px;
            color: #fff;
            cursor: pointer;
            font-size: 14px;
            font-weight: 500;
            margin-top: 16px;
            padding: 8px 16px;
          }

          button:hover {
            background: #171717e6;
          }

          .container {
            background: #fff;
            border-radius: 6px;
            box-shadow: 0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1);
            margin: 0 auto;
            max-width: 600px;
            padding: 16px;
          }

          .icon {
            font-size: 64px;
            margin-bottom: 16px;
          }

          .url {
            border-radius: 6px;
            background: oklch(98.5% 0.002 247.839);
            font-family: monospace;
            margin: 16px 0;
            padding: 16px;
            word-break: break-all;
          }
        </style>
      </head>
      <body>
      <div class="container">
        <div class="icon">🛑</div>
        <h1>Access Blocked</h1>
        <p>This domain has been blocked by the AWAGAM extension.</p>
        <div class="url">${window.location.href}</div>
        <p>This site is on the blocklist and cannot be accessed.</p>
        <button onclick="history.back()">Go back</button>
      </div>
      </body>
    </html>
  `;
}

// Add blocked indicators to links
function highlightBlockedLinks() {
  if (!extensionEnabled) return;

  const links = document.querySelectorAll('a[href]');

  links.forEach(link => {
    if (isBlocked(link.href)) {
      link.classList.add('awagam-blocked');
      link.title = 'This link is blocked by AWAGAM';

      // Prevent navigation to blocked links
      link.addEventListener('click', function(e) {
        e.preventDefault();
        alert('This link is blocked by the AWAGAM extension');
      });
    }
  });
}

// Remove blocked indicators from all links
function removeBlockedHighlights() {
  const blockedLinks = document.querySelectorAll('.awagam-blocked');
  blockedLinks.forEach(link => {
    link.classList.remove('awagam-blocked');
    link.title = '';
    // Note: We can't remove specific event listeners easily,
    // but when extension is disabled, blocking is also disabled in background
  });

  // Remove dynamic CSS
  const styleElement = document.getElementById('awagam-dynamic-styles');
  if (styleElement) {
    styleElement.remove();
    dynamicStylesInjected = false;
  }
}

// Initialize extension
async function init() {
  await loadBlocklist();

  // Check if current page should be blocked
  checkCurrentPage();

  // Highlight blocked links on non-blocked pages (only if extension is enabled)
  if (extensionEnabled && !isBlocked(window.location.href)) {
    highlightBlockedLinks();

    // Watch for dynamically added links
    const observer = new MutationObserver(function(mutations) {
      if (!extensionEnabled) return; // Skip if extension was disabled

      mutations.forEach(function(mutation) {
        mutation.addedNodes.forEach(function(node) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            const newLinks = node.querySelectorAll ? node.querySelectorAll('a[href]') : [];
            newLinks.forEach(link => {
              if (isBlocked(link.href)) {
                link.classList.add('awagam-blocked');
                link.title = 'This link is blocked by the AWAGAM extension';
                link.addEventListener('click', function(e) {
                  e.preventDefault();
                  alert('This link is blocked by the AWAGAM extension');
                });
              }
            });
          }
        });
      });
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }
}

// Listen for extension toggle messages from background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'extensionToggled') {
    extensionEnabled = message.enabled;
    // console.log('AWAGAM: Extension toggled in content script:', extensionEnabled);

    if (extensionEnabled) {
      // Re-inject CSS and highlight links
      if (!dynamicStylesInjected) {
        injectDynamicCSS();
      }
      highlightBlockedLinks();
    } else {
      // Remove all highlights and CSS
      removeBlockedHighlights();
    }

    sendResponse({ success: true });
  }
});

// Start when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}