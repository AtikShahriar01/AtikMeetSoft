/**
 * ============================================================
 *  AtikMeet - Browser Fallback API (Renderer Process)
 *  Detects if the page is opened in a standard web browser instead of
 *  the Electron shell, and automatically provides mock implementations
 *  for the electronAPI so that remote users can join calls seamlessly.
 * ============================================================
 */

if (!window.electronAPI) {
  console.log('[AtikMeet] Browser mode detected. Initializing browser fallback layer.');

  window.electronAPI = {
    // Standard properties
    isLocalhost: async () => {
      const hostname = window.location.hostname;
      return (hostname === 'localhost' || hostname === '127.0.0.1');
    },

    getCurrentUser: async () => {
      let user = null;
      try {
        user = JSON.parse(localStorage.getItem('atikmeet_user'));
      } catch (e) {
        console.error('Failed to read localStorage user:', e);
      }

      if (!user) {
        // Create a randomized guest user
        user = {
          id: 'web-' + Math.random().toString(36).substring(2, 11),
          name: 'Guest_' + Math.floor(1000 + Math.random() * 9000),
          email: 'guest@atikmeet.com',
          isVIP: false,
          licenseActivated: false,
          isAdmin: false
        };
        try {
          localStorage.setItem('atikmeet_user', JSON.stringify(user));
        } catch (e) {}
      }
      return { success: true, user };
    },

    getSignalingInfo: async () => {
      return {
        host: window.location.hostname,
        port: window.location.port,
        url: window.location.origin
      };
    },

    getMeetingInfo: async (meetingId) => {
      // Mock meeting info in browser
      return {
        success: true,
        meeting: {
          id: meetingId,
          meetingId: meetingId,
          title: 'AtikMeet Room Call',
          hostId: 'admin',
          hostName: 'Atik Shahriar',
          isActive: true
        }
      };
    },

    getRecentMeetings: async () => {
      return { success: true, meetings: [] };
    },

    getTrialStatus: async () => {
      return {
        success: true,
        daysRemaining: 7,
        isExpired: false,
        isActivated: false,
        isVIP: false
      };
    },

    copyToClipboard: async (text) => {
      try {
        await navigator.clipboard.writeText(text);
        return { success: true };
      } catch (err) {
        return { success: false, error: err.message };
      }
    },

    openInBrowser: async (url) => {
      window.open(url, '_blank');
      return { success: true };
    },

    navigate: (page) => {
      // Correctly route queries in browser environment
      if (page.includes('?')) {
        const parts = page.split('?');
        window.location.href = `/${parts[0]}.html?${parts[1]}`;
      } else {
        window.location.href = `/${page}.html`;
      }
    },

    minimize: () => console.log('Minimize window ignored in browser'),
    maximize: () => console.log('Maximize window ignored in browser'),
    close: () => {
      if (confirm('Close window?')) {
        window.close();
      }
    },
    isMaximized: async () => false,

    // Auth Mock functions for browser mode
    login: async ({ email, password }) => {
      const name = email.split('@')[0];
      const user = {
        id: 'web-' + Math.random().toString(36).substring(2, 11),
        name: name.charAt(0).toUpperCase() + name.slice(1),
        email: email,
        isVIP: false,
        licenseActivated: false,
        isAdmin: false
      };
      localStorage.setItem('atikmeet_user', JSON.stringify(user));
      return { success: true, user };
    },

    register: async ({ name, email, password }) => {
      const user = {
        id: 'web-' + Math.random().toString(36).substring(2, 11),
        name: name,
        email: email,
        isVIP: false,
        licenseActivated: false,
        isAdmin: false
      };
      localStorage.setItem('atikmeet_user', JSON.stringify(user));
      return { success: true, user };
    },

    logout: async () => {
      localStorage.removeItem('atikmeet_user');
      window.location.href = '/login.html';
      return { success: true };
    },

    // Empty hooks for Electron features
    saveRecording: async (buffer) => {
      try {
        // Browser download fallback
        const blob = new Blob([buffer], { type: 'video/webm' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = url;
        a.download = `AtikMeet_Recording_${new Date().toISOString().slice(0, 10)}.webm`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        return { success: true, filePath: 'Browser Downloads Folder' };
      } catch (err) {
        return { success: false, error: err.message };
      }
    }
  };

  // Adjust UI for browser mode on DOM load
  document.addEventListener('DOMContentLoaded', () => {
    const titlebar = document.querySelector('.custom-titlebar');
    if (titlebar) {
      titlebar.style.display = 'none'; // Hide custom titlebar in browser
    }
    
    // Adjust layout margins
    const layout = document.querySelector('.main-layout') || 
                   document.querySelector('.meeting-layout') || 
                   document.querySelector('.auth-container') || 
                   document.querySelector('.profile-layout') || 
                   document.querySelector('.license-layout') || 
                   document.querySelector('.admin-layout');
    if (layout) {
      layout.style.marginTop = '0px';
      
      // If it's the meeting layout, adjust height calculation
      if (layout.classList.contains('meeting-layout')) {
        layout.style.height = 'calc(100vh - 80px)'; // Account only for toolbar
      } else if (layout.classList.contains('auth-container')) {
        layout.style.minHeight = '100vh';
      } else {
        layout.style.height = '100vh';
      }
    }
  });
}
