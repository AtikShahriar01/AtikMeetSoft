/**
 * ============================================================
 *  AtikMeet - Meeting / Call Module (Renderer Process)
 *  Manages WebRTC Peer connections, streams, mic/cam states,
 *  1080p Screen sharing, chat notifications and reactions.
 * ============================================================
 */

// ── DOM Reference Helper ─────────────────────────────────────
function $(id) {
  return document.getElementById(id);
}

// ── Global Variables ─────────────────────────────────────────
let localStream = null;
let screenStream = null;
let peerConnections = new Map(); // socketId -> RTCPeerConnection
let socket = null;
let isHost = false;
let meetingId = null;
let currentUser = null;
let isMuted = false;
let isCamOff = false;
let isScreenSharing = false;
let meetingStartTime = null;
let timerInterval = null;

// Socket.io host connection configuration
let signalingUrl = "http://localhost:3478"; // fallback

// Google STUN Servers
const iceServersConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' }
  ]
};

document.addEventListener('DOMContentLoaded', async () => {
  // Extract meetingId from query params
  const urlParams = new URLSearchParams(window.location.search);
  meetingId = urlParams.get('meetingId');
  
  if (!meetingId) {
    // Regex fallback for Electron file URL queries
    const match = window.location.href.match(/[\?&]meetingId=([^&#]+)/);
    if (match) {
      meetingId = match[1];
    }
  }
  
  if (!meetingId) {
    // Try to extract from URL path (e.g. /meeting/atikmeet-xxxx-yyyy-zzzz)
    const pathParts = window.location.pathname.split('/');
    if (pathParts.includes('meeting')) {
      const idx = pathParts.indexOf('meeting');
      if (idx + 1 < pathParts.length && pathParts[idx + 1]) {
        meetingId = pathParts[idx + 1];
      }
    }
  }
  
  if (!meetingId) {
    alert('Meeting ID is missing!');
    window.electronAPI.navigate('home');
    return;
  }

  $('display-meeting-id').textContent = meetingId;

  // Load User Data
  const userResult = await window.electronAPI.getCurrentUser();
  if (userResult.success) {
    currentUser = userResult.user;
  } else {
    window.electronAPI.navigate('login');
    return;
  }

  // Check if current user is host
  const meetingResult = await window.electronAPI.getMeetingInfo(meetingId);
  if (meetingResult.success && meetingResult.meeting) {
    isHost = (meetingResult.meeting.hostId === currentUser.id);
  }

  // Setup local cameras & WebRTC
  try {
    await initLocalStream();
  } catch (err) {
    console.error('Failed to setup local stream:', err);
  }
  
  try {
    await initSignaling();
  } catch (err) {
    console.error('Failed to setup signaling:', err);
  }
  
  setupToolbarListeners();
  setupKeyboardShortcuts();
  
  // Start Meeting Duration Timer
  meetingStartTime = new Date();
  timerInterval = setInterval(updateMeetingTimer, 1000);
});

/**
 * Creates a dummy video track from a black canvas with a placeholder text.
 * Uses a setInterval loop to draw frames continuously, forcing Chromium's
 * captureStream to push active video frames (resolves black screens in Chrome/Brave).
 * @returns {MediaStreamTrack} The dummy canvas video track
 */
function createDummyVideoTrack() {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 1280;
    canvas.height = 720;
    const ctx = canvas.getContext('2d');
    
    // Draw loop (10 fps) to generate active frames for captureStream
    const intervalId = setInterval(() => {
      if (!document.getElementById('browser-perm-guide') && !document.getElementById('tile-local')) {
        // Stop interval if elements are removed or call ended
        clearInterval(intervalId);
        return;
      }
      ctx.fillStyle = '#15152a';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      
      ctx.fillStyle = '#a0a0b0';
      ctx.font = '48px sans-serif';
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'center';
      ctx.fillText('No Webcam Access', canvas.width / 2, canvas.height / 2);
    }, 100);

    const stream = canvas.captureStream(30); // Capture stream at 30fps (matches screen sharing rate)
    const track = stream.getVideoTracks()[0];
    if (track) {
      track.isDummy = true;
    }
    return track;
  } catch (e) {
    console.error('Failed to create dummy video track:', e);
    return null;
  }
}

// ── Initialize Media Stream ──────────────────────────────────
async function initLocalStream() {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 1280 },
        height: { ideal: 720 }
      },
      audio: true
    });
    addVideoTile('local', localStream, `${currentUser.name} (You)`, true);
  } catch (err) {
    console.warn('[Webcam] High definition resolution not supported. Trying basic video...', err.message);
    try {
      localStream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true
      });
      addVideoTile('local', localStream, `${currentUser.name} (You)`, true);
    } catch (err2) {
      console.warn('[Webcam] Camera not detected. Falling back to audio with dummy video track...', err2.message);
      try {
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        
        // Add dummy video track to keep video senders open for screen share replaceTrack
        const dummyTrack = createDummyVideoTrack();
        if (dummyTrack) {
          localStream.addTrack(dummyTrack);
        }
        
        addVideoTile('local', localStream, `${currentUser.name} (You)`, true);
      } catch (e) {
        console.error('[Webcam] No audio/video input devices detected:', e.message);
        
        // Create full empty stream with dummy track so they can still see UI and share screen
        localStream = new MediaStream();
        const dummyTrack = createDummyVideoTrack();
        if (dummyTrack) {
          localStream.addTrack(dummyTrack);
        }
        
        addVideoTile('local', localStream, `${currentUser.name} (You)`, true);
        showBrowserPermissionGuide();
        console.warn('[Webcam] Could not access microphone or camera. User joined without hardware media.');
      }
    }
  }
}

