/**
 * Dedicated Admin Portal Controller
 */

function getAdminAuthHeaders() {
  const token = localStorage.getItem('auth_token');
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token || ''}`,
  };
}

let searchTimeout = null;

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
  const sections = ['overview', 'users', 'plans', 'transactions', 'settings'];
  sections.forEach((s) => {
    const sec = document.getElementById(`section-${s}`);
    const nav = document.getElementById(`nav-${s}`);
    if (sec) sec.classList.toggle('hidden', s !== tab);
    if (nav) {
      if (s === tab) {
        nav.className = 'w-full flex items-center gap-3 px-3 py-2.5 text-xs font-semibold rounded-xl bg-blue-600 text-white shadow-xs transition-all';
      } else {
        nav.className = 'w-full flex items-center gap-3 px-3 py-2.5 text-xs font-semibold rounded-xl text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 transition-all';
      }
    }
  });

  if (tab === 'overview') loadAdminStats();
  if (tab === 'users') loadAdminUsers();
  if (tab === 'plans') loadAdminPlans();
  if (tab === 'transactions') loadAdminTransactions();
  if (tab === 'settings') loadAdminSettings();
}

async function loadAdminStats() {
  try {
    const res = await fetch('/api/admin/stats', { headers: getAdminAuthHeaders() });
    const data = await res.json();
    if (data.success && data.stats) {
      const s = data.stats;
      const revEl = document.getElementById('stat-revenue');
      const usersEl = document.getElementById('stat-users');
      const subsEl = document.getElementById('stat-subscribers');
      const jobsEl = document.getElementById('stat-jobs');

      if (revEl) revEl.textContent = s.totalRevenueVnd.toLocaleString() + ' ₫';
      if (usersEl) usersEl.textContent = s.totalUsers.toLocaleString();
      if (subsEl) subsEl.textContent = s.activeSubscribers.toLocaleString();
      if (jobsEl) jobsEl.textContent = s.totalJobs.toLocaleString();
    }
  } catch (err) {
    console.error('Lỗi tải thống kê admin:', err);
  }
}

async function loadAdminUsers(search = '') {
  const tbody = document.getElementById('table-users-body');
  if (!tbody) return;

  try {
    const res = await fetch(`/api/admin/users?search=${encodeURIComponent(search)}`, {
      headers: getAdminAuthHeaders(),
    });
    const data = await res.json();

    if (!data.success || !data.users || data.users.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" class="px-5 py-8 text-center text-slate-500">Không tìm thấy người dùng nào.</td></tr>`;
      return;
    }

    tbody.innerHTML = data.users
      .map((u) => {
        const isBanned = u.status === 'banned';
        const roleBadge =
          u.role === 'admin'
            ? `<span class="px-2 py-0.5 text-[10px] font-bold bg-purple-500/20 text-purple-300 border border-purple-500/30 rounded-md">Admin</span>`
            : `<span class="px-2 py-0.5 text-[10px] font-bold bg-slate-800 text-slate-400 rounded-md">User</span>`;

        const subBadge =
          u.plan_id === 'enterprise'
            ? `<span class="px-2 py-0.5 text-[10px] font-bold bg-purple-500/10 text-purple-300 border border-purple-500/20 rounded-md">Enterprise</span>`
            : u.plan_id === 'pro'
            ? `<span class="px-2 py-0.5 text-[10px] font-bold bg-amber-500/10 text-amber-300 border border-amber-500/20 rounded-md">Pro</span>`
            : `<span class="px-2 py-0.5 text-[10px] font-bold bg-slate-800 text-slate-400 rounded-md">Free</span>`;

        const statusBadge = isBanned
          ? `<span class="px-2 py-0.5 text-[10px] font-bold bg-rose-500/10 text-rose-400 border border-rose-500/20 rounded-md">Đã Khóa</span>`
          : `<span class="px-2 py-0.5 text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-md">Hoạt động</span>`;

        const expiresStr = u.expires_at ? new Date(u.expires_at).toLocaleDateString('vi-VN') : 'Vĩnh viễn';

        return `
          <tr class="hover:bg-slate-900/50 transition-colors">
            <td class="px-5 py-3.5">
              <div class="font-bold text-slate-100">${u.name || 'Chưa đặt tên'}</div>
              <div class="text-[11px] text-slate-400 font-mono">${u.email}</div>
            </td>
            <td class="px-4 py-3.5">${roleBadge}</td>
            <td class="px-4 py-3.5">${subBadge}</td>
            <td class="px-4 py-3.5 font-mono text-[11px]">
              ${u.chars_used_month.toLocaleString()} / ${(u.char_limit_monthly || 20000).toLocaleString()}
            </td>
            <td class="px-4 py-3.5 text-[11px] text-slate-400 font-mono">${expiresStr}</td>
            <td class="px-4 py-3.5">${statusBadge}</td>
            <td class="px-5 py-3.5 text-right space-x-1.5">
              <button onclick="handleExtendSub('${u.id}', '${u.email}')" class="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded text-[11px] font-semibold transition-colors" title="Gia hạn ngày sử dụng">
                + Ngày
              </button>
              <button onclick="handleAssignPlan('${u.id}', '${u.email}')" class="px-2 py-1 bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 border border-blue-500/30 rounded text-[11px] font-semibold transition-colors">
                Gán Gói
              </button>
              <button onclick="handleToggleUserStatus('${u.id}', '${u.status}', '${u.email}')" class="px-2 py-1 ${isBanned ? 'bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-400 border border-emerald-500/30' : 'bg-rose-600/20 hover:bg-rose-600/30 text-rose-400 border border-rose-500/30'} rounded text-[11px] font-semibold transition-colors">
                ${isBanned ? 'Mở Khóa' : 'Khóa'}
              </button>
            </td>
          </tr>
        `;
      })
      .join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7" class="px-5 py-6 text-center text-rose-400">Lỗi kết nối máy chủ: ${err.message}</td></tr>`;
  }
}

