// Options page script

let externalBlocklists = {};
let editingBlocklist = null;
let blocklistToDelete = null;

// DOM elements
const addBlocklistBtn = document.getElementById('addBlocklistBtn');
const refreshAllBtn = document.getElementById('refreshAllBtn');
const importConfigBtn = document.getElementById('importConfigBtn');
const exportConfigBtn = document.getElementById('exportConfigBtn');
const blocklistTable = document.getElementById('blocklistTable').getElementsByTagName('tbody')[0];
const emptyState = document.getElementById('emptyState');

// Modal elements
const addEditModal = document.getElementById('addEditModal');
const deleteModal = document.getElementById('deleteModal');
const importModal = document.getElementById('importModal');
const blocklistForm = document.getElementById('blocklistForm');

// Initialize page
document.addEventListener('DOMContentLoaded', async () => {
  setupEventListeners();
  await loadData();
});

// Setup event listeners
function setupEventListeners() {
  addBlocklistBtn.addEventListener('click', () => showAddModal());
  refreshAllBtn.addEventListener('click', refreshAllBlocklists);
  importConfigBtn.addEventListener('click', () => showImportModal());
  exportConfigBtn.addEventListener('click', exportConfiguration);
  blocklistForm.addEventListener('submit', handleFormSubmit);

  // Add event listeners for modal buttons (with error checking)
  const addFirstBtn = document.getElementById('addFirstBlocklistBtn');
  if (addFirstBtn) addFirstBtn.addEventListener('click', () => showAddModal());

  const closeAddModalBtn = document.getElementById('closeAddModalBtn');
  if (closeAddModalBtn) closeAddModalBtn.addEventListener('click', hideAddModal);

  const cancelAddBtn = document.getElementById('cancelAddBtn');
  if (cancelAddBtn) cancelAddBtn.addEventListener('click', hideAddModal);

  const closeDeleteModalBtn = document.getElementById('closeDeleteModalBtn');
  if (closeDeleteModalBtn) closeDeleteModalBtn.addEventListener('click', hideDeleteModal);

  const cancelDeleteBtn = document.getElementById('cancelDeleteBtn');
  if (cancelDeleteBtn) cancelDeleteBtn.addEventListener('click', hideDeleteModal);

  const confirmDeleteBtn = document.getElementById('confirmDeleteBtn');
  if (confirmDeleteBtn) confirmDeleteBtn.addEventListener('click', confirmDelete);

  const closeImportModalBtn = document.getElementById('closeImportModalBtn');
  if (closeImportModalBtn) closeImportModalBtn.addEventListener('click', hideImportModal);

  const cancelImportBtn = document.getElementById('cancelImportBtn');
  if (cancelImportBtn) cancelImportBtn.addEventListener('click', hideImportModal);

  const confirmImportBtn = document.getElementById('confirmImportBtn');
  if (confirmImportBtn) confirmImportBtn.addEventListener('click', importConfiguration);

  // Close modals when clicking outside
  window.addEventListener('click', (event) => {
    if (event.target === addEditModal) hideAddModal();
    if (event.target === deleteModal) hideDeleteModal();
    if (event.target === importModal) hideImportModal();
  });
}

// Load all data
async function loadData() {
  await Promise.all([
    loadExternalBlocklists(),
    // loadBuiltinStats(),
    loadStorageStats()
  ]);
  updateTable();
}

// Load external blocklists
async function loadExternalBlocklists() {
  try {
    const response = await chrome.runtime.sendMessage({ action: 'getExternalBlocklists' });
    if (response.success) {
      externalBlocklists = response.configs;
      await updateExternalStats();
    } else {
      console.error('Failed to load blocklists:', response.error);
    }
  } catch (error) {
    console.error('Error loading blocklists:', error);
  }
}

