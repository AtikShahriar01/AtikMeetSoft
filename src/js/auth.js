/**
 * ============================================================
 *  AtikMeet - Authentication Module (Renderer Process)
 *  Handles login/signup forms, validation, social login,
 *  password visibility toggle, and form animations
 * ============================================================
 */

// ── State ────────────────────────────────────────────────────

/** Current active form ('login' or 'signup') */
let currentForm = 'login';

/** Loading state to prevent duplicate submissions */
let isSubmitting = false;

// ── DOM References ───────────────────────────────────────────

/**
 * Safely retrieves a DOM element by ID
 * @param {string} id - Element ID
 * @returns {HTMLElement|null}
 */
function $(id) {
  return document.getElementById(id);
}

// ── Initialization ───────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  initAuthListeners();
  setupExternalLinks();
  loadSavedCredentials();
  
  if (window.electronAPI && window.electronAPI.onSocialLoginSuccess) {
    window.electronAPI.onSocialLoginSuccess(() => {
      showSuccess('Account verified via web browser! Redirecting...');
      setTimeout(() => {
        window.electronAPI.navigate('home');
      }, 600);
    });
  }
});

/**
 * Loads saved login credentials from localStorage and displays a 1-click quick login card
 */
function loadSavedCredentials() {
  try {
    const savedRaw = localStorage.getItem('atikmeet_saved_login_credentials');
    if (savedRaw) {
      const saved = JSON.parse(savedRaw);
      if (saved && saved.email) {
        const emailInput = $('login-email');
        const passInput = $('login-password');
        if (emailInput && !emailInput.value) emailInput.value = saved.email;
        if (passInput && saved.password && !passInput.value) passInput.value = saved.password;

        const loginForm = $('login-form');
        let quickCard = $('quick-login-chip-card');
        if (loginForm && !quickCard) {
          quickCard = document.createElement('div');
          quickCard.id = 'quick-login-chip-card';
          quickCard.style.cssText = `
            background: linear-gradient(135deg, rgba(0, 212, 170, 0.15), rgba(59, 130, 246, 0.15));
            border: 1px solid rgba(0, 212, 170, 0.35);
            border-radius: 12px;
            padding: 12px 16px;
            margin-bottom: 20px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            cursor: pointer;
            transition: transform 0.2s ease, box-shadow 0.2s ease;
          `;
          quickCard.innerHTML = `
            <div style="display: flex; align-items: center; gap: 12px;">
              <div style="width: 36px; height: 36px; border-radius: 50%; background: #00d4aa; color: #000; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 1rem;">
                ${saved.email.charAt(0).toUpperCase()}
              </div>
              <div style="text-align: left;">
                <div style="color: #fff; font-weight: 600; font-size: 0.88rem;">${saved.name || saved.email.split('@')[0]}</div>
                <div style="color: #00d4aa; font-size: 0.78rem;">${saved.email}</div>
              </div>
            </div>
            <span style="background: #00d4aa; color: #0b0e19; font-size: 0.75rem; font-weight: bold; padding: 6px 12px; border-radius: 20px;">1-Click Login ➔</span>
          `;
          quickCard.addEventListener('click', () => {
            if (saved.email && saved.password) {
              handleLoginWithSaved(saved.email, saved.password);
            }
          });
          loginForm.insertBefore(quickCard, loginForm.firstChild);
        }
      }
    }
  } catch (e) {
    console.warn('Failed to load saved credentials:', e);
  }
}

async function handleLoginWithSaved(email, password) {
  if (isSubmitting) return;
  try {
    isSubmitting = true;
    showLoading('login-btn', 'Signing in...');
    const result = await window.electronAPI.login({ email, password });
    if (result.success && result.user) {
      const targetPage = (result.user.isAdmin || email.toLowerCase() === 'admin@atikmeet.com') ? 'admin' : 'home';
      showSuccess(`Welcome ${result.user.name || 'Back'}! Redirecting...`);
      setTimeout(() => {
        window.electronAPI.navigate(targetPage);
      }, 600);
    } else {
      showError(result.error || 'Login failed. Please enter credentials.');
    }
  } catch (err) {
    showError('Authentication error. Please try again.');
  } finally {
    isSubmitting = false;
    hideLoading('login-btn', 'Sign In');
  }
}

/**
 * Ensures external links open in standard default system browsers inside Electron
 */
