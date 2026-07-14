const { app, BrowserWindow, ipcMain, dialog, clipboard, shell, nativeImage } = require('electron');
const path = require('path');
const http = require('http');
const os = require('os');
const fs = require('fs');
const url = require('url');
const helpers = require('./src/utils/helpers');

// ─── Performance Optimization ───
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('disable-software-rasterizer');

let mainWindow = null;
let signalingServer = null;
let currentUser = null;
let db = null;
let isLocalhost = true; // Default admin mode for host

const CENTRAL_SERVER_IP = '192.168.0.101'; // Fallback LAN IP
const SIGNALING_PORT = 3478;
const CENTRAL_SERVER_URL = 'https://atikmeetsoft.onrender.com';

// Detects if the current running PC is the central server host
let isDeveloperPC = false;

// ─── Single Instance Lock ───
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

// ─── Create Main Window ───
function createWindow() {
  const iconPath = path.join(__dirname, 'assets', 'icon.png');

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    frame: false,
    titleBarStyle: 'hidden',
    icon: iconPath,
    backgroundColor: '#0f0f23',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true,
      // Enable WebRTC
      enableWebRTC: true
    }
  });

  // Show window when ready (avoid white flash)
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Set taskbar icon
  try {
    const icon = nativeImage.createFromPath(iconPath);
    mainWindow.setIcon(icon);
  } catch (e) {
    console.log('Icon not found, using default');
  }

  // Load splash screen first
  mainWindow.loadFile(path.join(__dirname, 'src', 'pages', 'splash.html'));

  // Optimize memory usage
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Prevent opening new windows
  mainWindow.webContents.setWindowOpenHandler(() => {
    return { action: 'deny' };
  });
}

// ─── Initialize Database ───
function initDatabase() {
  try {
    db = require('./src/utils/db');
    db.setInstallDate();
    console.log('Database initialized successfully');
  } catch (err) {
    console.error('Database init error:', err);
  }
}