/**
 * Renders a floating notification guide teaching browser clients how to bypass
 * browser block on camera/mic/screen-sharing over HTTP local network IP connections
 */
function showBrowserPermissionGuide() {
  if (window.location.protocol.startsWith('http')) {
    // Check if guide already exists
    if (document.getElementById('browser-perm-guide')) return;

    const banner = document.createElement('div');
    banner.id = 'browser-perm-guide';
    banner.style.cssText = `
      position: fixed;
      top: 40px;
      left: 50%;
      transform: translateX(-50%);
      width: 90%;
      max-width: 550px;
      background: rgba(255, 71, 87, 0.95);
      color: white;
      padding: 18px 24px;
      border-radius: 12px;
      box-shadow: 0 10px 40px rgba(0,0,0,0.6);
      z-index: 99999;
      font-size: 0.85rem;
      line-height: 1.5;
      text-align: left;
      border: 1px solid rgba(255,255,255,0.25);
      backdrop-filter: blur(12px);
      font-family: system-ui, -apple-system, sans-serif;
    `;
    
    const localIP = window.location.origin;
    banner.innerHTML = `
      <div style="font-weight: bold; font-size: 1rem; margin-bottom: 8px; display:flex; align-items:center; gap:8px;">
        <span>🔒 Media & Screen Share Blocked by Browser Security</span>
      </div>
      <div style="margin-bottom: 12px; color: rgba(255,255,255,0.9);">
        Browsers block Camera, Mic, and Screen Sharing on local network links (HTTP). Please follow these steps to enable them:
      </div>
      <ol style="margin: 0 0 0 20px; padding: 0; color: rgba(255,255,255,0.95); display:flex; flex-direction:column; gap:6px;">
        <li>Open a new browser tab and navigate to: <br><code style="background:rgba(0,0,0,0.3); padding:2px 6px; border-radius:4px; font-family:monospace;">chrome://flags/#unsafely-treat-insecure-origin-as-secure</code> (works in Chrome, Brave, and Edge).</li>
        <li>Locate <b>"Insecure origins treated as secure"</b> and switch it to <b>Enabled</b>.</li>
        <li>Paste this meeting host origin in the box: <br><code style="background:rgba(0,0,0,0.3); padding:2px 6px; border-radius:4px; font-family:monospace;">${localIP}</code></li>
        <li>Click <b>Relaunch</b> at the bottom right, then return to this page and reload!</li>
      </ol>
      <button onclick="this.parentElement.remove()" style="position:absolute; top:12px; right:12px; background:none; border:none; color:white; font-size:1.4rem; cursor:pointer; opacity:0.8; transition:opacity 0.2s;" onmouseover="this.style.opacity=1" onmouseout="this.style.opacity=0.8">&times;</button>
    `;
    document.body.appendChild(banner);
  }
}

