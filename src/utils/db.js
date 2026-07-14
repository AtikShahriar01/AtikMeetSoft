/**
 * ============================================================
 *  AtikMeet - Database Module (Main Process)
 *  Uses lowdb v1.x with FileSync adapter
 *  DB file stored at data/db.json relative to app path
 * ============================================================
 */

const low = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

// ── Database Initialization ──────────────────────────────────

/** Resolve DB file path relative to app root */
const DATA_DIR = path.join(process.cwd(), 'data');
const DB_PATH = path.join(DATA_DIR, 'db.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const adapter = new FileSync(DB_PATH);
const db = low(adapter);

/** Default database schema */
const DEFAULT_SCHEMA = {
  users: [],
  meetings: [],
  licenseKeys: [],
  settings: {
    installDate: null,
    trialDays: 7,
    adminEmail: 'atik@atikmeet.com',
    maintenanceMode: false,
    maxParticipants: 150,
  },
};

// Initialize defaults
db.defaults(DEFAULT_SCHEMA).write();

// Migration: Ensure new settings properties exist in db settings
try {
  const currentSettings = db.get('settings').value();
  if (currentSettings) {
    let migrated = false;
    if (currentSettings.maintenanceMode === undefined) {
      currentSettings.maintenanceMode = false;
      migrated = true;
    }
    if (currentSettings.maxParticipants === undefined) {
      currentSettings.maxParticipants = 150;
      migrated = true;
    }
    if (migrated) {
      db.set('settings', currentSettings).write();
    }
  }
} catch (err) {
  console.error('[DB] Migration failed:', err.message);
}

// Seed default keys if empty or missing
const keys = db.get('licenseKeys').value() || [];
if (keys.length === 0 || !keys.find(k => k.key === 'ATIK-DEMO-2024-FREE')) {
  db.set('licenseKeys', [
    {
      key: 'ATIK-DEMO-2024-FREE',
      createdAt: new Date().toISOString(),
      isActive: false,
      assignedTo: null,
      activatedAt: null
    },
    {
      key: 'ATIK-FREE-PUBLIC-2026',
      createdAt: new Date().toISOString(),
      isActive: false,
      assignedTo: null,
      activatedAt: null,
      isShared: true
    },
    {
      key: 'ATIK-ADMIN-VIP-2026',
      createdAt: new Date().toISOString(),
      isActive: false,
      assignedTo: null,
      activatedAt: null
    }
  ]).write();
}

// ── Constants ────────────────────────────────────────────────

const SALT_ROUNDS = 10;
const LICENSE_PREFIX = 'ATIK';
const MAX_PARTICIPANTS = 150;
const SCREEN_SHARE_RESOLUTION = '1080p';

// ── Helper: Generate License Key Segment ─────────────────────

/**
 * Generates a random 4-character alphanumeric segment (uppercase)
 * @returns {string} A 4-character segment
 */
function _generateSegment() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let segment = '';
  for (let i = 0; i < 4; i++) {
    segment += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return segment;
}

// ── User Functions ───────────────────────────────────────────

/**
 * Creates a new user with hashed password
 * @param {Object} userData - { name, email, password, isAdmin? }
 * @returns {Object} { success, user?, error? }
 */
function createUser({ name, email, password, isAdmin = false }) {
  try {
    // Check for duplicate email
    const existingUser = db.get('users').find({ email: email.toLowerCase() }).value();
    if (existingUser) {
      return { success: false, error: 'A user with this email already exists.' };
    }

    // Validate required fields
    if (!name || !email || !password) {
      return { success: false, error: 'Name, email, and password are required.' };
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return { success: false, error: 'Invalid email format.' };
    }

    // Validate password length
    if (password.length < 6) {
      return { success: false, error: 'Password must be at least 6 characters.' };
    }

    // Hash password
    const hashedPassword = bcrypt.hashSync(password, SALT_ROUNDS);

    const newUser = {
      id: uuidv4(),
      name: name.trim(),
      email: email.toLowerCase().trim(),
      password: hashedPassword,
      createdAt: new Date().toISOString(),
      isAdmin: isAdmin,
      licenseKey: null,
      licenseActivated: false,
      isVIP: false,
      lastLogin: null,
    };

    db.get('users').push(newUser).write();

    // Return user without password
    const { password: _, ...safeUser } = newUser;
    return { success: true, user: safeUser };
  } catch (error) {
    console.error('[DB] createUser error:', error.message);
    return { success: false, error: 'Failed to create user. Please try again.' };
  }
}

/**
 * Authenticates a user with email and password
 * @param {string} email
 * @param {string} password
 * @returns {Object} { success, user?, error? }
 */
function loginUser(email, password) {
  try {
    if (!email || !password) {
      return { success: false, error: 'Email and password are required.' };
    }

    const user = db.get('users').find({ email: email.toLowerCase().trim() }).value();

    if (!user) {
      return { success: false, error: 'No account found with this email.' };
    }

    // Block authentication if the user is banned
    if (user.isBanned) {
      return { success: false, error: 'Your account has been banned by the administrator.' };
    }

    // Block non-admin login if system is in Maintenance Mode
    const settings = db.get('settings').value();
    if (settings && settings.maintenanceMode && !user.isAdmin) {
      return { success: false, error: 'The system is currently under maintenance. Please try again later.' };
    }

    // Compare passwords
    const isMatch = bcrypt.compareSync(password, user.password);
    if (!isMatch) {
      return { success: false, error: 'Incorrect password.' };
    }

    // Update last login timestamp
    db.get('users')
      .find({ id: user.id })
      .assign({ lastLogin: new Date().toISOString() })
      .write();

    // Return user without password
    const { password: _, ...safeUser } = user;
    safeUser.lastLogin = new Date().toISOString();
    return { success: true, user: safeUser };
  } catch (error) {
    console.error('[DB] loginUser error:', error.message);
    return { success: false, error: 'Login failed. Please try again.' };
  }
}

/**
 * Retrieves a user by ID (password excluded)
 * @param {string} userId
 * @returns {Object|null} User object or null
 */
function getUserById(userId) {
  try {
    const user = db.get('users').find({ id: userId }).value();
    if (!user) return null;

    const { password, ...safeUser } = user;
    return safeUser;
  } catch (error) {
    console.error('[DB] getUserById error:', error.message);
    return null;
  }
}

/**
 * Retrieves all users (passwords excluded)
 * @returns {Array} Array of user objects
 */
function getAllUsers() {
  try {
    const users = db.get('users').value();
    return users.map(({ password, ...safeUser }) => safeUser);
  } catch (error) {
    console.error('[DB] getAllUsers error:', error.message);
    return [];
  }
}

/**
 * Updates a user's profile fields
 * @param {string} userId
 * @param {Object} updates - Fields to update (password will be re-hashed if provided)
 * @returns {Object} { success, user?, error? }
 */
function updateUser(userId, updates) {
  try {
    const user = db.get('users').find({ id: userId }).value();
    if (!user) {
      return { success: false, error: 'User not found.' };
    }

    // If password is being updated, hash it
    if (updates.password) {
      if (updates.password.length < 6) {
        return { success: false, error: 'Password must be at least 6 characters.' };
      }
      updates.password = bcrypt.hashSync(updates.password, SALT_ROUNDS);
    }

    // If email is being updated, check for duplicates
    if (updates.email) {
      updates.email = updates.email.toLowerCase().trim();
      const existingUser = db.get('users').find({ email: updates.email }).value();
      if (existingUser && existingUser.id !== userId) {
        return { success: false, error: 'This email is already in use by another account.' };
      }
    }

    // Trim name if provided
    if (updates.name) {
      updates.name = updates.name.trim();
    }

    db.get('users').find({ id: userId }).assign(updates).write();

    const updatedUser = db.get('users').find({ id: userId }).value();
    const { password: _, ...safeUser } = updatedUser;
    return { success: true, user: safeUser };
  } catch (error) {
    console.error('[DB] updateUser error:', error.message);
    return { success: false, error: 'Failed to update user.' };
  }
}

/**
 * Deletes a user by ID
 * @param {string} userId
 * @returns {Object} { success, error? }
 */
function deleteUser(userId) {
  try {
    const user = db.get('users').find({ id: userId }).value();
    if (!user) {
      return { success: false, error: 'User not found.' };
    }

    // Prevent deleting admin
    if (user.isAdmin) {
      return { success: false, error: 'Cannot delete admin user.' };
    }

    db.get('users').remove({ id: userId }).write();

    // Also deactivate any associated license keys
    db.get('licenseKeys')
      .filter({ assignedTo: userId })
      .each((key) => {
        key.isActive = false;
        key.assignedTo = null;
      })
      .write();

    return { success: true };
  } catch (error) {
    console.error('[DB] deleteUser error:', error.message);
    return { success: false, error: 'Failed to delete user.' };
  }
}

/**
 * Retrieves the global system settings
 * @returns {Object} Settings object
 */
function getSettings() {
  try {
    return db.get('settings').value() || {};
  } catch (error) {
    console.error('[DB] getSettings error:', error.message);
    return {};
  }
}

/**
 * Updates the global system settings
 * @param {Object} updates
 * @returns {Object} { success, settings?, error? }
 */
function updateSettings(updates) {
  try {
    db.get('settings').assign(updates).write();
    return { success: true, settings: db.get('settings').value() };
  } catch (error) {
    console.error('[DB] updateSettings error:', error.message);
    return { success: false, error: 'Failed to update system settings.' };
  }
}

/**
 * Bans or unbans a user account
 * @param {string} userId
 * @param {boolean} isBanned
 * @returns {Object} { success, error? }
 */
function toggleUserBan(userId, isBanned) {
  try {
    const user = db.get('users').find({ id: userId }).value();
    if (!user) return { success: false, error: 'User not found.' };
    if (user.isAdmin) return { success: false, error: 'Cannot ban admin user.' };
    
    db.get('users').find({ id: userId }).assign({ isBanned }).write();
    return { success: true };
  } catch (error) {
    console.error('[DB] toggleUserBan error:', error.message);
    return { success: false, error: 'Failed to toggle ban status.' };
  }
}

/**
 * Promotes or demotes a user's administrator status
 * @param {string} userId
 * @param {boolean} isAdmin
 * @returns {Object} { success, error? }
 */
function toggleUserRole(userId, isAdmin) {
  try {
    const user = db.get('users').find({ id: userId }).value();
    if (!user) return { success: false, error: 'User not found.' };
    if (user.email === 'admin@atikmeet.com') return { success: false, error: 'Cannot demote the system root admin.' };
    
    db.get('users').find({ id: userId }).assign({ isAdmin }).write();
    return { success: true };
  } catch (error) {
    console.error('[DB] toggleUserRole error:', error.message);
    return { success: false, error: 'Failed to update user role.' };
  }
}

// ── License Key Functions ────────────────────────────────────

/**
 * Generates a new license key in ATIK-XXXX-XXXX-XXXX format
 * @param {string|number} durationDays - 'lifetime', 30, 365, etc.
 * @returns {string} The license key string
 */
function generateLicenseKey(durationDays = 'lifetime') {
  try {
    const key = `${LICENSE_PREFIX}-${_generateSegment()}-${_generateSegment()}-${_generateSegment()}`;
    const licenseRecord = {
      key: key,
      createdAt: new Date().toISOString(),
      isActive: false,
      assignedTo: null,
      activatedAt: null,
      durationDays: durationDays,
      expiresAt: null
    };

    db.get('licenseKeys').push(licenseRecord).write();

    return key;
  } catch (error) {
    console.error('[DB] generateLicenseKey error:', error.message);
    return null;
  }
}

/**
 * Activates a license key for a specific user
 * @param {string} userId
 * @param {string} key - The license key string
 * @returns {Object} { success, error? }
 */
function activateLicense(userId, key) {
  try {
    // Validate key format: ATIK-XXXX-XXXX-XXXX
    const keyRegex = /^ATIK-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/;
    if (!keyRegex.test(key.toUpperCase())) {
      return { success: false, error: 'Invalid license key format. Expected: ATIK-XXXX-XXXX-XXXX' };
    }

    const normalizedKey = key.toUpperCase();

    // Check if key exists in our database
    const licenseRecord = db.get('licenseKeys').find({ key: normalizedKey }).value();
    if (!licenseRecord) {
      return { success: false, error: 'License key not found.' };
    }

    // Check if key is already activated by another user (skip check for shared/public keys)
    const isSharedKey = licenseRecord.isShared || normalizedKey.includes('FREE') || normalizedKey.includes('DEMO') || normalizedKey.includes('PUBLIC');
    if (!isSharedKey && licenseRecord.isActive && licenseRecord.assignedTo !== userId) {
      return { success: false, error: 'This license key is already in use by another user.' };
    }

    // Check if user exists
    const user = db.get('users').find({ id: userId }).value();
    if (!user) {
      return { success: false, error: 'User not found.' };
    }

    // Calculate expiration date
    let expiresAt = null;
    const duration = licenseRecord.durationDays || 'lifetime';
    if (duration !== 'lifetime') {
      const days = parseInt(duration, 10) || 30;
      const expDate = new Date();
      expDate.setDate(expDate.getDate() + days);
      expiresAt = expDate.toISOString();
    }

    // Activate the license key
    db.get('licenseKeys')
      .find({ key: normalizedKey })
      .assign({
        isActive: true,
        assignedTo: isSharedKey ? 'multiple_users' : userId,
        activatedAt: new Date().toISOString(),
        expiresAt: expiresAt
      })
      .write();

    // Update the user's license status
    db.get('users')
      .find({ id: userId })
      .assign({
        licenseKey: normalizedKey,
        licenseActivated: true,
        isVIP: true,
        licenseExpiresAt: expiresAt
      })
      .write();

    return { success: true };
  } catch (error) {
    console.error('[DB] activateLicense error:', error.message);
    return { success: false, error: 'Failed to activate license key.' };
  }
}

/**
 * Deactivates a license key and removes it from the user
 * @param {string} userIdOrKey - The license key string or user ID
 * @returns {Object} { success, error? }
 */
function deactivateLicense(userIdOrKey) {
  try {
    if (!userIdOrKey) return { success: false, error: 'Key or user ID is required.' };
    
    let licenseRecord;
    if (userIdOrKey.toUpperCase().startsWith('ATIK-')) {
      licenseRecord = db.get('licenseKeys').find({ key: userIdOrKey.toUpperCase() }).value();
    } else {
      licenseRecord = db.get('licenseKeys').find({ assignedTo: userIdOrKey }).value();
    }

    if (!licenseRecord) {
      // If we passed a userId but no key is assigned in licenseKeys, reset user fields anyway
      db.get('users')
        .find({ id: userIdOrKey })
        .assign({
          licenseKey: null,
          licenseActivated: false,
          isVIP: false,
          licenseExpiresAt: null
        })
        .write();
      return { success: true };
    }

    const normalizedKey = licenseRecord.key;
    const assignedUserId = licenseRecord.assignedTo || userIdOrKey;

    // Deactivate the license key record
    db.get('licenseKeys')
      .find({ key: normalizedKey })
      .assign({
        isActive: false,
        assignedTo: null,
        activatedAt: null,
        expiresAt: null
      })
      .write();

    // Remove license from user if assigned
    db.get('users')
      .find({ id: assignedUserId })
      .assign({
        licenseKey: null,
        licenseActivated: false,
        isVIP: false,
        licenseExpiresAt: null
      })
      .write();

    return { success: true };
  } catch (error) {
    console.error('[DB] deactivateLicense error:', error.message);
    return { success: false, error: 'Failed to deactivate license key.' };
  }
}

// ── Trial Functions ──────────────────────────────────────────

/**
 * Returns the number of trial days remaining
 * @returns {number} Days remaining (0 if expired)
 */
function getTrialDaysRemaining() {
  try {
    const settings = db.get('settings').value();

    if (!settings.installDate) {
      // If no install date is set, initialize it now
      setInstallDate();
      return settings.trialDays;
    }

    const installDate = new Date(settings.installDate);
    const now = new Date();
    const diffMs = now.getTime() - installDate.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    const remaining = Math.max(0, settings.trialDays - diffDays);

    return remaining;
  } catch (error) {
    console.error('[DB] getTrialDaysRemaining error:', error.message);
    return 0;
  }
}

/**
 * Checks whether the trial period has expired
 * @returns {boolean} True if trial has expired
 */
function isTrialExpired() {
  return getTrialDaysRemaining() <= 0;
}

/**
 * Sets the installation date to now (only if not already set)
 * @returns {Object} { success, installDate }
 */
function setInstallDate() {
  try {
    const settings = db.get('settings').value();

    if (settings.installDate) {
      return { success: true, installDate: settings.installDate, message: 'Install date already set.' };
    }

    const installDate = new Date().toISOString();
    db.get('settings').assign({ installDate }).write();

    return { success: true, installDate };
  } catch (error) {
    console.error('[DB] setInstallDate error:', error.message);
    return { success: false, error: 'Failed to set install date.' };
  }
}

// ── Meeting Functions ────────────────────────────────────────

/**
 * Creates a new meeting record
 * @param {Object} meetingData - { id, title, hostId, hostName, type? }
 * @returns {Object} { success, meeting?, error? }
 */
function createMeeting({ id, title, hostId, hostName, type = 'instant' }) {
  try {
    if (!id || !hostId) {
      return { success: false, error: 'Meeting ID and host ID are required.' };
    }

    const meeting = {
      id,
      title: title || 'AtikMeet Meeting',
      hostId,
      hostName: hostName || 'Unknown',
      type, // 'instant', 'scheduled'
      createdAt: new Date().toISOString(),
      startedAt: new Date().toISOString(),
      endedAt: null,
      isActive: true,
      participants: [],
      maxParticipants: MAX_PARTICIPANTS,
      screenShareResolution: SCREEN_SHARE_RESOLUTION,
      chatMessages: [],
      recordingPath: null,
      duration: 0,
    };

    db.get('meetings').push(meeting).write();

    return { success: true, meeting };
  } catch (error) {
    console.error('[DB] createMeeting error:', error.message);
    return { success: false, error: 'Failed to create meeting.' };
  }
}

/**
 * Retrieves a meeting by ID
 * @param {string} meetingId
 * @returns {Object|null} Meeting object or null
 */
function getMeeting(meetingId) {
  try {
    return db.get('meetings').find({ id: meetingId }).value() || null;
  } catch (error) {
    console.error('[DB] getMeeting error:', error.message);
    return null;
  }
}

/**
 * Updates a meeting's fields
 * @param {string} meetingId
 * @param {Object} updates
 * @returns {Object} { success, meeting?, error? }
 */
function updateMeeting(meetingId, updates) {
  try {
    const meeting = db.get('meetings').find({ id: meetingId }).value();
    if (!meeting) {
      return { success: false, error: 'Meeting not found.' };
    }

    db.get('meetings').find({ id: meetingId }).assign(updates).write();

    const updatedMeeting = db.get('meetings').find({ id: meetingId }).value();
    return { success: true, meeting: updatedMeeting };
  } catch (error) {
    console.error('[DB] updateMeeting error:', error.message);
    return { success: false, error: 'Failed to update meeting.' };
  }
}

/**
 * Ends a meeting by setting isActive to false and recording end time
 * @param {string} meetingId
 * @returns {Object} { success, meeting?, error? }
 */
function endMeeting(meetingId) {
  try {
    const meeting = db.get('meetings').find({ id: meetingId }).value();
    if (!meeting) {
      return { success: false, error: 'Meeting not found.' };
    }

    const endedAt = new Date().toISOString();
    const startedAt = new Date(meeting.startedAt);
    const durationMs = new Date(endedAt).getTime() - startedAt.getTime();
    const durationSeconds = Math.floor(durationMs / 1000);

    db.get('meetings')
      .find({ id: meetingId })
      .assign({
        isActive: false,
        endedAt,
        duration: durationSeconds,
      })
      .write();

    const updatedMeeting = db.get('meetings').find({ id: meetingId }).value();
    return { success: true, meeting: updatedMeeting };
  } catch (error) {
    console.error('[DB] endMeeting error:', error.message);
    return { success: false, error: 'Failed to end meeting.' };
  }
}

/**
 * Retrieves all meetings, sorted by most recent first
 * @returns {Array} Array of meeting objects
 */
function getAllMeetings() {
  try {
    return db.get('meetings').sortBy('createdAt').reverse().value();
  } catch (error) {
    console.error('[DB] getAllMeetings error:', error.message);
    return [];
  }
}

/**
 * Retrieves all currently active meetings
 * @returns {Array} Array of active meeting objects
 */
function getActiveMeetings() {
  try {
    return db.get('meetings').filter({ isActive: true }).value();
  } catch (error) {
    console.error('[DB] getActiveMeetings error:', error.message);
    return [];
  }
}

/**
 * Retrieves all meetings for a specific user (as host or participant)
 * @param {string} userId
 * @returns {Array} Array of meeting objects
 */
function getUserMeetings(userId) {
  try {
    return db
      .get('meetings')
      .filter((meeting) => {
        return (
          meeting.hostId === userId ||
          (meeting.participants && meeting.participants.some((p) => p.userId === userId))
        );
      })
      .sortBy('createdAt')
      .reverse()
      .value();
  } catch (error) {
    console.error('[DB] getUserMeetings error:', error.message);
    return [];
  }
}

function deleteMeeting(meetingId) {
  try {
    db.get('meetings')
      .remove({ id: meetingId })
      .write();
    return { success: true };
  } catch (error) {
    console.error('[DB] deleteMeeting error:', error.message);
    return { success: false, error: 'Failed to delete meeting.' };
  }
}

// ── Statistics ───────────────────────────────────────────────

/**
 * Returns aggregate stats for the admin dashboard
 * @returns {Object} Stats object
 */
function getStats() {
  try {
    const users = db.get('users').value();
    const meetings = db.get('meetings').value();
    const licenseKeys = db.get('licenseKeys').value();
    const activeMeetings = meetings.filter((m) => m.isActive);
    const activeLicenses = licenseKeys.filter((k) => k.isActive);
    const vipUsers = users.filter((u) => u.isVIP);

    // Calculate total meeting duration in seconds
    const totalDuration = meetings.reduce((sum, m) => sum + (m.duration || 0), 0);

    // Calculate average meeting duration
    const completedMeetings = meetings.filter((m) => !m.isActive && m.duration > 0);
    const avgDuration =
      completedMeetings.length > 0
        ? Math.floor(
            completedMeetings.reduce((sum, m) => sum + m.duration, 0) / completedMeetings.length
          )
        : 0;

    // Get today's meetings
    const today = new Date().toISOString().split('T')[0];
    const todayMeetings = meetings.filter((m) => m.createdAt && m.createdAt.startsWith(today));

    return {
      totalUsers: users.length,
      totalMeetings: meetings.length,
      activeMeetings: activeMeetings.length,
      totalLicenseKeys: licenseKeys.length,
      activeLicenses: activeLicenses.length,
      vipUsers: vipUsers.length,
      totalDuration,
      avgDuration,
      todayMeetings: todayMeetings.length,
      trialDaysRemaining: getTrialDaysRemaining(),
      isTrialExpired: isTrialExpired(),
      maxParticipants: MAX_PARTICIPANTS,
      screenShareResolution: SCREEN_SHARE_RESOLUTION,
    };
  } catch (error) {
    console.error('[DB] getStats error:', error.message);
    return {
      totalUsers: 0,
      totalMeetings: 0,
      activeMeetings: 0,
      totalLicenseKeys: 0,
      activeLicenses: 0,
      vipUsers: 0,
      totalDuration: 0,
      avgDuration: 0,
      todayMeetings: 0,
      trialDaysRemaining: 0,
      isTrialExpired: true,
      maxParticipants: MAX_PARTICIPANTS,
      screenShareResolution: SCREEN_SHARE_RESOLUTION,
    };
  }
}

// ── Module Exports ───────────────────────────────────────────

module.exports = {
  db,
  createUser,
  loginUser,
  getUserById,
  getAllUsers,
  updateUser,
  deleteUser,
  getSettings,
  updateSettings,
  toggleUserBan,
  toggleUserRole,
  generateLicenseKey,
  activateLicense,
  deactivateLicense,
  getTrialDaysRemaining,
  isTrialExpired,
  setInstallDate,
  createMeeting,
  getMeeting,
  updateMeeting,
  endMeeting,
  getAllMeetings,
  getActiveMeetings,
  getUserMeetings,
  deleteMeeting,
  getStats,
};
