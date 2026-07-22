/**
 * ============================================================
 *  AtikMeet - Dashboard Module (Renderer Process)
 *  Manages sidebar navigation, meeting creation, copy details,
 *  redirect to browsers, recent meetings lists and admin visibility.
 * ============================================================
 */

// ── DOM Utilities ────────────────────────────────────────────
function $(id) {
  return document.getElementById(id);
}

let generatedMeetingLink = '';
let currentUser = null;

document.addEventListener('DOMContentLoaded', async () => {
  await loadUserData();
  await checkTrialStatus();
  await loadRecentMeetings();
  setupEventListeners();
  await checkForUpdates();
});

// ── Load User Details ────────────────────────────────────────
async function loadUserData() {
  try {
    const result = await window.electronAPI.getCurrentUser();
    if (result.success) {
      currentUser = result.user;

      // Update Sidebar Profile
      if ($('user-display-name')) $('user-display-name').textContent = currentUser.name;
      if ($('user-display-role')) $('user-display-role').textContent = currentUser.isAdmin ? 'Developer & Admin' : 'Member';

      const profileAvatar = $('profile-avatar');
      if (profileAvatar) profileAvatar.textContent = currentUser.name.charAt(0).toUpperCase();

      // Load custom profile picture if exists
      try {
        let avatarData = null;
        if (window.electronAPI && window.electronAPI.getAvatar) {
          const avRes = await window.electronAPI.getAvatar();
          if (avRes && avRes.success && avRes.dataUrl) {
            avatarData = avRes.dataUrl;
          }
        } else {
          avatarData = localStorage.getItem('atikmeet_avatar');
        }
        if (avatarData) {
          const avImg = $('profile-avatar-img');
          const avChar = $('profile-avatar');
          if (avImg) {
            avImg.src = avatarData;
            avImg.style.display = 'block';
          }
          if (avChar) {
            avChar.style.display = 'none';
          }
        }
      } catch (e) {
        console.warn('Failed to load avatar in dashboard:', e);
      }

      // Set Welcome Header
      if ($('welcome-text')) $('welcome-text').textContent = `Welcome back, ${currentUser.name.split(' ')[0]}!`;

      // Set formatted date
      const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
      if ($('current-date')) $('current-date').textContent = new Date().toLocaleDateString('en-US', options);

      // VIP Badges (null-guarded)
      const vipBadgeIcon = $('vip-badge-icon');
      const vipStatusContainer = $('vip-status-container');
      if (currentUser.isVIP) {
        if (vipBadgeIcon) vipBadgeIcon.style.display = 'flex';
        if (vipStatusContainer) vipStatusContainer.style.display = 'block';
      }

      // Admin Sidebar Option
      const navAdmin = $('nav-admin');
      if (currentUser.isAdmin && navAdmin) {
        navAdmin.style.display = 'flex';
      }
    } else {
      // If not logged in, force navigation back to login
      window.electronAPI.navigate('login');
    }
  } catch(e) {
    console.warn('[Home] loadUserData error:', e);
  }
}

