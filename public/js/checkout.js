/**
 * Checkout & Subscription Upgrade Module with SePay VietQR & Live Polling
 */

let activeOrderPollingTimer = null;
let currentOrderCode = null;

async function openUpgradeModal() {
  if (!AuthState.user) {
    if (window.Dialog && typeof window.Dialog.toast === 'function') {
      window.Dialog.toast('Vui lòng đăng nhập để nâng cấp gói cước.', 'info');
    }
    openAuthModal('login');
    return;
  }

  const modal = document.getElementById('upgrade-modal');
  if (!modal) return;

  modal.classList.remove('hidden');
  modal.classList.add('flex');

  // Load latest plans
  loadUpgradePlans();
}

function closeUpgradeModal() {
  const modal = document.getElementById('upgrade-modal');
  if (modal) {
    modal.classList.add('hidden');
    modal.classList.remove('flex');
  }
}

// Load plans from API
async function loadUpgradePlans() {
  const container = document.getElementById('upgrade-plans-grid');
  if (!container) return;

  container.innerHTML = `
    <div class="col-span-full text-center py-12 text-slate-500">
      <i class="fa-solid fa-spinner fa-spin text-2xl mb-2 text-blue-600"></i>
      <p class="text-xs">Đang tải danh sách gói cước...</p>
    </div>
  `;

  try {
    const res = await fetch('/api/plans');
    const data = await res.json();

    if (data.success && data.plans) {
      container.innerHTML = '';
      data.plans.forEach((plan) => {
        const isCurrent = AuthState.subscription?.planId === plan.id;
        const card = document.createElement('div');
        const isPro = plan.id === 'pro';

        card.className = `rounded-2xl p-5 flex flex-col justify-between transition-all ${
          isPro
            ? 'bg-blue-600 text-white shadow-lg border-2 border-blue-400 relative'
            : 'bg-white border border-slate-200 text-slate-900 shadow-xs'
        }`;

        let featuresHtml = '';
        plan.features.forEach((f) => {
          featuresHtml += `
            <li class="flex items-center gap-2 text-xs">
              <i class="fa-solid fa-check ${isPro ? 'text-amber-300' : 'text-green-500'}"></i>
              <span>${f}</span>
            </li>
          `;
        });

        let buttonHtml = '';
        if (isCurrent) {
          buttonHtml = `
            <button disabled class="w-full py-2.5 text-xs font-bold rounded-xl bg-slate-200/50 text-slate-500 cursor-not-allowed">
              Gói hiện tại của bạn
            </button>
          `;
        } else if (plan.priceVnd === 0) {
          buttonHtml = `
            <button disabled class="w-full py-2.5 text-xs font-bold rounded-xl bg-slate-200/50 text-slate-500">
              Gói mặc định
            </button>
          `;
        } else {
          buttonHtml = `
            <button onclick="startCheckout('${plan.id}')" class="w-full py-2.5 text-xs font-extrabold rounded-xl transition-all shadow-sm ${
            isPro
              ? 'bg-amber-400 text-blue-950 hover:bg-amber-300 hover:shadow-md'
              : 'bg-blue-600 text-white hover:bg-blue-700 hover:shadow-md'
          }">
              <i class="fa-solid fa-bolt mr-1"></i> Nâng cấp ${plan.name}
            </button>
          `;
        }

        card.innerHTML = `
          <div>
            ${isPro ? '<div class="absolute -top-3 right-4 bg-amber-400 text-blue-950 text-[10px] font-black px-2.5 py-0.5 rounded-full uppercase">Đề xuất</div>' : ''}
            <div class="flex items-center justify-between mb-2">
              <h4 class="font-extrabold text-base">${plan.name}</h4>
              <span class="text-[10px] font-bold px-2 py-0.5 rounded-full ${isPro ? 'bg-blue-500 text-white' : 'bg-slate-100 text-slate-600'}">
                ${plan.badge || 'Gói cước'}
              </span>
            </div>
            <div class="mb-4">
              <span class="text-2xl font-black">${plan.priceVnd.toLocaleString()}₫</span>
              <span class="text-xs ${isPro ? 'text-blue-100' : 'text-slate-500'}">/ ${plan.durationDays} ngày</span>
            </div>
            <ul class="space-y-2 mb-6">
              ${featuresHtml}
            </ul>
          </div>
          <div>
            ${buttonHtml}
          </div>
        `;

        container.appendChild(card);
      });
    }
  } catch (err) {
    container.innerHTML = `<p class="text-red-500 text-center py-6 text-xs">Không thể tải danh sách gói cước: ${err.message}</p>`;
  }
}

