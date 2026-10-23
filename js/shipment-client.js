/**
 * shipment-client.js
 *
 * Client-side shipment transaction client for IMPL-006.
 * Manages:
 *  - clientSubmissionId lifecycle (generate on form start / reset; retain across retries)
 *  - inputStartedAt lifecycle (record once on form start; retain across retries)
 *  - Double-click suppression
 *  - Safe RPC dispatch via ShippingRpcClient
 *  - Interoperable session token resolution matching SessionClient / AuthClient
 */

(function (root, factory) {
  'use strict';
  if (typeof define === 'function' && define.amd) {
    define(['./rpc-client'], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.ShippingShipmentClient = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function generateUuidV4() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      try {
        return crypto.randomUUID();
      } catch (e) {
        // Fallback
      }
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0;
      var v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  /**
   * Resolves bearer session token from multiple compliant client sources.
   * Supports:
   *  1. tokenOverride parameter
   *  2. sessionClient instance (getToken / getSessionToken)
   *  3. Global SessionClient / ShippingSessionClient (getToken / getSessionToken)
   *
   * @param {Object} [sessionClient]
   * @param {string} [tokenOverride]
   * @return {string|null}
   */
  function resolveSessionToken_(sessionClient, tokenOverride) {
    if (tokenOverride && typeof tokenOverride === 'string' && tokenOverride.trim().length > 0) {
      return tokenOverride.trim();
    }
    if (sessionClient) {
      if (typeof sessionClient.getToken === 'function') {
        var t1 = sessionClient.getToken();
        if (t1) return t1;
      }
      if (typeof sessionClient.getSessionToken === 'function') {
        var t2 = sessionClient.getSessionToken();
        if (t2) return t2;
      }
    }
    // Global fallback for browser environment
    if (typeof SessionClient !== 'undefined') {
      if (typeof SessionClient.getToken === 'function') {
        var t3 = SessionClient.getToken();
        if (t3) return t3;
      }
      if (typeof SessionClient.getSessionToken === 'function') {
        var t4 = SessionClient.getSessionToken();
        if (t4) return t4;
      }
    }
    if (typeof ShippingSessionClient !== 'undefined') {
      if (typeof ShippingSessionClient.getToken === 'function') {
        var t5 = ShippingSessionClient.getToken();
        if (t5) return t5;
      }
      if (typeof ShippingSessionClient.getSessionToken === 'function') {
        var t6 = ShippingSessionClient.getSessionToken();
        if (t6) return t6;
      }
    }
    return null;
  }

  /**
   * ShipmentClient constructor.
   *
   * @param {Object} options
   * @param {Object} options.rpcClient
   * @param {Object} [options.sessionClient]
   * @constructor
   */
  function ShipmentClient(options) {
    var opts = options || {};
    if (!opts.rpcClient) {
      throw new Error('rpcClient is required');
    }
    this.rpcClient = opts.rpcClient;
    this.sessionClient = opts.sessionClient || null;
    this.currentSubmissionId = null;
    this.inputStartedAt = null;
    this.isSubmitting = false;

    this.startNewSubmission();
  }

  /**
   * Initializes or rotates the logical submission state.
   * Generates a fresh clientSubmissionId (UUIDv4) and stamps inputStartedAt.
   */
  ShipmentClient.prototype.startNewSubmission = function () {
    this.currentSubmissionId = generateUuidV4();
    this.inputStartedAt = new Date().toISOString();
  };

  /**
   * Submits a new shipment check aggregate.
   * Enforces double-submission lock and preserves submissionId across transport retries.
   *
   * @param {Object} formData
   * @param {string} [tokenOverride]
   * @return {Promise<Object>}
   */
  ShipmentClient.prototype.createShipment = function (formData, tokenOverride) {
    var self = this;
    if (this.isSubmitting) {
      return Promise.reject(new Error('SUBMISSION_IN_PROGRESS: Please wait for current submission to complete.'));
    }

    var token = resolveSessionToken_(this.sessionClient, tokenOverride);
    if (!token) {
      return Promise.reject(new Error('UNAUTHENTICATED: Valid sessionToken is required.'));
    }

    this.isSubmitting = true;

    // Attach client-controlled idempotency and clock fields
    var requestPayload = Object.assign({}, formData, {
      clientSubmissionId: this.currentSubmissionId,
      inputStartedAt: this.inputStartedAt
    });

    return this.rpcClient.call('shipment.create', {
      sessionToken: token,
      request: requestPayload
    }).then(function (res) {
      // Rotate submission state ONLY on success
      self.startNewSubmission();
      return res;
    }).finally(function () {
      self.isSubmitting = false;
    });
  };

  /**
   * Retrieves nationwide shipment checks list.
   *
   * @param {Object} [options]
   * @param {string} [tokenOverride]
   * @return {Promise<Object>}
   */
  ShipmentClient.prototype.listShipments = function (options, tokenOverride) {
    var token = resolveSessionToken_(this.sessionClient, tokenOverride);
    if (!token) {
      return Promise.reject(new Error('UNAUTHENTICATED: Valid sessionToken is required.'));
    }

    return this.rpcClient.call('shipment.list', {
      sessionToken: token,
      options: options || {}
    });
  };

  /**
   * Retrieves single shipment aggregate.
   *
   * @param {string} shippingCheckId
   * @param {string} [tokenOverride]
   * @return {Promise<Object>}
   */
  ShipmentClient.prototype.getShipment = function (shippingCheckId, tokenOverride) {
    var token = resolveSessionToken_(this.sessionClient, tokenOverride);
    if (!token) {
      return Promise.reject(new Error('UNAUTHENTICATED: Valid sessionToken is required.'));
    }

    return this.rpcClient.call('shipment.get', {
      sessionToken: token,
      shippingCheckId: shippingCheckId
    });
  };

  /**
   * Retrieves form options.
   *
   * @param {string} [tokenOverride]
   * @return {Promise<Object>}
   */
  /**
   * Reviews a shipment check record (OK / NG and ReviewComment).
   * Requires SHIPMENT_REVIEW_NATIONWIDE capability.
   *
   * @param {string} shippingCheckId
   * @param {Object} reviewInput { reviewStatus: 'OK'|'NG', reviewComment: string }
   * @param {string} [tokenOverride]
   * @return {Promise<Object>}
   */
  ShipmentClient.prototype.reviewShipment = function (shippingCheckId, reviewInput, tokenOverride) {
    var token = resolveSessionToken_(this.sessionClient, tokenOverride);
    if (!token) {
      return Promise.reject(new Error('UNAUTHENTICATED: Valid sessionToken is required.'));
    }

    return this.rpcClient.call('shipment.review', {
      sessionToken: token,
      shippingCheckId: shippingCheckId,
      reviewInput: reviewInput
    }, { isMutation: true });
  };

  ShipmentClient.prototype.getFormOptions = function (tokenOverride) {
    var token = resolveSessionToken_(this.sessionClient, tokenOverride);
    if (!token) {
      return Promise.reject(new Error('UNAUTHENTICATED: Valid sessionToken is required.'));
    }

    return this.rpcClient.call('shipment.getFormOptions', {
      sessionToken: token
    });
  };

  return {
    ShipmentClient: ShipmentClient,
    createShipmentClient: function (options) {
      return new ShipmentClient(options);
    },
    generateUuidV4: generateUuidV4
  };
});