// ── Check Trial / License Status ──────────────────────────────
async function checkTrialStatus() {
  try {
    const status = await window.electronAPI.getTrialStatus();
    if (status.success) {
      const banner = $('license-banner');
      const bannerText = $('license-banner-text');
      const upgradeBtn = $('banner-activate-btn');

      if (status.pendingKey) {
        if (banner) {
          banner.style.display = 'flex';
          banner.style.background = 'linear-gradient(90deg, rgba(245, 158, 11, 0.25), rgba(245, 158, 11, 0.15))';
        }
        if (bannerText) bannerText.innerHTML = `⏳ <b>Activation Pending Approval:</b> Waiting for administrator to review and activate key: <b>${status.pendingKey}</b>`;
        if (upgradeBtn) upgradeBtn.style.display = 'none';
      } else if (status.isActivated) {
        if (banner) banner.style.display = 'none'; // Premium active, hide banner
      } else if (status.isExpired) {
        if (banner) {
          banner.style.display = 'flex';
          banner.style.background = 'linear-gradient(90deg, rgba(255, 71, 87, 0.25), rgba(255, 71, 87, 0.15))';
        }
        if (bannerText) bannerText.innerHTML = `⚠️ <b>Trial Period Expired!</b> Your 7-day trial has ended. Please activate your license to continue using AtikMeet.`;
        if (upgradeBtn) {
          upgradeBtn.textContent = 'Activate Key';
          upgradeBtn.style.display = 'inline-block';
        }
        const createBtn = $('btn-create-meeting');
        if (createBtn) {
          createBtn.style.pointerEvents = 'none';
          createBtn.style.opacity = '0.5';
          createBtn.title = "Please activate your license to start meetings";
        }
        const joinBtn = $('btn-join-meeting');
        if (joinBtn) joinBtn.disabled = true;
      } else {
        if (banner) {
          banner.style.display = 'flex';
          banner.style.background = 'rgba(255, 255, 255, 0.04)';
        }
        if (bannerText) bannerText.innerHTML = `⏳ <b>Free Trial:</b> You have <b>${status.daysRemaining} days</b> left in your free trial. Activate to get permanent VIP features!`;
        if (upgradeBtn) {
          upgradeBtn.textContent = 'Upgrade to VIP';
          upgradeBtn.style.display = 'inline-block';
        }
      }
    }
  } catch(e) {
    console.warn('[Home] checkTrialStatus error:', e);
  }
}

// ── Load Recent Meetings ─────────────────────────────────────
async function loadRecentMeetings() {
  try {
    const result = await window.electronAPI.getRecentMeetings();
    const tableBody = $('meetings-table-body');
    if (!tableBody) return;

    if (result.success && result.meetings && result.meetings.length > 0) {
      tableBody.innerHTML = '';

      // Display up to 5 recent meetings
      result.meetings.slice(-5).reverse().forEach(meeting => {
        const row = document.createElement('tr');
        const dateStr = new Date(meeting.createdAt || meeting.startedAt).toLocaleDateString('en-US', {
          month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
        });
        const statusBadge = meeting.isActive ?
          '<span class="badge badge-success">Active</span>' :
          '<span class="badge badge-secondary">Ended</span>';

        const rejoinBtn = meeting.isActive ?
          `<button class="btn btn-accent btn-sm join-btn-table" data-id="${meeting.id}">Rejoin</button>` :
          '';

        const deleteBtn = `<button class="btn btn-danger btn-sm delete-btn-table" data-id="${meeting.id}" style="padding: 4px 8px; min-width: auto; background: rgba(255, 71, 87, 0.2); border: 1px solid rgba(255, 71, 87, 0.5); color: #ff4757; border-radius: 4px; cursor: pointer; margin-left: 6px;" title="Delete Meeting History">✕</button>`;

        row.innerHTML = `
          <td><code style="color:var(--accent); font-weight:bold;">${meeting.id}</code></td>
          <td>${meeting.hostName}</td>
          <td>${statusBadge}</td>
          <td>${dateStr}</td>
          <td>
            <div style="display: flex; align-items: center;">
              ${rejoinBtn}
              ${deleteBtn}
            </div>
          </td>
        `;
        tableBody.appendChild(row);
      });

      // Add re-join event listeners to tables
      document.querySelectorAll('.join-btn-table').forEach(btn => {
        btn.addEventListener('click', () => {
          const id = btn.getAttribute('data-id');
          joinMeeting(id);
        });
      });

      // Add delete event listeners to tables
      document.querySelectorAll('.delete-btn-table').forEach(btn => {
        btn.addEventListener('click', async () => {
          const id = btn.getAttribute('data-id');
          if (confirm(`Delete meeting ${id} from history?`)) {
            try {
              const res = await window.electronAPI.deleteMeeting(id);
              if (res.success) {
                await loadRecentMeetings();
              } else {
                showToast('❌ Failed to delete meeting: ' + res.error, 'error');
              }
            } catch(e) { showToast('❌ Delete failed', 'error'); }
          }
        });
      });
    } else {
      tableBody.innerHTML = '<tr><td colspan="5" class="empty-row">No meetings found. Start a new one!</td></tr>';
    }
  } catch(e) {
    console.warn('[Home] loadRecentMeetings error:', e);
  }
}

