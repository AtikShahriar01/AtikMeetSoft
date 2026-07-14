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
  // Auto-login if running on developer's PC / localhost
  const isLocalHostIP = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
  const isDesktopApp = !!window.electronAPI;

  if (isDesktopApp || isLocalHostIP) {
    try {
      let result;
      if (isDesktopApp) {
        result = await window.electronAPI.autoLoginAdmin();
      } else {
        const resp = await fetch('/api/auto-login-local-admin');
        result = await resp.json();
      }

      if (result && result.success) {
        // Bypass user panel completely for localhost developer PC
        if (isDesktopApp) {
          window.electronAPI.navigate('admin');
        } else {
          window.location.href = '/pages/admin.html';
        }
        return;
      }
    } catch (err) {
      console.warn('Auto login admin failed:', err);
    }
  }

  initAuthListeners();
  setupExternalLinks();
});

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
function initAuthListeners() {
  // Login form submission
  const loginForm = $('login-form');
  if (loginForm) {
    loginForm.addEventListener('submit', handleLogin);
  }

  // Signup form submission
  const signupForm = $('signup-form');
  if (signupForm) {
    signupForm.addEventListener('submit', handleSignup);
  }

  // Trigger Google Login directly on Sign Up click
  const showSignupBtn = $('show-signup');
  if (showSignupBtn) {
    showSignupBtn.addEventListener('click', (e) => {
      e.preventDefault();
      handleSocialLogin('google');
    });
  }

  const showLoginBtn = $('show-login');
  if (showLoginBtn) {
    showLoginBtn.addEventListener('click', (e) => {
      e.preventDefault();
      toggleForm('login');
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

    if (result.success) {
      showSuccess('Login successful! Redirecting...');
      // Small delay for UX before navigating
      setTimeout(() => {
        window.electronAPI.navigate('home');
      }, 800);
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
 * Handles the signup form submission
 * Validates inputs (including password match), calls electronAPI
 * @param {Event} e - Form submit event
 */
async function handleSignup(e) {
  e.preventDefault();

  if (isSubmitting) return;

  const name = $('signup-name')?.value?.trim();
  const email = $('signup-email')?.value?.trim();
  const password = $('signup-password')?.value;
  const confirmPassword = $('signup-confirm-password')?.value;

  // Validate name
  if (!name || name.length < 2) {
    showFieldError($('signup-name'), 'Name must be at least 2 characters.');
    shakeElement($('signup-form'));
    return;
  }

  // Validate email
  if (!email) {
    showFieldError($('signup-email'), 'Please enter your email address.');
    shakeElement($('signup-form'));
    return;
  }

  if (!isValidEmail(email)) {
    showFieldError($('signup-email'), 'Please enter a valid email address.');
    shakeElement($('signup-form'));
    return;
  }

  // Validate password
  if (!password || password.length < 6) {
    showFieldError($('signup-password'), 'Password must be at least 6 characters.');
    shakeElement($('signup-form'));
    return;
  }

  // Validate password match
  if (password !== confirmPassword) {
    showFieldError($('signup-confirm-password'), 'Passwords do not match.');
    shakeElement($('signup-form'));
    return;
  }

  try {
    isSubmitting = true;
    showLoading('signup-btn', 'Creating account...');

    const result = await window.electronAPI.register({ name, email, password });

    if (result.success) {
      showSuccess('Account created! Redirecting...');
      setTimeout(() => {
        window.electronAPI.navigate('home');
      }, 800);
    } else {
      showError(result.error || 'Registration failed. Please try again.');
      shakeElement($('signup-form'));
    }
  } catch (error) {
    console.error('[Auth] Signup error:', error);
    showError('An unexpected error occurred. Please try again.');
    shakeElement($('signup-form'));
  } finally {
    isSubmitting = false;
    hideLoading('signup-btn', 'Create Account');
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

    if (result.success) {
      showSuccess(`Signed in with ${provider}! Redirecting...`);
      setTimeout(() => {
        window.electronAPI.navigate('home');
      }, 800);
    } else {
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

  messageArea.className = 'auth-message error';
  messageArea.textContent = message;
  messageArea.style.display = 'block';
  messageArea.style.opacity = '0';

  requestAnimationFrame(() => {
    messageArea.style.opacity = '1';
  });

  // Auto-hide after 5 seconds
  setTimeout(() => {
    messageArea.style.opacity = '0';
    setTimeout(() => {
      messageArea.style.display = 'none';
    }, 300);
  }, 5000);
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
