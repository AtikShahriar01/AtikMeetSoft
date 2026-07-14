/**
 * ============================================================
 *  AtikMeet - Meeting Recording Module (Renderer Process)
 *  Records canvas/video elements and system audio, then prompts
 *  the user to save the recording anywhere on local drives.
 * ============================================================
 */

let mediaRecorder = null;
let recordedChunks = [];
let isRecordingActive = false;

document.addEventListener('DOMContentLoaded', () => {
  const btnRec = document.getElementById('btn-record');
  if (btnRec) {
    btnRec.addEventListener('click', toggleMeetingRecording);
  }
});

// ── Toggle Recording ─────────────────────────────────────────
async function toggleMeetingRecording() {
  const btnRec = document.getElementById('btn-record');
  const banner = document.getElementById('recording-banner');
  
  if (!isRecordingActive) {
    // Start Recording
    const started = await startRecording();
    if (started) {
      isRecordingActive = true;
      btnRec.classList.add('recording');
      btnRec.title = "Stop Recording";
      if (banner) banner.style.display = 'flex';
      
      // Notify signaling room
      if (socket) {
        socket.emit('recording-start', { roomId: meetingId });
      }
    }
  } else {
    // Stop Recording
    stopRecording();
    isRecordingActive = false;
    btnRec.classList.remove('recording');
    btnRec.title = "Record Meeting";
    if (banner) banner.style.display = 'none';

    if (socket) {
      socket.emit('recording-stop', { roomId: meetingId });
    }
  }
}

// ── Start Capture ────────────────────────────────────────────
async function startRecording() {
  recordedChunks = [];
  try {
    // We combine the video tracks and audio tracks of local stream and remote streams
    // For simplicity of a desktop client, we capture screen display media which records meeting window
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        width: 1280,
        height: 720,
        frameRate: 30
      },
      audio: true // Captures system sounds
    });

    const options = { mimeType: 'video/webm; codecs=vp9' };
    
    // Check supported types fallback
    if (!MediaRecorder.isTypeSupported(options.mimeType)) {
      options.mimeType = 'video/webm; codecs=vp8';
      if (!MediaRecorder.isTypeSupported(options.mimeType)) {
        options.mimeType = 'video/webm';
      }
    }

    mediaRecorder = new MediaRecorder(stream, options);
    
    mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) {
        recordedChunks.push(e.data);
      }
    };

    mediaRecorder.onstop = async () => {
      // Release tracks
      stream.getTracks().forEach(track => track.stop());
      await saveRecordingFile();
    };

    // Trigger save chunk every 1 sec
    mediaRecorder.start(1000);
    console.log('[Recorder] Capture started');
    return true;
  } catch (err) {
    console.error('[Recorder] Failed to start:', err);
    alert('Screen sharing/recording capture permission was denied.');
    return false;
  }
}

// ── Stop Capture ─────────────────────────────────────────────
function stopRecording() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
    console.log('[Recorder] Capture stopped');
  }
}

// ── Save File via Main IPC ───────────────────────────────────
async function saveRecordingFile() {
  if (recordedChunks.length === 0) return;

  const blob = new Blob(recordedChunks, { type: 'video/webm' });
  const arrayBuffer = await blob.arrayBuffer();
  
  // Send bytes as Uint8Array array buffer to main process to trigger file saving prompt
  const result = await window.electronAPI.saveRecording(new Uint8Array(arrayBuffer));
  
  if (result.success) {
    alert(`Recording successfully saved to:\n${result.filePath}`);
  } else if (result.error !== 'Save cancelled') {
    alert(`Failed to save recording: ${result.error}`);
  }
}
