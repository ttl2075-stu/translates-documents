/**
 * Dedicated Admin Portal Controller (Light Theme & Full Plan CRUD)
 */

function getAdminAuthHeaders() {
  const token = localStorage.getItem('auth_token');
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token || ''}`,
  };
}

let searchTimeout = null;
let cachedPlans = [];

async function checkAdminAuth() {
  const token = localStorage.getItem('auth_token');
  if (!token) {
    window.location.href = '/app?auth_error=' + encodeURIComponent('Vui lòng đăng nhập quyền Quản trị viên để truy cập trang này.');
    return false;
  }

  try {
    const res = await fetch('/api/auth/me', { headers: getAdminAuthHeaders() });
    const data = await res.json();
    if (!data.success || data.user.role !== 'admin') {
      window.location.href = '/app?auth_error=' + encodeURIComponent('Bạn không có quyền quản trị viên.');
      return false;
    }

    const nameEl = document.getElementById('admin-user-name');
    if (nameEl) nameEl.textContent = data.user.name || data.user.email;
    return true;
  } catch (err) {
    window.location.href = '/app';
    return false;
  }
}

function switchAdminTab(tab) {
  const tabs = ['overview', 'users', 'plans', 'transactions', 'settings'];
  tabs.forEach((t) => {
    const sec = document.getElementById(`tab-${t}`);
    const nav = document.getElementById(`nav-${t}`);
    if (sec) sec.classList.toggle('hidden', t !== tab);
    if (nav) {
      if (t === tab) {
        nav.className = 'w-full flex items-center gap-3 px-3.5 py-2.5 text-xs font-bold rounded-xl bg-blue-600 text-white shadow-xs transition-all';
      } else {
        nav.className = 'w-full flex items-center gap-3 px-3.5 py-2.5 text-xs font-semibold rounded-xl text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-all';
      }
    }
  });

  if (tab === 'overview') loadAdminStats();
  if (tab === 'users') loadAdminUsers();
  if (tab === 'plans') loadAdminPlans();
  if (tab === 'transactions') loadAdminTransactions();
  if (tab === 'settings') loadAdminSettings();
}

// 1. STATS
async function loadAdminStats() {
  try {
    const res = await fetch('/api/admin/stats', { headers: getAdminAuthHeaders() });
    const data = await res.json();
    if (data.success && data.stats) {
      const s = data.stats;
      const revEl = document.getElementById('stat-revenue');
      const usersEl = document.getElementById('stat-total-users');
      const subsEl = document.getElementById('stat-paid-users');
      const jobsEl = document.getElementById('stat-active-jobs');

      if (revEl) revEl.textContent = s.totalRevenueVnd.toLocaleString() + ' ₫';
      if (usersEl) usersEl.textContent = s.totalUsers.toLocaleString();
      if (subsEl) subsEl.textContent = s.activeSubscribers.toLocaleString();
      if (jobsEl) jobsEl.textContent = s.totalJobs.toLocaleString();

      // Recent transactions table in overview
      loadOverviewRecentTransactions();
    }
  } catch (err) {
    console.error('Lỗi tải thống kê admin:', err);
  }
}

async function loadOverviewRecentTransactions() {
  const tbody = document.getElementById('overview-transactions-tbody');
  if (!tbody) return;

  try {
    const res = await fetch('/api/admin/transactions?limit=5', { headers: getAdminAuthHeaders() });
    const data = await res.json();

    if (!data.success || !data.transactions || data.transactions.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" class="py-6 text-center text-slate-400">Chưa có giao dịch webhook nào.</td></tr>`;
      return;
    }

    tbody.innerHTML = data.transactions
      .map(
        (t) => `
        <tr class="hover:bg-slate-50 transition-colors">
          <td class="py-2.5 px-3 font-mono text-[11px] text-slate-500">${t.transactionDate}</td>
          <td class="py-2.5 px-3">
            <span class="font-bold text-blue-600 font-mono">${t.code || 'TRANS...'}</span>
            <span class="text-slate-500 text-[11px] block truncate max-w-xs">${t.content || ''}</span>
          </td>
          <td class="py-2.5 px-3 font-semibold text-slate-700">${t.gateway}</td>
          <td class="py-2.5 px-3 text-right font-bold font-mono text-emerald-600">
            +${t.amountIn.toLocaleString()} ₫
          </td>
          <td class="py-2.5 px-3 text-center">
            <span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">Thành công</span>
          </td>
        </tr>
      `
      )
      .join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5" class="py-4 text-center text-rose-500">Lỗi: ${err.message}</td></tr>`;
  }
}

