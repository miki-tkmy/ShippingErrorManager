/**
 * =============================================================================
 * ShippingErrorManager - Transport Adapter Foundation
 * =============================================================================
 * Phase: FRONTEND-001 (GITHUB_PAGES_SECURE_FRONTEND_AND_MATERIAL_CODE_SEARCH)
 *
 * Responsibilities:
 *   - Abstract transport layer separating UI/Domain clients from underlying network
 *   - HttpGasTransport: Direct fetch to GAS Web App endpoint (/exec) from GitHub Pages
 *   - Strict compliance with ScrapManagement proven production patterns:
 *       * POST-first with Content-Type: text/plain;charset=UTF-8 (avoids CORS preflight)
 *       * redirect: "follow" (handles 302 from script.google.com to script.googleusercontent.com)
 *       * cache: "no-store"
 *       * credentials: "omit"
 *       * Hard timeout: 15,000ms via AbortController + Promise.race
 *       * Cache buster: _cb=<timestamp>_<nonce>
 *   - MockTransport: In-memory simulation for deterministic tests and offline preview
 *   - GoogleScriptRunTransport: Backward compatibility adapter for GAS container runtime
 *   - Zero PII or session tokens leaked in URL, telemetry, or error messages
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
    root.TransportAdapters = exports;
    root.HttpGasTransport = exports.HttpGasTransport;
    root.MockTransport = exports.MockTransport;
    root.GoogleScriptRunTransport = exports.GoogleScriptRunTransport;
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DEFAULT_HARD_TIMEOUT_MS = 15000;
  var PROTOCOL_VERSION = '1.0';

  /**
   * Generates a non-sensitive cache-buster token.
   *
   * @return {string} Cache-busting query parameter value
   */
  function generateCacheBuster() {
    var ts = Date.now().toString(36);
    var rnd = Math.random().toString(36).substring(2, 8);
    return ts + '_' + rnd;
  }

  /**
   * Sanitizes an error object for client-safe exposure.
   * Excludes raw stacks, internal paths, and secrets.
   *
   * @param {*} rawError Raw caught error or error response
   * @param {string} [fallbackRequestId] Optional fallback request ID
   * @return {Object} Client-safe error object
   */
  function sanitizeClientError(rawError, fallbackRequestId) {
    var code = 'TRANSPORT_ERROR';
    var message = '通信エラーが発生しました。接続状況を確認の上、再試行してください。';
    var reqId = fallbackRequestId || null;

    if (rawError && typeof rawError === 'object') {
      if (rawError.name === 'AbortError' || rawError.code === 'CLIENT_TIMEOUT') {
        code = 'CLIENT_TIMEOUT';
        message = '通信がタイムアウトしました (15秒)。時間をおいて再試行してください。';
      } else if (rawError.code) {
        code = String(rawError.code);
        if (rawError.message && rawError.isSafeMessage) {
          message = String(rawError.message);
        } else if (rawError.message && (code === 'INVALID_REQUEST' || code === 'UNAUTHENTICATED' || code === 'PERMISSION_DENIED')) {
          message = String(rawError.message);
        }
      }
      if (rawError.requestId) {
        reqId = String(rawError.requestId);
      }
    }

    var err = new Error(message);
    err.name = 'TransportError';
    err.code = code;
    err.requestId = reqId;
    return err;
  }

  // ===========================================================================
  // 1. HttpGasTransport (Direct Fetch Adapter for GitHub Pages -> GAS /exec)
  // ===========================================================================

  /**
   * Constructor for HttpGasTransport.
   *
   * @param {Object} [options] Configuration options
   * @param {string} [options.endpointUrl] Target GAS /exec Web App URL
   * @param {number} [options.hardTimeoutMs] Hard timeout in milliseconds (default: 15,000)
   * @param {boolean} [options.enableDiagnostics] Enables non-sensitive diagnostic telemetry
   */
  function HttpGasTransport(options) {
    var opts = options || {};
    this.endpointUrl = opts.endpointUrl || '';
    this.hardTimeoutMs = typeof opts.hardTimeoutMs === 'number' ? opts.hardTimeoutMs : DEFAULT_HARD_TIMEOUT_MS;
    this.enableDiagnostics = Boolean(opts.enableDiagnostics);
    this.lastDiagnostics = null;
  }

  /**
   * Sends an RPC request envelope to the GAS Web App endpoint via direct HTTPS fetch.
   *
   * Contract:
   *   - Method: POST
   *   - Content-Type: text/plain;charset=UTF-8 (prevents CORS preflight failure on GAS)
   *   - redirect: "follow" (handles 302 redirect to script.googleusercontent.com)
   *   - cache: "no-store"
   *   - credentials: "omit"
   *   - Hard Timeout: 15,000ms with AbortController
   *
   * @param {Object} envelope Canonical RPC request envelope:
   *   { protocolVersion, action, requestId, sessionToken, payload }
   * @param {Object} [options] Call options
   * @return {Promise<Object>} Resolves to canonical RPC response envelope
   */
  HttpGasTransport.prototype.send = function (envelope, options) {
    var self = this;
    var callOpts = options || {};
    var timeoutMs = typeof callOpts.timeoutMs === 'number' ? callOpts.timeoutMs : self.hardTimeoutMs;
    var url = callOpts.endpointUrl || self.endpointUrl;

    if (!url || typeof url !== 'string' || url.trim().length === 0) {
      return Promise.reject(sanitizeClientError({
        code: 'ENDPOINT_NOT_CONFIGURED',
        message: 'GAS Web App endpoint URL is not configured.',
        isSafeMessage: true
      }, envelope ? envelope.requestId : null));
    }

    // Append non-sensitive cache buster
    var separator = url.indexOf('?') === -1 ? '?' : '&';
    var requestUrl = url + separator + '_cb=' + generateCacheBuster();

    var controller = null;
    var signal = null;
    if (typeof AbortController !== 'undefined') {
      controller = new AbortController();
      signal = controller.signal;
    }

    var startTime = Date.now();
    var timerId = null;

    var cleanEnvelope = {
      protocolVersion: envelope && envelope.protocolVersion ? envelope.protocolVersion : PROTOCOL_VERSION,
      action: envelope && envelope.action ? String(envelope.action).trim() : '',
      requestId: envelope && envelope.requestId ? String(envelope.requestId) : ('req-' + Date.now()),
      sessionToken: envelope && envelope.sessionToken ? String(envelope.sessionToken).trim() : undefined,
      payload: (envelope && envelope.payload && typeof envelope.payload === 'object') ? envelope.payload : {}
    };

    var fetchPromise = new Promise(function (resolve, reject) {
      if (timeoutMs > 0 && controller) {
        timerId = setTimeout(function () {
          try {
            controller.abort();
          } catch (e) {
            // Ignore abort error
          }
          reject(sanitizeClientError({
            name: 'AbortError',
            code: 'CLIENT_TIMEOUT',
            requestId: cleanEnvelope.requestId
          }, cleanEnvelope.requestId));
        }, timeoutMs);
      }

      var fetchOptions = {
        method: 'POST',
        redirect: 'follow',
        cache: 'no-store',
        credentials: 'omit',
        headers: {
          'Content-Type': 'text/plain;charset=UTF-8'
        },
        body: JSON.stringify(cleanEnvelope)
      };

      if (signal) {
        fetchOptions.signal = signal;
      }

      fetch(requestUrl, fetchOptions)
        .then(function (response) {
          if (timerId !== null) {
            clearTimeout(timerId);
            timerId = null;
          }

          var elapsed = Date.now() - startTime;
          var host = '';
          try {
            var parsedUrl = new URL(requestUrl);
            host = parsedUrl.host;
          } catch (e) {
            // Non-fatal URL parse failure
          }

          // Non-sensitive telemetry
          if (self.enableDiagnostics) {
            self.lastDiagnostics = {
              stage: 'RESPONSE_RECEIVED',
              elapsedMs: elapsed,
              httpStatus: response.status,
              endpointHost: host,
              action: cleanEnvelope.action,
              requestId: cleanEnvelope.requestId
            };
          }

          if (!response.ok) {
            throw sanitizeClientError({
              code: 'HTTP_ERROR_' + response.status,
              message: 'サーバー通信エラーが発生しました (HTTP ' + response.status + ')。',
              requestId: cleanEnvelope.requestId
            }, cleanEnvelope.requestId);
          }

          return response.text();
        })
        .then(function (text) {
          var parsedResponse;
          try {
            parsedResponse = JSON.parse(text);
          } catch (jsonErr) {
            throw sanitizeClientError({
              code: 'MALFORMED_JSON_RESPONSE',
              message: 'サーバーからの応答形式が不正です。',
              requestId: cleanEnvelope.requestId
            }, cleanEnvelope.requestId);
          }

          if (!parsedResponse || typeof parsedResponse !== 'object') {
            throw sanitizeClientError({
              code: 'INVALID_RESPONSE_STRUCTURE',
              message: 'サーバーからの応答が不正です。',
              requestId: cleanEnvelope.requestId
            }, cleanEnvelope.requestId);
          }

          if (parsedResponse.ok === true) {
            resolve(parsedResponse);
          } else {
            var err = parsedResponse.error || {};
            throw sanitizeClientError({
              code: err.code || 'SERVER_ERROR',
              message: err.message || 'サーバーでエラーが発生しました。',
              isSafeMessage: true,
              requestId: parsedResponse.requestId || cleanEnvelope.requestId
            }, cleanEnvelope.requestId);
          }
        })
        .catch(function (fetchErr) {
          if (timerId !== null) {
            clearTimeout(timerId);
            timerId = null;
          }
          var elapsed = Date.now() - startTime;
          if (self.enableDiagnostics) {
            self.lastDiagnostics = {
              stage: 'FETCH_FAILED',
              elapsedMs: elapsed,
              errorCode: fetchErr && fetchErr.code ? fetchErr.code : 'FETCH_ERROR',
              action: cleanEnvelope.action,
              requestId: cleanEnvelope.requestId
            };
          }
          reject(sanitizeClientError(fetchErr, cleanEnvelope.requestId));
        });
    });

    return fetchPromise;
  };

  /**
   * Diagnostic telemetry accessor (Non-sensitive info only).
   *
   * @return {Object|null} Last diagnostic metadata
   */
  HttpGasTransport.prototype.getDiagnostics = function () {
    return this.lastDiagnostics;
  };

  // ===========================================================================
  // 2. MockTransport (In-Memory Simulator for Unit Tests & Offline Preview)
  // ===========================================================================

  /**
   * Constructor for MockTransport.
   *
   * @param {Object} [options]
   * @param {number} [options.latencyMs] Simulated latency in ms (default: 30)
   * @param {Object} [options.handlers] Custom mock handler overrides
   */
  function MockTransport(options) {
    var opts = options || {};
    this.latencyMs = typeof opts.latencyMs === 'number' ? opts.latencyMs : 30;
    this.handlers = opts.handlers || {};
    this.calls = [];
  }

  MockTransport.prototype.send = function (envelope, options) {
    var self = this;
    var cleanEnvelope = envelope || {};
    self.calls.push({
      action: cleanEnvelope.action,
      requestId: cleanEnvelope.requestId,
      payload: cleanEnvelope.payload,
      sessionToken: cleanEnvelope.sessionToken,
      timestamp: Date.now()
    });

    return new Promise(function (resolve, reject) {
      setTimeout(function () {
        var action = cleanEnvelope.action;
        if (self.handlers && typeof self.handlers[action] === 'function') {
          try {
            var result = self.handlers[action](cleanEnvelope.payload, cleanEnvelope);
            resolve({
              ok: true,
              requestId: cleanEnvelope.requestId,
              action: action,
              payload: result,
              serverTimestamp: new Date().toISOString()
            });
          } catch (mockErr) {
            reject(sanitizeClientError(mockErr, cleanEnvelope.requestId));
          }
          return;
        }

        // Built-in mock dispatch
        if (action === 'ping') {
          resolve({
            ok: true,
            requestId: cleanEnvelope.requestId,
            action: action,
            payload: { echo: cleanEnvelope.payload, status: 'MOCK_HEALTHY' },
            serverTimestamp: new Date().toISOString()
          });
        } else if (action === 'auth.getKdfParams') {
          resolve({
            ok: true,
            requestId: cleanEnvelope.requestId,
            action: action,
            payload: {
              salt: '0123456789abcdef0123456789abcdef',
              iterations: 100000,
              kdfVersion: 'PBKDF2_SHA256_100K'
            },
            serverTimestamp: new Date().toISOString()
          });
        } else if (action === 'auth.login') {
          resolve({
            ok: true,
            requestId: cleanEnvelope.requestId,
            action: action,
            payload: {
              sessionToken: 'mock-session-' + Date.now(),
              employeeName: 'モック太郎',
              mustChangePassword: false
            },
            serverTimestamp: new Date().toISOString()
          });
        } else if (action === 'authz.getAccessContext') {
          resolve({
            ok: true,
            requestId: cleanEnvelope.requestId,
            action: action,
            payload: {
              employeeCode: 'EMP001',
              employeeName: 'モック太郎',
              baseCode: 'BASE01',
              baseName: '東京配送センター',
              areaName: '関東エリア',
              roles: ['USER'],
              capabilities: ['SHIPMENT_CREATE', 'SHIPMENT_READ_ALL']
            },
            serverTimestamp: new Date().toISOString()
          });
        } else if (action === 'material.search' || action === 'shipment.searchMaterials') {
          var q = cleanEnvelope.payload && cleanEnvelope.payload.query ? String(cleanEnvelope.payload.query).toUpperCase() : '';
          var mockMaterials = [
            { materialCode: 'IQA3800', materialName: '段ボール箱 A式 380×270×200', category: 'サイズ間違い' },
            { materialCode: 'IQA3806', materialName: '段ボール箱 B式 380×270×260', category: 'サイズ間違い' },
            { materialCode: 'IQA4000', materialName: '強化段ボール 大型 400×300×250', category: '資材間違い' },
            { materialCode: 'PLT1111', materialName: '木製パレット 1100×1100', category: '品質' },
            { materialCode: 'PLT1210', materialName: 'プラスチックパレット 1200×1000', category: '品質' },
            { materialCode: 'STR0015', materialName: 'ストレッチフィルム 15μ×500m', category: '積み忘れ' },
            { materialCode: 'STR0020', materialName: 'ストレッチフィルム 20μ×300m', category: '積み忘れ' },
            { materialCode: 'TAP0050', materialName: 'クラフト粘着テープ 50mm×50m', category: '数量間違い' }
          ];

          var filtered = mockMaterials.filter(function (m) {
            return m.materialCode.indexOf(q) !== -1 || m.materialName.toUpperCase().indexOf(q) !== -1;
          }).slice(0, 10);

          resolve({
            ok: true,
            requestId: cleanEnvelope.requestId,
            action: action,
            payload: filtered,
            serverTimestamp: new Date().toISOString()
          });
        } else if (action === 'shipment.list') {
          var mockShipments = [
            {
              shippingCheckId: 'CHK-20260930-001',
              clientSubmissionId: 'sub-mock-001',
              loadingDate: '2026/09/30',
              registeredAt: '2026-09-30T10:30:00.000Z',
              inputStartedAt: '2026-09-30T10:25:00.000Z',
              employeeName: '山田 太郎',
              historicalBaseName: '東京Base',
              historicalAreaName: '関東エリア',
              liftOperatorName: '佐藤 一郎',
              partnerName: '東配サービス',
              equipmentTypeCount: 3,
              hasLooseItems: true,
              looseItemStatus: '積込完了',
              transportCategory: '路線便',
              reviewStatus: '未確認',
              errorDetailsCount: 2,
              attachmentsCount: 1
            },
            {
              shippingCheckId: 'CHK-20260929-002',
              clientSubmissionId: 'sub-mock-002',
              loadingDate: '2026/09/29',
              registeredAt: '2026-09-29T16:45:00.000Z',
              inputStartedAt: '2026-09-29T16:40:00.000Z',
              employeeName: '鈴木 次郎',
              historicalBaseName: '大阪Base',
              historicalAreaName: '関西エリア',
              liftOperatorName: '田中 健二',
              partnerName: '関西急送',
              equipmentTypeCount: 2,
              hasLooseItems: false,
              looseItemStatus: null,
              transportCategory: '専属便',
              reviewStatus: 'OK',
              errorDetailsCount: 1,
              attachmentsCount: 0
            },
            {
              shippingCheckId: 'CHK-20260928-003',
              clientSubmissionId: 'sub-mock-003',
              loadingDate: '2026/09/28',
              registeredAt: '2026-09-28T14:15:00.000Z',
              inputStartedAt: '2026-09-28T14:10:00.000Z',
              employeeName: '高橋 三郎',
              historicalBaseName: '名古屋Base',
              historicalAreaName: '中部エリア',
              liftOperatorName: '伊藤 四郎',
              partnerName: '中部ロジ',
              equipmentTypeCount: 4,
              hasLooseItems: true,
              looseItemStatus: '荷崩れ防止処置済',
              transportCategory: '混載便',
              reviewStatus: 'NG',
              errorDetailsCount: 3,
              attachmentsCount: 2
            }
          ];

          resolve({
            ok: true,
            requestId: cleanEnvelope.requestId,
            action: action,
            payload: {
              shipments: mockShipments
            },
            serverTimestamp: new Date().toISOString()
          });
        } else if (action === 'shipment.get') {
          var targetId = (cleanEnvelope.payload && cleanEnvelope.payload.shippingCheckId)
            ? cleanEnvelope.payload.shippingCheckId
            : 'CHK-20260930-001';
          resolve({
            ok: true,
            requestId: cleanEnvelope.requestId,
            action: action,
            payload: {
              shippingCheckId: targetId,
              clientSubmissionId: 'sub-mock-001',
              loadingDate: '2026/09/30',
              registeredAt: '2026-09-30T10:30:00.000Z',
              inputStartedAt: '2026-09-30T10:25:00.000Z',
              employeeName: '山田 太郎',
              historicalBaseName: '東京Base',
              historicalAreaName: '関東エリア',
              liftOperatorName: '佐藤 一郎',
              partnerName: '東配サービス',
              equipmentTypeCount: 3,
              hasLooseItems: true,
              looseItemStatus: '積込完了',
              transportCategory: '路線便',
              reviewStatus: '未確認',
              errorDetails: [
                {
                  detailId: 'DET-001',
                  category: 'サイズ間違い',
                  materialCode: 'IQA3800',
                  materialName: '段ボール箱 A式 380×270×200',
                  causeDetail: 'パレット積載時にサイズ違いの箱が混入していたため是正'
                },
                {
                  detailId: 'DET-002',
                  category: '数量間違い',
                  materialCode: 'TAP0050',
                  materialName: 'クラフト粘着テープ 50mm×50m',
                  causeDetail: '数量が10個不足していたため追加積載'
                }
              ],
              attachments: []
            },
            serverTimestamp: new Date().toISOString()
          });
        } else {
          resolve({
            ok: true,
            requestId: cleanEnvelope.requestId,
            action: action,
            payload: {},
            serverTimestamp: new Date().toISOString()
          });
        }
      }, self.latencyMs);
    });
  };

  // ===========================================================================
  // 3. GoogleScriptRunTransport (Legacy Container Runner Adapter)
  // ===========================================================================

  /**
   * Constructor for GoogleScriptRunTransport.
   *
   * @param {Object} [options]
   * @param {Object} [options.gasRunner] The google.script.run global object
   */
  function GoogleScriptRunTransport(options) {
    var opts = options || {};
    this.gasRunner = opts.gasRunner || (typeof google !== 'undefined' && google.script && google.script.run ? google.script.run : null);
  }

  GoogleScriptRunTransport.prototype.send = function (envelope, options) {
    var self = this;
    if (!self.gasRunner || typeof self.gasRunner.withSuccessHandler !== 'function') {
      return Promise.reject(sanitizeClientError({
        code: 'GAS_RUNNER_UNAVAILABLE',
        message: 'google.script.run is not available in current environment.'
      }, envelope ? envelope.requestId : null));
    }

    return new Promise(function (resolve, reject) {
      self.gasRunner
        .withSuccessHandler(function (response) {
          if (!response || typeof response !== 'object') {
            reject(sanitizeClientError({ code: 'MALFORMED_RESPONSE' }, envelope ? envelope.requestId : null));
            return;
          }
          if (response.ok === true) {
            resolve(response);
          } else {
            reject(sanitizeClientError(response.error || { code: 'SERVER_ERROR' }, envelope ? envelope.requestId : null));
          }
        })
        .withFailureHandler(function (failure) {
          reject(sanitizeClientError(failure, envelope ? envelope.requestId : null));
        })
        .rpc(envelope);
    });
  };

  /**
   * Evaluates if a given location object represents a local preview host.
   *
   * @param {Object} [loc] Location-like object with hostname and protocol
   * @return {boolean} True if host is considered a local preview environment
   */
  function isLocalPreviewHost(loc) {
    if (!loc) return false;
    var hostname = String(loc.hostname || '').toLowerCase();
    var protocol = String(loc.protocol || '').toLowerCase();
    if (protocol === 'file:') return true;
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]') {
      return true;
    }
    return false;
  }

  /**
   * Creates a normalized transport configuration error for fail-closed handling.
   *
   * @param {string} [message] Error message
   * @return {Error} Configuration error with code TRANSPORT_CONFIGURATION_ERROR
   */
  function createTransportConfigurationError(message) {
    var msg = message || 'GAS endpoint URL is not configured. Falling back to MockTransport is prohibited in production or non-local environments.';
    var err = new Error(msg);
    err.name = 'TransportConfigurationError';
    err.code = 'TRANSPORT_CONFIGURATION_ERROR';
    return err;
  }

  /**
   * Resolves default transport adapter based on environment and config.
   * Fails closed if GAS endpoint is not configured outside of explicit mock preview.
   *
   * @param {Object} [options]
   * @param {string} [options.endpointUrl] Explicit endpoint URL
   * @param {boolean} [options.allowMock] Explicit permission to use MockTransport (default: false)
   * @param {boolean} [options.isLocalPreview] Explicit local preview flag override
   * @param {Object} [options.location] Location object override for host evaluation
   * @param {Object} [options.gasRunner] google.script.run runner override
   * @return {Object} Transport adapter instance
   * @throws {Error} TRANSPORT_CONFIGURATION_ERROR if configuration is missing outside mock preview
   */
  function resolveDefaultTransport(options) {
    var opts = options || {};
    var globalConfig = (typeof window !== 'undefined' && window.__SHIPPING_CONFIG__) ? window.__SHIPPING_CONFIG__ : null;

    // 1. Resolve endpoint URL from options or global config
    var endpoint = opts.endpointUrl ||
      (globalConfig && globalConfig.gasEndpointUrl) ||
      (typeof window !== 'undefined' && window.GAS_ENDPOINT_URL) || '';

    if (endpoint && typeof endpoint === 'string' && endpoint.trim().length > 0) {
      return new HttpGasTransport({ endpointUrl: endpoint.trim() });
    }

    // 2. Check for google.script.run (legacy container runner)
    if (opts.gasRunner) {
      return new GoogleScriptRunTransport({ gasRunner: opts.gasRunner });
    }
    if (typeof google !== 'undefined' && google.script && google.script.run) {
      return new GoogleScriptRunTransport();
    }

    // 3. Evaluate allowMock permissions
    // Silent mock fallback is prohibited when allowMock === false, strictFailClosed === true, or globalConfig.allowMock === false
    var allowMockExplicit = (opts.allowMock === true) || (globalConfig && globalConfig.allowMock === true);
    var forbidSilentMock = (opts.strictFailClosed === true) || (opts.allowMock === false) || (globalConfig && globalConfig.allowMock === false);

    // 4. Evaluate whether local preview environment applies
    var loc = opts.location || (typeof window !== 'undefined' && window.location ? window.location : null);
    var isLocal = (opts.isLocalPreview === true) || isLocalPreviewHost(loc);

    // Permit MockTransport ONLY if explicitly requested, or if in backward-compat legacy local test without forbidSilentMock
    if (allowMockExplicit || (!forbidSilentMock && isLocal)) {
      return new MockTransport(opts);
    }

    // 5. Fail-Closed: Production host, GitHub Pages, or missing endpoint outside explicit mock
    throw createTransportConfigurationError(
      'GAS endpoint URL is not configured. Falling back to MockTransport is prohibited.'
    );
  }

  return {
    HttpGasTransport: HttpGasTransport,
    MockTransport: MockTransport,
    GoogleScriptRunTransport: GoogleScriptRunTransport,
    resolveDefaultTransport: resolveDefaultTransport,
    isLocalPreviewHost: isLocalPreviewHost,
    createTransportConfigurationError: createTransportConfigurationError,
    sanitizeClientError: sanitizeClientError,
    generateCacheBuster: generateCacheBuster
  };
});
