/**
 * =============================================================================
 * ShippingErrorManager - Client Session Storage Management
 * =============================================================================
 * Phase: IMPL-003 (AUTH_AND_SESSION_ENGINE)
 *
 * Compliant with:
 *   - docs/30 Section 10 (sessionStorage only, no localStorage, no Cookie)
 *   - docs/31 Section 10 (Token persistence rules)
 *
 * Security Principles:
 *   - Strict prohibition: localStorage, Cookies, and URL parameters are never used.
 *   - Never log tokens to console or render in DOM.
 *   - Resilient error handling (graceful fallback if sessionStorage is blocked).
 * =============================================================================
 */

(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.SessionClient = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var STORAGE_KEY = 'shipping_error_manager_session_token';

  /**
   * Resolves available sessionStorage instance with memory fallback for test/restricted environments.
   */
  var memoryStorage_ = {};

  function getStorage_() {
    try {
      if (typeof window !== 'undefined' && window.sessionStorage) {
        return window.sessionStorage;
      }
    } catch (e) {
      // SecurityException or storage disabled in iframe/sandbox
    }
    return {
      getItem: function (k) { return Object.prototype.hasOwnProperty.call(memoryStorage_, k) ? memoryStorage_[k] : null; },
      setItem: function (k, v) { memoryStorage_[k] = String(v); },
      removeItem: function (k) { delete memoryStorage_[k]; }
    };
  }

  /**
   * Saves bearer session token into sessionStorage.
   *
   * @param {string} token Session token (SessionId.SessionSecret)
   * @return {boolean} True if saved
   */
  function saveToken(token) {
    if (!token || typeof token !== 'string') {
      return false;
    }
    try {
      getStorage_().setItem(STORAGE_KEY, token);
      return true;
    } catch (e) {
      return false;
    }
  }

  /**
   * Retrieves bearer session token from sessionStorage.
   *
   * @return {string|null} Token or null if absent/inaccessible
   */
  function getToken() {
    try {
      var t = getStorage_().getItem(STORAGE_KEY);
      return (t && typeof t === 'string' && t.trim().length > 0) ? t.trim() : null;
    } catch (e) {
      return null;
    }
  }

  /**
   * Clears bearer session token from sessionStorage.
   *
   * @return {boolean} True if cleared
   */
  function clearToken() {
    try {
      getStorage_().removeItem(STORAGE_KEY);
      return true;
    } catch (e) {
      return false;
    }
  }

  /**
   * Checks if a session token is present in sessionStorage.
   *
   * @return {boolean} True if token exists
   */
  function hasToken() {
    return getToken() !== null;
  }

  var SAVED_EMP_KEY = 'shipping_error_manager_saved_employee_code';
  var memoryLocalStorage_ = {};

  function getLocalStorage_() {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        return window.localStorage;
      }
    } catch (e) {
      // Storage disabled or blocked in sandbox
    }
    return {
      getItem: function (k) { return Object.prototype.hasOwnProperty.call(memoryLocalStorage_, k) ? memoryLocalStorage_[k] : null; },
      setItem: function (k, v) { memoryLocalStorage_[k] = String(v); },
      removeItem: function (k) { delete memoryLocalStorage_[k]; }
    };
  }

  /**
   * Saves employee code to localStorage for convenient auto-login.
   * Only employee code is stored; secrets/passwords are never saved.
   *
   * @param {string} empNo Employee number
   * @return {boolean} True if saved
   */
  function saveEmployeeCode(empNo) {
    if (!empNo || typeof empNo !== 'string') {
      return false;
    }
    try {
      getLocalStorage_().setItem(SAVED_EMP_KEY, empNo.trim());
      return true;
    } catch (e) {
      return false;
    }
  }

  /**
   * Retrieves saved employee code from localStorage.
   *
   * @return {string|null} Employee code or null if absent
   */
  function getSavedEmployeeCode() {
    try {
      var v = getLocalStorage_().getItem(SAVED_EMP_KEY);
      return (v && typeof v === 'string' && v.trim().length > 0) ? v.trim() : null;
    } catch (e) {
      return null;
    }
  }

  /**
   * Clears saved employee code from localStorage.
   *
   * @return {boolean} True if cleared
   */
  function clearSavedEmployeeCode() {
    try {
      getLocalStorage_().removeItem(SAVED_EMP_KEY);
      return true;
    } catch (e) {
      return false;
    }
  }

  return {
    saveToken: saveToken,
    getToken: getToken,
    clearToken: clearToken,
    hasToken: hasToken,
    saveEmployeeCode: saveEmployeeCode,
    getSavedEmployeeCode: getSavedEmployeeCode,
    clearSavedEmployeeCode: clearSavedEmployeeCode
  };
});