// 2. USERS
async function loadAdminUsers(search = '') {
  const tbody = document.getElementById('admin-users-tbody');
  if (!tbody) return;

  try {
    const res = await fetch(`/api/admin/users?search=${encodeURIComponent(search)}`, {
      headers: getAdminAuthHeaders(),
    });
    const data = await res.json();

    if (!data.success || !data.users || data.users.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" class="py-8 text-center text-slate-400">Không tìm thấy người dùng nào.</td></tr>`;
      return;
    }

    tbody.innerHTML = data.users
      .map((u) => {
        const isBanned = u.status === 'banned';
        const roleBadge =
          u.role === 'admin'
            ? `<span class="px-2 py-0.5 text-[10px] font-bold bg-purple-50 text-purple-700 border border-purple-200 rounded-md">Admin</span>`
            : `<span class="px-2 py-0.5 text-[10px] font-bold bg-slate-100 text-slate-600 rounded-md">User</span>`;

        const subBadge =
          u.plan_id === 'enterprise'
            ? `<span class="px-2 py-0.5 text-[10px] font-bold bg-purple-50 text-purple-700 border border-purple-200 rounded-md">Enterprise</span>`
            : u.plan_id === 'pro'
            ? `<span class="px-2 py-0.5 text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200 rounded-md">Pro</span>`
            : `<span class="px-2 py-0.5 text-[10px] font-bold bg-slate-100 text-slate-600 rounded-md">Free</span>`;

        const statusBadge = isBanned
          ? `<span class="px-2 py-0.5 text-[10px] font-bold bg-rose-50 text-rose-700 border border-rose-200 rounded-md">Đã Khóa</span>`
          : `<span class="px-2 py-0.5 text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-md">Hoạt động</span>`;

        const expiresStr = u.expires_at ? new Date(u.expires_at).toLocaleDateString('vi-VN') : 'Vĩnh viễn';

        return `
          <tr class="hover:bg-slate-50 transition-colors">
            <td class="py-3 px-4">
              <div class="font-bold text-slate-900">${u.name || 'Chưa đặt tên'}</div>
              <div class="text-[11px] text-slate-500 font-mono">${u.email}</div>
            </td>
            <td class="py-3 px-4">${roleBadge}</td>
            <td class="py-3 px-4">${subBadge}</td>
            <td class="py-3 px-4 font-mono text-[11px] text-slate-700">
              ${u.chars_used_month.toLocaleString()} / ${(u.char_limit_monthly || 20000).toLocaleString()}
            </td>
            <td class="py-3 px-4 text-[11px] text-slate-500 font-mono">${expiresStr}</td>
            <td class="py-3 px-4">${statusBadge}</td>
            <td class="py-3 px-4 text-right space-x-1.5 whitespace-nowrap">
              <button onclick="openEditUserModal('${u.id}', '${u.email}', '${u.role}', '${u.status}')" class="px-2.5 py-1 bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 rounded-lg text-[11px] font-semibold transition-colors">
                <i class="fa-solid fa-pen-to-square mr-1"></i>Sửa
              </button>
              <button onclick="handleToggleUserStatus('${u.id}', '${u.status}', '${u.email}')" class="px-2.5 py-1 ${isBanned ? 'bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200' : 'bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200'} rounded-lg text-[11px] font-semibold transition-colors">
                ${isBanned ? 'Mở Khóa' : 'Khóa'}
              </button>
            </td>
          </tr>
        `;
      })
      .join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7" class="py-6 text-center text-rose-500">Lỗi kết nối máy chủ: ${err.message}</td></tr>`;
  }
}

// Search debounce
document.addEventListener('DOMContentLoaded', () => {
  const searchInput = document.getElementById('admin-user-search-input');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => {
        loadAdminUsers(e.target.value.trim());
      }, 300);
    });
  }
});

