const { app, BrowserWindow, ipcMain, dialog, clipboard, shell, nativeImage } = require('electron');
const path = require('path');
const http = require('http');
const os = require('os');
const fs = require('fs');
const url = require('url');
const helpers = require('./src/utils/helpers');

// ─── Squirrel Windows Installer Event Handler ───
// Prevents app window from launching twice during setup / updates
function handleSquirrelEvents() {
  if (process.argv.length === 1) return false;

  const ChildProcess = require('child_process');
  const appFolder = path.resolve(process.execPath, '..');
  const rootAtomFolder = path.resolve(appFolder, '..');
  const updateDotExe = path.resolve(path.join(rootAtomFolder, 'Update.exe'));
  const exeName = path.basename(process.execPath);

  const spawn = function(command, args) {
    let spawnedProcess;
    try {
      spawnedProcess = ChildProcess.spawn(command, args, { detached: true });
    } catch (error) {}
    return spawnedProcess;
  };

  const spawnUpdate = function(args) {
    return spawn(updateDotExe, args);
  };

  const squirrelEvent = process.argv[1];
  switch (squirrelEvent) {
    case '--squirrel-install':
    case '--squirrel-updated':
      spawnUpdate(['--createShortcut', exeName]);
      setTimeout(() => { app.quit(); }, 1000);
      return true;

    case '--squirrel-uninstall':
      spawnUpdate(['--removeShortcut', exeName]);
      setTimeout(() => { app.quit(); }, 1000);
      return true;

    case '--squirrel-obsolete':
      app.quit();
      return true;
  }
  return false;
}

if (handleSquirrelEvents()) {
  return;
}

// ─── Performance Optimization ───
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('disable-software-rasterizer');

let mainWindow = null;
let currentUser = null;
let db = null;
let isLocalhost = true; // Default admin mode for host

// FIX 1: Signaling Server কে গ্লোবাল ভেরিয়েবল হিসেবে ডিক্লেয়ার করা হয়েছে
let signalingServer = null;

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

// ─── Create Main Window ──
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