function setupExternalLinks() {
  document.querySelectorAll('.external-link').forEach(link => {
    link.addEventListener('click', (e) => {
      if (window.electronAPI) {
        e.preventDefault();
        const href = link.getAttribute('href');
        window.electronAPI.openInBrowser(href);
      }
    });
  });
}

/**
 * Registers all event listeners for the authentication page
 */
let captchaResult = 0;

function generateCaptcha() {
  const num1 = Math.floor(Math.random() * 9) + 1;
  const num2 = Math.floor(Math.random() * 9) + 1;
  captchaResult = num1 + num2;
  const questionEl = $('captcha-question');
  if (questionEl) {
    questionEl.textContent = `${num1} + ${num2} = ?`;
  }
  const answerInput = $('captcha-answer');
  if (answerInput) {
    answerInput.value = '';
  }
}

function initAuthListeners() {
  // Login form submission
  const loginForm = $('login-form');
  if (loginForm) {
    loginForm.addEventListener('submit', handleLogin);
  }

  // Bind Show Sign Up Modal click
  const showSignupBtn = $('show-signup');
  if (showSignupBtn) {
    showSignupBtn.addEventListener('click', (e) => {
      e.preventDefault();
      const modal = $('signup-modal');
      if (modal) {
        modal.style.display = 'flex';
        $('modal-signup-form').style.display = 'block';
        $('modal-signup-success').style.display = 'none';
        $('signup-firstname').value = '';
        $('signup-lastname').value = '';
        $('signup-email').value = '';
        $('signup-password').value = '';
        generateCaptcha();
      }
    });
  }

  // Bind Close Sign Up Modal click
  const closeSignupModalBtn = $('close-signup-modal');
  if (closeSignupModalBtn) {
    closeSignupModalBtn.addEventListener('click', () => {
      $('signup-modal').style.display = 'none';
    });
  }

  const btnModalSignupOk = $('btn-modal-signup-ok');
  if (btnModalSignupOk) {
    btnModalSignupOk.addEventListener('click', () => {
      $('signup-modal').style.display = 'none';
    });
  }

  // Modal Sign Up Form submission
  const modalSignupForm = $('modal-signup-form');
  if (modalSignupForm) {
    modalSignupForm.addEventListener('submit', handleModalSignup);
  }

  // Captcha refresh action
  const btnRefresh = $('btn-refresh-captcha');
  if (btnRefresh) {
    btnRefresh.addEventListener('click', () => {
      btnRefresh.style.transform = 'rotate(360deg)';
      setTimeout(() => {
        btnRefresh.style.transform = 'rotate(0deg)';
      }, 300);
      generateCaptcha();
    });
  }

  // Password visibility toggles
  const passwordToggles = document.querySelectorAll('.password-toggle');
  passwordToggles.forEach((toggle) => {
    toggle.addEventListener('click', handlePasswordToggle);
  });

  // Social login buttons
  const googleLoginBtn = $('google-login');
  if (googleLoginBtn) {
    googleLoginBtn.addEventListener('click', () => handleSocialLogin('google'));
  }

  const githubLoginBtn = $('github-login');
  if (githubLoginBtn) {
    githubLoginBtn.addEventListener('click', () => handleSocialLogin('github'));
  }

  const microsoftLoginBtn = $('microsoft-login');
  if (microsoftLoginBtn) {
    microsoftLoginBtn.addEventListener('click', () => handleSocialLogin('microsoft'));
  }

  // Real-time input validation
  const emailInputs = document.querySelectorAll('input[type="email"]');
  emailInputs.forEach((input) => {
    input.addEventListener('blur', () => validateEmailField(input));
    input.addEventListener('input', () => clearFieldError(input));
  });

  const passwordInputs = document.querySelectorAll('input[type="password"]');
  passwordInputs.forEach((input) => {
    input.addEventListener('input', () => {
      clearFieldError(input);
      // Update password strength indicator if on signup form
      if (input.id === 'signup-password') {
        updatePasswordStrength(input.value);
      }
    });
  });
}

// ── Form Handlers ────────────────────────────────────────────

/**
 * Handles the login form submission
 * Validates inputs, calls electronAPI, and handles response
 * @param {Event} e - Form submit event
 */
