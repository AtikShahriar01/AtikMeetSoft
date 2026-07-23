require('dotenv').config();
const { app, BrowserWindow, ipcMain, dialog, clipboard, shell, nativeImage } = require('electron');
const path = require('path');
const http = require('http');
const os = require('os');
const fs = require('fs');
const url = require('url');
const helpers = require('./src/utils/helpers');

// ─── Squirrel Windows Installer Event Handler ───
function handleSquirrelEvents() {
  if (process.argv.length === 1) return false;
  const ChildProcess = require('child_process');
  const appFolder = path.resolve(process.execPath, '..');
  const rootAtomFolder = path.resolve(appFolder, '..');
  const updateDotExe = path.resolve(path.join(rootAtomFolder, 'Update.exe'));
  const exeName = path.basename(process.execPath);
  const spawn = function (command, args) {
    let spawnedProcess;
    try {
      spawnedProcess = ChildProcess.spawn(command, args, { detached: true });
    } catch (error) {}
    return spawnedProcess;
  };
  const spawnUpdate = function (args) {
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
let isLocalhost = true;
let signalingServer = null;
const CENTRAL_SERVER_IP = '192.168.0.101';
const SIGNALING_PORT = 3478;
const CENTRAL_SERVER_URL = 'https://atikmeetsoft.onrender.com';
let isDeveloperPC = false;
const PROTOCOL = 'atikmeet';

// Register atikmeet:// protocol scheme in OS registry
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [path.resolve(process.argv[1])]);
  }
} else {
  app.setAsDefaultProtocolClient(PROTOCOL);
}

// Deep link URL handler
async function handleDeepLinkUrl(urlStr) {
  if (!urlStr || !urlStr.startsWith(`${PROTOCOL}://`)) return;
  console.log('[Main] Processing Deep Link URL:', urlStr);
  try {
    const parsedUrl = new URL(urlStr);
    const params = parsedUrl.searchParams;
    const provider = params.get('provider') || 'google';
    const email = params.get('email');
    const name = params.get('name');
    if (email) {
      console.log('[Main] Deep link OAuth success:', { provider, email, name });
      const resObj = await handleSocialLoginHelper(provider, email, name);
      if (resObj.success && resObj.user) {
        currentUser = resObj.user;
        const targetPage = (resObj.user.isAdmin || resObj.user.email?.toLowerCase() === 'admin@atikmeet.com') ? 'admin' : 'home';
        if (mainWindow) {
          if (mainWindow.isMinimized()) mainWindow.restore();
          mainWindow.focus();
          mainWindow.loadFile(path.join(__dirname, 'src', 'pages', `${targetPage}.html`));
          mainWindow.webContents.send('social-login-success', resObj.user);
        }
      }
    }
  } catch (err) {
    console.error('[Main] Deep link parse error:', err.message);
  }
}

// ─── Single Instance Lock & Windows Deep Linking ───
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (event, commandLine) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
    const deepLinkUrl = commandLine.find(arg => arg.startsWith(`${PROTOCOL}://`));
    if (deepLinkUrl) {
      handleDeepLinkUrl(deepLinkUrl);
    }
  });
}
app.on('open-url', (event, urlStr) => {
  event.preventDefault();
  handleDeepLinkUrl(urlStr);
});

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
      enableWebRTC: true
    }
  });
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });
  try {
    const icon = nativeImage.createFromPath(iconPath);
    mainWindow.setIcon(icon);
  } catch (e) {
    console.log('Icon not found, using default');
  }
  mainWindow.loadFile(path.join(__dirname, 'src', 'pages', 'splash.html'));

  // Open DevTools for debugging renderer errors
  mainWindow.webContents.openDevTools();

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
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

