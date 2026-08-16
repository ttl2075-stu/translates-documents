/**
 * Admin Panel Management Module
 */

async function openAdminModal() {
  if (!AuthState.user || AuthState.user.role !== 'admin') {
    showToast('Chỉ tài khoản quản trị viên mới có thể mở trang này.', 'error');
    return;
  }

  const modal = document.getElementById('admin-modal');
  if (!modal) return;

  modal.classList.remove('hidden');
  modal.classList.add('flex');

  // Load stats and default tab
  switchAdminTab('stats');
}

function closeAdminModal() {
  const modal = document.getElementById('admin-modal');
  if (modal) {
    modal.classList.add('hidden');
    modal.classList.remove('flex');
  }
}

function switchAdminTab(tab) {
  const tabs = ['stats', 'users', 'plans', 'transactions', 'settings'];
  tabs.forEach((t) => {
    const section = document.getElementById(`admin-tab-${t}`);
    const btn = document.getElementById(`admin-btn-tab-${t}`);
    if (section) {
      if (t === tab) {
        section.classList.remove('hidden');
      } else {
        section.classList.add('hidden');
      }
    }
    if (btn) {
      if (t === tab) {
        btn.className = 'px-3 py-1.5 font-bold text-xs bg-blue-50 text-blue-700 rounded-lg border border-blue-200';
      } else {
        btn.className = 'px-3 py-1.5 font-medium text-xs text-slate-600 hover:bg-slate-100 rounded-lg';
      }
    }
  });

  if (tab === 'stats') loadAdminStats();
  if (tab === 'users') loadAdminUsers();
  if (tab === 'plans') loadAdminPlans();
  if (tab === 'transactions') loadAdminTransactions();
  if (tab === 'settings') loadAdminSettings();
}

// 1. Load Stats
async function loadAdminStats() {
  const revEl = document.getElementById('admin-stat-rev');
  const usersEl = document.getElementById('admin-stat-users');
  const subsEl = document.getElementById('admin-stat-subs');
  const jobsEl = document.getElementById('admin-stat-jobs');

  try {
    const res = await fetch('/api/admin/stats', { headers: getAuthHeaders() });
    const data = await res.json();
    if (data.success && data.stats) {
      const s = data.stats;
      if (revEl) revEl.textContent = `${s.totalRevenueVnd.toLocaleString()}₫`;
      if (usersEl) usersEl.textContent = s.totalUsers.toLocaleString();
      if (subsEl) subsEl.textContent = s.activeSubscribers.toLocaleString();
      if (jobsEl) jobsEl.textContent = s.totalJobs.toLocaleString();
    }
  } catch (err) {
    console.error('Lỗi tải thống kê admin:', err);
  }
}

