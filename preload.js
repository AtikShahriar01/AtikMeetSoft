const { contextBridge, ipcRenderer } = require('electron');

// ═══════════════════════════════════════════
// Secure API exposed to renderer process
// ═══════════════════════════════════════════
contextBridge.exposeInMainWorld('electronAPI', {
  // ─── Window Controls ───
  minimize: () => ipcRenderer.invoke('window-minimize'),
  maximize: () => ipcRenderer.invoke('window-maximize'),
  close: () => ipcRenderer.invoke('window-close'),
  isMaximized: () => ipcRenderer.invoke('window-is-maximized'),

  // ─── Navigation ───
  navigate: (page) => ipcRenderer.invoke('navigate', page),

  // ─── Authentication ───
  login: (credentials) => ipcRenderer.invoke('login', credentials),
  register: (data) => ipcRenderer.invoke('register', data),
  socialLogin: (provider) => ipcRenderer.invoke('social-login', provider),
  googleLoginComplete: (data) => ipcRenderer.invoke('google-login-complete', data),
  logout: () => ipcRenderer.invoke('logout'),
  getCurrentUser: () => ipcRenderer.invoke('get-current-user'),
  isLocalhost: () => ipcRenderer.invoke('is-localhost'),
  autoLoginAdmin: () => ipcRenderer.invoke('auto-login-admin'),

  // ─── Profile ───
  updateProfile: (data) => ipcRenderer.invoke('update-profile', data),

  // ─── License ───
  getTrialStatus: () => ipcRenderer.invoke('get-trial-status'),
  activateLicense: (key) => ipcRenderer.invoke('activate-license', key),

  // ─── Meetings ───
  createMeeting: () => ipcRenderer.invoke('create-meeting'),
  joinMeeting: (meetingId) => ipcRenderer.invoke('join-meeting', meetingId),
  getRecentMeetings: () => ipcRenderer.invoke('get-recent-meetings'),
  endMeeting: (meetingId) => ipcRenderer.invoke('end-meeting', meetingId),
  getMeetingInfo: (meetingId) => ipcRenderer.invoke('get-meeting-info', meetingId),

  // ─── Admin ───
  getAdminStats: () => ipcRenderer.invoke('get-admin-stats'),
  getAllUsers: () => ipcRenderer.invoke('get-all-users'),
  adminActivateLicense: (userId, durationDays) => ipcRenderer.invoke('admin-activate-license', { userId, durationDays }),
  adminDeactivateLicense: (userId) => ipcRenderer.invoke('admin-deactivate-license', userId),
  adminDeleteUser: (userId) => ipcRenderer.invoke('admin-delete-user', userId),
  generateLicenseKey: (durationDays) => ipcRenderer.invoke('generate-license-key', durationDays),
  getActiveMeetings: () => ipcRenderer.invoke('get-active-meetings'),
  getSystemSettings: () => ipcRenderer.invoke('get-system-settings'),
  updateSystemSettings: (updates) => ipcRenderer.invoke('update-system-settings', updates),
  toggleUserBan: (userId, isBanned) => ipcRenderer.invoke('admin-toggle-ban', { userId, isBanned }),
  toggleUserRole: (userId, isAdmin) => ipcRenderer.invoke('admin-toggle-role', { userId, isAdmin }),
  exportLicenseKeys: () => ipcRenderer.invoke('export-license-keys'),

  // ─── Clipboard ───
  copyToClipboard: (text) => ipcRenderer.invoke('copy-to-clipboard', text),

  // ─── Browser ───
  openInBrowser: (url) => ipcRenderer.invoke('open-in-browser', url),

  // ─── Recording ───
  saveRecording: (buffer) => ipcRenderer.invoke('save-recording', buffer),

  // ─── Signaling ───
  getSignalingInfo: () => ipcRenderer.invoke('get-signaling-info'),

  // ─── System ───
  getSystemInfo: () => ipcRenderer.invoke('get-system-info'),
  getAppInfo: () => ipcRenderer.invoke('get-app-info'),

  // ─── Auto-Update ───
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  startUpdate: () => ipcRenderer.invoke('start-update'),
  onUpdateProgress: (callback) => ipcRenderer.on('update-progress', callback),
  onUpdateCompleted: (callback) => ipcRenderer.on('update-completed', callback),
  onUpdateError: (callback) => ipcRenderer.on('update-error', callback)
});
