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
  try {
    const result = await window.electronAPI.getCurrentUser();
    if (!result.success || !result.user.isAdmin) {
      showAdminToast('Access Denied: You are not authorized to view the admin panel.', 'error');
      window.electronAPI.navigate('home');
    }
  } catch(e) {
    console.warn('[Admin] verifyAdminAccess error:', e);
  }
}

// ── Load Stats ───────────────────────────────────────────────
async function loadAdminStats() {
  try {
    const result = await window.electronAPI.getAdminStats();
    if (result.success) {
      const stats = result.stats;
      if ($('stats-total-users')) $('stats-total-users').textContent = stats.totalUsers;
      if ($('stats-active-keys')) $('stats-active-keys').textContent = stats.activeLicenses;
      if ($('stats-live-meetings')) $('stats-live-meetings').textContent = stats.activeMeetings;
    }
  } catch(e) {
    console.warn('[Admin] loadAdminStats error:', e);
  }
}

// ── Load Global System Settings ────────────────────────────────
async function loadSystemSettings() {
  try {
    const result = await window.electronAPI.getSystemSettings();
    if (result.success && result.settings) {
      if ($('maintenance-mode-toggle')) $('maintenance-mode-toggle').checked = !!result.settings.maintenanceMode;
      if ($('max-participants-input')) $('max-participants-input').value = result.settings.maxParticipants || 150;
      if ($('trial-days-input')) $('trial-days-input').value = result.settings.trialDays || 7;
    }
  } catch(e) {
    console.warn('[Admin] loadSystemSettings error:', e);
  }
}

// ── Load Users database table ────────────────────────────────
async function loadUsersList() {
  try {
    const result = await window.electronAPI.getAllUsers();
    const tbody = $('user-table-body');

    if (result.success && result.users) {
      allUsers = result.users;
      renderUserTable(allUsers);
    } else {
      if (tbody) tbody.innerHTML = '<tr><td colspan="6" class="loading-error">Error loading user list.</td></tr>';
    }
  } catch(e) {
    console.warn('[Admin] loadUsersList error:', e);
  }
}

function renderUserTable(usersList) {
  const tbody = $('user-table-body');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (usersList.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty-row">No matching users found.</td></tr>';
    return;
  }

  usersList.forEach(user => {
    const isCurrentAdmin = (user.email === 'admin@atikmeet.com');
    const row = document.createElement('tr');

    // Username with Avatar
    const firstChar = user.name ? user.name.charAt(0).toUpperCase() : 'U';
    const userCell = `
      <div class="user-cell">
        <div class="user-avatar-circle">${firstChar}</div>
        <strong>${user.name || 'User'} ${isCurrentAdmin ? '👑' : ''}</strong>
      </div>
    `;

    // Role pill badge
    const rolePill = user.isAdmin ?
      `<span class="role-pill admin">ADMIN</span>` :
      `<span class="role-pill user">USER</span>`;

    // Status dot
    const statusDot = `<span class="status-indicator"><span class="status-dot"></span> Online</span>`;

    // Ban status toggle
    const banStatus = user.isBanned ?
      `<span class="ban-switch-label"><span class="ban-badge banned">Banned</span></span>` :
      `<span class="ban-switch-label"><span class="ban-badge active">Active</span></span>`;

    // Registration date
    const regDate = user.createdAt ? new Date(user.createdAt).toLocaleDateString() : '15/01/2026';

    // Actions
    let actionsHTML = '';
    if (isCurrentAdmin) {
      actionsHTML = `<span style="color:#60a5fa; font-weight:bold; font-size:0.75rem;">Root Master</span>`;
    } else {
      const keyActionButton = user.licenseActivated ?
        `<button class="btn btn-warning btn-sm btn-deactivate" data-id="${user.id}">Revoke VIP</button>` :
        `<button class="btn btn-success btn-sm btn-activate" data-id="${user.id}">Grant VIP</button>`;

      const banButtonText = user.isBanned ? 'Unban' : 'Ban';
      const banButtonClass = user.isBanned ? 'btn-success' : 'btn-warning';

      actionsHTML = `
        ${keyActionButton}
        <button class="btn ${banButtonClass} btn-sm btn-toggle-ban" data-id="${user.id}" data-banned="${user.isBanned}">${banButtonText}</button>
        <button class="btn btn-danger btn-sm btn-delete" data-id="${user.id}">Delete</button>
      `;
    }

    row.innerHTML = `
      <td>${userCell}</td>
      <td><span style="color:#a0a0b5;">${user.email}</span></td>
      <td>${rolePill}</td>
      <td>${statusDot}</td>
      <td>${banStatus}</td>
      <td><span style="color:#64748b; font-size:0.75rem;">${regDate}</span></td>
      <td>${actionsHTML}</td>
    `;
    tbody.appendChild(row);
  });

  setupTableActionListeners();
}

