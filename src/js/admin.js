/**
 * ============================================================
 *  AtikMeet - Administrative Module (Renderer Process)
 *  Manages stats cards counters, settings, bans, roles, generators,
 *  rejoin/force-end room monitors, and search filters.
 * ============================================================
 */

function $(id) {
  return document.getElementById(id);
}

let allUsers = [];
let activeMeetingsPollingInterval = null;

document.addEventListener('DOMContentLoaded', async () => {
  await verifyAdminAccess();
  await refreshDashboard();
  await loadSystemSettings();
  setupEventListeners();

  // Poll active meetings and stats every 5 seconds for real-time monitoring
  activeMeetingsPollingInterval = setInterval(async () => {
    await loadActiveMeetings();
    await loadAdminStats();
  }, 5000);
});

// ── Verify Access ────────────────────────────────────────────
async function verifyAdminAccess() {
  const result = await window.electronAPI.getCurrentUser();
  if (!result.success || !result.user.isAdmin) {
    alert('Access Denied: You are not authorized to view the admin panel.');
    window.electronAPI.navigate('home');
  }
}

// ── Load Stats ───────────────────────────────────────────────
async function loadAdminStats() {
  const result = await window.electronAPI.getAdminStats();
  if (result.success) {
    const stats = result.stats;
    $('stats-total-users').textContent = stats.totalUsers;
    $('stats-active-keys').textContent = stats.activeLicenses;
    $('stats-vip-users').textContent = stats.vipUsers;
    $('stats-live-meetings').textContent = stats.activeMeetings;
  }
}

// ── Load Global System Settings ────────────────────────────────
async function loadSystemSettings() {
  const result = await window.electronAPI.getSystemSettings();
  if (result.success && result.settings) {
    $('maintenance-mode-toggle').checked = !!result.settings.maintenanceMode;
    $('max-participants-input').value = result.settings.maxParticipants || 150;
    $('trial-days-input').value = result.settings.trialDays || 7;
  }
}

// ── Load Users database table ────────────────────────────────
async function loadUsersList() {
  const result = await window.electronAPI.getAllUsers();
  const tbody = $('user-table-body');
  
  if (result.success && result.users) {
    allUsers = result.users;
    renderUserTable(allUsers);
  } else {
    tbody.innerHTML = '<tr><td colspan="6" class="loading-error">Error loading user list.</td></tr>';
  }
}

