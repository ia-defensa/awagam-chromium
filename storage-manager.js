// Storage Manager—handles external blocklist configuration and caching

// Default configuration for new external blocklists
const DEFAULT_EXTERNAL_CONFIG = {
  name: '',
  url: '',
  format: 'awagam-json',
  enabled: true,
  lastUpdated: null,
  lastAttempted: null,
  updateInterval: 21600000, // 6 hours in milliseconds
  status: 'pending',
  errorMessage: null,
  metadata: {
    totalRules: 0,
    tlds: 0,
    domains: 0,
    urls: 0,
    groups: 0
  }
};

// Sanitize and validate blocklist configuration to prevent security issues
function sanitizeConfig(config) {
  const sanitized = { ...DEFAULT_EXTERNAL_CONFIG };

  // Validate and sanitize ID (required field—must be present)
  if (config.id && typeof config.id === 'string' && config.id.length <= 100) {
    sanitized.id = config.id;
  } else {
    // ID is required—throw error if missing or invalid
    throw new Error('Invalid or missing blocklist ID');
  }

  // Validate and sanitize name (max 200 chars, strip HTML)
  if (config.name && typeof config.name === 'string') {
    sanitized.name = config.name.substring(0, 200).replace(/[<>]/g, '');
  }

  // Validate and sanitize URL (max 2000 chars)
  if (config.url && typeof config.url === 'string' && config.url.length <= 2000) {
    sanitized.url = config.url;
  }

  // Validate format
  if (config.format === 'awagam-json') {
    sanitized.format = config.format;
  }

  // Validate boolean fields
  if (typeof config.enabled === 'boolean') {
    sanitized.enabled = config.enabled;
  }

  // Validate timestamps
  if (config.lastUpdated && typeof config.lastUpdated === 'string') {
    sanitized.lastUpdated = config.lastUpdated;
  }
  if (config.lastAttempted && typeof config.lastAttempted === 'string') {
    sanitized.lastAttempted = config.lastAttempted;
  }

  // Validate update interval (must be a number between 1 hour and 1 week)
  if (typeof config.updateInterval === 'number' &&
      config.updateInterval >= 3600000 &&
      config.updateInterval <= 604800000) {
    sanitized.updateInterval = config.updateInterval;
  }

  // Validate status
  const validStatuses = ['pending', 'active', 'error', 'disabled'];
  if (validStatuses.includes(config.status)) {
    sanitized.status = config.status;
  }

  // Sanitize error message (max 500 chars, strip HTML, prefix with system marker)
  if (config.errorMessage && typeof config.errorMessage === 'string') {
    const cleanError = config.errorMessage.substring(0, 500).replace(/[<>]/g, '');
    sanitized.errorMessage = cleanError;
  }

  // Validate metadata (ensure reasonable limits)
  if (config.metadata && typeof config.metadata === 'object') {
    sanitized.metadata = {
      totalRules: Math.min(Number(config.metadata.totalRules) || 0, 1000000),
      tlds: Math.min(Number(config.metadata.tlds) || 0, 1000000),
      domains: Math.min(Number(config.metadata.domains) || 0, 1000000),
      urls: Math.min(Number(config.metadata.urls) || 0, 1000000),
      groups: Math.min(Number(config.metadata.groups) || 0, 1000)
    };
  }

  return sanitized;
}

// Save external blocklist configuration
async function saveExternalBlocklistConfig(config) {
  try {
    // Sanitize config to prevent security issues
    const sanitizedConfig = sanitizeConfig(config);

    const configs = await loadExternalBlocklistConfigs();
    configs[sanitizedConfig.id] = sanitizedConfig;

    // Try chrome.storage.sync first (cross-device sync)
    try {
      await chrome.storage.sync.set({ externalBlocklists: configs });
    } catch (error) {
      // Fallback to local storage if sync fails or quota exceeded
      console.warn('AWAGAM: Sync storage failed, using local storage:', error);
      await chrome.storage.local.set({ externalBlocklists: configs });
    }

    return true;
  } catch (error) {
    console.error('AWAGAM: Error saving blocklist config:', error);
    return false;
  }
}

// Load external blocklist configurations
async function loadExternalBlocklistConfigs() {
  try {
    // Try sync storage first
    let result = await chrome.storage.sync.get('externalBlocklists');

    // Fallback to local storage if not found in sync
    if (!result.externalBlocklists) {
      result = await chrome.storage.local.get('externalBlocklists');
    }

    return result.externalBlocklists || {};
  } catch (error) {
    console.error('AWAGAM: Error loading blocklist configs:', error);
    return {};
  }
}

