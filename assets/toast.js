// Toast notification system
class Toast {
  static init() {
    if (document.getElementById('toast-container')) return;
    const container = document.createElement('div');
    container.id = 'toast-container';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }

  static show(message, type = 'info', duration = 4000, title = '') {
    Toast.init();
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    const iconMap = {
      success: '✓',
      error: '✕',
      info: 'ℹ',
      warning: '⚠'
    };

    toast.innerHTML = `
      <div class="toast-icon">${iconMap[type] || iconMap.info}</div>
      <div class="toast-content">
        ${title ? `<div class="toast-title">${Toast.escapeHtml(title)}</div>` : ''}
        <div class="toast-message">${Toast.escapeHtml(message)}</div>
      </div>
      <button class="toast-close" aria-label="Close notification">×</button>
    `;

    const closeBtn = toast.querySelector('.toast-close');
    closeBtn.addEventListener('click', () => Toast.remove(toast));

    container.appendChild(toast);

    if (duration > 0) {
      setTimeout(() => Toast.remove(toast), duration);
    }

    return toast;
  }

  static success(message, title = 'Success', duration = 3000) {
    return Toast.show(message, 'success', duration, title);
  }

  static error(message, title = 'Error', duration = 5000) {
    return Toast.show(message, 'error', duration, title);
  }

  static info(message, title = 'Info', duration = 3000) {
    return Toast.show(message, 'info', duration, title);
  }

  static warning(message, title = 'Warning', duration = 4000) {
    return Toast.show(message, 'warning', duration, title);
  }

  static remove(toast) {
    toast.classList.add('exiting');
    setTimeout(() => {
      if (toast.parentNode) {
        toast.remove();
      }
    }, 300);
  }

  static escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

// Initialize toast container on page load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => Toast.init());
} else {
  Toast.init();
}