function renderUserTable(usersList) {
  const tbody = $('user-table-body');
  tbody.innerHTML = '';

  if (usersList.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-row">No matching users found.</td></tr>';
    return;
  }

  usersList.forEach(user => {
    const isCurrentAdmin = (user.email === 'admin@atikmeet.com');
    const row = document.createElement('tr');
    
    // User Info formatting with Avatar bubble
    const firstChar = user.name.charAt(0).toUpperCase();
    const userDetailsCell = `
      <div class="user-cell-info">
        <div class="user-avatar-circle">${firstChar}</div>
        <div class="user-names">
          <strong>${user.name} ${isCurrentAdmin ? '👑 (Root)' : ''}</strong>
          <span>${user.email}</span>
        </div>
      </div>
    `;

    // Role cell representation
    const roleText = user.isAdmin ? 
      `<span style="color:var(--vip-gold); font-weight:bold;">Admin</span>` : 
      `<span style="color:var(--text-secondary);">Member</span>`;

    // License key status with validity details
    let keyText = `<span style="color:var(--text-secondary); font-style:italic;">Trial Account</span>`;
    if (user.licenseActivated && user.licenseKey) {
      const expirationDetail = user.licenseExpiresAt ? 
        `<br><span style="font-size:0.7rem; color:var(--text-secondary);">Expires: ${new Date(user.licenseExpiresAt).toLocaleDateString()}</span>` : 
        `<br><span style="font-size:0.7rem; color:var(--vip-gold);">Lifetime VIP</span>`;
      keyText = `<code style="color:var(--accent); font-weight:bold;">${user.licenseKey}</code>${expirationDetail}`;
    }

    // Account state (Banned status)
    const statusText = user.isBanned ? 
      `<span class="badge badge-danger" style="background:rgba(255, 71, 87, 0.15); color:var(--danger);">Banned</span>` : 
      `<span class="badge badge-success" style="background:rgba(46, 213, 115, 0.15); color:var(--success);">Active</span>`;

    // Control buttons based on role type
    let actionsHTML = '';
    if (isCurrentAdmin) {
      actionsHTML = `<span style="color:var(--vip-gold); font-weight:bold; font-size:0.75rem;">System Root Master</span>`;
    } else {
      const keyActionButton = user.licenseActivated ? 
        `<button class="btn btn-warning btn-sm btn-deactivate" data-id="${user.id}">Revoke VIP</button>` : 
        `<button class="btn btn-success btn-sm btn-activate" data-id="${user.id}">Grant VIP</button>`;
        
      const banButtonText = user.isBanned ? 'Unban User' : 'Ban User';
      const banButtonClass = user.isBanned ? 'btn-success' : 'btn-warning';
      const roleToggleText = user.isAdmin ? 'Demote Member' : 'Promote Admin';

      actionsHTML = `
        ${keyActionButton}
        <button class="btn btn-secondary btn-sm btn-toggle-role" data-id="${user.id}" data-admin="${user.isAdmin}">${roleToggleText}</button>
        <button class="btn ${banButtonClass} btn-sm btn-toggle-ban" data-id="${user.id}" data-banned="${user.isBanned}">${banButtonText}</button>
        <button class="btn btn-danger btn-sm btn-delete" data-id="${user.id}">Delete</button>
      `;
    }

    row.innerHTML = `
      <td>${userDetailsCell}</td>
      <td>
        <div class="password-reveal-container">
          <span class="password-masked" id="pass-mask-${user.id}">••••••</span>
          <span class="password-plain" id="pass-plain-${user.id}" style="display:none; font-family:monospace;">${user.plainPasswordText || '••••••'}</span>
          <button class="reveal-btn" data-id="${user.id}" title="Toggle Password Reveal">👁️</button>
        </div>
      </td>
      <td>${roleText}</td>
      <td>${keyText}</td>
      <td>${statusText}</td>
      <td>${actionsHTML}</td>
    `;
    tbody.appendChild(row);
  });

  setupTableActionListeners();
}