function openEditUserModal(userId, email, role, status) {
  document.getElementById('edit-user-id').value = userId;
  document.getElementById('edit-user-email').value = email;
  document.getElementById('edit-user-role').value = role;
  document.getElementById('edit-user-status').value = status;
  document.getElementById('edit-user-plan').value = '';
  document.getElementById('edit-user-extend-days').value = '';

  const modal = document.getElementById('modal-edit-user');
  modal.classList.remove('hidden');
  modal.classList.add('flex');
}

function closeEditUserModal() {
  const modal = document.getElementById('modal-edit-user');
  modal.classList.add('hidden');
  modal.classList.remove('flex');
}

async function submitEditUser(e) {
  e.preventDefault();
  const userId = document.getElementById('edit-user-id').value;
  const role = document.getElementById('edit-user-role').value;
  const status = document.getElementById('edit-user-status').value;
  const planId = document.getElementById('edit-user-plan').value;
  const extendDays = document.getElementById('edit-user-extend-days').value;

  const payload = { role, status };
  if (planId) payload.planId = planId;
  if (extendDays && parseInt(extendDays, 10) > 0) payload.extendDays = parseInt(extendDays, 10);

  try {
    const res = await fetch(`/api/admin/users/${userId}`, {
      method: 'PUT',
      headers: getAdminAuthHeaders(),
      body: JSON.stringify(payload),
    });
    const data = await res.json();

    if (data.success) {
      window.Dialog.toast('Cập nhật tài khoản thành công!', 'success');
      closeEditUserModal();
      loadAdminUsers();
    } else {
      window.Dialog.alert('Lỗi', data.error || 'Cập nhật thất bại.', 'error');
    }
  } catch (err) {
    window.Dialog.alert('Lỗi', err.message, 'error');
  }
}

async function handleToggleUserStatus(userId, currentStatus, email) {
  const newStatus = currentStatus === 'banned' ? 'active' : 'banned';
  const confirmed = await window.Dialog.confirm({
    title: newStatus === 'banned' ? 'Khóa tài khoản' : 'Mở khóa tài khoản',
    message: `Bạn có chắc chắn muốn ${newStatus === 'banned' ? 'khóa' : 'mở khóa'} tài khoản [${email}] không?`,
    confirmText: newStatus === 'banned' ? 'Khóa tài khoản' : 'Mở khóa',
    isDestructive: newStatus === 'banned',
  });

  if (!confirmed) return;

  try {
    const res = await fetch(`/api/admin/users/${userId}`, {
      method: 'PUT',
      headers: getAdminAuthHeaders(),
      body: JSON.stringify({ status: newStatus }),
    });
    const data = await res.json();
    if (data.success) {
      window.Dialog.toast('Cập nhật trạng thái người dùng thành công!', 'success');
      loadAdminUsers();
    } else {
      window.Dialog.alert('Lỗi', data.error || 'Thao tác thất bại.', 'error');
    }
  } catch (err) {
    window.Dialog.alert('Lỗi', err.message, 'error');
  }
}

