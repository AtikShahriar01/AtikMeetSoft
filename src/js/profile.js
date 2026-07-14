/**
 * ============================================================
 *  AtikMeet - Profile Logic Controller (Renderer Process)
 *  Loads display names, computes statistics totals, and edits configuration.
 * ============================================================
 */

function $(id) {
  return document.getElementById(id);
}

let currentUser = null;

document.addEventListener('DOMContentLoaded', async () => {
  await loadProfileData();
  setupProfileFormListener();
  setupAvatarUploadListener();
  await loadSavedAvatar();
});

// ── Load Profile Data ────────────────────────────────────────
async function loadProfileData() {
  const result = await window.electronAPI.getCurrentUser();
  if (result.success) {
    currentUser = result.user;

    // Fill elements
    $('avatar-char').textContent = currentUser.name.charAt(0).toUpperCase();
    $('profile-name').textContent = currentUser.name;
    $('profile-email').textContent = currentUser.email;
    $('edit-name').value = currentUser.name;

    // Set License text
    $('stat-license').textContent = currentUser.licenseActivated ? 'Premium VIP' : 'Free Trial';

    // Show VIP Badge if active
    if (currentUser.isVIP) {
      $('vip-status-tag').style.display = 'inline-block';
    }

    // Load meeting statistics
    const meetingsResult = await window.electronAPI.getRecentMeetings();
    if (meetingsResult.success && meetingsResult.meetings) {
      const meetings = meetingsResult.meetings;
      $('stat-meetings').textContent = meetings.length;

      // Compute total duration (Mock representation sum since it's localdb stored value)
      let totalSeconds = 0;
      meetings.forEach(m => {
        if (m.duration) totalSeconds += m.duration;
      });

      const mins = Math.floor(totalSeconds / 60);
      $('stat-duration').textContent = `${mins}m`;
    }
  } else {
    window.electronAPI.navigate('login');
  }
}

// ── Setup Form Submission Listener ───────────────────────────
function setupProfileFormListener() {
  const form = $('profile-form');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const name = $('edit-name').value.trim();
    const newPass = $('edit-password').value.trim();

    if (!name) {
      alert('Display Name is required.');
      return;
    }

    const updateData = { name };
    if (newPass) {
      if (newPass.length < 6) {
        alert('Password must be at least 6 characters.');
        return;
      }
      updateData.password = newPass;
    }

    // Submit Changes
    const result = await window.electronAPI.updateProfile(updateData);
    if (result.success) {
      alert('Profile updated successfully!');
      // Clear password field
      $('edit-password').value = '';
      await loadProfileData(); // Reload UI
    } else {
      alert('Error updating profile: ' + result.error);
    }
  });
}

// ── Avatar Upload Setup ────────────────────────────────────────────
function setupAvatarUploadListener() {
  const fileInput = $('avatar-file-input');
  if (fileInput) {
    fileInput.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      
      // Limit to 2MB maximum size
      if (file.size > 2 * 1024 * 1024) {
        alert('File size must be less than 2MB');
        return;
      }
      
      const reader = new FileReader();
      reader.onload = async () => {
        const base64 = reader.result;
        
        let success = false;
        if (window.electronAPI && window.electronAPI.uploadAvatar) {
          const result = await window.electronAPI.uploadAvatar({ dataUrl: base64 });
          success = result && result.success;
        } else {
          localStorage.setItem('atikmeet_avatar', base64);
          success = true;
        }
        
        if (success) {
          const avatarImg = $('avatar-img');
          const avatarChar = $('avatar-char');
          if (avatarImg) {
            avatarImg.src = base64;
            avatarImg.style.display = 'block';
          }
          if (avatarChar) {
            avatarChar.style.display = 'none';
          }
          alert('Profile picture uploaded successfully!');
        } else {
          alert('Failed to upload profile picture.');
        }
      };
      reader.readAsDataURL(file);
    });
  }
}

async function loadSavedAvatar() {
  try {
    let avatarData = null;
    if (window.electronAPI && window.electronAPI.getAvatar) {
      const result = await window.electronAPI.getAvatar();
      if (result && result.success && result.dataUrl) {
        avatarData = result.dataUrl;
      }
    } else {
      avatarData = localStorage.getItem('atikmeet_avatar');
    }
    
    if (avatarData) {
      const avatarImg = $('avatar-img');
      const avatarChar = $('avatar-char');
      if (avatarImg) {
        avatarImg.src = avatarData;
        avatarImg.style.display = 'block';
      }
      if (avatarChar) {
        avatarChar.style.display = 'none';
      }
    }
  } catch (err) {
    console.warn('Could not load avatar:', err);
  }
}
