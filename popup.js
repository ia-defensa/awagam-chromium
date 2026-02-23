// Popup control script

let isEnabled = true;
let disableTimer = null;

// DOM elements
const statusDiv = document.getElementById('status');
const toggleBtn = document.getElementById('toggleBtn');
const tempDisableSection = document.getElementById('tempDisableSection');
const timerDiv = document.getElementById('timer');
const countdownSpan = document.getElementById('countdown');

// Initialize popup
document.addEventListener('DOMContentLoaded', async () => {
  await loadCurrentState();
  await loadAndDisplayBlockStats();
  setupEventListeners();
  updateUI();
  startCountdownIfNeeded();
});

// Load current state from storage
async function loadCurrentState() {
  try {
    const result = await chrome.storage.local.get(['awagamEnabled', 'awagamDisableUntil']);
    isEnabled = result.awagamEnabled !== false; // Default to true

    // Check if temporary disable is still active
    if (result.awagamDisableUntil) {
      const disableUntil = new Date(result.awagamDisableUntil);
      if (disableUntil > new Date()) {
        isEnabled = false;
      } else {
        // Timer expired, clean up
        await chrome.storage.local.remove('awagamDisableUntil');
      }
    }
  } catch (error) {
    console.error('AWAGAM: Error loading state:', error);
  }
}

// Count blocked items from blocklist(s)
function countBlockedItems(blocklists) {
  let totalTlds = 0;
  let totalDomains = 0;
  let totalUrls = 0;
  let totalBlocklists = blocklists.length;

  blocklists.forEach(blocklist => {
    const groups = Object.values(blocklist);
    groups.forEach(group => {
      totalTlds += (group.tlds || []).length;
      totalDomains += (group.domains || []).length;
      totalUrls += (group.urls || []).length;
    });
  });

  return {
    tlds: totalTlds,
    domains: totalDomains,
    urls: totalUrls,
    blocklists: totalBlocklists
  };
}

// Load external blocklist statistics
async function loadExternalBlocklistStats() {
  try {
    const response = await chrome.runtime.sendMessage({ action: 'getExternalBlocklists' });
    if (response.success) {
      const configs = Object.values(response.configs);
      const activeConfigs = configs.filter(c => c.enabled && c.status === 'active');

      // Get detailed statistics by loading cached data
      let totalTlds = 0;
      let totalDomains = 0;
      let totalUrls = 0;

      for (const config of activeConfigs) {
        try {
          // Get detailed counts from cached data
          const cacheKey = `cachedBlocklist_${config.id}`;
          const cachedData = await chrome.storage.local.get(cacheKey);
          if (cachedData[cacheKey]) {
            const blocklistData = cachedData[cacheKey].data;
            Object.values(blocklistData).forEach(group => {
              totalTlds += (group.tlds || []).length;
              totalDomains += (group.domains || []).length;
              totalUrls += (group.urls || []).length;
            });
          } else {
            // Use metadata if cached data not available
            totalTlds += config.metadata?.tlds || 0;
            totalDomains += config.metadata?.domains || 0;
            totalUrls += config.metadata?.urls || 0;
          }
        } catch (error) {
          console.error('Error loading blocklist data:', error);
          totalTlds += config.metadata?.tlds || 0;
          totalDomains += config.metadata?.domains || 0;
          totalUrls += config.metadata?.urls || 0;
        }
      }

      return {
        count: configs.length,
        active: activeConfigs.length,
        tlds: totalTlds,
        domains: totalDomains,
        urls: totalUrls,
        totalRules: totalTlds + totalDomains + totalUrls
      };
    }
  } catch (error) {
    console.error('Error loading blocklist stats:', error);
  }

  return { count: 0, active: 0, tlds: 0, domains: 0, urls: 0, totalRules: 0 };
}

// Calculate deduplicated counts from all blocklists
async function calculateDeduplicatedCounts(builtinBlocklist, externalConfigs) {
  const allTlds = new Set();
  const allDomains = new Set();
  const allUrls = new Set();

  // Add built-in blocklist items
  Object.values(builtinBlocklist).forEach(group => {
    (group.tlds || []).forEach(tld => allTlds.add(tld.toLowerCase()));
    (group.domains || []).forEach(domain => allDomains.add(domain.toLowerCase()));
    (group.urls || []).forEach(url => allUrls.add(url));
  });

  // Add external blocklist items
  for (const config of externalConfigs) {
    if (!config.enabled || config.status !== 'active') continue;

    try {
      // Get cached data for this blocklist
      const cacheKey = `cachedBlocklist_${config.id}`;
      const cachedData = await chrome.storage.local.get(cacheKey);

      if (cachedData[cacheKey]) {
        const blocklistData = cachedData[cacheKey].data;
        Object.values(blocklistData).forEach(group => {
          (group.tlds || []).forEach(tld => allTlds.add(tld.toLowerCase()));
          (group.domains || []).forEach(domain => allDomains.add(domain.toLowerCase()));
          (group.urls || []).forEach(url => allUrls.add(url));
        });
      }
    } catch (error) {
      console.error('Error loading cached blocklist data:', error);
    }
  }

  return {
    tlds: allTlds.size,
    domains: allDomains.size,
    urls: allUrls.size
  };
}

