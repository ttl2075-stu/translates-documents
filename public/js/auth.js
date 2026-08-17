/**
 * Auth Client Module - Handles Authentication, Registration, Forgot Password, Google Linking and User State
 */

const AuthState = {
  token: localStorage.getItem('auth_token') || null,
  user: null,
  subscription: null,
};

// Helper: Setup auth header for fetch requests
function getAuthHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  if (AuthState.token) {
    headers['Authorization'] = `Bearer ${AuthState.token}`;
  }
  return headers;
}

// Check session on load & handle OAuth redirect token
async function initAuth() {
  // Check if redirected from OAuth callback with token or error
  const urlParams = new URLSearchParams(window.location.search);
  const oauthToken = urlParams.get('auth_token');
  const oauthError = urlParams.get('auth_error');

  if (oauthToken) {
    AuthState.token = oauthToken;
    localStorage.setItem('auth_token', oauthToken);
    window.history.replaceState({}, document.title, window.location.pathname);
    window.Dialog.toast('Đăng nhập bằng tài khoản Google thành công!', 'success');
  } else if (oauthError) {
    window.history.replaceState({}, document.title, window.location.pathname);
    window.Dialog.toast('Đăng nhập Google thất bại: ' + oauthError, 'error');
  }

  // Initialize Google Identity Services SDK
  initGoogleAuth();

  if (!AuthState.token) {
    updateAuthUI(null, null);
    return;
  }

  try {
    const res = await fetch('/api/auth/me', {
      headers: getAuthHeaders(),
    });
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        logout(false);
      }
      return;
    }
    const data = await res.json();
    if (data.success) {
      AuthState.user = data.user;
      AuthState.subscription = data.subscription;
      updateAuthUI(data.user, data.subscription);
    } else {
      logout(false);
    }
  } catch (err) {
    console.warn('Phiên đăng nhập chưa sẵn sàng:', err.message || err);
  }
}

// Initialize Google Identity Services (GIS)
let googleClientId = '';
async function initGoogleAuth() {
  try {
    const res = await fetch('/api/auth/google/client-id');
    if (!res.ok) return;
    const data = await res.json();
    if (data.success && data.clientId && data.clientId.trim().length > 0) {
      googleClientId = data.clientId;

      if (window.google && window.google.accounts && window.google.accounts.id) {
        try {
          window.google.accounts.id.initialize({
            client_id: data.clientId,
            callback: handleGoogleCredentialResponse,
            auto_select: false,
            cancel_on_tap_outside: true,
          });

          const btnContainer = document.getElementById('google-btn-container');
          if (btnContainer) {
            btnContainer.innerHTML = '';
            window.google.accounts.id.renderButton(btnContainer, {
              theme: 'outline',
              size: 'large',
              width: 320,
              text: 'continue_with',
              shape: 'rectangular',
              logo_alignment: 'left',
            });
          }
        } catch (gsiErr) {
          console.warn('Google GSI init skipped:', gsiErr.message);
        }
      }
    }
  } catch (err) {
    // Silent fallback if server is offline or OAuth not configured
  }
}

// Handle Google ID Token from Google Button / One-Tap
async function handleGoogleCredentialResponse(response) {
  if (!response || !response.credential) return;

  // If user is currently in profile modal linking Google account:
  const isLinking = document.getElementById('profile-modal')?.classList.contains('flex');
  if (isLinking && AuthState.user) {
    await linkGoogleAccount(response.credential);
    return;
  }

  try {
    const res = await fetch('/api/auth/google', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential: response.credential }),
    });
    const data = await res.json();

    if (data.success) {
      AuthState.token = data.token;
      AuthState.user = data.user;
      AuthState.subscription = data.subscription;
      localStorage.setItem('auth_token', data.token);
      updateAuthUI(data.user, data.subscription);
      closeAuthModal();
      window.Dialog.toast('Đăng nhập bằng tài khoản Google thành công!', 'success');
      if (typeof reloadJobsHistory === 'function') {
        reloadJobsHistory();
      }
    } else {
      window.Dialog.toast(data.error || 'Đăng nhập Google thất bại.', 'error');
    }
  } catch (err) {
    window.Dialog.toast('Lỗi kết nối máy chủ khi đăng nhập Google.', 'error');
  }
}

