/**
 * =============================================================================
 * ShippingErrorManager - Client Authorization & Capability Helper
 * =============================================================================
 * Phase: IMPL-005 (AUTHORIZATION_AND_CAPABILITY_ENGINE)
 *
 * Compliant with:
 *   - docs/35 (Role Assignment & Capability Business Freeze)
 *   - Sections 37, 38 (Client Capabilities Are Advisory Only)
 *
 * CRITICAL SECURITY PRINCIPLE:
 *   Client capability checks are strictly ADVISORY for UI element visibility
 *   and control disabling (e.g. hiding review buttons or admin tabs).
 *   The server ALWAYS independently and authoritatively evaluates authorization
 *   and permissions on every business RPC.
 * =============================================================================
 */

(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.AuthorizationClient = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var CAPABILITIES = {
    SHIPMENT_READ_ALL: 'SHIPMENT_READ_ALL',
    SHIPMENT_CREATE: 'SHIPMENT_CREATE',
    SHIPMENT_EDIT_OWN_UNREVIEWED: 'SHIPMENT_EDIT_OWN_UNREVIEWED',
    SHIPMENT_REVIEW_NATIONWIDE: 'SHIPMENT_REVIEW_NATIONWIDE',
    LIFT_OPERATOR_READ_ALL: 'LIFT_OPERATOR_READ_ALL',
    LIFT_OPERATOR_CREATE: 'LIFT_OPERATOR_CREATE',
    LIFT_OPERATOR_DEACTIVATE: 'LIFT_OPERATOR_DEACTIVATE',
    SHIPMENT_ADMIN_CORRECT: 'SHIPMENT_ADMIN_CORRECT',
    CREDENTIAL_ADMIN: 'CREDENTIAL_ADMIN',
    ACCOUNT_ADMIN: 'ACCOUNT_ADMIN',
    SESSION_REVOKE: 'SESSION_REVOKE',
    AUTH_AUDIT_READ: 'AUTH_AUDIT_READ',
    SYSTEM_ADMIN: 'SYSTEM_ADMIN'
  };

  /**
   * Check if access context contains a specific capability.
   *
   * @param {Object} accessContext Access context object from authz.getAccessContext
   * @param {string} capability Capability name
   * @return {boolean} True if capability is present
   */
  function hasCapability(accessContext, capability) {
    if (!accessContext || !Array.isArray(accessContext.capabilities)) {
      return false;
    }
    return accessContext.capabilities.indexOf(capability) !== -1;
  }

  /**
   * Check if current user has nationwide review permission (REVIEWER / ADMIN).
   * Optionally checks AUTHZ-006: Self-review prohibition if shipment is provided.
   *
   * @param {Object} accessContext Access context object
   * @param {Object} [shipment] Optional record to verify self-review prohibition
   * @return {boolean}
   */
  function canReview(accessContext, shipment) {
    if (!hasCapability(accessContext, CAPABILITIES.SHIPMENT_REVIEW_NATIONWIDE)) {
      return false;
    }
    if (shipment && accessContext && accessContext.empNo) {
      var creator = shipment.employeeCode !== undefined ? shipment.employeeCode : (shipment.EmployeeCode !== undefined ? shipment.EmployeeCode : shipment.empNo);
      if (creator && String(creator).trim() === String(accessContext.empNo).trim()) {
        return false;
      }
    }
    return true;
  }

  /**
   * Check if current user can edit own unreviewed shipment record.
   *
   * @param {Object} accessContext Access context object
   * @param {Object} shipment Record to check
   * @return {boolean}
   */
  function canEditOwnUnreviewed(accessContext, shipment) {
    if (!hasCapability(accessContext, CAPABILITIES.SHIPMENT_EDIT_OWN_UNREVIEWED)) {
      return false;
    }
    if (!shipment) {
      return false;
    }
    var status = shipment.reviewStatus !== undefined ? shipment.reviewStatus : shipment.ReviewStatus;
    if (status !== '未確認') {
      return false;
    }
    var creator = shipment.employeeCode !== undefined ? shipment.employeeCode : shipment.EmployeeCode;
    return String(creator).trim() === String(accessContext.empNo).trim();
  }

  /**
   * Check if current user can view LiftOperator entries (USER / REVIEWER / ADMIN).
   *
   * @param {Object} accessContext
   * @return {boolean}
   */
  function canReadLiftOperator(accessContext) {
    return hasCapability(accessContext, CAPABILITIES.LIFT_OPERATOR_READ_ALL);
  }

  /**
   * Check if current user can create a LiftOperator entry (USER / REVIEWER / ADMIN).
   *
   * @param {Object} accessContext
   * @return {boolean}
   */
  function canCreateLiftOperator(accessContext) {
    return hasCapability(accessContext, CAPABILITIES.LIFT_OPERATOR_CREATE);
  }

  /**
   * Check if current user can deactivate a LiftOperator entry (ADMIN only).
   *
   * @param {Object} accessContext
   * @return {boolean}
   */
  function canDeactivateLiftOperator(accessContext) {
    return hasCapability(accessContext, CAPABILITIES.LIFT_OPERATOR_DEACTIVATE);
  }

  /**
   * Check if current user can manage credentials / reset passwords (ADMIN only).
   *
   * @param {Object} accessContext
   * @return {boolean}
   */
  function canManageCredentials(accessContext) {
    return hasCapability(accessContext, CAPABILITIES.CREDENTIAL_ADMIN);
  }

  /**
   * Check if current user can manage accounts / enable or disable users (ADMIN only).
   *
   * @param {Object} accessContext
   * @return {boolean}
   */
  function canManageAccounts(accessContext) {
    return hasCapability(accessContext, CAPABILITIES.ACCOUNT_ADMIN);
  }

  /**
   * Check if current user can force revoke user sessions (ADMIN only).
   *
   * @param {Object} accessContext
   * @return {boolean}
   */
  function canRevokeSessions(accessContext) {
    return hasCapability(accessContext, CAPABILITIES.SESSION_REVOKE);
  }

  /**
   * Check if current user can read AuthAudit logs (ADMIN only).
   *
   * @param {Object} accessContext
   * @return {boolean}
   */
  function canReadAuthAudit(accessContext) {
    return hasCapability(accessContext, CAPABILITIES.AUTH_AUDIT_READ);
  }

  return {
    CAPABILITIES: Object.freeze(CAPABILITIES),
    hasCapability: hasCapability,
    canReview: canReview,
    canEditOwnUnreviewed: canEditOwnUnreviewed,
    canReadLiftOperator: canReadLiftOperator,
    canCreateLiftOperator: canCreateLiftOperator,
    canDeactivateLiftOperator: canDeactivateLiftOperator,
    canManageCredentials: canManageCredentials,
    canManageAccounts: canManageAccounts,
    canRevokeSessions: canRevokeSessions,
    canReadAuthAudit: canReadAuthAudit
  };
});