// 3. PLANS (FULL CRUD)
async function loadAdminPlans() {
  const container = document.getElementById('admin-plans-grid');
  if (!container) return;

  try {
    const res = await fetch('/api/admin/plans', { headers: getAdminAuthHeaders() });
    const data = await res.json();

    if (data.success && data.plans) {
      cachedPlans = data.plans;
      container.innerHTML = data.plans
        .map((p) => {
          const isPro = p.id === 'pro';
          const isEnterprise = p.id === 'enterprise';

          let featuresListHtml = (p.features || [])
            .map(
              (f) => `
              <li class="flex items-center gap-1.5 text-xs text-slate-600">
                <i class="fa-solid fa-check text-emerald-500 text-[10px]"></i>
                <span>${f}</span>
              </li>
            `
            )
            .join('');

          return `
            <div class="bg-white border border-slate-200/90 rounded-2xl p-6 shadow-xs flex flex-col justify-between space-y-5 transition-all hover:shadow-md">
              <div>
                <div class="flex items-center justify-between mb-2">
                  <h3 class="font-extrabold text-base text-slate-900">${p.name}</h3>
                  <span class="px-2.5 py-0.5 text-[10px] font-bold rounded-full ${
                    isEnterprise ? 'bg-purple-100 text-purple-700' : isPro ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-600'
                  }">${p.badge || 'Gói cước'}</span>
                </div>

                <div class="mb-4">
                  <span class="text-2xl font-black text-slate-900">${p.priceVnd.toLocaleString()} ₫</span>
                  <span class="text-xs text-slate-500">/ ${p.durationDays} ngày</span>
                </div>

                <!-- Feature Badges -->
                <div class="grid grid-cols-2 gap-2 mb-4">
                  <div class="p-2.5 rounded-xl bg-slate-50 border border-slate-100">
                    <span class="text-[10px] uppercase font-bold text-slate-400 block">Số Luồng Dịch</span>
                    <span class="text-xs font-bold text-slate-800"><i class="fa-solid fa-bolt text-amber-500 mr-1"></i>${p.maxConcurrentJobs} luồng song song</span>
                  </div>

                  <div class="p-2.5 rounded-xl bg-slate-50 border border-slate-100">
                    <span class="text-[10px] uppercase font-bold text-slate-400 block">Hạn Mức Ký Tự</span>
                    <span class="text-xs font-bold text-slate-800">${p.charLimitMonthly.toLocaleString()} / tháng</span>
                  </div>

                  <div class="p-2.5 rounded-xl bg-slate-50 border border-slate-100">
                    <span class="text-[10px] uppercase font-bold text-slate-400 block">Dịch Nền</span>
                    <span class="text-xs font-bold ${p.allowBackgroundJobs ? 'text-blue-600' : 'text-slate-400'}">
                      <i class="fa-solid ${p.allowBackgroundJobs ? 'fa-circle-check text-blue-600' : 'fa-circle-xmark text-slate-400'} mr-1"></i>
                      ${p.allowBackgroundJobs ? 'Cho phép' : 'Tắt'}
                    </span>
                  </div>

                  <div class="p-2.5 rounded-xl bg-slate-50 border border-slate-100">
                    <span class="text-[10px] uppercase font-bold text-slate-400 block">AI Linter</span>
                    <span class="text-xs font-bold ${p.allowAiFormatReview ? 'text-purple-600' : 'text-slate-400'}">
                      <i class="fa-solid ${p.allowAiFormatReview ? 'fa-wand-magic-sparkles text-purple-600' : 'fa-circle-xmark text-slate-400'} mr-1"></i>
                      ${p.allowAiFormatReview ? 'Mặc định Bật' : 'Tắt'}
                    </span>
                  </div>
                </div>

                <ul class="space-y-1.5 pt-2 border-t border-slate-100 mb-2">
                  ${featuresListHtml}
                </ul>
              </div>

              <div class="flex items-center gap-2 pt-3 border-t border-slate-100">
                <button onclick="openEditPlanModal('${p.id}')" class="flex-1 py-2 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-xl text-xs font-bold transition-colors">
                  <i class="fa-solid fa-pen-to-square mr-1"></i> Sửa Gói
                </button>
                ${
                  p.id !== 'free'
                    ? `<button onclick="handleDeletePlan('${p.id}', '${p.name}')" class="px-3 py-2 bg-rose-50 hover:bg-rose-100 text-rose-700 rounded-xl text-xs font-bold transition-colors" title="Xóa gói cước">
                        <i class="fa-solid fa-trash"></i>
                      </button>`
                    : ''
                }
              </div>
            </div>
          `;
        })
        .join('');
    }
  } catch (err) {
    console.error('Lỗi tải danh sách gói cước:', err);
  }
}

function openCreatePlanModal() {
  document.getElementById('modal-plan-title').innerHTML = '<i class="fa-solid fa-plus text-blue-600"></i> Thêm Gói Cước Mới';
  document.getElementById('plan-mode').value = 'create';
  
  const idInput = document.getElementById('plan-id');
  idInput.value = '';
  idInput.readOnly = false;
  idInput.classList.remove('bg-slate-100', 'cursor-not-allowed');

  document.getElementById('plan-name').value = '';
  document.getElementById('plan-price').value = '99000';
  document.getElementById('plan-duration').value = '30';
  document.getElementById('plan-char-limit').value = '500000';
  document.getElementById('plan-max-jobs').value = '3';
  document.getElementById('plan-allow-background').checked = true;
  document.getElementById('plan-allow-ai-review').checked = true;
  document.getElementById('plan-badge').value = '';
  document.getElementById('plan-features').value = 'Dịch tốc độ cao\nBảo toàn công thức KaTeX\nTiến trình dịch nền tự động';

  const modal = document.getElementById('modal-plan');
  modal.classList.remove('hidden');
  modal.classList.add('flex');
}

