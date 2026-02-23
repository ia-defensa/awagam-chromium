// Background script—handles request blocking using “declarativeNetRequest”

// Import external modules
importScripts('storage-manager.js', 'blocklist-fetcher.js');

let blocklist = null;
let externalBlocklists = [];
let dynamicRules = [];
let isInitializing = false;
let extensionEnabled = true;

// Load extension enabled state
async function loadExtensionState() {
  try {
    const result = await chrome.storage.local.get(['awagamEnabled', 'awagamDisableUntil']);
    extensionEnabled = result.awagamEnabled !== false; // Default to true

    // Check if temporary disable is still active
    if (result.awagamDisableUntil) {
      const disableUntil = new Date(result.awagamDisableUntil);
      if (disableUntil > new Date()) {
        extensionEnabled = false;
      } else {
        // Timer expired, clean up
        await chrome.storage.local.remove('awagamDisableUntil');
        extensionEnabled = true;
        await chrome.storage.local.set({ awagamEnabled: true });
      }
    }

    // console.log('AWAGAM: Extension enabled state:', extensionEnabled);
  } catch (error) {
    console.error('AWAGAM: Error loading extension state:', error);
  }
}

// Load all external blocklists
async function loadAllExternalBlocklists() {
  const configs = await loadExternalBlocklistConfigs();
  const blocklists = [];

  for (const config of Object.values(configs)) {
    if (!config.enabled) continue;

    try {
      // Try cache first
      let cachedData = await loadCachedBlocklist(config.id);

      // Fetch if cache miss or expired
      if (!cachedData || needsUpdate(config)) {
        console.log(`AWAGAM: Fetching blocklist: ${config.name}, ${config.url}`);
        const result = await fetchExternalBlocklist(config);

        // Cache the new data
        await cacheBlocklistData(config.id, result.data, result.metadata);

        // Update config with detailed metadata
        config.metadata = {
          totalRules: result.metadata.totalRules || 0,
          tlds: result.metadata.tlds || 0,
          domains: result.metadata.domains || 0,
          urls: result.metadata.urls || 0,
          groups: result.metadata.groups || 0
        };

        await updateBlocklistStatus(config.id, 'active');

        blocklists.push(result.data);
      } else {
        // Use cached data—but ensure metadata is in new format
        if (!config.metadata.tlds && !config.metadata.domains && !config.metadata.urls) {
          // Re-calculate metadata from cached data to get detailed breakdown
          let totalTlds = 0;
          let totalDomains = 0;
          let totalUrls = 0;
          let groups = 0;

          Object.values(cachedData.data).forEach(group => {
            groups++;
            totalTlds += (group.tlds || []).length;
            totalDomains += (group.domains || []).length;
            totalUrls += (group.urls || []).length;
          });

          config.metadata = {
            totalRules: totalTlds + totalDomains + totalUrls,
            tlds: totalTlds,
            domains: totalDomains,
            urls: totalUrls,
            groups: groups
          };

          // Save the updated config
          await saveExternalBlocklistConfig(config);
        }

        blocklists.push(cachedData.data);
      }

    } catch (error) {
      let errorMessage = error.message;
      if (error.message.includes('404')) {
        errorMessage = 'File not found (404). Check if the URL is correct and the file exists.';
      } else if (error.message.includes('403')) {
        errorMessage = 'Access forbidden (403). The file may be private or require authentication.';
      } else if (error.message.includes('Failed to fetch')) {
        errorMessage = 'Network error. Check your Internet connection and the URL.';
      } else if (error.message.includes('Invalid JSON')) {
        errorMessage = 'Invalid JSON format. The file content is not valid JSON.';
      } else if (error.message.includes('Validation failed')) {
        errorMessage = `Format validation failed: ${error.message}`;
      }

      // Log validation errors as warnings (expected user errors, not code bugs)
      if (error.message.includes('Validation failed') || error.message.includes('too many rules')) {
        console.warn(`AWAGAM: Blocklist “${config.name}” skipped: ${errorMessage}`);
      } else {
        // Log actual errors (network issues, etc.) as errors
        console.error(`AWAGAM: Error loading blocklist ${config.name}:`, error);
      }

      await updateBlocklistStatus(config.id, 'error', errorMessage);

      // Use cached data if available as fallback
      const fallbackData = await loadCachedBlocklist(config.id);
      if (fallbackData) {
        console.log(`AWAGAM: Using cached fallback for ${config.name}`);
        blocklists.push(fallbackData.data);
      }
    }
  }

  // Only log if blocklists were actually loaded
  if (blocklists.length > 0) {
    console.log(`AWAGAM: Loaded ${blocklists.length} external blocklist(s)`);
  }
  return blocklists;
}