// ═══════════════════════════════════════════════════════════════
// ─── Google OAuth 2.0 Helper Functions (MODULE-LEVEL / GLOBAL) ───
// এগুলো createServer-এর বাইরে, তাই social-login handler এদের পায়
// ═══════════════════════════════════════════════════════════════
function getGoogleAuthUrl() {
  const rootUrl = 'https://accounts.google.com/o/oauth2/v2/auth';
  const redirectUri = process.env.GOOGLE_REDIRECT_URI || `http://localhost:${SIGNALING_PORT}/callback`;
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId || clientId.includes('YOUR_GOOGLE_CLIENT_ID')) {
    return `http://localhost:${SIGNALING_PORT}/pages/google-login.html?provider=google&redirect_uri=${encodeURIComponent(redirectUri)}`;
  }
  const options = {
    redirect_uri: redirectUri,
    client_id: clientId,
    access_type: 'offline',
    response_type: 'code',
    prompt: 'consent',
    scope: [
      'https://www.googleapis.com/auth/userinfo.profile',
      'https://www.googleapis.com/auth/userinfo.email'
    ].join(' ')
  };
  return `${rootUrl}?${new URLSearchParams(options).toString()}`;
}

async function exchangeGoogleCodeForToken(code) {
  const tokenUrl = 'https://oauth2.googleapis.com/token';
  const redirectUri = process.env.GOOGLE_REDIRECT_URI || `http://localhost:${SIGNALING_PORT}/callback`;
  const values = {
    code,
    client_id: process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code'
  };
  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(values).toString()
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error_description || data.error || 'Failed to exchange Google OAuth code');
  }
  const userRes = await fetch(`https://www.googleapis.com/oauth2/v2/userinfo?access_token=${data.access_token}`);
  const profile = await userRes.json();
  return {
    email: profile.email,
    name: profile.name || profile.email.split('@')[0],
    picture: profile.picture
  };
}