// Load built-in blocklist statistics
async function loadBuiltinStats() {
  try {
    const response = await fetch(chrome.runtime.getURL('blocklist.json'));
    const blocklist = await response.json();

    let totalTlds = 0;
    let totalDomains = 0;
    let totalUrls = 0;
    let totalGroups = 0;

    Object.values(blocklist).forEach(group => {
      totalGroups++;
      totalTlds += (group.tlds || []).length;
      totalDomains += (group.domains || []).length;
      totalUrls += (group.urls || []).length;
    });

    const totalRules = totalTlds + totalDomains + totalUrls;
    document.getElementById('builtinStats').textContent =
      `${totalRules.toLocaleString()} rules (${totalTlds.toLocaleString()} TLDs, ${totalDomains.toLocaleString()} domains, ${totalUrls.toLocaleString()} URLs) in ${totalGroups} groups`;
  } catch (error) {
    console.error('Error loading built-in stats:', error);
    document.getElementById('builtinStats').textContent = 'Unable to load statistics';
  }
}

// Calculate deduplicated counts for external blocklists
async function calculateDeduplicatedExternalCounts(activeConfigs) {
  const allTlds = new Set();
  const allDomains = new Set();
  const allUrls = new Set();

  for (const config of activeConfigs) {
    try {
      // Get detailed counts from cached data
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

// Update external blocklist statistics
async function updateExternalStats() {
  const configs = Object.values(externalBlocklists);
  const activeConfigs = configs.filter(c => c.enabled && c.status === 'active');
  const totalCount = configs.length;

  // Calculate deduplicated counts
  const deduplicatedCounts = await calculateDeduplicatedExternalCounts(activeConfigs);
  const totalRules = deduplicatedCounts.tlds + deduplicatedCounts.domains + deduplicatedCounts.urls;

  document.getElementById('externalStats').textContent =
    `${totalCount} configured, ${activeConfigs.length} active, ${totalRules.toLocaleString()} unique rules (${deduplicatedCounts.tlds.toLocaleString()} TLDs, ${deduplicatedCounts.domains.toLocaleString()} domains, ${deduplicatedCounts.urls.toLocaleString()} URLs)`;

  // Show warning if exceeding browser’s dynamic rule limit
  const dynamicRuleLimit = chrome.declarativeNetRequest?.MAX_NUMBER_OF_DYNAMIC_RULES || 30000;
  const limitWarning = document.getElementById('limitWarning');
  const limitWarningMessage = document.getElementById('limitWarningMessage');

  if (totalRules > dynamicRuleLimit) {
    limitWarningMessage.textContent =
      `Your total rules (${totalRules.toLocaleString()}) exceed your browser’s limit of ${dynamicRuleLimit.toLocaleString()} dynamic rules. Some blocklists may not work properly.`;
    limitWarning.style.display = 'block';
  } else {
    limitWarning.style.display = 'none';
  }
}

// Load storage statistics
async function loadStorageStats() {
  try {
    const localUsage = await chrome.storage.local.getBytesInUse();
    const syncUsage = await chrome.storage.sync.getBytesInUse();

    // Chrome storage limits
    const LOCAL_QUOTA = chrome.storage.local.QUOTA_BYTES || 5242880; // 5 MB default
    const SYNC_QUOTA = chrome.storage.sync.QUOTA_BYTES || 102400; // 100 KB default

    const localPercent = Math.round((localUsage / LOCAL_QUOTA) * 100);
    const syncPercent = Math.round((syncUsage / SYNC_QUOTA) * 100);

    const formatBytes = (bytes) => {
      if (bytes === 0) return '0 B';
      const k = 1024;
      const sizes = ['B', 'KB', 'MB'];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    };

    const formatQuota = (bytes) => {
      const k = 1024;
      if (bytes >= k * k) return Math.round(bytes / (k * k)) + ' MB';
      if (bytes >= k) return Math.round(bytes / k) + ' KB';
      return bytes + 'B';
    };

    document.getElementById('storageStats').innerHTML = `
      Local: ${formatBytes(localUsage)} / ${formatQuota(LOCAL_QUOTA)} (${localPercent}%),
      Sync: ${formatBytes(syncUsage)} / ${formatQuota(SYNC_QUOTA)} (${syncPercent}%)
    `;
  } catch (error) {
    console.error('Error loading storage stats:', error);
    document.getElementById('storageStats').textContent = 'Unable to load storage info';
  }
}

// Update the blocklist table
function updateTable() {
  const configs = Object.values(externalBlocklists);

  if (configs.length === 0) {
    document.querySelector('.table-container table').style.display = 'none';
    emptyState.style.display = 'block';
    return;
  }

  document.querySelector('.table-container table').style.display = 'table';
  emptyState.style.display = 'none';

  // Clear existing rows
  blocklistTable.innerHTML = '';

  configs.forEach(config => {
    const row = blocklistTable.insertRow();

    // Name
    const nameCell = row.insertCell();
    nameCell.textContent = config.name;

    // Status
    const statusCell = row.insertCell();
    const statusSpan = document.createElement('span');
    statusSpan.className = `status ${config.status || 'pending'}`;
    statusSpan.textContent = config.enabled ? (config.status || 'pending') : 'disabled';
    if (config.errorMessage) {
      if (config.status === 'error') {
        statusSpan.textContent = `error: ${config.errorMessage}`;
      }
      statusSpan.title = `Error: ${config.errorMessage}`;
    }
    statusCell.appendChild(statusSpan);

    // URL
    const urlCell = row.insertCell();
    const urlLink = document.createElement('a');
    urlLink.href = config.url;
    urlLink.target = '_blank';
    urlLink.textContent = config.url;
    urlCell.appendChild(urlLink);


    // Rules
    const rulesCell = row.insertCell();
    const tlds = config.metadata?.tlds || 0;
    const domains = config.metadata?.domains || 0;
    const urls = config.metadata?.urls || 0;
    const totalRules = tlds + domains + urls;
    const groups = config.metadata?.groups || 0;
    rulesCell.textContent = `${totalRules.toLocaleString()} rules (${tlds.toLocaleString()} TLDs, ${domains.toLocaleString()} domains, ${urls.toLocaleString()} URLs) in ${groups} groups`;

    // Last Updated
    const lastUpdatedCell = row.insertCell();
    if (config.lastUpdated) {
      const date = new Date(config.lastUpdated);
      lastUpdatedCell.textContent = formatRelativeTime(date);
      lastUpdatedCell.title = date.toLocaleString();
    } else {
      lastUpdatedCell.textContent = 'Never';
    }

    // Actions
    const actionsCell = row.insertCell();
    const actionsDiv = document.createElement('div');
    actionsDiv.style.display = 'flex';
    actionsDiv.style.gap = '8px';

    // Edit button
    const editBtn = document.createElement('button');
    editBtn.textContent = 'Edit';
    editBtn.className = 'btn btn-secondary btn-small';
    editBtn.addEventListener('click', () => showEditModal(config));
    actionsDiv.appendChild(editBtn);

    // Refresh button
    const refreshBtn = document.createElement('button');
    refreshBtn.textContent = 'Refresh';
    refreshBtn.className = 'btn btn-secondary btn-small';
    refreshBtn.addEventListener('click', () => refreshSingleBlocklist(config.id));
    actionsDiv.appendChild(refreshBtn);

    // Delete button
    const deleteBtn = document.createElement('button');
    deleteBtn.textContent = 'Delete';
    deleteBtn.className = 'btn btn-danger btn-small';
    deleteBtn.addEventListener('click', () => showDeleteModal(config));
    actionsDiv.appendChild(deleteBtn);

    actionsCell.appendChild(actionsDiv);
  });
}

// Show add modal
function showAddModal() {
  editingBlocklist = null;
  document.getElementById('modalTitle').textContent = 'Add Blocklist';
  blocklistForm.reset();
  addEditModal.classList.add('show');
  document.getElementById('blocklistName').focus();
}

// Show edit modal
function showEditModal(config) {
  editingBlocklist = config;
  document.getElementById('modalTitle').textContent = 'Edit Blocklist';

  // Populate form
  document.getElementById('blocklistName').value = config.name;
  document.getElementById('blocklistUrl').value = config.url;
  document.getElementById('updateInterval').value = config.updateInterval || 21600000;
  document.getElementById('blocklistEnabled').checked = config.enabled !== false;

  addEditModal.classList.add('show');
  document.getElementById('blocklistName').focus();
}

// Hide add/edit modal
function hideAddModal() {
  addEditModal.classList.remove('show');
  editingBlocklist = null;
}

// Show delete modal
function showDeleteModal(config) {
  blocklistToDelete = config;
  document.getElementById('deleteBlocklistName').textContent = config.name;
  deleteModal.classList.add('show');
}

// Hide delete modal
function hideDeleteModal() {
  deleteModal.classList.remove('show');
  blocklistToDelete = null;
}

// Show import modal
function showImportModal() {
  importModal.classList.add('show');
}

// Hide import modal
function hideImportModal() {
  importModal.classList.remove('show');
  document.getElementById('importFile').value = '';
}

// Handle form submission
async function handleFormSubmit(event) {
  event.preventDefault();

  const formData = new FormData(blocklistForm);
  const config = {
    name: formData.get('name').trim(),
    url: formData.get('url').trim(),
    format: 'awagam-json',
    updateInterval: parseInt(formData.get('updateInterval')),
    enabled: formData.has('enabled')
  };

  // Validate URL
  try {
    const url = new URL(config.url);
    if (url.protocol !== 'https:') {
      alert('Only HTTPS URLs are allowed for security reasons.');
      return;
    }

    // Check for GitHub token URLs and suggest alternatives
    if (config.url.includes('token=') && config.url.includes('githubusercontent.com')) {
      const proceed = confirm(
        'Warning: This GitHub URL contains a token that will expire soon.\n\n' +
        'For reliable access, consider using:\n' +
        '• A public repository (no token needed)\n' +
        '• jsDelivr CDN: https://cdn.jsdelivr.net/gh/user/repo@main/file.json\n\n' +
        'Continue with this URL anyway?'
      );
      if (!proceed) return;
    }
  } catch (error) {
    alert('Please enter a valid URL.');
    return;
  }

  try {
    let response;
    if (editingBlocklist) {
      // Update existing
      config.id = editingBlocklist.id;
      response = await chrome.runtime.sendMessage({
        action: 'updateExternalBlocklist',
        config: config
      });
    } else {
      // Add new
      response = await chrome.runtime.sendMessage({
        action: 'addExternalBlocklist',
        config: config
      });
    }

    if (response.success) {
      hideAddModal();
      await loadExternalBlocklists();
      updateTable();
      showNotification(editingBlocklist ? 'Blocklist updated successfully' : 'Blocklist added successfully');
    } else {
      showNotification('Error: ' + response.error);
    }
  } catch (error) {
    console.error('Error saving blocklist:', error);
    showNotification('Failed to save blocklist: ' + error.message);
  }
}

// Confirm deletion
async function confirmDelete() {
  if (!blocklistToDelete) return;

  try {
    const response = await chrome.runtime.sendMessage({
      action: 'deleteExternalBlocklist',
      id: blocklistToDelete.id
    });

    if (response.success) {
      hideDeleteModal();
      await loadExternalBlocklists();
      updateTable();
      showNotification('Blocklist deleted successfully');
    } else {
      hideDeleteModal();
      showNotification('Error: ' + response.error);
    }
  } catch (error) {
    console.error('Error deleting blocklist:', error);
    hideDeleteModal();
    showNotification('Failed to delete blocklist: ' + error.message);
  }
}

// Refresh single blocklist
async function refreshSingleBlocklist(id) {
  try {
    const response = await chrome.runtime.sendMessage({
      action: 'refreshExternalBlocklist',
      id: id
    });

    if (response.success) {
      await loadExternalBlocklists();
      updateTable();
      showNotification('Blocklist refreshed successfully');
    } else {
      await loadExternalBlocklists();
      updateTable();
      showNotification('Failed to refresh blocklist—check status for details');
    }
  } catch (error) {
    console.error('Error refreshing blocklist:', error);
    await loadExternalBlocklists();
    updateTable();
    showNotification('Failed to refresh blocklist');
  }
}

// Refresh all blocklists
async function refreshAllBlocklists() {
  const configs = Object.values(externalBlocklists);
  const promises = configs.map(config => refreshSingleBlocklist(config.id));

  try {
    await Promise.all(promises);
    showNotification('All blocklists refreshed');
  } catch (error) {
    console.error('Error refreshing all blocklists:', error);
    showNotification('Some blocklists failed to refresh—check individual status');
  }
}

// Export configuration
function exportConfiguration() {
  const exportData = {
    version: "2.1.0",
    exportedAt: new Date().toISOString(),
    externalBlocklists: externalBlocklists
  };

  const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = `awagam-config-${new Date().toISOString().split('T')[0]}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  showNotification('Configuration exported successfully');
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

// Import configuration
async function importConfiguration() {
  const fileInput = document.getElementById('importFile');
  const file = fileInput.files[0];

  if (!file) {
    alert('Please select a file to import.');
    return;
  }

  try {
    const text = await file.text();
    const importData = JSON.parse(text);

    // Validate JSON depth to prevent JSON bomb DoS attacks
    const maxDepth = 20;
    const depth = getObjectDepth(importData);
    if (depth > maxDepth) {
      throw new Error(`Configuration file structure too deeply nested (depth: ${depth}, max: ${maxDepth})`);
    }

    if (!importData.externalBlocklists) {
      alert('Invalid configuration file format.');
      return;
    }

    // Import all blocklist configurations in batch to avoid race conditions
    const response = await chrome.runtime.sendMessage({
      action: 'importBlocklistConfigs',
      configs: Object.values(importData.externalBlocklists)
    });

    if (!response.success) {
      throw new Error(response.error || 'Import failed');
    }

    const successful = response.results.filter(r => r.success).length;
    const failed = response.results.length - successful;

    hideImportModal();
    await loadExternalBlocklists();
    updateTable();

    if (failed === 0) {
      showNotification(`Successfully imported ${successful} blocklists`);
    } else {
      showNotification(`Imported ${successful} blocklists, ${failed} failed`);
    }

  } catch (error) {
    console.error('Error importing configuration:', error);
    alert('Failed to import configuration: ' + error.message);
  }
}

// Utility functions
function formatRelativeTime(date) {
  const now = new Date();
  const diff = now - date;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString();
}

function showNotification(message) {
  // Simple notification—could be enhanced with a toast system
  const notification = document.createElement('div');
  notification.textContent = message;
  notification.className = 'text-sm';
  notification.style.cssText = `
    animation: slideInRight 0.5s ease;
    background: #d1fae5;
    border-radius: 6px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.2);
    color: #065f46;
    padding: 1rem 1.5rem;
    position: fixed;
    right: 1.5rem;
    top: 1.5rem;
    z-index: 10000;
  `;

  document.body.appendChild(notification);

  setTimeout(() => {
    notification.style.animation = 'slideOutRight 0.3s ease';
    setTimeout(() => {
      if (notification.parentNode) {
        notification.parentNode.removeChild(notification);
      }
    }, 300);
  }, 3000);
}

// Add CSS animations for notifications
const style = document.createElement('style');
style.textContent = `
  @keyframes slideInRight {

    from {
      opacity: 0;
      transform: translateX(100%);
    }

    to {
      opacity: 1;
      transform: translateX(0);
    }
  }

  @keyframes slideOutRight {

    from {
      opacity: 1;
      transform: translateX(0);
    }

    to {
      opacity: 0;
      transform: translateX(100%);
    }
  }
`;
document.head.appendChild(style);