// ─── Initialize Database ──
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
    // FIX 2: 'const server' এর বদলে গ্লোবাল 'signalingServer' ব্যবহার করা হয়েছে
    signalingServer = http.createServer(async (req, res) => {
      const parsedUrl = url.parse(req.url, true);
      let pathname = parsedUrl.pathname;

      // URL decoding to prevent double decoding issues
      pathname = decodeURIComponent(pathname);

      // Handle social login callback from external browser
      if (pathname === '/api/social-login-complete') {
        const provider = parsedUrl.query.provider;
        const email = parsedUrl.query.email;
        const name = parsedUrl.query.name;

        console.log('[DEBUG] Server social-login-complete callback:', { provider, email, name });

        const resObj = await handleSocialLoginHelper(provider, email, name);
        if (resObj.success && resObj.user) {
          currentUser = resObj.user;
          if (mainWindow) {
            mainWindow.webContents.send('social-login-success');
          }
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(resObj));
        return;
      }

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
              result = await db.loginUser(email, password);
            }
            else if (channel === 'register') {
              const { name, email, password } = args[0] || {};
              result = await db.createUser({ name, email, password });
            }
            else if (channel === 'social-login') {
              const data = args[0];
              if (data && typeof data === 'object') {
                result = await handleSocialLoginHelper(data.provider, data.email, data.name);
              } else {
                result = await handleSocialLoginHelper(data);
              }
            }
            else if (channel === 'logout') {
              result = { success: true };
            }
            else if (channel === 'get-trial-status') {
              const userId = args[0];
              result = await getTrialStatusHelper(userId);
            }
            else if (channel === 'create-meeting') {
              const { hostId, hostName } = args[0] || {};
              const meetingId = helpers.generateMeetingId();
              const createRes = await db.createMeeting({ id: meetingId, hostId, hostName });
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
              const meetings = await db.getUserMeetings(userId);
              result = { success: true, meetings };
            }
            else if (channel === 'end-meeting') {
              const meetingId = args[0];
              await db.endMeeting(meetingId);
              result = { success: true };
            }
            else if (channel === 'delete-meeting') {
              const meetingId = args[0];
              result = await db.deleteMeeting(meetingId);
            }
            else if (channel === 'get-meeting-info') {
              const meetingId = args[0];
              const meeting = await db.getMeeting(meetingId);
              result = { success: true, meeting };
            }
            else if (channel === 'update-profile') {
              const { userId, data } = args[0] || {};
              await db.updateUser(userId, data);
              const fresh = await db.getUserById(userId);
              result = { success: true, user: fresh };
            }
            else if (channel === 'activate-license') {
              const { userId, key } = args[0] || {};
              const actRes = await db.activateLicense(userId, key);
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
          const admin = (await db.getAllUsers()).find(u => u.isAdmin);
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

    signalingServer.listen(SIGNALING_PORT, () => {
      console.log(`HTTP Static Web Server running on port ${SIGNALING_PORT}`);
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
app.whenReady().then(async () => {
  detectLocalhost();

  initDatabase();
  initSignalingServer();

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
      const adminExists = (await db.getAllUsers()).find(u => u.isAdmin);
      if (!adminExists) {
        const result = await db.createUser({
          name: 'Atik Shahriar',
          email: 'admin@atikmeet.com',
          password: 'atikadmin2026'
        });
        if (result.success && result.user) {
          await db.updateUser(result.user.email, {
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
          await db.updateUser(adminExists.email, {
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

// FIX 3: Graceful Shutdown লজিক যোগ করা হয়েছে
app.on('before-quit', async (event) => {
  // 1. Signaling Server বন্ধ করা
  if (signalingServer) {
    await new Promise((resolve) => {
      signalingServer.close(() => {
        console.log('Signaling server closed.');
        resolve();
      });
      // 5 সেকেন্ডের মধ্যে বন্ধ না হলে জোরপূর্বক বন্ধ
      setTimeout(resolve, 5000);
    });
  }

  // 2. সব সিগন্যালিং লিসেনার বন্ধ করা (Firestore)
  if (typeof signalUnsubscribeMap !== 'undefined') {
    signalUnsubscribeMap.forEach((unsubscribe) => {
      if (typeof unsubscribe === 'function') unsubscribe();
    });
    signalUnsubscribeMap.clear();
  }

  // 3. উইন্ডো ধ্বংস করা
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.destroy();
  }

  console.log('App shutting down gracefully...');
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// ── Client-Server Helper Functions ───

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

async function getTrialStatusHelper(userId) {
  try {
    const daysRemaining = await db.getTrialDaysRemaining();
    const isExpired = await db.isTrialExpired();

    let isActivated = false;
    let isVIP = false;
    let isBanned = false;
    let pendingKey = null;

    if (userId) {
      const user = await db.getUserById(userId);
      if (user) {
        // Dynamic license expiry check
        if (user.licenseKey && user.licenseExpiry && user.licenseExpiry !== 'lifetime') {
          const expiry = new Date(user.licenseExpiry);
          if (expiry < new Date()) {
            await db.deactivateLicense(userId);
          }
        }

        const freshUser = await db.getUserById(userId);
        isActivated = !!freshUser.licenseKey || freshUser.isVIP;
        isVIP = freshUser.isVIP;
        isBanned = !!freshUser.isBanned;
        pendingKey = freshUser.pendingKey || null;
      }
    }

    const settings = await db.getSettings();
    const isMaintenance = (settings && settings.maintenanceMode && userId && !(await db.getUserById(userId))?.isAdmin);

    return {
      success: true,
      daysRemaining,
      isExpired: isExpired || isBanned || isMaintenance,
      isActivated,
      isVIP,
      isBanned,
      isMaintenance,
      pendingKey
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function handleSocialLoginHelper(provider, email, name) {
  console.log('[DEBUG] handleSocialLoginHelper called:', { provider, email, name });
  try {
    if (!db) {
      initDatabase();
    }
    if (!db) {
      return { success: false, error: 'Database service is unavailable. Please check your network connection and restart the app.' };
    }

    const providerUpper = provider ? (provider.charAt(0).toUpperCase() + provider.slice(1)) : 'User';
    const targetEmail = email ? email.toLowerCase().trim() : `user.${Date.now()}@atikmeet.com`;
    const targetName = name ? name.trim() : (targetEmail.split('@')[0]);

    let user = await db.getUserById(targetEmail);
    if (!user) {
      // Note: bcrypt is used here but not imported at top. Assuming it's available globally or via db/utils
      const bcrypt = require('bcryptjs');
      const hashedPassword = bcrypt.hashSync('sociallogin123', 10);
      const newUser = {
        id: targetEmail,
        name: targetName,
        email: targetEmail,
        password: hashedPassword,
        role: 'user',
        isAdmin: false,
        isVIP: false,
        licenseKey: null,
        licenseExpiry: null,
        pendingKey: null,
        createdAt: new Date().toISOString(),
        isBanned: false
      };

      const { doc, setDoc } = require('firebase/firestore');
      const docRef = doc(db.firestoreDb, 'users', targetEmail);
      await setDoc(docRef, newUser);
      user = newUser;
    } else if (name && user.name !== targetName) {
      await db.updateUser(user.email || user.id, { name: targetName });
      user = await db.getUserById(targetEmail);
    }

    if (user.isBanned) {
      return { success: false, error: 'Your account has been banned by the administrator.' };
    }

    const settings = await db.getSettings();
    if (settings && settings.maintenanceMode && !user.isAdmin) {
      return { success: false, error: 'The system is currently under maintenance. Please try again later.' };
    }

    return { success: true, user: { ...user, password: undefined } };
  } catch (err) {
    console.error('handleSocialLoginHelper error:', err);
    return { success: false, error: err.message };
  }
}

// ═══════════════════════════════════════════
// ─── IPC HANDLERS (Main Process API) ───
// ═══════════════════════════════════════════

// ─── Window Controls ──
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

    const pagePath = path.join(__dirname, 'src', 'pages', `${pageName}.html`);
    mainWindow.loadFile(pagePath, { query });
  }
});

ipcMain.handle('login', async (event, { email, password }) => {
  try {
    if (!db) {
      initDatabase();
    }
    if (!db) {
      return { success: false, error: 'Database service is unavailable. Please check your network connection and restart the app.' };
    }
    const loginResult = await db.loginUser(email, password);
    if (loginResult && loginResult.success) {
      currentUser = loginResult.user;
      return { success: true, user: loginResult.user };
    }
    return { success: false, error: loginResult ? loginResult.error : 'Invalid email or password' };
  } catch (err) {
    console.error('[Main] login error:', err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('register', async (event, { name, email, password }) => {
  try {
    if (!db) {
      initDatabase();
    }
    if (!db) {
      return { success: false, error: 'Database service is unavailable. Please check your network connection and restart the app.' };
    }
    const result = await db.createUser({ name, email, password });
    if (result.success && result.user) {
      currentUser = result.user;
      return { success: true, user: result.user };
    }
    return { success: false, error: result.error || 'Registration failed' };
  } catch (err) {
    console.error('[Main] register error:', err);
    return { success: false, error: err.message };
  }
});

let googleWin = null;
let googleAuthResolve = null;

ipcMain.handle('google-login-complete', async (event, data) => {
  console.log('[DEBUG] google-login-complete received in main:', data);
  if (googleAuthResolve) {
    googleAuthResolve(data);
    googleAuthResolve = null;
  }
  if (googleWin) {
    googleWin.close();
  }
  return { success: true };
});

ipcMain.handle('social-login', async (event, provider) => {
  console.log('[DEBUG] social-login handler called for provider:', provider);
  const targetUrl = `http://localhost:${SIGNALING_PORT}/pages/google-login.html?provider=${provider}`;
  shell.openExternal(targetUrl);
  return { success: true };
});

ipcMain.handle('logout', async () => {
  currentUser = null;
  if (mainWindow) {
    mainWindow.loadFile(path.join(__dirname, 'src', 'pages', 'login.html'));
  }
  return { success: true };
});

ipcMain.handle('get-current-user', async () => {
  if (currentUser) {
    try {
      const freshUser = await db.getUserById(currentUser.id);
      if (freshUser) {
        currentUser = freshUser;
      }
    } catch (e) {
      console.warn('Failed to refresh current user from DB:', e.message);
    }
    return { success: true, user: currentUser };
  }
  return { success: false, error: 'Not logged in' };
});

ipcMain.handle('is-localhost', () => {
  // Packaged app binaries for clients must NEVER auto-login as admin
  if (app.isPackaged) return false;
  return !!process.env.ATIKMEET_DEV;
});

ipcMain.handle('auto-login-admin', async () => {
  // Never auto-login admin in packaged installer builds for clients
  if (app.isPackaged || !process.env.ATIKMEET_DEV) {
    return { success: false, error: 'Auto login disabled in production build' };
  }

  if (db) {
    try {
      const users = await db.getAllUsers();
      const admin = users.find(u => u.isAdmin);
      if (admin) {
        currentUser = admin;
        console.log('[DEBUG] Developer PC auto-logged in as admin:', currentUser.email);
        return { success: true, user: { ...admin, password: undefined } };
      }
    } catch (err) {
      console.error('[DEBUG] auto-login-admin error:', err.message);
    }
  }
  return { success: false, error: 'Auto login failed' };
});

// ─── Profile ───
ipcMain.handle('update-profile', async (event, data) => {
  try {
    if (currentUser) {
      await db.updateUser(currentUser.email || currentUser.id, data);
      currentUser = await db.getUserById(currentUser.email || currentUser.id);
      return { success: true, user: { ...currentUser, password: undefined } };
    }
    return { success: false, error: 'Not logged in' };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ─── Avatar Upload/Download ───
const avatarDir = path.join(__dirname, 'data', 'avatars');
if (!fs.existsSync(avatarDir)) {
  fs.mkdirSync(avatarDir, { recursive: true });
}

ipcMain.handle('upload-avatar', async (event, { dataUrl }) => {
  try {
    if (!currentUser) return { success: false, error: 'Not logged in' };
    const filePath = path.join(avatarDir, `${currentUser.id}.txt`);
    fs.writeFileSync(filePath, dataUrl, 'utf-8');
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('get-avatar', async () => {
  try {
    if (!currentUser) return { success: false };
    const filePath = path.join(avatarDir, `${currentUser.id}.txt`);
    if (fs.existsSync(filePath)) {
      const dataUrl = fs.readFileSync(filePath, 'utf-8');
      return { success: true, dataUrl };
    }
    return { success: false };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ─── License ───
ipcMain.handle('get-trial-status', async () => {
  return await getTrialStatusHelper(currentUser ? currentUser.id : null);
});

ipcMain.handle('activate-license', async (event, key) => {
  try {
    if (currentUser) {
      const result = await db.requestLicenseActivation(currentUser.id, key);
      return result;
    }
    return { success: false, error: 'Not logged in' };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('get-pending-activations', async () => {
  try {
    if (currentUser && currentUser.isAdmin) {
      const list = await db.getPendingActivations();
      return { success: true, list };
    }
    return { success: false, error: 'Not authorized' };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('approve-license-activation', async (event, { email, durationOption }) => {
  try {
    if (currentUser && currentUser.isAdmin) {
      const result = await db.approveLicenseActivation(email, durationOption);
      return result;
    }
    return { success: false, error: 'Not authorized' };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('reject-license-activation', async (event, email) => {
  try {
    if (currentUser && currentUser.isAdmin) {
      const result = await db.rejectLicenseActivation(email);
      return result;
    }
    return { success: false, error: 'Not authorized' };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ─── Meetings ───
ipcMain.handle('create-meeting', async () => {
  try {
    if (currentUser) {
      const meetingId = helpers.generateMeetingId();
      const result = await db.createMeeting({
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
});

ipcMain.handle('join-meeting', async (event, meetingId) => {
  try {
    let id = meetingId;
    if (meetingId.includes('/meeting/')) {
      id = meetingId.split('/meeting/').pop();
    }
    return { success: true, meetingId: id };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('get-recent-meetings', async () => {
  try {
    if (currentUser) {
      const meetings = await db.getUserMeetings(currentUser.id);
      return { success: true, meetings };
    }
    return { success: true, meetings: [] };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('end-meeting', async (event, meetingId) => {
  try {
    await db.endMeeting(meetingId);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('delete-meeting', async (event, meetingId) => {
  try {
    return await db.deleteMeeting(meetingId);
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('get-meeting-info', async (event, meetingId) => {
  try {
    const meeting = await db.getMeeting(meetingId);
    return { success: true, meeting };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ─── Admin ───
ipcMain.handle('get-admin-stats', async () => {
  try {
    if (currentUser && currentUser.isAdmin) {
      const stats = await db.getStats();
      return { success: true, stats };
    }
    return { success: false, error: 'Not authorized' };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('get-all-users', async () => {
  try {
    if (currentUser && currentUser.isAdmin) {
      const users = await db.getAllUsers();
      return { success: true, users };
    }
    return { success: false, error: 'Not authorized' };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('admin-activate-license', async (event, { userId, durationDays }) => {
  try {
    if (currentUser && currentUser.isAdmin) {
      const key = await db.generateLicenseKey(durationDays || 'lifetime');
      const localRes = await db.activateLicense(userId, key);
      if (localRes.success) {
        return { success: true, key };
      }
      return { success: false, error: localRes.error || 'Activation failed' };
    }
    return { success: false, error: 'Not authorized' };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('admin-deactivate-license', async (event, userId) => {
  try {
    if (currentUser && currentUser.isAdmin) {
      const localRes = await db.deactivateLicense(userId);
      return localRes;
    }
    return { success: false, error: 'Not authorized' };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('admin-delete-user', async (event, userId) => {
  try {
    if (currentUser && currentUser.isAdmin) {
      const localRes = await db.deleteUser(userId);
      return localRes;
    }
    return { success: false, error: 'Not authorized' };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('generate-license-key', async (event, durationDays) => {
  try {
    if (currentUser && currentUser.isAdmin) {
      const key = await db.generateLicenseKey(durationDays || 'lifetime');
      return { success: true, key };
    }
    return { success: false, error: 'Not authorized' };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('get-active-meetings', async () => {
  try {
    if (currentUser && currentUser.isAdmin) {
      const meetings = await db.getActiveMeetings();
      return { success: true, meetings };
    }
    return { success: false, error: 'Not authorized' };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('get-system-settings', async () => {
  try {
    if (currentUser && currentUser.isAdmin) {
      const settings = await db.getSettings();
      return { success: true, settings };
    }
    return { success: false, error: 'Not authorized' };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('update-system-settings', async (event, updates) => {
  try {
    if (currentUser && currentUser.isAdmin) {
      const localRes = await db.updateSettings(updates);
      return localRes;
    }
    return { success: false, error: 'Not authorized' };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('admin-toggle-ban', async (event, { userId, isBanned }) => {
  try {
    if (currentUser && currentUser.isAdmin) {
      const localRes = await db.toggleUserBan(userId);
      return localRes;
    }
    return { success: false, error: 'Not authorized' };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('admin-toggle-role', async (event, { userId, isAdmin }) => {
  try {
    if (currentUser && currentUser.isAdmin) {
      const localRes = await db.toggleUserRole(userId);
      return localRes;
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

const APP_VERSION = '1.0.2';

// Helper function to download file over HTTPS/HTTP with progress monitoring
function downloadFile(fileUrl, destPath, onProgress) {
  const https = require('https');
  const http = require('http');
  const fs = require('fs');

  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    const client = fileUrl.startsWith('https') ? https : http;

    const request = client.get(fileUrl, (response) => {
      if (response.statusCode === 302 || response.statusCode === 301) {
        // Handle HTTP redirect (e.g. GitHub releases redirects to AWS S3)
        const redirectUrl = response.headers.location;
        file.close();
        downloadFile(redirectUrl, destPath, onProgress).then(resolve).catch(reject);
        return;
      }

      if (response.statusCode !== 200) {
        reject(new Error(`Failed to download: Server returned ${response.statusCode}`));
        return;
      }

      const totalBytes = parseInt(response.headers['content-length'], 10);
      let downloadedBytes = 0;

      response.on('data', (chunk) => {
        downloadedBytes += chunk.length;
        file.write(chunk);
        if (totalBytes && onProgress) {
          const progress = Math.round((downloadedBytes / totalBytes) * 100);
          onProgress(progress);
        }
      });

      response.on('end', () => {
        file.end();
        resolve();
      });
    });

    request.on('error', (err) => {
      fs.unlink(destPath, () => { });
      reject(err);
    });
  });
}

// ─── Auto-Update Handlers ──
ipcMain.handle('check-for-updates', async () => {
  try {
    const response = await fetch('https://raw.githubusercontent.com/AtikShahriar01/AtikMeetSoft/main/package.json');
    if (!response.ok) throw new Error('Could not fetch package.json from GitHub');
    const data = await response.json();

    const semverCompare = (v1, v2) => {
      const p1 = v1.split('.').map(Number);
      const p2 = v2.split('.').map(Number);
      for (let i = 0; i < 3; i++) {
        if (p1[i] > p2[i]) return 1;
        if (p1[i] < p2[i]) return -1;
      }
      return 0;
    };

    if (data && data.version && semverCompare(data.version, APP_VERSION) > 0) {
      const url = `https://github.com/AtikShahriar01/AtikMeetSoft/releases/download/v${data.version}/AtikMeet-${data.version}%20Setup.exe`;
      return { updateAvailable: true, version: data.version, url };
    }
    return { updateAvailable: false };
  } catch (err) {
    console.error('[Update] Error checking for updates:', err.message);
    return { updateAvailable: false, error: err.message };
  }
});

let isUpdating = false;
ipcMain.handle('start-update', async (event) => {
  if (isUpdating) return { success: false, error: 'Update already in progress' };

  try {
    const checkRes = await fetch('https://raw.githubusercontent.com/AtikShahriar01/AtikMeetSoft/main/package.json');
    if (!checkRes.ok) throw new Error('Failed to retrieve update version from GitHub');
    const data = await checkRes.json();

    if (!data || !data.version) throw new Error('Could not determine new version from GitHub package.json');

    const downloadUrl = `https://github.com/AtikShahriar01/AtikMeetSoft/releases/download/v${data.version}/AtikMeet-${data.version}%20Setup.exe`;

    isUpdating = true;
    const tempDir = app.getPath('temp');
    const installerPath = path.join(tempDir, 'atikmeet-setup.exe');

    console.log(`[Update] Starting download from ${downloadUrl} to ${installerPath}`);

    await downloadFile(downloadUrl, installerPath, (progress) => {
      if (mainWindow) {
        mainWindow.webContents.send('update-progress', progress);
      }
    });

    console.log('[Update] Download complete. Executing installer...');
    if (mainWindow) {
      mainWindow.webContents.send('update-completed');
    }

    // Launch installer and exit Electron
    const { exec } = require('child_process');
    exec(`"${installerPath}"`, (err) => {
      if (err) {
        console.error('[Update] Installer execution failed:', err);
      }
    });

    setTimeout(() => {
      app.quit();
    }, 1000);

    return { success: true };
  } catch (err) {
    isUpdating = false;
    console.error('[Update] Update failed:', err.message);
    if (mainWindow) {
      mainWindow.webContents.send('update-error', err.message);
    }
    return { success: false, error: err.message };
  }
});

// ─── App Info ───
ipcMain.handle('get-app-info', () => {
  return {
    name: 'AtikMeet',
    version: APP_VERSION,
    developer: 'Atik Shahriar',
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node
  };
});

// ─── WebRTC Firestore-based Signaling ───
const { collection, addDoc, onSnapshot, query, where, deleteDoc, getDocs } = require('firebase/firestore');

let signalUnsubscribeMap = new Map(); // roomId -> unsubscribe function

ipcMain.handle('send-signal', async (event, { roomId, packet }) => {
  try {
    const firestoreDb = db.firestoreDb;
    if (!firestoreDb) return { success: false, error: 'Database not initialized' };

    const signalsCol = collection(firestoreDb, `meetings/${roomId}/signals`);
    await addDoc(signalsCol, {
      sender: packet.sender || (currentUser ? currentUser.email : 'guest'),
      target: packet.target || null,
      type: packet.type,
      data: packet.data ? JSON.stringify(packet.data) : null,
      createdAt: new Date().getTime()
    });
    return { success: true };
  } catch (err) {
    console.error('[Signaling] send-signal error:', err.message);
    return { success: false, error: err.message };
  }
});

ipcMain.on('listen-signals', (event, roomId) => {
  try {
    const firestoreDb = db.firestoreDb;
    if (!firestoreDb) return;

    if (signalUnsubscribeMap.has(roomId)) {
      signalUnsubscribeMap.get(roomId)();
      signalUnsubscribeMap.delete(roomId);
    }

    const signalsCol = collection(firestoreDb, `meetings/${roomId}/signals`);
    const timeLimit = new Date().getTime() - 15000;
    const q = query(
      signalsCol,
      where('createdAt', '>', timeLimit)
    );

    let processedDocIds = new Set();

    const unsubscribe = onSnapshot(q, (snapshot) => {
      snapshot.docChanges().forEach((change) => {
        if (change.type === 'added') {
          const docId = change.doc.id;
          if (processedDocIds.has(docId)) return;
          processedDocIds.add(docId);

          const signalData = change.doc.data();
          const myEmail = currentUser ? currentUser.email : 'guest';
          if (signalData.sender === myEmail) return;

          let parsedData = null;
          if (signalData.data) {
            try {
              parsedData = JSON.parse(signalData.data);
            } catch (e) {
              parsedData = signalData.data;
            }
          }

          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('signal-received', {
              sender: signalData.sender,
              target: signalData.target,
              type: signalData.type,
              data: parsedData
            });
          }
        }
      });
    }, (err) => {
      console.error('[Signaling] Firestore onSnapshot error:', err.message);
    });

    signalUnsubscribeMap.set(roomId, unsubscribe);
    console.log(`[Signaling] Started listening to room: ${roomId}`);
  } catch (err) {
    console.error('[Signaling] listen-signals setup error:', err.message);
  }
});

ipcMain.handle('clear-signal-listener', async (event, roomId) => {
  try {
    if (signalUnsubscribeMap.has(roomId)) {
      signalUnsubscribeMap.get(roomId)();
      signalUnsubscribeMap.delete(roomId);
      console.log(`[Signaling] Cleared listener for room: ${roomId}`);
    }

    // Asynchronously delete signal logs from database to keep it clean
    const firestoreDb = db.firestoreDb;
    if (firestoreDb) {
      const signalsCol = collection(firestoreDb, `meetings/${roomId}/signals`);
      getDocs(signalsCol).then((snapshot) => {
        snapshot.forEach((docSnap) => {
          deleteDoc(docSnap.ref).catch(() => { });
        });
      }).catch(() => { });
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});