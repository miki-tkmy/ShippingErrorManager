/**
 * =============================================================================
 * ShippingErrorManager - Client Password KDF & Cryptographic Utility
 * =============================================================================
 * Phase: IMPL-003 (AUTH_AND_SESSION_ENGINE)
 *
 * Compliant with:
 *   - docs/30 Section 6 (PBKDF2-HMAC-SHA256, 600k iterations, 16B salt, 32B key)
 *   - docs/32 Section 2 (Browser WebCrypto API boundary: subtle.deriveBits)
 *
 * Security Principles:
 *   - WebCrypto API (window.crypto.subtle) execution on client.
 *   - NFC normalization without silent trimming.
 *   - CSPRNG random generation via crypto.getRandomValues().
 * =============================================================================
 */

(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.PasswordKdf = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DEFAULT_ITERATIONS = 600000;
  var DEFAULT_SALT_BYTES = 16;
  var DEFAULT_DERIVED_BYTES = 32;

  /**
   * Resolves WebCrypto implementation (Browser window.crypto or Node.js webcrypto).
   */
  function getWebCrypto_() {
    if (typeof window !== 'undefined' && window.crypto && window.crypto.subtle) {
      return window.crypto;
    }
    if (typeof self !== 'undefined' && self.crypto && self.crypto.subtle) {
      return self.crypto;
    }
    if (typeof crypto !== 'undefined' && crypto.subtle) {
      return crypto;
    }
    // Node.js 16+ support
    if (typeof require === 'function') {
      try {
        var nc = require('crypto');
        if (nc.webcrypto && nc.webcrypto.subtle) {
          return nc.webcrypto;
        }
      } catch (e) {
        // Ignore
      }
    }
    throw new Error('WebCrypto API (crypto.subtle) is not supported in this environment.');
  }

  /**
   * Normalizes password string to Unicode NFC.
   * Silent trim is PROHIBITED.
   *
   * @param {string} rawPassword Raw password
   * @return {string} NFC normalized password
   */
  function normalizePassword(rawPassword) {
    if (typeof rawPassword !== 'string') {
      throw new Error('password must be a string.');
    }
    if (typeof rawPassword.normalize === 'function') {
      return rawPassword.normalize('NFC');
    }
    return rawPassword;
  }

  /**
   * Validates password code point length (15 to 128 characters).
   *
   * @param {string} password Raw or normalized password
   * @return {string} Normalized password if valid
   */
  function validatePasswordLength(password) {
    var normalized = normalizePassword(password);
    var codePoints = Array.from ? Array.from(normalized) : normalized.split('');
    var len = codePoints.length;
    if (len < 15) {
      var errMin = new Error('パスワードは15文字以上である必要があります。');
      errMin.code = 'PASSWORD_TOO_SHORT';
      throw errMin;
    }
    if (len > 128) {
      var errMax = new Error('パスワードは128文字以下である必要があります。');
      errMax.code = 'PASSWORD_TOO_LONG';
      throw errMax;
    }
    return normalized;
  }

  /**
   * Converts Uint8Array or Array to Base64 string.
   */
  function bytesToBase64(bytes) {
    if (typeof Buffer !== 'undefined') {
      return Buffer.from(bytes).toString('base64');
    }
    var binary = '';
    var len = bytes.length;
    for (var i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  /**
   * Converts Base64 to Base64URL string (RFC 4648).
   */
  function base64ToBase64Url(base64) {
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  /**
   * Converts Base64URL string to Uint8Array bytes.
   */
  function base64UrlToBytes(base64Url) {
    if (typeof base64Url !== 'string') {
      throw new Error('base64Url must be a string.');
    }
    var base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    while (base64.length % 4 !== 0) {
      base64 += '=';
    }
    if (typeof Buffer !== 'undefined') {
      return new Uint8Array(Buffer.from(base64, 'base64'));
    }
    var binary = atob(base64);
    var len = binary.length;
    var bytes = new Uint8Array(len);
    for (var i = 0; i < len; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  /**
   * Generates a 16-byte cryptographically secure random salt (Base64URL).
   *
   * @return {string} 16-byte Base64URL salt
   */
  function generateRandomSalt() {
    var webCrypto = getWebCrypto_();
    var u8 = new Uint8Array(DEFAULT_SALT_BYTES);
    webCrypto.getRandomValues(u8);
    return base64ToBase64Url(bytesToBase64(u8));
  }

  /**
   * Generates a 32-byte cryptographically secure random session secret (Base64URL).
   *
   * @return {string} 32-byte Base64URL session secret
   */
  function generateRandomSessionSecret() {
    var webCrypto = getWebCrypto_();
    var u8 = new Uint8Array(DEFAULT_DERIVED_BYTES);
    webCrypto.getRandomValues(u8);
    return base64ToBase64Url(bytesToBase64(u8));
  }

  /**
   * Derives ClientSecret via WebCrypto PBKDF2-HMAC-SHA256 (600,000 iterations).
   *
   * @param {string} rawPassword Raw or normalized password
   * @param {string} saltBase64Url Base64URL encoded salt
   * @param {number} [iterations] PBKDF2 iterations (defaults to 600,000)
   * @return {Promise<string>} Derived ClientSecret (32-byte Base64URL)
   */
  function deriveClientSecret(rawPassword, saltBase64Url, iterations) {
    var webCrypto = getWebCrypto_();
    var normalizedPw = normalizePassword(rawPassword);
    var iters = (typeof iterations === 'number' && iterations > 0) ? iterations : DEFAULT_ITERATIONS;
    var saltBytes = base64UrlToBytes(saltBase64Url);

    var enc = new TextEncoder();
    var passwordBytes = enc.encode(normalizedPw);

    return webCrypto.subtle.importKey(
      'raw',
      passwordBytes,
      { name: 'PBKDF2' },
      false,
      ['deriveBits']
    ).then(function (keyMaterial) {
      return webCrypto.subtle.deriveBits(
        {
          name: 'PBKDF2',
          salt: saltBytes,
          iterations: iters,
          hash: 'SHA-256'
        },
        keyMaterial,
        DEFAULT_DERIVED_BYTES * 8 // 256 bits = 32 bytes
      );
    }).then(function (derivedBuffer) {
      var derivedBytes = new Uint8Array(derivedBuffer);
      return base64ToBase64Url(bytesToBase64(derivedBytes));
    });
  }

  return {
    normalizePassword: normalizePassword,
    validatePasswordLength: validatePasswordLength,
    generateRandomSalt: generateRandomSalt,
    generateRandomSessionSecret: generateRandomSessionSecret,
    deriveClientSecret: deriveClientSecret,
    base64ToBase64Url: base64ToBase64Url,
    base64UrlToBytes: base64UrlToBytes,
    bytesToBase64: bytesToBase64
  };
});