// ── Setup Action Handlers inside table ─────────────────────────
function setupTableActionListeners() {
  // Toggle password eye reveal
  document.querySelectorAll('.reveal-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const userId = btn.getAttribute('data-id');
      const maskEl = $(`pass-mask-${userId}`);
      const plainEl = $(`pass-plain-${userId}`);

      if (plainEl.style.display === 'none') {
        plainEl.style.display = 'inline-block';
        maskEl.style.display = 'none';
        btn.textContent = '🔒';
      } else {
        plainEl.style.display = 'none';
        maskEl.style.display = 'inline-block';
        btn.textContent = '👁️';
      }
    });
  });

  // Activate license direct key assignment with duration
  document.querySelectorAll('.btn-activate').forEach(btn => {
    btn.addEventListener('click', async () => {
      const userId = btn.getAttribute('data-id');
      const durationDays = $('key-duration-select').value;
      const result = await window.electronAPI.adminActivateLicense(userId, durationDays);
      if (result.success) {
        alert(`VIP license key successfully assigned and activated!\nKey: ${result.key}\nDuration: ${durationDays === 'lifetime' ? 'Lifetime' : durationDays + ' Days'}`);
        await refreshDashboard();
      } else {
        alert('Activation error: ' + result.error);
      }
    });
  });

  // Deactivate License Key
  document.querySelectorAll('.btn-deactivate').forEach(btn => {
    btn.addEventListener('click', async () => {
      const userId = btn.getAttribute('data-id');
      if (confirm('Revoke VIP license key for this user?')) {
        const result = await window.electronAPI.adminDeactivateLicense(userId);
        if (result.success) {
          await refreshDashboard();
        } else {
          alert('Revocation error: ' + result.error);
        }
      }
    });
  });

  // Toggle user ban
  document.querySelectorAll('.btn-toggle-ban').forEach(btn => {
    btn.addEventListener('click', async () => {
      const userId = btn.getAttribute('data-id');
      const isCurrentlyBanned = btn.getAttribute('data-banned') === 'true';
      const promptText = isCurrentlyBanned ? 'Unban this user account?' : 'Are you sure you want to BAN this user account from logging in?';
      if (confirm(promptText)) {
        const result = await window.electronAPI.toggleUserBan(userId, !isCurrentlyBanned);
        if (result.success) {
          await refreshDashboard();
        } else {
          alert('Ban toggle error: ' + result.error);
        }
      }
    });
  });

  // Toggle user role (Promote / Demote admin)
  document.querySelectorAll('.btn-toggle-role').forEach(btn => {
    btn.addEventListener('click', async () => {
      const userId = btn.getAttribute('data-id');
      const isCurrentlyAdmin = btn.getAttribute('data-admin') === 'true';
      const promptText = isCurrentlyAdmin ? 'Demote this user to a regular Member?' : 'Promote this user to an Administrator?';
      if (confirm(promptText)) {
        const result = await window.electronAPI.toggleUserRole(userId, !isCurrentlyAdmin);
        if (result.success) {
          await refreshDashboard();
        } else {
          alert('Role update error: ' + result.error);
        }
      }
    });
  });

  // Delete User
  document.querySelectorAll('.btn-delete').forEach(btn => {
    btn.addEventListener('click', async () => {
      const userId = btn.getAttribute('data-id');
      if (confirm('Are you sure you want to permanently delete this user account from the database?')) {
        const result = await window.electronAPI.adminDeleteUser(userId);
        if (result.success) {
          await refreshDashboard();
        } else {
          alert('Deletion error: ' + result.error);
        }
      }
    });
  });
}

// ── Live Active Meetings Monitor ──────────────────────────────
async function loadActiveMeetings() {
  const result = await window.electronAPI.getActiveMeetings();
  const tbody = $('active-meetings-table-body');
  
  if (result.success && result.meetings) {
    tbody.innerHTML = '';
    if (result.meetings.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="empty-row" style="text-align:center; color:var(--text-secondary); padding:20px;">No meetings are currently active on the server.</td></tr>';
      return;
    }
    
    result.meetings.forEach(meeting => {
      const row = document.createElement('tr');
      const startTimeFormatted = new Date(meeting.startedAt || meeting.createdAt).toLocaleTimeString('en-US', {
        hour: '2-digit', minute: '2-digit', second: '2-digit'
      });
      const participantCount = meeting.participants ? meeting.participants.length : 0;
      
      row.innerHTML = `
        <td><code style="color:var(--accent); font-weight:bold;">${meeting.id}</code></td>
        <td><b>${meeting.hostName}</b></td>
        <td>${startTimeFormatted}</td>
        <td><span style="font-weight:bold; color:var(--primary-light);">${participantCount}</span> online</td>
        <td>
          <div style="display:flex; gap:6px;">
            <button class="btn btn-warning btn-sm btn-force-end" data-id="${meeting.id}" style="padding: 4px 8px; font-size: 0.8rem; background: var(--warning); border-radius: 4px; border: none; color: #fff; cursor: pointer;">Force End</button>
            <button class="btn btn-danger btn-sm btn-delete-meeting" data-id="${meeting.id}" style="padding: 4px 8px; font-size: 0.8rem; background: var(--danger); border-radius: 4px; border: none; color: #fff; cursor: pointer;">Delete</button>
          </div>
        </td>
      `;
      tbody.appendChild(row);
    });
    
    // Attach listener for force ending meetings
    document.querySelectorAll('.btn-force-end').forEach(btn => {
      btn.addEventListener('click', async () => {
        const meetingId = btn.getAttribute('data-id');
        if (confirm(`Are you sure you want to force terminate meeting: ${meetingId}?`)) {
          const res = await window.electronAPI.endMeeting(meetingId);
          if (res.success) {
            await loadActiveMeetings();
            await loadAdminStats();
          } else {
            alert('Failed to end meeting: ' + res.error);
          }
        }
      });
    });

    // Attach listener for deleting meetings
    document.querySelectorAll('.btn-delete-meeting').forEach(btn => {
      btn.addEventListener('click', async () => {
        const meetingId = btn.getAttribute('data-id');
        if (confirm(`Are you sure you want to completely delete meeting: ${meetingId} from history and database?`)) {
          const res = await window.electronAPI.deleteMeeting(meetingId);
          if (res.success) {
            await loadActiveMeetings();
            await loadAdminStats();
          } else {
            alert('Failed to delete meeting: ' + res.error);
          }
        }
      });
    });
  }
}