// Merge multiple blocklists into one
function mergeBlocklists(blocklists) {
  if (blocklists.length === 0) return {};
  if (blocklists.length === 1) return blocklists[0];

  const merged = {};

  blocklists.forEach((blocklist, index) => {
    Object.entries(blocklist).forEach(([groupId, group]) => {
      // Prefix group IDs to avoid conflicts
      const prefixedId = index === 0 ? groupId : `ext${index}_${groupId}`;

      if (merged[prefixedId]) {
        // Merge arrays if group already exists
        merged[prefixedId] = {
          ...merged[prefixedId],
          tlds: [...(merged[prefixedId].tlds || []), ...(group.tlds || [])],
          domains: [...(merged[prefixedId].domains || []), ...(group.domains || [])],
          urls: [...(merged[prefixedId].urls || []), ...(group.urls || [])]
        };
      } else {
        merged[prefixedId] = { ...group };
      }
    });
  });

  return merged;
}

// Calculate total rules across a blocklist
function calculateTotalRules(blocklist) {
  if (!blocklist) return 0;

  let totalRules = 0;

  Object.values(blocklist).forEach(group => {
    totalRules += (group.tlds || []).length;
    totalRules += (group.domains || []).length;
    totalRules += (group.urls || []).length;
  });

  return totalRules;
}

// Load blocklist and setup blocking rules
async function loadBlocklistAndSetupRules() {
  if (isInitializing) {
    // console.log('AWAGAM: Already initializing, skipping…');
    return;
  }

  isInitializing = true;
  try {
    // console.log('AWAGAM: Starting initialization…');
    await loadExtensionState();

    // Load built-in blocklist
    const response = await fetch(chrome.runtime.getURL('blocklist.json'));
    const builtinBlocklist = await response.json();

    // Load external blocklists
    const externalBlocklistsData = await loadAllExternalBlocklists();

    // Merge all blocklists
    const allBlocklists = [builtinBlocklist, ...externalBlocklistsData];
    blocklist = mergeBlocklists(allBlocklists);

    // Smart allocation will handle rule limits automatically
    // (detailed logging happens in setupBlockingRules)

    await setupBlockingRules();
    // console.log('AWAGAM: Initialization complete');
  } catch (error) {
    console.error('AWAGAM: Failed to load blocklist:', error);
  } finally {
    isInitializing = false;
  }
}

// Convert non-ASCII domain to punycode if needed
function toPunycode(domain) {
  try {
    // For TLDs, we need to handle them specially
    if (domain.startsWith('.')) {
      const tld = domain.substring(1);
      // Convert .рф to .xn--p1ai
      if (tld === 'рф') {
        return '.xn--p1ai';
      }
      // For other non-ASCII TLDs, try to convert
      if (/[^\x00-\x7F]/.test(tld)) {
        return '.' + new URL(`https://example.${tld}`).hostname.split('.').pop();
      }
    } else {
      // For domains, convert if contains non-ASCII
      if (/[^\x00-\x7F]/.test(domain)) {
        return new URL(`https://${domain}`).hostname;
      }
    }
    return domain;
  } catch (error) {
    console.warn('AWAGAM: Could not convert to punycode:', domain, error);
    return domain;
  }
}

