/**
 * =============================================================================
 * ShippingErrorManager - Common Accessible Modal Manager
 * =============================================================================
 * Phase: FRONTEND-001 (GITHUB_PAGES_SECURE_FRONTEND_AND_MATERIAL_CODE_SEARCH)
 *
 * Rules:
 *   - Replaces window.alert() and window.confirm() across the entire application
 *   - Provides unified modal types: success, error, warning, confirm
 *   - Accessible: Keyboard navigation (Escape, Enter, Tab trapping), ARIA attributes
 *   - Responsive: Touch targets >= 44px for iPhone, centered dialog for PC
 * =============================================================================
 */

(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else {
    var exports = factory();
    root.ModalManager = exports;
    root.modalManager = exports.modalManager;
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function renderLucideSvg(name, options) {
    if (typeof getLucideIcon === 'function') {
      return getLucideIcon(name, options);
    }
    if (typeof LucideIcons !== 'undefined' && typeof LucideIcons.getLucideIcon === 'function') {
      return LucideIcons.getLucideIcon(name, options);
    }
    if (typeof require !== 'undefined') {
      try {
        var lib = require('./lucide-icons.js');
        return lib.getLucideIcon(name, options);
      } catch (e) {}
    }
    if (name === 'CircleCheck') {
      return '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/></svg>';
    }
    if (name === 'CircleX') {
      return '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/></svg>';
    }
    if (name === 'TriangleAlert') {
      return '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" x2="12" y1="9" y2="13"/><line x1="12" x2="12.01" y1="17" y2="17"/></svg>';
    }
    if (name === 'Info') {
      return '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>';
    }
    if (name === 'X') {
      return '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';
    }
    return '';
  }

  function ModalManager() {
    this.containerEl = null;
    this.activeResolve = null;
    this.keyHandler = null;
  }

  ModalManager.prototype._getContainer = function () {
    if (typeof document === 'undefined') return null;
    if (!this.containerEl) {
      this.containerEl = document.getElementById('globalModalContainer');
      if (!this.containerEl) {
        this.containerEl = document.createElement('div');
        this.containerEl.id = 'globalModalContainer';
        this.containerEl.className = 'modal-overlay';
        this.containerEl.style.display = 'none';
        this.containerEl.setAttribute('role', 'dialog');
        this.containerEl.setAttribute('aria-modal', 'true');
        document.body.appendChild(this.containerEl);
      }
    }
    return this.containerEl;
  };

  /**
   * Opens a modal dialog.
   *
   * @param {Object} options
   * @param {string} options.type 'success' | 'error' | 'warning' | 'confirm'
   * @param {string} options.title Modal title
   * @param {string} options.message Main body message
   * @param {string} [options.detail] Optional technical details (sanitized)
   * @param {string} [options.confirmText] Confirm button text
   * @param {string} [options.cancelText] Cancel button text
   * @return {Promise<boolean>} Resolves to true on confirm, false on cancel/dismiss
   */
  ModalManager.prototype.show = function (options) {
    var self = this;
    var container = self._getContainer();
    if (!container) return Promise.resolve(false);

    var opts = options || {};
    var type = opts.type || 'info';
    var title = opts.title || '';
    var message = opts.message || '';
    var detail = opts.detail || '';
    var confirmText = opts.confirmText || 'OK';
    var cancelText = opts.cancelText || 'キャンセル';
    var isConfirm = type === 'confirm';

    // Type badge/icon styling per Section 21
    var badgeClass = 'badge-ok';
    var iconSvg = renderLucideSvg('Info', { size: 22 });
    if (type === 'success') {
      badgeClass = 'badge-ok';
      iconSvg = renderLucideSvg('CircleCheck', { size: 22 });
    } else if (type === 'error') {
      badgeClass = 'badge-ng';
      iconSvg = renderLucideSvg('CircleX', { size: 22 });
    } else if (type === 'warning') {
      badgeClass = 'badge-pending';
      iconSvg = renderLucideSvg('TriangleAlert', { size: 22 });
    } else if (type === 'confirm') {
      badgeClass = 'badge-pending';
      iconSvg = renderLucideSvg('Info', { size: 22 });
    }

    return new Promise(function (resolve) {
      self.activeResolve = resolve;

      var html = [
        '<div class="modal-dialog-card">',
        '  <div class="modal-header-bar">',
        '    <div style="display: flex; align-items: center; gap: 8px;">',
        '      <span aria-hidden="true" style="display: flex; align-items: center;">' + iconSvg + '</span>',
        '      <h2 class="modal-title-text">' + escapeHtml(title) + '</h2>',
        '    </div>',
        '    <button type="button" class="modal-close-btn" id="modalBtnClose" aria-label="閉じる" style="display: flex; align-items: center; justify-content: center;">' + renderLucideSvg('X', { size: 20 }) + '</button>',
        '  </div>',
        '  <div class="modal-body-content">',
        '    <p style="margin: 0; white-space: pre-wrap;">' + escapeHtml(message) + '</p>',
        detail ? ('    <div class="form-hint" style="margin-top: 8px; font-family: monospace; font-size: 0.85rem; color: #DC2626;">' + escapeHtml(detail) + '</div>') : '',
        '  </div>',
        '  <div class="modal-footer-actions">',
        isConfirm ? ('    <button type="button" class="btn btn-secondary" id="modalBtnCancel">' + escapeHtml(cancelText) + '</button>') : '',
        '    <button type="button" class="btn btn-primary" id="modalBtnConfirm">' + escapeHtml(confirmText) + '</button>',
        '  </div>',
        '</div>'
      ].join('\n');

      container.innerHTML = html;
      container.style.display = 'flex';

      var btnConfirm = document.getElementById('modalBtnConfirm');
      var btnCancel = document.getElementById('modalBtnCancel');
      var btnClose = document.getElementById('modalBtnClose');

      function cleanup(result) {
        if (self.keyHandler) {
          window.removeEventListener('keydown', self.keyHandler);
          self.keyHandler = null;
        }
        container.style.display = 'none';
        container.innerHTML = '';
        if (self.activeResolve) {
          var r = self.activeResolve;
          self.activeResolve = null;
          r(result);
        }
      }

      if (btnConfirm) {
        btnConfirm.addEventListener('click', function () {
          cleanup(true);
        });
        btnConfirm.focus();
      }

      if (btnCancel) {
        btnCancel.addEventListener('click', function () {
          cleanup(false);
        });
      }

      if (btnClose) {
        btnClose.addEventListener('click', function () {
          cleanup(false);
        });
      }

      self.keyHandler = function (e) {
        if (e.key === 'Escape') {
          cleanup(false);
        } else if (e.key === 'Enter' && !isConfirm) {
          cleanup(true);
        }
      };
      window.addEventListener('keydown', self.keyHandler);
    });
  };

  ModalManager.prototype.success = function (title, message) {
    return this.show({ type: 'success', title: title, message: message });
  };

  ModalManager.prototype.error = function (title, message, errorObj) {
    var detail = '';
    if (errorObj) {
      if (errorObj.code) detail += 'エラーコード: ' + errorObj.code;
      if (errorObj.requestId) detail += ' (Request: ' + errorObj.requestId + ')';
    }
    return this.show({ type: 'error', title: title, message: message, detail: detail });
  };

  ModalManager.prototype.warning = function (title, message) {
    return this.show({ type: 'warning', title: title, message: message });
  };

  ModalManager.prototype.confirm = function (title, message, options) {
    var opts = options || {};
    return this.show({
      type: 'confirm',
      title: title,
      message: message,
      confirmText: opts.confirmText || '確定',
      cancelText: opts.cancelText || 'キャンセル'
    });
  };

  var defaultManager = new ModalManager();

  return {
    ModalManager: ModalManager,
    modalManager: defaultManager
  };
});