// ── Main UI Event Listeners ──────────────────────────────────
function setupEventListeners() {
  // Generate Key with selected duration
  $('btn-generate-key').addEventListener('click', async () => {
    const durationDays = $('key-duration-select').value;
    const result = await window.electronAPI.generateLicenseKey(durationDays);
    if (result.success) {
      $('generated-key-output').value = result.key;
    }
  });

  // Copy Generated Key
  $('btn-copy-gen-key').addEventListener('click', async () => {
    const key = $('generated-key-output').value;
    if (key) {
      await window.electronAPI.copyToClipboard(key);
      alert('Generated license key copied to clipboard!');
    }
  });

  // Export Unused Keys
  $('btn-export-keys').addEventListener('click', async () => {
    const result = await window.electronAPI.exportLicenseKeys();
    if (result.success) {
      alert(`Successfully exported ${result.count} unused license keys!`);
    } else {
      if (result.error !== 'Export cancelled') {
        alert('Export error: ' + result.error);
      }
    }
  });

  // Save System Settings Configurations
  $('btn-save-settings').addEventListener('click', async () => {
    const maintenanceMode = $('maintenance-mode-toggle').checked;
    const maxParticipants = parseInt($('max-participants-input').value, 10) || 150;
    const trialDays = parseInt($('trial-days-input').value, 10) || 7;
    
    const result = await window.electronAPI.updateSystemSettings({
      maintenanceMode,
      maxParticipants,
      trialDays
    });
    
    if (result.success) {
      alert('Global configurations updated successfully!');
      await refreshDashboard();
    } else {
      alert('Configuration save error: ' + result.error);
    }
  });

  // Live Search Filter
  $('user-search-input').addEventListener('input', (e) => {
    const val = e.target.value.toLowerCase().trim();
    if (!val) {
      renderUserTable(allUsers);
      return;
    }

    const filtered = allUsers.filter(user => {
      return (
        user.name.toLowerCase().includes(val) ||
        user.email.toLowerCase().includes(val) ||
        (user.licenseKey && user.licenseKey.toLowerCase().includes(val)) ||
        (user.licenseActivated ? 'activated' : 'not activated').includes(val)
      );
    });

    renderUserTable(filtered);
  });

  // Tab switching
  $('tab-users').addEventListener('click', (e) => {
    e.preventDefault();
    $('tab-users').classList.add('active');
    $('tab-requests').classList.remove('active');
    $('users-section').style.display = 'block';
    $('requests-section').style.display = 'none';
  });

  $('tab-requests').addEventListener('click', (e) => {
    e.preventDefault();
    $('tab-requests').classList.add('active');
    $('tab-users').classList.remove('active');
    $('users-section').style.display = 'none';
    $('requests-section').style.display = 'block';
  });

  // Go to Client App (Home page)
  const btnDashboard = $('btn-dashboard');
  if (btnDashboard) {
    btnDashboard.addEventListener('click', () => {
      window.electronAPI.navigate('home');
    });
  }
}

