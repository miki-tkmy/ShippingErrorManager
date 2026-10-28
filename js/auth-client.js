/**
 * =============================================================================
 * ShippingErrorManager - Client Authentication Controller
 * =============================================================================
 * Phase: IMPL-003 (AUTH_AND_SESSION_ENGINE)
 *
 * Compliant with:
 *   - docs/30 Section 6, 10 (Client PBKDF2 & Session Management)
 *   - docs/32 Section 2 (Option A Auth Protocol: WebCrypto deriveBits)
 *
 * Security Principles:
 *   - Password-equivalent ClientSecret is held in memory only as long as practical.
 *   - Never stores ClientSecret or RawPassword in storage or logs.
 *   - Session token stored exclusively in sessionStorage.
 * =============================================================================
 */

(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(
      require('./password-kdf'),
      require('./session-client')
    );
  } else {
    root.AuthClient = factory(
      root.PasswordKdf,
      root.SessionClient
    );
  }
})(typeof self !== 'undefined' ? self : this, function (PasswordKdf, SessionClient) {
  'use strict';

  /**
   * Factory function to create an AuthClient instance.
   *
   * @param {Object} rpcClient Initialized ShippingRpcClient instance
   * @param {Object} [deps] Injected dependencies for testing
   * @return {Object} AuthClient API
   */
  function createAuthClient(rpcClient, deps) {
    if (!rpcClient || typeof rpcClient.call !== 'function') {
      throw new Error('rpcClient with a call() method is required.');
    }
    deps = deps || {};
    var kdf = deps.passwordKdf || (typeof PasswordKdf !== 'undefined' ? PasswordKdf : null);
    var sess = deps.sessionClient || (typeof SessionClient !== 'undefined' ? SessionClient : null);

    if (!kdf) {
      throw new Error('PasswordKdf component is required.');
    }
    if (!sess) {
      throw new Error('SessionClient component is required.');
    }

    function _unwrapPayload(res) {
      if (!res || typeof res !== 'object') return res;
      return (res.payload !== undefined && res.payload !== null) ? res.payload : res;
    }

    var _kdfCache = new Map(); // empNo -> { params, timestamp }

    /**
     * Retrieves KDF parameters for pre-authentication PBKDF2 calculation.
     * Caches salt and iterations in memory for 10 minutes to avoid redundant RPC round-trips.
     *
     * @param {string} empNo Employee number
     * @return {Promise<Object>} { salt, iterations, kdfVersion }
     */
    function getKdfParams(empNo) {
      var cleanEmpNo = String(empNo || '').trim();
      var cached = _kdfCache.get(cleanEmpNo);
      if (cached && (Date.now() - cached.timestamp < 600000)) {
        return Promise.resolve(cached.params);
      }

      return rpcClient.call('auth.getKdfParams', { empNo: cleanEmpNo })
        .then(function (res) {
          var p = _unwrapPayload(res);
          if (p && p.salt) {
            _kdfCache.set(cleanEmpNo, { params: p, timestamp: Date.now() });
          }
          return p;
        });
    }

    /**
     * Executes client-side PBKDF2 and authenticates with server.
     *
     * @param {string} empNo Employee number
     * @param {string} rawPassword Raw plaintext password
     * @return {Promise<Object>} { token, mustChangePassword, empNo }
     */
    function login(empNo, rawPassword) {
      if (!empNo || typeof empNo !== 'string') {
        return Promise.reject(new Error('??????????????'));
      }
      if (!rawPassword || typeof rawPassword !== 'string') {
        return Promise.reject(new Error('???????????????'));
      }

      var cleanEmpNo = empNo.trim();
      var normalizedPassword = (typeof rawPassword.normalize === 'function')
        ? rawPassword.normalize('NFC')
        : rawPassword;
      var sessionSecret = kdf.generateRandomSessionSecret();

      return getKdfParams(cleanEmpNo)
        .then(function (params) {
          var p = _unwrapPayload(params);
          return kdf.deriveClientSecret(normalizedPassword, p.salt, p.iterations);
        })
        .then(function (clientSecret) {
          return rpcClient.call('auth.login', {
            empNo: cleanEmpNo,
            clientSecret: clientSecret,
            sessionSecret: sessionSecret
          });
        })
        .then(function (loginResponse) {
          var data = _unwrapPayload(loginResponse);
          // Immediately save token to sessionStorage and verify storage success
          if (data && data.token) {
            var saved = sess.saveToken(data.token);
            if (!saved) {
              // Best-effort cleanup of issued server session
              rpcClient.call('auth.logout', { sessionToken: data.token }).catch(function () {});
              throw new Error('??????????????????????');
            }
          }
          return data;
        });
    }

    /**
     * Executes lightweight employee login with employee code alone (no password).
     * Issues capped FieldChecker session and stores saved employee code for auto-login.
     *
     * @param {string} empNo Employee number
     * @return {Promise<Object>} { token, context, isSimpleSession }
     */
    function simpleLogin(empNo) {
      if (!empNo || typeof empNo !== 'string') {
        return Promise.reject(new Error('社員番号を入力してください。'));
      }
      var cleanEmpNo = empNo.trim();
      if (!cleanEmpNo) {
        return Promise.reject(new Error('社員番号を入力してください。'));
      }

      return rpcClient.call('auth.simpleLogin', { empNo: cleanEmpNo })
        .then(function (res) {
          var data = _unwrapPayload(res);
          if (data && data.token) {
            var saved = sess.saveToken(data.token);
            if (!saved) {
              rpcClient.call('auth.logout', { sessionToken: data.token }).catch(function () {});
              throw new Error('セッショントークンの保存に失敗しました。');
            }
          }
          if (typeof sess.saveEmployeeCode === 'function') {
            sess.saveEmployeeCode(cleanEmpNo);
          }
          return data;
        });
    }

    /**
     * Retrieves sanitized authorization access context for active session.
     *
     * @param {string} [token] Optional explicit token, defaults to sessionStorage
     * @return {Promise<Object>} { empNo, empName, baseId, baseName, areaId, areaName, roles, permissions, capabilities, ... }
     */
    function getAccessContext(token) {
      var activeToken = token || sess.getToken();
      if (!activeToken) {
        return Promise.reject(new Error('AUTHENTICATION_REQUIRED'));
      }
      return rpcClient.call('authz.getAccessContext', { sessionToken: activeToken })
        .then(function (res) {
          return _unwrapPayload(res);
        });
    }

    /**
     * Validates active session token with server.
     *
     * @param {string} [token] Optional explicit token, defaults to sessionStorage
     * @return {Promise<Object>} { valid, empNo, sessionId, mustChangePassword }
     */
    function validateSession(token) {
      var activeToken = token || sess.getToken();
      if (!activeToken) {
        return Promise.resolve({ valid: false, reason: 'NO_TOKEN' });
      }
      return rpcClient.call('auth.validateSession', { sessionToken: activeToken })
        .then(function (res) {
          return _unwrapPayload(res);
        });
    }

    /**
     * Changes user password, enforces policy, updates credentials,
     * and clears local session (server revokes all active sessions).
     *
     * @param {string} newRawPassword New password
     * @return {Promise<Object>} { success: true, mustReLogin: true }
     */
    function changePassword(newRawPassword) {
      var activeToken = sess.getToken();
      if (!activeToken) {
        return Promise.reject(new Error('???????????????????????????????'));
      }

      // Pre-validate password length on client
      try {
        kdf.validatePasswordLength(newRawPassword);
      } catch (err) {
        return Promise.reject(err);
      }

      var newSalt = kdf.generateRandomSalt();

      return kdf.deriveClientSecret(newRawPassword, newSalt, 600000)
        .then(function (newClientSecret) {
          return rpcClient.call('auth.changePassword', {
            sessionToken: activeToken,
            newRawPassword: newRawPassword,
            newSalt: newSalt,
            newClientSecret: newClientSecret
          });
        })
        .then(function (res) {
          // Clear local session storage as password change revokes sessions
          sess.clearToken();
          return _unwrapPayload(res);
        });
    }

    /**
     * Logs out user, invalidates session on server, and removes local token.
     *
     * @return {Promise<Object>} { success: true }
     */
    function logout() {
      var activeToken = sess.getToken();
      if (!activeToken) {
        sess.clearToken();
        return Promise.resolve({ success: true });
      }
      return rpcClient.call('auth.logout', { sessionToken: activeToken })
        .then(function (res) {
          sess.clearToken();
          return _unwrapPayload(res);
        });
    }

    return {
      getKdfParams: getKdfParams,
      login: login,
      simpleLogin: simpleLogin,
      getAccessContext: getAccessContext,
      validateSession: validateSession,
      changePassword: changePassword,
      logout: logout,
      getToken: sess.getToken,
      hasToken: sess.hasToken,
      saveEmployeeCode: sess.saveEmployeeCode,
      getSavedEmployeeCode: sess.getSavedEmployeeCode,
      clearSavedEmployeeCode: sess.clearSavedEmployeeCode
    };
  }

  return {
    createAuthClient: createAuthClient
  };
});
