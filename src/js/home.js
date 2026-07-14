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
      
      row.innerHTML = `
        <td><code style="color:var(--accent); font-weight:bold;">${meeting.id}</code></td>
        <td>${meeting.hostName}</td>
        <td>${statusBadge}</td>
        <td>${dateStr}</td>
        <td>
          ${meeting.isActive ? 
            `<button class="btn btn-accent btn-sm join-btn-table" data-id="${meeting.id}">Rejoin</button>` : 
            `<span style="color:var(--text-secondary); font-size:0.8rem;">No actions</span>`
          }
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
    if (generatedMeetingLink) {
      await window.electronAPI.copyToClipboard(generatedMeetingLink);
      const copyBtn = $('btn-copy-link');
      // Tooltip notification visual effect
      copyBtn.classList.add('btn-success');
      setTimeout(() => {
        copyBtn.classList.remove('btn-success');
      }, 1000);
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
