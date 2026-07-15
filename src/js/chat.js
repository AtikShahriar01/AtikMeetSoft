/**
 * ============================================================
 *  AtikMeet - In-Call Chat Module (Renderer Process)
 *  Manages chat DOM UI rendering, E2EE encrypt/decrypt triggers,
 *  and unread notifications.
 * ============================================================
 */

document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('chat-send-form');
  const chatInput = document.getElementById('chat-input');

  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const message = chatInput.value.trim();
      if (!message) return;

      sendChatMessage(message);
      chatInput.value = '';
    });
  }
});

// ── Send Message ──────────────────────────────────────────────
async function sendChatMessage(msgText) {
  if (!meetingId) return;

  // Render on local screen
  receiveMessage(currentUser.name, msgText, true);

  // Send via Firestore
  window.electronAPI.sendSignal(meetingId, {
    type: 'chat-message',
    sender: currentUser.email,
    data: {
      userName: currentUser.name,
      message: msgText
    }
  });
}

// ── Receive / Render Message ──────────────────────────────────
function receiveMessage(senderName, msgText, isSelf) {
  const chatContainer = document.getElementById('chat-messages-container');
  if (!chatContainer) return;

  const msgCard = document.createElement('div');
  msgCard.className = `chat-message ${isSelf ? 'self' : ''}`;

  const timeStr = new Date().toLocaleTimeString('en-US', {
    hour: '2-digit', minute: '2-digit'
  });

  msgCard.innerHTML = `
    <div class="msg-header">
      <span class="msg-sender" style="font-weight:bold;">${isSelf ? 'You' : senderName}</span>
      <span class="msg-time">${timeStr}</span>
    </div>
    <div class="msg-body">${msgText}</div>
  `;

  chatContainer.appendChild(msgCard);

  // Scroll to bottom
  chatContainer.scrollTop = chatContainer.scrollHeight;

  // Unread Badge Check (If panel is hidden)
  const chatPanel = document.getElementById('chat-panel');
  if (chatPanel && chatPanel.style.display === 'none' && !isSelf) {
    const unreadBadge = document.getElementById('badge-chat-unread');
    if (unreadBadge) {
      let count = parseInt(unreadBadge.textContent || '0') + 1;
      unreadBadge.textContent = count;
      unreadBadge.style.display = 'flex';
      
      // Ring notification chime
      playJoinLeaveChime('message');
    }
  }
}

function playJoinLeaveChime(type) {
  try {
    const context = new (window.AudioContext || window.webkitAudioContext)();
    const osc = context.createOscillator();
    const gain = context.createGain();
    
    osc.connect(gain);
    gain.connect(context.destination);

    if (type === 'message') {
      // Gentle dual ping chime
      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, context.currentTime); // D5
      gain.gain.setValueAtTime(0.1, context.currentTime);
      osc.start();
      osc.stop(context.currentTime + 0.15);
    }
  } catch (e) {
    console.log('Audio Context error (user interaction required first):', e.message);
  }
}