// Fallback direct redirect flow
function loginWithGoogleRedirect() {
  window.location.href = '/api/auth/google';
}

// Link Google Account for authenticated user
async function linkGoogleAccount(idToken) {
  try {
    const res = await fetch('/api/auth/google/link', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ idToken }),
    });
    const data = await res.json();
    if (data.success) {
      AuthState.user = data.user;
      updateAuthUI(AuthState.user, AuthState.subscription);
      openProfileModal();
      window.Dialog.toast('Liên kết tài khoản Google thành công!', 'success');
    } else {
      window.Dialog.alert('Không thể liên kết', data.error || 'Thao tác thất bại.', 'error');
    }
  } catch (err) {
    window.Dialog.alert('Lỗi', 'Lỗi kết nối máy chủ khi liên kết Google.', 'error');
  }
}

// Click handler for "Liên kết tài khoản Google" button
async function handleLinkGoogleClick() {
  if (window.google && window.google.accounts && window.google.accounts.id) {
    window.google.accounts.id.prompt((notification) => {
      if (notification.isNotDisplayed() || notification.isSkippedMoment()) {
        loginWithGoogleRedirect();
      }
    });
  } else {
    loginWithGoogleRedirect();
  }
}

// Click handler for "Hủy liên kết Google" button
async function handleUnlinkGoogleClick() {
  const confirmed = await window.Dialog.confirm({
    title: 'Hủy liên kết Google',
    message: 'Bạn có chắc chắn muốn gỡ liên kết tài khoản Google khỏi tài khoản này?',
    confirmText: 'Gỡ liên kết',
    isDestructive: true,
  });

  if (!confirmed) return;

  try {
    const res = await fetch('/api/auth/google/unlink', {
      method: 'POST',
      headers: getAuthHeaders(),
    });
    const data = await res.json();
    if (data.success) {
      AuthState.user = data.user;
      updateAuthUI(AuthState.user, AuthState.subscription);
      openProfileModal();
      window.Dialog.toast('Đã hủy liên kết Google thành công.', 'success');
    } else {
      window.Dialog.alert('Lỗi', data.error || 'Không thể hủy liên kết Google.', 'error');
    }
  } catch (err) {
    window.Dialog.alert('Lỗi', err.message, 'error');
  }
}

// Update Header UI based on user session
function updateAuthUI(user, subscription) {
  const guestArea = document.getElementById('auth-guest-area');
  const userArea = document.getElementById('auth-user-area');
  const adminBtn = document.getElementById('btn-admin-panel');
  const subBadge = document.getElementById('user-sub-badge');
  const userNameEl = document.getElementById('user-display-name');
  const userAvatarCircle = document.getElementById('user-avatar-circle');

  if (user) {
    if (guestArea) guestArea.classList.add('hidden');
    if (userArea) userArea.classList.remove('hidden');
    if (userNameEl) userNameEl.textContent = user.name || user.email.split('@')[0];

    // Display Avatar if available
    if (userAvatarCircle) {
      if (user.avatarUrl) {
        userAvatarCircle.innerHTML = `<img src="${user.avatarUrl}" alt="Avatar" class="w-full h-full object-cover rounded-full" referrerpolicy="no-referrer">`;
      } else {
        const firstLetter = (user.name || user.email)[0].toUpperCase();
        userAvatarCircle.textContent = firstLetter;
      }
    }

    // Show Admin button if admin
    if (adminBtn) {
      if (user.role === 'admin') {
        adminBtn.classList.remove('hidden');
      } else {
        adminBtn.classList.add('hidden');
      }
    }

    // Update Subscription Badge
    if (subscription && subBadge) {
      subBadge.textContent = subscription.badge || subscription.planName;
    }
  } else {
    if (subBadge) subBadge.textContent = 'Miễn phí';
  }

  if (typeof updateFeatureSwitchesFromSubscription === 'function') {
    updateFeatureSwitchesFromSubscription();
  }
}