// ── Connect Socket.io Signaling ──────────────────────────────
async function initSignaling() {
  const signalInfo = await window.electronAPI.getSignalingInfo();
  signalingUrl = signalInfo.url;
  
  // Dynamically load Socket.io Client
  const script = document.createElement('script');
  if (window.location.protocol === 'file:') {
    script.src = '../utils/socket.io.min.js';
  } else {
    script.src = `${signalingUrl}/socket.io/socket.io.js`;
  }
  document.head.appendChild(script);

  script.onload = () => {
    socket = io(signalingUrl);

    socket.on('connect', () => {
      console.log('Connected to signaling server');
      
      // Join Room
      socket.emit('join-room', {
        roomId: meetingId,
        userId: currentUser.id,
        userName: currentUser.name,
        isHost: isHost
      });
    });

    // Handle incoming events
    socket.on('user-joined', (data) => {
      console.log('User joined room:', data);
      handlePeerJoin(data.socketId, data.userName);
    });

    socket.on('offer', async (data) => {
      await handleOffer(data.senderId, data.offer || data.sdp, data.senderName || data.userName);
    });

    socket.on('answer', async (data) => {
      await handleAnswer(data.senderId, data.answer || data.sdp);
    });

    socket.on('ice-candidate', async (data) => {
      await handleIceCandidate(data.senderId, data.candidate);
    });

    socket.on('user-left', (data) => {
      console.log('User left room:', data);
      removePeerConnection(data.socketId);
    });

    // Moderator events
    socket.on('participant-muted', () => {
      if (!isMuted) {
        toggleMute();
      }
    });

    socket.on('participant-removed', () => {
      alert('You have been removed from this meeting by the host.');
      window.electronAPI.navigate('home');
    });

    // Chat listener
    socket.on('chat-message', (data) => {
      receiveMessage(data.userName, data.message, false);
    });

    // Reaction listener
    socket.on('reaction', (data) => {
      showFloatingEmoji(data.emoji);
    });

    // Hand raise listener
    socket.on('hand-raised', (data) => {
      // Toggle hand raise indicator on video tile
      toggleHandIndicator(data.socketId, data.isRaised);
    });

    // Admission control (Host only)
    if (isHost) {
      socket.on('approval-request', (data) => {
        showJoinRequest(data.socketId, data.userName);
      });
    }

    socket.on('waiting-approval', () => {
      console.log('Waiting in lobby...');
    });

    socket.on('admitted', async () => {
      console.log('Admitted to the meeting room!');
    });
  };
}

// ── WebRTC Signal Handlers ────────────────────────────────────
function handlePeerJoin(peerSocketId, peerName) {
  // Create Connection
  const pc = createPeerConnection(peerSocketId, peerName);
  peerConnections.set(peerSocketId, pc);

  // Add local streams to peer connection
  if (localStream) {
    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
  }

  // Create offer
  pc.createOffer().then(offer => {
    return pc.setLocalDescription(offer);
  }).then(() => {
    socket.emit('offer', {
      targetId: peerSocketId,
      offer: pc.localDescription,
      userName: currentUser.name
    });
  });
}