// ─── Start Signaling Server & HTTP Static Web Server ───
function initSignalingServer() {
  try {
    const { startSignalingServer } = require('./src/utils/signaling');
    
    const server = http.createServer((req, res) => {
      const parsedUrl = url.parse(req.url, true);
      let pathname = parsedUrl.pathname;

      // URL decoding to prevent double decoding issues
      pathname = decodeURIComponent(pathname);

      // Handle remote IPC proxy gateway requests
      if (pathname === '/api/ipc' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', async () => {
          try {
            const { channel, args } = JSON.parse(body);
            let result = { success: false, error: 'Invalid IPC channel' };

            if (channel === 'login') {
              const { email, password } = args[0] || {};
              result = db.loginUser(email, password);
            } 
            else if (channel === 'register') {
              const { name, email, password } = args[0] || {};
              result = db.createUser({ name, email, password });
            }
            else if (channel === 'social-login') {
              const provider = args[0];
              result = await handleSocialLoginHelper(provider);
            }
            else if (channel === 'logout') {
              result = { success: true };
            }
            else if (channel === 'get-trial-status') {
              const userId = args[0];
              result = getTrialStatusHelper(userId);
            }
            else if (channel === 'create-meeting') {
              const { hostId, hostName } = args[0] || {};
              const meetingId = helpers.generateMeetingId();
              const createRes = db.createMeeting({ id: meetingId, hostId, hostName });
              if (createRes.success && createRes.meeting) {
                const meetingLink = `${CENTRAL_SERVER_URL}/meeting/${meetingId}`;
                result = { success: true, meeting: createRes.meeting, meetingLink, meetingId };
              } else {
                result = { success: false, error: createRes.error };
              }
            }
            else if (channel === 'join-meeting') {
              const meetingId = args[0];
              let id = meetingId;
              if (meetingId.includes('/meeting/')) {
                id = meetingId.split('/meeting/').pop();
              }
              result = { success: true, meetingId: id };
            }
            else if (channel === 'get-recent-meetings') {
              const userId = args[0];
              const meetings = db.getUserMeetings(userId);
              result = { success: true, meetings };
            }
            else if (channel === 'end-meeting') {
              const meetingId = args[0];
              db.endMeeting(meetingId);
              result = { success: true };
            }
            else if (channel === 'get-meeting-info') {
              const meetingId = args[0];
              const meeting = db.getMeeting(meetingId);
              result = { success: true, meeting };
            }
            else if (channel === 'update-profile') {
              const { userId, data } = args[0] || {};
              db.updateUser(userId, data);
              const fresh = db.getUserById(userId);
              result = { success: true, user: fresh };
            }
            else if (channel === 'activate-license') {
              const { userId, key } = args[0] || {};
              const actRes = db.activateLicense(userId, key);
              result = actRes;
            }
            else if (channel === 'get-signaling-info') {
              result = {
                host: CENTRAL_SERVER_IP,
                port: SIGNALING_PORT,
                url: CENTRAL_SERVER_URL
              };
            }

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(result));
          } catch (err) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: err.message }));
          }
        });
        return;
      }

      // Handle local admin auto-login API for localhost browser fallback
      if (pathname === '/api/auto-login-local-admin') {
        const clientIp = req.socket.remoteAddress || '';
        const isLocalConnection = clientIp === '127.0.0.1' || clientIp === '::1' || clientIp.includes('::ffff:127.0.0.1') || clientIp.includes('localhost');
        
        if (isLocalConnection && db) {
          const admin = db.getAllUsers().find(u => u.isAdmin);
          if (admin) {
            currentUser = admin;
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, user: { name: admin.name, email: admin.email, isAdmin: true } }));
            return;
          }
        }
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Unauthorized origin' }));
        return;
      }

      // Handle meeting join links: /meeting/atikmeet-xxxx-yyyy-zzzz
      if (pathname.startsWith('/meeting/')) {
        const filePath = path.join(__dirname, 'src', 'pages', 'meeting.html');
        
        fs.readFile(filePath, 'utf8', (err, data) => {
          if (err) {
            res.writeHead(500);
            res.end('Error loading meeting room');
            return;
          }
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(data);
        });
        return;
      }

      // Serve static files from root directory of project
      let targetPath = path.join(__dirname, pathname);
      
      // Map web server routes to the /src folder for CSS, JS, and HTML pages
      if (pathname.startsWith('/css/') || pathname.startsWith('/js/') || pathname.startsWith('/pages/')) {
        targetPath = path.join(__dirname, 'src', pathname);
      }
      
      // Fallback index
      if (pathname === '/' || pathname === '') {
        targetPath = path.join(__dirname, 'src', 'pages', 'login.html');
      }

      // Prevent Directory Traversal
      if (!targetPath.startsWith(__dirname)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
      }

      fs.readFile(targetPath, (err, data) => {
        if (err) {
          res.writeHead(404);
          res.end('Not Found');
          return;
        }

        // Detect Content-Type
        let contentType = 'text/plain';
        if (targetPath.endsWith('.html')) contentType = 'text/html';
        else if (targetPath.endsWith('.css')) contentType = 'text/css';
        else if (targetPath.endsWith('.js')) contentType = 'application/javascript';
        else if (targetPath.endsWith('.png')) contentType = 'image/png';
        else if (targetPath.endsWith('.jpg') || targetPath.endsWith('.jpeg')) contentType = 'image/jpeg';
        else if (targetPath.endsWith('.svg')) contentType = 'image/svg+xml';
        else if (targetPath.endsWith('.ico')) contentType = 'image/x-icon';

        res.writeHead(200, { 'Content-Type': contentType });
        res.end(data);
      });
    });

    signalingServer = startSignalingServer(server);
    server.listen(SIGNALING_PORT, () => {
      console.log(`Signaling server & Web Server running on port ${SIGNALING_PORT}`);
    });
  } catch (err) {
    console.error('Signaling server error:', err);
  }
}

