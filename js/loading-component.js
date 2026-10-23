/**
 * =============================================================================
 * ShippingErrorManager - Common Loading UX Component
 * =============================================================================
 * Phase: FRONTEND-001 (GITHUB_PAGES_SECURE_FRONTEND_AND_MATERIAL_CODE_SEARCH)
 *
 * Provides:
 *   A. Page/top indeterminate progress bar
 *   B. Button spinner
 *   C. Blocking operation modal
 *
 * Invariants:
 *   - No fake progress percentages on indeterminate requests
 *   - Loading state is strictly cleared in finally blocks (no stuck "読込中" / disabled buttons)
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
    root.LoadingComponent = exports;
    root.loadingManager = exports.loadingManager;
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function LoadingManager() {
    this.progressBarEl = null;
    this.blockingLoaderEl = null;
    this.activeOperations = 0;
  }

  /**
   * Initializes or gets the top progress bar element.
   *
   * @return {HTMLElement|null}
   */
  LoadingManager.prototype._getProgressBar = function () {
    if (typeof document === 'undefined') return null;
    if (!this.progressBarEl) {
      this.progressBarEl = document.getElementById('globalProgressBar');
      if (!this.progressBarEl) {
        this.progressBarEl = document.createElement('div');
        this.progressBarEl.id = 'globalProgressBar';
        this.progressBarEl.className = 'progress-bar-indeterminate';
        this.progressBarEl.style.display = 'none';
        document.body.appendChild(this.progressBarEl);
      }
    }
    return this.progressBarEl;
  };

  /**
   * Shows top indeterminate progress bar.
   */
  LoadingManager.prototype.showProgressBar = function () {
    var bar = this._getProgressBar();
    if (bar) {
      bar.style.display = 'block';
    }
  };

  /**
   * Hides top indeterminate progress bar.
   */
  LoadingManager.prototype.hideProgressBar = function () {
    var bar = this._getProgressBar();
    if (bar) {
      bar.style.display = 'none';
    }
  };

  /**
   * Attaches or removes loading spinner on a button.
   *
   * @param {HTMLElement} btn Button element
   * @param {boolean} isLoading Loading state
   * @param {string} [loadingText] Optional text while loading
   */
  LoadingManager.prototype.setButtonLoading = function (btn, isLoading, loadingText) {
    if (!btn) return;
    if (isLoading) {
      if (!btn.dataset.originalHtml) {
        btn.dataset.originalHtml = btn.innerHTML;
      }
      btn.disabled = true;
      btn.setAttribute('aria-disabled', 'true');
      var text = loadingText || '処理中...';
      btn.innerHTML = '<span class="btn-spinner" aria-hidden="true"></span><span>' + text + '</span>';
    } else {
      btn.disabled = false;
      btn.removeAttribute('aria-disabled');
      if (btn.dataset.originalHtml) {
        btn.innerHTML = btn.dataset.originalHtml;
        delete btn.dataset.originalHtml;
      }
    }
  };

  /**
   * Shows blocking modal loader.
   *
   * @param {string} [message] Loading message text
   */
  LoadingManager.prototype.showBlockingLoader = function (message) {
    if (typeof document === 'undefined') return;
    this.activeOperations++;
    if (!this.blockingLoaderEl) {
      this.blockingLoaderEl = document.getElementById('globalBlockingLoader');
      if (!this.blockingLoaderEl) {
        this.blockingLoaderEl = document.createElement('div');
        this.blockingLoaderEl.id = 'globalBlockingLoader';
        this.blockingLoaderEl.className = 'blocking-loader-overlay';
        this.blockingLoaderEl.setAttribute('role', 'alertdialog');
        this.blockingLoaderEl.setAttribute('aria-modal', 'true');
        document.body.appendChild(this.blockingLoaderEl);
      }
    }
    var msg = message || '処理中...';
    this.blockingLoaderEl.innerHTML = [
      '<div class="blocking-loader-box">',
      '  <div class="blocking-spinner" aria-hidden="true"></div>',
      '  <div class="blocking-text" style="font-weight: 600; color: #1E293B;">' + msg + '</div>',
      '</div>'
    ].join('');
    this.blockingLoaderEl.style.display = 'flex';
  };

  /**
   * Hides blocking modal loader.
   */
  LoadingManager.prototype.hideBlockingLoader = function () {
    this.activeOperations = Math.max(0, this.activeOperations - 1);
    if (this.activeOperations === 0 && this.blockingLoaderEl) {
      this.blockingLoaderEl.style.display = 'none';
    }
  };

  /**
   * Forces clearing all loading indicators.
   */
  LoadingManager.prototype.clearAll = function () {
    this.activeOperations = 0;
    this.hideProgressBar();
    if (this.blockingLoaderEl) {
      this.blockingLoaderEl.style.display = 'none';
    }
  };

  /**
   * Wraps an asynchronous operation, automatically managing loading state in finally block.
   *
   * @param {Function} asyncFn Function returning a Promise
   * @param {Object} [options]
   * @param {HTMLElement} [options.button] Target button to set loading state on
   * @param {string} [options.buttonText] Text while button is loading
   * @param {boolean} [options.progressBar] Show top progress bar (default: true)
   * @param {boolean} [options.blocking] Show blocking modal (default: false)
   * @param {string} [options.blockingText] Message for blocking modal
   * @return {Promise<*>} Resolves with asyncFn result
   */
  LoadingManager.prototype.wrap = function (asyncFn, options) {
    var self = this;
    var opts = options || {};
    var showBar = opts.progressBar !== false;

    if (showBar) {
      self.showProgressBar();
    }
    if (opts.button) {
      self.setButtonLoading(opts.button, true, opts.buttonText);
    }
    if (opts.blocking) {
      self.showBlockingLoader(opts.blockingText);
    }

    return Promise.resolve()
      .then(function () {
        return asyncFn();
      })
      .finally(function () {
        // Strict invariant: Loading state is ALWAYS cleared
        if (showBar) {
          self.hideProgressBar();
        }
        if (opts.button) {
          self.setButtonLoading(opts.button, false);
        }
        if (opts.blocking) {
          self.hideBlockingLoader();
        }
      });
  };

  var defaultManager = new LoadingManager();

  return {
    LoadingManager: LoadingManager,
    loadingManager: defaultManager
  };
});