// Delete external blocklist configuration
async function deleteExternalBlocklistConfig(id) {
  try {
    const configs = await loadExternalBlocklistConfigs();
    delete configs[id];

    // Update both sync and local storage
    try {
      await chrome.storage.sync.set({ externalBlocklists: configs });
    } catch (error) {
      console.warn('AWAGAM: Sync storage failed during delete:', error);
    }
    await chrome.storage.local.set({ externalBlocklists: configs });

    // Also remove cached data
    await deleteCachedBlocklist(id);

    return true;
  } catch (error) {
    console.error('AWAGAM: Error deleting blocklist config:', error);
    return false;
  }
}

// Cache blocklist data locally
async function cacheBlocklistData(id, data, metadata = {}) {
  try {
    const cachedData = {
      data: data,
      cachedAt: new Date().toISOString(),
      etag: metadata.etag || null,
      size: JSON.stringify(data).length
    };

    const cacheKey = `cachedBlocklist_${id}`;
    await chrome.storage.local.set({ [cacheKey]: cachedData });

    return true;
  } catch (error) {
    console.error('AWAGAM: Error caching blocklist data:', error);
    return false;
  }
}

// Load cached blocklist data
async function loadCachedBlocklist(id) {
  try {
    const cacheKey = `cachedBlocklist_${id}`;
    const result = await chrome.storage.local.get(cacheKey);
    return result[cacheKey] || null;
  } catch (error) {
    console.error('AWAGAM: Error loading cached blocklist:', error);
    return null;
  }
}

// Delete cached blocklist data
async function deleteCachedBlocklist(id) {
  try {
    const cacheKey = `cachedBlocklist_${id}`;
    await chrome.storage.local.remove(cacheKey);
    return true;
  } catch (error) {
    console.error('AWAGAM: Error deleting cached blocklist:', error);
    return false;
  }
}

// Update blocklist status
async function updateBlocklistStatus(id, status, errorMessage = null) {
  try {
    const configs = await loadExternalBlocklistConfigs();
    if (configs[id]) {
      configs[id].status = status;
      configs[id].errorMessage = errorMessage;
      configs[id].lastAttempted = new Date().toISOString();

      if (status === 'active') {
        configs[id].lastUpdated = new Date().toISOString();
        configs[id].errorMessage = null;
      }

      // Save updated config
      await saveExternalBlocklistConfig(configs[id]);
    }
    return true;
  } catch (error) {
    console.error('AWAGAM: Error updating blocklist status:', error);
    return false;
  }
}

// Check if blocklist needs update
function needsUpdate(config) {
  if (!config.lastUpdated) return true;

  const lastUpdated = new Date(config.lastUpdated);
  const now = new Date();
  const timeSinceUpdate = now - lastUpdated;

  return timeSinceUpdate >= config.updateInterval;
}

// Get storage usage statistics
async function getStorageStats() {
  try {
    const localUsage = await chrome.storage.local.getBytesInUse();
    const syncUsage = await chrome.storage.sync.getBytesInUse();

    // Chrome storage limits
    const LOCAL_QUOTA = chrome.storage.local.QUOTA_BYTES;
    const SYNC_QUOTA = chrome.storage.sync.QUOTA_BYTES;

    return {
      local: {
        used: localUsage,
        quota: LOCAL_QUOTA,
        percentage: Math.round((localUsage / LOCAL_QUOTA) * 100)
      },
      sync: {
        used: syncUsage,
        quota: SYNC_QUOTA,
        percentage: Math.round((syncUsage / SYNC_QUOTA) * 100)
      }
    };
  } catch (error) {
    console.error('AWAGAM: Error getting storage stats:', error);
    return null;
  }
}

// Generate unique ID for new blocklist
function generateBlocklistId() {
  return 'user-list-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5);
}

// Export all functions for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  // Node.js environment (for testing)
  module.exports = {
    saveExternalBlocklistConfig,
    loadExternalBlocklistConfigs,
    deleteExternalBlocklistConfig,
    cacheBlocklistData,
    loadCachedBlocklist,
    deleteCachedBlocklist,
    updateBlocklistStatus,
    needsUpdate,
    getStorageStats,
    generateBlocklistId,
    DEFAULT_EXTERNAL_CONFIG
  };
}