function openEditPlanModal(planId) {
  const plan = cachedPlans.find((p) => p.id === planId);
  if (!plan) return;

  document.getElementById('modal-plan-title').innerHTML = `<i class="fa-solid fa-pen-to-square text-blue-600"></i> Sửa Gói: ${plan.name}`;
  document.getElementById('plan-mode').value = 'edit';

  const idInput = document.getElementById('plan-id');
  idInput.value = plan.id;
  idInput.readOnly = true;
  idInput.classList.add('bg-slate-100', 'cursor-not-allowed');

  document.getElementById('plan-name').value = plan.name;
  document.getElementById('plan-price').value = plan.priceVnd;
  document.getElementById('plan-duration').value = plan.durationDays;
  document.getElementById('plan-char-limit').value = plan.charLimitMonthly;
  document.getElementById('plan-max-jobs').value = plan.maxConcurrentJobs;
  document.getElementById('plan-allow-background').checked = Boolean(plan.allowBackgroundJobs);
  document.getElementById('plan-allow-ai-review').checked = Boolean(plan.allowAiFormatReview);
  document.getElementById('plan-badge').value = plan.badge || '';
  document.getElementById('plan-features').value = (plan.features || []).join('\n');

  const modal = document.getElementById('modal-plan');
  modal.classList.remove('hidden');
  modal.classList.add('flex');
}

function closePlanModal() {
  const modal = document.getElementById('modal-plan');
  modal.classList.add('hidden');
  modal.classList.remove('flex');
}

async function submitPlanForm(e) {
  e.preventDefault();
  const mode = document.getElementById('plan-mode').value;
  const id = document.getElementById('plan-id').value.trim();
  const name = document.getElementById('plan-name').value.trim();
  const priceVnd = parseInt(document.getElementById('plan-price').value, 10);
  const durationDays = parseInt(document.getElementById('plan-duration').value, 10);
  const charLimitMonthly = parseInt(document.getElementById('plan-char-limit').value, 10);
  const maxConcurrentJobs = parseInt(document.getElementById('plan-max-jobs').value, 10);
  const allowBackgroundJobs = document.getElementById('plan-allow-background').checked;
  const allowAiFormatReview = document.getElementById('plan-allow-ai-review').checked;
  const badge = document.getElementById('plan-badge').value.trim();
  const featuresText = document.getElementById('plan-features').value;
  const features = featuresText
    .split('\n')
    .map((f) => f.trim())
    .filter(Boolean);

  const payload = {
    id,
    name,
    priceVnd,
    durationDays,
    charLimitMonthly,
    maxConcurrentJobs,
    allowBackgroundJobs,
    allowAiFormatReview,
    badge,
    features,
  };

  try {
    const url = mode === 'create' ? '/api/admin/plans' : `/api/admin/plans/${id}`;
    const method = mode === 'create' ? 'POST' : 'PUT';

    const res = await fetch(url, {
      method,
      headers: getAdminAuthHeaders(),
      body: JSON.stringify(payload),
    });
    const data = await res.json();

    if (data.success) {
      window.Dialog.toast(mode === 'create' ? 'Tạo gói cước mới thành công!' : 'Cập nhật gói cước thành công!', 'success');
      closePlanModal();
      loadAdminPlans();
    } else {
      window.Dialog.alert('Lỗi', data.error || 'Thao tác gói cước thất bại.', 'error');
    }
  } catch (err) {
    window.Dialog.alert('Lỗi', err.message, 'error');
  }
}

async function handleDeletePlan(planId, planName) {
  const confirmed = await window.Dialog.confirm({
    title: 'Xóa gói cước',
    message: `Bạn có chắc chắn muốn xóa/vô hiệu hóa gói [${planName}] (${planId}) không?`,
    confirmText: 'Xóa Gói',
    isDestructive: true,
  });

  if (!confirmed) return;

  try {
    const res = await fetch(`/api/admin/plans/${planId}`, {
      method: 'DELETE',
      headers: getAdminAuthHeaders(),
    });
    const data = await res.json();

    if (data.success) {
      window.Dialog.toast(data.message || 'Đã xóa gói cước thành công!', 'success');
      loadAdminPlans();
    } else {
      window.Dialog.alert('Lỗi', data.error || 'Không thể xóa gói cước.', 'error');
    }
  } catch (err) {
    window.Dialog.alert('Lỗi', err.message, 'error');
  }
}

