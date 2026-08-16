/**
 * Auth Client Module - Handles Authentication, Registration, Forgot Password and User State
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
    // Clean URL query parameters
    window.history.replaceState({}, document.title, window.location.pathname);
    showToast('Đăng nhập bằng tài khoản Google thành công!', 'success');
  } else if (oauthError) {
    window.history.replaceState({}, document.title, window.location.pathname);
    showToast('Đăng nhập Google thất bại: ' + oauthError, 'error');
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
    const data = await res.json();
    if (data.success) {
      AuthState.user = data.user;
      AuthState.subscription = data.subscription;
      updateAuthUI(data.user, data.subscription);
    } else {
      logout(false);
    }
  } catch (err) {
    console.error('Lỗi khởi tạo phiên đăng nhập:', err);
  }
}

// Initialize Google Identity Services (GIS)
let googleClientId = '';
async function initGoogleAuth() {
  try {
    const res = await fetch('/api/auth/google/client-id');
    const data = await res.json();
    if (data.success && data.clientId) {
      googleClientId = data.clientId;

      if (window.google && window.google.accounts && window.google.accounts.id) {
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
      }
    }
  } catch (err) {
    console.warn('Google OAuth chưa được kích hoạt hoặc cấu hình:', err.message);
  }
}

// Handle Google ID Token from Google Button / One-Tap
async function handleGoogleCredentialResponse(response) {
  if (!response || !response.credential) return;

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
      showToast('Đăng nhập bằng tài khoản Google thành công!', 'success');
      if (typeof reloadJobsHistory === 'function') {
        reloadJobsHistory();
      }
    } else {
      showToast(data.error || 'Đăng nhập Google thất bại.', 'error');
    }
  } catch (err) {
    showToast('Lỗi kết nối máy chủ khi đăng nhập Google.', 'error');
  }
}

// Fallback direct redirect flow
function loginWithGoogleRedirect() {
  window.location.href = '/api/auth/google';
}

// Update Header UI based on user session
function updateAuthUI(user, subscription) {
  const guestArea = document.getElementById('auth-guest-area');
  const userArea = document.getElementById('auth-user-area');
  const adminBtn = document.getElementById('btn-admin-panel');
  const subBadge = document.getElementById('user-sub-badge');
  const userNameEl = document.getElementById('user-display-name');
  const userQuotaBar = document.getElementById('user-quota-bar');
  const userQuotaText = document.getElementById('user-quota-text');

  if (user) {
    if (guestArea) guestArea.classList.add('hidden');
    if (userArea) userArea.classList.remove('hidden');
    if (userNameEl) userNameEl.textContent = user.name || user.email.split('@')[0];

    // Show Admin button if admin
    if (adminBtn) {
      if (user.role === 'admin') {
        adminBtn.classList.remove('hidden');
      } else {
        adminBtn.classList.add('hidden');
      }
    }

    // Update Subscription Badge & Quota
    if (subscription && subBadge) {
      subBadge.textContent = subscription.badge || subscription.planName;
      if (subscription.planId === 'enterprise') {
        subBadge.className = 'px-2 py-0.5 text-[10px] font-bold bg-purple-100 text-purple-700 rounded-full border border-purple-300';
      } else if (subscription.planId === 'pro') {
        subBadge.className = 'px-2 py-0.5 text-[10px] font-bold bg-amber-100 text-amber-800 rounded-full border border-amber-300';
      } else {
        subBadge.className = 'px-2 py-0.5 text-[10px] font-bold bg-slate-100 text-slate-700 rounded-full border border-slate-300';
      }

      if (userQuotaBar && userQuotaText) {
        const used = subscription.charsUsedMonth || 0;
        const limit = subscription.charLimitMonthly || 20000;
        const percent = Math.min(100, Math.round((used / limit) * 100));
        userQuotaBar.style.width = `${percent}%`;
        userQuotaText.textContent = `${used.toLocaleString()} / ${limit.toLocaleString()} ký tự`;
      }
    }
  } else {
    if (guestArea) guestArea.classList.remove('hidden');
    if (userArea) userArea.classList.add('hidden');
    if (adminBtn) adminBtn.classList.add('hidden');
  }
}

// Open Auth Modal (login / register)
function openAuthModal(mode = 'login') {
  const modal = document.getElementById('auth-modal');
  if (!modal) return;

  switchAuthTab(mode);
  modal.classList.remove('hidden');
  modal.classList.add('flex');
}

function closeAuthModal() {
  const modal = document.getElementById('auth-modal');
  if (modal) {
    modal.classList.add('hidden');
    modal.classList.remove('flex');
  }
}

function switchAuthTab(tab) {
  const loginForm = document.getElementById('auth-login-form');
  const registerForm = document.getElementById('auth-register-form');
  const forgotForm = document.getElementById('auth-forgot-form');
  const tabLogin = document.getElementById('tab-btn-login');
  const tabRegister = document.getElementById('tab-btn-register');

  if (!loginForm || !registerForm || !forgotForm) return;

  loginForm.classList.add('hidden');
  registerForm.classList.add('hidden');
  forgotForm.classList.add('hidden');

  if (tabLogin) tabLogin.className = 'flex-1 py-2 font-bold text-sm text-slate-500 border-b-2 border-transparent';
  if (tabRegister) tabRegister.className = 'flex-1 py-2 font-bold text-sm text-slate-500 border-b-2 border-transparent';

  const socialSection = document.getElementById('auth-social-section');

  if (tab === 'login') {
    loginForm.classList.remove('hidden');
    if (tabLogin) tabLogin.className = 'flex-1 py-2 font-bold text-sm text-blue-600 border-b-2 border-blue-600';
    if (socialSection) socialSection.classList.remove('hidden');
  } else if (tab === 'register') {
    registerForm.classList.remove('hidden');
    if (tabRegister) tabRegister.className = 'flex-1 py-2 font-bold text-sm text-blue-600 border-b-2 border-blue-600';
    if (socialSection) socialSection.classList.remove('hidden');
  } else if (tab === 'forgot') {
    forgotForm.classList.remove('hidden');
    if (socialSection) socialSection.classList.add('hidden');
  }
}

// Handle Login submit
async function handleLoginSubmit(e) {
  e.preventDefault();
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  const btn = document.getElementById('btn-submit-login');
  const errorEl = document.getElementById('login-error-msg');

  if (errorEl) errorEl.classList.add('hidden');
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Đang đăng nhập...';

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
      showToast('Đăng nhập thành công!', 'success');
      if (typeof reloadJobsHistory === 'function') {
        reloadJobsHistory();
      }
    } else {
      if (errorEl) {
        errorEl.textContent = data.error || 'Đăng nhập thất bại.';
        errorEl.classList.remove('hidden');
      }
    }
  } catch (err) {
    if (errorEl) {
      errorEl.textContent = 'Lỗi kết nối máy chủ: ' + err.message;
      errorEl.classList.remove('hidden');
    }
  } finally {
    btn.disabled = false;
    btn.innerHTML = 'Đăng nhập';
  }
}

// Handle Register submit
async function handleRegisterSubmit(e) {
  e.preventDefault();
  const name = document.getElementById('reg-name').value.trim();
  const email = document.getElementById('reg-email').value.trim();
  const password = document.getElementById('reg-password').value;
  const btn = document.getElementById('btn-submit-register');
  const errorEl = document.getElementById('reg-error-msg');

  if (errorEl) errorEl.classList.add('hidden');
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Đang tạo tài khoản...';

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
      showToast('Đăng ký thành công! Bạn nhận được 20.000 ký tự miễn phí.', 'success');
      if (typeof reloadJobsHistory === 'function') {
        reloadJobsHistory();
      }
    } else {
      if (errorEl) {
        errorEl.textContent = data.error || 'Đăng ký thất bại.';
        errorEl.classList.remove('hidden');
      }
    }
  } catch (err) {
    if (errorEl) {
      errorEl.textContent = 'Lỗi kết nối máy chủ: ' + err.message;
      errorEl.classList.remove('hidden');
    }
  } finally {
    btn.disabled = false;
    btn.innerHTML = 'Đăng ký tài khoản';
  }
}

// Handle Forgot Password OTP flow
let forgotStep = 1;
let forgotEmail = '';

async function handleForgotSubmit(e) {
  e.preventDefault();
  const emailInput = document.getElementById('forgot-email');
  const otpInput = document.getElementById('forgot-otp');
  const newPassInput = document.getElementById('forgot-new-password');
  const step1Div = document.getElementById('forgot-step-1');
  const step2Div = document.getElementById('forgot-step-2');
  const btn = document.getElementById('btn-submit-forgot');
  const msgEl = document.getElementById('forgot-msg');

  if (msgEl) msgEl.classList.add('hidden');

  if (forgotStep === 1) {
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
        btn.innerHTML = 'Đặt lại mật khẩu mới';
        if (msgEl) {
          msgEl.className = 'text-xs text-green-600 bg-green-50 p-2 rounded border border-green-200';
          msgEl.textContent = data.message;
          msgEl.classList.remove('hidden');
        }
      } else {
        if (msgEl) {
          msgEl.className = 'text-xs text-red-600 bg-red-50 p-2 rounded border border-red-200';
          msgEl.textContent = data.error || 'Không thể gửi mã xác nhận.';
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
        showToast('Đặt lại mật khẩu thành công! Vui lòng đăng nhập.', 'success');
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
    showToast('Đã đăng xuất tài khoản.', 'info');
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

  if (nameInput) nameInput.value = AuthState.user.name || '';
  if (emailInput) emailInput.value = AuthState.user.email || '';

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
  const name = document.getElementById('prof-name').value.trim();
  const currentPassword = document.getElementById('prof-curr-pass').value;
  const newPassword = document.getElementById('prof-new-pass').value;
  const btn = document.getElementById('btn-save-profile');
  const errorEl = document.getElementById('prof-error-msg');

  if (errorEl) errorEl.classList.add('hidden');
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Đang lưu...';

  try {
    const payload = { name };
    if (newPassword) {
      payload.currentPassword = currentPassword;
      payload.newPassword = newPassword;
    }

    const res = await fetch('/api/auth/profile', {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify(payload),
    });
    const data = await res.json();

    if (data.success) {
      AuthState.user = data.user;
      updateAuthUI(data.user, AuthState.subscription);
      closeProfileModal();
      showToast('Cập nhật thông tin thành công!', 'success');
    } else {
      if (errorEl) {
        errorEl.textContent = data.error || 'Cập nhật thất bại.';
        errorEl.classList.remove('hidden');
      }
    }
  } catch (err) {
    if (errorEl) {
      errorEl.textContent = 'Lỗi kết nối máy chủ: ' + err.message;
      errorEl.classList.remove('hidden');
    }
  } finally {
    btn.disabled = false;
    btn.innerHTML = 'Lưu thay đổi';
  }
}

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => {
  initAuth();
});
