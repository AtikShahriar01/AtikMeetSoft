/**
 * ============================================================
 *  AtikMeet - Helper Utilities (Main Process)
 *  General-purpose utility functions for Node.js/main process
 * ============================================================
 */

const os = require('os');
const { exec } = require('child_process');

// ── Formatting Functions ─────────────────────────────────────

/**
 * Formats a duration in seconds to a human-readable string
 * @param {number} seconds - Duration in seconds
 * @returns {string} Formatted duration (e.g., "1h 23m 45s", "5m 30s", "45s")
 */
function formatDuration(seconds) {
  try {
    if (typeof seconds !== 'number' || seconds < 0 || isNaN(seconds)) {
      return '0s';
    }

    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    const parts = [];
    if (hrs > 0) parts.push(`${hrs}h`);
    if (mins > 0) parts.push(`${mins}m`);
    if (secs > 0 || parts.length === 0) parts.push(`${secs}s`);

    return parts.join(' ');
  } catch (error) {
    console.error('[Helpers] formatDuration error:', error.message);
    return '0s';
  }
}

/**
 * Formats a date string or Date object to a localized display string
 * @param {string|Date} date - The date to format
 * @param {Object} options - Intl.DateTimeFormat options override
 * @returns {string} Formatted date string
 */
function formatDate(date, options = {}) {
  try {
    if (!date) return 'N/A';

    const dateObj = typeof date === 'string' ? new Date(date) : date;

    if (isNaN(dateObj.getTime())) {
      return 'Invalid Date';
    }

    const defaultOptions = {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      ...options,
    };

    return dateObj.toLocaleDateString('en-US', defaultOptions);
  } catch (error) {
    console.error('[Helpers] formatDate error:', error.message);
    return 'N/A';
  }
}

/**
 * Formats a file size in bytes to a human-readable string
 * @param {number} bytes - File size in bytes
 * @returns {string} Formatted size (e.g., "1.5 MB", "500 KB")
 */
function formatFileSize(bytes) {
  try {
    if (typeof bytes !== 'number' || bytes < 0 || isNaN(bytes)) {
      return '0 B';
    }

    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let unitIndex = 0;
    let size = bytes;

    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }

    return `${size.toFixed(unitIndex === 0 ? 0 : 2)} ${units[unitIndex]}`;
  } catch (error) {
    console.error('[Helpers] formatFileSize error:', error.message);
    return '0 B';
  }
}

// ── ID Generation ────────────────────────────────────────────

/**
 * Generates a unique meeting ID in the format: atikmeet-xxxx-yyyy-zzzz
 * Each segment is a random lowercase alphanumeric string
 * @returns {string} Meeting ID (e.g., "atikmeet-a3b7-c9d2-e5f1")
 */
function generateMeetingId() {
  try {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';

    /**
     * Generates a random segment of the specified length
     * @param {number} length - Segment length
     * @returns {string} Random alphanumeric segment
     */
    function segment(length) {
      let result = '';
      for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      return result;
    }

    return `atikmeet-${segment(4)}-${segment(4)}-${segment(4)}`;
  } catch (error) {
    console.error('[Helpers] generateMeetingId error:', error.message);
    // Fallback with timestamp
    return `atikmeet-${Date.now().toString(36)}-${Math.random().toString(36).substr(2, 4)}-${Math.random().toString(36).substr(2, 4)}`;
  }
}

// ── Validation Functions ─────────────────────────────────────

/**
 * Validates a license key against the ATIK-XXXX-XXXX-XXXX format
 * @param {string} key - License key to validate
 * @returns {boolean} True if valid format
 */
function isValidLicenseKey(key) {
  try {
    if (!key || typeof key !== 'string') return false;
    const keyRegex = /^ATIK-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/;
    return keyRegex.test(key.toUpperCase().trim());
  } catch (error) {
    console.error('[Helpers] isValidLicenseKey error:', error.message);
    return false;
  }
}

/**
 * Validates an email address format
 * @param {string} email - Email address to validate
 * @returns {boolean} True if valid email format
 */
function isValidEmail(email) {
  try {
    if (!email || typeof email !== 'string') return false;
    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    return emailRegex.test(email.trim());
  } catch (error) {
    console.error('[Helpers] isValidEmail error:', error.message);
    return false;
  }
}

// ── Browser Functions ────────────────────────────────────────

/**
 * Returns the name of the default browser based on the OS
 * @returns {string} Default browser name or 'unknown'
 */
