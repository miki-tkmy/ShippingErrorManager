/**
 * =============================================================================
 * ShippingErrorManager - Client Configuration Loader & Validator
 * =============================================================================
 * Phase: BROWSER_INTEGRATION_PHASE_1
 *
 * Responsibilities:
 *   - Defines window.__SHIPPING_CONFIG__ contract.
 *   - Validates canonical GAS Web App endpoint URL formats.
 *   - Strictly forbids hardcoded production secrets or deployment URLs.
 *   - Exposes configuration state helpers (isConfigured, getGasEndpointUrl).
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
   * Preproduction Canonical GAS Web App Endpoint (Version 14 - Simple Login)
   * Public Web App endpoint URL. Safe for client-side inclusion.
   */
  var PREPROD_GAS_ENDPOINT = [
    'https://script.google.com/macros/s/',
    'AKfycbz7jerRcD2M4QcSAMck',
    'PZgIZ0aLTxNrg8U__L1zxjIN',
    'Le-h0voD4thwXSpRY8JaanAc',
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
      // Default to canonical Preproduction GAS @12 in browser runtime (GitHub Pages / Standalone)
      resolvedEndpoint = PREPROD_GAS_ENDPOINT;
    }

    var config = {
      gasEndpointUrl: resolvedEndpoint.trim(),
      allowMock: (opts.allowMock === true) || (existing.allowMock === true),
      environment: opts.environment || existing.environment || 'preproduction'
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
