/**
 * ShipmentCheckFormState
 * 
 * Manages TASK-004, TASK-005, and TASK-006 client-side form state, defaulting, validation, and historical snapshot rules.
 * 
 * CORE RULES (TASK-006):
 * - One parent ShipmentCheck supports 1..N child ShippingErrorDetail cards
 * - Categories strictly limited to canonical 5: サイズ間違い, 数量間違い, 資材間違い, 積み忘れ, 品質
 * - Material references stable MatCode from M_Material
 * - Cause/Detail (causeDetail) is mandatory free-text (per Planning docs/02_spec.md & domain schemas)
 * - Truck total material type count (equipmentTypeCount) is strictly independent from errorDetail count
 * - Valid draft submission requires at least 1 ShippingErrorDetail
 */

const STORAGE_KEY_LAST_EMP_NO = 'shipping_error_manager_last_emp_no';

const CANONICAL_CATEGORIES = [
  'サイズ間違い',
  '数量間違い',
  '資材間違い',
  '積み忘れ',
  '品質'
];

class ShipmentCheckFormState {
  constructor(masterClient) {
    this.masterClient = masterClient || (typeof MasterApiClient !== 'undefined' ? new MasterApiClient() : null);

    // 1. inputStartAt: Form start timestamp initialized once
    this.inputStartAt = this.generateTimestamp();

    // UI-REVIEW-002: loadingDate (YYYY-MM-DD business date, defaults to browser local today)
    this.loadingDate = this.generateLocalDate();

    // TASK-008: Client-generated idempotency key (UUID v4 or stable token)
    this.clientSubmissionId = (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
      ? crypto.randomUUID()
      : 'sub-' + Date.now() + '-' + Math.random().toString(36).substring(2, 11);

    // 2. Selected Employee (M_Employee reference)
    this.currentEmployee = null;

    // 3. Loading overview fields
    this.totalMaterialTypeCount = 1;
    this.hasLooseItems = true; // default: はい (UI-REVIEW-003)

    // 4. TASK-005: Lift Operator & Auto-derived Partner
    this.selectedLiftOperator = null; // { liftOperatorCode, liftOperatorName, baseCode, partnerCode, partnerName, isCrossBase }
    this.showAllDrivers = false; // default: OFF (Current Base only)
    this.partnerResolutionState = 'none'; // 'resolved' | 'unassigned' | 'error' | 'none'

    // 5. Base-dependent optional fields
    this.looseItemCreatorName = '';
    this.looseItemStatus = ''; // TASK-004A: flexible free-text
    this.transportCategory = '未指定';
    this.carrierName = '';
    this.driverName = '';

    // 6. TASK-006: ShippingErrorDetail (1:N child items)
    this.detailCounter = 0;
    this.errorDetails = [this.createEmptyErrorDetail()];
    this.detailErrors = {};

    // 7. TASK-007: AttachmentMetadata (0..N evidence items)
    this.attachmentCounter = 0;
    this.attachments = [];
    this.attachmentErrors = {};

    // Header validation state
    this.errors = {};
  }

  generateTimestamp() {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  }

  generateLocalDate() {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  }

  setLoadingDate(dateStr) {
    this.loadingDate = String(dateStr || '').trim();
    if (!this.loadingDate || !/^\d{4}-\d{2}-\d{2}$/.test(this.loadingDate)) {
      this.errors.loadingDate = '積込日を入力してください（YYYY-MM-DD形式）。';
    } else {
      delete this.errors.loadingDate;
    }
  }

  generateDetailId() {
    this.detailCounter += 1;
    return `detail_${Date.now()}_${this.detailCounter}`;
  }

  createEmptyErrorDetail(initial = {}) {
    const cat = CANONICAL_CATEGORIES.includes(initial.category) ? initial.category : CANONICAL_CATEGORIES[0];
    return {
      clientDetailId: initial.clientDetailId || this.generateDetailId(),
      category: cat,
      materialCode: String(initial.materialCode || '').trim(),
      materialName: String(initial.materialName || '').trim(),
      causeDetail: String(initial.causeDetail || '').trim()
    };
  }

  /**
   * TASK-006: Add an error detail card.
   */
  addErrorDetail(initial = {}) {
    const item = this.createEmptyErrorDetail(initial);
    this.errorDetails.push(item);
    return item;
  }

  /**
   * TASK-006: Remove an error detail card.
   * If only 1 card remains, resets its fields to prevent a valid zero-detail state.
   */
  removeErrorDetail(clientDetailId) {
    if (this.errorDetails.length <= 1) {
      if (this.errorDetails.length === 1 && this.errorDetails[0].clientDetailId === clientDetailId) {
        this.errorDetails[0] = this.createEmptyErrorDetail({ clientDetailId });
        delete this.detailErrors[clientDetailId];
      }
      return false;
    }
    this.errorDetails = this.errorDetails.filter(d => d.clientDetailId !== clientDetailId);
    delete this.detailErrors[clientDetailId];
    return true;
  }

  /**
   * TASK-006: Update fields in an error detail card.
   */
  updateErrorDetail(clientDetailId, patch = {}) {
    const detail = this.errorDetails.find(d => d.clientDetailId === clientDetailId);
    if (!detail) return null;

    if (patch.category !== undefined) {
      if (CANONICAL_CATEGORIES.includes(patch.category)) {
        detail.category = patch.category;
      }
    }
    if (patch.materialCode !== undefined) {
      detail.materialCode = String(patch.materialCode || '').trim();
    }
    if (patch.materialName !== undefined) {
      detail.materialName = String(patch.materialName || '').trim();
    }
    if (patch.causeDetail !== undefined) {
      detail.causeDetail = String(patch.causeDetail || '').trim();
    }
    return detail;
  }

  /**
   * TASK-006: Set selected material on a specific error detail card.
   */
  setMaterialForDetail(clientDetailId, material) {
    const detail = this.errorDetails.find(d => d.clientDetailId === clientDetailId);
    if (!detail) return null;

    const code = material?.materialCode ?? material?.matCode ?? material?.MaterialCode ?? '';
    const name = material?.materialName ?? material?.matName ?? material?.MaterialName ?? '';

    detail.materialCode = String(code).trim();
    detail.materialName = String(name).trim();

    if (this.detailErrors[clientDetailId]?.material) {
      delete this.detailErrors[clientDetailId].material;
    }
    return detail;
  }

  async restorePreviousEmployee(storageBackend = null) {
    let savedEmpNo = null;
    if (storageBackend) {
      try {
        savedEmpNo = storageBackend.getItem(STORAGE_KEY_LAST_EMP_NO);
      } catch (e) {
        console.warn('Storage is not accessible', e);
      }
    }

    if (!savedEmpNo) return false;

    try {
      const emp = await this.masterClient.getEmployeeByEmpNo(savedEmpNo);
      if (emp && emp.empNo) {
        this.setEmployee(emp, false, storageBackend);
        return true;
      } else {
        this.clearStoredEmployee(storageBackend);
        return false;
      }
    } catch (err) {
      console.error('Failed to resolve stored employee', err);
      return false;
    }
  }

  /**
   * Set current employee.
   * TASK-005 Safety: If Base changes, reset incompatible previously selected Lift Operator.
   */
  setEmployee(employee, saveToStorage = false, storageBackend = null) {
    if (!employee || !employee.empNo) {
      throw new Error('Valid employee object with empNo is required.');
    }

    const previousBaseCode = this.currentEmployee?.baseCode;

    this.currentEmployee = {
      empNo: String(employee.empNo).trim(),
      empName: String(employee.empName).trim(),
      baseCode: String(employee.baseCode || '').trim(),
      baseName: String(employee.baseName || '').trim(),
      areaName: String(employee.areaName || '').trim()
    };

    // TASK-005: Incompatible Lift Operator reset check
    if (this.selectedLiftOperator && previousBaseCode && previousBaseCode !== this.currentEmployee.baseCode) {
      if (this.selectedLiftOperator.baseCode !== this.currentEmployee.baseCode) {
        // Reset lift operator selection on Base change
        this.clearLiftOperator();
      }
    }

    if (saveToStorage && storageBackend) {
      try {
        storageBackend.setItem(STORAGE_KEY_LAST_EMP_NO, this.currentEmployee.empNo);
      } catch (e) {
        console.warn('Failed to persist empNo preference', e);
      }
    }
  }

  clearStoredEmployee(storageBackend = null) {
    if (storageBackend) {
      try {
        storageBackend.removeItem(STORAGE_KEY_LAST_EMP_NO);
      } catch (e) {
        // Ignore
      }
    }
    this.currentEmployee = null;
    this.clearLiftOperator();
  }

  /**
   * TASK-005: Select a Lift Operator and automatically derive Partner.
   */
  async selectLiftOperator(operator) {
    if (!operator || !operator.liftOperatorCode) {
      throw new Error('Valid lift operator object is required.');
    }

    const cleanCode = String(operator.liftOperatorCode).trim();
    const cleanName = String(operator.liftOperatorName || '').trim();
    const opBaseCode = String(operator.baseCode || '').trim();
    const partnerCode = String(operator.partnerCode || '').trim();

    let resolvedPartnerName = '';
    let resolutionState = 'none';

    if (!partnerCode) {
      resolutionState = 'unassigned';
      resolvedPartnerName = '協力会社未設定';
    } else {
      try {
        const partner = await this.masterClient.getPartnerByCode(partnerCode);
        if (partner && partner.partnerName) {
          resolvedPartnerName = partner.partnerName;
          resolutionState = 'resolved';
        } else {
          resolutionState = 'error';
          resolvedPartnerName = '協力会社マスタ未登録';
        }
      } catch (err) {
        resolutionState = 'error';
        resolvedPartnerName = '協力会社照会エラー';
      }
    }

    const isCrossBase = Boolean(this.currentEmployee?.baseCode && opBaseCode !== this.currentEmployee.baseCode);

    this.selectedLiftOperator = {
      liftOperatorCode: cleanCode,
      liftOperatorName: cleanName,
      baseCode: opBaseCode,
      partnerCode: partnerCode,
      partnerName: resolvedPartnerName,
      isCrossBase: isCrossBase
    };
    this.partnerResolutionState = resolutionState;
    delete this.errors.liftOperator;
  }

  clearLiftOperator() {
    this.selectedLiftOperator = null;
    this.partnerResolutionState = 'none';
  }

  setShowAllDrivers(val) {
    this.showAllDrivers = Boolean(val);
  }

  setTotalMaterialTypeCount(val) {
    const parsed = Number(val);
    this.totalMaterialTypeCount = parsed;
    if (!Number.isInteger(parsed) || parsed < 1) {
      this.errors.totalMaterialTypeCount = '機材種総数は1以上の整数を入力してください。';
    } else {
      delete this.errors.totalMaterialTypeCount;
    }
  }

  setHasLooseItems(hasItems) {
    this.hasLooseItems = Boolean(hasItems);
  }

  /**
   * Validate entire form state.
   * Options:
   * - requireLiftOperator (boolean, default: false)
   * - requireErrorDetails (boolean, default: false)
   */


  // =========================================================================
  // TASK-007: AttachmentMetadata (0..N evidence items)
  // =========================================================================

  generateAttachmentId(prefix = 'att') {
    this.attachmentCounter += 1;
    return prefix + '_' + Date.now() + '_' + this.attachmentCounter;
  }

  /**
   * TASK-007: Add photo attachment draft.
   * Mobile-friendly standard file input selection/capture.
   * File binary stays in browser memory (fileObject) and is NOT serialized to persistent metadata.
   */
  addPhotoAttachment(file) {
    if (!file) {
      throw new Error('画像ファイルが指定されていません。');
    }

    // 0-byte file rejection
    if (file.size === 0) {
      throw new Error('0バイトの画像ファイルは添付できません。');
    }

    // MIME type validation
    if (file.type && !file.type.toLowerCase().startsWith('image/')) {
      throw new Error('画像ファイル（image/*）を選択してください。');
    }

    const clientAttachmentId = this.generateAttachmentId('att_photo');
    let localPreviewUrl = '';
    if (typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
      try {
        localPreviewUrl = URL.createObjectURL(file);
      } catch (e) {
        localPreviewUrl = '';
      }
    }

    const name = file.name || ('photo_' + Date.now() + '.jpg');
    const mime = file.type || 'image/jpeg';
    const size = typeof file.size === 'number' ? file.size : 0;
    const createdAt = this.generateTimestamp();

    const attachment = {
      clientAttachmentId,
      attachmentType: 'photo',
      originalFilename: name,
      originalFileName: name,
      mimeType: mime,
      fileSize: size,
      storageLocation: '', // Unresolved until actual physical upload in later tasks
      storageReference: '',
      localPreviewUrl,
      fileObject: file, // in-memory only, non-serialized
      createdAt
    };

    this.attachments.push(attachment);
    delete this.attachmentErrors[clientAttachmentId];
    return attachment;
  }

  /**
   * TASK-007: Add PDF link attachment draft (Office PC workflow).
   * Supports UNC paths (\\server\share\file.pdf), file paths, internal HTTP/HTTPS URLs.
   * Trims whitespace without destructive normalization.
   * Rejects blank links and dangerous schemes (javascript:, data:).
   */
  addPdfLinkAttachment(linkString) {
    if (!linkString || typeof linkString !== 'string') {
      throw new Error('PDFリンクまたはパスを入力してください。');
    }

    const cleanLink = linkString.trim();
    if (!cleanLink) {
      throw new Error('空のPDFリンクは登録できません。');
    }

    const lower = cleanLink.toLowerCase();
    if (lower.startsWith('javascript:') || lower.startsWith('data:') || lower.startsWith('vbscript:')) {
      throw new Error('危険なURLスキームは登録できません。');
    }

    const clientAttachmentId = this.generateAttachmentId('att_pdf');
    
    // Derive a reasonable display filename from path/URL
    const parts = cleanLink.split(/[\/\\]/);
    const lastPart = parts[parts.length - 1] || cleanLink;
    const originalFilename = lastPart.includes('.pdf') ? lastPart : (lastPart || 'document.pdf');
    const createdAt = this.generateTimestamp();

    const attachment = {
      clientAttachmentId,
      attachmentType: 'pdf_link',
      originalFilename: originalFilename,
      originalFileName: originalFilename,
      mimeType: 'application/pdf',
      fileSize: null,
      storageLocation: cleanLink, // Link reference retained as-is
      storageReference: cleanLink,
      localPreviewUrl: '',
      fileObject: null,
      createdAt
    };

    this.attachments.push(attachment);
    delete this.attachmentErrors[clientAttachmentId];
    return attachment;
  }

  /**
   * TASK-007: Remove an attachment from the draft collection.
   * Safely revokes local object preview URL to prevent memory leaks.
   * Does not alter other attachments or errorDetails.
   */
  removeAttachment(clientAttachmentId) {
    const index = this.attachments.findIndex(a => a.clientAttachmentId === clientAttachmentId);
    if (index === -1) return false;

    const item = this.attachments[index];
    if (item.localPreviewUrl && typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
      try {
        URL.revokeObjectURL(item.localPreviewUrl);
      } catch (e) {
        // ignore
      }
    }

    this.attachments.splice(index, 1);
    delete this.attachmentErrors[clientAttachmentId];
    return true;
  }

  /**
   * TASK-007: Clean up all local preview URLs (e.g. on page unload / form reset).
   */
  cleanupAttachments() {
    if (typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
      for (const att of this.attachments) {
        if (att.localPreviewUrl) {
          try {
            URL.revokeObjectURL(att.localPreviewUrl);
          } catch (e) {
            // ignore
          }
        }
      }
    }
  }

  /**
   * Complete reset of all draft inputs, attachments, and error details (e.g. on logout or submit).
   * If invoked with no arguments, performs a full reset including currentEmployee (prevents cross-account leakage).
   * If invoked with options (e.g. { preserveLiftOperator: false }), preserves currentEmployee for smooth workflow.
   *
   * @param {Object} [options]
   * @param {boolean} [options.preserveLiftOperator=false]
   * @param {boolean} [options.preserveEmployee]
   */
  resetForm(options) {
    const hasOptions = Boolean(options && typeof options === 'object');
    const preserveEmployee = hasOptions
      ? (options.preserveEmployee !== false && options.fullReset !== true)
      : false;
    const preserveLiftOperator = hasOptions ? Boolean(options.preserveLiftOperator) : false;

    this.cleanupAttachments();
    this.attachments = [];
    this.attachmentErrors = {};
    this.attachmentCounter = 0;

    this.detailCounter = 0;
    this.errorDetails = [this.createEmptyErrorDetail()];
    this.detailErrors = {};

    if (!preserveEmployee) {
      this.currentEmployee = null;
    }
    if (!preserveLiftOperator) {
      this.selectedLiftOperator = null;
      this.partnerResolutionState = 'none';
    }
    this.showAllDrivers = false;

    this.totalMaterialTypeCount = 1;
    this.hasLooseItems = true;
    this.looseItemCreatorName = '';
    this.looseItemStatus = '';
    this.transportCategory = '未指定';
    this.carrierName = '';
    this.driverName = '';

    this.inputStartAt = this.generateTimestamp();
    this.loadingDate = this.generateLocalDate();
    this.clientSubmissionId = (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
      ? crypto.randomUUID()
      : 'sub-' + Date.now() + '-' + Math.random().toString(36).substring(2, 11);

    this.errors = {};
  }

  /**
   * Alias for resetForm for backward compatibility.
   */
  reset(options) {
    return this.resetForm(options);
  }
  validate(options = {}) {
    const { requireLiftOperator = false, requireErrorDetails = false, requireAttachments = false } = options;
    const errors = {};
    const detailErrors = {};
    const attachmentErrors = {};

    // 0. Loading date is required (YYYY-MM-DD)
    if (!this.loadingDate || !/^\d{4}-\d{2}-\d{2}$/.test(String(this.loadingDate).trim())) {
      errors.loadingDate = '積込日を入力してください（YYYY-MM-DD形式）。';
    }

    // 1. Employee is required
    if (!this.currentEmployee || !this.currentEmployee.empNo) {
      errors.employee = '担当者（Base社員）を選択してください。';
    }

    // 2. Total material type count must be integer >= 1
    if (!Number.isInteger(this.totalMaterialTypeCount) || this.totalMaterialTypeCount < 1) {
      errors.totalMaterialTypeCount = '機材種総数は1以上の整数を入力してください。';
    }

    // 3. TASK-005: Lift Operator validation
    if (requireLiftOperator && (!this.selectedLiftOperator || !this.selectedLiftOperator.liftOperatorCode)) {
      errors.liftOperator = 'リフトマンを選択してください。';
    }

    // 4. TASK-006: ShippingErrorDetail validation
    if (requireErrorDetails) {
      if (!Array.isArray(this.errorDetails) || this.errorDetails.length === 0) {
        errors.errorDetails = '積み間違い資材を1件以上登録してください。';
      } else {
        for (const d of this.errorDetails) {
          const cardErrors = {};
          if (!CANONICAL_CATEGORIES.includes(d.category)) {
            cardErrors.category = '有効な区分（サイズ間違い、数量間違い、資材間違い、積み忘れ、品質）を選択してください。';
          }
          if (!d.materialCode) {
            cardErrors.material = '資材を選択してください。';
          }
          if (!d.causeDetail || !d.causeDetail.trim()) {
            cardErrors.causeDetail = '原因・詳細を入力してください。';
          }
          if (Object.keys(cardErrors).length > 0) {
            detailErrors[d.clientDetailId] = cardErrors;
          }
        }
        if (Object.keys(detailErrors).length > 0) {
          errors.errorDetails = '未入力または不正な積み間違い資材があります。各カードの入力内容をご確認ください。';
        }
      }
    }

    // 5. TASK-007: Attachment validation (Optional by Planning; validated only if requireAttachments is explicitly true)
    if (requireAttachments && (!Array.isArray(this.attachments) || this.attachments.length === 0)) {
      errors.attachments = '証跡を1件以上添付してください。';
    }

    this.errors = errors;
    this.detailErrors = detailErrors;
    this.attachmentErrors = attachmentErrors;
    return Object.keys(errors).length === 0 && Object.keys(detailErrors).length === 0 && Object.keys(attachmentErrors).length === 0;
  }

  /**
   * Get draft DTO payload.
   * Demonstrates true 1:N structure, independent counts, and snapshot retention.
   */
  getDraftPayload() {
    const details = this.errorDetails.map(d => ({
      category: d.category,
      materialCode: d.materialCode,
      materialName: d.materialName,
      causeDetail: d.causeDetail
    }));

    return {
      clientSubmissionId: this.clientSubmissionId,
      inputStartAt: this.inputStartAt,
      loadingDate: this.loadingDate,
      employeeCode: this.currentEmployee?.empNo || '',
      employeeName: this.currentEmployee?.empName || '',
      historicalBaseCode: this.currentEmployee?.baseCode || '',
      historicalBaseName: this.currentEmployee?.baseName || '',
      historicalAreaName: this.currentEmployee?.areaName || '',
      historicalAreaCode: undefined, // per AREA_CODE_NOT_AVAILABLE
      equipmentTypeCount: this.totalMaterialTypeCount,
      hasLooseItems: this.hasLooseItems,
      // TASK-005: Lift Operator & Auto-derived Partner
      liftOperatorCode: this.selectedLiftOperator?.liftOperatorCode || '',
      liftOperatorName: this.selectedLiftOperator?.liftOperatorName || '',
      partnerCode: this.selectedLiftOperator?.partnerCode || '',
      partnerName: this.selectedLiftOperator?.partnerName || '',
      // Optional Base-dependent fields
      looseItemCreatorName: this.hasLooseItems ? (this.looseItemCreatorName ? String(this.looseItemCreatorName).trim() : null) : null,
      looseItemStatus: this.hasLooseItems ? (this.looseItemStatus ? String(this.looseItemStatus).trim() : null) : null,
      transportCategory: this.transportCategory || '未指定',
      carrierName: this.carrierName || '',
      driverName: this.driverName || '',
      // TASK-006: 1:N ShippingErrorDetail (supporting both errorDetails and shippingErrorDetails)
      errorDetails: details,
      shippingErrorDetails: details,
      // TASK-007: 0..N AttachmentMetadata draft collection (single canonical collection, no binary/Base64 persistence)
      attachments: this.attachments.map(a => ({
        clientAttachmentId: a.clientAttachmentId,
        attachmentType: a.attachmentType,
        originalFilename: a.originalFilename,
        originalFileName: a.originalFileName,
        storageLocation: a.storageLocation,
        storageReference: a.storageLocation,
        fileSize: a.fileSize,
        mimeType: a.mimeType,
        createdAt: a.createdAt
      }))
    };
  }
}

if (typeof window !== 'undefined') {
  window.ShipmentCheckFormState = ShipmentCheckFormState;
  window.CANONICAL_CATEGORIES = CANONICAL_CATEGORIES;
  window.STORAGE_KEY_LAST_EMP_NO = STORAGE_KEY_LAST_EMP_NO;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ShipmentCheckFormState, CANONICAL_CATEGORIES, STORAGE_KEY_LAST_EMP_NO };
}