// ─── Detect if running on developer's PC (Server Mode) ───
function detectLocalhost() {
  try {
    const interfaces = os.networkInterfaces();
    const localIPs = ['127.0.0.1', '::1', 'localhost'];
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name]) {
        if (iface.family === 'IPv4' && !iface.internal) {
          localIPs.push(iface.address);
        }
      }
    }
    // If our machine's network IP matches the server IP, we are in Server Mode
    isDeveloperPC = localIPs.includes(CENTRAL_SERVER_IP);
    isLocalhost = isDeveloperPC;
  } catch (e) {
    isDeveloperPC = true;
    isLocalhost = true;
  }
  return isDeveloperPC;
}

// ─── App Ready ───
app.whenReady().then(() => {
  detectLocalhost();

  if (isDeveloperPC) {
    initDatabase();
    initSignalingServer();
  }
  
  createWindow();
  
  // Set Display Media Request and Permission Handlers for Electron
  const { session, desktopCapturer } = require('electron');
  
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    // Automatically approve all permissions inside the Electron desktop app
    callback(true);
  });

  session.defaultSession.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => {
    // Automatically grant permission check requests
    return true;
  });

  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    desktopCapturer.getSources({ types: ['screen'] }).then(sources => {
      if (sources.length > 0) {
        // Automatically selects the primary desktop screen and handles loopback audio
        callback({ video: sources[0], audio: 'loopback' });
      } else {
        callback({ error: 'No screen sources found' });
      }
    }).catch(err => {
      console.error('[Electron] DisplayMedia request failed:', err.message);
      callback({ error: err.message });
    });
  });

  // If localhost (admin), auto-create admin account
  if (isLocalhost && db) {
    try {
      const adminExists = db.getAllUsers().find(u => u.isAdmin);
      if (!adminExists) {
        const result = db.createUser({ 
          name: 'Atik Shahriar', 
          email: 'admin@atikmeet.com', 
          password: 'admin123' 
        });
        if (result.success && result.user) {
          db.updateUser(result.user.id, { 
            isAdmin: true, 
            isVIP: true, 
            licenseActivated: true,
            licenseKey: 'ATIK-ADMIN-VIP-2026'
          });
          console.log('Admin account created with key ATIK-ADMIN-VIP-2026');
        }
      } else {
        // Ensure existing admin has license key assigned and VIP status
        if (!adminExists.licenseKey || !adminExists.isVIP) {
          db.updateUser(adminExists.id, {
            licenseKey: 'ATIK-ADMIN-VIP-2026',
            licenseActivated: true,
            isVIP: true
          });
          console.log('Updated existing admin user key and VIP stats');
        }
      }
    } catch (e) {
      console.log('Admin setup:', e.message);
    }
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// ─── Client-Server Helper Functions ───

async function forwardToCentralServer(channel, arg) {
  try {
    const response = await fetch(`${CENTRAL_SERVER_URL}/api/ipc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel, args: [arg] }),
      signal: AbortSignal.timeout(5000)
    });
    return await response.json();
  } catch (err) {
    console.error(`[IPC Proxy] Failed to forward ${channel}:`, err.message);
    return { success: false, error: 'Could not connect to central meeting server. Make sure the host is online.' };
  }
}

function getTrialStatusHelper(userId) {
  try {
    const daysRemaining = db.getTrialDaysRemaining();
    const isExpired = db.isTrialExpired();
    
    let isActivated = false;
    let isVIP = false;
    let isBanned = false;
    
    if (userId) {
      const user = db.getUserById(userId);
      if (user) {
        // Dynamic license expiry check
        if (user.licenseActivated && user.licenseExpiresAt) {
          const expiry = new Date(user.licenseExpiresAt);
          if (expiry < new Date()) {
            db.deactivateLicense(userId);
          }
        }
        
        const freshUser = db.getUserById(userId);
        isActivated = freshUser.licenseActivated;
        isVIP = freshUser.isVIP;
        isBanned = !!freshUser.isBanned;
      }
    }
    
    const settings = db.getSettings();
    const isMaintenance = (settings && settings.maintenanceMode && userId && !db.getUserById(userId)?.isAdmin);
    
    return {
      success: true,
      daysRemaining,
      isExpired: isExpired || isBanned || isMaintenance,
      isActivated,
      isVIP,
      isBanned,
      isMaintenance
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function handleSocialLoginHelper(provider) {
  try {
    const providerUpper = provider.charAt(0).toUpperCase() + provider.slice(1);
    const mockEmail = `atik.${provider}@atikmeet.com`;
    const mockName = `Atik ${providerUpper}`;
    
    let user = db.db.get('users').find({ email: mockEmail }).value();
    if (!user) {
      const result = db.createUser({
        name: mockName,
        email: mockEmail,
        password: 'sociallogin123'
      });
      if (result.success && result.user) {
        user = db.db.get('users').find({ email: mockEmail }).value();
      } else {
        return { success: false, error: result.error || 'Failed to create social account' };
      }
    }
    
    if (user.isBanned) {
      return { success: false, error: 'Your account has been banned by the administrator.' };
    }

    const settings = db.getSettings();
    if (settings && settings.maintenanceMode && !user.isAdmin) {
      return { success: false, error: 'The system is currently under maintenance. Please try again later.' };
    }

    return { success: true, user: { ...user, password: undefined } };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ═══════════════════════════════════════════
// ─── IPC HANDLERS (Main Process API) ───
// ═══════════════════════════════════════════

// ─── Window Controls ───
ipcMain.handle('window-minimize', () => {
  if (mainWindow) mainWindow.minimize();
});

ipcMain.handle('window-maximize', () => {
  if (mainWindow) {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  }
  return mainWindow ? mainWindow.isMaximized() : false;
});

ipcMain.handle('window-close', () => {
  if (mainWindow) mainWindow.close();
});

ipcMain.handle('window-is-maximized', () => {
  return mainWindow ? mainWindow.isMaximized() : false;
});

// ─── Navigation ───
ipcMain.handle('navigate', (event, page) => {
  if (mainWindow) {
    let pageName = page;
    let query = {};
    
    if (page.includes('?')) {
      const parts = page.split('?');
      pageName = parts[0];
      const params = new URLSearchParams(parts[1]);
      for (const [key, val] of params.entries()) {
        query[key] = val;
      }
    }
    
    if (isDeveloperPC) {
      const pagePath = path.join(__dirname, 'src', 'pages', `${pageName}.html`);
      mainWindow.loadFile(pagePath, { query });
    } else {
      const queryString = page.includes('?') ? page.split('?')[1] : '';
      const remoteUrl = `${CENTRAL_SERVER_URL}/pages/${pageName}.html${queryString ? '?' + queryString : ''}`;
      mainWindow.loadURL(remoteUrl);
    }
  }
});

// ─── Authentication ───
ipcMain.handle('login', async (event, { email, password }) => {
  if (isDeveloperPC) {
    try {
      const user = db.loginUser(email, password);
      if (user) {
        currentUser = user;
        return { success: true, user: { ...user, password: undefined } };
      }
      return { success: false, error: 'Invalid email or password' };
    } catch (err) {
      return { success: false, error: err.message };
    }
  } else {
    const res = await forwardToCentralServer('login', { email, password });
    if (res.success && res.user) {
      currentUser = res.user;
    }
    return res;
  }
});

ipcMain.handle('register', async (event, { name, email, password }) => {
  if (isDeveloperPC) {
    try {
      const result = db.createUser({ name, email, password });
      if (result.success && result.user) {
        currentUser = result.user;
        return { success: true, user: result.user };
      }
      return { success: false, error: result.error || 'Registration failed' };
    } catch (err) {
      return { success: false, error: err.message };
    }
  } else {
    const res = await forwardToCentralServer('register', { name, email, password });
    if (res.success && res.user) {
      currentUser = res.user;
    }
    return res;
  }
});

ipcMain.handle('social-login', async (event, provider) => {
  if (isDeveloperPC) {
    const res = await handleSocialLoginHelper(provider);
    if (res.success && res.user) {
      currentUser = res.user;
    }
    return res;
  } else {
    const res = await forwardToCentralServer('social-login', provider);
    if (res.success && res.user) {
      currentUser = res.user;
    }
    return res;
  }
});

ipcMain.handle('logout', async () => {
  currentUser = null;
  if (mainWindow) {
    if (isDeveloperPC) {
      mainWindow.loadFile(path.join(__dirname, 'src', 'pages', 'login.html'));
    } else {
      mainWindow.loadURL(`${CENTRAL_SERVER_URL}/pages/login.html`);
    }
  }
  return { success: true };
});

ipcMain.handle('get-current-user', () => {
  if (currentUser) {
    return { success: true, user: currentUser };
  }
  return { success: false, error: 'Not logged in' };
});

ipcMain.handle('is-localhost', () => {
  const fs = require('fs');
  const isDevPC = fs.existsSync('e:\\google meet\\main.js');
  return isLocalhost || isDevPC;
});

ipcMain.handle('auto-login-admin', async () => {
  const fs = require('fs');
  const isDevPC = fs.existsSync('e:\\google meet\\main.js');
  if (isDevPC) {
    try {
      console.log('Developer PC detected. Auto-logging in to Render Central Server...');
      const res = await forwardToCentralServer('login', { email: 'admin@atikmeet.com', password: 'admin123' });
      if (res.success && res.user) {
        currentUser = res.user;
        return { success: true, user: res.user };
      }
    } catch (err) {
      console.error('Auto-login to Central Server failed:', err.message);
    }
  }
  
  if (isLocalhost && db) {
    const admin = db.getAllUsers().find(u => u.isAdmin);
    if (admin) {
      currentUser = admin;
      return { success: true, user: { ...admin, password: undefined } };
    }
  }
  return { success: false };
});

// ─── Profile ───
ipcMain.handle('update-profile', async (event, data) => {
  if (isDeveloperPC) {
    try {
      if (currentUser) {
        db.updateUser(currentUser.id, data);
        currentUser = db.getUserById(currentUser.id);
        return { success: true, user: { ...currentUser, password: undefined } };
      }
      return { success: false, error: 'Not logged in' };
    } catch (err) {
      return { success: false, error: err.message };
    }
  } else {
    if (currentUser) {
      const res = await forwardToCentralServer('update-profile', { userId: currentUser.id, data });
      if (res.success && res.user) {
        currentUser = res.user;
      }
      return res;
    }
    return { success: false, error: 'Not logged in' };
  }
});

// ─── License ───
ipcMain.handle('get-trial-status', async () => {
  if (isDeveloperPC) {
    return getTrialStatusHelper(currentUser ? currentUser.id : null);
  } else {
    const userId = currentUser ? currentUser.id : null;
    return await forwardToCentralServer('get-trial-status', userId);
  }
});

ipcMain.handle('activate-license', async (event, key) => {
  if (isDeveloperPC) {
    try {
      if (currentUser) {
        const result = db.activateLicense(currentUser.id, key);
        if (result.success) {
          currentUser = db.getUserById(currentUser.id);
          return { success: true, message: 'License activated successfully!' };
        }
        return { success: false, error: result.error || 'Invalid license key' };
      }
      return { success: false, error: 'Not logged in' };
    } catch (err) {
      return { success: false, error: err.message };
    }
  } else {
    if (currentUser) {
      return await forwardToCentralServer('activate-license', { userId: currentUser.id, key });
    }
    return { success: false, error: 'Not logged in' };
  }
});

// ─── Meetings ───
ipcMain.handle('create-meeting', async () => {
  if (isDeveloperPC) {
    try {
      if (currentUser) {
        const meetingId = helpers.generateMeetingId();
        const result = db.createMeeting({
          id: meetingId,
          hostId: currentUser.id,
          hostName: currentUser.name
        });
        if (result.success && result.meeting) {
          const localIP = getLocalIP();
          const meetingLink = `http://${localIP}:${SIGNALING_PORT}/meeting/${meetingId}`;
          return { success: true, meeting: result.meeting, meetingLink, meetingId };
        }
        return { success: false, error: result.error || 'Failed to create meeting' };
      }
      return { success: false, error: 'Not logged in' };
    } catch (err) {
      return { success: false, error: err.message };
    }
  } else {
    if (currentUser) {
      return await forwardToCentralServer('create-meeting', { hostId: currentUser.id, hostName: currentUser.name });
    }
    return { success: false, error: 'Not logged in' };
  }
});