async function handleLogin(e) {
  e.preventDefault();

  if (isSubmitting) return;

  const email = $('login-email')?.value?.trim();
  const password = $('login-password')?.value;

  // Validate fields
  if (!email) {
    showFieldError($('login-email'), 'Please enter your email address.');
    shakeElement($('login-form'));
    return;
  }

  if (!isValidEmail(email)) {
    showFieldError($('login-email'), 'Please enter a valid email address.');
    shakeElement($('login-form'));
    return;
  }

  if (!password) {
    showFieldError($('login-password'), 'Please enter your password.');
    shakeElement($('login-form'));
    return;
  }

  try {
    isSubmitting = true;
    showLoading('login-btn', 'Signing in...');

    const result = await window.electronAPI.login({ email, password });

    if (result.success && result.user) {
      try {
        localStorage.setItem('atikmeet_saved_login_credentials', JSON.stringify({
          email,
          password,
          name: result.user.name || email.split('@')[0],
          isAdmin: result.user.isAdmin
        }));
      } catch (e) {}

      const targetPage = (result.user.isAdmin || email.toLowerCase() === 'admin@atikmeet.com') ? 'admin' : 'home';
      showSuccess(`Welcome ${result.user.name || 'Back'}! Redirecting...`);
      setTimeout(() => {
        window.electronAPI.navigate(targetPage);
      }, 600);
    } else {
      showError(result.error || 'Login failed. Please try again.');
      shakeElement($('login-form'));
    }
  } catch (error) {
    console.error('[Auth] Login error:', error);
    showError('An unexpected error occurred. Please try again.');
    shakeElement($('login-form'));
  } finally {
    isSubmitting = false;
    hideLoading('login-btn', 'Sign In');
  }
}

/**
 * Handles the modal signup form submission
 * Validates captcha, inputs, and invokes registration API
 * @param {Event} e - Form submit event
 */
async function handleModalSignup(e) {
  e.preventDefault();

  if (isSubmitting) return;

  const firstName = $('signup-firstname')?.value?.trim();
  const lastName = $('signup-lastname')?.value?.trim();
  const email = $('signup-email')?.value?.trim();
  const password = $('signup-password')?.value;
  const captchaAnswer = parseInt($('captcha-answer')?.value, 10);

  // Validate Captcha
  if (captchaAnswer !== captchaResult) {
    alert('Incorrect captcha answer. Please try again.');
    generateCaptcha();
    return;
  }

  // Validate password length
  if (!password || password.length < 6) {
    alert('Password must be at least 6 characters.');
    return;
  }

  try {
    isSubmitting = true;
    showLoading('modal-signup-submit-btn', 'Registering...');

    const fullName = `${firstName} ${lastName}`;
    const result = await window.electronAPI.register({ name: fullName, email, password });

    if (result.success) {
      try {
        localStorage.setItem('atikmeet_saved_login_credentials', JSON.stringify({
          email,
          password,
          name: fullName
        }));
      } catch (e) {}

      $('modal-signup-form').style.display = 'none';
      $('modal-signup-success').style.display = 'block';

      // Auto login to dashboard after 1.2 seconds
      setTimeout(async () => {
        const loginRes = await window.electronAPI.login({ email, password });
        if (loginRes.success) {
          window.electronAPI.navigate('home');
        }
      }, 1200);
    } else {
      alert(result.error || 'Registration failed. Please try again.');
      generateCaptcha();
    }
  } catch (error) {
    console.error('[Auth] Modal signup error:', error);
    alert('An unexpected error occurred. Please try again.');
    generateCaptcha();
  } finally {
    isSubmitting = false;
    hideLoading('modal-signup-submit-btn', 'Create Account & Verify');
  }
}

/**
 * Handles social login button clicks
 * @param {string} provider - The social login provider ('google', 'github', 'microsoft')
 */
async function handleSocialLogin(provider) {
  if (isSubmitting) return;

  try {
    isSubmitting = true;
    showLoading(`${provider}-login`, 'Connecting...');

    const result = await window.electronAPI.socialLogin(provider);

    if (result && result.success) {
      showSuccess(`Signed in with ${provider}! Redirecting...`);
      const targetPage = (result.user && (result.user.isAdmin || result.user.email?.toLowerCase() === 'admin@atikmeet.com')) ? 'admin' : 'home';
      setTimeout(() => {
        window.electronAPI.navigate(targetPage);
      }, 800);
    } else if (result && !result.success && result.error !== 'Authentication popup closed by user.') {
      showError(result.error || `${provider} login failed. Please try again.`);
    }
  } catch (error) {
    console.error(`[Auth] ${provider} login error:`, error);
    showError(`Failed to connect with ${provider}. Please try again.`);
  } finally {
    isSubmitting = false;
    hideLoading(`${provider}-login`);
  }
}

