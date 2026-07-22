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
  const result = await window.electronAPI.getCurrentUser();
  if (result.success) {
    currentUser = result.user;
    
    // Update Sidebar Profile
    $('user-display-name').textContent = currentUser.name;
    $('user-display-role').textContent = currentUser.isAdmin ? 'Developer & Admin' : 'Member';
    $('profile-avatar').textContent = currentUser.name.charAt(0).toUpperCase();
    
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
    $('welcome-text').textContent = `Welcome back, ${currentUser.name.split(' ')[0]}!`;
    
    // Set formatted date
    const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    $('current-date').textContent = new Date().toLocaleDateString('en-US', options);

    // VIP Badges
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
}

// ── Check Trial / License Status ──────────────────────────────
async function checkTrialStatus() {
  const status = await window.electronAPI.getTrialStatus();
  if (status.success) {
    const banner = $('license-banner');
    const bannerText = $('license-banner-text');
    const upgradeBtn = $('banner-activate-btn');

    if (status.pendingKey) {
      banner.style.display = 'flex';
      banner.style.background = 'linear-gradient(90deg, rgba(245, 158, 11, 0.25), rgba(245, 158, 11, 0.15))';
      bannerText.innerHTML = `⏳ <b>Activation Pending Approval:</b> Waiting for administrator to review and activate key: <b>${status.pendingKey}</b>`;
      upgradeBtn.style.display = 'none';
    } else if (status.isActivated) {
      banner.style.display = 'none'; // Premium active, hide banner
    } else if (status.isExpired) {
      banner.style.display = 'flex';
      banner.style.background = 'linear-gradient(90deg, rgba(255, 71, 87, 0.25), rgba(255, 71, 87, 0.15))';
      bannerText.innerHTML = `⚠️ <b>Trial Period Expired!</b> Your 7-day trial has ended. Please activate your license to continue using AtikMeet.`;
      upgradeBtn.textContent = 'Activate Key';
      upgradeBtn.style.display = 'inline-block';
      $('btn-create-meeting').disabled = true;
      $('btn-create-meeting').title = "Please activate your license to start meetings";
      $('btn-join-meeting').disabled = true;
    } else {
      banner.style.display = 'flex';
      banner.style.background = 'rgba(255, 255, 255, 0.04)';
      bannerText.innerHTML = `⏳ <b>Free Trial:</b> You have <b>${status.daysRemaining} days</b> left in your free trial. Activate to get permanent VIP features!`;
      upgradeBtn.textContent = 'Upgrade to VIP';
      upgradeBtn.style.display = 'inline-block';
    }
  }
}

// ── Load Recent Meetings ─────────────────────────────────────
async function loadRecentMeetings() {
  const result = await window.electronAPI.getRecentMeetings();
  const tableBody = $('meetings-table-body');
  
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
          const res = await window.electronAPI.deleteMeeting(id);
          if (res.success) {
            await loadRecentMeetings();
          } else {
            alert('Failed to delete meeting: ' + res.error);
          }
        }
      });
    });
  } else {
    tableBody.innerHTML = '<tr><td colspan="5" class="empty-row">No meetings found. Start a new one!</td></tr>';
  }
}

// ── Event Handlers ───────────────────────────────────────────
function setupEventListeners() {
  // Sidebar Nav Items Navigation
  const navHome = $('nav-home');
  if (navHome) {
    navHome.addEventListener('click', (e) => {
      e.preventDefault();
      setActiveNavItem(navHome);
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
      alert('📅 Calendar Schedule feature: No upcoming scheduled meetings for today.');
    });
  }

  const navContacts = $('nav-contacts');
  if (navContacts) {
    navContacts.addEventListener('click', (e) => {
      e.preventDefault();
      setActiveNavItem(navContacts);
      alert('👥 Contacts: You can share meeting links with anyone directly.');
    });
  }

  const navChat = $('nav-chat');
  if (navChat) {
    navChat.addEventListener('click', (e) => {
      e.preventDefault();
      setActiveNavItem(navChat);
      alert('💬 Chat: In-meeting chat is available when you join or start a meeting.');
    });
  }

  const navRecordings = $('nav-recordings');
  if (navRecordings) {
    navRecordings.addEventListener('click', (e) => {
      e.preventDefault();
      setActiveNavItem(navRecordings);
      alert('🔴 Recordings: Local screen recordings are saved in your Videos/AtikMeet folder.');
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

  // Create Meeting Card & Button
  const btnCreateMeeting = $('btn-create-meeting');
  if (btnCreateMeeting) {
    btnCreateMeeting.addEventListener('click', async () => {
      const result = await window.electronAPI.createMeeting();
      if (result.success) {
        generatedMeetingLink = result.meetingLink;
        $('meeting-link-input').value = result.meetingLink;
        $('meeting-link-box').style.display = 'block';
        $('meeting-link-box').scrollIntoView({ behavior: 'smooth' });
        
        // Refresh recent meetings list
        await loadRecentMeetings();
      } else {
        alert('Error creating meeting: ' + result.error);
      }
    });
  }

  // Copy Meeting Link Button
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
        } catch (err) {
          navigator.clipboard.writeText(linkVal);
        }
        btnCopyLink.classList.add('btn-success');
        setTimeout(() => {
          btnCopyLink.classList.remove('btn-success');
        }, 1000);
        alert('Meeting link copied to clipboard!');
      }
    });
  }

  // Open in Browser Button
  const btnOpenBrowser = $('btn-open-browser');
  if (btnOpenBrowser) {
    btnOpenBrowser.addEventListener('click', async () => {
      const linkVal = $('meeting-link-input').value;
      if (linkVal) {
        await window.electronAPI.openInBrowser(linkVal);
      }
    });
  }

  // Join Native Meeting Button
  const btnJoinCreated = $('btn-join-created');
  if (btnJoinCreated) {
    btnJoinCreated.addEventListener('click', () => {
      const code = $('meeting-link-input').value.split('/').pop();
      joinMeeting(code);
    });
  }

  // Join Existing Meeting via Input
  const btnJoinMeeting = $('btn-join-meeting');
  if (btnJoinMeeting) {
    btnJoinMeeting.addEventListener('click', (e) => {
      e.stopPropagation();
      const codeOrLink = $('join-meeting-input').value.trim();
      if (codeOrLink) {
        joinMeeting(codeOrLink);
      } else {
        alert('Please enter a meeting link or code.');
      }
    });
  }

  // Prevent input click from triggering parent card click
  const joinInput = $('join-meeting-input');
  if (joinInput) {
    joinInput.addEventListener('click', (e) => {
      e.stopPropagation();
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

      textEl.textContent = `New update available! (v${result.version})`;
      banner.style.display = 'flex';

      // Hook update button
      updateBtn.addEventListener('click', async () => {
        updateBtn.disabled = true;
        updateBtn.textContent = 'Downloading...';
        
        await window.electronAPI.startUpdate();
      });

      // Hook close button
      closeBtn.addEventListener('click', () => {
        banner.style.display = 'none';
      });

      // Listen to update progress events
      window.electronAPI.onUpdateProgress((event, progress) => {
        updateBtn.textContent = `Downloading ${progress}%`;
      });

      window.electronAPI.onUpdateCompleted(() => {
        updateBtn.textContent = 'Installing...';
      });

      window.electronAPI.onUpdateError((event, error) => {
        alert('Update failed: ' + error);
        updateBtn.disabled = false;
        updateBtn.textContent = 'Retry Update';
      });
    }
  } catch (err) {
    console.warn('[Update] Auto update checking failed:', err.message);
  }
}
