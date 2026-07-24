/**
============================================================
AtikMeet - Meeting Recording Module (Renderer Process)
FIXED: এখন microphone (আপনার original voice) + system audio
(YouTube/ভিডিওর original sound) দুটোই AudioContext দিয়ে mix
হয়ে record হবে। mic-এর filter বন্ধ রাখায় voice হালকা হবে না।
============================================================
*/
let mediaRecorder = null;
let recordedChunks = [];
let isRecordingActive = false;
let recordingAudioCtx = null; // mix-এর জন্য AudioContext (বন্ধ করার জন্য রাখা)

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
      if (typeof socket !== 'undefined' && socket) {
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
    if (typeof socket !== 'undefined' && socket) {
      socket.emit('recording-stop', { roomId: meetingId });
    }
  }
}

// ── Start Capture ────────────────────────────────────────────
async function startRecording() {
  recordedChunks = [];
  let displayStream = null;
  let micStream = null;

  try {
    // 1) SCREEN + SYSTEM AUDIO (YouTube/ভিডিওর original sound)
    displayStream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        width: { ideal: 1920, max: 1920 },
        height: { ideal: 1080, max: 1080 },
        frameRate: { ideal: 30, max: 30 } // 30fps cap → record-এ lag কম
      },
      audio: true // Electron loopback handler system sound দেবে
    });

    // screen track-এ contentHint (text/screen sharp রাখতে)
    const screenVideoTrack = displayStream.getVideoTracks()[0];
    if (screenVideoTrack) {
      try { screenVideoTrack.contentHint = 'detail'; } catch (e) {}
    }

    // system audio track (loopback)
    const systemAudioTrack = displayStream.getAudioTracks()[0];
    console.log('[Recorder] System audio track present:', !!systemAudioTrack);

    // 2) MICROPHONE (আপনার original voice) — filter বন্ধ = raw voice
    try {
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,   // 🔑 voice duck/cancel হবে না
          noiseSuppression: false,   // 🔑 voice thin হবে না
          autoGainControl: false,    // 🔑 loud system sound-এ mic কমবে না
          sampleRate: 48000,
          channelCount: 1
        },
        video: false
      });
      console.log('[Recorder] Mic track captured ✅ (raw, no filters)');
    } catch (micErr) {
      console.warn('[Recorder] Mic not available, recording system audio only:', micErr.message);
    }
    const micTrack = micStream ? micStream.getAudioTracks()[0] : null;

    // 3) MIX: system audio + mic → একটা stream-এ (AudioContext দিয়ে)
    let finalAudioTracks = [];
    if (systemAudioTrack || micTrack) {
      recordingAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const destination = recordingAudioCtx.createMediaStreamDestination();

      // System audio (YouTube sound) — পুরো volume
      if (systemAudioTrack) {
        const sysSrc = recordingAudioCtx.createMediaStreamSource(new MediaStream([systemAudioTrack]));
        const sysGain = recordingAudioCtx.createGain();
        sysGain.gain.value = 1.0; // প্রয়োজনে 0.8–1.2 এ adjust
        sysSrc.connect(sysGain);
        sysGain.connect(destination);
      }

      // Mic (আপনার voice) — একটু boost যাতে হালকা না শোনায়
      if (micTrack) {
        const micSrc = recordingAudioCtx.createMediaStreamSource(new MediaStream([micTrack]));
        const micGain = recordingAudioCtx.createGain();
        micGain.gain.value = 1.8; // 🔑 mic boost → original voice পুরো volume-এ
        micSrc.connect(micGain);
        micGain.connect(destination);
      }

      finalAudioTracks = destination.stream.getAudioTracks();
      console.log('[Recorder] Mixed audio tracks count:', finalAudioTracks.length);
    }

    // 4) FINAL STREAM = screen video + mixed audio
    const finalStream = new MediaStream([
      ...(screenVideoTrack ? [screenVideoTrack] : []),
      ...finalAudioTracks
    ]);
    console.log('[Recorder] Final stream → video:', finalStream.getVideoTracks().length,
      '| audio:', finalStream.getAudioTracks().length);

    // 5) MediaRecorder (video + opus audio, ভালো bitrate)
    const options = {
      mimeType: 'video/webm;codecs=vp9,opus',
      videoBitsPerSecond: 5000000,
      audioBitsPerSecond: 192000   // 🔑 voice quality নষ্ট হবে না
    };
    if (!MediaRecorder.isTypeSupported(options.mimeType)) {
      options.mimeType = 'video/webm;codecs=vp8,opus';
      if (!MediaRecorder.isTypeSupported(options.mimeType)) {
        options.mimeType = 'video/webm';
      }
    }

    mediaRecorder = new MediaRecorder(finalStream, options);
    mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) recordedChunks.push(e.data);
    };
    mediaRecorder.onstop = async () => {
      // সব track + AudioContext বন্ধ
      if (displayStream) displayStream.getTracks().forEach(t => t.stop());
      if (micStream) micStream.getTracks().forEach(t => t.stop());
      if (recordingAudioCtx) {
        try { await recordingAudioCtx.close(); } catch (e) {}
        recordingAudioCtx = null;
      }
      await saveRecordingFile();
    };

    mediaRecorder.start(1000);
    console.log('[Recorder] Capture started ✅ (screen + system + mic mixed)');
    return true;
  } catch (err) {
    console.error('[Recorder] Failed to start:', err);
    // cleanup on failure
    if (displayStream) displayStream.getTracks().forEach(t => t.stop());
    if (micStream) micStream.getTracks().forEach(t => t.stop());
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
  const result = await window.electronAPI.saveRecording(new Uint8Array(arrayBuffer));
  if (result.success) {
    alert(`Recording successfully saved to:\n${result.filePath}`);
  } else if (result.error !== 'Save cancelled') {
    alert(`Failed to save recording: ${result.error}`);
  }
}