/**
 * ============================================================
 *  AtikMeet - License Verification (Renderer Process)
 *  Manages key inputs autofocus, validation checks, loading spinners
 *  progress fillers, and canvas particle confetti celebration animations.
 * ============================================================
 */

function $(id) {
  return document.getElementById(id);
}

document.addEventListener('DOMContentLoaded', async () => {
  await getLicenseStatus();
  setupKeySegmentFocus();
  setupFormActivation();
});

// ── Load Current Trial / License Info ────────────────────────
async function getLicenseStatus() {
  const result = await window.electronAPI.getTrialStatus();
  if (result.success) {
    const icon = $('status-icon');
    const text = $('status-text');
    const wrapper = $('progress-wrapper');
    const bar = $('trial-progress');

    if (result.isActivated) {
      icon.textContent = '⭐';
      text.innerHTML = `Premium VIP Activated<br><span style="font-size:0.8rem; font-weight:normal; color:var(--text-secondary);">Unlimited lifetime meetings & E2EE security</span>`;
      wrapper.style.display = 'none';
      $('status-box').style.borderColor = 'var(--vip-gold)';
      // Hide form since already activated
      $('license-form').style.display = 'none';
    } else if (result.isExpired) {
      icon.textContent = '❌';
      icon.style.color = 'var(--danger)';
      text.innerHTML = `Trial Expired<br><span style="font-size:0.8rem; font-weight:normal; color:var(--text-secondary);">Your 7-day trial has ended. Enter activation key to unlock.</span>`;
      wrapper.style.display = 'none';
      $('status-box').style.borderColor = 'var(--danger)';
    } else {
      icon.textContent = '⏳';
      text.innerHTML = `Free Trial Active (${result.daysRemaining} days left)`;
      wrapper.style.display = 'block';
      
      // Calculate progress scale (max 7 days)
      const scaleVal = result.daysRemaining / 7;
      bar.style.transform = `scaleX(${scaleVal})`;
    }
  }
}

// ── Autofocus next input segment ──────────────────────────────
function setupKeySegmentFocus() {
  const inputs = [
    $('key-seg-1'),
    $('key-seg-2'),
    $('key-seg-3')
  ];

  inputs.forEach((input, index) => {
    input.addEventListener('input', (e) => {
      // Force uppercase
      input.value = input.value.toUpperCase();

      // Auto focus next
      if (input.value.length === 4 && index < inputs.length - 1) {
        inputs[index + 1].focus();
      }
    });

    input.addEventListener('keydown', (e) => {
      // Backspace goes to previous box
      if (e.key === 'Backspace' && input.value.length === 0 && index > 0) {
        inputs[index - 1].focus();
      }
    });
  });
}

// ── Submit Verification Logic ─────────────────────────────────
function setupFormActivation() {
  const form = $('license-form');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const seg1 = $('key-seg-1').value.trim();
    const seg2 = $('key-seg-2').value.trim();
    const seg3 = $('key-seg-3').value.trim();

    const fullKey = `ATIK-${seg1}-${seg2}-${seg3}`;

    // Hide Form, Show Loader
    form.style.display = 'none';
    $('status-box').style.display = 'none';
    const loader = $('license-loader');
    loader.style.display = 'block';

    // Fill progress bar animation
    const fill = $('mini-fill');
    fill.style.transition = 'transform 2s cubic-bezier(0.1, 0.8, 0.1, 1)';
    setTimeout(() => {
      fill.style.transform = 'scaleX(1)';
    }, 100);

    // Call IPC activate
    setTimeout(async () => {
      const result = await window.electronAPI.activateLicense(fullKey);
      
      loader.style.display = 'none';

      if (result.success) {
        // Show Checkmark Success
        $('activation-success-card').style.display = 'block';
        
        // Trigger Confetti Party
        triggerConfettiCelebration();
      } else {
        // Restore elements on failure
        form.style.display = 'block';
        $('status-box').style.display = 'block';
        fill.style.transition = 'none';
        fill.style.transform = 'scaleX(0)';
        alert('Activation Failed: ' + result.error);
      }
    }, 2200); // Loader buffer duration
  });
}

// ── Confetti Particle Animation ──────────────────────────────
function triggerConfettiCelebration() {
  const canvas = $('confetti-canvas');
  canvas.style.display = 'block';
  const ctx = canvas.getContext('2d');
  
  // Resize
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;

  const particles = [];
  const colors = ['#ffd700', '#ffa502', '#1a73e8', '#00d4aa', '#ff4757'];

  for (let i = 0; i < 150; i++) {
    particles.push({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height - canvas.height,
      r: Math.random() * 6 + 4,
      d: Math.random() * canvas.height,
      color: colors[Math.floor(Math.random() * colors.length)],
      tilt: Math.random() * 10 - 5,
      tiltAngleIncremental: Math.random() * 0.07 + 0.02,
      tiltAngle: 0
    });
  }

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    particles.forEach((p, idx) => {
      p.tiltAngle += p.tiltAngleIncremental;
      p.y += (Math.cos(p.d) + 3 + p.r / 2) / 2;
      p.x += Math.sin(p.tiltAngle);
      p.tilt = Math.sin(p.tiltAngle - idx / 3) * 15;

      ctx.beginPath();
      ctx.lineWidth = p.r;
      ctx.strokeStyle = p.color;
      ctx.moveTo(p.x + p.tilt + p.r / 2, p.y);
      ctx.lineTo(p.x + p.tilt, p.y + p.tilt + p.r / 2);
      ctx.stroke();
    });

    updateConfetti();
  }

  function updateConfetti() {
    let remaining = 0;
    particles.forEach(p => {
      if (p.y < canvas.height) {
        remaining++;
      }
    });

    if (remaining > 0) {
      requestAnimationFrame(draw);
    } else {
      canvas.style.display = 'none';
    }
  }

  draw();
}
