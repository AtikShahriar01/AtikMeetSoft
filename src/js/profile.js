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