// Open/Close Auth Modal
let currentAuthTab = 'login';
let forgotStep = 1;
let forgotEmail = '';

function openAuthModal(tab = 'login') {
  const modal = document.getElementById('auth-modal');
  if (modal) {
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    switchAuthTab(tab);
  }
}

function closeAuthModal() {
  const modal = document.getElementById('auth-modal');
  if (modal) {
    modal.classList.add('hidden');
    modal.classList.remove('flex');
  }
}

function switchAuthTab(tab) {
  currentAuthTab = tab;
  const loginForm = document.getElementById('auth-login-form');
  const registerForm = document.getElementById('auth-register-form');
  const forgotForm = document.getElementById('auth-forgot-form');

  const tabLoginBtn = document.getElementById('tab-btn-login');
  const tabRegBtn = document.getElementById('tab-btn-register');

  const activeTabClass = 'flex-1 py-2 text-xs font-bold text-blue-600 border-b-2 border-blue-600 transition-colors';
  const inactiveTabClass = 'flex-1 py-2 text-xs font-medium text-slate-500 hover:text-slate-700 transition-colors';

  if (loginForm) loginForm.classList.toggle('hidden', tab !== 'login');
  if (registerForm) registerForm.classList.toggle('hidden', tab !== 'register');
  if (forgotForm) forgotForm.classList.toggle('hidden', tab !== 'forgot');

  if (tabLoginBtn && tabRegBtn) {
    if (tab === 'login') {
      tabLoginBtn.className = activeTabClass;
      tabRegBtn.className = inactiveTabClass;
    } else if (tab === 'register') {
      tabLoginBtn.className = inactiveTabClass;
      tabRegBtn.className = activeTabClass;
    } else {
      tabLoginBtn.className = inactiveTabClass;
      tabRegBtn.className = inactiveTabClass;
    }
  }

  // Clear error messages
  const errLogin = document.getElementById('login-error-msg');
  const errReg = document.getElementById('reg-error-msg');
  const errForgot = document.getElementById('forgot-msg');
  if (errLogin) errLogin.classList.add('hidden');
  if (errReg) errReg.classList.add('hidden');
  if (errForgot) errForgot.classList.add('hidden');
}

// Handle Login Submit
async function handleLogin(e) {
  e.preventDefault();
  const emailInput = document.getElementById('login-email');
  const passInput = document.getElementById('login-pass');
  const btn = document.getElementById('btn-submit-login');
  const errorMsg = document.getElementById('login-error-msg');

  const email = emailInput.value.trim();
  const password = passInput.value;

  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Đang đăng nhập...';
  if (errorMsg) errorMsg.classList.add('hidden');

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();

    if (data.success) {
      AuthState.token = data.token;
      AuthState.user = data.user;
      AuthState.subscription = data.subscription;
      localStorage.setItem('auth_token', data.token);
      updateAuthUI(data.user, data.subscription);
      closeAuthModal();
      window.Dialog.toast(`Chào mừng ${data.user.name || data.user.email}!`, 'success');
      if (typeof reloadJobsHistory === 'function') {
        reloadJobsHistory();
      }
    } else {
      if (errorMsg) {
        errorMsg.textContent = data.error || 'Đăng nhập thất bại.';
        errorMsg.classList.remove('hidden');
      }
    }
  } catch (err) {
    if (errorMsg) {
      errorMsg.textContent = 'Lỗi kết nối máy chủ.';
      errorMsg.classList.remove('hidden');
    }
  } finally {
    btn.disabled = false;
    btn.innerHTML = 'Đăng nhập';
  }
}

