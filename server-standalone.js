/**
 * ════════════════════════════════════════════════════════════
 *  AtikMeet - Standalone Background Server
 *  Runs without Electron as a background Node.js process.
 *  Auto-starts with Windows so friends can connect anytime.
 *  Developer: Atik Shahriar
 * ════════════════════════════════════════════════════════════
 */

const http = require('http');
const path = require('path');
const fs = require('fs');
const url = require('url');
const os = require('os');

// ─── Configuration ───
const SIGNALING_PORT = process.env.PORT || 3478;
const CENTRAL_SERVER_IP = process.env.SERVER_URL || '192.168.0.101';
const CENTRAL_SERVER_URL = process.env.RENDER_EXTERNAL_URL || `http://${CENTRAL_SERVER_IP}:${SIGNALING_PORT}`;
const PROJECT_DIR = __dirname;

// ─── Logging ───
const logFile = path.join(PROJECT_DIR, 'server.log');
function log(msg) {
  const timestamp = new Date().toLocaleString('bn-BD', { timeZone: 'Asia/Dhaka' });
  const line = `[${timestamp}] ${msg}`;
  console.log(line);
  try {
    fs.appendFileSync(logFile, line + '\n');
  } catch (e) {}
}

log('═══ AtikMeet Background Server Starting ═══');

// ─── Initialize Database ───
let db;
try {
  db = require('./src/utils/db');
  if (!db.getSettings().installDate) {
    db.setInstallDate(new Date().toISOString());
  }
  log('✅ Database initialized successfully');
} catch (err) {
  log('❌ Database init error: ' + err.message);
  process.exit(1);
}

// ─── Initialize Helpers ───
const helpers = require('./src/utils/helpers');
const { startSignalingServer } = require('./src/utils/signaling');

// ─── Helper Functions ───
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
    const userObj = userId ? db.getUserById(userId) : null;
    const isMaintenance = (settings && settings.maintenanceMode && userId && !(userObj && userObj.isAdmin));
    
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