// ── Toast Notification ────────────────────────────────────────
function showToast(message, type = 'success') {
  let tc = $('home-toast-container');
  if (!tc) {
    tc = document.createElement('div');
    tc.id = 'home-toast-container';
    tc.style.cssText = `
      position: fixed; top: 70px; right: 20px; z-index: 99999;
      display: flex; flex-direction: column; gap: 8px; pointer-events: none;
    `;
    document.body.appendChild(tc);
  }

  const toast = document.createElement('div');
  const bg = type === 'error' ? 'rgba(239,68,68,0.95)' : 'rgba(16,185,129,0.95)';
  toast.style.cssText = `
    background: ${bg}; color: #fff; padding: 10px 16px; border-radius: 8px;
    font-size: 0.85rem; font-weight: 500; pointer-events: all;
    box-shadow: 0 4px 20px rgba(0,0,0,0.5); max-width: 320px;
    animation: slideInRight 0.3s ease; transition: opacity 0.3s ease;
  `;
  toast.textContent = message;
  tc.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// ── Feature Modal Helper ──────────────────────────────────────
function openFeatureModal(title, htmlBody, color = '#3b82f6') {
  const featureModal = $('feature-modal');
  const titleEl = $('feature-modal-title');
  const bodyEl = $('feature-modal-body');
  const borderEl = featureModal ? featureModal.querySelector('.modal-card') : null;

  if (featureModal && titleEl && bodyEl) {
    titleEl.textContent = title;
    titleEl.style.color = color;
    bodyEl.innerHTML = htmlBody;
    if (borderEl) borderEl.style.borderColor = color + '66';
    featureModal.style.display = 'flex';
  }
}

// ── Event Handlers ───────────────────────────────────────────
function setupEventListeners() {
  // Notification Modal Trigger
  const notifModal = $('notification-modal');
  const closeNotifBtn = $('close-notification-modal');

  document.querySelectorAll('.header-icon-btn').forEach(btn => {
    if (btn.getAttribute('title') === 'Notifications') {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        if (notifModal) notifModal.style.display = 'flex';
      });
    }
  });

  if (closeNotifBtn) {
    closeNotifBtn.addEventListener('click', () => {
      if (notifModal) notifModal.style.display = 'none';
    });
  }

  // Close notification modal on overlay click
  if (notifModal) {
    notifModal.addEventListener('click', (e) => {
      if (e.target === notifModal) notifModal.style.display = 'none';
    });
  }

  // Close feature modal
  const closeFeatureBtn = $('close-feature-modal');
  if (closeFeatureBtn) {
    closeFeatureBtn.addEventListener('click', () => {
      const featureModal = $('feature-modal');
      if (featureModal) featureModal.style.display = 'none';
    });
  }

  const featureModalEl = $('feature-modal');
  if (featureModalEl) {
    featureModalEl.addEventListener('click', (e) => {
      if (e.target === featureModalEl) featureModalEl.style.display = 'none';
    });
  }

  // ── Sidebar Nav Items Navigation ──────────────────────────
  const navHome = $('nav-home');
  if (navHome) {
    navHome.addEventListener('click', (e) => {
      e.preventDefault();
      setActiveNavItem(navHome);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  const navMeetings = $('nav-meetings');
  if (navMeetings) {
    navMeetings.addEventListener('click', (e) => {
      e.preventDefault();
      setActiveNavItem(navMeetings);
      const meetingSection = document.querySelector('.recent-history-section');
      if (meetingSection) meetingSection.scrollIntoView({ behavior: 'smooth' });
    });
  }

  const navCalendar = $('nav-calendar');
  if (navCalendar) {
    navCalendar.addEventListener('click', (e) => {
      e.preventDefault();
      setActiveNavItem(navCalendar);
      openFeatureModal('📅 Schedule Calendar', `
        <div style="text-align: center; padding: 10px 0;">
          <div style="font-size: 3rem; margin-bottom: 12px;">🗓️</div>
          <h4 style="color: #00d4aa; margin-bottom: 8px;">Meeting Calendar</h4>
          <p style="color: #a0a0b5; margin-bottom: 16px;">You have <strong style="color:#fff;">0 scheduled meetings</strong> for today.</p>
          <div style="background: rgba(0,212,170,0.08); border: 1px solid rgba(0,212,170,0.2); padding: 12px 16px; border-radius: 8px; font-size: 0.82rem; text-align: left;">
            <div style="color: #00d4aa; font-weight: bold; margin-bottom: 4px;">💡 Pro Tip</div>
            <span style="color: #a0a0b5;">You can start an instant meeting anytime using the <strong style="color:#fff;">Start Meeting Now</strong> quick action card on your dashboard.</span>
          </div>
          <div style="margin-top: 16px; display: flex; gap: 8px; justify-content: center;">
            <div style="background: rgba(255,255,255,0.05); padding: 10px 20px; border-radius: 8px; font-size: 0.78rem; color: #64748b;">No upcoming events</div>
          </div>
        </div>
      `, '#00d4aa');
    });
  }

  const navContacts = $('nav-contacts');
  if (navContacts) {
    navContacts.addEventListener('click', (e) => {
      e.preventDefault();
      setActiveNavItem(navContacts);
      openFeatureModal('👥 Contacts & Team', `
        <div style="text-align: center; padding: 10px 0;">
          <div style="font-size: 3rem; margin-bottom: 12px;">👥</div>
          <h4 style="color: #3b82f6; margin-bottom: 8px;">Direct Contacts</h4>
          <p style="color: #a0a0b5; margin-bottom: 16px;">Instant invitation link sharing is enabled for all team members.</p>
          <div style="background: rgba(59,130,246,0.08); border: 1px solid rgba(59,130,246,0.2); padding: 12px 16px; border-radius: 8px; font-size: 0.82rem; text-align: left;">
            <div style="color: #3b82f6; font-weight: bold; margin-bottom: 4px;">🔗 Share Meetings</div>
            <span style="color: #a0a0b5;">Share generated meeting URLs directly with your colleagues for instant 1-click joining. Use the <strong style="color:#fff;">Copy Link</strong> button after creating a meeting.</span>
          </div>
          <div style="margin-top: 16px; padding: 10px; background: rgba(255,255,255,0.03); border-radius: 8px; font-size: 0.78rem; color: #64748b;">
            0 contacts saved
          </div>
        </div>
      `, '#3b82f6');
    });
  }

  const navChat = $('nav-chat');
  if (navChat) {
    navChat.addEventListener('click', (e) => {
      e.preventDefault();
      setActiveNavItem(navChat);
      openFeatureModal('💬 In-Meeting Messaging', `
        <div style="text-align: center; padding: 10px 0;">
          <div style="font-size: 3rem; margin-bottom: 12px;">💬</div>
          <h4 style="color: #a855f7; margin-bottom: 8px;">Live Room Chat</h4>
          <p style="color: #a0a0b5; margin-bottom: 16px;">End-to-end encrypted room chat activates automatically when you enter or host a meeting.</p>
          <div style="background: rgba(168,85,247,0.08); border: 1px solid rgba(168,85,247,0.2); padding: 12px 16px; border-radius: 8px; font-size: 0.82rem; text-align: left;">
            <div style="color: #a855f7; font-weight: bold; margin-bottom: 4px;">🔒 End-to-End Encrypted</div>
            <span style="color: #a0a0b5;">All chat messages inside meetings are encrypted with AES-256-GCM. Messages are only visible to room participants.</span>
          </div>
          <div style="margin-top: 12px; font-size: 0.78rem; color: #64748b;">Join a meeting to start chatting</div>
        </div>
      `, '#a855f7');
    });
  }

  const navRecordings = $('nav-recordings');
  if (navRecordings) {
    navRecordings.addEventListener('click', (e) => {
      e.preventDefault();
      setActiveNavItem(navRecordings);
      openFeatureModal('🎥 Screen Recordings', `
        <div style="text-align: center; padding: 10px 0;">
          <div style="font-size: 3rem; margin-bottom: 12px;">🎥</div>
          <h4 style="color: #ef4444; margin-bottom: 8px;">Local Screen Recording Storage</h4>
          <p style="color: #a0a0b5; margin-bottom: 16px;">All recorded video sessions are saved locally in high-definition MP4 format.</p>
          <div style="background: rgba(239,68,68,0.08); border: 1px solid rgba(239,68,68,0.2); padding: 12px 16px; border-radius: 8px; font-size: 0.82rem; text-align: left;">
            <div style="color: #ef4444; font-weight: bold; margin-bottom: 4px;">📁 Storage Location</div>
            <span style="color: #a0a0b5;">Recordings are saved to <strong style="color:#fff;">Videos/AtikMeet</strong> directory on your device. No cloud storage used — 100% local and private.</span>
          </div>
          <div style="margin-top: 12px; font-size: 0.78rem; color: #64748b;">No recordings found</div>
        </div>
      `, '#ef4444');
    });
  }

  const navProfile = $('nav-profile');
  if (navProfile) {
    navProfile.addEventListener('click', (e) => {
      e.preventDefault();
      window.electronAPI.navigate('profile');
    });
  }

  const navLicense = $('nav-license');
  if (navLicense) {
    navLicense.addEventListener('click', (e) => {
      e.preventDefault();
      window.electronAPI.navigate('license');
    });
  }

  const navAdmin = $('nav-admin');
  if (navAdmin) {
    navAdmin.addEventListener('click', (e) => {
      e.preventDefault();
      window.electronAPI.navigate('admin');
    });
  }

  const bannerActivate = $('banner-activate-btn');
  if (bannerActivate) {
    bannerActivate.addEventListener('click', () => {
      window.electronAPI.navigate('license');
    });
  }

  const logoutBtn = $('logout-btn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      window.electronAPI.logout();
    });
  }

  // ── Create Meeting Card & Button ──────────────────────────
  const btnCreateMeeting = $('btn-create-meeting');
  if (btnCreateMeeting) {
    btnCreateMeeting.addEventListener('click', async () => {
      try {
        const result = await window.electronAPI.createMeeting();
        if (result.success) {
          generatedMeetingLink = result.meetingLink;
          const linkInput = $('meeting-link-input');
          const linkBox = $('meeting-link-box');
          if (linkInput) linkInput.value = result.meetingLink;
          if (linkBox) {
            linkBox.style.display = 'block';
            linkBox.scrollIntoView({ behavior: 'smooth' });
          }

          // Refresh recent meetings list
          await loadRecentMeetings();
        } else {
          showToast('❌ Error creating meeting: ' + result.error, 'error');
        }
      } catch(e) {
        showToast('❌ Failed to create meeting', 'error');
      }
    });
  }

  // ── Copy Meeting Link Button ──────────────────────────────
  const btnCopyLink = $('btn-copy-link');
  if (btnCopyLink) {
    btnCopyLink.addEventListener('click', async () => {
      const linkInput = $('meeting-link-input');
      const linkVal = linkInput ? linkInput.value : '';
      if (linkVal) {
        try {
          if (linkInput) {
            linkInput.select();
            linkInput.setSelectionRange(0, 99999);
          }
          await window.electronAPI.copyToClipboard(linkVal);
          showToast('✅ Meeting link copied to clipboard!');
        } catch (err) {
          try { navigator.clipboard.writeText(linkVal); } catch(e2) {}
          showToast('✅ Meeting link copied!');
        }
      } else {
        showToast('⚠️ No link to copy. Create a meeting first.', 'error');
      }
    });
  }

  // ── Open in Browser Button ────────────────────────────────
  const btnOpenBrowser = $('btn-open-browser');
  if (btnOpenBrowser) {
    btnOpenBrowser.addEventListener('click', async () => {
      try {
        const linkVal = $('meeting-link-input') ? $('meeting-link-input').value : '';
        if (linkVal) {
          await window.electronAPI.openInBrowser(linkVal);
        } else {
          showToast('⚠️ No meeting link. Create a meeting first.', 'error');
        }
      } catch(e) {
        showToast('❌ Failed to open browser', 'error');
      }
    });
  }

  // ── Join Native Meeting Button ────────────────────────────
  const btnJoinCreated = $('btn-join-created');
  if (btnJoinCreated) {
    btnJoinCreated.addEventListener('click', () => {
      const linkInput = $('meeting-link-input');
      if (linkInput && linkInput.value) {
        const code = linkInput.value.split('/').pop();
        joinMeeting(code);
      } else {
        showToast('⚠️ No meeting created yet.', 'error');
      }
    });
  }

  // ── Join Existing Meeting via Input ───────────────────────
  const btnJoinMeeting = $('btn-join-meeting');
  if (btnJoinMeeting) {
    btnJoinMeeting.addEventListener('click', (e) => {
      e.stopPropagation();
      const joinInput = $('join-meeting-input');
      const codeOrLink = joinInput ? joinInput.value.trim() : '';
      if (codeOrLink) {
        joinMeeting(codeOrLink);
      } else {
        showToast('⚠️ Please enter a meeting link or code.', 'error');
      }
    });
  }

  // Prevent input click from triggering parent card click
  const joinInput = $('join-meeting-input');
  if (joinInput) {
    joinInput.addEventListener('click', (e) => {
      e.stopPropagation();
    });
    // Allow Enter key to join
    joinInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const codeOrLink = joinInput.value.trim();
        if (codeOrLink) joinMeeting(codeOrLink);
      }
    });
  }
}