// Setup declarativeNetRequest rules with smart allocation
async function setupBlockingRules() {
  if (!blocklist) return;

  // If extension is disabled, clear all rules and return
  if (!extensionEnabled) {
    // console.log('AWAGAM: Extension disabled, clearing all blocking rules');
    try {
      const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
      const ruleIds = existingRules.map(rule => rule.id);
      if (ruleIds.length > 0) {
        await chrome.declarativeNetRequest.updateDynamicRules({
          removeRuleIds: ruleIds
        });
      }
    } catch (error) {
      console.error('AWAGAM: Error clearing rules:', error);
    }
    return;
  }

  // Clear existing dynamic rules
  try {
    const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
    const ruleIds = existingRules.map(rule => rule.id);
    if (ruleIds.length > 0) {
      // console.log(`AWAGAM: Removing ${ruleIds.length} existing rules`);
      await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: ruleIds
      });
    }
  } catch (error) {
    console.error('AWAGAM: Error clearing existing rules:', error);
    return; // Don't proceed if we can't clear existing rules
  }

  // Wait a moment for rules to be cleared
  await new Promise(resolve => setTimeout(resolve, 100));

  dynamicRules = [];
  let ruleId = 1;
  const dynamicRuleLimit = chrome.declarativeNetRequest?.MAX_NUMBER_OF_DYNAMIC_RULES || 30000;

  /**
   * URL MATCHING ALGORITHM—KEEP SYNCHRONIZED with content.js isBlocked() function
   *
   * TLD matching: *.tld^ (declarativeNetRequest) / hostname === tld || hostname.endsWith('.' + tld) (content)
   *   ✓ Blocks: example.ru, sub.example.ru
   *   ✗ Avoids: validator.w3.org?uri=example.ru
   *
   * Domain matching: ||domain^ (declarativeNetRequest) / hostname === domain || hostname.endsWith('.' + domain) (content)
   *   ✓ Blocks: example.com, sub.example.com
   *   ✗ Avoids: example.com.tr, notexample.com
   *
   * URL matching: exact URL (declarativeNetRequest) / fullUrl === blockedUrl (content)
   *   ✓ Blocks: https://example.com/page
   *   ✗ Avoids: https://other.com?ref=https://example.com/page
   */

  // Smart allocation: Prioritize TLDs > Domains > URLs for maximum blocking coverage
  // Collect all rules by type across all groups
  const allGroups = Object.values(blocklist);
  const collectedRules = {
    tlds: [],
    domains: [],
    urls: []
  };

  for (const group of allGroups) {
    // Collect TLDs
    for (const tld of group.tlds || []) {
      // Skip non-ASCII TLDs for declarativeNetRequest, handle them in content script
      if (/[^\x00-\x7F]/.test(tld)) {
        continue;
      }
      collectedRules.tlds.push(tld);
    }

    // Collect domains
    for (const domain of group.domains || []) {
      // Skip non-ASCII domains for declarativeNetRequest, handle them in content script
      if (/[^\x00-\x7F]/.test(domain)) {
        continue;
      }
      collectedRules.domains.push(domain);
    }

    // Collect URLs
    for (const url of group.urls || []) {
      // Skip non-ASCII URLs for declarativeNetRequest, handle them in content script
      if (/[^\x00-\x7F]/.test(url)) {
        continue;
      }
      collectedRules.urls.push(url);
    }
  }

  // Apply rules in priority order: TLDs > Domains > URLs
  // Stop when we hit the dynamic rule limit
  let rulesApplied = 0;
  let tldCount = 0;
  let domainCount = 0;
  let urlCount = 0;

  // 1. Apply TLDs first (highest blocking coverage)
  for (const tld of collectedRules.tlds) {
    if (rulesApplied >= dynamicRuleLimit) break;

    const tldWithoutDot = tld.startsWith('.') ? tld.substring(1) : tld;
    dynamicRules.push({
      id: ruleId++,
      priority: 1,
      action: { type: 'block' },
      condition: {
        urlFilter: `*.${tldWithoutDot}^`,
        resourceTypes: ['main_frame', 'sub_frame', 'image', 'script', 'stylesheet', 'font', 'media', 'xmlhttprequest', 'websocket', 'other']
      }
    });
    rulesApplied++;
    tldCount++;
  }

  // 2. Apply domains second
  for (const domain of collectedRules.domains) {
    if (rulesApplied >= dynamicRuleLimit) break;

    dynamicRules.push({
      id: ruleId++,
      priority: 1,
      action: { type: 'block' },
      condition: {
        urlFilter: `||${domain}^`,
        resourceTypes: ['main_frame', 'sub_frame', 'image', 'script', 'stylesheet', 'font', 'media', 'xmlhttprequest', 'websocket', 'other']
      }
    });
    rulesApplied++;
    domainCount++;
  }

  // 3. Apply URLs last
  for (const url of collectedRules.urls) {
    if (rulesApplied >= dynamicRuleLimit) break;

    try {
      // Support both full URLs (“https://example.com/path”) and protocol-agnostic URLs (“example.com/path”)
      let urlFilter = url;
      const hasProtocol = url.startsWith('http://') || url.startsWith('https://');

      if (hasProtocol) {
        const withoutProtocol = url.replace(/^https?:\/\//, '');
        urlFilter = `||${withoutProtocol}`;
      } else {
        const firstSlash = url.indexOf('/');
        const domain = firstSlash === -1 ? url : url.substring(0, firstSlash);
        if (!domain || domain.includes('://')) {
          continue; // Skip invalid URL
        }
        urlFilter = `||${url}`;
      }

      dynamicRules.push({
        id: ruleId++,
        priority: 2, // Higher priority for specific URLs
        action: { type: 'block' },
        condition: {
          urlFilter: urlFilter,
          resourceTypes: ['main_frame', 'sub_frame', 'image', 'script', 'stylesheet', 'font', 'media', 'xmlhttprequest', 'websocket', 'other']
        }
      });
      rulesApplied++;
      urlCount++;
    } catch (error) {
      console.error(`AWAGAM: Invalid URL in blocklist: ${url}`, error);
    }
  }

  // Log smart allocation results (only if rules were skipped or for debugging)
  const totalAvailable = collectedRules.tlds.length + collectedRules.domains.length + collectedRules.urls.length;

  if (rulesApplied >= dynamicRuleLimit) {
    const skipped = totalAvailable - rulesApplied;
    console.warn(`AWAGAM: Browser limit reached. Applied ${rulesApplied.toLocaleString()} of ${totalAvailable.toLocaleString()} rules (${skipped.toLocaleString()} skipped). Priority: TLDs (${tldCount}) > domains (${domainCount}) > URLs (${urlCount}).`);
  } else if (totalAvailable > 0) {
    console.log(`AWAGAM: Applied ${rulesApplied.toLocaleString()} blocking rules (${tldCount} TLDs, ${domainCount} domains, ${urlCount} URLs)`);
  }

  // Apply the rules
  if (dynamicRules.length === 0) {
    // console.log('AWAGAM: No valid rules to add');
    return;
  }

  try {
    // Verify all rule IDs are unique
    const ruleIds = dynamicRules.map(rule => rule.id);
    const uniqueIds = new Set(ruleIds);
    if (ruleIds.length !== uniqueIds.size) {
      console.error('AWAGAM: Duplicate rule IDs detected', ruleIds);
      return;
    }

    // console.log(`AWAGAM: Adding ${dynamicRules.length} blocking rules with IDs: ${ruleIds.join(', ')}`);

    await chrome.declarativeNetRequest.updateDynamicRules({
      addRules: dynamicRules
    });

    // console.log(`AWAGAM: Successfully added ${dynamicRules.length} blocking rules`);

    // Verify rules were added
    const newRules = await chrome.declarativeNetRequest.getDynamicRules();
    // console.log(`AWAGAM: Total dynamic rules now: ${newRules.length}`);

  } catch (error) {
    console.error('AWAGAM: Error adding blocking rules:', error);
    console.error('AWAGAM: Failed rules:', JSON.stringify(dynamicRules, null, 2));
  }
}