// 2. Load Users
async function loadAdminUsers() {
  const searchInput = document.getElementById('admin-user-search');
  const search = searchInput ? searchInput.value.trim() : '';
  const tbody = document.getElementById('admin-users-tbody');
  if (!tbody) return;

  tbody.innerHTML = `<tr><td colspan="6" class="text-center py-6 text-slate-400"><i class="fa-solid fa-spinner fa-spin mr-1"></i> Đang tải danh sách người dùng...</td></tr>`;

  try {
    const res = await fetch(`/api/admin/users?search=${encodeURIComponent(search)}`, {
      headers: getAuthHeaders(),
    });
    const data = await res.json();

    if (data.success && data.users) {
      if (data.users.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="text-center py-6 text-slate-400">Không tìm thấy người dùng nào.</td></tr>`;
        return;
      }

      tbody.innerHTML = '';
      data.users.forEach((u) => {
        const tr = document.createElement('tr');
        tr.className = 'border-b border-slate-100 hover:bg-slate-50 text-xs';

        const isBanned = u.status === 'banned';
        const isFree = !u.plan_id || u.plan_id === 'free';
        const used = u.chars_used_month || 0;
        const limit = u.char_limit_monthly || 20000;
        const dateStr = new Date(u.created_at).toLocaleDateString('vi-VN');

        tr.innerHTML = `
          <td class="py-3 px-3">
            <div class="font-bold text-slate-800">${u.name}</div>
            <div class="text-slate-400 text-[11px]">${u.email}</div>
          </td>
          <td class="py-3 px-3">
            <span class="px-2 py-0.5 rounded font-bold text-[10px] ${u.role === 'admin' ? 'bg-purple-100 text-purple-700' : 'bg-slate-100 text-slate-700'}">
              ${u.role}
            </span>
          </td>
          <td class="py-3 px-3">
            <span class="px-2 py-0.5 rounded font-bold text-[10px] ${isFree ? 'bg-slate-100 text-slate-600' : 'bg-blue-100 text-blue-700'}">
              ${u.plan_name || 'Gói Khởi Đầu'}
            </span>
          </td>
          <td class="py-3 px-3 font-mono text-[11px]">
            ${used.toLocaleString()} / ${limit.toLocaleString()}
          </td>
          <td class="py-3 px-3">
            <span class="px-2 py-0.5 rounded font-semibold text-[10px] ${isBanned ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}">
              ${isBanned ? 'Bị khóa' : 'Hoạt động'}
            </span>
          </td>
          <td class="py-3 px-3 text-right">
            <div class="inline-flex items-center gap-1.5">
              <button onclick="promptUserUpgrade('${u.id}', '${u.name}')" class="px-2 py-1 bg-blue-50 text-blue-600 hover:bg-blue-100 rounded text-[11px] font-semibold" title="Nâng gói cước">
                <i class="fa-solid fa-arrow-up"></i> Gói
              </button>
              <button onclick="toggleUserStatus('${u.id}', '${isBanned ? 'active' : 'banned'}')" class="px-2 py-1 ${isBanned ? 'bg-green-50 text-green-600 hover:bg-green-100' : 'bg-red-50 text-red-600 hover:bg-red-100'} rounded text-[11px] font-semibold">
                ${isBanned ? 'Mở khóa' : 'Khóa'}
              </button>
            </div>
          </td>
        `;
        tbody.appendChild(tr);
      });
    }
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-center py-6 text-red-500">Lỗi: ${err.message}</td></tr>`;
  }
}

// Prompt Admin to upgrade user subscription manually
async function promptUserUpgrade(userId, userName) {
  const planId = prompt(`Chọn gói cước cho "${userName}" (nhập: free, pro, hoặc enterprise):`, 'pro');
  if (!planId) return;

  const extendDays = prompt('Số ngày gia hạn thêm (ví dụ: 30):', '30');

  try {
    const res = await fetch(`/api/admin/users/${userId}`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify({ planId: planId.trim().toLowerCase(), extendDays: parseInt(extendDays, 10) || 30 }),
    });
    const data = await res.json();
    if (data.success) {
      showToast('Đã nâng cấp gói cho người dùng thành công!', 'success');
      loadAdminUsers();
    } else {
      showToast(data.error || 'Cập nhật thất bại.', 'error');
    }
  } catch (err) {
    showToast('Lỗi: ' + err.message, 'error');
  }
}

// Toggle user status (active/banned)
async function toggleUserStatus(userId, newStatus) {
  if (!confirm(`Bạn có chắc chắn muốn chuyển trạng thái tài khoản sang "${newStatus}"?`)) return;

  try {
    const res = await fetch(`/api/admin/users/${userId}`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify({ status: newStatus }),
    });
    const data = await res.json();
    if (data.success) {
      showToast('Cập nhật trạng thái người dùng thành công!', 'success');
      loadAdminUsers();
    } else {
      showToast(data.error || 'Lỗi cập nhật.', 'error');
    }
  } catch (err) {
    showToast('Lỗi: ' + err.message, 'error');
  }
}

// 3. Load Plans
async function loadAdminPlans() {
  const container = document.getElementById('admin-plans-list');
  if (!container) return;

  container.innerHTML = `<div class="text-center py-6 text-slate-400"><i class="fa-solid fa-spinner fa-spin mr-1"></i> Đang tải danh sách gói...</div>`;

  try {
    const res = await fetch('/api/admin/plans', { headers: getAuthHeaders() });
    const data = await res.json();

    if (data.success && data.plans) {
      container.innerHTML = '';
      data.plans.forEach((p) => {
        const item = document.createElement('div');
        item.className = 'p-4 bg-white border border-slate-200 rounded-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4';

        item.innerHTML = `
          <div>
            <div class="flex items-center gap-2">
              <h4 class="font-extrabold text-sm text-slate-900">${p.name}</h4>
              <span class="text-[10px] font-bold px-2 py-0.5 rounded bg-blue-50 text-blue-700">${p.id}</span>
            </div>
            <div class="text-xs text-slate-500 mt-1">
              Giá: <strong class="text-slate-800">${p.priceVnd.toLocaleString()}₫</strong> &bull; 
              Hạn mức: <strong class="text-slate-800">${p.charLimitMonthly.toLocaleString()} ký tự</strong> &bull; 
              Luồng dịch: <strong>${p.maxConcurrentJobs}</strong>
            </div>
          </div>
          <button onclick="promptEditPlan('${p.id}', ${p.priceVnd}, ${p.charLimitMonthly})" class="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-bold">
            <i class="fa-solid fa-pen-to-square mr-1"></i> Sửa giá & hạn mức
          </button>
        `;
        container.appendChild(item);
      });
    }
  } catch (err) {
    container.innerHTML = `<div class="text-red-500 py-4 text-xs">Lỗi: ${err.message}</div>`;
  }
}