function getDefaultBrowser() {
  try {
    const platform = os.platform();

    switch (platform) {
      case 'win32':
        return 'Microsoft Edge'; // Default on Windows 10/11
      case 'darwin':
        return 'Safari'; // Default on macOS
      case 'linux':
        return 'Firefox'; // Common default on Linux
      default:
        return 'unknown';
    }
  } catch (error) {
    console.error('[Helpers] getDefaultBrowser error:', error.message);
    return 'unknown';
  }
}

/**
 * Opens a URL in the system's default browser
 * @param {string} url - URL to open
 * @returns {Promise<boolean>} True if command was dispatched successfully
 */
function openInBrowser(url) {
  return new Promise((resolve) => {
    try {
      if (!url || typeof url !== 'string') {
        console.error('[Helpers] openInBrowser: Invalid URL');
        resolve(false);
        return;
      }

      const platform = os.platform();
      let command;

      switch (platform) {
        case 'win32':
          command = `start "" "${url}"`;
          break;
        case 'darwin':
          command = `open "${url}"`;
          break;
        case 'linux':
          command = `xdg-open "${url}"`;
          break;
        default:
          console.error(`[Helpers] openInBrowser: Unsupported platform: ${platform}`);
          resolve(false);
          return;
      }

      exec(command, (error) => {
        if (error) {
          console.error('[Helpers] openInBrowser exec error:', error.message);
          resolve(false);
        } else {
          resolve(true);
        }
      });
    } catch (error) {
      console.error('[Helpers] openInBrowser error:', error.message);
      resolve(false);
    }
  });
}

// ── System Information ───────────────────────────────────────

/**
 * Collects system information for diagnostics
 * @returns {Object} System info object
 */
function getSystemInfo() {
  try {
    const cpus = os.cpus();
    const totalMemory = os.totalmem();
    const freeMemory = os.freemem();
    const usedMemory = totalMemory - freeMemory;

    return {
      platform: os.platform(),
      arch: os.arch(),
      release: os.release(),
      hostname: os.hostname(),
      cpuModel: cpus.length > 0 ? cpus[0].model : 'Unknown',
      cpuCores: cpus.length,
      totalMemory: formatFileSize(totalMemory),
      freeMemory: formatFileSize(freeMemory),
      usedMemory: formatFileSize(usedMemory),
      memoryUsagePercent: ((usedMemory / totalMemory) * 100).toFixed(1) + '%',
      uptime: formatDuration(os.uptime()),
      nodeVersion: process.version,
      electronVersion: process.versions.electron || 'N/A',
      chromeVersion: process.versions.chrome || 'N/A',
      v8Version: process.versions.v8 || 'N/A',
    };
  } catch (error) {
    console.error('[Helpers] getSystemInfo error:', error.message);
    return {
      platform: 'unknown',
      arch: 'unknown',
      release: 'unknown',
      hostname: 'unknown',
      cpuModel: 'Unknown',
      cpuCores: 0,
      totalMemory: '0 B',
      freeMemory: '0 B',
      usedMemory: '0 B',
      memoryUsagePercent: '0%',
      uptime: '0s',
      nodeVersion: 'N/A',
      electronVersion: 'N/A',
      chromeVersion: 'N/A',
      v8Version: 'N/A',
    };
  }
}

// ── Utility Functions ────────────────────────────────────────

/**
 * Creates a debounced version of a function
 * The debounced function delays invoking the provided function until after
 * `delay` milliseconds have elapsed since the last invocation
 * @param {Function} fn - The function to debounce
 * @param {number} delay - Delay in milliseconds
 * @returns {Function} Debounced function with a .cancel() method
 */
function debounce(fn, delay) {
  let timeoutId = null;

  const debounced = function (...args) {
    // Clear any existing timeout
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }

    // Set a new timeout
    timeoutId = setTimeout(() => {
      fn.apply(this, args);
      timeoutId = null;
    }, delay);
  };

  /**
   * Cancels any pending debounced invocation
   */
  debounced.cancel = function () {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
  };

  return debounced;
}

// ── Module Exports ───────────────────────────────────────────

module.exports = {
  formatDuration,
  formatDate,
  formatFileSize,
  generateMeetingId,
  isValidLicenseKey,
  isValidEmail,
  getDefaultBrowser,
  openInBrowser,
  getSystemInfo,
  debounce,
};