// Handle Register Submit
async function handleRegister(e) {
  e.preventDefault();
  const nameInput = document.getElementById('reg-name');
  const emailInput = document.getElementById('reg-email');
  const passInput = document.getElementById('reg-pass');
  const btn = document.getElementById('btn-submit-reg');
  const errorMsg = document.getElementById('reg-error-msg');

  const name = nameInput.value.trim();
  const email = emailInput.value.trim();
  const password = passInput.value;

  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Đang tạo tài khoản...';
  if (errorMsg) errorMsg.classList.add('hidden');

  try {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password }),
    });
    const data = await res.json();

    if (data.success) {
      AuthState.token = data.token;
      AuthState.user = data.user;
      AuthState.subscription = data.subscription;
      localStorage.setItem('auth_token', data.token);
      updateAuthUI(data.user, data.subscription);
      closeAuthModal();
      window.Dialog.toast('Đăng ký tài khoản thành công! Nhận 20.000 ký tự miễn phí.', 'success');
    } else {
      if (errorMsg) {
        errorMsg.textContent = data.error || 'Đăng ký thất bại.';
        errorMsg.classList.remove('hidden');
      }
    }
  } catch (err) {
    if (errorMsg) {
      errorMsg.textContent = 'Lỗi kết nối máy chủ.';
      errorMsg.classList.remove('hidden');
    }
  } finally {
    btn.disabled = false;
    btn.innerHTML = 'Tạo tài khoản & Bắt đầu';
  }
}

// Handle Forgot Password Submit
async function handleForgotPassword(e) {
  e.preventDefault();
  const emailInput = document.getElementById('forgot-email');
  const otpInput = document.getElementById('forgot-otp');
  const newPassInput = document.getElementById('forgot-new-pass');
  const btn = document.getElementById('btn-submit-forgot');
  const msgEl = document.getElementById('forgot-msg');
  const step1Div = document.getElementById('forgot-step-1');
  const step2Div = document.getElementById('forgot-step-2');

  if (forgotStep === 1) {
    // Step 1: Request OTP
    forgotEmail = emailInput.value.trim();
    if (!forgotEmail) return;

    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Đang gửi mã...';

    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: forgotEmail }),
      });
      const data = await res.json();

      if (data.success) {
        forgotStep = 2;
        step1Div.classList.add('hidden');
        step2Div.classList.remove('hidden');
        btn.innerHTML = 'Xác nhận đổi mật khẩu';
        if (msgEl) {
          msgEl.className = 'text-xs text-blue-600 bg-blue-50 p-2 rounded border border-blue-200';
          msgEl.textContent = data.message;
          msgEl.classList.remove('hidden');
        }
      } else {
        if (msgEl) {
          msgEl.className = 'text-xs text-red-600 bg-red-50 p-2 rounded border border-red-200';
          msgEl.textContent = data.error || 'Không thể gửi mã.';
          msgEl.classList.remove('hidden');
        }
      }
    } catch (err) {
      if (msgEl) {
        msgEl.className = 'text-xs text-red-600 bg-red-50 p-2 rounded border border-red-200';
        msgEl.textContent = 'Lỗi kết nối máy chủ.';
        msgEl.classList.remove('hidden');
      }
    } finally {
      btn.disabled = false;
    }
  } else {
    // Step 2: Submit OTP and new password
    const otp = otpInput.value.trim();
    const newPassword = newPassInput.value;

    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Đang cập nhật...';

    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: forgotEmail, otp, newPassword }),
      });
      const data = await res.json();

      if (data.success) {
        window.Dialog.toast('Đặt lại mật khẩu thành công! Vui lòng đăng nhập.', 'success');
        forgotStep = 1;
        step1Div.classList.remove('hidden');
        step2Div.classList.add('hidden');
        switchAuthTab('login');
      } else {
        if (msgEl) {
          msgEl.className = 'text-xs text-red-600 bg-red-50 p-2 rounded border border-red-200';
          msgEl.textContent = data.error || 'Mã xác thực không hợp lệ.';
          msgEl.classList.remove('hidden');
        }
      }
    } catch (err) {
      if (msgEl) {
        msgEl.className = 'text-xs text-red-600 bg-red-50 p-2 rounded border border-red-200';
        msgEl.textContent = 'Lỗi kết nối máy chủ.';
        msgEl.classList.remove('hidden');
      }
    } finally {
      btn.disabled = false;
    }
  }
}

