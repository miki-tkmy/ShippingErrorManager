/**
 * =============================================================================
 * ShippingErrorManager - Client RPC Foundation & Concurrency Controller
 * =============================================================================
 * Phase: IMPL-001 (GAS_RUNTIME_SHELL_AND_RPC_FOUNDATION)
 * Compliant with:
 *   - RPC-004 Concurrency Policy (Max 3 total in-flight, max 1 mutation in-flight)
 *   - Google Apps Script google.script.run platform constraints
 *   - Fail-closed error normalization & slot leak prevention
 * =============================================================================
 */

(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    // Node.js CommonJS
    module.exports = factory();
  } else if (typeof define === 'function' && define.amd) {
    // AMD
    define([], factory);
  } else {
    // Browser Global
    root.ShippingRpcClient = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DEFAULT_MAX_CONCURRENT = 3;
  var DEFAULT_MAX_READS = 2;
  var DEFAULT_MAX_MUTATIONS = 1;
  var DEFAULT_TIMEOUT_MS = 30000;

  /**
   * Generates a unique request ID.
   * Uses crypto.randomUUID if available, with a resilient fallback.
   *
   * @return {string} Unique request ID
   */
  function generateRequestId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      try {
        return crypto.randomUUID();
      } catch (e) {
        // Fallback if randomUUID fails in restricted context
      }
    }
    var ts = Date.now().toString(36);
    var rnd = Math.random().toString(36).substring(2, 10);
    return 'req-' + ts + '-' + rnd;
  }

  /**
   * Creates a normalized client-side Error instance.
   *
   * @param {string} code Machine-readable error code
   * @param {string} message Human-readable error message
   * @param {Object} [details] Optional diagnostic details
   * @return {Error} Standard Error augmented with code and details
   */
  function createNormalizedError(code, message, details) {
    var err = new Error(message || 'An RPC error occurred.');
    err.name = 'RpcClientError';
    err.code = code || 'UNKNOWN_ERROR';
    err.details = details || null;
    return err;
  }

  /**
   * Normalizes an exception received from google.script.run or the network adapter.
   *
   * @param {*} rawErr Caught or reported error
   * @return {Error} Normalized Error
   */
  function normalizeAdapterError(rawErr) {
    if (!rawErr) {
      return createNormalizedError('ADAPTER_FAILURE', 'Google Script Run returned an unspecified failure.');
    }
    if (typeof rawErr === 'object' && rawErr.name === 'RpcClientError') {
      return rawErr;
    }
    var msg = (typeof rawErr === 'object' && rawErr.message)
      ? String(rawErr.message)
      : String(rawErr);

    return createNormalizedError('ADAPTER_FAILURE', 'RPC communication failure: ' + msg, { raw: rawErr });
  }

  /**
   * Default classifier for mutation-class actions.
   * Mutations require strict serialization (max 1 concurrent).
   *
   * @param {string} action Action name
   * @param {Object} options Call options
   * @return {boolean} True if action is a mutation
   */
  function defaultIsMutation(action, options) {
    var act = String(action || '').toLowerCase();
    // 1. Explicit canonical mutation actions (Section 47: auth.login, auth.logout, auth.changePassword, shipment.review)
    var explicitMutations = ['auth.login', 'auth.logout', 'auth.changepassword', 'login', 'logout', 'changepassword', 'shipment.review'];
    for (var m = 0; m < explicitMutations.length; m++) {
      if (act === explicitMutations[m]) {
        return true;
      }
    }
    // 2. Explicit canonical read-only actions (Section 47: auth.getKdfParams, auth.validateSession)
    var explicitReads = ['auth.getkdfparams', 'auth.validatesession'];
    for (var r = 0; r < explicitReads.length; r++) {
      if (act === explicitReads[r]) {
        return false;
      }
    }
    // 3. Known mutation verbs / canonical mutation actions cannot be bypassed by options.isMutation: false
    var mutationVerbs = ['create', 'update', 'delete', 'save', 'commit', 'post', 'put', 'submit', 'mutate', 'sync', 'upload', 'enroll', 'revoke', 'review'];
    for (var i = 0; i < mutationVerbs.length; i++) {
      if (act.indexOf(mutationVerbs[i]) !== -1) {
        return true;
      }
    }
    // 4. Known read actions are always read-only
    var readOnly = ['ping', 'echo', 'get', 'fetch', 'list', 'read', 'query', 'check'];
    if (readOnly.indexOf(act) !== -1) {
      return false;
    }
    // 5. Fallback to caller option if provided (only for unclassified actions; cannot downgrade known mutations)
    if (options && typeof options.isMutation === 'boolean') {
      return options.isMutation;
    }
    return false;
  }

  /**
   * RPC Client Constructor.
   *
   * @param {Object} [options] Configuration options
   */
  function RpcClient(options) {
    var opts = options || {};
    this.transport = opts.transport || null;
    this.adapter = opts.adapter || this.transport || (typeof google !== 'undefined' && google.script && google.script.run ? google.script.run : null);
    this.maxConcurrent = typeof opts.maxConcurrent === 'number' ? opts.maxConcurrent : DEFAULT_MAX_CONCURRENT;
    this.maxReads = typeof opts.maxReads === 'number' ? opts.maxReads : DEFAULT_MAX_READS;
    this.maxMutations = typeof opts.maxMutations === 'number' ? opts.maxMutations : DEFAULT_MAX_MUTATIONS;
    this.defaultTimeoutMs = typeof opts.defaultTimeoutMs === 'number' ? opts.defaultTimeoutMs : DEFAULT_TIMEOUT_MS;
    this.isMutationFn = typeof opts.isMutation === 'function' ? opts.isMutation : defaultIsMutation;

    this.queue = [];
    this.activeTotal = 0;
    this.activeRead = 0;
    this.activeMutation = 0;
    // Backward-compatibility alias getters / fields
    this.activeMutations = 0;
    this.activeReads = 0;
    this.mutationBlocked = false;
  }

  /**
   * Enqueues and executes an RPC call.
   *
   * @param {string} action Action identifier
   * @param {Object} [payload] Request payload
   * @param {Object} [options] Call options (isMutation, timeoutMs)
   * @return {Promise<Object>} Resolves to canonical response envelope
   */
  RpcClient.prototype.call = function (action, payload, options) {
    var self = this;
    var callOpts = options || {};

    if (!action || typeof action !== 'string' || action.trim().length === 0) {
      return Promise.reject(createNormalizedError('INVALID_ARGUMENT', 'action must be a non-empty string.'));
    }

    var isMutation = self.isMutationFn(action, callOpts);
    if (isMutation && self.mutationBlocked) {
      return Promise.reject(createNormalizedError(
        'TRANSPORT_UNCERTAIN',
        'Further mutations blocked: previous mutation state was uncertain. Application reload required.'
      ));
    }
    var requestId = generateRequestId();
    var cleanPayload = (payload && typeof payload === 'object' && !Array.isArray(payload)) ? payload : {};

    return new Promise(function (resolve, reject) {
      var task = {
        requestId: requestId,
        action: action.trim(),
        payload: cleanPayload,
        options: callOpts,
        isMutation: isMutation,
        resolve: resolve,
        reject: reject,
        enqueuedAt: Date.now()
      };

      self.queue.push(task);
      self._processQueue();
    });
  };

  /**
   * Internal queue processor. Dispatches tasks respecting concurrency limits.
   */
  RpcClient.prototype._processQueue = function () {
    var self = this;

    // Process tasks while total slots are available
    while (self.activeTotal < self.maxConcurrent && self.queue.length > 0) {
      // Find candidate task in FIFO order respecting concurrency limits:
      // Invariant: activeTotal <= maxConcurrent(3), activeRead <= maxReads(2), activeMutation <= maxMutations(1)
      var candidateIndex = -1;
      for (var i = 0; i < self.queue.length; i++) {
        var item = self.queue[i];
        if (item.isMutation) {
          if (self.activeMutation < self.maxMutations) {
            candidateIndex = i;
            break;
          }
          // If mutation cannot run yet, it waits in FIFO
        } else {
          // Read request requires both activeTotal < maxConcurrent AND activeRead < maxReads
          if (self.activeRead < self.maxReads) {
            candidateIndex = i;
            break;
          }
        }
      }

      // If no task can be dispatched under current constraints, break loop
      if (candidateIndex === -1) {
        break;
      }

      var task = self.queue.splice(candidateIndex, 1)[0];
      self._dispatchTask(task);
    }
  };

  /**
   * Dispatches a single task to the underlying google.script.run adapter.
   *
   * @param {Object} task Queued task descriptor
   */
  RpcClient.prototype._dispatchTask = function (task) {
    var self = this;

    // Increment transport in-flight counters
    self.activeTotal++;
    if (task.isMutation) {
      self.activeMutation++;
      self.activeMutations = self.activeMutation;
    } else {
      self.activeRead++;
      self.activeReads = self.activeRead;
    }

    var slotReleased = false;
    var timerId = null;

    // State tracking to strictly separate logical Promise settlement from transport slot release (Finding-002)
    task.logicalSettled = false;
    task.transportSettled = false;
    task.timedOut = false;

    function releaseSlot() {
      if (slotReleased) return;
      slotReleased = true;
      task.transportSettled = true;
      if (timerId !== null) {
        clearTimeout(timerId);
        timerId = null;
      }
      self.activeTotal = Math.max(0, self.activeTotal - 1);
      if (task.isMutation) {
        self.activeMutation = Math.max(0, self.activeMutation - 1);
        self.activeMutations = self.activeMutation;
      } else {
        self.activeRead = Math.max(0, self.activeRead - 1);
        self.activeReads = self.activeRead;
      }
      // Re-evaluate queue on actual slot release
      self._processQueue();
    }

    // Configure client-side logical timeout (Finding-002: Does NOT release transport slot prematurely)
    var timeoutMs = typeof task.options.timeoutMs === 'number'
      ? task.options.timeoutMs
      : self.defaultTimeoutMs;

    if (timeoutMs > 0) {
      timerId = setTimeout(function () {
        if (task.transportSettled) return;
        task.timedOut = true;
        if (!task.logicalSettled) {
          task.logicalSettled = true;
          task.reject(createNormalizedError('CLIENT_TIMEOUT', 'RPC request timed out after ' + timeoutMs + 'ms.'));
        }
        // Invariant: Do NOT call releaseSlot() here.
        // google.script.run server execution is not cancelled by client timeout.
        // Transport slot remains occupied until actual success/failure callback arrives.
      }, timeoutMs);
    }

    var token = (task.options && task.options.sessionToken) || (task.payload && task.payload.sessionToken) || undefined;
    var envelope = {
      protocolVersion: '1.0',
      requestId: task.requestId,
      action: task.action,
      sessionToken: token,
      payload: task.payload
    };

    var activeTransport = (self.transport && typeof self.transport.send === 'function')
      ? self.transport
      : ((self.adapter && typeof self.adapter.send === 'function') ? self.adapter : null);

    if (activeTransport) {
      try {
        activeTransport.send(envelope, task.options)
          .then(function (response) {
            releaseSlot();
            if (task.logicalSettled) {
              return;
            }
            task.logicalSettled = true;
            if (!response || typeof response !== 'object') {
              task.reject(createNormalizedError('MALFORMED_RESPONSE', 'Invalid response structure from server.'));
              return;
            }
            if (response.ok === true) {
              task.resolve(response);
            } else {
              var errObj = response.error || {};
              task.reject(createNormalizedError(
                errObj.code || 'SERVER_ERROR',
                errObj.message || 'Server reported an error.',
                response
              ));
            }
          })
          .catch(function (failure) {
            releaseSlot();
            if (task.logicalSettled) {
              return;
            }
            task.logicalSettled = true;
            task.reject(normalizeAdapterError(failure));
          });
      } catch (syncErr) {
        releaseSlot();
        if (!task.logicalSettled) {
          task.logicalSettled = true;
          task.reject(normalizeAdapterError(syncErr));
        }
      }
      return;
    }

    try {
      if (!self.adapter || typeof self.adapter.withSuccessHandler !== 'function') {
        throw new Error('RPC Transport/Adapter is not available or properly configured.');
      }

      var runner = self.adapter
        .withSuccessHandler(function (response) {
          // Actual server response arrived -> release transport slot exactly once
          releaseSlot();

          // If caller was already settled by logical timeout, do not re-settle (Finding-002)
          if (task.logicalSettled) {
            return;
          }
          task.logicalSettled = true;

          if (!response || typeof response !== 'object') {
            task.reject(createNormalizedError('MALFORMED_RESPONSE', 'Invalid response structure from server.'));
            return;
          }
          if (response.ok === true) {
            task.resolve(response);
          } else {
            var errObj = response.error || {};
            task.reject(createNormalizedError(
              errObj.code || 'SERVER_ERROR',
              errObj.message || 'Server reported an error.',
              response
            ));
          }
        })
        .withFailureHandler(function (failure) {
          // Actual server/network failure arrived -> release transport slot exactly once
          releaseSlot();

          // If caller was already settled by logical timeout, do not re-settle (Finding-002)
          if (task.logicalSettled) {
            return;
          }
          task.logicalSettled = true;

          task.reject(normalizeAdapterError(failure));
        });

      if (typeof runner.rpc !== 'function') {
        throw new Error('google.script.run runner does not expose rpc entrypoint.');
      }

      runner.rpc(envelope);
    } catch (syncErr) {
      // Synchronous adapter exception: invocation failed before transport start, immediately release slot
      releaseSlot();
      if (!task.logicalSettled) {
        task.logicalSettled = true;
        task.reject(normalizeAdapterError(syncErr));
      }
    }
  };

  /**
   * Manually resets transport slots and drains queued tasks when server callbacks are permanently lost.
   * Enforces fail-closed semantics (Section 13) while allowing the caller/UI to recover from transport uncertainty.
   *
   * @param {string} [reason] Optional reason description
   * @return {number} Number of drained queued tasks
   */
  RpcClient.prototype.resetTransport = function (reason) {
    var msg = reason || 'Transport reset by application.';
    var drainedCount = this.queue.length;

    // If an in-flight mutation was lost/uncertain, permanently block subsequent mutations (FAIL-CLOSED)
    if (this.activeMutation > 0) {
      this.mutationBlocked = true;
    }

    // Reject all waiting queued tasks with TRANSPORT_UNCERTAIN error
    while (this.queue.length > 0) {
      var task = this.queue.shift();
      if (!task.logicalSettled) {
        task.logicalSettled = true;
        task.reject(createNormalizedError('TRANSPORT_UNCERTAIN', 'Queue drained: ' + msg));
      }
    }

    // Reset active counters to 0
    this.activeTotal = 0;
    this.activeRead = 0;
    this.activeReads = 0;
    this.activeMutation = 0;
    this.activeMutations = 0;

    return drainedCount;
  };

  /**
   * Returns current queue diagnostics.
   *
   * @return {Object} Status metrics
   */
  RpcClient.prototype.getDiagnostics = function () {
    return {
      queueLength: this.queue.length,
      activeTotal: this.activeTotal,
      activeRead: this.activeRead,
      activeReads: this.activeRead,
      activeMutation: this.activeMutation,
      activeMutations: this.activeMutation,
      maxConcurrent: this.maxConcurrent,
      maxReads: this.maxReads,
      maxMutations: this.maxMutations
    };
  };

  /**
   * Factory function to create RpcClient instances.
   *
   * @param {Object} [options]
   * @return {RpcClient}
   */
  function createRpcClient(options) {
    return new RpcClient(options);
  }

  RpcClient.defaultIsMutation = defaultIsMutation;

  return {
    RpcClient: RpcClient,
    createRpcClient: createRpcClient,
    createNormalizedError: createNormalizedError,
    normalizeAdapterError: normalizeAdapterError,
    generateRequestId: generateRequestId,
    defaultIsMutation: defaultIsMutation
  };
});
