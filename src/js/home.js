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
    if (currentUser.isVIP) {
      $('vip-badge-icon').style.display = 'flex';
      $('vip-status-container').style.display = 'block';
    }

    // Admin Sidebar Option
    if (currentUser.isAdmin) {
      $('nav-admin').style.display = 'flex';
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

    if (status.isActivated) {
      banner.style.display = 'none'; // Premium active, hide banner
    } else if (status.isExpired) {
      banner.style.display = 'flex';
      banner.style.background = 'linear-gradient(90deg, rgba(255, 71, 87, 0.25), rgba(255, 71, 87, 0.15))';
      bannerText.innerHTML = `⚠️ <b>Trial Period Expired!</b> Your 7-day trial has ended. Please activate your license to continue using AtikMeet.`;
      upgradeBtn.textContent = 'Activate Key';
      // Disable meeting creation if trial is expired
      $('btn-create-meeting').disabled = true;
      $('btn-create-meeting').title = "Please activate your license to start meetings";
      $('btn-join-meeting').disabled = true;
    } else {
      banner.style.display = 'flex';
      bannerText.innerHTML = `⏳ <b>Free Trial:</b> You have <b>${status.daysRemaining} days</b> left in your free trial. Activate to get permanent VIP features!`;
      upgradeBtn.textContent = 'Upgrade to VIP';
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
  // Sidebar Nav Items
  $('nav-home').addEventListener('click', (e) => {
    e.preventDefault();
  });

  $('nav-profile').addEventListener('click', (e) => {
    e.preventDefault();
    window.electronAPI.navigate('profile');
  });

  $('nav-license').addEventListener('click', (e) => {
    e.preventDefault();
    window.electronAPI.navigate('license');
  });

  $('nav-admin').addEventListener('click', (e) => {
    e.preventDefault();
    window.electronAPI.navigate('admin');
  });

  $('banner-activate-btn').addEventListener('click', () => {
    window.electronAPI.navigate('license');
  });

  $('logout-btn').addEventListener('click', () => {
    window.electronAPI.logout();
  });

  // Create Meeting
  $('btn-create-meeting').addEventListener('click', async () => {
    const result = await window.electronAPI.createMeeting();
    if (result.success) {
      generatedMeetingLink = result.meetingLink;
      $('meeting-link-input').value = result.meetingLink;
      $('meeting-link-box').style.display = 'block';
      
      // Update list after generating new meeting
      await loadRecentMeetings();
    } else {
      alert('Error creating meeting: ' + result.error);
    }
  });

  // Copy Link
  $('btn-copy-link').addEventListener('click', async () => {
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
      const copyBtn = $('btn-copy-link');
      copyBtn.classList.add('btn-success');
      setTimeout(() => {
        copyBtn.classList.remove('btn-success');
      }, 1000);
      alert('Meeting link copied to clipboard!');
    }
  });

  // Open in External Browser
  $('btn-open-browser').addEventListener('click', async () => {
    if (generatedMeetingLink) {
      await window.electronAPI.openInBrowser(generatedMeetingLink);
    }
  });

  // Join Native Meeting (App)
  $('btn-join-created').addEventListener('click', () => {
    const code = $('meeting-link-input').value.split('/').pop();
    joinMeeting(code);
  });

  // Join Existing Meeting via Input
  $('btn-join-meeting').addEventListener('click', () => {
    const codeOrLink = $('join-meeting-input').value.trim();
    if (codeOrLink) {
      joinMeeting(codeOrLink);
    } else {
      alert('Please enter a meeting link or code.');
    }
  });
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
