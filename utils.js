/**
 * Shared Utilities for Pixel Agent Desk
 * Eliminates code duplication across modules
 */

/**
 * Format slug to display name
 * @param {string} slug - Slug like "toasty-sparking-lecun"
 * @returns {string} Formatted name like "Toasty Sparking Lecun"
 */
function formatSlugToDisplayName(slug) {
  if (!slug) return 'Agent';
  return slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

/**
 * Get visual CSS class for agent state
 * @param {string} state - Agent state (Working, Idle, Waiting, Error, Help)
 * @returns {string} CSS class name
 */
function getVisualClassForState(state) {
  const mapping = {
    'Working': 'is-working',
    'Thinking': 'is-working',
    'Done': 'is-complete',
    'Error': 'is-alert',
    'Help': 'is-alert',
    'Offline': 'is-offline'
  };
  return mapping[state] || 'is-complete';
}

/**
 * Get elapsed time for display
 * @param {Object} agent - Agent object with state, activeStartTime, lastDuration
 * @returns {number} Elapsed time in milliseconds
 */
function getElapsedTime(agent) {
  if (agent.state === 'Done') {
    return agent.lastDuration || 0;
  } else if (agent.state === 'Working' || agent.state === 'Thinking') {
    return agent.activeStartTime ? Date.now() - agent.activeStartTime : 0;
  }
  return 0;
}

/**
 * Normalize path for comparison (Windows/Unix compatible)
 * @param {string} path - Path to normalize
 * @returns {string} Normalized path
 */
function normalizePath(path) {
  return (path || '').toLowerCase().replace(/\\/g, '/').replace(/\/$/, '');
}

/**
 * Safe file stat operation
 * @param {string} filePath - Path to file
 * @returns {fs.Stats|null} Stats object or null if error
 */
function safeStatSync(filePath) {
  try {
    const fs = require('fs');
    return fs.statSync(filePath);
  } catch (e) {
    return null;
  }
}

/**
 * Safe file existence check
 * @param {string} filePath - Path to file
 * @returns {boolean} True if file exists
 */
function safeExistsSync(filePath) {
  try {
    const fs = require('fs');
    return fs.existsSync(filePath);
  } catch (e) {
    return false;
  }
}

module.exports = {
  formatSlugToDisplayName,
  getVisualClassForState,
  getElapsedTime,
  normalizePath,
  safeStatSync,
  safeExistsSync
};