// Check and update external blocklists
async function checkAndUpdateBlocklists() {
  const configs = await loadExternalBlocklistConfigs();

  for (const config of Object.values(configs)) {
    if (needsUpdate(config)) {
      await updateSingleBlocklist(config.id);
    }
  }
}

// Update a single external blocklist
async function updateSingleBlocklist(id) {
  const configs = await loadExternalBlocklistConfigs();
  const config = configs[id];

  if (!config) {
    console.error(`AWAGAM: Blocklist config not found: ${id}`);
    return false;
  }

  try {
    console.log(`AWAGAM: Updating blocklist: ${config.name}`);
    const result = await fetchExternalBlocklist(config);

    // Cache the new data
    await cacheBlocklistData(id, result.data, result.metadata);

    // Update config with detailed metadata
    config.metadata = {
      totalRules: result.metadata.totalRules || 0,
      tlds: result.metadata.tlds || 0,
      domains: result.metadata.domains || 0,
      urls: result.metadata.urls || 0,
      groups: result.metadata.groups || 0
    };

    await updateBlocklistStatus(id, 'active');

    // Reload all blocklists and update rules
    await loadBlocklistAndSetupRules();

    return true;
  } catch (error) {
    // Log validation errors as warnings (expected user errors, not code bugs)
    if (error.message.includes('Validation failed') || error.message.includes('too many rules')) {
      console.warn(`AWAGAM: Blocklist “${config.name}” update skipped: ${error.message}`);
    } else {
      // Log actual errors (network issues, etc.) as errors
      console.error(`AWAGAM: Error updating blocklist ${config.name}:`, error);
    }
    await updateBlocklistStatus(id, 'error', error.message);
    return false;
  }
}