// ─── Start Signaling Server & HTTP Static Web Server ───
function initSignalingServer() {
  try {
    signalingServer = http.createServer(async (req, res) => {
      const parsedUrl = url.parse(req.url, true);
      let pathname = parsedUrl.pathname;
      pathname = decodeURIComponent(pathname);

      // Handle Localhost HTTP Server Social Login Callback
      if (pathname === '/api/social-login-complete' || pathname === '/callback') {
        let provider = parsedUrl.query.provider || 'google';
        let email = parsedUrl.query.email;
        let name = parsedUrl.query.name;
        let picture = parsedUrl.query.picture || null;
        const code = parsedUrl.query.code;

        console.log('\n[OAuth] ════════════ CALLBACK RECEIVED ════════════');
        console.log('[OAuth] Step 1: Callback received from browser');
        console.log('[OAuth] Pathname:', pathname, '| Provider:', provider);
        console.log('[OAuth] Code present:', !!code, '| Email present:', !!email);

        if (code && process.env.GOOGLE_CLIENT_ID && !process.env.GOOGLE_CLIENT_ID.includes('YOUR_GOOGLE_CLIENT_ID')) {
          try {
            console.log('[OAuth] Step 2: Exchanging Google Authorization Code for Token...');
            const googleProfile = await exchangeGoogleCodeForToken(code);
            email = googleProfile.email;
            name = googleProfile.name;
            picture = googleProfile.picture;
            provider = 'google';
            console.log('[OAuth] Step 3: Token fetched ✅ | User email:', email);
          } catch (err) {
            console.error('[OAuth] ❌ Google Token Exchange Failed:', err.message);
          }
        } else if (email) {
          console.log('[OAuth] Step 2: Direct email/name provided (no code exchange needed)');
          console.log('[OAuth] Step 3: User email:', email);
        }

        console.log('[OAuth] Step 4: Starting database lookup & upsert...');
        let resObj = { success: false, error: 'Missing email' };
        if (email) {
          resObj = await handleSocialLoginHelper(provider, email, name, picture);
          if (resObj.success && resObj.user) {
            currentUser = resObj.user;
            const isNewUser = resObj.status === 'signup_success';
            const targetPage = (resObj.user.isAdmin || resObj.user.email?.toLowerCase() === 'admin@atikmeet.com') ? 'admin' : 'home';
            console.log(`[OAuth] Step 5: ${isNewUser ? '🎉 New user created' : '🔑 Existing user logged in'} | Target: ${targetPage}.html`);
            if (mainWindow) {
              if (mainWindow.isMinimized()) mainWindow.restore();
              mainWindow.focus();
              mainWindow.loadFile(path.join(__dirname, 'src', 'pages', `${targetPage}.html`));
              mainWindow.webContents.send('social-login-success', { ...resObj.user, status: resObj.status });
            }
          } else {
            console.error('[OAuth] ❌ Auth failed:', resObj.error);
          }
        }
        console.log('[OAuth] ═══════════════════════════════════════════\n');

        // ব্রাউজার মেসেজ resObj.success এর ওপর ভিত্তি করে আলাদা
        const authOk = resObj.success === true;
        const isNewUser = resObj.status === 'signup_success';
        let title, icon, statusTag, statusColor, statusBorder, message;

        if (authOk) {
          title = isNewUser ? '🎉 Account Created Successfully!' : '✅ Login Successful!';
          icon = isNewUser ? '🎉' : '✅';
          statusTag = isNewUser ? 'NEW ACCOUNT' : 'SIGNED IN';
          statusColor = isNewUser ? '#a78bfa' : '#60a5fa';
          statusBorder = isNewUser ? 'rgba(139,92,246,0.4)' : 'rgba(59,130,246,0.4)';
          message = isNewUser
            ? `Welcome to AtikMeet, <strong>${name || email}</strong>! Your account has been created.`
            : `Welcome back, <strong>${name || email}</strong>! You have been logged in.`;
        } else {
          title = '❌ Authentication Failed';
          icon = '❌';
          statusTag = 'ERROR';
          statusColor = '#f87171';
          statusBorder = 'rgba(248,113,113,0.4)';
          message = `We could not complete your login. <br><strong>Reason:</strong> ${resObj.error || 'Unknown error'}<br><br>Please close this tab and try again from the AtikMeet app.`;
        }

        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <!DOCTYPE html>
          <html>
          <head>
            <title>AtikMeet - ${title}</title>
            <style>
              * { margin: 0; padding: 0; box-sizing: border-box; }
              body { font-family: system-ui, -apple-system, sans-serif; background: #0f0f23; color: #fff;
                display: flex; align-items: center; justify-content: center; height: 100vh; text-align: center; }
              .card { background: rgba(255,255,255,0.05); padding: 44px 36px; border-radius: 20px;
                border: 1px solid rgba(255,255,255,0.12); max-width: 420px; width: 90%;
                box-shadow: 0 24px 48px rgba(0,0,0,0.6); animation: fadeIn .4s ease; }
              @keyframes fadeIn { from { opacity:0; transform: translateY(16px) } to { opacity:1; transform: translateY(0) } }
              .icon { font-size: 56px; margin-bottom: 16px; }
              h1 { font-size: 22px; margin-bottom: 12px; color: #fff; }
              p { color: #a0a0b8; font-size: 14px; line-height: 1.6; }
              .badge { display: inline-block; margin-top: 18px; padding: 8px 18px;
                background: ${authOk ? 'rgba(0,212,170,0.15)' : 'rgba(248,113,113,0.15)'};
                color: ${authOk ? '#00d4aa' : '#f87171'};
                border-radius: 24px; font-weight: 600; font-size: 12px;
                border: 1px solid ${authOk ? 'rgba(0,212,170,0.3)' : 'rgba(248,113,113,0.3)'}; }
              .status-tag { display: inline-block; margin-bottom: 14px; padding: 4px 12px;
                background: ${authOk ? (isNewUser ? 'rgba(139,92,246,0.2)' : 'rgba(59,130,246,0.2)') : 'rgba(248,113,113,0.2)'};
                color: ${statusColor};
                border-radius: 12px; font-size: 12px; font-weight: 600;
                border: 1px solid ${statusBorder}; }
            </style>
          </head>
          <body>
            <div class="card">
              <div class="icon">${icon}</div>
              <div class="status-tag">${statusTag}</div>
              <h1>${title}</h1>
              <p>${message}</p>
              ${authOk ? '<div class="badge">You can close this tab — AtikMeet app is ready</div>' : ''}
            </div>
            ${authOk ? '<script>setTimeout(() => window.close(), 3000);</script>' : ''}
          </body>
          </html>
        `);
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
            } else if (channel === 'register') {
              const { name, email, password } = args[0] || {};
              result = await db.createUser({ name, email, password });
            } else if (channel === 'social-login') {
              const data = args[0];
              if (data && typeof data === 'object') {
                result = await handleSocialLoginHelper(data.provider, data.email, data.name);
              } else {
                result = await handleSocialLoginHelper(data);
              }
            } else if (channel === 'logout') {
              result = { success: true };
            } else if (channel === 'get-trial-status') {
              const userId = args[0];
              result = await getTrialStatusHelper(userId);
            } else if (channel === 'create-meeting') {
              const { hostId, hostName } = args[0] || {};
              const meetingId = helpers.generateMeetingId();
              const createRes = await db.createMeeting({ id: meetingId, hostId, hostName });
              if (createRes.success && createRes.meeting) {
                const meetingLink = `${CENTRAL_SERVER_URL}/meeting/${meetingId}`;
                result = { success: true, meeting: createRes.meeting, meetingLink, meetingId };
              } else {
                result = { success: false, error: createRes.error };
              }
            } else if (channel === 'join-meeting') {
              const meetingId = args[0];
              let id = meetingId;
              if (meetingId.includes('/meeting/')) {
                id = meetingId.split('/meeting/').pop();
              }
              result = { success: true, meetingId: id };
            } else if (channel === 'get-recent-meetings') {
              const userId = args[0];
              const meetings = await db.getUserMeetings(userId);
              result = { success: true, meetings };
            } else if (channel === 'end-meeting') {
              const meetingId = args[0];
              await db.endMeeting(meetingId);
              result = { success: true };
            } else if (channel === 'delete-meeting') {
              const meetingId = args[0];
              result = await db.deleteMeeting(meetingId);
            } else if (channel === 'get-meeting-info') {
              const meetingId = args[0];
              const meeting = await db.getMeeting(meetingId);
              result = { success: true, meeting };
            } else if (channel === 'update-profile') {
              const { userId, data } = args[0] || {};
              await db.updateUser(userId, data);
              const fresh = await db.getUserById(userId);
              result = { success: true, user: fresh };
            } else if (channel === 'activate-license') {
              const { userId, key } = args[0] || {};
              const actRes = await db.activateLicense(userId, key);
              result = actRes;
            } else if (channel === 'get-signaling-info') {
              result = { host: CENTRAL_SERVER_IP, port: SIGNALING_PORT, url: CENTRAL_SERVER_URL };
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

      // Handle meeting join links
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

      // Serve static files
      let targetPath = path.join(__dirname, pathname);
      if (pathname.startsWith('/css/') || pathname.startsWith('/js/') || pathname.startsWith('/pages/')) {
        targetPath = path.join(__dirname, 'src', pathname);
      }
      if (pathname === '/' || pathname === '') {
        targetPath = path.join(__dirname, 'src', 'pages', 'login.html');
      }
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

  const { session, desktopCapturer } = require('electron');
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(true);
  });
  session.defaultSession.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => {
    return true;
  });
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    desktopCapturer.getSources({ types: ['screen'] }).then(sources => {
      if (sources.length > 0) {
        callback({ video: sources[0], audio: 'loopback' });
      } else {
        callback({ error: 'No screen sources found' });
      }
    }).catch(err => {
      console.error('[Electron] DisplayMedia request failed:', err.message);
      callback({ error: err.message });
    });
  });

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

app.on('before-quit', async (event) => {
  if (signalingServer) {
    await new Promise((resolve) => {
      signalingServer.close(() => {
        console.log('Signaling server closed.');
        resolve();
      });
      setTimeout(resolve, 5000);
    });
  }
  if (typeof signalUnsubscribeMap !== 'undefined') {
    signalUnsubscribeMap.forEach((unsubscribe) => {
      if (typeof unsubscribe === 'function') unsubscribe();
    });
    signalUnsubscribeMap.clear();
  }
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

// ── Client-Server Helper Functions ──
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

async function handleSocialLoginHelper(provider, email, name, picture) {
  console.log('\n[AUTH] ══════════════════════════════════════');
  console.log('[AUTH] handleSocialLoginHelper called');
  console.log('[AUTH] Provider:', provider, '| Email:', email, '| Name:', name);
  console.log('[AUTH] ══════════════════════════════════════');
  try {
    if (!db) {
      console.log('[AUTH] DB not initialized, calling initDatabase()...');
      initDatabase();
    }
    if (!db) {
      console.error('[AUTH] ❌ Database service unavailable!');
      return { success: false, error: 'Database service is unavailable. Please check your network connection and restart the app.' };
    }
    const targetEmail = email ? email.toLowerCase().trim() : `user.${Date.now()}@atikmeet.com`;
    const targetName = name ? name.trim() : targetEmail.split('@')[0];
    const targetPic = picture || null;
    console.log('[AUTH] Checking Firebase for existing user:', targetEmail);

    let user = await db.getUserById(targetEmail);
    let status = '';
    if (!user) {
      console.log('[AUTH] ✅ New user detected → Creating account (Sign Up)...');
      const bcrypt = require('bcryptjs');
      const hashedPassword = bcrypt.hashSync('sociallogin123', 10);
      const newUser = {
        id: targetEmail,
        name: targetName,
        email: targetEmail,
        picture: targetPic,
        provider: provider,
        password: hashedPassword,
        role: 'user',
        isAdmin: false,
        isVIP: false,
        licenseKey: null,
        licenseExpiry: null,
        pendingKey: null,
        createdAt: new Date().toISOString(),
        lastLoginAt: new Date().toISOString(),
        isBanned: false
      };
      const { doc, setDoc } = require('firebase/firestore');
      const firestoreInstance = db.firestoreDb;
      if (!firestoreInstance) {
        console.error('[AUTH] ❌ db.firestoreDb is undefined! Firebase not initialized properly.');
        return { success: false, error: 'Firebase Firestore not initialized.' };
      }
      const docRef = doc(firestoreInstance, 'users', targetEmail);
      await setDoc(docRef, newUser);
      user = newUser;
      status = 'signup_success';
      console.log('[AUTH] 🎉 New user created in Firebase:', targetEmail);
    } else {
      console.log('[AUTH] ✅ Existing user found → Logging in (Sign In)...');
      status = 'login_success';
      const updates = { lastLoginAt: new Date().toISOString() };
      if (targetName && user.name !== targetName) updates.name = targetName;
      if (targetPic && user.picture !== targetPic) updates.picture = targetPic;
      await db.updateUser(targetEmail, updates);
      user = { ...user, ...updates };
      console.log('[AUTH] 🔑 Existing user logged in:', targetEmail);
    }

    if (user.isBanned) {
      console.warn('[AUTH] ⛔ User is banned:', targetEmail);
      return { success: false, error: 'Your account has been banned by the administrator.' };
    }
    const settings = await db.getSettings();
    if (settings && settings.maintenanceMode && !user.isAdmin) {
      console.warn('[AUTH] 🔧 System under maintenance.');
      return { success: false, error: 'The system is currently under maintenance. Please try again later.' };
    }
    console.log(`[AUTH] ✔ Auth complete. Status: ${status} | User: ${targetEmail}\n`);
    return { success: true, status, user: { ...user, password: undefined } };
  } catch (err) {
    console.error('[AUTH] ❌ handleSocialLoginHelper error:', err);
    return { success: false, error: err.message };
  }
}

// ═══════════════════════════════════════════
// ─── IPC HANDLERS (Main Process API) ───
// ═══════════════════════════════════════════
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

// ─── Navigation (🔒 WITH ADMIN GUARD) ───
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

    // 🔒 ADMIN PAGE GUARD: non-admin user কে admin page-এ ঢুকতে দেবে না
    const adminPages = ['admin', 'admin-dashboard', 'admin-panel'];
    if (adminPages.includes(pageName)) {
      const isRealAdmin = currentUser && (
        currentUser.isAdmin === true ||
        (currentUser.email && currentUser.email.toLowerCase() === 'admin@atikmeet.com')
      );
      if (!isRealAdmin) {
        console.warn('[SECURITY] ⛔ Non-admin tried to open admin page → BLOCKED & redirected to home. User:', currentUser ? currentUser.email : 'none');
        pageName = 'home';
      } else {
        console.log('[SECURITY] ✅ Admin access granted to:', currentUser.email);
      }
    }

    const pagePath = path.join(__dirname, 'src', 'pages', `${pageName}.html`);
    mainWindow.loadFile(pagePath, { query });
  }
});

ipcMain.handle('login', async (event, { email, password }) => {
  try {
    if (!db) initDatabase();
    if (!db) return { success: false, error: 'Database service is unavailable. Please check your network connection and restart the app.' };
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
    if (!db) initDatabase();
    if (!db) return { success: false, error: 'Database service is unavailable. Please check your network connection and restart the app.' };
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

let authWindow = null;
let googleAuthResolve = null;
ipcMain.handle('google-login-complete', async (event, data) => {
  console.log('[DEBUG] google-login-complete received in main:', data);
  if (googleAuthResolve) {
    googleAuthResolve(data);
    googleAuthResolve = null;
  }
  if (authWindow && !authWindow.isDestroyed()) {
    authWindow.close();
    authWindow = null;
  }
  return { success: true };
});

ipcMain.handle('social-login', async (event, provider) => {
  console.log('\n[OAuth] ══════════════════════════════════════');
  console.log('[OAuth] social-login IPC triggered');
  console.log('[OAuth] Step 0: Browser opened for provider:', provider);
  let targetUrl = '';
  const hasGoogleCreds = provider === 'google'
    && process.env.GOOGLE_CLIENT_ID
    && !process.env.GOOGLE_CLIENT_ID.includes('YOUR_GOOGLE_CLIENT_ID');
  if (hasGoogleCreds) {
    targetUrl = getGoogleAuthUrl();
    console.log('[OAuth] Using Google Cloud Console OAuth URL (real credentials)');
  } else {
    targetUrl = `http://localhost:${SIGNALING_PORT}/pages/google-login.html?provider=${provider}&redirect_uri=http://localhost:${SIGNALING_PORT}/api/social-login-complete`;
    console.log('[OAuth] Using built-in AtikMeet login page (no .env credentials set)');
  }
  console.log('[OAuth] Opening browser URL:', targetUrl.substring(0, 80) + '...');
  console.log('[OAuth] ══════════════════════════════════════\n');
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
      if (freshUser) currentUser = freshUser;
    } catch (e) {
      console.warn('Failed to refresh current user from DB:', e.message);
    }
    return { success: true, user: currentUser };
  }
  return { success: false, error: 'Not logged in' };
});

ipcMain.handle('is-localhost', () => {
  if (app.isPackaged) return false;
  return !!process.env.ATIKMEET_DEV;
});

ipcMain.handle('auto-login-admin', async () => {
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
      if (localRes.success) return { success: true, key };
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

ipcMain.handle('copy-to-clipboard', (event, text) => {
  clipboard.writeText(text);
  return { success: true };
});
ipcMain.handle('open-in-browser', (event, url) => {
  shell.openExternal(url);
  return { success: true };
});
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

ipcMain.handle('get-signaling-info', () => {
  const localIP = getLocalIP();
  return {
    host: localIP,
    port: SIGNALING_PORT,
    url: `http://${localIP}:${SIGNALING_PORT}`
  };
});

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

function downloadFile(fileUrl, destPath, onProgress) {
  const https = require('https');
  const http = require('http');
  const fs = require('fs');
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    const client = fileUrl.startsWith('https') ? https : http;
    const request = client.get(fileUrl, (response) => {
      if (response.statusCode === 302 || response.statusCode === 301) {
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
      if (mainWindow) mainWindow.webContents.send('update-progress', progress);
    });
    console.log('[Update] Download complete. Executing installer...');
    if (mainWindow) mainWindow.webContents.send('update-completed');
    const { exec } = require('child_process');
    exec(`"${installerPath}"`, (err) => {
      if (err) console.error('[Update] Installer execution failed:', err);
    });
    setTimeout(() => { app.quit(); }, 1000);
    return { success: true };
  } catch (err) {
    isUpdating = false;
    console.error('[Update] Update failed:', err.message);
    if (mainWindow) mainWindow.webContents.send('update-error', err.message);
    return { success: false, error: err.message };
  }
});

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
let signalUnsubscribeMap = new Map();

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
    const q = query(signalsCol, where('createdAt', '>', timeLimit));
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
            try { parsedData = JSON.parse(signalData.data); } catch (e) { parsedData = signalData.data; }
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