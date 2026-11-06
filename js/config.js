/**
 * =============================================================================
 * ShippingErrorManager - Client Configuration Loader & Validator (Production @7)
 * =============================================================================
 * Phase: PRODUCTION_PHASE_8 (OFFICIAL_RELEASE_PREPARATION)
 *
 * Endpoints:
 *   - Production GAS @7:
 *     https://script.google.com/macros/s/AKfycbxB4NPDiKOyBrUKHxTdfVsdOno6QWAVJgxNsfxintazmbN1RyKX6MYEcrGjUifa5dQQ/exec
 *   - Preproduction GAS @14 (Rollback target):
 *     https://script.google.com/macros/s/AKfycbz7jerRcD2M4QcSAMckPZgIZ0aLTxNrg8U__L1zxjINLe-h0voD4thwXSpRY8JaanAc/exec
 *
 * Official Cutover Procedure (Execute ONLY after final approval):
 *   1. In Production GAS editor, run `enableProductionPublicAccess()`
 *   2. Run `node scripts/prepare-gh-pages.js --env=production` (or copy this file to `src/client/js/config.js`)
 *   3. Run `node scripts/test-staged-assets.js`
 *   4. Run `node scripts/export-publish-repo.js` to copy `dist/gh-pages/` to `../ShippingErrorManager-pages`
 *   5. Commit and push `main` branch in `../ShippingErrorManager-pages` (`origin/main`)
 *
 * Rollback Procedure:
 *   - Immediate GAS Gate Shutdown: Run `suspendProductionPublicAccess()` or `enableProductionPrivilegedOnlyAccess()`
 *   - Client Rollback to Preproduction @14:
 *     1. Run `node scripts/prepare-gh-pages.js --env=preproduction` (or restore `src/client/js/config.js` from `config.preproduction.template.js`)
 *     2. Run `node scripts/export-publish-repo.js`
 *     3. Commit and push `main` branch in `../ShippingErrorManager-pages` (`origin/main`)
 * =============================================================================
 */

(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.ShippingConfig = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var GAS_EXEC_URL_PATTERN = /^https:\/\/script\.google\.com\/macros\/s\/[a-zA-Z0-9_-]+\/exec(?:\?.*)?$/;

  /**
   * Production Canonical GAS Web App Endpoint (Version 7)
   * Public Web App endpoint URL. Safe for client-side inclusion.
   */
  var PROD_GAS_ENDPOINT = [
    'https://script.google.com/macros/s/',
    'AKfycbxB4NPDiKOyBrUKHxTd',
    'fVsdOno6QWAVJgxNsfxintaz',
    'mbN1RyKX6MYEcrGjUifa5dQQ',
    '/exec'
  ].join('');

  /**
   * Validates whether a given string is a well-formed GAS Web App /exec URL.
   *
   * @param {*} url
   * @return {boolean}
   */
  function isValidGasEndpointUrl(url) {
    if (!url || typeof url !== 'string') {
      return false;
    }
    var trimmed = url.trim();
    return GAS_EXEC_URL_PATTERN.test(trimmed);
  }

  /**
   * Initializes or normalizes the global __SHIPPING_CONFIG__ object.
   *
   * @param {Object} [overrides]
   * @return {Object}
   */
  function initConfig(overrides) {
    var existing = (typeof window !== 'undefined' && window.__SHIPPING_CONFIG__) ? window.__SHIPPING_CONFIG__ : {};
    var opts = overrides || {};

    var resolvedEndpoint = '';
    if (typeof opts.gasEndpointUrl === 'string') {
      resolvedEndpoint = opts.gasEndpointUrl;
    } else if (typeof existing.gasEndpointUrl === 'string' && existing.gasEndpointUrl.trim().length > 0) {
      resolvedEndpoint = existing.gasEndpointUrl;
    } else if (typeof window !== 'undefined') {
      resolvedEndpoint = PROD_GAS_ENDPOINT;
    }

    var config = {
      gasEndpointUrl: resolvedEndpoint.trim(),
      allowMock: (opts.allowMock === true) || (existing.allowMock === true),
      environment: opts.environment || existing.environment || 'production'
    };

    if (typeof window !== 'undefined') {
      window.__SHIPPING_CONFIG__ = config;
    }
    return config;
  }

  /**
   * Resolves the configured GAS endpoint URL, or empty string if not configured.
   *
   * @return {string}
   */
  function getGasEndpointUrl() {
    var cfg = (typeof window !== 'undefined' && window.__SHIPPING_CONFIG__) ? window.__SHIPPING_CONFIG__ : null;
    if (cfg && typeof cfg.gasEndpointUrl === 'string' && cfg.gasEndpointUrl.trim().length > 0) {
      return cfg.gasEndpointUrl.trim();
    }
    return '';
  }

  /**
   * Checks if valid GAS endpoint URL is configured.
   *
   * @return {boolean}
   */
  function isConfigured() {
    var url = getGasEndpointUrl();
    return isValidGasEndpointUrl(url);
  }

  // Auto-initialize if running in browser
  if (typeof window !== 'undefined') {
    initConfig();
  }

  return {
    isValidGasEndpointUrl: isValidGasEndpointUrl,
    initConfig: initConfig,
    getGasEndpointUrl: getGasEndpointUrl,
    isConfigured: isConfigured
  };
});
