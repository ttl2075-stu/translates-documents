/**
 * High-End Minimalist Dialog & Toast Component (Vanilla JS + Tailwind CSS)
 * Zero browser native alert/confirm/prompt. Accessible, smooth micro-motion, dark/light ready.
 */

class DialogManager {
  constructor() {
    this.container = null;
    this.toastContainer = null;
    this.init();
  }

  init() {
    if (typeof document === 'undefined') return;

    // Create Toast Container
    if (!document.getElementById('dialog-toast-container')) {
      this.toastContainer = document.createElement('div');
      this.toastContainer.id = 'dialog-toast-container';
      this.toastContainer.className = 'fixed top-4 right-4 z-[9999] flex flex-col gap-2.5 max-w-sm w-full pointer-events-none';
      document.body.appendChild(this.toastContainer);
    } else {
      this.toastContainer = document.getElementById('dialog-toast-container');
    }
  }

  /**
   * Toast notification
   * @param {string} message 
   * @param {'success'|'error'|'info'|'warning'} type 
   * @param {number} duration 
   */
  toast(message, type = 'info', duration = 3500) {
    this.init();
    if (!this.toastContainer) return;

    const toastEl = document.createElement('div');
    toastEl.className = 'pointer-events-auto flex items-start gap-3 p-3.5 rounded-xl shadow-lg border backdrop-blur-md transition-all duration-300 transform translate-x-12 opacity-0 text-xs font-medium';

    let iconHtml = '<i class="fa-solid fa-circle-info text-blue-500 text-sm mt-0.5"></i>';
    let typeClasses = 'bg-white/95 border-slate-200 text-slate-800 shadow-slate-900/5';

    if (type === 'success') {
      iconHtml = '<i class="fa-solid fa-circle-check text-emerald-600 text-sm mt-0.5"></i>';
      typeClasses = 'bg-white/95 border-emerald-200 text-slate-800 shadow-emerald-950/5';
    } else if (type === 'error') {
      iconHtml = '<i class="fa-solid fa-triangle-exclamation text-rose-600 text-sm mt-0.5"></i>';
      typeClasses = 'bg-white/95 border-rose-200 text-slate-800 shadow-rose-950/5';
    } else if (type === 'warning') {
      iconHtml = '<i class="fa-solid fa-circle-exclamation text-amber-500 text-sm mt-0.5"></i>';
      typeClasses = 'bg-white/95 border-amber-200 text-slate-800 shadow-amber-950/5';
    }

    toastEl.className += ` ${typeClasses}`;
    toastEl.innerHTML = `
      ${iconHtml}
      <div class="flex-1 leading-relaxed">${message}</div>
      <button type="button" class="text-slate-400 hover:text-slate-600 text-sm font-bold leading-none p-0.5">&times;</button>
    `;

    const closeBtn = toastEl.querySelector('button');
    const removeToast = () => {
      toastEl.classList.remove('translate-x-0', 'opacity-100');
      toastEl.classList.add('translate-x-12', 'opacity-0');
      setTimeout(() => toastEl.remove(), 300);
    };

    closeBtn.addEventListener('click', removeToast);
    this.toastContainer.appendChild(toastEl);

    // Animate in
    requestAnimationFrame(() => {
      toastEl.classList.remove('translate-x-12', 'opacity-0');
      toastEl.classList.add('translate-x-0', 'opacity-100');
    });

    // Auto remove
    setTimeout(removeToast, duration);
  }