ipcMain.handle('join-meeting', async (event, meetingId) => {
  if (isDeveloperPC) {
    try {
      let id = meetingId;
      if (meetingId.includes('/meeting/')) {
        id = meetingId.split('/meeting/').pop();
      }
      return { success: true, meetingId: id };
    } catch (err) {
      return { success: false, error: err.message };
    }
  } else {
    return await forwardToCentralServer('join-meeting', meetingId);
  }
});

ipcMain.handle('get-recent-meetings', async () => {
  if (isDeveloperPC) {
    try {
      if (currentUser) {
        const meetings = db.getUserMeetings(currentUser.id);
        return { success: true, meetings };
      }
      return { success: true, meetings: [] };
    } catch (err) {
      return { success: false, error: err.message };
    }
  } else {
    const userId = currentUser ? currentUser.id : null;
    return await forwardToCentralServer('get-recent-meetings', userId);
  }
});

ipcMain.handle('end-meeting', async (event, meetingId) => {
  if (isDeveloperPC) {
    try {
      db.endMeeting(meetingId);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  } else {
    return await forwardToCentralServer('end-meeting', meetingId);
  }
});

ipcMain.handle('get-meeting-info', async (event, meetingId) => {
  if (isDeveloperPC) {
    try {
      const meeting = db.getMeeting(meetingId);
      return { success: true, meeting };
    } catch (err) {
      return { success: false, error: err.message };
    }
  } else {
    return await forwardToCentralServer('get-meeting-info', meetingId);
  }
});

// ─── Admin ───
ipcMain.handle('get-admin-stats', () => {
  try {
    if (currentUser && currentUser.isAdmin) {
      const stats = db.getStats();
      return { success: true, stats };
    }
    return { success: false, error: 'Not authorized' };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('get-all-users', () => {
  try {
    if (currentUser && currentUser.isAdmin) {
      const users = db.getAllUsers();
      return { success: true, users };
    }
    return { success: false, error: 'Not authorized' };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('admin-activate-license', (event, { userId, durationDays }) => {
  try {
    if (currentUser && currentUser.isAdmin) {
      const key = db.generateLicenseKey(durationDays || 'lifetime');
      const res = db.activateLicense(userId, key);
      if (res.success) {
        return { success: true, key };
      }
      return { success: false, error: res.error || 'Activation failed' };
    }
    return { success: false, error: 'Not authorized' };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('admin-deactivate-license', (event, userId) => {
  try {
    if (currentUser && currentUser.isAdmin) {
      const res = db.deactivateLicense(userId);
      if (res.success) {
        return { success: true };
      }
      return { success: false, error: res.error || 'Deactivation failed' };
    }
    return { success: false, error: 'Not authorized' };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('admin-delete-user', (event, userId) => {
  try {
    if (currentUser && currentUser.isAdmin) {
      const res = db.deleteUser(userId);
      if (res.success) {
        return { success: true };
      }
      return { success: false, error: res.error || 'Deletion failed' };
    }
    return { success: false, error: 'Not authorized' };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('generate-license-key', (event, durationDays) => {
  try {
    if (currentUser && currentUser.isAdmin) {
      const key = db.generateLicenseKey(durationDays || 'lifetime');
      return { success: true, key };
    }
    return { success: false, error: 'Not authorized' };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('get-active-meetings', () => {
  try {
    if (currentUser && currentUser.isAdmin) {
      const meetings = db.getActiveMeetings();
      return { success: true, meetings };
    }
    return { success: false, error: 'Not authorized' };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('get-system-settings', () => {
  try {
    if (currentUser && currentUser.isAdmin) {
      const settings = db.getSettings();
      return { success: true, settings };
    }
    return { success: false, error: 'Not authorized' };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('update-system-settings', (event, updates) => {
  try {
    if (currentUser && currentUser.isAdmin) {
      const res = db.updateSettings(updates);
      return res;
    }
    return { success: false, error: 'Not authorized' };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('admin-toggle-ban', (event, { userId, isBanned }) => {
  try {
    if (currentUser && currentUser.isAdmin) {
      const res = db.toggleUserBan(userId, isBanned);
      return res;
    }
    return { success: false, error: 'Not authorized' };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('admin-toggle-role', (event, { userId, isAdmin }) => {
  try {
    if (currentUser && currentUser.isAdmin) {
      const res = db.toggleUserRole(userId, isAdmin);
      return res;
    }
    return { success: false, error: 'Not authorized' };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('export-license-keys', async () => {
  try {
    if (currentUser && currentUser.isAdmin) {
      const { dialog } = require('electron');
      const keysList = db.db.get('licenseKeys').filter({ isActive: false, assignedTo: null }).value();
      if (keysList.length === 0) {
        return { success: false, error: 'No unused license keys available to export.' };
      }
      
      const fileContent = keysList.map(k => k.key).join('\r\n');
      
      const { filePath } = await dialog.showSaveDialog(mainWindow, {
        title: 'Export Unused License Keys',
        defaultPath: path.join(app.getPath('downloads'), 'AtikMeet_Unused_Keys.txt'),
        filters: [{ name: 'Text Files', extensions: ['txt'] }]
      });
      
      if (filePath) {
        fs.writeFileSync(filePath, fileContent, 'utf-8');
        return { success: true, count: keysList.length };
      }
      return { success: false, error: 'Export cancelled' };
    }
    return { success: false, error: 'Not authorized' };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ─── Clipboard ───
ipcMain.handle('copy-to-clipboard', (event, text) => {
  clipboard.writeText(text);
  return { success: true };
});

// ─── Open in Browser ───
ipcMain.handle('open-in-browser', (event, url) => {
  shell.openExternal(url);
  return { success: true };
});

// ─── Save Recording ───
ipcMain.handle('save-recording', async (event, buffer) => {
  try {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Save Meeting Recording',
      defaultPath: `AtikMeet_Recording_${new Date().toISOString().slice(0, 10)}.webm`,
      filters: [
        { name: 'Video Files', extensions: ['webm'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    });

    if (!result.canceled && result.filePath) {
      const fs = require('fs');
      fs.writeFileSync(result.filePath, Buffer.from(buffer));
      return { success: true, filePath: result.filePath };
    }
    return { success: false, error: 'Save cancelled' };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ─── Get Signaling Server Info ───
ipcMain.handle('get-signaling-info', () => {
  const localIP = getLocalIP();
  return {
    host: localIP,
    port: SIGNALING_PORT,
    url: `http://${localIP}:${SIGNALING_PORT}`
  };
});

// ─── Get Local IP ───
function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return '127.0.0.1';
}

// ─── System Info ───
ipcMain.handle('get-system-info', () => {
  return {
    platform: os.platform(),
    arch: os.arch(),
    totalMemory: os.totalmem(),
    freeMemory: os.freemem(),
    cpus: os.cpus().length,
    hostname: os.hostname()
  };
});

// ─── App Info ───
ipcMain.handle('get-app-info', () => {
  return {
    name: 'AtikMeet',
    version: '1.0.0',
    developer: 'Atik Shahriar',
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node
  };
});