function createPeerConnection(peerSocketId, peerName) {
  const pc = new RTCPeerConnection(iceServersConfig);

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit('ice-candidate', {
        targetId: peerSocketId,
        candidate: event.candidate
      });
    }
  };

  pc.ontrack = (event) => {
    const remoteStream = event.streams[0];
    addVideoTile(peerSocketId, remoteStream, peerName, false);
  };

  return pc;
}

async function handleOffer(senderId, offer, senderName) {
  const pc = createPeerConnection(senderId, senderName);
  peerConnections.set(senderId, pc);

  if (localStream) {
    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
  }

  await pc.setRemoteDescription(new RTCSessionDescription(offer));
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);

  socket.emit('answer', {
    targetId: senderId,
    answer: answer
  });
}

async function handleAnswer(senderId, answer) {
  const pc = peerConnections.get(senderId);
  if (pc) {
    await pc.setRemoteDescription(new RTCSessionDescription(answer));
  }
}

async function handleIceCandidate(senderId, candidate) {
  const pc = peerConnections.get(senderId);
  if (pc) {
    await pc.addIceCandidate(new RTCIceCandidate(candidate));
  }
}

function removePeerConnection(socketId) {
  const pc = peerConnections.get(socketId);
  if (pc) {
    pc.close();
    peerConnections.delete(socketId);
  }
  removeVideoTile(socketId);
}

// ── UI Video Grid Modifiers ───────────────────────────────────
function addVideoTile(peerId, stream, name, isLocal) {
  // Avoid duplicate tiles
  if ($(`tile-${peerId}`)) return;

  const grid = $('video-grid');
  const tile = document.createElement('div');
  tile.className = `video-tile ${isLocal ? 'local-user' : ''}`;
  tile.id = `tile-${peerId}`;

  if (stream && stream.getVideoTracks().length > 0) {
    const video = document.createElement('video');
    video.srcObject = stream;
    video.autoplay = true;
    video.playsInline = true;
    if (isLocal) {
      video.muted = true; // Don't hear yourself
      
      // Mirror only real local webcam, do not mirror dummy canvas streams
      const track = stream.getVideoTracks()[0];
      if (track && !track.isDummy) {
        video.classList.add('mirror-video');
      }
    }
    tile.appendChild(video);
  } else {
    // Show initials avatar if no video
    const avatar = document.createElement('div');
    avatar.className = 'avatar-placeholder';
    avatar.textContent = name.charAt(0).toUpperCase();
    tile.appendChild(avatar);
  }

  // Label banner
  const label = document.createElement('div');
  label.className = 'tile-label';
  label.innerHTML = `
    <span class="label-name">${name}</span>
    <span class="hand-raised-icon" id="hand-${peerId}" style="display:none;">✋</span>
  `;
  tile.appendChild(label);

  grid.appendChild(tile);
  updateVideoGridLayout();
}

function removeVideoTile(peerId) {
  const tile = $(`tile-${peerId}`);
  if (tile) {
    tile.remove();
    updateVideoGridLayout();
  }
}

function updateVideoGridLayout() {
  const grid = $('video-grid');
  const tilesCount = grid.children.length;
  
  if (tilesCount === 1) {
    grid.style.gridTemplateColumns = '1fr';
  } else if (tilesCount <= 2) {
    grid.style.gridTemplateColumns = 'repeat(2, 1fr)';
  } else if (tilesCount <= 4) {
    grid.style.gridTemplateColumns = 'repeat(2, 1fr)';
  } else {
    grid.style.gridTemplateColumns = 'repeat(3, 1fr)';
  }
}

// ── Mic / Camera controls ─────────────────────────────────────
function toggleMute() {
  if (!localStream) return;
  isMuted = !isMuted;
  localStream.getAudioTracks().forEach(track => track.enabled = !isMuted);
  
  if (isMuted) {
    $('mic-on-icon').style.display = 'none';
    $('mic-off-icon').style.display = 'block';
    $('btn-mic').classList.add('danger-active');
  } else {
    $('mic-on-icon').style.display = 'block';
    $('mic-off-icon').style.display = 'none';
    $('btn-mic').classList.remove('danger-active');
  }

  if (socket) {
    socket.emit('toggle-audio', { isMuted });
  }
}