// ── Form Toggle with Animation ───────────────────────────────

/**
 * Toggles between login and signup forms with a smooth animation
 * @param {string} formName - 'login' or 'signup'
 */
function toggleForm(formName) {
  if (currentForm === formName) return;

  const loginForm = $('login-form');
  const signupForm = $('signup-form');

  if (!loginForm || !signupForm) return;

  // Clear any existing messages and errors
  clearAllErrors();
  clearMessages();

  if (formName === 'signup') {
    // Animate out login form
    loginForm.style.opacity = '0';
    loginForm.style.transform = 'translateX(-30px)';

    setTimeout(() => {
      loginForm.style.display = 'none';
      signupForm.style.display = 'block';

      // Trigger reflow for animation
      void signupForm.offsetWidth;

      signupForm.style.opacity = '1';
      signupForm.style.transform = 'translateX(0)';
      currentForm = 'signup';
      $('auth-title').innerText = 'Join AtikMeet';
      $('auth-subtitle').innerText = 'Create your account for HD video calls';
    }, 300);
  } else {
    // Animate out signup form
    signupForm.style.opacity = '0';
    signupForm.style.transform = 'translateX(30px)';

    setTimeout(() => {
      signupForm.style.display = 'none';
      loginForm.style.display = 'block';

      // Trigger reflow for animation
      void loginForm.offsetWidth;

      loginForm.style.opacity = '1';
      loginForm.style.transform = 'translateX(0)';
      currentForm = 'login';
      $('auth-title').innerText = 'Welcome Back';
      $('auth-subtitle').innerText = 'Enter your credentials to access AtikMeet';
    }, 300);
  }

  currentForm = formName;
}

// ── Password Toggle ──────────────────────────────────────────

/**
 * Toggles password visibility for an input field
 * @param {Event} e - Click event on the toggle button
 */
function handlePasswordToggle(e) {
  const toggle = e.currentTarget;
  const inputId = toggle.getAttribute('data-target');
  const input = $(inputId);

  if (!input) return;

  if (input.type === 'password') {
    input.type = 'text';
    toggle.innerHTML = '<i class="fas fa-eye-slash"></i>';
    toggle.setAttribute('aria-label', 'Hide password');
  } else {
    input.type = 'password';
    toggle.innerHTML = '<i class="fas fa-eye"></i>';
    toggle.setAttribute('aria-label', 'Show password');
  }
}

// ── Password Strength Indicator ──────────────────────────────

/**
 * Updates the password strength indicator bar and label
 * @param {string} password - The current password value
 */
function updatePasswordStrength(password) {
  const strengthBar = $('password-strength-bar');
  const strengthLabel = $('password-strength-label');

  if (!strengthBar || !strengthLabel) return;

  let strength = 0;
  let label = '';
  let color = '';

  if (password.length === 0) {
    strengthBar.style.width = '0%';
    strengthLabel.textContent = '';
    return;
  }

  // Length check
  if (password.length >= 6) strength++;
  if (password.length >= 10) strength++;

  // Character variety checks
  if (/[a-z]/.test(password)) strength++;
  if (/[A-Z]/.test(password)) strength++;
  if (/[0-9]/.test(password)) strength++;
  if (/[^a-zA-Z0-9]/.test(password)) strength++;

  // Map strength score to label and color
  if (strength <= 2) {
    label = 'Weak';
    color = '#ef4444'; // Red
  } else if (strength <= 4) {
    label = 'Fair';
    color = '#f59e0b'; // Amber
  } else if (strength <= 5) {
    label = 'Good';
    color = '#22c55e'; // Green
  } else {
    label = 'Strong';
    color = '#10b981'; // Emerald
  }

  const percentage = Math.min((strength / 6) * 100, 100);
  strengthBar.style.width = `${percentage}%`;
  strengthBar.style.backgroundColor = color;
  strengthLabel.textContent = label;
  strengthLabel.style.color = color;
}

// ── Validation Helpers ───────────────────────────────────────

/**
 * Validates an email address format
 * @param {string} email - Email to validate
 * @returns {boolean} True if valid
 */
function isValidEmail(email) {
  const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  return emailRegex.test(email);
}

/**
 * Validates an email input field and shows/hides error
 * @param {HTMLInputElement} input - The email input element
 */
function validateEmailField(input) {
  const value = input.value.trim();
  if (value && !isValidEmail(value)) {
    showFieldError(input, 'Please enter a valid email address.');
  }
}