// Logout
function logout(notify = true) {
  AuthState.token = null;
  AuthState.user = null;
  AuthState.subscription = null;
  localStorage.removeItem('auth_token');
  updateAuthUI(null, null);
  if (notify) {
    window.Dialog.toast('Đã đăng xuất tài khoản.', 'info');
  }
}

// User Profile Modal
function openProfileModal() {
  if (!AuthState.user) {
    openAuthModal('login');
    return;
  }

  const modal = document.getElementById('profile-modal');
  const nameInput = document.getElementById('prof-name');
  const emailInput = document.getElementById('prof-email');
  const planName = document.getElementById('prof-plan-name');
  const quotaText = document.getElementById('prof-quota-text');
  const expireText = document.getElementById('prof-expire-text');
  const googleStatus = document.getElementById('prof-google-status');
  const btnLinkGoogle = document.getElementById('btn-link-google');
  const btnUnlinkGoogle = document.getElementById('btn-unlink-google');

  if (nameInput) nameInput.value = AuthState.user.name || '';
  if (emailInput) emailInput.value = AuthState.user.email || '';

  // Google status & action toggles
  if (googleStatus && btnLinkGoogle && btnUnlinkGoogle) {
    if (AuthState.user.googleId) {
      googleStatus.innerHTML = '<span class="text-emerald-600 flex items-center gap-1"><i class="fa-solid fa-circle-check"></i> Đã liên kết</span>';
      btnLinkGoogle.classList.add('hidden');
      btnUnlinkGoogle.classList.remove('hidden');
    } else {
      googleStatus.innerHTML = '<span class="text-slate-400">Chưa liên kết</span>';
      btnLinkGoogle.classList.remove('hidden');
      btnUnlinkGoogle.classList.add('hidden');
    }
  }

  if (AuthState.subscription) {
    const sub = AuthState.subscription;
    if (planName) planName.textContent = sub.planName;
    if (quotaText) quotaText.textContent = `${sub.charsUsedMonth.toLocaleString()} / ${sub.charLimitMonthly.toLocaleString()} ký tự`;
    if (expireText) {
      if (sub.planId === 'free') {
        expireText.textContent = 'Vĩnh viễn';
      } else {
        expireText.textContent = new Date(sub.expiresAt).toLocaleDateString('vi-VN');
      }
    }
  }

  if (modal) {
    modal.classList.remove('hidden');
    modal.classList.add('flex');
  }
}

function closeProfileModal() {
  const modal = document.getElementById('profile-modal');
  if (modal) {
    modal.classList.add('hidden');
    modal.classList.remove('flex');
  }
}

async function handleProfileSave(e) {
  e.preventDefault();
  const nameInput = document.getElementById('prof-name');
  const currPassInput = document.getElementById('prof-curr-pass');
  const newPassInput = document.getElementById('prof-new-pass');
  const errorMsg = document.getElementById('prof-error-msg');
  const btn = document.getElementById('btn-save-profile');

  const name = nameInput.value.trim();
  const currentPassword = currPassInput.value;
  const newPassword = newPassInput.value;

  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Đang lưu...';
  if (errorMsg) errorMsg.classList.add('hidden');

  try {
    const res = await fetch('/api/auth/profile', {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify({ name, currentPassword, newPassword }),
    });
    const data = await res.json();

    if (data.success) {
      AuthState.user = data.user;
      updateAuthUI(data.user, AuthState.subscription);
      currPassInput.value = '';
      newPassInput.value = '';
      closeProfileModal();
      window.Dialog.toast('Cập nhật thông tin tài khoản thành công!', 'success');
    } else {
      if (errorMsg) {
        errorMsg.textContent = data.error || 'Cập nhật thất bại.';
        errorMsg.classList.remove('hidden');
      }
    }
  } catch (err) {
    if (errorMsg) {
      errorMsg.textContent = 'Lỗi kết nối máy chủ.';
      errorMsg.classList.remove('hidden');
    }
  } finally {
    btn.disabled = false;
    btn.innerHTML = 'Lưu thay đổi';
  }
}

// Auto-run on script load
document.addEventListener('DOMContentLoaded', () => {
  initAuth();
});