function toggleCam() {
  if (!localStream) return;
  isCamOff = !isCamOff;
  
  localStream.getVideoTracks().forEach(track => track.enabled = !isCamOff);
  
  const localTile = $('tile-local');
  if (isCamOff) {
    $('cam-on-icon').style.display = 'none';
    $('cam-off-icon').style.display = 'block';
    $('btn-cam').classList.add('danger-active');
    
    // Replace with avatar
    if (localTile) {
      const video = localTile.querySelector('video');
      if (video) video.style.display = 'none';
      
      let avatar = localTile.querySelector('.avatar-placeholder');
      if (!avatar) {
        avatar = document.createElement('div');
        avatar.className = 'avatar-placeholder';
        avatar.textContent = currentUser.name.charAt(0).toUpperCase();
        localTile.appendChild(avatar);
      } else {
        avatar.style.display = 'flex';
      }
    }
  } else {
    $('cam-on-icon').style.display = 'block';
    $('cam-off-icon').style.display = 'none';
    $('btn-cam').classList.remove('danger-active');
    
    if (localTile) {
      const video = localTile.querySelector('video');
      if (video) video.style.display = 'block';
      const avatar = localTile.querySelector('.avatar-placeholder');
      if (avatar) avatar.style.display = 'none';
    }
  }

  if (socket) {
    socket.emit('toggle-video', { isCamOff });
  }
}

// ── Screen Sharing (1080p Ultra-Smooth Quality) ────────────────
async function toggleScreenShare() {
  if (!isScreenSharing) {
    try {
      // Prompt selection for screen capture with 1080p full HD & high framerates (30-60 fps)
      screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          width: { ideal: 1920, max: 1920 },
          height: { ideal: 1080, max: 1080 },
          frameRate: { ideal: 30, max: 60 }
        },
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });

      const videoTrack = screenStream.getVideoTracks()[0];
      if (videoTrack) {
        // Optimize WebRTC pipeline for video transmission/motion to ensure zero lag and high fluidity
        videoTrack.contentHint = 'motion';
      }
      
      // Replace tracks in all peer connections and tune encoding parameters
      peerConnections.forEach(pc => {
        const senders = pc.getSenders();
        const videoSender = senders.find(sender => sender.track && sender.track.kind === 'video');
        if (videoSender) {
          videoSender.replaceTrack(videoTrack);
          
          // Boost encoder bitrate parameters for crisp, lag-free video stream
          try {
            const parameters = videoSender.getParameters();
            if (!parameters.encodings) {
              parameters.encodings = [{}];
            }
            if (parameters.encodings[0]) {
              parameters.encodings[0].maxBitrate = 6000000; // 6 Mbps (Premium bandwidth allocation)
              parameters.encodings[0].scaleResolutionDownBy = 1.0; // Prevent scaling down resolution
              videoSender.setParameters(parameters);
            }
          } catch (paramErr) {
            console.warn('[WebRTC] Could not tune sender parameters:', paramErr);
          }
        }
      });

      // Update Local preview
      const localVideo = $('tile-local').querySelector('video');
      if (localVideo) localVideo.srcObject = screenStream;

      isScreenSharing = true;
      $('btn-screen').classList.add('active');

      // Stop sharing trigger listener (e.g. from Chrome overlay banner)
      videoTrack.onended = () => {
        stopScreenSharing();
      };

    } catch (err) {
      console.error('Error starting screen share:', err);
    }
  } else {
    stopScreenSharing();
  }
}