async function promptEditPlan(planId, currPrice, currLimit) {
  const newPrice = prompt(`Nhập giá mới cho gói ${planId} (VNĐ):`, currPrice);
  if (newPrice === null) return;

  const newLimit = prompt(`Nhập hạn mức ký tự mới / tháng:`, currLimit);
  if (newLimit === null) return;

  try {
    const res = await fetch(`/api/admin/plans/${planId}`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        priceVnd: parseInt(newPrice, 10) || 0,
        charLimitMonthly: parseInt(newLimit, 10) || 20000,
      }),
    });
    const data = await res.json();
    if (data.success) {
      showToast('Cập nhật gói cước thành công!', 'success');
      loadAdminPlans();
    } else {
      showToast(data.error || 'Cập nhật thất bại.', 'error');
    }
  } catch (err) {
    showToast('Lỗi: ' + err.message, 'error');
  }
}

// 4. Load SePay Transactions
async function loadAdminTransactions() {
  const tbody = document.getElementById('admin-tx-tbody');
  if (!tbody) return;

  tbody.innerHTML = `<tr><td colspan="5" class="text-center py-6 text-slate-400"><i class="fa-solid fa-spinner fa-spin mr-1"></i> Đang tải lịch sử SePay...</td></tr>`;

  try {
    const res = await fetch('/api/admin/transactions', { headers: getAuthHeaders() });
    const data = await res.json();

    if (data.success && data.transactions) {
      if (data.transactions.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="text-center py-6 text-slate-400">Chưa có giao dịch webhook nào từ SePay.</td></tr>`;
        return;
      }

      tbody.innerHTML = '';
      data.transactions.forEach((tx) => {
        const tr = document.createElement('tr');
        tr.className = 'border-b border-slate-100 hover:bg-slate-50 text-xs';

        tr.innerHTML = `
          <td class="py-2.5 px-3 font-mono text-[11px] text-slate-500">#${tx.sepay_id}</td>
          <td class="py-2.5 px-3">
            <span class="font-bold text-slate-800">${tx.gateway}</span>
            <div class="text-[11px] text-slate-400">${tx.account_number}</div>
          </td>
          <td class="py-2.5 px-3 font-bold text-green-600 font-mono">
            +${tx.amount_in.toLocaleString()}₫
          </td>
          <td class="py-2.5 px-3">
            <span class="px-1.5 py-0.5 rounded font-mono font-bold text-[10px] bg-blue-50 text-blue-700">
              ${tx.code || 'N/A'}
            </span>
            <div class="text-[11px] text-slate-500 truncate max-w-xs" title="${tx.content}">${tx.content}</div>
          </td>
          <td class="py-2.5 px-3 text-slate-400 text-[11px]">
            ${tx.transaction_date || new Date(tx.created_at).toLocaleString('vi-VN')}
          </td>
        `;
        tbody.appendChild(tr);
      });
    }
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5" class="text-center py-6 text-red-500">Lỗi: ${err.message}</td></tr>`;
  }
}

// 5. Load Settings
async function loadAdminSettings() {
  const bankNameInput = document.getElementById('admin-setting-bank-name');
  const bankAccInput = document.getElementById('admin-setting-bank-acc');
  const bankAccNameInput = document.getElementById('admin-setting-bank-holder');
  const secretInput = document.getElementById('admin-setting-sepay-secret');

  try {
    const res = await fetch('/api/admin/settings', { headers: getAuthHeaders() });
    const data = await res.json();
    if (data.success && data.settings) {
      const s = data.settings;
      if (bankNameInput) bankNameInput.value = s.bank_name || '';
      if (bankAccInput) bankAccInput.value = s.bank_account || '';
      if (bankAccNameInput) bankAccNameInput.value = s.bank_account_name || '';
      if (secretInput) secretInput.placeholder = s.sepay_webhook_secret ? 'Đã cấu hình' : 'Nhập Secret Key SePay...';
    }
  } catch (err) {
    console.error('Lỗi tải cài đặt admin:', err);
  }
}

async function handleSaveAdminSettings(e) {
  e.preventDefault();
  const bankName = document.getElementById('admin-setting-bank-name').value.trim();
  const bankAccount = document.getElementById('admin-setting-bank-acc').value.trim();
  const bankAccountName = document.getElementById('admin-setting-bank-holder').value.trim();
  const sepayWebhookSecret = document.getElementById('admin-setting-sepay-secret').value.trim();
  const btn = document.getElementById('btn-save-admin-settings');

  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Đang lưu...';

  try {
    const res = await fetch('/api/admin/settings', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ bankName, bankAccount, bankAccountName, sepayWebhookSecret }),
    });
    const data = await res.json();
    if (data.success) {
      showToast('Lưu cấu hình hệ thống thành công!', 'success');
    } else {
      showToast(data.error || 'Lỗi khi lưu.', 'error');
    }
  } catch (err) {
    showToast('Lỗi kết nối: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = 'Lưu Cài Đặt';
  }
}