  /**
   * Alert Dialog (Replaces native window.alert)
   */
  alert(title, message, type = 'info') {
    return new Promise((resolve) => {
      const modal = document.createElement('div');
      modal.className = 'fixed inset-0 z-[9990] bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 transition-opacity duration-200 opacity-0';

      let iconHtml = '<div class="w-10 h-10 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center text-lg"><i class="fa-solid fa-circle-info"></i></div>';
      if (type === 'success') {
        iconHtml = '<div class="w-10 h-10 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center text-lg"><i class="fa-solid fa-circle-check"></i></div>';
      } else if (type === 'error') {
        iconHtml = '<div class="w-10 h-10 rounded-full bg-rose-50 text-rose-600 flex items-center justify-center text-lg"><i class="fa-solid fa-triangle-exclamation"></i></div>';
      } else if (type === 'warning') {
        iconHtml = '<div class="w-10 h-10 rounded-full bg-amber-50 text-amber-600 flex items-center justify-center text-lg"><i class="fa-solid fa-circle-exclamation"></i></div>';
      }

      modal.innerHTML = `
        <div class="bg-white border border-slate-200 rounded-2xl shadow-2xl max-w-sm w-full p-5 transform transition-all duration-200 scale-95 opacity-0 text-slate-800">
          <div class="flex items-center gap-3.5 mb-3">
            ${iconHtml}
            <div>
              <h3 class="font-bold text-sm text-slate-900">${title || 'Thông báo'}</h3>
            </div>
          </div>
          <p class="text-xs text-slate-600 leading-relaxed mb-5">${message}</p>
          <div class="flex justify-end">
            <button type="button" id="dialog-btn-ok" class="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white font-semibold text-xs rounded-lg transition-all shadow-xs">
              Đồng ý
            </button>
          </div>
        </div>
      `;

      document.body.appendChild(modal);
      const card = modal.querySelector('div');
      const okBtn = modal.querySelector('#dialog-btn-ok');

      requestAnimationFrame(() => {
        modal.classList.remove('opacity-0');
        modal.classList.add('opacity-100');
        card.classList.remove('scale-95', 'opacity-0');
        card.classList.add('scale-100', 'opacity-100');
        okBtn.focus();
      });

      const close = () => {
        modal.classList.remove('opacity-100');
        modal.classList.add('opacity-0');
        card.classList.remove('scale-100', 'opacity-100');
        card.classList.add('scale-95', 'opacity-0');
        setTimeout(() => {
          modal.remove();
          resolve();
        }, 200);
      };

      okBtn.addEventListener('click', close);
      modal.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' || e.key === 'Enter') close();
      });
    });
  }

  /**
   * Confirm Dialog (Replaces native window.confirm)
   * @param {{ title?: string, message: string, confirmText?: string, cancelText?: string, isDestructive?: boolean }} options 
   * @returns {Promise<boolean>}
   */
  confirm(options) {
    const opts = typeof options === 'string' ? { message: options } : (options || {});
    const {
      title = 'Xác nhận thao tác',
      message = 'Bạn có chắc chắn muốn thực hiện thao tác này?',
      confirmText = 'Xác nhận',
      cancelText = 'Hủy bỏ',
      isDestructive = false,
    } = opts;

    return new Promise((resolve) => {
      const modal = document.createElement('div');
      modal.className = 'fixed inset-0 z-[9990] bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 transition-opacity duration-200 opacity-0';

      const iconClass = isDestructive ? 'bg-rose-50 text-rose-600' : 'bg-blue-50 text-blue-600';
      const iconSymbol = isDestructive ? 'fa-triangle-exclamation' : 'fa-circle-question';
      const confirmBtnClass = isDestructive
        ? 'bg-rose-600 hover:bg-rose-700 text-white'
        : 'bg-blue-600 hover:bg-blue-700 text-white';

      modal.innerHTML = `
        <div class="bg-white border border-slate-200 rounded-2xl shadow-2xl max-w-sm w-full p-5 transform transition-all duration-200 scale-95 opacity-0 text-slate-800">
          <div class="flex items-center gap-3.5 mb-3">
            <div class="w-10 h-10 rounded-full ${iconClass} flex items-center justify-center text-lg">
              <i class="fa-solid ${iconSymbol}"></i>
            </div>
            <div>
              <h3 class="font-bold text-sm text-slate-900">${title}</h3>
            </div>
          </div>
          <p class="text-xs text-slate-600 leading-relaxed mb-5">${message}</p>
          <div class="flex justify-end gap-2.5">
            <button type="button" id="dialog-btn-cancel" class="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs rounded-lg transition-all">
              ${cancelText}
            </button>
            <button type="button" id="dialog-btn-confirm" class="px-4 py-2 ${confirmBtnClass} font-semibold text-xs rounded-lg transition-all shadow-xs">
              ${confirmText}
            </button>
          </div>
        </div>
      `;

      document.body.appendChild(modal);
      const card = modal.querySelector('div');
      const cancelBtn = modal.querySelector('#dialog-btn-cancel');
      const confirmBtn = modal.querySelector('#dialog-btn-confirm');

      requestAnimationFrame(() => {
        modal.classList.remove('opacity-0');
        modal.classList.add('opacity-100');
        card.classList.remove('scale-95', 'opacity-0');
        card.classList.add('scale-100', 'opacity-100');
        confirmBtn.focus();
      });

      const cleanup = (result) => {
        modal.classList.remove('opacity-100');
        modal.classList.add('opacity-0');
        card.classList.remove('scale-100', 'opacity-100');
        card.classList.add('scale-95', 'opacity-0');
        setTimeout(() => {
          modal.remove();
          resolve(result);
        }, 200);
      };

      cancelBtn.addEventListener('click', () => cleanup(false));
      confirmBtn.addEventListener('click', () => cleanup(true));
      modal.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') cleanup(false);
      });
    });
  }

  /**
   * Prompt Dialog (Replaces native window.prompt)
   * @param {{ title?: string, message: string, defaultValue?: string, placeholder?: string, confirmText?: string, cancelText?: string }} options 
   * @returns {Promise<string | null>}
   */
  prompt(options) {
    const opts = typeof options === 'string' ? { message: options } : (options || {});
    const {
      title = 'Nhập thông tin',
      message = 'Vui lòng nhập giá trị:',
      defaultValue = '',
      placeholder = '',
      confirmText = 'Đồng ý',
      cancelText = 'Hủy bỏ',
    } = opts;

    return new Promise((resolve) => {
      const modal = document.createElement('div');
      modal.className = 'fixed inset-0 z-[9990] bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 transition-opacity duration-200 opacity-0';

      modal.innerHTML = `
        <div class="bg-white border border-slate-200 rounded-2xl shadow-2xl max-w-sm w-full p-5 transform transition-all duration-200 scale-95 opacity-0 text-slate-800">
          <h3 class="font-bold text-sm text-slate-900 mb-1">${title}</h3>
          <p class="text-xs text-slate-600 mb-3">${message}</p>
          <div class="mb-4">
            <input type="text" id="dialog-prompt-input" value="${defaultValue}" placeholder="${placeholder}" class="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-hidden text-slate-800">
          </div>
          <div class="flex justify-end gap-2.5">
            <button type="button" id="dialog-btn-cancel" class="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs rounded-lg transition-all">
              ${cancelText}
            </button>
            <button type="button" id="dialog-btn-confirm" class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs rounded-lg transition-all shadow-xs">
              ${confirmText}
            </button>
          </div>
        </div>
      `;

      document.body.appendChild(modal);
      const card = modal.querySelector('div');
      const inputEl = modal.querySelector('#dialog-prompt-input');
      const cancelBtn = modal.querySelector('#dialog-btn-cancel');
      const confirmBtn = modal.querySelector('#dialog-btn-confirm');

      requestAnimationFrame(() => {
        modal.classList.remove('opacity-0');
        modal.classList.add('opacity-100');
        card.classList.remove('scale-95', 'opacity-0');
        card.classList.add('scale-100', 'opacity-100');
        inputEl.focus();
        inputEl.select();
      });

      const cleanup = (result) => {
        modal.classList.remove('opacity-100');
        modal.classList.add('opacity-0');
        card.classList.remove('scale-100', 'opacity-100');
        card.classList.add('scale-95', 'opacity-0');
        setTimeout(() => {
          modal.remove();
          resolve(result);
        }, 200);
      };

      cancelBtn.addEventListener('click', () => cleanup(null));
      confirmBtn.addEventListener('click', () => cleanup(inputEl.value));
      inputEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') cleanup(inputEl.value);
        if (e.key === 'Escape') cleanup(null);
      });
    });
  }
}

// Export singleton instance to global window
window.Dialog = new DialogManager();

// Standard alias for toast
window.showToast = (msg, type, duration) => window.Dialog.toast(msg, type, duration);