// Handle extension installation
chrome.runtime.onInstalled.addListener(async (details) => {
  // console.log('AWAGAM: Extension installed/updated', details.reason);
  await loadBlocklistAndSetupRules();

  // Set up periodic update alarm
  chrome.alarms.create('updateExternalBlocklists', { periodInMinutes: 60 });
});

// Handle extension startup (only in persistent background scripts, not service workers)
chrome.runtime.onStartup.addListener(async () => {
  // console.log('AWAGAM: Extension started');
  await loadBlocklistAndSetupRules();
});

// Handle periodic updates
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'updateExternalBlocklists') {
    await checkAndUpdateBlocklists();
  }
});

// Handle messages from content script and popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'getBlocklist') {
    // Return both built-in and external blocklist info
    const response = {
      blocklist: blocklist,
      enabled: extensionEnabled,
      externalBlocklists: externalBlocklists.length
    };
    sendResponse(response);
  } else if (message.action === 'reloadBlocklist') {
    loadBlocklistAndSetupRules().then(() => {
      sendResponse({ success: true });
    }).catch(error => {
      console.error('AWAGAM: Error reloading blocklist:', error);
      sendResponse({ success: false, error: error.message });
    });
    return true; // Keep message channel open for async response
  } else if (message.action === 'toggleExtension') {
    extensionEnabled = message.enabled;
    // console.log('AWAGAM: Extension toggled to:', extensionEnabled);

    // Handle async operations
    (async () => {
      try {
        // Ensure blocklist is loaded before setting up rules
        if (!blocklist) {
          // console.log('AWAGAM: Blocklist not loaded, loading before setup…');
          await loadBlocklistAndSetupRules();
        } else {
          // Update blocking rules based on new state
          await setupBlockingRules();
        }

        // Notify all content scripts about the state change
        chrome.tabs.query({}, (tabs) => {
          tabs.forEach(tab => {
            chrome.tabs.sendMessage(tab.id, {
              action: 'extensionToggled',
              enabled: extensionEnabled
            }).catch(() => {
              // Ignore errors for tabs that don't have content scripts
            });
          });
        });

        sendResponse({ success: true });
      } catch (error) {
        console.error('AWAGAM: Error updating rules after toggle:', error);
        sendResponse({ success: false, error: error.message });
      }
    })();

    return true; // Keep message channel open for async response
  } else if (message.action === 'addExternalBlocklist') {
    // Add new external blocklist
    (async () => {
      try {
        const config = {
          id: generateBlocklistId(),
          ...message.config
        };

        const success = await saveExternalBlocklistConfig(config);
        if (success) {
          // Reload blocklists with new addition
          await loadBlocklistAndSetupRules();
          sendResponse({ success: true, id: config.id });
        } else {
          sendResponse({ success: false, error: 'Failed to save configuration' });
        }
      } catch (error) {
        console.error('AWAGAM: Error adding blocklist:', error);
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true;
  } else if (message.action === 'updateExternalBlocklist') {
    // Update existing external blocklist
    (async () => {
      try {
        const success = await saveExternalBlocklistConfig(message.config);
        if (success) {
          // Reload blocklists with updated config
          await loadBlocklistAndSetupRules();
          sendResponse({ success: true });
        } else {
          sendResponse({ success: false, error: 'Failed to update configuration' });
        }
      } catch (error) {
        console.error('AWAGAM: Error updating blocklist:', error);
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true;
  } else if (message.action === 'deleteExternalBlocklist') {
    // Delete external blocklist
    (async () => {
      try {
        const success = await deleteExternalBlocklistConfig(message.id);
        if (success) {
          // Reload blocklists without deleted one
          await loadBlocklistAndSetupRules();
          sendResponse({ success: true });
        } else {
          sendResponse({ success: false, error: 'Failed to delete configuration' });
        }
      } catch (error) {
        console.error('AWAGAM: Error deleting blocklist:', error);
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true;
  } else if (message.action === 'getExternalBlocklists') {
    // Get external blocklist configurations
    (async () => {
      try {
        const configs = await loadExternalBlocklistConfigs();
        sendResponse({ success: true, configs: configs });
      } catch (error) {
        console.error('AWAGAM: Error loading blocklists:', error);
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true;
  } else if (message.action === 'refreshExternalBlocklist') {
    // Manually refresh a specific external blocklist
    (async () => {
      try {
        const success = await updateSingleBlocklist(message.id);
        sendResponse({ success: success });
      } catch (error) {
        console.error('AWAGAM: Error refreshing blocklist:', error);
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true;
  } else if (message.action === 'importBlocklistConfigs') {
    // Import multiple blocklist configurations in batch (to avoid race conditions)
    (async () => {
      try {
        const configs = message.configs;
        const results = [];

        // Load existing configs once
        const existingConfigs = await loadExternalBlocklistConfigs();

        // Sanitize and merge all imported configs
        for (const config of configs) {
          try {
            const sanitizedConfig = sanitizeConfig(config);
            existingConfigs[sanitizedConfig.id] = sanitizedConfig;
            results.push({ success: true, id: sanitizedConfig.id });
          } catch (error) {
            console.error('AWAGAM: Error sanitizing config:', config.name, error);
            results.push({ success: false, error: error.message, id: config.id });
          }
        }

        // Save all at once
        try {
          await chrome.storage.sync.set({ externalBlocklists: existingConfigs });
        } catch (error) {
          console.warn('AWAGAM: Sync storage failed, using local storage:', error);
          await chrome.storage.local.set({ externalBlocklists: existingConfigs });
        }

        sendResponse({ success: true, results: results });
      } catch (error) {
        console.error('AWAGAM: Error importing blocklist configs:', error);
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true;
  }
});

// Service worker initialization—only initialize if not already done
if (!blocklist && !isInitializing) {
  // console.log('AWAGAM: Service worker starting, initializing…');
  loadBlocklistAndSetupRules().catch(error => {
    console.error('AWAGAM: Service worker initialization failed:', error);
  });
}