function stopScreenSharing() {
  if (!isScreenSharing) return;

  if (screenStream) {
    screenStream.getTracks().forEach(track => track.stop());
  }

  const cameraTrack = localStream.getVideoTracks()[0];
  
  // Restore original webcam video track
  peerConnections.forEach(pc => {
    const senders = pc.getSenders();
    const videoSender = senders.find(sender => sender.track && sender.track.kind === 'video');
    if (videoSender && cameraTrack) {
      videoSender.replaceTrack(cameraTrack);
    }
  });

  const localVideo = $('tile-local').querySelector('video');
  if (localVideo && !isCamOff) {
    localVideo.srcObject = localStream;
  }

  isScreenSharing = false;
  $('btn-screen').classList.remove('active');
}

// ── Hand Raise & Reactions ───────────────────────────────────
let handRaised = false;
function toggleHandRaise() {
  handRaised = !handRaised;
  $('btn-hand').classList.toggle('active', handRaised);
  toggleHandIndicator('local', handRaised);
  
  if (socket) {
    socket.emit('hand-raise', { isRaised: handRaised });
  }
}

function toggleHandIndicator(peerId, isRaised) {
  const indicator = $(`hand-${peerId}`);
  if (indicator) {
    indicator.style.display = isRaised ? 'inline-block' : 'none';
  }
}

// Reactions popup
function toggleReactionsPopup() {
  const popup = $('reaction-selector-popup');
  popup.style.display = popup.style.display === 'none' ? 'flex' : 'none';
}

function sendEmoji(emoji) {
  showFloatingEmoji(emoji);
  if (socket) {
    socket.emit('reaction', { emoji });
  }
  $('reaction-selector-popup').style.display = 'none';
}

function showFloatingEmoji(emoji) {
  const overlay = $('emoji-overlay');
  const div = document.createElement('div');
  div.className = 'floating-emoji';
  div.textContent = emoji;
  
  // Random horizontal position
  div.style.left = `${Math.floor(Math.random() * 80) + 10}%`;
  overlay.appendChild(div);
  
  // Remove after animation finishes
  setTimeout(() => div.remove(), 2500);
}

// ── Admission Queue Notification ──────────────────────────────
let joinApprovalQueue = [];
function showJoinRequest(socketId, userName) {
  joinApprovalQueue.push({ socketId, userName });
  if (joinApprovalQueue.length === 1) {
    renderJoinRequest(socketId, userName);
  }
}

function renderJoinRequest(socketId, userName) {
  $('admit-user-name').textContent = userName;
  $('approval-popup').style.display = 'block';

  $('btn-admit-join').onclick = () => {
    socket.emit('admit-participant', { targetId: socketId });
    closeJoinRequestPopup();
  };

  $('btn-deny-join').onclick = () => {
    // Emit deny
    closeJoinRequestPopup();
  };
}

function closeJoinRequestPopup() {
  $('approval-popup').style.display = 'none';
  joinApprovalQueue.shift();
  if (joinApprovalQueue.length > 0) {
    const next = joinApprovalQueue[0];
    renderJoinRequest(next.socketId, next.userName);
  }
}

// ── Slideout Panels Layout controllers ──────────────────────────
function togglePanel(panelId) {
  const pList = ['participants-panel', 'chat-panel'];
  pList.forEach(id => {
    if (id === panelId) {
      $(id).style.display = $(id).style.display === 'none' ? 'flex' : 'none';
    } else {
      $(id).style.display = 'none';
    }
  });
}

// ── Meeting Duration clock ────────────────────────────────────
function updateMeetingTimer() {
  if (!meetingStartTime) return;
  const now = new Date();
  const diff = Math.floor((now - meetingStartTime) / 1000);
  
  const hrs = Math.floor(diff / 3600).toString().padStart(2, '0');
  const mins = Math.floor((diff % 3600) / 60).toString().padStart(2, '0');
  const secs = (diff % 60).toString().padStart(2, '0');
  
  $('call-timer').textContent = `${hrs}:${mins}:${secs}`;
}