// ── Setup Action Handlers inside table ─────────────────────────
function setupTableActionListeners() {
  // Activate license direct key assignment with duration
  document.querySelectorAll('.btn-activate').forEach(btn => {
    btn.addEventListener('click', async () => {
      const userId = btn.getAttribute('data-id');
      const durationSelect = $('key-duration-select');
      const durationDays = durationSelect ? durationSelect.value : 'lifetime';
      try {
        const result = await window.electronAPI.adminActivateLicense(userId, durationDays);
        if (result.success) {
          showAdminToast(`✅ VIP license assigned! Key: ${result.key}`);
          await refreshDashboard();
        } else {
          showAdminToast('❌ Activation error: ' + result.error, 'error');
        }
      } catch(e) { showAdminToast('❌ Activation failed', 'error'); }
    });
  });

  // Deactivate License Key
  document.querySelectorAll('.btn-deactivate').forEach(btn => {
    btn.addEventListener('click', async () => {
      const userId = btn.getAttribute('data-id');
      if (confirm('Revoke VIP license key for this user?')) {
        try {
          const result = await window.electronAPI.adminDeactivateLicense(userId);
          if (result.success) {
            showAdminToast('✅ VIP license revoked.');
            await refreshDashboard();
          } else {
            showAdminToast('❌ Revocation error: ' + result.error, 'error');
          }
        } catch(e) { showAdminToast('❌ Revocation failed', 'error'); }
      }
    });
  });

  // Toggle user ban
  document.querySelectorAll('.btn-toggle-ban').forEach(btn => {
    btn.addEventListener('click', async () => {
      const userId = btn.getAttribute('data-id');
      const isCurrentlyBanned = btn.getAttribute('data-banned') === 'true';
      const promptText = isCurrentlyBanned ? 'Unban this user account?' : 'Are you sure you want to BAN this user?';
      if (confirm(promptText)) {
        try {
          const result = await window.electronAPI.toggleUserBan(userId, !isCurrentlyBanned);
          if (result.success) {
            showAdminToast(isCurrentlyBanned ? '✅ User unbanned.' : '🚫 User banned.');
            await refreshDashboard();
          } else {
            showAdminToast('❌ Ban toggle error: ' + result.error, 'error');
          }
        } catch(e) { showAdminToast('❌ Ban toggle failed', 'error'); }
      }
    });
  });

  // Toggle user role (Promote / Demote admin)
  document.querySelectorAll('.btn-toggle-role').forEach(btn => {
    btn.addEventListener('click', async () => {
      const userId = btn.getAttribute('data-id');
      const isCurrentlyAdmin = btn.getAttribute('data-admin') === 'true';
      const promptText = isCurrentlyAdmin ? 'Demote this user to regular Member?' : 'Promote this user to Administrator?';
      if (confirm(promptText)) {
        try {
          const result = await window.electronAPI.toggleUserRole(userId, !isCurrentlyAdmin);
          if (result.success) {
            showAdminToast(isCurrentlyAdmin ? '✅ User demoted.' : '✅ User promoted to Admin.');
            await refreshDashboard();
          } else {
            showAdminToast('❌ Role update error: ' + result.error, 'error');
          }
        } catch(e) { showAdminToast('❌ Role update failed', 'error'); }
      }
    });
  });

  // Delete User
  document.querySelectorAll('.btn-delete').forEach(btn => {
    btn.addEventListener('click', async () => {
      const userId = btn.getAttribute('data-id');
      if (confirm('Are you sure you want to permanently delete this user account from the database?')) {
        try {
          const result = await window.electronAPI.adminDeleteUser(userId);
          if (result.success) {
            showAdminToast('✅ User deleted from database.');
            await refreshDashboard();
          } else {
            showAdminToast('❌ Deletion error: ' + result.error, 'error');
          }
        } catch(e) { showAdminToast('❌ Deletion failed', 'error'); }
      }
    });
  });
}