// ── Pending activations key requests ─────────────────────────
let pendingRequests = [];

async function loadPendingActivations() {
  const result = await window.electronAPI.getPendingActivations();
  const tbody = $('requests-table-body');
  const countBadge = $('badge-requests-count');

  if (result.success && result.list) {
    pendingRequests = result.list;
    
    if (pendingRequests.length > 0) {
      countBadge.textContent = pendingRequests.length;
      countBadge.style.display = 'inline-block';
    } else {
      countBadge.style.display = 'none';
    }

    renderRequestsTable(pendingRequests);
  } else {
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; color:red; padding:20px;">Error loading requests.</td></tr>';
  }
}

function renderRequestsTable(list) {
  const tbody = $('requests-table-body');
  tbody.innerHTML = '';

  if (list.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: var(--text-secondary); padding: 25px;">No pending license requests.</td></tr>';
    return;
  }

  list.forEach(user => {
    const row = document.createElement('tr');
    const firstChar = user.name.charAt(0).toUpperCase();

    row.innerHTML = `
      <td>
        <div class="user-cell-info">
          <div class="user-avatar-circle">${firstChar}</div>
          <div class="user-names">
            <strong>${user.name}</strong>
            <span>${user.email}</span>
          </div>
        </div>
      </td>
      <td><code style="color:var(--accent); font-weight:bold;">${user.pendingKey}</code></td>
      <td>
        <select class="admin-select duration-select" data-email="${user.email}" style="padding: 6px 12px; font-size: 0.9rem; border-radius: 6px; border: 1px solid var(--border); background: rgba(0,0,0,0.3); color:#fff; cursor:pointer;">
          <option value="lifetime">Lifetime VIP</option>
          <option value="30">30 Days VIP</option>
          <option value="360">360 Days VIP</option>
        </select>
      </td>
      <td>
        <div style="display:flex; gap:8px;">
          <button class="btn btn-success btn-sm btn-approve" data-email="${user.email}" style="background: #22c55e; color:#fff; border:none; padding: 6px 12px; border-radius: 4px; cursor:pointer; font-weight:bold;">Approve Access</button>
          <button class="btn btn-danger btn-sm btn-reject" data-email="${user.email}" style="background: #ef4444; color:#fff; border:none; padding: 6px 12px; border-radius: 4px; cursor:pointer; font-weight:bold;">Reject</button>
        </div>
      </td>
    `;
    tbody.appendChild(row);
  });

  // Hook Approve button
  tbody.querySelectorAll('.btn-approve').forEach(btn => {
    btn.addEventListener('click', async () => {
      const email = btn.getAttribute('data-email');
      const row = btn.closest('tr');
      const select = row.querySelector('.duration-select');
      const durationOption = select.value;

      if (confirm(`Approve premium license request for ${email}?`)) {
        const result = await window.electronAPI.approveLicenseActivation(email, durationOption);
        if (result.success) {
          alert('License approved successfully!');
          await refreshDashboard();
        } else {
          alert('Error approving license: ' + result.error);
        }
      }
    });
  });

  // Hook Reject button
  tbody.querySelectorAll('.btn-reject').forEach(btn => {
    btn.addEventListener('click', async () => {
      const email = btn.getAttribute('data-email');
      if (confirm(`Reject pending license request for ${email}?`)) {
        const result = await window.electronAPI.rejectLicenseActivation(email);
        if (result.success) {
          alert('Request rejected.');
          await refreshDashboard();
        } else {
          alert('Error rejecting request: ' + result.error);
        }
      }
    });
  });
}

// ── Refresh Dashboard contents ────────────────────────────────
async function refreshDashboard() {
  await loadAdminStats();
  await loadUsersList();
  await loadPendingActivations();
  await loadActiveMeetings();
}

window.addEventListener('beforeunload', () => {
  if (activeMeetingsPollingInterval) {
    clearInterval(activeMeetingsPollingInterval);
  }
});