// 4. TRANSACTIONS
async function loadAdminTransactions() {
  const tbody = document.getElementById('admin-transactions-tbody');
  if (!tbody) return;

  try {
    const res = await fetch('/api/admin/transactions?limit=50', { headers: getAdminAuthHeaders() });
    const data = await res.json();

    if (!data.success || !data.transactions || data.transactions.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" class="py-8 text-center text-slate-400">Chưa có giao dịch webhook nào.</td></tr>`;
      return;
    }

    tbody.innerHTML = data.transactions
      .map(
        (t) => `
        <tr class="hover:bg-slate-50 transition-colors">
          <td class="py-3 px-4 font-bold text-slate-800">#${t.sepayId}</td>
          <td class="py-3 px-4 text-slate-500 font-mono text-[11px]">${t.transactionDate}</td>
          <td class="py-3 px-4 font-semibold text-slate-700">${t.gateway} (${t.accountNumber || '-'})</td>
          <td class="py-3 px-4 font-mono font-bold text-blue-600">${t.code || '-'}</td>
          <td class="py-3 px-4 text-slate-600 text-[11px] truncate max-w-xs">${t.content || ''}</td>
          <td class="py-3 px-4 text-right font-bold font-mono ${t.amountIn > 0 ? 'text-emerald-600' : 'text-rose-600'}">
            ${t.amountIn > 0 ? '+' : '-'}${t.amountIn.toLocaleString()} ₫
          </td>
          <td class="py-3 px-4 text-center">
            <span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">Đã nhận</span>
          </td>
        </tr>
      `
      )
      .join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7" class="py-6 text-center text-rose-500">Lỗi: ${err.message}</td></tr>`;
  }
}

// 5. SETTINGS
async function loadAdminSettings() {
  try {
    const res = await fetch('/api/admin/settings', { headers: getAdminAuthHeaders() });
    const data = await res.json();
    if (data.success && data.settings) {
      const s = data.settings;
      const bankName = document.getElementById('setting-bank-name');
      const bankAccount = document.getElementById('setting-bank-account');
      const bankAccountName = document.getElementById('setting-bank-account-name');
      const secret = document.getElementById('setting-sepay-secret');

      if (bankName) bankName.value = s.bank_name || '';
      if (bankAccount) bankAccount.value = s.bank_account || '';
      if (bankAccountName) bankAccountName.value = s.bank_account_name || '';
      if (secret) secret.value = s.sepay_webhook_secret || '';
    }
  } catch (err) {
    console.error('Lỗi tải cài đặt admin:', err);
  }
}

async function saveAdminSettings(e) {
  e.preventDefault();
  const bankName = document.getElementById('setting-bank-name').value.trim();
  const bankAccount = document.getElementById('setting-bank-account').value.trim();
  const bankAccountName = document.getElementById('setting-bank-account-name').value.trim();
  const sepayWebhookSecret = document.getElementById('setting-sepay-secret').value.trim();

  try {
    const res = await fetch('/api/admin/settings', {
      method: 'POST',
      headers: getAdminAuthHeaders(),
      body: JSON.stringify({ bankName, bankAccount, bankAccountName, sepayWebhookSecret }),
    });
    const data = await res.json();
    if (data.success) {
      window.Dialog.toast('Lưu cấu hình hệ thống thành công!', 'success');
    } else {
      window.Dialog.alert('Lỗi', data.error || 'Không thể lưu cài đặt.', 'error');
    }
  } catch (err) {
    window.Dialog.alert('Lỗi', err.message, 'error');
  }
}

function handleAdminLogout() {
  localStorage.removeItem('auth_token');
  window.location.href = '/app';
}

document.addEventListener('DOMContentLoaded', async () => {
  const isAuth = await checkAdminAuth();
  if (isAuth) {
    loadAdminStats();
  }
});