// ── Live Active Meetings Monitor ──────────────────────────────
async function loadActiveMeetings() {
  try {
    const result = await window.electronAPI.getActiveMeetings();
    const tbody = $('active-meetings-table-body');
    if (!tbody) return;

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
          if (confirm(`Force terminate meeting: ${meetingId}?`)) {
            try {
              const res = await window.electronAPI.endMeeting(meetingId);
              if (res.success) {
                showAdminToast('✅ Meeting force ended.');
                await loadActiveMeetings();
                await loadAdminStats();
              } else {
                showAdminToast('❌ Failed to end meeting: ' + res.error, 'error');
              }
            } catch(e) { showAdminToast('❌ Failed to end meeting', 'error'); }
          }
        });
      });

      // Attach listener for deleting meetings
      document.querySelectorAll('.btn-delete-meeting').forEach(btn => {
        btn.addEventListener('click', async () => {
          const meetingId = btn.getAttribute('data-id');
          if (confirm(`Delete meeting ${meetingId} from history and database?`)) {
            try {
              const res = await window.electronAPI.deleteMeeting(meetingId);
              if (res.success) {
                showAdminToast('✅ Meeting deleted.');
                await loadActiveMeetings();
                await loadAdminStats();
              } else {
                showAdminToast('❌ Failed to delete meeting: ' + res.error, 'error');
              }
            } catch(e) { showAdminToast('❌ Failed to delete meeting', 'error'); }
          }
        });
      });
    }
  } catch(e) {
    console.warn('[Admin] loadActiveMeetings error:', e);
  }
}

