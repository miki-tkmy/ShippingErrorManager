/**
 * ShippingErrorManager - App UI Controller for TASK-004
 */
document.addEventListener('DOMContentLoaded', async () => {
  // Initialize shared RPC transport and clients (UI-REVIEW-003-R2.1: Fail-Closed)
  let defaultTransport = null;
  let transportError = null;
  try {
    if (typeof TransportAdapters !== 'undefined' && typeof TransportAdapters.resolveDefaultTransport === 'function') {
      defaultTransport = TransportAdapters.resolveDefaultTransport();
    }
  } catch (tErr) {
    console.error('Transport initialization failed (Fail-Closed):', tErr);
    defaultTransport = null;
    transportError = tErr;
  }

  // Resolve RpcClient constructor or factory safely across browser (window.ShippingRpcClient) and Node environments
  const RpcClientClass = (typeof RpcClient !== 'undefined')
    ? RpcClient
    : ((typeof ShippingRpcClient !== 'undefined' && ShippingRpcClient.RpcClient) ? ShippingRpcClient.RpcClient : null);

  let rpcClient = window.shippingRpcClient || null;
  if (!rpcClient && defaultTransport) {
    if (RpcClientClass) {
      rpcClient = new RpcClientClass({ transport: defaultTransport });
    } else if (typeof ShippingRpcClient !== 'undefined' && typeof ShippingRpcClient.createRpcClient === 'function') {
      rpcClient = ShippingRpcClient.createRpcClient({ transport: defaultTransport });
    }
  }
  window.shippingRpcClient = rpcClient;

  // Initialize AuthClient (BROWSER_INTEGRATION_PHASE_1)
  let authClient = window.shippingAuthClient || null;
  if (!authClient && rpcClient && typeof AuthClient !== 'undefined' && typeof AuthClient.createAuthClient === 'function') {
    try {
      authClient = AuthClient.createAuthClient(rpcClient);
    } catch (aErr) {
      console.error('AuthClient initialization failed:', aErr);
      authClient = null;
    }
  }
  window.shippingAuthClient = authClient;

  let shipmentClient = window.shippingClient || null;
  if (!shipmentClient && rpcClient) {
    try {
      if (typeof ShippingShipmentClient !== 'undefined' && typeof ShippingShipmentClient.createShipmentClient === 'function') {
        shipmentClient = ShippingShipmentClient.createShipmentClient({ rpcClient });
      } else if (typeof ShipmentClient !== 'undefined') {
        shipmentClient = new ShipmentClient({ rpcClient });
      }
    } catch (scErr) {
      console.error('ShipmentClient initialization failed:', scErr);
      shipmentClient = null;
    }
  }
  window.shippingClient = shipmentClient;
  window.shipmentClient = shipmentClient;

  const masterClient = window.masterClient || new MasterApiClient();
  window.masterClient = masterClient;
  window.MasterClient = masterClient;
  const formState = new ShipmentCheckFormState(masterClient);

  // Authentication State & DOM Elements (BROWSER_INTEGRATION_PHASE_1)
  let currentAccessContext = null;
  const loginModal = document.getElementById('loginModal');
  const loginForm = document.getElementById('loginForm');
  const txtLoginEmpNo = document.getElementById('txtLoginEmpNo');
  const txtLoginPassword = document.getElementById('txtLoginPassword');
  const loginMessage = document.getElementById('loginMessage');
  const btnLoginSubmit = document.getElementById('btnLoginSubmit');
  const headerAuthBadge = document.getElementById('headerAuthBadge');
  const headerUserName = document.getElementById('headerUserName');
  const btnHeaderLogout = document.getElementById('btnHeaderLogout');
  const btnNavReview = document.getElementById('btnNavReview');

  function showLoginModal(message) {
    if (!loginModal) return;
    if (loginMessage) {
      if (message) {
        loginMessage.textContent = message;
        loginMessage.style.display = 'block';
      } else {
        loginMessage.style.display = 'none';
        loginMessage.textContent = '';
      }
    }
    if (btnLoginSubmit) {
      btnLoginSubmit.disabled = false;
      btnLoginSubmit.textContent = 'ログイン';
    }
    loginModal.classList.add('open');
    loginModal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
    if (txtLoginEmpNo) {
      txtLoginEmpNo.focus();
    }
  }

  function hideLoginModal() {
    if (!loginModal) return;
    loginModal.classList.remove('open');
    loginModal.style.display = 'none';
    document.body.style.overflow = '';
    if (txtLoginPassword) {
      txtLoginPassword.value = '';
    }
  }

  async function applyAccessContext(ctx) {
    currentAccessContext = ctx;
    window.__CURRENT_ACCESS_CONTEXT__ = ctx;

    // Server-authoritative BaseCode from AccessContext (DECISION-02)
    if (ctx && (!ctx.baseCode || ctx.baseCode === '所属未登録' || ctx.baseCode === 'Base未登録')) {
      ctx.baseCode = null;
    }

    // Configure Base Scope Selector on initial login
    const selListBaseScope = document.getElementById('selListBaseScope');
    const isAreaManager = (ctx?.capabilities || []).includes('SHIPMENT_REVIEW_NATIONWIDE') || ctx?.roleCode === 'AreaManager';
    if (selListBaseScope) {
      if (isAreaManager) {
        selListBaseScope.value = 'ALL';
      } else {
        selListBaseScope.value = 'BASE';
      }
    }

    // 1. Update Header UI (Section 3 & 9: employeeName fallback, compact display)
    const displayName = ctx.employeeName || ctx.empName || '';
    if (headerUserName) {
      if (displayName && ctx.empNo) {
        headerUserName.textContent = `${displayName} (${ctx.empNo})`;
      } else if (displayName) {
        headerUserName.textContent = displayName;
      } else if (ctx.empNo) {
        headerUserName.textContent = ctx.empNo;
      } else {
        headerUserName.textContent = '認証済みユーザー';
      }
    }
    // Section 4: Role badge removed from visible UI (presentation only)
    if (headerAuthBadge) {
      headerAuthBadge.style.display = 'none';
      headerAuthBadge.setAttribute('hidden', '');
    }
    if (btnHeaderLogout) {
      btnHeaderLogout.style.display = 'inline-flex';
    }

    // 2. Enforce Role-based Review UI visibility (K. AUTHORIZATION & Section 10)
    const canReview = (typeof AuthorizationClient !== 'undefined' && typeof AuthorizationClient.canReview === 'function')
      ? AuthorizationClient.canReview(ctx)
      : false;

    if (btnNavReview) {
      if (canReview) {
        btnNavReview.style.display = '';
        btnNavReview.removeAttribute('hidden');
      } else {
        btnNavReview.style.display = 'none';
        btnNavReview.setAttribute('hidden', '');
      }
    }

    if (!canReview && viewReviewSection && viewReviewSection.style.display !== 'none') {
      switchView('record');
    }

    // 3. Reflect Authenticated Operator to Form State (Section 9: Safe fallback)
    if (formState) {
      const emp = {
        empNo: ctx.empNo,
        empName: displayName || ctx.empNo || '氏名未登録',
        baseName: ctx.baseName || '',
        areaName: ctx.areaName || '',
        baseCode: ctx.baseId || ctx.baseCode || ''
      };
      formState.setEmployee(emp, false);
      updateEmployeeUI();
    }

    // Prefetch form options in background for instant Lift Operator modal display (CACHE-003)
    if (masterClient && typeof masterClient.loadFormOptions === 'function') {
      masterClient.loadFormOptions(false).catch(err => {
        console.warn('Background master prefetch notice:', err);
      });
    }
  }

  // 4. Session Validation & Restore
  async function initAuthSession() {
    if (transportError) {
      showMasterError('GAS接続先エンドポイントが設定されていません。config.local.js または __SHIPPING_CONFIG__ を確認してください。');
      return false;
    }
    if (!authClient) {
      showMasterError('認証クライアントの初期化に失敗しました。');
      return false;
    }

    const hasToken = (typeof authClient.hasToken === 'function') ? authClient.hasToken() : false;
    if (!hasToken) {
      showLoginModal();
      return false;
    }

    try {
      const ctx = await authClient.getAccessContext();
      if (ctx && ctx.empNo) {
        applyAccessContext(ctx);
        hideLoginModal();
        switchView('record');
        return true;
      } else {
        throw new Error('Access context missing empNo');
      }
    } catch (err) {
      console.warn('Session restore failed or expired:', err);
      if (typeof SessionClient !== 'undefined' && typeof SessionClient.clearToken === 'function') {
        SessionClient.clearToken();
      }
      showLoginModal('セッションの有効期限が切れました。再度ログインしてください。');
      return false;
    }
  }

  // DOM Elements
  // TASK-005 DOM Elements
  const chkShowAllDrivers = document.getElementById('chkShowAllDrivers');
  const btnSelectDriver = document.getElementById('btnSelectDriver');
  const operatorCard = document.getElementById('operatorCard');
  const operatorNameDisplay = document.getElementById('operatorNameDisplay');
  const operatorSubDisplay = document.getElementById('operatorSubDisplay');
  const txtPartnerCompany = document.getElementById('txtPartnerCompany');
  const partnerStatusBadge = document.getElementById('partnerStatusBadge');
  const driverError = document.getElementById('driverError');
  const driverScopeHint = document.getElementById('driverScopeHint');

  const driverModal = document.getElementById('driverModal');
  const btnCloseDriverModal = document.getElementById('btnCloseDriverModal');
  const btnCloseDriverModalBottom = document.getElementById('btnCloseDriverModalBottom');
  const driverSearchInput = document.getElementById('driverSearchInput');
  const driverList = document.getElementById('driverList');
  const driverEmptyNotice = document.getElementById('driverEmptyNotice');
  const baseDriverEmptyNotice = document.getElementById('baseDriverEmptyNotice');
  let lastFocusedElementForDriverModal = null;
  const txtInputStartedAt = document.getElementById('txtInputStartedAt');
  const txtLoadingDate = document.getElementById('txtLoadingDate');
  const employeeCard = document.getElementById('employeeCard');
  const employeeNameDisplay = document.getElementById('employeeNameDisplay');
  const employeeBaseDisplay = document.getElementById('employeeBaseDisplay');
  const employeeAreaDisplay = document.getElementById('employeeAreaDisplay');
  const btnChangeUser = document.getElementById('btnChangeUser');
  const txtBaseArea = document.getElementById('txtBaseArea');

  const numEquipmentTypeCount = document.getElementById('numEquipmentTypeCount');
  const btnDecrementCount = document.getElementById('btnDecrementCount');
  const btnIncrementCount = document.getElementById('btnIncrementCount');
  const countError = document.getElementById('countError');

  const radLooseNo = document.getElementById('radLooseNo');
  const radLooseYes = document.getElementById('radLooseYes');

  const optionalAccordion = document.getElementById('optionalAccordion');
  const accordionHeader = document.getElementById('accordionHeader');

  const txtLooseItemCreator = document.getElementById('txtLooseItemCreator');
  const txtLooseItemStatus = document.getElementById('txtLooseItemStatus');
  const selTransportCategory = document.getElementById('selTransportCategory');
  const txtCarrierName = document.getElementById('txtCarrierName');
  const txtDriverName = document.getElementById('txtDriverName');

  const masterErrorBanner = document.getElementById('masterErrorBanner');
  const masterErrorMessage = document.getElementById('masterErrorMessage');
  const btnRetryMaster = document.getElementById('btnRetryMaster');

  // Employee Selection Modal
  const employeeModal = document.getElementById('employeeModal');
  const btnCloseModal = document.getElementById('btnCloseModal');
  const employeeSearchInput = document.getElementById('employeeSearchInput');
  const employeeList = document.getElementById('employeeList');

  // 1. Initialize inputStartAt and loadingDate
  if (txtInputStartedAt) txtInputStartedAt.value = formState.inputStartAt;
  if (txtLoadingDate) {
    txtLoadingDate.value = formState.loadingDate;
    txtLoadingDate.addEventListener('change', (e) => {
      formState.setLoadingDate(e.target.value);
    });
    txtLoadingDate.addEventListener('input', (e) => {
      formState.setLoadingDate(e.target.value);
    });
  }

  // 2. Load / Restore Employee
  async function initEmployee() {
    masterErrorBanner.classList.remove('visible');
    try {
      const restored = await formState.restorePreviousEmployee();
      if (restored) {
        updateEmployeeUI();
      } else {
        // No saved employee or invalid -> update UI without opening modal (modal opens on user action)
        updateEmployeeUI();
      }
    } catch (err) {
      showMasterError(err.message);
    }
  }

  function updateEmployeeUI() {
    if (formState.currentEmployee) {
      const emp = formState.currentEmployee;
      const displayName = emp.empName || emp.employeeName || emp.empNo || '氏名未登録';
      employeeNameDisplay.textContent = displayName;
      employeeBaseDisplay.textContent = emp.baseName || 'Base未登録';
      employeeAreaDisplay.textContent = emp.areaName || 'Area未登録';
      const baseAreaText = (emp.areaName && emp.baseName)
        ? `${emp.areaName} / ${emp.baseName}`
        : (emp.areaName || emp.baseName || '所属未登録');
      txtBaseArea.textContent = baseAreaText;
      employeeCard.style.display = 'flex';
      updateLiftOperatorUI();
      checkBaseOperatorsAndNotify();
    } else {
      employeeNameDisplay.textContent = '未選択';
      employeeBaseDisplay.textContent = '---';
      employeeAreaDisplay.textContent = '---';
      txtBaseArea.textContent = '---';
    }
  }

  function showMasterError(msg) {
    masterErrorMessage.textContent = msg || 'マスタ読取エラーが発生しました。';
    masterErrorBanner.classList.add('visible');
  }

  // 3. Employee Modal Operations
  async function openEmployeeModal() {
    employeeModal.classList.add('open');
    employeeSearchInput.value = '';
    await loadEmployeesToModal();
  }

  function closeEmployeeModal() {
    employeeModal.classList.remove('open');
  }

  async function loadEmployeesToModal(query = '') {
    employeeList.innerHTML = '<li style="padding: 12px; color: var(--color-text-muted);">読み込み中...</li>';
    try {
      const employees = await masterClient.getEmployees({ name: query });
      employeeList.innerHTML = '';
      if (!employees || employees.length === 0) {
        employeeList.innerHTML = '<li style="padding: 12px; color: var(--color-text-muted);">該当する社員が見つかりません</li>';
        return;
      }
      employees.forEach(emp => {
        const li = document.createElement('li');
        li.className = 'employee-list-item';
        li.setAttribute('role', 'button');
        li.setAttribute('tabindex', '0');
        li.innerHTML = `
          <div>
            <span style="font-weight: bold;">${escapeHtml(emp.empName)}</span>
            <span style="font-size: 0.85rem; color: var(--color-text-muted); margin-left: 8px;">(${escapeHtml(emp.empNo)})</span>
          </div>
          <span style="font-size: 0.85rem; color: var(--color-primary);">${escapeHtml(emp.baseName || '')}</span>
        `;
        const selectAction = () => {
          formState.setEmployee(emp, true);
          updateEmployeeUI();
          closeEmployeeModal();
        };
        li.addEventListener('click', selectAction);
        li.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            selectAction();
          }
        });
        employeeList.appendChild(li);
      });
    } catch (err) {
      employeeList.innerHTML = `<li style="padding: 12px; color: #DC2626;">${escapeHtml(err.message)}</li>`;
    }
  }


  // TASK-005 Lift Operator UI Updater
  function updateLiftOperatorUI() {
    if (formState.selectedLiftOperator) {
      operatorNameDisplay.textContent = formState.selectedLiftOperator.liftOperatorName;
      const crossTag = formState.selectedLiftOperator.isCrossBase ? ' [他Base]' : '';
      operatorSubDisplay.textContent = `所属: Base ${formState.selectedLiftOperator.baseCode}${crossTag}`;
      operatorCard.classList.add('selected');
      driverError.style.display = 'none';

      // Partner Auto-derivation display
      txtPartnerCompany.textContent = formState.selectedLiftOperator.partnerName || '---';
      if (formState.partnerResolutionState === 'resolved') {
        partnerStatusBadge.textContent = '正常連動';
        partnerStatusBadge.className = 'badge badge-ok';
        partnerStatusBadge.style.display = 'inline-flex';
      } else if (formState.partnerResolutionState === 'unassigned') {
        partnerStatusBadge.textContent = '未設定';
        partnerStatusBadge.className = 'badge badge-pending';
        partnerStatusBadge.style.display = 'inline-flex';
      } else if (formState.partnerResolutionState === 'error') {
        partnerStatusBadge.textContent = '照会エラー';
        partnerStatusBadge.className = 'badge badge-ng';
        partnerStatusBadge.style.display = 'inline-flex';
      } else {
        partnerStatusBadge.style.display = 'none';
      }
    } else {
      operatorNameDisplay.textContent = '未選択';
      operatorSubDisplay.textContent = '「選択」を押してください';
      operatorCard.classList.remove('selected');
      txtPartnerCompany.textContent = '---';
      partnerStatusBadge.style.display = 'none';
    }
  }

  // Lift Operator Modal Logic (Fast UX: Cache-First Instant Display)
  async function openDriverModal() {
    lastFocusedElementForDriverModal = document.activeElement;
    driverModal.classList.add('open');
    driverModal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
    driverSearchInput.value = '';
    await loadDriversToModal('', false);
    if (driverSearchInput) driverSearchInput.focus();
  }

  function closeDriverModal() {
    driverModal.classList.remove('open');
    driverModal.style.display = 'none';
    document.body.style.overflow = '';
    if (lastFocusedElementForDriverModal && typeof lastFocusedElementForDriverModal.focus === 'function') {
      lastFocusedElementForDriverModal.focus();
    } else if (btnSelectDriver) {
      btnSelectDriver.focus();
    }
  }

  // Non-blocking base operator empty check (UI-REVIEW-003-R1)
  async function checkBaseOperatorsAndNotify() {
    if (!baseDriverEmptyNotice) return;
    if (chkShowAllDrivers.checked) {
      baseDriverEmptyNotice.style.display = 'none';
      return;
    }
    const currentBaseCode = formState.currentEmployee?.baseCode || '';
    if (!currentBaseCode) {
      baseDriverEmptyNotice.style.display = 'none';
      return;
    }
    try {
      const ops = await masterClient.getLiftOperators({
        baseCode: currentBaseCode,
        showAllDrivers: false
      });
      if (!ops || ops.length === 0) {
        baseDriverEmptyNotice.style.display = 'block';
      } else {
        baseDriverEmptyNotice.style.display = 'none';
      }
    } catch (e) {
      console.warn('Failed to check base lift operators', e);
    }
  }

  async function loadDriversToModal(query = '', forceRefresh = false) {
    // Only show loading placeholder if master cache is not yet loaded
    const hasCached = Array.isArray(masterClient.cachedLiftOperators) && masterClient.cachedLiftOperators.length > 0;
    if (!hasCached) {
      driverList.innerHTML = '<li style="padding: 12px; color: var(--color-text-muted);">読み込み中...</li>';
    }
    driverEmptyNotice.style.display = 'none';

    try {
      const currentBaseCode = formState.currentEmployee?.baseCode || '';
      const showAll = chkShowAllDrivers.checked;
      const operators = await masterClient.getLiftOperators({
        baseCode: currentBaseCode,
        showAllDrivers: showAll,
        query: query,
        forceRefresh: Boolean(forceRefresh)
      });

      driverList.innerHTML = '';
      if (!operators || operators.length === 0) {
        if (!showAll && !query) {
          driverEmptyNotice.style.display = 'block';
        } else {
          driverList.innerHTML = '<li style="padding: 12px; color: var(--color-text-muted);">該当するリフトマンが見つかりません</li>';
        }
        return;
      }

      operators.forEach(op => {
        const li = document.createElement('li');
        li.className = 'employee-list-item';
        li.setAttribute('role', 'button');
        li.setAttribute('tabindex', '0');
        const isDiffBase = currentBaseCode && op.baseCode !== currentBaseCode;
        const safeBaseBadge = isDiffBase
          ? `<span class="badge badge-pending" style="margin-left: 6px;">他Base (${escapeHtml(op.baseCode)})</span>`
          : `<span style="font-size: 0.85rem; color: var(--color-text-muted); margin-left: 6px;">(Base ${escapeHtml(op.baseCode)})</span>`;

        li.innerHTML = `
          <div>
            <span style="font-weight: bold;">${escapeHtml(op.liftOperatorName)}</span>
            ${safeBaseBadge}
          </div>
          <span style="font-size: 0.85rem; color: var(--color-primary);">${op.partnerCode ? '会社コード: ' + escapeHtml(op.partnerCode) : '会社未設定'}</span>
        `;

        const selectAction = async () => {
          await formState.selectLiftOperator(op);
          updateLiftOperatorUI();
          closeDriverModal();
        };

        li.addEventListener('click', selectAction);
        li.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            selectAction();
          }
        });
        driverList.appendChild(li);
      });
    } catch (err) {
      driverList.innerHTML = `<li style="padding: 12px; color: #DC2626;">${escapeHtml(err.message)}</li>`;
    }
  }

  // Lift Operator Event Listeners
  btnSelectDriver.addEventListener('click', openDriverModal);
  btnCloseDriverModal.addEventListener('click', closeDriverModal);
  if (btnCloseDriverModalBottom) {
    btnCloseDriverModalBottom.addEventListener('click', closeDriverModal);
  }
  driverModal.addEventListener('click', (e) => {
    if (e.target === driverModal) {
      closeDriverModal();
    }
  });

  driverSearchInput.addEventListener('input', (e) => loadDriversToModal(e.target.value.trim()));

  chkShowAllDrivers.addEventListener('change', async (e) => {
    formState.setShowAllDrivers(e.target.checked);
    if (e.target.checked) {
      driverScopeHint.textContent = '※全国のリフトマンが検索・選択対象に含まれます。';
      if (baseDriverEmptyNotice) baseDriverEmptyNotice.style.display = 'none';
    } else {
      driverScopeHint.textContent = '※初期状態では所属Baseのリフトマンのみ優先表示されます。';
      await checkBaseOperatorsAndNotify();
    }
    if (driverModal.classList.contains('open')) {
      await loadDriversToModal(driverSearchInput.value.trim());
    }
  });

  // Event Listeners for Modal & User Change
  btnChangeUser.addEventListener('click', openEmployeeModal);
  btnCloseModal.addEventListener('click', closeEmployeeModal);
  employeeSearchInput.addEventListener('input', (e) => {
    loadEmployeesToModal(e.target.value.trim());
  });
  btnRetryMaster.addEventListener('click', initEmployee);

  // 4. Equipment Type Count Stepper
  function updateCount(val) {
    formState.setTotalMaterialTypeCount(val);
    numEquipmentTypeCount.value = formState.totalMaterialTypeCount;
    if (formState.errors.totalMaterialTypeCount) {
      countError.textContent = formState.errors.totalMaterialTypeCount;
      countError.style.display = 'block';
    } else {
      countError.style.display = 'none';
    }
  }

  btnDecrementCount.addEventListener('click', () => {
    if (formState.totalMaterialTypeCount > 1) {
      updateCount(formState.totalMaterialTypeCount - 1);
    }
  });

  btnIncrementCount.addEventListener('click', () => {
    updateCount(formState.totalMaterialTypeCount + 1);
  });

  numEquipmentTypeCount.addEventListener('change', (e) => {
    updateCount(e.target.value);
  });

  // 5. Bara Toggle (UI-REVIEW-003: はい / いいえ)
  const looseItemFieldsContainer = document.getElementById('looseItemFieldsContainer');
  function updateLooseFieldsVisibility() {
    if (looseItemFieldsContainer) {
      looseItemFieldsContainer.style.display = formState.hasLooseItems ? 'block' : 'none';
    }
  }

  if (radLooseYes) {
    radLooseYes.addEventListener('change', () => {
      formState.setHasLooseItems(true);
      updateLooseFieldsVisibility();
    });
  }
  if (radLooseNo) {
    radLooseNo.addEventListener('change', () => {
      formState.setHasLooseItems(false);
      updateLooseFieldsVisibility();
    });
  }
  updateLooseFieldsVisibility();

  // 6. Accordion Toggle
  accordionHeader.addEventListener('click', () => {
    optionalAccordion.classList.toggle('open');
    const isOpen = optionalAccordion.classList.contains('open');
    accordionHeader.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
  });

  // 7. Optional fields 2-way binding
  if (txtLooseItemCreator) txtLooseItemCreator.addEventListener('input', (e) => formState.looseItemCreatorName = e.target.value);
  if (txtLooseItemStatus) txtLooseItemStatus.addEventListener('input', (e) => formState.looseItemStatus = e.target.value);
  selTransportCategory.addEventListener('change', (e) => formState.transportCategory = e.target.value);
  txtCarrierName.addEventListener('input', (e) => formState.carrierName = e.target.value);
  txtDriverName.addEventListener('input', (e) => formState.driverName = e.target.value);

  // Expose to window for automated testing
  window.__SHIPPING_ERROR_FORM_STATE__ = formState;

  // Initialize
  initEmployee();


  // ============================================================================
  // TASK-006: ShippingErrorDetail 1:N Controller & Material Search Modal
  // ============================================================================
  const errorDetailsContainer = document.getElementById('errorDetailsContainer');
  const btnAddErrorDetail = document.getElementById('btnAddErrorDetail');

  // TASK-007: Attachment DOM Elements
  const fileCapturePhoto = document.getElementById('fileCapturePhoto');
  const btnCapturePhoto = document.getElementById('btnCapturePhoto');
  const txtPdfLink = document.getElementById('txtPdfLink');
  const btnAddPdfLink = document.getElementById('btnAddPdfLink');
  const pdfLinkError = document.getElementById('pdfLinkError');
  const attachmentList = document.getElementById('attachmentList');
  const attachmentEmptyNotice = document.getElementById('attachmentEmptyNotice');
  const attachmentGlobalError = document.getElementById('attachmentGlobalError');
  const errorDetailsGlobalError = document.getElementById('errorDetailsGlobalError');

  const materialModal = document.getElementById('materialModal');
  const btnCloseMaterialModal = document.getElementById('btnCloseMaterialModal');
  const materialSearchInput = document.getElementById('materialSearchInput');
  const materialList = document.getElementById('materialList');
  const materialEmptyNotice = document.getElementById('materialEmptyNotice');
  const materialErrorNotice = document.getElementById('materialErrorNotice');

  let activeDetailIdForMaterial = null;
  let cachedMaterials = null;

  function renderErrorDetailCards() {
    if (!errorDetailsContainer) return;
    errorDetailsContainer.innerHTML = '';

    const details = formState.errorDetails;
    const canRemove = details.length > 1;

    details.forEach((detail, index) => {
      const card = document.createElement('div');
      card.className = 'error-detail-card';
      card.id = `card_${detail.clientDetailId}`;
      card.dataset.detailId = detail.clientDetailId;

      const cardErrors = formState.detailErrors[detail.clientDetailId] || {};
      if (Object.keys(cardErrors).length > 0) {
        card.classList.add('has-error');
      }

      // Header
      const header = document.createElement('div');
      header.className = 'detail-card-header';
      header.innerHTML = `
        <div class="detail-card-title">
          <span class="detail-number-badge">#${index + 1}</span>
          <span class="detail-card-heading">積み間違い資材</span>
        </div>
        <button type="button" class="btn-remove-detail" data-action="remove" data-id="${detail.clientDetailId}" ${canRemove ? '' : 'disabled aria-disabled="true"'} aria-label="明細 #${index + 1} を削除">
          削除
        </button>
      `;
      card.appendChild(header);

      // 1. Category 5 Buttons Grid
      const catGroup = document.createElement('div');
      catGroup.className = 'form-group';
      catGroup.innerHTML = `
        <label class="form-label">区分 <span class="required-asterisk">*</span></label>
        <div class="category-grid" role="radiogroup" aria-label="区分選択（明細 #${index + 1}）">
          ${window.CANONICAL_CATEGORIES.map(cat => {
            const isSel = detail.category === cat;
            return `<button type="button" class="category-btn ${isSel ? 'is-selected' : ''}" data-cat="${cat}" data-id="${detail.clientDetailId}" role="radio" aria-checked="${isSel}">${cat}</button>`;
          }).join('')}
        </div>
        <div class="form-error" style="${cardErrors.category ? 'display:block;' : ''}">${cardErrors.category || ''}</div>
      `;
      card.appendChild(catGroup);

      // 2. Material Code Search Combobox (FRONTEND-001)
      const matGroup = document.createElement('div');
      matGroup.className = 'form-group';
      const comboboxMountId = `combobox_${detail.clientDetailId}`;
      matGroup.innerHTML = `
        <label class="form-label">資材コード <span class="required-asterisk">*</span></label>
        <div id="${comboboxMountId}"></div>
        <div class="form-error" style="${cardErrors.material ? 'display:block;' : ''}">${cardErrors.material || ''}</div>
      `;
      card.appendChild(matGroup);

      // Mount independent MaterialCombobox instance for this detail card
      setTimeout(() => {
        const mount = document.getElementById(comboboxMountId);
        if (mount && typeof MaterialCombobox !== 'undefined') {
          new MaterialCombobox({
            container: mount,
            rpcClient: window.shippingRpcClient || (typeof RpcClient !== 'undefined' ? new RpcClient() : null),
            getSessionToken: () => {
              return (typeof SessionClient !== 'undefined' && SessionClient.getToken)
                ? SessionClient.getToken()
                : (window.__CURRENT_SESSION_TOKEN__ || '');
            },
            initialValue: detail.materialCode ? {
              materialCode: detail.materialCode,
              materialName: detail.materialName,
              matCode: detail.materialCode,
              matName: detail.materialName
            } : null,
            onSelect: (mat) => {
              formState.setMaterialForDetail(detail.clientDetailId, {
                materialCode: mat.materialCode,
                materialName: mat.materialName,
                matCode: mat.materialCode,
                matName: mat.materialName
              });
              if (formState.detailErrors[detail.clientDetailId]?.material) {
                delete formState.detailErrors[detail.clientDetailId].material;
                const errDiv = matGroup.querySelector('.form-error');
                if (errDiv) errDiv.style.display = 'none';
              }
            },
            onClear: () => {
              formState.setMaterialForDetail(detail.clientDetailId, {
                materialCode: '',
                materialName: '',
                matCode: '',
                matName: ''
              });
            }
          });
        }
      }, 0);

      // 3. Cause / Detail textarea
      const causeGroup = document.createElement('div');
      causeGroup.className = 'form-group';
      causeGroup.style.marginBottom = '0';
      const causeId = `cause_${detail.clientDetailId}`;
      causeGroup.innerHTML = `
        <label class="form-label" for="${causeId}">原因・詳細 <span class="required-asterisk">*</span></label>
        <textarea id="${causeId}" class="form-control cause-detail-textarea" rows="2" placeholder="発生状況や原因を入力">${escapeHtml(detail.causeDetail || '')}</textarea>
        <div class="form-error" style="${cardErrors.causeDetail ? 'display:block;' : ''}">${cardErrors.causeDetail || ''}</div>
      `;
      card.appendChild(causeGroup);

      // Wire Cause textarea input
      const textarea = causeGroup.querySelector('textarea');
      textarea.addEventListener('input', (e) => {
        formState.updateErrorDetail(detail.clientDetailId, { causeDetail: e.target.value });
        if (formState.detailErrors[detail.clientDetailId]?.causeDetail && e.target.value.trim()) {
          delete formState.detailErrors[detail.clientDetailId].causeDetail;
          const errDiv = causeGroup.querySelector('.form-error');
          if (errDiv) errDiv.style.display = 'none';
        }
      });

      errorDetailsContainer.appendChild(card);
    });

    if (errorDetailsGlobalError) {
      if (formState.errors.errorDetails) {
        errorDetailsGlobalError.textContent = formState.errors.errorDetails;
        errorDetailsGlobalError.style.display = 'block';
      } else {
        errorDetailsGlobalError.style.display = 'none';
      }
    }
  }

  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // Event Delegation on errorDetailsContainer
  if (errorDetailsContainer) {
    errorDetailsContainer.addEventListener('click', (e) => {
      // 1. Remove detail button
      const removeBtn = e.target.closest('[data-action="remove"]');
      if (removeBtn) {
        const detailId = removeBtn.dataset.id;
        if (detailId) {
          formState.removeErrorDetail(detailId);
          renderErrorDetailCards();
        }
        return;
      }

      // 2. Category button
      const catBtn = e.target.closest('.category-btn');
      if (catBtn) {
        const detailId = catBtn.dataset.id;
        const cat = catBtn.dataset.cat;
        if (detailId && cat) {
          formState.updateErrorDetail(detailId, { category: cat });
          renderErrorDetailCards();
        }
        return;
      }

      // 3. Material select box
      const matBox = e.target.closest('[data-action="select-material"]');
      if (matBox) {
        const detailId = matBox.dataset.id;
        if (detailId) {
          openMaterialModal(detailId);
        }
        return;
      }
    });

    // Keyboard enter on material box
    errorDetailsContainer.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        const matBox = e.target.closest('[data-action="select-material"]');
        if (matBox) {
          e.preventDefault();
          const detailId = matBox.dataset.id;
          if (detailId) openMaterialModal(detailId);
        }
      }
    });
  }

  // Add detail button
  if (btnAddErrorDetail) {
    btnAddErrorDetail.addEventListener('click', () => {
      formState.addErrorDetail();
      renderErrorDetailCards();
      // Scroll new card into view
      const lastCard = errorDetailsContainer.lastElementChild;
      if (lastCard) {
        lastCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    });
  }

  // Material Modal Logic
  async function openMaterialModal(detailId) {
    activeDetailIdForMaterial = detailId;
    if (materialSearchInput) materialSearchInput.value = '';
    if (materialEmptyNotice) materialEmptyNotice.style.display = 'none';
    if (materialErrorNotice) materialErrorNotice.style.display = 'none';
    if (materialModal) materialModal.classList.add('open');

    await searchAndRenderMaterials('');
    if (materialSearchInput) materialSearchInput.focus();
  }

  function closeMaterialModal() {
    if (materialModal) materialModal.classList.remove('open');
    activeDetailIdForMaterial = null;
  }

  if (btnCloseMaterialModal) {
    btnCloseMaterialModal.addEventListener('click', closeMaterialModal);
  }

  async function searchAndRenderMaterials(query) {
    if (!materialList) return;
    materialList.innerHTML = '<div style="padding: 16px; text-align: center; color: var(--color-text-muted);">読み込み中...</div>';
    if (materialEmptyNotice) materialEmptyNotice.style.display = 'none';
    if (materialErrorNotice) materialErrorNotice.style.display = 'none';

    try {
      const list = await masterClient.getMaterials({ query, limit: 60 });
      materialList.innerHTML = '';

      if (!list || list.length === 0) {
        if (materialEmptyNotice) materialEmptyNotice.style.display = 'block';
        return;
      }

      list.forEach(mat => {
        const item = document.createElement('div');
        item.className = 'material-item';
        item.role = 'option';
        item.tabIndex = 0;
        item.innerHTML = `
          <span class="material-item-name">${escapeHtml(mat.matName)}</span>
          <span class="material-item-code">${escapeHtml(mat.matCode)}</span>
        `;
        item.addEventListener('click', () => {
          selectMaterialForActiveCard(mat);
        });
        item.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            selectMaterialForActiveCard(mat);
          }
        });
        materialList.appendChild(item);
      });
    } catch (err) {
      console.error('Failed to load materials', err);
      materialList.innerHTML = '';
      if (materialErrorNotice) materialErrorNotice.style.display = 'block';
    }
  }

  function selectMaterialForActiveCard(mat) {
    if (activeDetailIdForMaterial) {
      formState.setMaterialForDetail(activeDetailIdForMaterial, mat);
      renderErrorDetailCards();
    }
    closeMaterialModal();
  }

  // Material Search Input debounce
  let materialSearchTimeout = null;
  if (materialSearchInput) {
    materialSearchInput.addEventListener('input', (e) => {
      clearTimeout(materialSearchTimeout);
      materialSearchTimeout = setTimeout(() => {
        searchAndRenderMaterials(e.target.value);
      }, 250);
    });
  }

  // =========================================================================
  // TASK-007: Evidence Attachment UI Controller (Photo & PDF link)
  // =========================================================================

  function formatFileSize(bytes) {
    if (typeof bytes !== 'number' || isNaN(bytes) || bytes <= 0) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  function renderAttachments() {
    if (!attachmentList) return;

    if (!formState.attachments || formState.attachments.length === 0) {
      attachmentList.innerHTML = '';
      if (attachmentEmptyNotice) attachmentEmptyNotice.style.display = 'block';
      return;
    }

    if (attachmentEmptyNotice) attachmentEmptyNotice.style.display = 'none';
    attachmentList.innerHTML = '';

    formState.attachments.forEach((att, idx) => {
      const item = document.createElement('div');
      item.className = 'attachment-item';
      item.role = 'listitem';
      item.id = 'attItem_' + att.clientAttachmentId;

      const isPhoto = att.attachmentType === 'photo';
      const badgeClass = isPhoto ? 'photo' : 'pdf';
      const badgeLabel = isPhoto ? '写真' : 'PDFリンク';
      const displayName = att.originalFilename || att.storageLocation || '証跡ファイル';
      
      let thumbHtml = '';
      let metaInfo = '';

      if (isPhoto) {
        const previewSrc = att.localPreviewUrl || '';
        thumbHtml = '<div class="attachment-thumb-wrap">' +
          (previewSrc
            ? '<img src="' + escapeHtml(previewSrc) + '" alt="証跡写真プレビュー ' + (idx + 1) + '" class="attachment-thumb-img">'
            : '<span class="attachment-thumb-icon" aria-hidden="true">[写真]</span>') +
          '</div>';
        const sizeStr = formatFileSize(att.fileSize);
        metaInfo = (sizeStr ? sizeStr + ' | ' : '') + (att.createdAt || '');
      } else {
        thumbHtml = '<div class="attachment-thumb-wrap">' +
          '<span class="attachment-thumb-icon" aria-hidden="true">[PDF]</span>' +
          '</div>';
        metaInfo = '参照: ' + escapeHtml(att.storageLocation) + (att.createdAt ? ' | ' + att.createdAt : '');
      }

      item.innerHTML = 
        thumbHtml +
        '<div class="attachment-info">' +
          '<div class="attachment-header-row">' +
            '<span class="attachment-type-badge ' + badgeClass + '">' + badgeLabel + '</span>' +
            '<span class="attachment-filename" title="' + escapeHtml(displayName) + '">' + escapeHtml(displayName) + '</span>' +
          '</div>' +
          '<div class="attachment-meta" title="' + escapeHtml(metaInfo) + '">' + escapeHtml(metaInfo) + '</div>' +
        '</div>' +
        '<button type="button" class="btn-remove-attachment" data-attachment-id="' + escapeHtml(att.clientAttachmentId) + '" aria-label="' + escapeHtml(displayName) + ' を削除">' +
          '削除' +
        '</button>';

      attachmentList.appendChild(item);
    });
  }

  // Event Delegation for Attachment Removal
  if (attachmentList) {
    attachmentList.addEventListener('click', (e) => {
      const removeBtn = e.target.closest('.btn-remove-attachment');
      if (removeBtn) {
        const attId = removeBtn.getAttribute('data-attachment-id');
        if (attId) {
          formState.removeAttachment(attId);
          renderAttachments();
        }
      }
    });
  }

  // Smartphone Photo Capture & Selection
  if (btnCapturePhoto && fileCapturePhoto) {
    btnCapturePhoto.addEventListener('click', () => {
      if (attachmentGlobalError) {
        attachmentGlobalError.style.display = 'none';
        attachmentGlobalError.textContent = '';
      }
      fileCapturePhoto.click();
    });

    fileCapturePhoto.addEventListener('change', (e) => {
      const files = e.target.files;
      if (!files || files.length === 0) return;

      if (attachmentGlobalError) {
        attachmentGlobalError.style.display = 'none';
        attachmentGlobalError.textContent = '';
      }

      let hasError = false;
      for (let i = 0; i < files.length; i++) {
        try {
          formState.addPhotoAttachment(files[i]);
        } catch (err) {
          hasError = true;
          if (attachmentGlobalError) {
            attachmentGlobalError.textContent = err.message;
            attachmentGlobalError.style.display = 'block';
          }
        }
      }

      // Reset file input so identical file can be re-selected if removed and added again
      fileCapturePhoto.value = '';
      renderAttachments();
    });
  }

  // Office-PC PDF Link Registration
  function handleAddPdfLink() {
    if (!txtPdfLink) return;
    const linkVal = txtPdfLink.value;

    if (pdfLinkError) {
      pdfLinkError.style.display = 'none';
      pdfLinkError.textContent = '';
    }

    try {
      formState.addPdfLinkAttachment(linkVal);
      txtPdfLink.value = '';
      renderAttachments();
    } catch (err) {
      if (pdfLinkError) {
        pdfLinkError.textContent = err.message;
        pdfLinkError.style.display = 'block';
      }
    }
  }

  if (btnAddPdfLink) {
    btnAddPdfLink.addEventListener('click', handleAddPdfLink);
  }

  if (txtPdfLink) {
    txtPdfLink.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleAddPdfLink();
      }
    });
  }

  // Memory cleanup on page unload
  window.addEventListener('beforeunload', () => {
    if (formState && typeof formState.cleanupAttachments === 'function') {
      formState.cleanupAttachments();
    }
  });

  // Initial render of detail cards & attachments on load
  renderErrorDetailCards();
  renderAttachments();

  // ==========================================================================
  // TASK-008: Submit Handling & Controlled Error / Success Display
  // ==========================================================================
  const btnSubmitCheck = document.getElementById('btnSubmitCheck');
  const submitResultBanner = document.getElementById('submitResultBanner');
  const submitResultMessage = document.getElementById('submitResultMessage');

  function showSubmitBanner(type, message) {
    if (!submitResultBanner || !submitResultMessage) return;
    submitResultBanner.style.display = 'block';
    submitResultMessage.textContent = message; // CODEX-013-005 / NEW-014B-001: Safe textContent to prevent DOM XSS
    if (type === 'success') {
      submitResultBanner.style.backgroundColor = '#ECFDF5';
      submitResultBanner.style.color = '#065F46';
      submitResultBanner.style.border = '1px solid #A7F3D0';
    } else if (type === 'warning') {
      submitResultBanner.style.backgroundColor = '#FFFBEB';
      submitResultBanner.style.color = '#92400E';
      submitResultBanner.style.border = '1px solid #FDE68A';
    } else {
      submitResultBanner.style.backgroundColor = '#FEF2F2';
      submitResultBanner.style.color = '#991B1B';
      submitResultBanner.style.border = '1px solid #FECACA';
    }
  }
  function renderValidationErrors() {
    if (formState && formState.errors) {
      if (formState.errors.totalMaterialTypeCount) {
        if (countError) {
          countError.textContent = formState.errors.totalMaterialTypeCount;
          countError.style.display = 'block';
        }
      } else {
        if (countError) countError.style.display = 'none';
      }
      if (formState.errors.errorDetails) {
        if (errorDetailsGlobalError) {
          errorDetailsGlobalError.textContent = formState.errors.errorDetails;
          errorDetailsGlobalError.style.display = 'block';
        }
      } else {
        if (errorDetailsGlobalError) errorDetailsGlobalError.style.display = 'none';
      }
    }
  }

  if (btnSubmitCheck) {
    btnSubmitCheck.addEventListener('click', async () => {
      if (submitResultBanner) submitResultBanner.style.display = 'none';

      // 1. Client validation
      const isValid = formState.validate({
        requireLiftOperator: true,
        requireErrorDetails: true
      });

      if (!isValid) {
        renderValidationErrors();
        renderErrorDetailCards();
        showSubmitBanner('error', '入力内容に不備があります。エラー項目を確認してください。');
        return;
      }

      // 2. Gather draft payload
      const payload = formState.getDraftPayload();

      // 3. API Submission via canonical GAS RPC Client
      try {
        btnSubmitCheck.disabled = true;
        btnSubmitCheck.textContent = '登録中...';

        const client = shipmentClient || (typeof ShippingShipmentClient !== 'undefined' && rpcClient
          ? ShippingShipmentClient.createShipmentClient({ rpcClient })
          : (window.shippingClient || window.shipmentClient));

        if (!client || typeof client.createShipment !== 'function') {
          throw new Error('RPCクライアントが利用できません。ページを再読み込みしてください。');
        }

        const res = await client.createShipment(payload);
        if (res && res.ok) {
          // 1. GAS成功応答 & 2. 点検IDの取得
          const resData = res.payload || res.data || {};
          const shipmentCheck = resData.shipmentCheck || resData;
          const checkId = shipmentCheck.shippingCheckId || '---';
          const regAt = shipmentCheck.registeredAt || new Date().toLocaleString('ja-JP');
          const isRetry = Boolean(resData.idempotentReplay || resData.isNew === false);

          // 3. 登録確定 & 4. 関連キャッシュの先行無効化 (CACHE-005)
          try {
            if (typeof shipmentCache !== 'undefined' && shipmentCache.invalidateMutations) {
              shipmentCache.invalidateMutations();
            }
          } catch (cacheErr) {
            console.warn('Cache invalidation notice:', cacheErr);
          }

          // 5. 成功通知を最優先で表示
          const msg = isRetry
            ? `【登録済み】同一のリクエストにより既に登録されています。<br>点検ID: <strong>${escapeHtml(checkId)}</strong><br>登録日時: ${escapeHtml(regAt)}`
            : `【登録完了】出荷チェック実績が正常に登録されました。<br>点検ID: <strong>${escapeHtml(checkId)}</strong><br>登録日時: ${escapeHtml(regAt)}`;
          showSubmitBanner('success', msg);

          // 6. フォームを安全に初期化（個別try/catchで保護し、UIエラーが成功表示を壊さないようにする）
          try {
            if (typeof formState.resetForm === 'function') {
              formState.resetForm({ preserveLiftOperator: false, preserveEmployee: true });
            } else if (typeof formState.reset === 'function') {
              formState.reset({ preserveLiftOperator: false, preserveEmployee: true });
            }
            if (typeof renderErrorDetailCards === 'function') {
              renderErrorDetailCards();
            }
            if (typeof updateLiftOperatorUI === 'function') {
              updateLiftOperatorUI();
            }
            const inputLoadingDate = document.getElementById('txtLoadingDate');
            if (inputLoadingDate && formState.loadingDate) {
              inputLoadingDate.value = formState.loadingDate;
            }
          } catch (resetErr) {
            console.warn('Form reset non-critical notice:', resetErr);
          }
        } else {
          const errMsg = (res && res.error && res.error.message) || '登録処理中にエラーが発生しました。';
          showSubmitBanner('error', errMsg);
        }
      } catch (err) {
        let errMsg = 'サーバーとの通信に失敗しました。接続環境を確認してください。';
        const code = err.code || '';
        if (code === 'UNAUTHENTICATED' || code === 'AUTH_EXPIRED') {
          errMsg = '認証セッションの有効期限が切れました。再度ログインしてください。';
        } else if (code === 'ACCESS_DENIED') {
          errMsg = '出荷チェックを登録する権限がありません。';
        } else if (code === 'CLIENT_TIMEOUT' || code === 'NETWORK_TIMEOUT') {
          errMsg = 'サーバー通信がタイムアウトしました。二重登録を防ぐため、再送せず実績一覧を確認してください。';
        } else if (code === 'SUBMISSION_IN_PROGRESS') {
          errMsg = '現在登録処理中です。しばらくお待ちください。';
        } else if (code === 'TRANSPORT_UNCERTAIN') {
          errMsg = '直前の通信状態が不確定です。二重登録を防止するため、画面を再読み込みして実績一覧を確認してください。';
        } else if (err.message && !err.message.includes('fetch')) {
          errMsg = err.message;
        }
        showSubmitBanner('error', errMsg);
      } finally {
        btnSubmitCheck.disabled = false;
        btnSubmitCheck.textContent = '出荷チェックを登録する';
      }
    });
  }

  // ==========================================================================
  // TASK-009 & MONTHLY FILTER: Result List & Navigation Controller
  // ==========================================================================
  const API_CHECKS_PATH = '/api/shipment-checks';

  const appNav = document.getElementById('appNav');
  const navScrollHint = document.getElementById('navScrollHint');

  function updateNavScrollHint() {
    if (!appNav || !navScrollHint) return;
    const isOverflowing = appNav.scrollWidth > appNav.clientWidth + 4;
    const isEnd = (appNav.scrollLeft + appNav.clientWidth) >= (appNav.scrollWidth - 6);
    navScrollHint.classList.toggle('is-visible', isOverflowing && !isEnd);
  }

  if (appNav) {
    appNav.addEventListener('scroll', updateNavScrollHint);
    window.addEventListener('resize', updateNavScrollHint);
    setTimeout(updateNavScrollHint, 100);
  }

  const btnNavRecord = document.getElementById('btnNavRecord');
  const btnNavList = document.getElementById('btnNavList');
  const btnNavAnalytics = document.getElementById('btnNavAnalytics');
  const viewReviewSection = document.getElementById('viewReviewSection');
  const viewRecordSection = document.getElementById('viewRecordSection');
  const viewListSection = document.getElementById('viewListSection');
  const viewAnalyticsSection = document.getElementById('viewAnalyticsSection');

  const btnRefreshList = document.getElementById('btnRefreshList');
  const listLoadingState = document.getElementById('listLoadingState');
  const listEmptyState = document.getElementById('listEmptyState');
  const listErrorBanner = document.getElementById('listErrorBanner');
  const listErrorMessage = document.getElementById('listErrorMessage');
  const btnRetryList = document.getElementById('btnRetryList');

  const tblShipmentChecks = document.getElementById('tblShipmentChecks');
  const tblShipmentChecksBody = document.getElementById('tblShipmentChecksBody');
  const cardListContainer = document.getElementById('cardListContainer');
  const paginationContainer = document.getElementById('paginationContainer');
  const btnPrevPage = document.getElementById('btnPrevPage');
  const btnNextPage = document.getElementById('btnNextPage');
  const pageIndicator = document.getElementById('pageIndicator');

  const detailModal = document.getElementById('detailModal');
  const btnCloseDetail = document.getElementById('btnCloseDetail');
  const btnFooterCloseDetail = document.getElementById('btnFooterCloseDetail');
  const detailBodyContent = document.getElementById('detailBodyContent');

  let currentListPage = 1;
  const listPageLimit = 20;

  // Monthly and Custom Date Range Filter State for 実績一覧
  let currentListMonth = (typeof JstDateUtils !== 'undefined')
    ? JstDateUtils.getTokyoNow().yyyyMm
    : '2026-10';
  let currentListCustomRange = null;
  let lastRenderedShipments = null;
  let employeeBaseCodeMap = {};

  const btnPrevMonthList = document.getElementById('btnPrevMonthList');
  const btnNextMonthList = document.getElementById('btnNextMonthList');
  const inputMonthList = document.getElementById('inputMonthList');
  const txtMonthDisplayList = document.getElementById('txtMonthDisplayList');
  const btnToggleRangeList = document.getElementById('btnToggleRangeList');
  const customRangePanelList = document.getElementById('customRangePanelList');
  const inputStartDateList = document.getElementById('inputStartDateList');
  const inputEndDateList = document.getElementById('inputEndDateList');
  const btnApplyRangeList = document.getElementById('btnApplyRangeList');
  const btnResetRangeList = document.getElementById('btnResetRangeList');
  const rangeErrorList = document.getElementById('rangeErrorList');
  const lblListFilteredCount = document.getElementById('lblListFilteredCount');

  function updateMonthDisplayList() {
    if (txtMonthDisplayList && typeof JstDateUtils !== 'undefined') {
      txtMonthDisplayList.textContent = JstDateUtils.formatYearMonthJp(currentListMonth);
    }
    if (inputMonthList) {
      inputMonthList.value = currentListMonth;
    }
  }

  function toggleCustomRangePanelList() {
    if (!customRangePanelList) return;
    const isOpen = customRangePanelList.style.display !== 'none';
    if (isOpen) {
      customRangePanelList.style.display = 'none';
      btnToggleRangeList?.classList.remove('is-active');
      btnToggleRangeList?.setAttribute('aria-expanded', 'false');
    } else {
      customRangePanelList.style.display = 'block';
      btnToggleRangeList?.classList.add('is-active');
      btnToggleRangeList?.setAttribute('aria-expanded', 'true');
      if (inputStartDateList && inputEndDateList && typeof JstDateUtils !== 'undefined') {
        const range = JstDateUtils.getMonthDateRange(currentListMonth);
        if (!inputStartDateList.value) inputStartDateList.value = range.startDate;
        if (!inputEndDateList.value) inputEndDateList.value = range.endDate;
      }
    }
  }

  function closeCustomRangePanelList() {
    if (customRangePanelList) customRangePanelList.style.display = 'none';
    btnToggleRangeList?.classList.remove('is-active');
    btnToggleRangeList?.setAttribute('aria-expanded', 'false');
    if (rangeErrorList) rangeErrorList.style.display = 'none';
  }

  if (btnPrevMonthList) {
    btnPrevMonthList.addEventListener('click', () => {
      currentListCustomRange = null;
      if (typeof JstDateUtils !== 'undefined') {
        currentListMonth = JstDateUtils.shiftMonth(currentListMonth, -1);
      }
      updateMonthDisplayList();
      closeCustomRangePanelList();
      loadShipmentCheckList(1);
    });
  }

  if (btnNextMonthList) {
    btnNextMonthList.addEventListener('click', () => {
      currentListCustomRange = null;
      if (typeof JstDateUtils !== 'undefined') {
        currentListMonth = JstDateUtils.shiftMonth(currentListMonth, 1);
      }
      updateMonthDisplayList();
      closeCustomRangePanelList();
      loadShipmentCheckList(1);
    });
  }

  if (inputMonthList) {
    inputMonthList.addEventListener('change', (e) => {
      if (e.target.value) {
        currentListCustomRange = null;
        currentListMonth = e.target.value;
        updateMonthDisplayList();
        closeCustomRangePanelList();
        loadShipmentCheckList(1);
      }
    });
  }

  if (btnToggleRangeList) {
    btnToggleRangeList.addEventListener('click', toggleCustomRangePanelList);
  }

  if (btnApplyRangeList) {
    btnApplyRangeList.addEventListener('click', async () => {
      const start = inputStartDateList ? inputStartDateList.value : '';
      const end = inputEndDateList ? inputEndDateList.value : '';
      if (typeof JstDateUtils !== 'undefined') {
        const val = JstDateUtils.validateRange(start, end);
        if (!val.valid) {
          if (rangeErrorList) {
            rangeErrorList.textContent = val.error;
            rangeErrorList.style.display = 'block';
          }
          return;
        }
      }
      if (rangeErrorList) rangeErrorList.style.display = 'none';
      currentListCustomRange = { startDate: start, endDate: end };
      btnApplyRangeList.disabled = true;
      btnApplyRangeList.setAttribute('aria-busy', 'true');
      const originalText = btnApplyRangeList.textContent;
      btnApplyRangeList.innerHTML = '<span class="inline-spinner" role="status" aria-label="読み込み中" style="margin-right:0;"></span>';
      try {
        await loadShipmentCheckList(1);
      } finally {
        btnApplyRangeList.disabled = false;
        btnApplyRangeList.removeAttribute('aria-busy');
        btnApplyRangeList.textContent = originalText || '適用';
      }
    });
  }

  // Initialize Month Display on Startup
  updateMonthDisplayList();

  if (btnResetRangeList) {
    btnResetRangeList.addEventListener('click', () => {
      currentListCustomRange = null;
      closeCustomRangePanelList();
      loadShipmentCheckList(1);
    });
  }

  // View Navigation (TASK-012: Enhanced with aria-current & Auth Guard)
  function switchView(viewName, bypassAuth = false) {
    if (!bypassAuth && !currentAccessContext) {
      showLoginModal('操作を行うにはログインが必要です。');
      return;
    }

    if (!bypassAuth && viewName === 'review') {
      const canReview = (typeof AuthorizationClient !== 'undefined' && typeof AuthorizationClient.canReview === 'function')
        ? AuthorizationClient.canReview(currentAccessContext)
        : false;
      if (!canReview) {
        switchView('record', bypassAuth);
        return;
      }
    }

    btnNavRecord?.classList.toggle('is-active', viewName === 'record');
    btnNavList?.classList.toggle('is-active', viewName === 'list');
    btnNavReview?.classList.toggle('is-active', viewName === 'review');
    btnNavAnalytics?.classList.toggle('is-active', viewName === 'analytics');

    btnNavRecord?.setAttribute('aria-current', viewName === 'record' ? 'page' : 'false');
    btnNavList?.setAttribute('aria-current', viewName === 'list' ? 'page' : 'false');
    btnNavReview?.setAttribute('aria-current', viewName === 'review' ? 'page' : 'false');
    btnNavAnalytics?.setAttribute('aria-current', viewName === 'analytics' ? 'page' : 'false');

    // Horizontal scroll active tab into view without page vertical jump (Section 5)
    const activeBtn = [btnNavRecord, btnNavList, btnNavReview, btnNavAnalytics].find(btn => btn?.classList.contains('is-active'));
    if (activeBtn && typeof activeBtn.scrollIntoView === 'function') {
      try {
        activeBtn.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
      } catch {
        // fallback
      }
    }
    updateNavScrollHint();

    if (viewRecordSection) viewRecordSection.style.display = viewName === 'record' ? 'block' : 'none';
    if (viewListSection) viewListSection.style.display = viewName === 'list' ? 'block' : 'none';
    if (viewReviewSection) viewReviewSection.style.display = viewName === 'review' ? 'block' : 'none';
    if (viewAnalyticsSection) viewAnalyticsSection.style.display = viewName === 'analytics' ? 'block' : 'none';

    if (bypassAuth) {
      return;
    }

    if (viewName === 'list') {
      loadShipmentCheckList(1);
    } else if (viewName === 'review') {
      if (window.ReviewManager) {
        if (typeof window.ReviewManager.init === 'function') {
          window.ReviewManager.init();
        }
        const selArea = document.getElementById('selReviewAreaFilter');
        if ((!selArea || selArea.options.length <= 1) && typeof window.ReviewManager.populateAreaFilter === 'function') {
          window.ReviewManager.populateAreaFilter();
        }
        if (typeof window.ReviewManager.loadReviewList === 'function') {
          window.ReviewManager.loadReviewList();
        }
      }
    } else if (viewName === 'analytics') {
      if (window.AnalyticsView) {
        if (typeof window.AnalyticsView.populateMasterFilters === 'function') {
          window.AnalyticsView.populateMasterFilters();
        }
        if (typeof window.AnalyticsView.loadAnalytics === 'function') {
          window.AnalyticsView.loadAnalytics();
        }
      }
    }
  }

  // Reset all views, form drafts, attachments, filters, and sensitive DOM elements on logout
  function resetViewsForLogout() {
    // Invalidate in-flight async request sequences so delayed responses are discarded (P1 / P2)
    currentListLoadSeq = (currentListLoadSeq || 0) + 1;
    currentDetailLoadSeq = (currentDetailLoadSeq || 0) + 1;
    if (window.ReviewManager) {
      window.ReviewManager.loadSeq = (window.ReviewManager.loadSeq || 0) + 1;
      window.ReviewManager.currentPage = 1;
      window.ReviewManager.customRange = null;
      window.ReviewManager.currentRecord = null;
      window.ReviewManager.lastRenderedReviewItems = null;
      if (typeof JstDateUtils !== 'undefined') {
        window.ReviewManager.targetMonth = JstDateUtils.getTokyoNow().yyyyMm;
        window.ReviewManager.updateMonthDisplayReview();
      }
    }

    // 1. Purge all draft form data, attachments, and error details to prevent cross-user leakage (Finding P1)
    if (typeof formState !== 'undefined' && formState) {
      if (typeof formState.resetForm === 'function') {
        formState.resetForm();
      } else {
        if (typeof formState.cleanupAttachments === 'function') {
          formState.cleanupAttachments();
        }
        formState.attachments = [];
        formState.errorDetails = [formState.createEmptyErrorDetail ? formState.createEmptyErrorDetail() : {}];
        formState.currentEmployee = null;
        formState.selectedLiftOperator = null;
        formState.errors = {};
      }
    }

    // 2. Reset DOM form inputs and draft displays
    const shipmentCheckForm = document.getElementById('shipmentCheckForm');
    if (shipmentCheckForm) {
      shipmentCheckForm.reset();
    }
    const inputLoadingDate = document.getElementById('txtLoadingDate');
    if (inputLoadingDate && typeof formState !== 'undefined' && formState.loadingDate) {
      inputLoadingDate.value = formState.loadingDate;
    }
    const submitResultBanner = document.getElementById('submitResultBanner');
    const submitResultMessage = document.getElementById('submitResultMessage');
    if (submitResultBanner) {
      submitResultBanner.style.display = 'none';
    }
    if (submitResultMessage) {
      submitResultMessage.textContent = '';
    }
    const errorDetailsGlobalError = document.getElementById('errorDetailsGlobalError');
    if (errorDetailsGlobalError) {
      errorDetailsGlobalError.style.display = 'none';
      errorDetailsGlobalError.textContent = '';
    }
    if (countError) {
      countError.style.display = 'none';
      countError.textContent = '';
    }

    if (typeof updateLooseFieldsVisibility === 'function') {
      updateLooseFieldsVisibility();
    }
    if (chkShowAllDrivers) {
      chkShowAllDrivers.checked = false;
      if (driverScopeHint) driverScopeHint.textContent = '※初期状態では所属Baseのリフトマンのみ優先表示されます。';
      if (baseDriverEmptyNotice) baseDriverEmptyNotice.style.display = 'none';
    }
    if (optionalAccordion) {
      optionalAccordion.classList.remove('open');
      if (accordionHeader) accordionHeader.setAttribute('aria-expanded', 'false');
    }

    if (typeof updateEmployeeUI === 'function') updateEmployeeUI();
    if (typeof updateLiftOperatorUI === 'function') updateLiftOperatorUI();
    if (typeof renderErrorDetailCards === 'function') renderErrorDetailCards();
    if (typeof renderAttachments === 'function') renderAttachments();

    // 3. Reset List view filter state and DOM (Finding P2)
    currentListPage = 1;
    currentListCustomRange = null;
    if (typeof JstDateUtils !== 'undefined') {
      currentListMonth = JstDateUtils.getTokyoNow().yyyyMm;
      const txtMonthDisplayList = document.getElementById('txtMonthDisplayList');
      if (txtMonthDisplayList) txtMonthDisplayList.textContent = JstDateUtils.formatYearMonthJp(currentListMonth);
    }
    const inputMonthList = document.getElementById('inputMonthList');
    if (inputMonthList) inputMonthList.value = currentListMonth;
    const customRangePanelList = document.getElementById('customRangePanelList');
    if (customRangePanelList) customRangePanelList.style.display = 'none';
    const btnToggleRangeList = document.getElementById('btnToggleRangeList');
    if (btnToggleRangeList) btnToggleRangeList.setAttribute('aria-expanded', 'false');
    const inputStartDateList = document.getElementById('inputStartDateList');
    if (inputStartDateList) inputStartDateList.value = '';
    const inputEndDateList = document.getElementById('inputEndDateList');
    if (inputEndDateList) inputEndDateList.value = '';
    const selListBaseScope = document.getElementById('selListBaseScope');
    if (selListBaseScope) selListBaseScope.value = 'BASE';

    // 4. Reset Review view filter state and DOM (Finding P2)
    const inputMonthReview = document.getElementById('inputMonthReview');
    if (inputMonthReview && window.ReviewManager) inputMonthReview.value = window.ReviewManager.targetMonth;
    const customRangePanelReview = document.getElementById('customRangePanelReview');
    if (customRangePanelReview) customRangePanelReview.style.display = 'none';
    const btnToggleRangeReview = document.getElementById('btnToggleRangeReview');
    if (btnToggleRangeReview) btnToggleRangeReview.setAttribute('aria-expanded', 'false');
    const inputStartDateReview = document.getElementById('inputStartDateReview');
    if (inputStartDateReview) inputStartDateReview.value = '';
    const inputEndDateReview = document.getElementById('inputEndDateReview');
    if (inputEndDateReview) inputEndDateReview.value = '';
    const chkReviewOnlyUnreviewed = document.getElementById('chkReviewOnlyUnreviewed');
    if (chkReviewOnlyUnreviewed) chkReviewOnlyUnreviewed.checked = true;
    const selReviewArea = document.getElementById('selReviewAreaFilter');
    if (selReviewArea) {
      selReviewArea.innerHTML = '<option value="全国">全国 (全エリア)</option>';
      selReviewArea.value = '全国';
    }

    // 5. Close Detail Modal and purge detail body & actions (Finding P2)
    if (typeof closeDetailModal === 'function') {
      closeDetailModal();
    } else if (detailModal) {
      detailModal.classList.remove('open');
    }
    if (detailBodyContent) {
      detailBodyContent.innerHTML = '';
    }

    // 6. Reset views and lists DOM
    switchView('record', true);

    const reviewListContainer = document.getElementById('reviewListContainer');
    if (reviewListContainer) {
      reviewListContainer.innerHTML = '';
      reviewListContainer.removeAttribute('aria-busy');
      reviewListContainer.style.opacity = '1';
    }

    if (tblShipmentChecksBody) tblShipmentChecksBody.innerHTML = '';
    if (cardListContainer) cardListContainer.innerHTML = '';
    lastRenderedShipments = null;

    const listEmptyState = document.getElementById('listEmptyState');
    if (listEmptyState) listEmptyState.style.display = 'none';
    const listLoadingState = document.getElementById('listLoadingState');
    if (listLoadingState) listLoadingState.style.display = 'none';

    const lblListFilteredCount = document.getElementById('lblListFilteredCount');
    if (lblListFilteredCount) lblListFilteredCount.textContent = '0件';
    const lblReviewTotalCount = document.getElementById('lblReviewTotalCount');
    if (lblReviewTotalCount) lblReviewTotalCount.textContent = '0';

    // 7. Clear Master Client session cache
    if (window.masterClient && typeof window.masterClient.clearCache === 'function') {
      window.masterClient.clearCache();
    }
  }

  if (btnNavRecord) btnNavRecord.addEventListener('click', () => switchView('record'));
  if (btnNavList) btnNavList.addEventListener('click', () => switchView('list'));
  if (btnNavReview) btnNavReview.addEventListener('click', () => switchView('review'));
  if (btnNavAnalytics) btnNavAnalytics.addEventListener('click', () => switchView('analytics'));
  if (btnRefreshList) btnRefreshList.addEventListener('click', () => loadShipmentCheckList(currentListPage, true));
  if (btnRetryList) btnRetryList.addEventListener('click', () => loadShipmentCheckList(currentListPage, true));

  // Login Form Submission (BROWSER_INTEGRATION_PHASE_1)
  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!authClient) {
        showLoginModal('認証クライアントが初期化されていません。');
        return;
      }

      const empNo = txtLoginEmpNo ? txtLoginEmpNo.value.trim() : '';
      const password = txtLoginPassword ? txtLoginPassword.value : '';

      if (!empNo) {
        showLoginModal('社員番号を入力してください。');
        return;
      }
      if (!password) {
        showLoginModal('パスワードを入力してください。');
        return;
      }

      if (btnLoginSubmit) {
        btnLoginSubmit.disabled = true;
        btnLoginSubmit.textContent = '認証中...';
      }

      try {
        await authClient.login(empNo, password);
        const ctx = await authClient.getAccessContext();
        if (ctx && ctx.empNo) {
          hideLoginModal();
          switchView('record');
          if (typeof closeEmployeeModal === 'function') {
            closeEmployeeModal();
          }
          applyAccessContext(ctx);
        } else {
          throw new Error('Access context resolution failed');
        }
      } catch (loginErr) {
        console.error('Login failed:', loginErr);
        let msg = '社員番号またはパスワードが正しくありません。';
        if (loginErr && loginErr.name === 'TransportError') {
          msg = loginErr.message || '通信エラーが発生しました。接続状況を確認の上、再試行してください。';
        } else if (loginErr && loginErr.code === 'INVALID_CREDENTIALS') {
          msg = '社員番号またはパスワードが正しくありません。';
        } else if (loginErr && loginErr.code === 'ACCOUNT_LOCKED') {
          msg = 'アカウントが一時的にロックされています。時間をおいて再試行してください。';
        }
        showLoginModal(msg);
      } finally {
        if (btnLoginSubmit) {
          btnLoginSubmit.disabled = false;
          btnLoginSubmit.textContent = 'ログイン';
        }
      }
    });
  }

  // Header Logout Handler (BROWSER_INTEGRATION_PHASE_1 & Section 6: Loading Feedback)
  let isLoggingOut = false;
  if (btnHeaderLogout) {
    btnHeaderLogout.addEventListener('click', async () => {
      if (isLoggingOut) return;
      isLoggingOut = true;

      btnHeaderLogout.disabled = true;
      btnHeaderLogout.setAttribute('aria-busy', 'true');
      btnHeaderLogout.innerHTML = '<span class="inline-spinner" role="status" aria-label="ログアウト処理中"></span><span class="sr-only">ログアウト処理中 ログアウト中...</span>';

      let serverRevoked = true;
      try {
        if (authClient && typeof authClient.logout === 'function') {
          // Timeout race 5000ms
          const logoutPromise = authClient.logout();
          const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('TIMEOUT')), 5000)
          );
          await Promise.race([logoutPromise, timeoutPromise]);
        }
      } catch (logoutErr) {
        console.warn('Server logout error (best-effort):', logoutErr);
        serverRevoked = false;
      } finally {
        try {
          if (typeof SessionClient !== 'undefined' && typeof SessionClient.clearToken === 'function') {
            SessionClient.clearToken();
          }
        } catch (e) {
          console.warn('SessionClient clearToken error:', e);
        }
        try {
          if (typeof shipmentCache !== 'undefined' && shipmentCache.invalidateAll) {
            shipmentCache.invalidateAll();
          }
        } catch (e) {
          console.warn('shipmentCache invalidateAll error:', e);
        }
        lastRenderedShipments = null;
        currentAccessContext = null;
        window.__CURRENT_ACCESS_CONTEXT__ = null;
        try {
          if (formState) {
            if (typeof formState.clearStoredEmployee === 'function') {
              formState.clearStoredEmployee(typeof localStorage !== 'undefined' ? localStorage : null);
            } else {
              formState.currentEmployee = null;
            }
            if (typeof updateEmployeeUI === 'function') {
              updateEmployeeUI();
            }
          }
        } catch (e) {
          console.warn('formState clear error:', e);
        }
        try {
          if (headerUserName) headerUserName.textContent = '';
          if (headerAuthBadge) {
            headerAuthBadge.style.display = 'none';
            headerAuthBadge.setAttribute('hidden', '');
          }
          if (btnHeaderLogout) {
            btnHeaderLogout.style.display = 'none';
            btnHeaderLogout.disabled = false;
            btnHeaderLogout.removeAttribute('aria-busy');
            btnHeaderLogout.textContent = 'ログアウト';
          }
          if (btnNavReview) {
            btnNavReview.style.display = 'none';
            btnNavReview.setAttribute('hidden', '');
          }
        } catch (e) {
          console.warn('UI reset error:', e);
        }
        try {
          resetViewsForLogout();
        } catch (e) {
          console.warn('resetViewsForLogout error:', e);
        }
        isLoggingOut = false;

        const noticeMsg = serverRevoked
          ? 'ログアウトしました。再度ログインしてください。'
          : 'ログアウトしました（サーバー通知未達）。再度ログインしてください。';
        showLoginModal(noticeMsg);
      }
    });
  }

  // Helper: Review Status Badge
  function getReviewBadgeHtml(status) {
    const s = status || '未確認';
    let cls = 'review-unconfirmed';
    if (s === 'OK') cls = 'review-ok';
    else if (s === 'NG') cls = 'review-ng';
    return `<span class="badge-review ${cls}">${escapeHtml(s)}</span>`;
  }

  function formatDisplayDate(dateVal) {
    if (!dateVal) return '---';
    if (typeof dateVal === 'string') {
      const trimmed = dateVal.trim();
      if (/^\d{4}[-/]\d{2}[-/]\d{2}$/.test(trimmed)) {
        return trimmed.replace(/-/g, '/');
      }
      if (trimmed.includes('T') || trimmed.includes('Z')) {
        try {
          const d = new Date(trimmed);
          if (!isNaN(d.getTime())) {
            const yr = d.getFullYear();
            const mo = String(d.getMonth() + 1).padStart(2, '0');
            const da = String(d.getDate()).padStart(2, '0');
            return `${yr}/${mo}/${da}`;
          }
        } catch {
          // fallback
        }
      }
      return trimmed;
    }
    return String(dateVal);
  }

  function formatDateTimeString(isoStr) {
    if (!isoStr) return '---';
    try {
      const d = new Date(isoStr);
      if (isNaN(d.getTime())) return isoStr;
      const yr = d.getFullYear();
      const mo = String(d.getMonth() + 1).padStart(2, '0');
      const da = String(d.getDate()).padStart(2, '0');
      const hr = String(d.getHours()).padStart(2, '0');
      const mi = String(d.getMinutes()).padStart(2, '0');
      return `${yr}/${mo}/${da} ${hr}:${mi}`;
    } catch {
      return isoStr;
    }
  }

  // Load Result List (Fast UX: Cache-First Instant Display)
  let currentListLoadSeq = 0;
  async function loadShipmentCheckList(page = 1, bypassCache = false) {
    const seq = ++currentListLoadSeq;
    currentListPage = page;
    updateMonthDisplayList();
    if (listErrorBanner) listErrorBanner.style.display = 'none';
    if (listEmptyState) listEmptyState.style.display = 'none';

    const userBaseCode = currentAccessContext?.baseCode || null;
    const userEmpNo = currentAccessContext?.empNo || '';
    const isAreaManager = (currentAccessContext?.capabilities || []).includes('SHIPMENT_REVIEW_NATIONWIDE') || currentAccessContext?.roleCode === 'AreaManager';
    const selListBaseScope = document.getElementById('selListBaseScope');
    const selectedScope = selListBaseScope ? selListBaseScope.value : (isAreaManager ? 'ALL' : 'BASE');
    const effectiveBaseCode = (selectedScope === 'BASE' && userBaseCode) ? userBaseCode : undefined;

    const cacheScope = {
      action: 'shipment.list',
      empNo: userEmpNo,
      baseCode: effectiveBaseCode || 'ALL',
      month: currentListCustomRange ? '' : currentListMonth,
      startDate: currentListCustomRange ? currentListCustomRange.startDate : '',
      endDate: currentListCustomRange ? currentListCustomRange.endDate : '',
      page: page,
      limit: listPageLimit
    };
    const cacheKey = (typeof shipmentCache !== 'undefined')
      ? shipmentCache.buildKey(cacheScope)
      : `shipment.list:${userEmpNo}:${effectiveBaseCode || 'ALL'}:${currentListMonth}:${page}`;

    const isCached = !bypassCache && typeof shipmentCache !== 'undefined' && shipmentCache.has(cacheKey);

    const listLoadingIndicator = document.getElementById('listLoadingIndicator');
    const shipmentCheckListContainer = document.getElementById('shipmentCheckListContainer');

    // Only dim table and show full loading block when not cached (Fast UX)
    if (!isCached) {
      if (listLoadingState) listLoadingState.style.display = 'block';
      if (listLoadingIndicator) listLoadingIndicator.style.display = 'inline-block';
      if (shipmentCheckListContainer) {
        shipmentCheckListContainer.style.opacity = '0.6';
        shipmentCheckListContainer.setAttribute('aria-busy', 'true');
      }
    } else {
      if (listLoadingIndicator) listLoadingIndicator.style.display = 'inline-block';
    }

    if (btnRefreshList) {
      btnRefreshList.disabled = true;
      btnRefreshList.setAttribute('aria-busy', 'true');
    }

    try {
      // Section 8: Missing BaseCode handling
      if (selectedScope === 'BASE' && (!userBaseCode || userBaseCode === '所属未登録' || userBaseCode === 'Base未登録')) {
        if (listLoadingState) listLoadingState.style.display = 'none';
        if (listEmptyState) {
          listEmptyState.textContent = '所属Baseを確認できません。社員マスターの登録状況を確認してください。';
          listEmptyState.style.display = 'block';
        }
        if (tblShipmentChecksBody) tblShipmentChecksBody.innerHTML = '';
        if (cardListContainer) cardListContainer.innerHTML = '';
        if (paginationContainer) paginationContainer.style.display = 'none';
        if (lblListFilteredCount) lblListFilteredCount.textContent = '0件';
        lastRenderedShipments = [];
        return;
      }

      const fetcher = async () => {
        const serverOptions = {
          page: page,
          limit: listPageLimit,
          month: currentListCustomRange ? undefined : currentListMonth,
          startDate: currentListCustomRange ? currentListCustomRange.startDate : undefined,
          endDate: currentListCustomRange ? currentListCustomRange.endDate : undefined,
          baseCode: effectiveBaseCode
        };
        if (shipmentClient && typeof shipmentClient.listShipments === 'function') {
          return await shipmentClient.listShipments(serverOptions);
        } else if (rpcClient && typeof rpcClient.call === 'function') {
          return await rpcClient.call('shipment.list', { options: serverOptions });
        }
        throw new Error('RPCクライアントが利用できません');
      };

      let res;
      if (typeof shipmentCache !== 'undefined' && typeof shipmentCache.fetchWithDeduplication === 'function') {
        const cacheRes = await shipmentCache.fetchWithDeduplication(cacheKey, fetcher, { bypassCache: bypassCache });
        res = cacheRes.data;
      } else {
        res = await fetcher();
      }

      if (seq !== currentListLoadSeq) {
        return;
      }

      if (listLoadingState) listLoadingState.style.display = 'none';

      let shipments = (res && res.payload && Array.isArray(res.payload.shipments))
        ? res.payload.shipments
        : ((res && Array.isArray(res.shipments)) ? res.shipments : []);

      // Check if response is server-paginated (GAS Version 10)
      const rawTotal = (res && res.payload && typeof res.payload.total === 'number')
        ? res.payload.total
        : ((res && typeof res.total === 'number') ? res.total : null);
      const isServerPaginated = rawTotal !== null;

      let pagedItems;
      let effectiveTotal;
      let totalPages;
      let safePage;

      if (isServerPaginated) {
        effectiveTotal = rawTotal;
        totalPages = (res.payload?.totalPages ?? res.totalPages) || (effectiveTotal === 0 ? 1 : Math.ceil(effectiveTotal / listPageLimit));
        safePage = (res.payload?.page ?? res.page) || page;
        pagedItems = shipments; // Server already sliced the page (PAGE-009: no double slice)
      } else {
        // Fallback for legacy Version 9: client-side filtering and slicing (PAGE-010)
        let baseFiltered = shipments.filter(item => {
          if (selectedScope === 'ALL' || isAreaManager) return true;
          if (!userBaseCode) return item.employeeCode === userEmpNo;
          if (item.historicalBaseCode) return item.historicalBaseCode === userBaseCode;
          if (item.baseCode) return item.baseCode === userBaseCode;
          return item.employeeCode === userEmpNo;
        });

        let dateFiltered = baseFiltered.filter(item => {
          const dateStr = item.loadingDate || (item.inputStartedAt ? item.inputStartedAt.slice(0, 10) : (item.registeredAt ? item.registeredAt.slice(0, 10) : ''));
          if (!dateStr) return false;
          if (currentListCustomRange) {
            return dateStr >= currentListCustomRange.startDate && dateStr <= currentListCustomRange.endDate;
          } else {
            return dateStr.startsWith(currentListMonth);
          }
        });

        const total = dateFiltered.length;
        effectiveTotal = total;
        totalPages = Math.max(1, Math.ceil(total / listPageLimit));
        safePage = Math.min(page, totalPages);
        pagedItems = dateFiltered.slice((safePage - 1) * listPageLimit, safePage * listPageLimit);
      }

      if (lblListFilteredCount) {
        lblListFilteredCount.textContent = `${effectiveTotal}件`;
      }

      if (effectiveTotal === 0) {
        if (listEmptyState) {
          listEmptyState.textContent = '対象期間に実績はありません。';
          listEmptyState.style.display = 'block';
        }
        if (tblShipmentChecksBody) tblShipmentChecksBody.innerHTML = '';
        if (cardListContainer) cardListContainer.innerHTML = '';
        if (paginationContainer) paginationContainer.style.display = 'none';
        lastRenderedShipments = [];
        return;
      }

      // Response Change Detection: skip DOM replacement if pagedItems are identical
      if (typeof isSameShipmentList === 'function' && isSameShipmentList(lastRenderedShipments, pagedItems) && (tblShipmentChecksBody?.children.length > 0 || cardListContainer?.children.length > 0)) {
        if (paginationContainer && pageIndicator && btnPrevPage && btnNextPage) {
          pageIndicator.textContent = `${safePage} / ${totalPages} ページ (全 ${effectiveTotal} 件)`;
          btnPrevPage.disabled = safePage <= 1;
          btnNextPage.disabled = safePage >= totalPages;
          paginationContainer.style.display = 'flex';
        }
        return;
      }

      lastRenderedShipments = pagedItems;
      if (tblShipmentChecksBody) tblShipmentChecksBody.innerHTML = '';
      if (cardListContainer) cardListContainer.innerHTML = '';

      renderListItems(pagedItems);

      // Pagination setup
      if (paginationContainer && pageIndicator && btnPrevPage && btnNextPage) {
        pageIndicator.textContent = `${safePage} / ${totalPages} ページ (全 ${effectiveTotal} 件)`;
        btnPrevPage.disabled = safePage <= 1;
        btnNextPage.disabled = safePage >= totalPages;
        paginationContainer.style.display = 'flex';
      }
    } catch (err) {
      console.error('loadShipmentCheckList error:', err);
      if (seq !== currentListLoadSeq) return;
      if (listLoadingState) listLoadingState.style.display = 'none';
      if (lblListFilteredCount) lblListFilteredCount.textContent = '---';
      if (listErrorBanner && listErrorMessage) {
        listErrorMessage.textContent = '実績データの取得に失敗しました。接続状況を確認の上、再試行してください。';
        listErrorBanner.style.display = 'block';
      }
    } finally {
      if (seq === currentListLoadSeq) {
        if (listLoadingState) listLoadingState.style.display = 'none';
        const listLoadingIndicator = document.getElementById('listLoadingIndicator');
        if (listLoadingIndicator) listLoadingIndicator.style.display = 'none';
        const shipmentCheckListContainer = document.getElementById('shipmentCheckListContainer');
        if (shipmentCheckListContainer) {
          shipmentCheckListContainer.style.opacity = '1';
          shipmentCheckListContainer.removeAttribute('aria-busy');
        }
        if (btnRefreshList) {
          btnRefreshList.disabled = false;
          btnRefreshList.removeAttribute('aria-busy');
        }
      }
    }
  }

  const selListBaseScopeEl = document.getElementById('selListBaseScope');
  if (selListBaseScopeEl) {
    selListBaseScopeEl.addEventListener('change', () => {
      loadShipmentCheckList(1, false);
    });
  }

  if (btnPrevPage) {
    btnPrevPage.addEventListener('click', () => {
      if (currentListPage > 1) loadShipmentCheckList(currentListPage - 1);
    });
  }
  if (btnNextPage) {
    btnNextPage.addEventListener('click', () => {
      loadShipmentCheckList(currentListPage + 1);
    });
  }

  // Render List Items (Table on PC & Compact Cards on iPhone)
  function renderListItems(items) {
    if (!tblShipmentChecksBody || !cardListContainer) return;

    items.forEach((item) => {
      const checkId = item.shippingCheckId;
      const rawDate = item.loadingDate || (item.inputStartedAt ? item.inputStartedAt.slice(0, 10) : '---');
      const loadingDate = formatDisplayDate(rawDate);
      const baseName = item.historicalBaseName || item.HistoricalBaseName || item.baseName || item.BaseName || '---';
      const empName = item.employeeName || item.EmployeeName || item.empName || '---';
      const liftName = item.liftOperatorName || item.LiftOperatorName || '---';
      const partnerName = item.partnerName || item.PartnerName || '---';
      const errCount = (typeof item.errorDetailsCount === 'number')
        ? item.errorDetailsCount
        : ((item.errorDetails && Array.isArray(item.errorDetails))
          ? item.errorDetails.length
          : ((typeof item.equipmentTypeCount === 'number' && item.equipmentTypeCount > 0) ? item.equipmentTypeCount : 1));
      const badgeHtml = getReviewBadgeHtml(item.reviewStatus);

      // 1. Desktop Table Row (7 canonical columns: 積込日, 拠点名, 担当社員名, 協力会社名, リフトマン名, 積み間違い件数, 確認状況)
      const tr = document.createElement('tr');
      tr.tabIndex = 0;
      tr.setAttribute('role', 'button');
      tr.setAttribute('aria-label', `${loadingDate} ${baseName} の詳細を開く`);
      tr.innerHTML = `
        <td style="font-weight: 700; color: var(--palette-headline); font-size: 0.95rem;">${escapeHtml(loadingDate)}</td>
        <td>${escapeHtml(baseName)}</td>
        <td>${escapeHtml(empName)}</td>
        <td>${escapeHtml(partnerName)}</td>
        <td>${escapeHtml(liftName)}</td>
        <td style="text-align: center; font-weight: 700; color: #DC2626;">${errCount}件</td>
        <td style="text-align: center;">${badgeHtml}</td>
      `;
      const openRowAction = () => openDetailView(checkId);
      tr.addEventListener('click', openRowAction);
      tr.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openRowAction();
        }
      });
      tblShipmentChecksBody.appendChild(tr);

      // 2. iPhone Compact Card (~3 rows per UI-REVIEW-003)
      // Row 1: loadingDate / 積み間違い件数 (errCount)
      // Row 2: historicalBaseName / employeeName
      // Row 3: partnerName / liftOperatorName
      const card = document.createElement('div');
      card.className = 'compact-result-card';
      card.tabIndex = 0;
      card.setAttribute('role', 'button');
      card.setAttribute('aria-label', `${loadingDate} ${baseName} の詳細を開く`);
      card.innerHTML = `
        <div class="compact-card-row-1">
          <span class="compact-date-base">${escapeHtml(loadingDate)}　エラー ${errCount}件</span>
          ${badgeHtml}
        </div>
        <div class="compact-card-row-2">
          ${escapeHtml(baseName)} / ${escapeHtml(empName)}
        </div>
        <div class="compact-card-row-3">
          <span>${escapeHtml(partnerName)} / ${escapeHtml(liftName)}</span>
          <span style="font-size: 0.8rem; color: var(--palette-paragraph);">詳細 →</span>
        </div>
      `;
      card.addEventListener('click', openRowAction);
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openRowAction();
        }
      });
      cardListContainer.appendChild(card);
    });
  }

  let currentDetailLoadSeq = 0;

  // Open Detail View
  async function openDetailView(shippingCheckId) {
    if (!detailModal || !detailBodyContent) return;

    currentDetailLoadSeq = (currentDetailLoadSeq || 0) + 1;
    const seq = currentDetailLoadSeq;

    document.body.style.overflow = 'hidden';
    detailBodyContent.innerHTML = '<div style="padding: 32px; text-align: center; color: var(--color-text-muted);">実績詳細を読み込み中...</div>';
    detailModal.classList.add('open');

    try {
      let detailData = null;
      if (shipmentClient && typeof shipmentClient.getShipment === 'function') {
        const res = await shipmentClient.getShipment(shippingCheckId);
        detailData = (res && res.payload) ? res.payload : (res || {});
      } else if (rpcClient && typeof rpcClient.call === 'function') {
        const res = await rpcClient.call('shipment.get', { shippingCheckId: shippingCheckId });
        detailData = (res && res.payload) ? res.payload : (res || {});
      } else {
        throw new Error('RPCクライアントが利用できません');
      }

      if (seq !== currentDetailLoadSeq) return;

      renderDetailContent(detailData);
    } catch (err) {
      if (seq !== currentDetailLoadSeq) return;
      detailBodyContent.innerHTML = '<div style="padding: 24px; color: #DC2626; text-align: center;">詳細データの取得に失敗しました。接続状況を確認の上、再試行してください。</div>';
    }
  }

  // Export openDetailView globally for review.js and external callers
  window.openDetailView = openDetailView;
  window.openShipmentCheckDetail = openDetailView;

  function closeDetailModal() {
    if (detailModal) detailModal.classList.remove('open');
    if (detailBodyContent) detailBodyContent.innerHTML = '';
    if (window.ReviewManager) window.ReviewManager.currentRecord = null;
    document.body.style.overflow = '';
  }

  if (btnCloseDetail) btnCloseDetail.addEventListener('click', closeDetailModal);
  if (btnFooterCloseDetail) btnFooterCloseDetail.addEventListener('click', closeDetailModal);
  if (detailModal) {
    detailModal.addEventListener('click', (e) => {
      if (e.target === detailModal) {
        closeDetailModal();
      }
    });
  }

  // Render Detail Content
  function renderDetailContent(data) {
    if (!detailBodyContent) return;

    // Normalize DTO structure: handles both { shipmentCheck, details } from GAS and flat DTO
    const parent = (data && data.shipmentCheck) ? data.shipmentCheck : (data || {});
    const details = (data && Array.isArray(data.details))
      ? data.details
      : ((parent && Array.isArray(parent.details))
        ? parent.details
        : (data.errorDetails || (parent && parent.errorDetails) || []));
    const attachments = (data && Array.isArray(data.attachments))
      ? data.attachments
      : ((parent && Array.isArray(parent.attachments))
        ? parent.attachments
        : []);

    const regTime = formatDateTimeString(parent.registeredAt);
    const inStartTime = formatDateTimeString(parent.inputStartedAt || parent.inputStartAt);
    const badgeHtml = getReviewBadgeHtml(parent.reviewStatus);

    // Parent Information Grid
    let parentHtml = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: var(--space-md); padding-bottom: 10px; border-bottom: 1px solid var(--color-border);">
        <div>
          <div style="font-size: 1.1rem; font-weight: bold; color: var(--color-text-main);">${escapeHtml(regTime)} 登録</div>
          <div style="font-size: 0.85rem; color: var(--color-text-muted);">入力開始: ${escapeHtml(inStartTime)}</div>
        </div>
        ${badgeHtml}
      </div>

      <div class="detail-info-grid">
        <div class="detail-info-item">
          <span class="detail-info-label">担当社員</span>
          <span class="detail-info-val">${escapeHtml(parent.employeeName || '---')} (${escapeHtml(parent.employeeCode || '---')})</span>
        </div>
        <div class="detail-info-item">
          <span class="detail-info-label">所属拠点 / エリア</span>
          <span class="detail-info-val">${escapeHtml(parent.historicalBaseName || '---')} / ${escapeHtml(parent.historicalAreaName || 'エリア未設定')}</span>
        </div>
        <div class="detail-info-item">
          <span class="detail-info-label">リフトマン</span>
          <span class="detail-info-val">${escapeHtml(parent.liftOperatorName || '---')} (${escapeHtml(parent.liftOperatorCode || '---')})</span>
        </div>
        <div class="detail-info-item">
          <span class="detail-info-label">協力会社</span>
          <span class="detail-info-val">${escapeHtml(parent.partnerName || '---')} (${escapeHtml(parent.partnerCode || '---')})</span>
        </div>
        <div class="detail-info-item">
          <span class="detail-info-label">点検品種数 / バラ有無</span>
          <span class="detail-info-val">${parent.equipmentTypeCount ?? '---'} 品種 / ${parent.hasLooseItems ? 'バラあり' : 'バラなし'}</span>
        </div>
        <div class="detail-info-item">
          <span class="detail-info-label">バラ作成担当者 / 状況</span>
          <span class="detail-info-val">${escapeHtml(parent.looseItemCreatorName || '未入力')} / ${escapeHtml(parent.looseItemStatus || '未設定')}</span>
        </div>
        <div class="detail-info-item">
          <span class="detail-info-label">便種別 / 運送会社 / 運転手</span>
          <span class="detail-info-val">${escapeHtml(parent.transportCategory || '---')} / ${escapeHtml(parent.carrierName || '未入力')} / ${escapeHtml(parent.driverName || '未入力')}</span>
        </div>
        <div class="detail-info-item">
          <span class="detail-info-label">審査情報</span>
          <span class="detail-info-val">${escapeHtml(parent.reviewStatus || '未確認')}${parent.reviewerName ? ' (' + escapeHtml(parent.reviewerName) + ')' : ''}</span>
        </div>
      </div>
    `;

    // Review Details section if reviewed
    if (parent.reviewComment || parent.reviewedAt) {
      parentHtml += `
        <div style="background: #F8FAFC; padding: 12px; border-radius: var(--radius-sm); margin-bottom: var(--space-md); border-left: 4px solid var(--color-primary);">
          <div style="font-size: 0.85rem; font-weight: bold; color: var(--color-text-muted);">審査履歴</div>
          <div style="font-size: 0.9rem; margin-top: 4px;">${escapeHtml(parent.reviewComment || 'コメントなし')}</div>
          <div style="font-size: 0.8rem; color: var(--color-text-muted); margin-top: 4px;">審査日時: ${formatDateTimeString(parent.reviewedAt)}</div>
        </div>
      `;
    }

    // 1..N Shipping Error Details
    let detailsHtml = `
      <div style="margin-top: var(--space-lg);">
        <h3 style="font-size: 1.05rem; font-weight: bold; margin-bottom: var(--space-sm); color: var(--color-text-main); display: flex; align-items: center; gap: 8px;">
          <span>積み間違い資材</span>
          <span class="badge" style="background: #FEE2E2; color: #DC2626;">${details.length}件</span>
        </h3>
    `;

    if (details.length === 0) {
      detailsHtml += '<div style="padding: 16px; color: var(--color-text-muted); background: #F8FAFC; border-radius: 6px;">積み間違い資材はありません</div>';
    } else {
      details.forEach((d, idx) => {
        const cat = d.category || '区分未設定';
        const matName = d.materialName || '資材名未設定';
        const matCode = d.materialCode || '---';
        const cause = d.causeDetail || '詳細未入力';

        detailsHtml += `
          <div class="detail-child-card">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
              <span style="font-weight: bold; font-size: 0.95rem; color: var(--color-text-main);">#${idx + 1}</span>
              <span class="badge" style="background: #EFF6FF; color: #1D4ED8; font-weight: 700;">${escapeHtml(cat)}</span>
            </div>
            <div style="font-size: 0.95rem; font-weight: 600; color: var(--color-text-main); margin-bottom: 4px;">
              ${escapeHtml(matName)}
            </div>
            <div style="font-size: 0.82rem; color: var(--color-text-muted); margin-bottom: 8px;">
              資材コード: ${escapeHtml(matCode)}
            </div>
            <div style="font-size: 0.88rem; background: #FFFFFF; padding: 10px; border-radius: 4px; border: 1px solid var(--color-border); white-space: pre-wrap;">
              ${escapeHtml(cause)}
            </div>
          </div>
        `;
      });
    }
    detailsHtml += '</div>';

    // 0..N Attachment Metadata
    let attHtml = `
      <div style="margin-top: var(--space-lg); margin-bottom: var(--space-md);">
        <h3 style="font-size: 1.05rem; font-weight: bold; margin-bottom: var(--space-sm); color: var(--color-text-main); display: flex; align-items: center; gap: 8px;">
          <span>証跡添付</span>
          <span class="badge" style="background: #F1F5F9; color: #475569;">${attachments.length}件</span>
        </h3>
    `;

    if (attachments.length === 0) {
      attHtml += '<div style="padding: 16px; color: var(--color-text-muted); background: #F8FAFC; border-radius: 6px;">添付ファイルはありません</div>';
    } else {
      attachments.forEach((a) => {
        const isPdf = a.attachmentType === 'pdf_link';
        const typeBadge = isPdf
          ? '<span class="attachment-type-badge pdf">PDFリンク</span>'
          : '<span class="attachment-type-badge photo">写真</span>';
        const filename = a.originalFilename || (isPdf ? 'PDFファイル' : '写真');
        const loc = a.storageLocation || '参照先未設定';

        attHtml += `
          <div class="detail-child-card" style="display: flex; justify-content: space-between; align-items: center; gap: 12px;">
            <div style="flex: 1; min-width: 0;">
              <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
                ${typeBadge}
                <span style="font-weight: 600; font-size: 0.9rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(filename)}</span>
              </div>
              <div style="font-size: 0.8rem; color: var(--color-text-muted); word-break: break-all;">
                参照先: ${escapeHtml(loc)}
              </div>
            </div>
            ${isPdf && loc && loc !== '参照先未設定' ? `
              <button type="button" class="btn btn-secondary btn-copy-loc" data-loc="${escapeHtml(loc)}" style="min-height: 40px; padding: 4px 12px; font-size: 0.85rem; white-space: nowrap;">
                リンクをコピー
              </button>
            ` : ''}
          </div>
        `;
      });
    }
    attHtml += '</div>';

    detailBodyContent.innerHTML = parentHtml + detailsHtml + attHtml;

    // TASK-010: Render Review Action Panel
    const accessCtx = (typeof currentAccessContext !== 'undefined' ? currentAccessContext : null)
      || (typeof window !== 'undefined' ? window.__CURRENT_ACCESS_CONTEXT__ : null);
    const hasReviewCapability = (typeof AuthorizationClient !== 'undefined' && typeof AuthorizationClient.hasCapability === 'function')
      ? AuthorizationClient.hasCapability(accessCtx, 'SHIPMENT_REVIEW_NATIONWIDE')
      : Boolean(accessCtx && Array.isArray(accessCtx.capabilities) && accessCtx.capabilities.includes('SHIPMENT_REVIEW_NATIONWIDE'));

    const reviewSecElem = (typeof viewReviewSection !== 'undefined' ? viewReviewSection : null)
      || (typeof document !== 'undefined' ? document.getElementById('viewReviewSection') : null);
    const isReviewViewActive = Boolean(reviewSecElem && reviewSecElem.style.display !== 'none');
    const shouldRenderReviewPanel = hasReviewCapability || isReviewViewActive;

    let reviewSecHtml = '';
    if (shouldRenderReviewPanel) {
      reviewSecHtml = '<div id="detailReviewActionSection" class="detail-review-action-section" style="margin-top: var(--space-lg); margin-bottom: 24px;"></div>';
    }

    detailBodyContent.innerHTML = parentHtml + detailsHtml + attHtml + reviewSecHtml;

    if (shouldRenderReviewPanel) {
      const reviewActionContainer = document.getElementById('detailReviewActionSection');
      if (reviewActionContainer && window.ReviewManager && typeof window.ReviewManager.renderReviewActionPanel === 'function') {
        if (!parent.shippingCheckId && data && data.shippingCheckId) {
          parent.shippingCheckId = data.shippingCheckId;
        }
        window.ReviewManager.renderReviewActionPanel(reviewActionContainer, parent);
      }
    }

    // Attach copy event
    const copyBtns = detailBodyContent.querySelectorAll('.btn-copy-loc');
    copyBtns.forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        const loc = e.target.getAttribute('data-loc');
        if (loc && navigator.clipboard) {
          try {
            await navigator.clipboard.writeText(loc);
            const origText = btn.textContent;
            btn.textContent = 'コピー完了！';
            setTimeout(() => { btn.textContent = origText; }, 2000);
          } catch {
            if (typeof modalManager !== 'undefined' && modalManager.error) {
              modalManager.error('エラー', 'コピーに失敗しました: ' + loc);
            }
          }
        }
      });
    });
  }

  // 5. Initialize Authentication & Session Restore (BROWSER_INTEGRATION_PHASE_1)
  await initAuthSession();

});


  // Global Escape key handler for modal dialogs (TASK-012 Accessibility / UI-REVIEW-003-R1)
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' || e.keyCode === 27) {
      const openModals = document.querySelectorAll('.modal-overlay.open, .modal-overlay[style*="display: flex"]');
      openModals.forEach(m => {
        m.classList.remove('open');
        m.style.display = 'none';
      });
      document.body.style.overflow = '';
      if (typeof closeDriverModal === 'function') {
        closeDriverModal();
      }
      if (typeof closeEmployeeModal === 'function') {
        closeEmployeeModal();
      }
      if (typeof closeMaterialModal === 'function') {
        closeMaterialModal();
      }
      if (typeof closeDetailModal === 'function') {
        closeDetailModal();
      }
    }
  });