// ── Toolbar setup listeners ──────────────────────────────────
function setupToolbarListeners() {
  $('btn-mic').addEventListener('click', toggleMute);
  $('btn-cam').addEventListener('click', toggleCam);
  $('btn-screen').addEventListener('click', toggleScreenShare);
  $('btn-hand').addEventListener('click', toggleHandRaise);
  $('btn-reactions').addEventListener('click', toggleReactionsPopup);
  
  // End Meeting Call
  $('btn-end').addEventListener('click', () => {
    if (confirm('Leave this meeting?')) {
      if (isHost) {
        window.electronAPI.endMeeting(meetingId);
      }
      window.electronAPI.navigate('home');
    }
  });

  // Toggle Buttons on Right Side
  $('toggle-participants').addEventListener('click', () => {
    togglePanel('participants-panel');
    updateParticipantsList();
  });
  
  $('toggle-chat').addEventListener('click', () => {
    togglePanel('chat-panel');
    $('badge-chat-unread').style.display = 'none';
    $('badge-chat-unread').textContent = '0';
  });

  $('close-participants-panel').addEventListener('click', () => $('participants-panel').style.display = 'none');
  $('close-chat-panel').addEventListener('click', () => $('chat-panel').style.display = 'none');

  // Copy Room Link Info
  $('btn-copy-id').addEventListener('click', async () => {
    const fullLink = `http://localhost:3478/meeting/${meetingId}`;
    await window.electronAPI.copyToClipboard(fullLink);
    alert('Meeting link copied to clipboard!');
  });

  // Reaction Click
  document.querySelectorAll('.reaction-emoji').forEach(btn => {
    btn.addEventListener('click', () => {
      sendEmoji(btn.getAttribute('data-emoji'));
    });
  });
}

// ── Keyboard Shortcuts (Ctrl+D, Ctrl+E) ──────────────────────
function setupKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key.toLowerCase() === 'd') {
      e.preventDefault();
      toggleMute();
    }
    if (e.ctrlKey && e.key.toLowerCase() === 'e') {
      e.preventDefault();
      toggleCam();
    }
  });
}

// ── Load/Update Panel Lists ──────────────────────────────────
function updateParticipantsList() {
  const container = $('participants-list-container');
  container.innerHTML = '';
  
  // Add Local user
  addParticipantUIItem('local', currentUser.name, true);

  // Add remote peers
  peerConnections.forEach((pc, socketId) => {
    // Wait for mapping metadata in production. For now mock username or query socket
    addParticipantUIItem(socketId, `User (${socketId.slice(0, 4)})`, false);
  });

  $('participant-count-badge').textContent = peerConnections.size + 1;
  
  if (isHost) {
    $('host-controls-footer').style.display = 'block';
    $('btn-mute-all').onclick = () => {
      socket.emit('mute-all', { roomId: meetingId });
    };
  }
}

function addParticipantUIItem(socketId, name, isSelf) {
  const container = $('participants-list-container');
  const div = document.createElement('div');
  div.className = 'participant-item';
  div.innerHTML = `
    <div class="p-info">
      <div class="p-avatar">${name.charAt(0).toUpperCase()}</div>
      <span class="p-name">${name} ${isSelf ? '(You)' : ''}</span>
    </div>
    <div class="p-controls">
      ${!isSelf && isHost ? `
        <button class="p-control-btn mute-p-btn" data-id="${socketId}" title="Mute Participant">🔇</button>
        <button class="p-control-btn remove-p-btn danger" data-id="${socketId}" title="Remove Participant">❌</button>
      ` : ''}
    </div>
  `;
  container.appendChild(div);

  // Hook mod control events
  if (!isSelf && isHost) {
    div.querySelector('.mute-p-btn').onclick = () => {
      socket.emit('mute-participant', { targetId: socketId });
    };
    div.querySelector('.remove-p-btn').onclick = () => {
      if (confirm(`Remove ${name} from this meeting?`)) {
        socket.emit('remove-participant', { targetId: socketId });
      }
    };
  }
}