function debounceUserSearch() {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => {
    const input = document.getElementById('input-search-users');
    loadAdminUsers(input ? input.value.trim() : '');
  }, 350);
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

async function handleExtendSub(userId, email) {
  const daysStr = await window.Dialog.prompt({
    title: 'Gia hạn gói cước',
    message: `Nhập số ngày muốn cộng thêm cho [${email}]:`,
    defaultValue: '30',
    placeholder: 'Số ngày (ví dụ: 30)',
  });

  if (!daysStr) return;
  const days = parseInt(daysStr, 10);
  if (isNaN(days) || days <= 0) {
    window.Dialog.alert('Lỗi', 'Số ngày nhập vào không hợp lệ.', 'error');
    return;
  }

  try {
    const res = await fetch(`/api/admin/users/${userId}`, {
      method: 'PUT',
      headers: getAdminAuthHeaders(),
      body: JSON.stringify({ extendDays: days }),
    });
    const data = await res.json();
    if (data.success) {
      window.Dialog.toast(`Đã gia hạn thêm ${days} ngày cho tài khoản!`, 'success');
      loadAdminUsers();
    } else {
      window.Dialog.alert('Lỗi', data.error || 'Không thể gia hạn.', 'error');
    }
  } catch (err) {
    window.Dialog.alert('Lỗi', err.message, 'error');
  }
}

async function handleAssignPlan(userId, email) {
  const planId = await window.Dialog.prompt({
    title: 'Gán gói cước cho người dùng',
    message: `Nhập mã gói cước muốn gán cho [${email}] (free / pro / enterprise):`,
    defaultValue: 'pro',
    placeholder: 'free, pro, hoặc enterprise',
  });

  if (!planId) return;

  try {
    const res = await fetch(`/api/admin/users/${userId}`, {
      method: 'PUT',
      headers: getAdminAuthHeaders(),
      body: JSON.stringify({ planId: planId.trim().toLowerCase() }),
    });
    const data = await res.json();
    if (data.success) {
      window.Dialog.toast('Đã gán gói cước thành công!', 'success');
      loadAdminUsers();
    } else {
      window.Dialog.alert('Lỗi', data.error || 'Không thể gán gói.', 'error');
    }
  } catch (err) {
    window.Dialog.alert('Lỗi', err.message, 'error');
  }
}

