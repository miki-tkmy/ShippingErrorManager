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

const ATTACHMENT_LIMITS = Object.freeze({
  MAX_COUNT: 10,
  MAX_PHOTO_BYTES: 5 * 1024 * 1024,
  MAX_RAW_PHOTO_BYTES: 20 * 1024 * 1024,
  MAX_PDF_BYTES: 10 * 1024 * 1024,
  MAX_TOTAL_BYTES: 20 * 1024 * 1024,
  ALLOWED_PHOTO_MIMES: Object.freeze(['image/jpeg', 'image/png', 'image/webp']),
  ALLOWED_PDF_MIMES: Object.freeze(['application/pdf'])
});

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

    // 5. Base-dependent optional fields (Multi-select LooseItemCreators + backward-compatible fields)
    this.selectedLooseItemCreators = []; // Array of { looseItemCreatorCode, looseItemCreatorName, baseCode, partnerCode, partnerName }
    this.selectedLooseItemCreator = null; // First item for backward compatibility
    this.looseItemCreatorName = '';
    this.looseItemStatus = ''; // TASK-004A: flexible free-text
    this.transportCategory = '未指定';
    this.carrierName = '';
    this.driverName = '';

    // Guidance confirmation before completion (mandatory on complete/update, optional on draft)
    this.guidanceConfirmed = false;

    // Collaborative draft / co-editing lifecycle state
    this.editingMode = 'NEW'; // 'NEW' | 'DRAFT' | 'EDIT_COMPLETED'
    this.draftId = null;
    this.editingShippingCheckId = null;
    this.expectedRevision = null;
    this.originalReviewStatus = '未確認';
    this.recordMetadata = null;

    // Explicit interaction tracking so drafts distinguish unset (null) from explicit (false, 0, '未指定', '')
    this.explicitFlags = {
      loadingDate: false,
      equipmentTypeCount: false,
      hasLooseItems: false,
      looseItemStatus: false,
      transportCategory: false
    };

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

  generateTimestamp(dateInput) {
    const now = (dateInput instanceof Date && !isNaN(dateInput.getTime())) ? dateInput : new Date();
    const pad = (n) => String(n).padStart(2, '0');
    try {
      if (typeof Intl !== 'undefined' && typeof Intl.DateTimeFormat === 'function') {
        const parts = new Intl.DateTimeFormat('en-CA', {
          timeZone: 'Asia/Tokyo',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hourCycle: 'h23'
        }).formatToParts(now);
        const map = {};
        for (const p of parts) {
          map[p.type] = p.value;
        }
        if (map.year && map.month && map.day && map.hour && map.minute && map.second) {
          return `${map.year}-${map.month}-${map.day}T${map.hour}:${map.minute}:${map.second}`;
        }
      }
    } catch (e) {}
    const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    return `${jst.getUTCFullYear()}-${pad(jst.getUTCMonth() + 1)}-${pad(jst.getUTCDate())}T${pad(jst.getUTCHours())}:${pad(jst.getUTCMinutes())}:${pad(jst.getUTCSeconds())}`;
  }

  generateTokyoDate(dateInput) {
    const now = (dateInput instanceof Date && !isNaN(dateInput.getTime())) ? dateInput : new Date();
    const pad = (n) => String(n).padStart(2, '0');
    try {
      if (typeof Intl !== 'undefined' && typeof Intl.DateTimeFormat === 'function') {
        const parts = new Intl.DateTimeFormat('en-CA', {
          timeZone: 'Asia/Tokyo',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit'
        }).formatToParts(now);
        const map = {};
        for (const p of parts) {
          map[p.type] = p.value;
        }
        if (map.year && map.month && map.day) {
          return `${map.year}-${map.month}-${map.day}`;
        }
      }
    } catch (e) {}
    const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    return `${jst.getUTCFullYear()}-${pad(jst.getUTCMonth() + 1)}-${pad(jst.getUTCDate())}`;
  }

  generateLocalDate(dateInput) {
    return this.generateTokyoDate(dateInput);
  }

  normalizeLoadingDate(rawVal) {
    if (rawVal === null || rawVal === undefined) return '';
    if (rawVal instanceof Date) {
      return isNaN(rawVal.getTime()) ? '' : this.generateTokyoDate(rawVal);
    }
    const trimmed = String(rawVal).trim();
    if (!trimmed) return '';
    const ymdMatch = trimmed.match(/^(\d{4})[-/](\d{2})[-/](\d{2})$/);
    if (ymdMatch) {
      return `${ymdMatch[1]}-${ymdMatch[2]}-${ymdMatch[3]}`;
    }
    if (trimmed.includes('T') || trimmed.includes('Z')) {
      const parsed = new Date(trimmed);
      if (!isNaN(parsed.getTime())) {
        return this.generateTokyoDate(parsed);
      }
    }
    return trimmed;
  }

  setLoadingDate(dateStr, options = {}) {
    const trimmed = this.normalizeLoadingDate(dateStr);
    this.loadingDate = trimmed;
    if (options.explicit !== false) {
      this.explicitFlags.loadingDate = trimmed !== '';
    }
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
    const hasExplicitCat = initial.categoryExplicit === true ||
      (initial.category !== undefined && initial.category !== null && CANONICAL_CATEGORIES.includes(initial.category) && initial.categoryExplicit !== false && Object.prototype.hasOwnProperty.call(initial, 'category'));
    const cat = initial.category === null
      ? null
      : (CANONICAL_CATEGORIES.includes(initial.category) ? initial.category : CANONICAL_CATEGORIES[0]);
    return {
      clientDetailId: initial.clientDetailId || this.generateDetailId(),
      category: cat,
      categoryExplicit: Boolean(hasExplicitCat),
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

  buildErrorDetailsSummaryMessage(detailErrorsMap = this.detailErrors) {
    if (!detailErrorsMap || typeof detailErrorsMap !== 'object') {
      return '';
    }
    const perCardNotes = [];
    const details = Array.isArray(this.errorDetails) ? this.errorDetails : [];
    details.forEach((d, idx) => {
      const ce = detailErrorsMap[d.clientDetailId];
      if (!ce || typeof ce !== 'object') return;
      const missingFields = [];
      if (ce.category) missingFields.push('区分');
      if (ce.material) missingFields.push('資材');
      if (ce.causeDetail) missingFields.push('原因・詳細');
      if (missingFields.length > 0) {
        perCardNotes.push(`明細 #${idx + 1}（${missingFields.join('・')}）`);
      }
    });
    if (perCardNotes.length === 0) {
      return '';
    }
    return `未入力または不正な積み間違い資材があります：${perCardNotes.join('、')}を確認してください。`;
  }

  _syncDetailErrorsAfterFieldChange(clientDetailId) {
    if (clientDetailId && this.detailErrors && this.detailErrors[clientDetailId]) {
      if (Object.keys(this.detailErrors[clientDetailId]).length === 0) {
        delete this.detailErrors[clientDetailId];
      }
    }
    if (this.errors && this.errors.errorDetails) {
      const nextMsg = this.buildErrorDetailsSummaryMessage(this.detailErrors);
      if (nextMsg) {
        this.errors.errorDetails = nextMsg;
      } else {
        delete this.errors.errorDetails;
      }
    }
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
        this._syncDetailErrorsAfterFieldChange(clientDetailId);
      }
      return false;
    }
    this.errorDetails = this.errorDetails.filter(d => d.clientDetailId !== clientDetailId);
    delete this.detailErrors[clientDetailId];
    this._syncDetailErrorsAfterFieldChange(clientDetailId);
    return true;
  }

  /**
   * TASK-006: Update fields in an error detail card.
   */
  updateErrorDetail(clientDetailId, patch = {}) {
    const detail = this.errorDetails.find(d => d.clientDetailId === clientDetailId);
    if (!detail) return null;

    if (patch.category !== undefined) {
      if (patch.category === null) {
        detail.category = null;
        detail.categoryExplicit = false;
      } else if (CANONICAL_CATEGORIES.includes(patch.category)) {
        detail.category = patch.category;
        detail.categoryExplicit = patch.categoryExplicit !== undefined ? Boolean(patch.categoryExplicit) : true;
        if (this.detailErrors[clientDetailId]?.category) {
          delete this.detailErrors[clientDetailId].category;
        }
      }
    }
    if (patch.materialCode !== undefined) {
      detail.materialCode = String(patch.materialCode || '').trim();
      if (detail.materialCode && this.detailErrors[clientDetailId]?.material) {
        delete this.detailErrors[clientDetailId].material;
      }
    }
    if (patch.materialName !== undefined) {
      detail.materialName = String(patch.materialName || '').trim();
    }
    if (patch.causeDetail !== undefined) {
      detail.causeDetail = String(patch.causeDetail === null ? '' : patch.causeDetail);
      const trimmedCause = detail.causeDetail.trim();
      if (trimmedCause && trimmedCause.length <= 1000 && this.detailErrors[clientDetailId]?.causeDetail) {
        delete this.detailErrors[clientDetailId].causeDetail;
      }
    }
    this._syncDetailErrorsAfterFieldChange(clientDetailId);
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

    if (detail.materialCode && this.detailErrors[clientDetailId]?.material) {
      delete this.detailErrors[clientDetailId].material;
    }
    this._syncDetailErrorsAfterFieldChange(clientDetailId);
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

    // TASK-005: Incompatible Lift Operator & Loose Item Creator reset check on employee/Base switch
    if (previousBaseCode && previousBaseCode !== this.currentEmployee.baseCode) {
      if (this.selectedLiftOperator && this.selectedLiftOperator.baseCode !== this.currentEmployee.baseCode) {
        this.clearLiftOperator();
      }
      this.clearLooseItemCreator();
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
    this.clearLooseItemCreator();
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
    } else if (operator.partnerName && String(operator.partnerName).trim() !== '') {
      resolvedPartnerName = String(operator.partnerName).trim();
      resolutionState = 'resolved';
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

  _syncLooseItemCreatorCompatFields() {
    this.selectedLooseItemCreator = this.selectedLooseItemCreators.length > 0
      ? this.selectedLooseItemCreators[0]
      : null;
    this.looseItemCreatorName = this.selectedLooseItemCreators
      .map(c => c.looseItemCreatorName)
      .filter(Boolean)
      .join(', ');
  }

  /**
   * Searches Base LooseItemCreator candidates by name, creator code, or partner company name/code.
   */
  searchLooseItemCreators(candidates, query = '') {
    const safeList = Array.isArray(candidates) ? candidates : [];
    const normQuery = String(query || '').normalize('NFKC').trim().toLowerCase();
    const selectedKeys = new Set(
      this.selectedLooseItemCreators.map(c =>
        c.looseItemCreatorCode ? `CODE:${c.looseItemCreatorCode}` : `NAME:${c.looseItemCreatorName}`
      )
    );

    return safeList
      .filter(c => {
        if (!c || !c.looseItemCreatorName) return false;
        if (!normQuery) return true;
        const haystacks = [
          c.looseItemCreatorName,
          c.looseItemCreatorCode,
          c.partnerName,
          c.partnerCode
        ];
        return haystacks.some(h => String(h || '').normalize('NFKC').toLowerCase().includes(normQuery));
      })
      .map(c => {
        const cleanCode = String(c.looseItemCreatorCode || '').trim();
        const cleanName = String(c.looseItemCreatorName || '').trim();
        const key = cleanCode ? `CODE:${cleanCode}` : `NAME:${cleanName}`;
        return Object.assign({}, c, {
          isSelected: selectedKeys.has(key)
        });
      });
  }

  /**
   * Adds a LooseItemCreator to the multi-select list while preventing duplicate selection.
   */
  addLooseItemCreator(creator) {
    if (!creator) return false;
    const cleanCode = String(creator.looseItemCreatorCode || '').trim();
    const cleanName = String(creator.looseItemCreatorName || '').trim();
    const cleanBase = String(creator.baseCode || '').trim();
    const cleanPartnerCode = String(creator.partnerCode || '').trim();
    const cleanPartnerName = String(creator.partnerName || '').trim();
    if (!cleanName) return false;

    const normTargetName = cleanName.normalize('NFKC').replace(/\s+/g, ' ').trim();
    const isDup = this.selectedLooseItemCreators.some(existing => {
      if (cleanCode && existing.looseItemCreatorCode) {
        return existing.looseItemCreatorCode === cleanCode;
      }
      const exName = String(existing.looseItemCreatorName || '').normalize('NFKC').replace(/\s+/g, ' ').trim();
      return exName === normTargetName;
    });
    if (isDup) {
      return false;
    }

    this.selectedLooseItemCreators.push({
      looseItemCreatorCode: cleanCode,
      looseItemCreatorName: cleanName,
      baseCode: cleanBase,
      partnerCode: cleanPartnerCode,
      partnerName: cleanPartnerName
    });
    this._syncLooseItemCreatorCompatFields();
    return true;
  }

  removeLooseItemCreator(codeOrName) {
    const target = String(codeOrName || '').trim();
    if (!target) return false;
    const beforeLen = this.selectedLooseItemCreators.length;
    this.selectedLooseItemCreators = this.selectedLooseItemCreators.filter(c => {
      if (c.looseItemCreatorCode && c.looseItemCreatorCode === target) return false;
      if (c.looseItemCreatorName === target) return false;
      return true;
    });
    this._syncLooseItemCreatorCompatFields();
    return this.selectedLooseItemCreators.length < beforeLen;
  }

  setLooseItemCreators(creatorsList) {
    this.selectedLooseItemCreators = [];
    if (Array.isArray(creatorsList)) {
      for (const item of creatorsList) {
        if (typeof item === 'string') {
          this.addLooseItemCreator({ looseItemCreatorName: item });
        } else {
          this.addLooseItemCreator(item);
        }
      }
    }
    this._syncLooseItemCreatorCompatFields();
  }

  selectLooseItemCreator(creator) {
    if (!creator) {
      this.clearLooseItemCreator();
      return;
    }
    this.selectedLooseItemCreators = [];
    this.addLooseItemCreator(creator);
  }

  clearLooseItemCreator() {
    this.selectedLooseItemCreators = [];
    this.selectedLooseItemCreator = null;
    this.looseItemCreatorName = '';
  }

  setGuidanceConfirmed(checked) {
    this.guidanceConfirmed = Boolean(checked);
    if (this.guidanceConfirmed) {
      delete this.errors.guidanceConfirmed;
    }
  }

  setShowAllDrivers(val) {
    this.showAllDrivers = Boolean(val);
  }

  setTotalMaterialTypeCount(val, options = {}) {
    if (options.allowDraftEmpty && (val === null || val === undefined || val === '')) {
      this.totalMaterialTypeCount = null;
      this.explicitFlags.equipmentTypeCount = false;
      delete this.errors.totalMaterialTypeCount;
      return;
    }
    const parsed = Number(val);
    this.totalMaterialTypeCount = parsed;
    if (options.explicit !== false) {
      this.explicitFlags.equipmentTypeCount = true;
    }
    if (options.allowDraftZero && Number.isInteger(parsed) && parsed === 0) {
      delete this.errors.totalMaterialTypeCount;
      return;
    }
    if (!Number.isInteger(parsed) || parsed < 1) {
      this.errors.totalMaterialTypeCount = '機材種総数は1以上の整数を入力してください。';
    } else {
      delete this.errors.totalMaterialTypeCount;
    }
  }

  setHasLooseItems(hasItems, options = {}) {
    if (options.allowUnset && (hasItems === null || hasItems === undefined)) {
      this.hasLooseItems = null;
      this.explicitFlags.hasLooseItems = false;
      return;
    }
    this.hasLooseItems = Boolean(hasItems);
    if (options.explicit !== false) {
      this.explicitFlags.hasLooseItems = true;
    }
  }

  setLooseItemStatus(val, options = {}) {
    this.looseItemStatus = val === null || val === undefined ? '' : String(val);
    if (options.explicit !== false) {
      this.explicitFlags.looseItemStatus = true;
    }
  }

  setTransportCategory(val, options = {}) {
    if (options.allowUnset && (val === null || val === undefined || val === '')) {
      this.transportCategory = null;
      this.explicitFlags.transportCategory = false;
      return;
    }
    this.transportCategory = String(val || '未指定');
    if (options.explicit !== false) {
      this.explicitFlags.transportCategory = true;
    }
  }

  // =========================================================================
  // TASK-007: AttachmentMetadata (0..N evidence items)
  // =========================================================================

  generateAttachmentId(prefix = 'att') {
    this.attachmentCounter += 1;
    return prefix + '_' + Date.now() + '_' + this.attachmentCounter;
  }

  getTotalAttachmentBytes() {
    if (!Array.isArray(this.attachments)) return 0;
    return this.attachments.reduce((sum, item) => sum + (Number(item && item.fileSize) || 0), 0);
  }

  /**
   * Restores an already-persisted server attachment (from ShipmentDraft or ShipmentCheck)
   * without requiring local File bytes or Drive re-upload.
   */
  addPersistedAttachment(attMeta) {
    if (!attMeta || !attMeta.attachmentId) {
      return null;
    }
    const attId = String(attMeta.attachmentId).trim();
    const rawType = String(attMeta.attachmentType || '').trim().toLowerCase();
    const isPdf = rawType === 'pdf';
    const cleanName = String(attMeta.originalFilename || attMeta.originalFileName || (isPdf ? 'document.pdf' : 'photo.jpg')).trim();
    const item = {
      clientAttachmentId: 'persisted_' + attId,
      attachmentId: attId,
      persisted: true,
      shippingCheckId: String(attMeta.shippingCheckId || '').trim(),
      attachmentType: isPdf ? 'pdf' : 'photo',
      originalFilename: cleanName,
      originalFileName: cleanName,
      mimeType: String(attMeta.mimeType || (isPdf ? 'application/pdf' : 'image/jpeg')).trim(),
      fileSize: Number(attMeta.fileSize) || 0,
      localPreviewUrl: '',
      fileObject: null,
      wasCompressed: false,
      uploadState: 'persisted',
      uploadError: '',
      stagedUpload: null,
      createdAt: String(attMeta.createdAt || '')
    };
    this.attachments.push(item);
    return item;
  }

  _isDuplicateAttachmentCandidate(attachmentType, cleanName, size, mimeType, fileObj) {
    const normName = String(cleanName || '').trim();
    const normMime = String(mimeType || '').trim().toLowerCase();
    const numSize = Number(size) || 0;

    return this.attachments.some(existing => {
      if (!existing) return false;
      if (fileObj && existing.fileObject && existing.fileObject === fileObj) {
        return true;
      }
      const sameMeta =
        existing.attachmentType === attachmentType &&
        String(existing.originalFilename || '').trim() === normName &&
        Number(existing.fileSize) === numSize &&
        String(existing.mimeType || '').trim().toLowerCase() === normMime;
      if (!sameMeta) return false;
      if (
        fileObj &&
        typeof fileObj.lastModified === 'number' &&
        existing.fileObject &&
        typeof existing.fileObject.lastModified === 'number'
      ) {
        return fileObj.lastModified === existing.fileObject.lastModified;
      }
      return true;
    });
  }

  /**
   * Add photo attachment draft (Google Drive upload workflow).
   * Accepts browser File / compressed Blob (JPEG, PNG, WebP up to 5MB).
   */
  addPhotoAttachment(file, metaOverrides = {}) {
    if (!file) {
      throw new Error('画像ファイルが指定されていません。');
    }

    if (this.attachments.length >= ATTACHMENT_LIMITS.MAX_COUNT) {
      throw new Error(`添付ファイルは最大${ATTACHMENT_LIMITS.MAX_COUNT}件までです。`);
    }

    const size = typeof file.size === 'number' ? file.size : 0;
    if (size <= 0) {
      throw new Error('0バイトの画像ファイルは添付できません。');
    }

    const rawMime = String(metaOverrides.mimeType || file.type || '').trim().toLowerCase();
    const rawName = String(metaOverrides.originalFilename || file.name || ('photo_' + Date.now() + '.jpg')).trim();
    let normalizedMime = rawMime;
    if (!normalizedMime) {
      if (/\.(jpe?g)$/i.test(rawName)) normalizedMime = 'image/jpeg';
      else if (/\.png$/i.test(rawName)) normalizedMime = 'image/png';
      else if (/\.webp$/i.test(rawName)) normalizedMime = 'image/webp';
    }

    if (!ATTACHMENT_LIMITS.ALLOWED_PHOTO_MIMES.includes(normalizedMime)) {
      throw new Error('写真は JPEG・PNG・WebP 形式のみ添付できます。');
    }

    if (size > ATTACHMENT_LIMITS.MAX_PHOTO_BYTES) {
      throw new Error('写真1件あたりのサイズは5MB以下にしてください。');
    }

    const cleanName = String(rawName.split(/[\/\\]/).pop() || rawName).trim();
    if (this._isDuplicateAttachmentCandidate('photo', cleanName, size, normalizedMime, file)) {
      throw new Error(`同じ写真ファイル（「${cleanName}」）が既に添付されています。`);
    }

    if (this.getTotalAttachmentBytes() + size > ATTACHMENT_LIMITS.MAX_TOTAL_BYTES) {
      throw new Error('添付ファイルの合計サイズは20MB以下にしてください。');
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

    const createdAt = this.generateTimestamp();

    const attachment = {
      clientAttachmentId,
      persisted: false,
      attachmentType: 'photo',
      originalFilename: cleanName,
      originalFileName: cleanName,
      mimeType: normalizedMime,
      fileSize: size,
      localPreviewUrl,
      fileObject: file,
      wasCompressed: Boolean(metaOverrides.wasCompressed),
      uploadState: 'pending',
      uploadError: '',
      stagedUpload: null,
      createdAt
    };

    this.attachments.push(attachment);
    delete this.attachmentErrors[clientAttachmentId];
    return attachment;
  }

  /**
   * Add PDF file attachment draft (Google Drive direct upload workflow).
   * Replaces abolished shared-folder path / external PDF link registration.
   */
  addPdfAttachment(file) {
    if (!file) {
      throw new Error('PDFファイルが指定されていません。');
    }

    if (this.attachments.length >= ATTACHMENT_LIMITS.MAX_COUNT) {
      throw new Error(`添付ファイルは最大${ATTACHMENT_LIMITS.MAX_COUNT}件までです。`);
    }

    const size = typeof file.size === 'number' ? file.size : 0;
    if (size <= 0) {
      throw new Error('0バイトのPDFファイルは添付できません。');
    }

    const rawName = String(file.name || ('document_' + Date.now() + '.pdf')).trim();
    const cleanName = String(rawName.split(/[\/\\]/).pop() || rawName).trim();
    const rawMime = String(file.type || '').trim().toLowerCase();
    const hasPdfExtension = /\.pdf$/i.test(cleanName);

    if (rawMime !== 'application/pdf' && !(rawMime === '' && hasPdfExtension)) {
      throw new Error('PDFファイル（.pdf）を選択してください。');
    }

    if (size > ATTACHMENT_LIMITS.MAX_PDF_BYTES) {
      throw new Error('PDFファイル1件あたりのサイズは10MB以下にしてください。');
    }

    const finalName = hasPdfExtension ? cleanName : (cleanName + '.pdf');
    if (this._isDuplicateAttachmentCandidate('pdf', finalName, size, 'application/pdf', file)) {
      throw new Error(`同じPDFファイル（「${finalName}」）が既に添付されています。`);
    }

    if (this.getTotalAttachmentBytes() + size > ATTACHMENT_LIMITS.MAX_TOTAL_BYTES) {
      throw new Error('添付ファイルの合計サイズは20MB以下にしてください。');
    }

    const clientAttachmentId = this.generateAttachmentId('att_pdf');
    const createdAt = this.generateTimestamp();

    const attachment = {
      clientAttachmentId,
      persisted: false,
      attachmentType: 'pdf',
      originalFilename: finalName,
      originalFileName: finalName,
      mimeType: 'application/pdf',
      fileSize: size,
      localPreviewUrl: '',
      fileObject: file,
      wasCompressed: false,
      uploadState: 'pending',
      uploadError: '',
      stagedUpload: null,
      createdAt
    };

    this.attachments.push(attachment);
    delete this.attachmentErrors[clientAttachmentId];
    return attachment;
  }

  markAttachmentUploading(clientAttachmentId) {
    const item = this.attachments.find(a => a.clientAttachmentId === clientAttachmentId);
    if (!item) return null;
    item.uploadState = 'uploading';
    item.uploadError = '';
    return item;
  }

  markAttachmentUploaded(clientAttachmentId, stagedInfo) {
    const item = this.attachments.find(a => a.clientAttachmentId === clientAttachmentId);
    if (!item || !stagedInfo) return null;
    item.uploadState = 'uploaded';
    item.uploadError = '';
    item.stagedUpload = {
      driveFileId: String(stagedInfo.driveFileId || '').trim(),
      uploadSignature: String(stagedInfo.uploadSignature || '').trim(),
      originalFilename: String(stagedInfo.originalFilename || item.originalFilename).trim(),
      mimeType: String(stagedInfo.mimeType || item.mimeType).trim(),
      fileSize: Number(stagedInfo.fileSize || item.fileSize),
      clientSubmissionId: String(stagedInfo.clientSubmissionId || '').trim()
    };
    return item;
  }

  markAttachmentUploadError(clientAttachmentId, message) {
    const item = this.attachments.find(a => a.clientAttachmentId === clientAttachmentId);
    if (!item) return null;
    item.uploadState = 'error';
    item.uploadError = String(message || 'アップロードに失敗しました。');
    return item;
  }

  clearStagedUploads() {
    for (const att of this.attachments) {
      if (att.persisted === true) continue;
      att.stagedUpload = null;
      if (att.uploadState === 'uploaded' || att.uploadState === 'uploading') {
        att.uploadState = 'pending';
      }
    }
  }

  /**
   * Remove an attachment from the draft collection before submission.
   * Safely revokes local object preview URL and returns the removed item (or false if absent).
   */
  removeAttachment(clientAttachmentId) {
    const index = this.attachments.findIndex(a =>
      a.clientAttachmentId === clientAttachmentId || (a.attachmentId && a.attachmentId === clientAttachmentId)
    );
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
    return item;
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
    this.selectedLooseItemCreators = [];
    this.selectedLooseItemCreator = null;
    this.looseItemCreatorName = '';
    this.looseItemStatus = '';
    this.transportCategory = '未指定';
    this.carrierName = '';
    this.driverName = '';
    this.guidanceConfirmed = false;

    this.editingMode = 'NEW';
    this.draftId = null;
    this.editingShippingCheckId = null;
    this.expectedRevision = null;
    this.originalReviewStatus = '未確認';
    this.recordMetadata = null;

    this.explicitFlags = {
      loadingDate: false,
      equipmentTypeCount: false,
      hasLooseItems: false,
      looseItemStatus: false,
      transportCategory: false
    };

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
    const {
      requireLiftOperator = false,
      requireErrorDetails = false,
      requireAttachments = false,
      requireGuidanceConfirmed = false
    } = options;
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

    // 2b. Loose items boolean must be decided for completion
    if (typeof this.hasLooseItems !== 'boolean') {
      errors.hasLooseItems = 'バラ積み有無を選択してください。';
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
          } else if (d.causeDetail.trim().length > 1000) {
            cardErrors.causeDetail = '原因・詳細は1000文字以内で入力してください。';
          }
          if (Object.keys(cardErrors).length > 0) {
            detailErrors[d.clientDetailId] = cardErrors;
          }
        }
        if (Object.keys(detailErrors).length > 0) {
          errors.errorDetails = this.buildErrorDetailsSummaryMessage(detailErrors) ||
            '未入力または不正な積み間違い資材があります。各カードの入力内容をご確認ください。';
        }
      }
    }

    // 5. TASK-007: Attachment validation (Optional by Planning; validated only if requireAttachments is explicitly true)
    if (requireAttachments && (!Array.isArray(this.attachments) || this.attachments.length === 0)) {
      errors.attachments = '証跡を1件以上添付してください。';
    }

    // 6. Guidance Confirmation (mandatory on completion / completed edit)
    if (requireGuidanceConfirmed && this.guidanceConfirmed !== true) {
      errors.guidanceConfirmed = '完了登録には「対象者への指導を実施しました」の確認チェックが必須です。';
    }

    this.errors = errors;
    this.detailErrors = detailErrors;
    this.attachmentErrors = attachmentErrors;
    return Object.keys(errors).length === 0 && Object.keys(detailErrors).length === 0 && Object.keys(attachmentErrors).length === 0;
  }

  _serializeAttachmentItems() {
    return this.attachments.map(a => {
      if (a.persisted === true && a.attachmentId) {
        return {
          persisted: true,
          attachmentId: a.attachmentId,
          clientAttachmentId: a.clientAttachmentId,
          attachmentType: a.attachmentType,
          originalFilename: a.originalFilename,
          originalFileName: a.originalFilename,
          fileSize: a.fileSize,
          mimeType: a.mimeType,
          createdAt: a.createdAt
        };
      }
      const staged = a.stagedUpload || {};
      const fname = staged.originalFilename || a.originalFilename;
      return {
        persisted: false,
        clientAttachmentId: a.clientAttachmentId,
        attachmentType: a.attachmentType,
        originalFilename: fname,
        originalFileName: fname,
        driveFileId: staged.driveFileId || '',
        uploadSignature: staged.uploadSignature || '',
        fileSize: staged.fileSize || a.fileSize,
        mimeType: staged.mimeType || a.mimeType,
        createdAt: a.createdAt
      };
    });
  }

  /**
   * Builds server-persisted Draft payload (shipment.saveDraft) without requiring completion fields,
   * preserving exact unset (null) vs explicit (false, 0, '未指定', '') distinction.
   */
  getDraftSavePayload() {
    const touchedDetails = [];
    if (Array.isArray(this.errorDetails)) {
      for (const d of this.errorDetails) {
        const hasAnyInput = Boolean(d.categoryExplicit || d.materialCode || (d.causeDetail && d.causeDetail.trim()));
        if (hasAnyInput || this.errorDetails.length > 1) {
          touchedDetails.push({
            clientDetailId: d.clientDetailId,
            category: d.categoryExplicit ? d.category : null,
            categoryExplicit: Boolean(d.categoryExplicit),
            materialCode: d.materialCode || '',
            materialName: d.materialName || '',
            causeDetail: d.causeDetail || ''
          });
        }
      }
    }

    const effectiveHasLoose = this.explicitFlags.hasLooseItems
      ? (typeof this.hasLooseItems === 'boolean' ? this.hasLooseItems : null)
      : (this.selectedLooseItemCreators.length > 0 || (this.looseItemStatus && this.looseItemStatus.trim())
        ? true
        : null);

    const creatorsDto = effectiveHasLoose === false
      ? []
      : this.selectedLooseItemCreators.map(c => ({
          looseItemCreatorCode: c.looseItemCreatorCode || '',
          looseItemCreatorName: c.looseItemCreatorName || '',
          partnerCode: c.partnerCode || '',
          partnerName: c.partnerName || ''
        }));

    return {
      draftId: this.editingMode === 'DRAFT' ? this.draftId : null,
      expectedRevision: this.editingMode === 'DRAFT' ? this.expectedRevision : null,
      inputStartedAt: this.inputStartAt,
      loadingDate: (this.explicitFlags.loadingDate && this.loadingDate) ? this.loadingDate : null,
      loadingDateExplicit: Boolean(this.explicitFlags.loadingDate && this.loadingDate),
      liftOperatorCode: this.selectedLiftOperator?.liftOperatorCode || null,
      liftOperatorName: this.selectedLiftOperator?.liftOperatorName || null,
      showAllDrivers: Boolean(this.showAllDrivers),
      partnerCode: this.selectedLiftOperator?.partnerCode || null,
      partnerName: this.selectedLiftOperator?.partnerName || null,
      equipmentTypeCount: this.explicitFlags.equipmentTypeCount ? this.totalMaterialTypeCount : null,
      equipmentTypeCountExplicit: Boolean(this.explicitFlags.equipmentTypeCount),
      hasLooseItems: effectiveHasLoose,
      looseItemCreators: creatorsDto,
      looseItemCreatorName: creatorsDto.length > 0 ? creatorsDto.map(c => c.looseItemCreatorName).join(', ') : null,
      looseItemStatus: this.explicitFlags.looseItemStatus
        ? String(this.looseItemStatus || '').trim()
        : (this.looseItemStatus && this.looseItemStatus.trim() ? this.looseItemStatus.trim() : null),
      looseItemStatusExplicit: Boolean(this.explicitFlags.looseItemStatus),
      transportCategory: this.explicitFlags.transportCategory ? (this.transportCategory || '未指定') : null,
      transportCategoryExplicit: Boolean(this.explicitFlags.transportCategory),
      carrierName: this.carrierName && this.carrierName.trim() ? this.carrierName.trim() : null,
      driverName: this.driverName && this.driverName.trim() ? this.driverName.trim() : null,
      errorDetails: touchedDetails,
      attachments: this._serializeAttachmentItems(),
      guidanceConfirmed: Boolean(this.guidanceConfirmed)
    };
  }

  /**
   * Builds completion / completed-update DTO payload (shipment.complete / shipment.update / legacy shipment.create).
   */
  getDraftPayload() {
    const details = this.errorDetails.map(d => ({
      category: d.category || CANONICAL_CATEGORIES[0],
      materialCode: d.materialCode,
      materialName: d.materialName,
      causeDetail: String(d.causeDetail || '').trim()
    }));

    const creatorsDto = this.hasLooseItems
      ? this.selectedLooseItemCreators.map(c => ({
          looseItemCreatorCode: c.looseItemCreatorCode || '',
          looseItemCreatorName: c.looseItemCreatorName || '',
          partnerCode: c.partnerCode || '',
          partnerName: c.partnerName || ''
        }))
      : [];

    const summaryCreatorName = this.hasLooseItems
      ? (creatorsDto.length > 0
        ? creatorsDto.map(c => c.looseItemCreatorName).join(', ')
        : (this.looseItemCreatorName ? String(this.looseItemCreatorName).trim() : null))
      : null;

    const out = {
      clientSubmissionId: this.clientSubmissionId,
      inputStartAt: this.inputStartAt,
      inputStartedAt: this.inputStartAt,
      loadingDate: this.loadingDate,
      employeeCode: this.currentEmployee?.empNo || '',
      employeeName: this.currentEmployee?.empName || '',
      historicalBaseCode: this.currentEmployee?.baseCode || '',
      historicalBaseName: this.currentEmployee?.baseName || '',
      historicalAreaName: this.currentEmployee?.areaName || '',
      historicalAreaCode: undefined, // per AREA_CODE_NOT_AVAILABLE
      equipmentTypeCount: this.totalMaterialTypeCount,
      hasLooseItems: Boolean(this.hasLooseItems),
      // TASK-005: Lift Operator & Auto-derived Partner
      liftOperatorCode: this.selectedLiftOperator?.liftOperatorCode || '',
      liftOperatorName: this.selectedLiftOperator?.liftOperatorName || '',
      partnerCode: this.selectedLiftOperator?.partnerCode || '',
      partnerName: this.selectedLiftOperator?.partnerName || '',
      // Multi-select LooseItemCreators + backward-compatible looseItemCreatorName
      looseItemCreators: creatorsDto,
      looseItemCreatorName: summaryCreatorName,
      looseItemStatus: this.hasLooseItems ? (this.looseItemStatus ? String(this.looseItemStatus).trim() : null) : null,
      transportCategory: this.transportCategory || '未指定',
      carrierName: this.carrierName || '',
      driverName: this.driverName || '',
      guidanceConfirmed: Boolean(this.guidanceConfirmed),
      // TASK-006: 1:N ShippingErrorDetail (supporting both errorDetails and shippingErrorDetails)
      errorDetails: details,
      shippingErrorDetails: details,
      // 0..N Google Drive AttachmentMetadata collection (supporting staged + persisted)
      attachments: this._serializeAttachmentItems()
    };

    if (this.editingMode === 'DRAFT' && this.draftId) {
      out.draftId = this.draftId;
      out.expectedRevision = this.expectedRevision;
    } else if (this.editingMode === 'EDIT_COMPLETED' && this.editingShippingCheckId) {
      out.expectedRevision = this.expectedRevision;
    }

    return out;
  }

  getCompletionPayload() {
    return this.getDraftPayload();
  }

  /**
   * Hydrates full form state from either a server ShipmentDraft aggregate (recordStatus === 'DRAFT')
   * or a completed ShipmentCheck aggregate (recordStatus === 'COMPLETED').
   */
  hydrateFromAggregate(agg, options = {}) {
    if (!agg || typeof agg !== 'object') return;
    const preserveUnpersisted = Boolean(options && options.preserveUnpersistedAttachments === true);
    const pendingLocalAttachments = preserveUnpersisted
      ? this.attachments.filter(a => a && a.persisted !== true && a.fileObject)
      : [];

    if (typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
      for (const att of this.attachments) {
        if (att && att.localPreviewUrl && !pendingLocalAttachments.includes(att)) {
          try {
            URL.revokeObjectURL(att.localPreviewUrl);
          } catch (e) {}
        }
      }
    }
    this.attachments = [];
    this.attachmentErrors = {};
    this.detailErrors = {};
    this.errors = {};

    const reappendPendingLocalAttachments = () => {
      for (const localAtt of pendingLocalAttachments) {
        localAtt.stagedUpload = null;
        localAtt.uploadState = 'pending';
        localAtt.uploadError = '';
        const isDup = this._isDuplicateAttachmentCandidate(
          localAtt.attachmentType,
          localAtt.originalFilename,
          localAtt.fileSize,
          localAtt.mimeType,
          localAtt.fileObject
        );
        const withinLimits =
          this.attachments.length < ATTACHMENT_LIMITS.MAX_COUNT &&
          (this.getTotalAttachmentBytes() + (Number(localAtt.fileSize) || 0)) <= ATTACHMENT_LIMITS.MAX_TOTAL_BYTES;
        if (!isDup && withinLimits) {
          this.attachments.push(localAtt);
        } else if (localAtt.localPreviewUrl && typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
          try { URL.revokeObjectURL(localAtt.localPreviewUrl); } catch (e) {}
        }
      }
    };

    if (agg.recordStatus === 'DRAFT') {
      const st = agg.draftState || {};
      this.editingMode = 'DRAFT';
      this.draftId = String(agg.draftId || agg.shippingCheckId || '').trim() || null;
      this.editingShippingCheckId = null;
      this.expectedRevision = Number(agg.revision) || 1;
      this.originalReviewStatus = '一時保存';
      this.recordMetadata = {
        createdByEmpNo: agg.createdByEmpNo || '',
        createdByName: agg.createdByName || '',
        createdAt: agg.createdAt || '',
        updatedByEmpNo: agg.updatedByEmpNo || '',
        updatedByName: agg.updatedByName || '',
        updatedAt: agg.updatedAt || ''
      };

      this.inputStartAt = st.inputStartedAt || agg.createdAt || this.generateTimestamp();

      const normDraftDate = this.normalizeLoadingDate(st.loadingDate);
      if (normDraftDate) {
        this.loadingDate = normDraftDate;
        this.explicitFlags.loadingDate = true;
      } else {
        this.loadingDate = '';
        this.explicitFlags.loadingDate = false;
      }

      if (st.liftOperatorCode) {
        this.selectedLiftOperator = {
          liftOperatorCode: String(st.liftOperatorCode).trim(),
          liftOperatorName: String(st.liftOperatorName || '').trim(),
          baseCode: String(agg.baseCode || this.currentEmployee?.baseCode || '').trim(),
          partnerCode: String(st.partnerCode || '').trim(),
          partnerName: String(st.partnerName || (st.partnerCode ? '' : '協力会社未設定')).trim(),
          isCrossBase: false
        };
        this.partnerResolutionState = st.partnerCode ? 'resolved' : 'unassigned';
      } else {
        this.clearLiftOperator();
      }
      this.showAllDrivers = Boolean(st.showAllDrivers);

      if (st.equipmentTypeCount !== null && st.equipmentTypeCount !== undefined && st.equipmentTypeCount !== '') {
        this.totalMaterialTypeCount = Number(st.equipmentTypeCount);
        this.explicitFlags.equipmentTypeCount = true;
      } else {
        this.totalMaterialTypeCount = null;
        this.explicitFlags.equipmentTypeCount = false;
      }

      if (typeof st.hasLooseItems === 'boolean') {
        this.hasLooseItems = st.hasLooseItems;
        this.explicitFlags.hasLooseItems = true;
      } else {
        this.hasLooseItems = null;
        this.explicitFlags.hasLooseItems = false;
      }

      this.setLooseItemCreators(Array.isArray(st.looseItemCreators) ? st.looseItemCreators : []);
      if (this.selectedLooseItemCreators.length === 0 && st.looseItemCreatorName) {
        this.setLooseItemCreators(String(st.looseItemCreatorName).split(/\s*,\s*/).filter(Boolean));
      }

      if (st.looseItemStatus !== null && st.looseItemStatus !== undefined) {
        this.looseItemStatus = String(st.looseItemStatus);
        this.explicitFlags.looseItemStatus = Boolean(st.looseItemStatusExplicit || st.looseItemStatus !== '');
      } else {
        this.looseItemStatus = '';
        this.explicitFlags.looseItemStatus = false;
      }

      if (st.transportCategory !== null && st.transportCategory !== undefined && String(st.transportCategory).trim() !== '') {
        this.transportCategory = String(st.transportCategory).trim();
        this.explicitFlags.transportCategory = true;
      } else {
        this.transportCategory = null;
        this.explicitFlags.transportCategory = false;
      }

      this.carrierName = st.carrierName ? String(st.carrierName) : '';
      this.driverName = st.driverName ? String(st.driverName) : '';
      this.guidanceConfirmed = Boolean(st.guidanceConfirmed);

      const rawDraftDetails = Array.isArray(st.errorDetails) ? st.errorDetails : [];
      if (rawDraftDetails.length > 0) {
        this.errorDetails = rawDraftDetails.map(d => this.createEmptyErrorDetail({
          clientDetailId: d.clientDetailId,
          category: d.category !== undefined ? d.category : null,
          categoryExplicit: Boolean(d.categoryExplicit || d.category),
          materialCode: d.materialCode || '',
          materialName: d.materialName || '',
          causeDetail: d.causeDetail || ''
        }));
      } else {
        this.errorDetails = [this.createEmptyErrorDetail({ category: null, categoryExplicit: false })];
      }

      const draftAtts = Array.isArray(agg.attachments)
        ? agg.attachments
        : (Array.isArray(st.attachments) ? st.attachments : []);
      for (const att of draftAtts) {
        this.addPersistedAttachment(Object.assign({}, att, { shippingCheckId: this.draftId }));
      }
      reappendPendingLocalAttachments();
      return;
    }

    // Completed ShipmentCheck hydration
    const parent = agg.shipmentCheck || agg;
    const checkId = String(parent.shippingCheckId || agg.shippingCheckId || '').trim();
    const gov = agg.governance || {};

    this.editingMode = 'EDIT_COMPLETED';
    this.draftId = null;
    this.editingShippingCheckId = checkId;
    this.expectedRevision = Number(agg.revision || gov.revision) || 1;
    this.originalReviewStatus = String(parent.reviewStatus || '未確認').trim();
    this.recordMetadata = {
      createdByEmpNo: agg.createdByEmpNo || gov.createdByEmpNo || parent.employeeCode || '',
      createdByName: agg.createdByName || gov.createdByName || parent.employeeName || '',
      createdAt: agg.createdAt || gov.createdAt || parent.registeredAt || '',
      updatedByEmpNo: agg.updatedByEmpNo || gov.updatedByEmpNo || parent.employeeCode || '',
      updatedByName: agg.updatedByName || gov.updatedByName || parent.employeeName || '',
      updatedAt: agg.updatedAt || gov.updatedAt || parent.registeredAt || ''
    };

    this.inputStartAt = parent.inputStartedAt || parent.inputStartAt || this.generateTimestamp();
    this.loadingDate = this.normalizeLoadingDate(parent.loadingDate);
    this.explicitFlags.loadingDate = Boolean(this.loadingDate);

    if (parent.liftOperatorCode) {
      this.selectedLiftOperator = {
        liftOperatorCode: String(parent.liftOperatorCode).trim(),
        liftOperatorName: String(parent.liftOperatorName || '').trim(),
        baseCode: String(parent.historicalBaseCode || this.currentEmployee?.baseCode || '').trim(),
        partnerCode: String(parent.partnerCode || '').trim(),
        partnerName: String(parent.partnerName || (parent.partnerCode ? '' : '協力会社未設定')).trim(),
        isCrossBase: false
      };
      this.partnerResolutionState = parent.partnerCode ? 'resolved' : 'unassigned';
    } else {
      this.clearLiftOperator();
    }

    this.totalMaterialTypeCount = Number(parent.equipmentTypeCount) || 1;
    this.explicitFlags.equipmentTypeCount = true;

    this.hasLooseItems = Boolean(parent.hasLooseItems);
    this.explicitFlags.hasLooseItems = true;

    const creatorList = Array.isArray(agg.looseItemCreators) ? agg.looseItemCreators : [];
    if (creatorList.length > 0) {
      this.setLooseItemCreators(creatorList);
    } else if (parent.hasLooseItems && parent.looseItemCreatorName) {
      this.setLooseItemCreators(String(parent.looseItemCreatorName).split(/\s*,\s*/).filter(Boolean));
    } else {
      this.clearLooseItemCreator();
    }

    this.looseItemStatus = parent.looseItemStatus ? String(parent.looseItemStatus) : '';
    this.explicitFlags.looseItemStatus = true;

    this.transportCategory = parent.transportCategory || '未指定';
    this.explicitFlags.transportCategory = true;
    this.carrierName = parent.carrierName ? String(parent.carrierName) : '';
    this.driverName = parent.driverName ? String(parent.driverName) : '';

    this.guidanceConfirmed = Boolean(gov.guidanceConfirmed);

    const compDetails = Array.isArray(agg.details) ? agg.details : (Array.isArray(parent.errorDetails) ? parent.errorDetails : []);
    if (compDetails.length > 0) {
      this.errorDetails = compDetails.map((d, idx) => this.createEmptyErrorDetail({
        clientDetailId: d.detailId || `completed_det_${idx + 1}`,
        category: d.category,
        categoryExplicit: true,
        materialCode: d.materialCode || '',
        materialName: d.materialName || '',
        causeDetail: d.causeDetail || ''
      }));
    } else {
      this.errorDetails = [this.createEmptyErrorDetail()];
    }

    const compAtts = Array.isArray(agg.attachments) ? agg.attachments : [];
    for (const att of compAtts) {
      this.addPersistedAttachment(Object.assign({}, att, { shippingCheckId: checkId }));
    }
    reappendPendingLocalAttachments();
  }
}

if (typeof window !== 'undefined') {
  window.ShipmentCheckFormState = ShipmentCheckFormState;
  window.CANONICAL_CATEGORIES = CANONICAL_CATEGORIES;
  window.ATTACHMENT_LIMITS = ATTACHMENT_LIMITS;
  window.STORAGE_KEY_LAST_EMP_NO = STORAGE_KEY_LAST_EMP_NO;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ShipmentCheckFormState, CANONICAL_CATEGORIES, ATTACHMENT_LIMITS, STORAGE_KEY_LAST_EMP_NO };
}