function setActiveNavItem(selectedItem) {
  document.querySelectorAll('.sidebar-nav .nav-item').forEach(item => {
    item.classList.remove('active');
  });
  if (selectedItem) {
    selectedItem.classList.add('active');
  }
}

function joinMeeting(meetingId) {
  // Extract ID from full URL if needed
  let id = meetingId;
  if (meetingId.includes('/meeting/')) {
    id = meetingId.split('/meeting/').pop();
  }

  // Navigate to meeting page passing meetingId as query string
  window.electronAPI.navigate(`meeting?meetingId=${id}`);
}

// ── Check Auto Updates ────────────────────────────────────────
async function checkForUpdates() {
  if (!window.electronAPI || !window.electronAPI.checkForUpdates) return;

  try {
    const result = await window.electronAPI.checkForUpdates();
    if (result && result.updateAvailable) {
      const banner = $('update-banner');
      const textEl = $('update-banner-text');
      const updateBtn = $('btn-start-update');
      const closeBtn = $('btn-close-update-banner');

      if (textEl) textEl.textContent = `New update available! (v${result.version})`;
      if (banner) banner.style.display = 'flex';

      // Hook update button
      if (updateBtn) {
        updateBtn.addEventListener('click', async () => {
          updateBtn.disabled = true;
          updateBtn.textContent = 'Downloading...';
          await window.electronAPI.startUpdate();
        });
      }

      // Hook close button
      if (closeBtn) {
        closeBtn.addEventListener('click', () => {
          if (banner) banner.style.display = 'none';
        });
      }

      // Listen to update progress events
      if (window.electronAPI.onUpdateProgress) {
        window.electronAPI.onUpdateProgress((event, progress) => {
          if (updateBtn) updateBtn.textContent = `Downloading ${progress}%`;
        });
      }

      if (window.electronAPI.onUpdateCompleted) {
        window.electronAPI.onUpdateCompleted(() => {
          if (updateBtn) updateBtn.textContent = 'Installing...';
        });
      }

      if (window.electronAPI.onUpdateError) {
        window.electronAPI.onUpdateError((event, error) => {
          showToast('❌ Update failed: ' + error, 'error');
          if (updateBtn) {
            updateBtn.disabled = false;
            updateBtn.textContent = 'Retry Update';
          }
        });
      }
    }
  } catch (err) {
    console.warn('[Update] Auto update checking failed:', err.message);
  }
}