// ── Toast Notification System ──────────────────────────────────
function showAdminToast(message, type = 'success') {
  let toastContainer = $('admin-toast-container');
  if (!toastContainer) {
    toastContainer = document.createElement('div');
    toastContainer.id = 'admin-toast-container';
    toastContainer.style.cssText = `
      position: fixed; top: 70px; right: 20px; z-index: 99999;
      display: flex; flex-direction: column; gap: 8px; pointer-events: none;
    `;
    document.body.appendChild(toastContainer);
  }

  const toast = document.createElement('div');
  const bgColor = type === 'error' ? 'rgba(239,68,68,0.95)' : 'rgba(16,185,129,0.95)';
  toast.style.cssText = `
    background: ${bgColor}; color: #fff; padding: 10px 16px; border-radius: 8px;
    font-size: 0.85rem; font-weight: 500; pointer-events: all;
    box-shadow: 0 4px 20px rgba(0,0,0,0.5); max-width: 320px;
    animation: slideInRight 0.3s ease;
    transition: opacity 0.3s ease;
  `;
  toast.textContent = message;
  toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// ── Admin Tab Section Switcher ─────────────────────────────────
const ADMIN_SECTIONS = {
  'tab-users': 'section-dashboard',
  'tab-meetings': 'section-meetings',
  'tab-users-nav': 'section-users',
  'tab-requests': 'section-requests',
  'tab-settings': 'section-settings',
};

function switchAdminTab(tabId) {
  // Remove active from all nav items
  document.querySelectorAll('.admin-sidebar .nav-item').forEach(item => {
    item.classList.remove('active');
  });
  const tabEl = $(tabId);
  if (tabEl) tabEl.classList.add('active');

  // Show/hide sections
  Object.values(ADMIN_SECTIONS).forEach(secId => {
    const el = $(secId);
    if (el) el.style.display = 'none';
  });

  const targetSecId = ADMIN_SECTIONS[tabId];
  const targetEl = $(targetSecId);
  if (targetEl) {
    targetEl.style.display = '';
    targetEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

// ── Main UI Event Listeners ──────────────────────────────────
function setupEventListeners() {
  // Generate Key with selected duration
  const btnGenerateKey = $('btn-generate-key');
  if (btnGenerateKey) {
    btnGenerateKey.addEventListener('click', async () => {
      try {
        const durationDays = $('key-duration-select') ? $('key-duration-select').value : 'lifetime';
        const result = await window.electronAPI.generateLicenseKey(durationDays);
        if (result.success) {
          if ($('generated-key-output')) $('generated-key-output').value = result.key;
          showAdminToast('✅ New license key generated!');
        } else {
          showAdminToast('❌ Key generation failed: ' + result.error, 'error');
        }
      } catch(e) {
        showAdminToast('❌ Key generation error', 'error');
      }
    });
  }

  // Copy Generated Key
  const btnCopyGenKey = $('btn-copy-gen-key');
  if (btnCopyGenKey) {
    btnCopyGenKey.addEventListener('click', async () => {
      const keyEl = $('generated-key-output');
      const key = keyEl ? keyEl.value : '';
      if (key) {
        try {
          await window.electronAPI.copyToClipboard(key);
          showAdminToast('✅ License key copied to clipboard!');
        } catch(e) {
          showAdminToast('❌ Copy failed', 'error');
        }
      } else {
        showAdminToast('⚠️ No key to copy. Generate one first.', 'error');
      }
    });
  }

  // Export Unused Keys
  const btnExportKeys = $('btn-export-keys');
  if (btnExportKeys) {
    btnExportKeys.addEventListener('click', async () => {
      try {
        const result = await window.electronAPI.exportLicenseKeys();
        if (result.success) {
          showAdminToast(`✅ Exported ${result.count} unused license keys!`);
        } else {
          if (result.error !== 'Export cancelled') {
            showAdminToast('❌ Export error: ' + result.error, 'error');
          }
        }
      } catch(e) {
        showAdminToast('❌ Export failed', 'error');
      }
    });
  }

  // Save System Settings Configurations
  const btnSaveSettings = $('btn-save-settings');
  if (btnSaveSettings) {
    btnSaveSettings.addEventListener('click', async () => {
      try {
        const maintenanceMode = $('maintenance-mode-toggle') ? $('maintenance-mode-toggle').checked : false;
        const maxParticipants = $('max-participants-input') ? (parseInt($('max-participants-input').value, 10) || 150) : 150;
        const trialDays = $('trial-days-input') ? (parseInt($('trial-days-input').value, 10) || 7) : 7;

        const result = await window.electronAPI.updateSystemSettings({
          maintenanceMode,
          maxParticipants,
          trialDays
        });

        if (result.success) {
          showAdminToast('✅ Global configurations saved successfully!');
          await refreshDashboard();
        } else {
          showAdminToast('❌ Configuration save error: ' + result.error, 'error');
        }
      } catch(e) {
        showAdminToast('❌ Settings save failed', 'error');
      }
    });
  }

  // Admin Notification Modal Trigger
  const notifModal = $('notification-modal');
  const closeNotifBtn = $('close-notification-modal');

  document.querySelectorAll('.header-icon-btn, .notification-btn').forEach(btn => {
    if (btn.getAttribute('title') === 'Notifications' || btn.classList.contains('notification-btn')) {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        if (notifModal) {
          notifModal.style.display = 'flex';
        }
      });
    }
  });

  if (closeNotifBtn) {
    closeNotifBtn.addEventListener('click', () => {
      if (notifModal) notifModal.style.display = 'none';
    });
  }

  // Close modal on overlay click
  if (notifModal) {
    notifModal.addEventListener('click', (e) => {
      if (e.target === notifModal) notifModal.style.display = 'none';
    });
  }

  // Live Search Filter
  const setupSearch = (inputId) => {
    const el = $(inputId);
    if (!el) return;
    el.addEventListener('input', (e) => {
      const val = e.target.value.toLowerCase().trim();
      if (!val) {
        renderUserTable(allUsers);
        return;
      }

      const filtered = allUsers.filter(user => {
        return (
          (user.name && user.name.toLowerCase().includes(val)) ||
          (user.email && user.email.toLowerCase().includes(val)) ||
          (user.licenseKey && user.licenseKey.toLowerCase().includes(val)) ||
          (user.licenseActivated ? 'activated' : 'not activated').includes(val)
        );
      });

      renderUserTable(filtered);
    });
  };

  setupSearch('user-search-input');
  setupSearch('admin-global-search');

  // ── Sidebar Tab Navigation ─────────────────────────────────
  const bindTab = (tabId) => {
    const el = $(tabId);
    if (el) {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        switchAdminTab(tabId);
      });
    }
  };

  bindTab('tab-users');
  bindTab('tab-users-nav');
  bindTab('tab-meetings');
  bindTab('tab-requests');
  bindTab('tab-settings');

  // Go to Client App (Home page)
  const btnDashboard = $('btn-dashboard');
  if (btnDashboard) {
    btnDashboard.addEventListener('click', () => {
      window.electronAPI.navigate('home');
    });
  }

  // Initialize — show dashboard section by default
  switchAdminTab('tab-users');
}