// Start Checkout flow -> Create order & show VietQR
async function startCheckout(planId) {
  closeUpgradeModal();

  const qrModal = document.getElementById('vietqr-modal');
  const qrImg = document.getElementById('qr-image');
  const qrAmount = document.getElementById('qr-amount');
  const qrCode = document.getElementById('qr-order-code');
  const qrBank = document.getElementById('qr-bank-info');
  const qrStatusText = document.getElementById('qr-status-text');

  if (!qrModal) return;

  qrStatusText.innerHTML = '<i class="fa-solid fa-spinner fa-spin text-blue-600"></i> Đang khởi tạo đơn hàng...';
  qrModal.classList.remove('hidden');
  qrModal.classList.add('flex');

  try {
    const res = await fetch('/api/plans/orders', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ planId }),
    });
    const data = await res.json();

    if (data.success && data.order) {
      const order = data.order;
      currentOrderCode = order.orderCode;

      if (qrImg) qrImg.src = order.qrUrl;
      if (qrAmount) qrAmount.textContent = `${order.amountVnd.toLocaleString()} VNĐ`;
      if (qrCode) qrCode.textContent = order.orderCode;
      if (qrBank) {
        qrBank.textContent = `${order.bankName} - STK: ${order.accountNumber} (${order.accountName})`;
      }

      qrStatusText.innerHTML = `
        <span class="inline-flex items-center gap-1.5 text-blue-600 font-semibold animate-pulse">
          <i class="fa-solid fa-satellite-dish"></i> Đang chờ chuyển khoản từ SePay...
        </span>
      `;

      // Start live polling every 3s
      startOrderPolling(order.orderCode);
    } else {
      if (window.Dialog && typeof window.Dialog.toast === 'function') {
        window.Dialog.toast(data.error || 'Không thể tạo đơn hàng.', 'error');
      }
      closeVietQRModal();
    }
  } catch (err) {
    if (window.Dialog && typeof window.Dialog.toast === 'function') {
      window.Dialog.toast('Lỗi kết nối: ' + err.message, 'error');
    }
    closeVietQRModal();
  }
}

function closeVietQRModal() {
  if (activeOrderPollingTimer) {
    clearInterval(activeOrderPollingTimer);
    activeOrderPollingTimer = null;
  }
  const qrModal = document.getElementById('vietqr-modal');
  if (qrModal) {
    qrModal.classList.add('hidden');
    qrModal.classList.remove('flex');
  }
}

// Live polling checking if order status changed to 'paid' via SePay Webhook
function startOrderPolling(orderCode) {
  if (activeOrderPollingTimer) {
    clearInterval(activeOrderPollingTimer);
  }

  let attempts = 0;
  activeOrderPollingTimer = setInterval(async () => {
    attempts++;
    // Timeout after 15 minutes (300 attempts)
    if (attempts > 300) {
      clearInterval(activeOrderPollingTimer);
      return;
    }

    try {
      const res = await fetch(`/api/plans/orders/${orderCode}/status`, {
        headers: getAuthHeaders(),
      });
      if (!res.ok) return;
      const data = await res.json();

      if (data.success && data.isPaid) {
        clearInterval(activeOrderPollingTimer);
        activeOrderPollingTimer = null;

        // Payment Success Celebration!
        const qrContent = document.getElementById('vietqr-content-box');
        const qrSuccess = document.getElementById('vietqr-success-box');
        if (qrContent && qrSuccess) {
          qrContent.classList.add('hidden');
          qrSuccess.classList.remove('hidden');
        }

        // Refresh user profile & quota
        await initAuth();
        if (window.Dialog && typeof window.Dialog.toast === 'function') {
          window.Dialog.toast('Thanh toán thành công! Gói cước đã được kích hoạt.', 'success');
        }
      }
    } catch (err) {
      console.warn('Lỗi polling đơn hàng:', err);
    }
  }, 3000);
}

// Helper: Copy text to clipboard
function copyToClipboard(text, btnElement) {
  navigator.clipboard.writeText(text).then(() => {
    const originalText = btnElement.innerHTML;
    btnElement.innerHTML = '<i class="fa-solid fa-check text-green-600"></i> Đã sao chép';
    setTimeout(() => {
      btnElement.innerHTML = originalText;
    }, 2000);
  });
}