// ── Error & Message Display ──────────────────────────────────

/**
 * Shows an error message below a specific input field
 * @param {HTMLElement} input - The input element
 * @param {string} message - Error message text
 */
function showFieldError(input, message) {
  if (!input) return;

  // Remove existing error for this field
  clearFieldError(input);

  // Add error styling to input
  input.classList.add('input-error');

  // Create and insert error message
  const errorEl = document.createElement('div');
  errorEl.className = 'field-error-message';
  errorEl.textContent = message;
  errorEl.style.color = '#ef4444';
  errorEl.style.fontSize = '12px';
  errorEl.style.marginTop = '4px';
  errorEl.style.opacity = '0';
  errorEl.style.transition = 'opacity 0.2s ease';

  input.parentNode.insertBefore(errorEl, input.nextSibling);

  // Animate in
  requestAnimationFrame(() => {
    errorEl.style.opacity = '1';
  });

  // Focus the input
  input.focus();
}

/**
 * Clears the error state for a specific input field
 * @param {HTMLElement} input - The input element
 */
function clearFieldError(input) {
  if (!input) return;

  input.classList.remove('input-error');

  const existingError = input.parentNode.querySelector('.field-error-message');
  if (existingError) {
    existingError.remove();
  }
}

/**
 * Clears all field errors on the page
 */
function clearAllErrors() {
  document.querySelectorAll('.input-error').forEach((el) => {
    el.classList.remove('input-error');
  });
  document.querySelectorAll('.field-error-message').forEach((el) => {
    el.remove();
  });
}

/**
 * Shows a global error message in the auth message area
 * @param {string} message - Error message text
 */
function showError(message) {
  const messageArea = $('auth-message');
  if (!messageArea) return;

  let displayMsg = message || 'Login failed. Please check your credentials and try again.';
  if (typeof displayMsg === 'string') {
    if (displayMsg.includes('Cannot read properties') || displayMsg.includes('null') || displayMsg.includes('undefined') || displayMsg.includes('TypeError')) {
      displayMsg = 'Unable to connect to database. Please check your internet connection and restart the app.';
    }
  }

  messageArea.className = 'auth-message error';
  messageArea.textContent = displayMsg;
  messageArea.style.display = 'block';
  messageArea.style.opacity = '0';

  requestAnimationFrame(() => {
    messageArea.style.opacity = '1';
  });

  // Auto-hide after 6 seconds
  setTimeout(() => {
    messageArea.style.opacity = '0';
    setTimeout(() => {
      messageArea.style.display = 'none';
    }, 300);
  }, 6000);
}

/**
 * Shows a global success message in the auth message area
 * @param {string} message - Success message text
 */
function showSuccess(message) {
  const messageArea = $('auth-message');
  if (!messageArea) return;

  messageArea.className = 'auth-message success';
  messageArea.textContent = message;
  messageArea.style.display = 'block';
  messageArea.style.opacity = '0';

  requestAnimationFrame(() => {
    messageArea.style.opacity = '1';
  });
}

/**
 * Clears the global message area
 */
function clearMessages() {
  const messageArea = $('auth-message');
  if (messageArea) {
    messageArea.style.display = 'none';
    messageArea.textContent = '';
  }
}

// ── UI Animation Helpers ─────────────────────────────────────

/**
 * Applies a shake animation to an element (used for errors)
 * @param {HTMLElement} element - Element to shake
 */
function shakeElement(element) {
  if (!element) return;

  element.classList.add('shake');
  setTimeout(() => {
    element.classList.remove('shake');
  }, 600);
}

/**
 * Shows a loading state on a button
 * @param {string} btnId - Button element ID
 * @param {string} loadingText - Text to show during loading
 */
function showLoading(btnId, loadingText = 'Please wait...') {
  const btn = $(btnId);
  if (!btn) return;

  btn.disabled = true;
  btn.setAttribute('data-original-text', btn.innerHTML);
  btn.innerHTML = `
    <span class="spinner"></span>
    <span>${loadingText}</span>
  `;
  btn.classList.add('loading');
}

/**
 * Restores a button from loading state
 * @param {string} btnId - Button element ID
 * @param {string} originalText - Text to restore (fallback)
 */
function hideLoading(btnId, originalText) {
  const btn = $(btnId);
  if (!btn) return;

  btn.disabled = false;
  btn.innerHTML = btn.getAttribute('data-original-text') || originalText || 'Submit';
  btn.classList.remove('loading');
}