// Load blocklist data and display statistics
async function loadAndDisplayBlockStats() {
  try {
    // Load built-in blocklist
    const response = await fetch(chrome.runtime.getURL('blocklist.json'));
    const builtinBlocklist = await response.json();

    // Load external blocklist configurations
    const externalResponse = await chrome.runtime.sendMessage({ action: 'getExternalBlocklists' });
    const externalConfigs = externalResponse.success ? Object.values(externalResponse.configs) : [];
    const activeExternalCount = externalConfigs.filter(c => c.enabled && c.status === 'active').length;

    // Calculate deduplicated counts
    const deduplicatedCounts = await calculateDeduplicatedCounts(builtinBlocklist, externalConfigs);
    const totalSources = 1 + activeExternalCount; // built-in + active external

    const statsElement = document.querySelector('p:nth-of-type(2)');
    if (statsElement) {
      let text = `Currently blocking: ${deduplicatedCounts.tlds.toLocaleString()} unique TLDs, ${deduplicatedCounts.domains.toLocaleString()} domains, ${deduplicatedCounts.urls.toLocaleString()} URLs, from ${totalSources} source${totalSources !== 1 ? 's' : ''}.`;

      if (externalConfigs.length > 0) {
        text += ` External: ${activeExternalCount}/${externalConfigs.length} active.`;
      }

      statsElement.textContent = text;
    }
  } catch (error) {
    console.error('AWAGAM: Error loading block statistics:', error);
    const statsElement = document.querySelector('p:nth-of-type(2)');
    if (statsElement) {
      statsElement.textContent = 'Unable to load block statistics';
    }
  }
}

// Setup event listeners
function setupEventListeners() {
  // Main toggle button
  toggleBtn.addEventListener('click', async () => {
    isEnabled = !isEnabled;
    await saveState();
    await notifyBackgroundScript();
    updateUI();

    // Clear any temporary disable timer
    if (isEnabled) {
      await chrome.storage.local.remove('awagamDisableUntil');
      clearInterval(disableTimer);
    }
  });

  // Temporary disable buttons
  document.querySelectorAll('.temp-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const minutes = parseInt(btn.dataset.minutes);
      await tempDisable(minutes);
    });
  });

  // Manage blocklists button
  document.getElementById('manageBlocklistsBtn').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });
}

// Temporarily disable for specified minutes
async function tempDisable(minutes) {
  const disableUntil = new Date(Date.now() + minutes * 60 * 1000);

  isEnabled = false;
  await chrome.storage.local.set({
    awagamEnabled: false,
    awagamDisableUntil: disableUntil.toISOString()
  });

  await notifyBackgroundScript();
  updateUI();
  startCountdown(disableUntil);
}

// Start countdown timer
function startCountdown(disableUntil) {
  clearInterval(disableTimer);

  disableTimer = setInterval(async () => {
    const now = new Date();
    const timeLeft = disableUntil - now;

    if (timeLeft <= 0) {
      // Timer expired, re-enable
      isEnabled = true;
      await chrome.storage.local.set({ awagamEnabled: true });
      await chrome.storage.local.remove('awagamDisableUntil');
      await notifyBackgroundScript();
      updateUI();
      clearInterval(disableTimer);
      return;
    }

    // Update countdown display
    const minutes = Math.floor(timeLeft / 60000);
    const seconds = Math.floor((timeLeft % 60000) / 1000);
    countdownSpan.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }, 1000);
}

// Check if countdown should be started on popup open
async function startCountdownIfNeeded() {
  try {
    const result = await chrome.storage.local.get('awagamDisableUntil');
    if (result.awagamDisableUntil && !isEnabled) {
      const disableUntil = new Date(result.awagamDisableUntil);
      if (disableUntil > new Date()) {
        startCountdown(disableUntil);
      }
    }
  } catch (error) {
    console.error('AWAGAM: Error checking countdown:', error);
  }
}

// Save current state
async function saveState() {
  try {
    await chrome.storage.local.set({ awagamEnabled: isEnabled });
  } catch (error) {
    console.error('AWAGAM: Error saving state:', error);
  }
}

// Notify background script of state change
async function notifyBackgroundScript() {
  try {
    await chrome.runtime.sendMessage({
      action: 'toggleExtension',
      enabled: isEnabled
    });
  } catch (error) {
    console.error('AWAGAM: Error notifying background script:', error);
  }
}

// Update UI based on current state
function updateUI() {
  if (isEnabled) {
    // Extension is enabled
    statusDiv.className = 'status enabled mb-2 mt-4 p-4 rounded-md text-center text-sm';
    statusDiv.textContent = '✅ Blocking is enabled';

    toggleBtn.className = 'toggle-btn disable btn-secondary w-full';
    toggleBtn.textContent = 'Disable blocking';

    tempDisableSection.style.display = 'block';
    timerDiv.style.display = 'none';
  } else {
    // Extension is disabled
    statusDiv.className = 'status disabled mb-2 mt-4 p-4 rounded-md text-center text-sm';
    statusDiv.textContent = '⚠️ Blocking is disabled';

    toggleBtn.className = 'toggle-btn enable btn-secondary w-full';
    toggleBtn.textContent = 'Enable blocking';

    tempDisableSection.style.display = 'none';

    // Show timer if there's a temporary disable
    chrome.storage.local.get('awagamDisableUntil').then(result => {
      if (result.awagamDisableUntil) {
        timerDiv.style.display = 'block';
      } else {
        timerDiv.style.display = 'none';
      }
    });
  }
}