async function loadAdminPlans() {
  const container = document.getElementById('plans-container');
  if (!container) return;

  try {
    const res = await fetch('/api/admin/plans', { headers: getAdminAuthHeaders() });
    const data = await res.json();

    if (data.success && data.plans) {
      container.innerHTML = data.plans
        .map(
          (p) => `
          <div class="bg-slate-900/80 border border-slate-800/80 rounded-2xl p-6 shadow-xs flex flex-col justify-between space-y-4">
            <div>
              <div class="flex items-center justify-between mb-2">
                <h3 class="font-bold text-sm text-slate-100">${p.name}</h3>
                <span class="px-2.5 py-0.5 text-[10px] font-bold bg-blue-500/10 text-blue-400 border border-blue-500/20 rounded-full">${p.badge || 'Gói'}</span>
              </div>
              <div class="text-xl font-bold font-mono text-slate-100">${p.priceVnd.toLocaleString()} ₫ <span class="text-xs font-normal text-slate-400">/ ${p.durationDays} ngày</span></div>
              <div class="mt-4 text-xs text-slate-400 space-y-1.5">
                <div><strong>Hạn mức:</strong> ${p.charLimitMonthly.toLocaleString()} ký tự/tháng</div>
                <div><strong>Luồng dịch song song:</strong> ${p.maxConcurrentJobs} luồng</div>
              </div>
            </div>

            <button onclick="handleEditPlan('${p.id}', ${p.priceVnd}, ${p.charLimitMonthly}, ${p.maxConcurrentJobs})" class="w-full py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-lg transition-colors">
              Chỉnh Sửa Giá & Hạn Mức
            </button>
          </div>
        `
        )
        .join('');
    }
  } catch (err) {
    console.error('Lỗi tải gói cước:', err);
  }
}

async function handleEditPlan(planId, currentPrice, currentLimit, currentJobs) {
  const newPriceStr = await window.Dialog.prompt({
    title: 'Chỉnh sửa giá tiền (VNĐ)',
    message: `Nhập giá mới cho gói [${planId}] (VNĐ):`,
    defaultValue: currentPrice.toString(),
  });
  if (newPriceStr === null) return;

  const newLimitStr = await window.Dialog.prompt({
    title: 'Chỉnh sửa hạn mức ký tự',
    message: `Nhập hạn mức ký tự / tháng cho gói [${planId}]:`,
    defaultValue: currentLimit.toString(),
  });
  if (newLimitStr === null) return;

  const priceVnd = parseInt(newPriceStr, 10);
  const charLimitMonthly = parseInt(newLimitStr, 10);

  try {
    const res = await fetch(`/api/admin/plans/${planId}`, {
      method: 'PUT',
      headers: getAdminAuthHeaders(),
      body: JSON.stringify({ priceVnd, charLimitMonthly }),
    });
    const data = await res.json();
    if (data.success) {
      window.Dialog.toast('Cập nhật gói cước thành công!', 'success');
      loadAdminPlans();
    } else {
      window.Dialog.alert('Lỗi', data.error || 'Cập nhật thất bại.', 'error');
    }
  } catch (err) {
    window.Dialog.alert('Lỗi', err.message, 'error');
  }
}

async function loadAdminTransactions() {
  const tbody = document.getElementById('table-transactions-body');
  if (!tbody) return;

  try {
    const res = await fetch('/api/admin/transactions?limit=25', { headers: getAdminAuthHeaders() });
    const data = await res.json();

    if (!data.success || !data.transactions || data.transactions.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" class="px-4 py-6 text-center text-slate-500">Chưa có giao dịch webhook nào.</td></tr>`;
      return;
    }

    tbody.innerHTML = data.transactions
      .map(
        (t) => `
        <tr class="hover:bg-slate-900/50 transition-colors">
          <td class="px-4 py-2.5 font-bold text-slate-300">#${t.sepayId}</td>
          <td class="px-4 py-2.5 text-slate-400">${t.transactionDate}</td>
          <td class="px-4 py-2.5">${t.gateway} (${t.accountNumber || '-'})</td>
          <td class="px-4 py-2.5 font-bold ${t.amountIn > 0 ? 'text-emerald-400' : 'text-rose-400'}">
            ${t.amountIn > 0 ? '+' : '-'}${t.amountIn.toLocaleString()} ₫
          </td>
          <td class="px-4 py-2.5 text-slate-300">
            <span class="text-blue-400 font-bold">${t.code || '-'}</span> ${t.content || ''}
          </td>
        </tr>
      `
      )
      .join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5" class="px-4 py-6 text-center text-rose-400">Lỗi: ${err.message}</td></tr>`;
  }
}

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

async function handleSaveSettings(e) {
  e.preventDefault();
  const bankName = document.getElementById('setting-bank-name').value.trim();
  const bankAccount = document.getElementById('setting-bank-account').value.trim();
  const bankAccountName = document.getElementById('setting-bank-account-name').value.trim();
  const sepayWebhookSecret = document.getElementById('setting-sepay-secret').value.trim();
  const btn = document.getElementById('btn-save-settings');

  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Đang lưu...';

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
  } finally {
    btn.disabled = false;
    btn.innerHTML = 'Lưu Cấu Hình';
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