function handleSocialLogin(provider, email, name) {
  try {
    const providerUpper = provider.charAt(0).toUpperCase() + provider.slice(1);
    const targetEmail = email || `atik.${provider}@atikmeet.com`;
    const targetName = name || `Atik ${providerUpper}`;
    
    let user = db.db.get('users').find({ email: targetEmail }).value();
    if (!user) {
      const result = db.createUser({
        name: targetName,
        email: targetEmail,
        password: 'sociallogin123'
      });
      if (result.success && result.user) {
        user = db.db.get('users').find({ email: targetEmail }).value();
      } else {
        return { success: false, error: result.error || 'Failed to create social account' };
      }
    } else if (name && user.name !== name) {
      db.updateUser(user.id, { name });
      user = db.db.get('users').find({ email: targetEmail }).value();
    }
    
    if (user.isBanned) {
      return { success: false, error: 'Your account has been banned by the administrator.' };
    }

    const settings = db.getSettings();
    if (settings && settings.maintenanceMode && !user.isAdmin) {
      return { success: false, error: 'The system is currently under maintenance.' };
    }

    return { success: true, user: { ...user, password: undefined } };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ─── HTTP Server ───
const server = http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url, true);
  let pathname = parsedUrl.pathname;
  pathname = decodeURIComponent(pathname);

  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // ── /api/ipc Gateway ──
  if (pathname === '/api/ipc' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const { channel, args } = JSON.parse(body);
        let result = { success: false, error: 'Invalid IPC channel' };

        if (channel === 'login') {
          const { email, password } = args[0] || {};
          const user = db.loginUser(email, password);
          if (user) {
            result = { success: true, user: { ...user, password: undefined } };
          } else {
            result = { success: false, error: 'Invalid email or password' };
          }
        } 
        else if (channel === 'register') {
          const { name, email, password } = args[0] || {};
          const regResult = db.createUser({ name, email, password });
          if (regResult.success && regResult.user) {
            result = { success: true, user: regResult.user };
          } else {
            result = { success: false, error: regResult.error || 'Registration failed' };
          }
        }
        else if (channel === 'social-login') {
          const data = args[0];
          if (data && typeof data === 'object') {
            result = handleSocialLogin(data.provider, data.email, data.name);
          } else {
            result = handleSocialLogin(data);
          }
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
          if (meetingId && meetingId.includes('/meeting/')) {
            id = meetingId.split('/meeting/').pop();
          }
          result = { success: true, meetingId: id };
        }
        else if (channel === 'get-recent-meetings') {
          const userId = args[0];
          const meetings = userId ? db.getUserMeetings(userId) : [];
          result = { success: true, meetings };
        }
        else if (channel === 'end-meeting') {
          const meetingId = args[0];
          db.endMeeting(meetingId);
          result = { success: true };
        }
        else if (channel === 'delete-meeting') {
          const meetingId = args[0];
          result = db.deleteMeeting(meetingId);
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
        else if (channel === 'generate-license-key') {
          const durationDays = args[0];
          const key = db.generateLicenseKey(durationDays);
          result = { success: true, key };
        }
        else if (channel === 'get-all-users') {
          const users = db.getAllUsers();
          result = { success: true, users };
        }
        else if (channel === 'admin-activate-license') {
          const { userId, durationDays } = args[0] || {};
          const key = db.generateLicenseKey(durationDays || 'lifetime');
          const res = db.activateLicense(userId, key);
          if (res.success) {
            result = { success: true, key };
          } else {
            result = { success: false, error: res.error || 'Activation failed' };
          }
        }
        else if (channel === 'admin-deactivate-license') {
          const userId = args[0];
          const res = db.deactivateLicense(userId);
          result = res;
        }
        else if (channel === 'admin-delete-user') {
          const userId = args[0];
          const res = db.deleteUser(userId);
          result = res;
        }
        else if (channel === 'get-admin-stats') {
          const stats = db.getStats();
          result = { success: true, stats };
        }
        else if (channel === 'get-active-meetings') {
          const meetings = db.getActiveMeetings();
          result = { success: true, meetings };
        }
        else if (channel === 'get-system-settings') {
          const settings = db.getSettings();
          result = { success: true, settings };
        }
        else if (channel === 'update-system-settings') {
          const updates = args[0];
          const res = db.updateSettings(updates);
          result = res;
        }
        else if (channel === 'admin-toggle-ban') {
          const { userId, isBanned } = args[0] || {};
          const res = db.toggleUserBan(userId, isBanned);
          result = res;
        }
        else if (channel === 'admin-toggle-role') {
          const { userId, isAdmin } = args[0] || {};
          const res = db.toggleUserRole(userId, isAdmin);
          result = res;
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

  // ── Auto-login API ──
  if (pathname === '/api/auto-login-local-admin') {
    const clientIp = req.socket.remoteAddress || '';
    const isLocal = clientIp === '127.0.0.1' || clientIp === '::1' || clientIp.includes('::ffff:127.0.0.1');
    
    if (isLocal) {
      const admin = db.getAllUsers().find(u => u.isAdmin);
      if (admin) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, user: { name: admin.name, email: admin.email, isAdmin: true } }));
        return;
      }
    }
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: false, error: 'Unauthorized' }));
    return;
  }

  // ── Meeting join links ──
  if (pathname.startsWith('/meeting/')) {
    const filePath = path.join(PROJECT_DIR, 'src', 'pages', 'meeting.html');
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

  // ── Static File Serving ──
  let targetPath = path.join(PROJECT_DIR, pathname);
  
  if (pathname.startsWith('/css/') || pathname.startsWith('/js/') || pathname.startsWith('/pages/')) {
    targetPath = path.join(PROJECT_DIR, 'src', pathname);
  }
  
  if (pathname === '/' || pathname === '') {
    targetPath = path.join(PROJECT_DIR, 'src', 'pages', 'login.html');
  }

  // Prevent directory traversal
  if (!targetPath.startsWith(PROJECT_DIR)) {
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
    else if (targetPath.endsWith('.json')) contentType = 'application/json';

    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
});

// ─── Start Signaling Server (Socket.IO) ───
const signalingServer = startSignalingServer(server);

// ─── Listen on all interfaces ───
server.listen(SIGNALING_PORT, '0.0.0.0', () => {
  log('✅ AtikMeet Server READY on port ' + SIGNALING_PORT);
  log('✅ LAN access: ' + CENTRAL_SERVER_URL);
  log('═══ Waiting for connections... ═══');
});

// ─── Auto-create admin account ───
try {
  const adminExists = db.getAllUsers().find(u => u.isAdmin);
  if (!adminExists) {
    const adminResult = db.createUser({
      name: 'Atik Shahriar',
      email: 'admin@atikmeet.com',
      password: 'atikadmin2026'
    });
    if (adminResult.success) {
      db.updateUser(adminResult.user.id, { isAdmin: true, isVIP: true });
      log('✅ Admin account created');
    }
  }
} catch (e) {
  log('Admin setup: ' + e.message);
}

// ─── Keep alive & error handling ───
process.on('uncaughtException', (err) => {
  log('⚠️ Error: ' + err.message);
});

process.on('SIGINT', () => {
  log('═══ Server shutting down ═══');
  server.close();
  process.exit(0);
});