// ── Pending activations key requests ─────────────────────────
let pendingRequests = [];

async function loadPendingActivations() {
  try {
    const result = await window.electronAPI.getPendingActivations();
    const tbody = $('requests-table-body');
    const countBadge = $('badge-requests-count');

    if (result.success && result.list) {
      pendingRequests = result.list;

      if (pendingRequests.length > 0) {
        if (countBadge) {
          countBadge.textContent = pendingRequests.length;
          countBadge.style.display = 'inline-block';
        }
      } else {
        if (countBadge) countBadge.style.display = 'none';
      }

      renderRequestsTable(pendingRequests);
    } else {
      if (tbody) tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; color:red; padding:20px;">Error loading requests.</td></tr>';
    }
  } catch(e) {
    console.warn('[Admin] loadPendingActivations error:', e);
  }
}

function renderRequestsTable(list) {
  const tbody = $('requests-table-body');
  if (!tbody) return;
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
      const durationOption = select ? select.value : 'lifetime';

      if (confirm(`Approve premium license request for ${email}?`)) {
        try {
          const result = await window.electronAPI.approveLicenseActivation(email, durationOption);
          if (result.success) {
            showAdminToast('✅ License approved successfully!');
            await refreshDashboard();
          } else {
            showAdminToast('❌ Error approving license: ' + result.error, 'error');
          }
        } catch(e) { showAdminToast('❌ Approval failed', 'error'); }
      }
    });
  });

  // Hook Reject button
  tbody.querySelectorAll('.btn-reject').forEach(btn => {
    btn.addEventListener('click', async () => {
      const email = btn.getAttribute('data-email');
      if (confirm(`Reject pending license request for ${email}?`)) {
        try {
          const result = await window.electronAPI.rejectLicenseActivation(email);
          if (result.success) {
            showAdminToast('✅ Request rejected.');
            await refreshDashboard();
          } else {
            showAdminToast('❌ Error rejecting request: ' + result.error, 'error');
          }
        } catch(e) { showAdminToast('❌ Rejection failed', 'error'); }
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
