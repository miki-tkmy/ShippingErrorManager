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

  // Authentication State & DOM Elements (BROWSER_INTEGRATION_PHASE_1 & SIMPLE_EMPLOYEE_LOGIN)
  let currentAccessContext = null;
  const loginModal = document.getElementById('loginModal');
  const loginForm = document.getElementById('loginForm');
  const txtLoginEmpNo = document.getElementById('txtLoginEmpNo');
  const txtLoginPassword = document.getElementById('txtLoginPassword');
  const divLoginPasswordGroup = document.getElementById('divLoginPasswordGroup');
  const divNewPasswordGroup = document.getElementById('divNewPasswordGroup');
  const txtLoginNewPassword = document.getElementById('txtLoginNewPassword');
  const txtLoginNewPasswordConfirm = document.getElementById('txtLoginNewPasswordConfirm');
  const btnToggleAdminLogin = document.getElementById('btnToggleAdminLogin');
  const loginPromptText = document.getElementById('loginPromptText');
  const loginModalTitle = document.getElementById('loginModalTitle');
  const loginMessage = document.getElementById('loginMessage');
  const btnLoginSubmit = document.getElementById('btnLoginSubmit');
  const headerAuthBadge = document.getElementById('headerAuthBadge');
  const headerUserName = document.getElementById('headerUserName');
  const btnHeaderSwitchUser = document.getElementById('btnHeaderSwitchUser');
  const btnHeaderLogout = document.getElementById('btnHeaderLogout');
  const btnNavReview = document.getElementById('btnNavReview');
  let isAdminLoginMode = false;
  let isPasswordChangeRequiredMode = false;

  function setLoginMode(isAdmin, requirePasswordChange = false) {
    isAdminLoginMode = Boolean(isAdmin);
    isPasswordChangeRequiredMode = Boolean(requirePasswordChange);
    if (txtLoginEmpNo) {
      txtLoginEmpNo.readOnly = isPasswordChangeRequiredMode;
      txtLoginEmpNo.style.backgroundColor = isPasswordChangeRequiredMode ? '#F8FAFC' : '';
    }
    if (divLoginPasswordGroup) {
      divLoginPasswordGroup.style.display = (isAdminLoginMode && !isPasswordChangeRequiredMode) ? 'block' : 'none';
      if (txtLoginPassword) {
        if (isAdminLoginMode && !isPasswordChangeRequiredMode) {
          txtLoginPassword.setAttribute('required', '');
        } else {
          txtLoginPassword.removeAttribute('required');
          txtLoginPassword.value = '';
        }
      }
    }
    if (divNewPasswordGroup) {
      divNewPasswordGroup.style.display = isPasswordChangeRequiredMode ? 'block' : 'none';
      if (txtLoginNewPassword && txtLoginNewPasswordConfirm) {
        if (isPasswordChangeRequiredMode) {
          txtLoginNewPassword.setAttribute('required', '');
          txtLoginNewPasswordConfirm.setAttribute('required', '');
        } else {
          txtLoginNewPassword.removeAttribute('required');
          txtLoginNewPasswordConfirm.removeAttribute('required');
          txtLoginNewPassword.value = '';
          txtLoginNewPasswordConfirm.value = '';
        }
      }
    }
    if (loginModalTitle) {
      loginModalTitle.textContent = isPasswordChangeRequiredMode
        ? '初回パスワード変更'
        : (isAdminLoginMode ? '管理者・審査者ログイン' : '利用開始');
    }
    if (loginPromptText) {
      loginPromptText.textContent = isPasswordChangeRequiredMode
        ? '初回ログインのため、4文字以上の新しいパスワードを設定してください。'
        : (isAdminLoginMode
          ? '管理者または審査担当者の社員番号とパスワードを入力してください。'
          : '社員番号を入力して利用を開始してください。');
    }
    if (btnToggleAdminLogin) {
      btnToggleAdminLogin.style.display = isPasswordChangeRequiredMode ? 'none' : '';
      btnToggleAdminLogin.textContent = isAdminLoginMode
        ? '一般社員の簡易利用はこちら'
        : '管理者・審査担当者はこちら';
    }
    if (btnLoginSubmit) {
      btnLoginSubmit.textContent = isPasswordChangeRequiredMode
        ? 'パスワード変更'
        : (isAdminLoginMode ? 'ログイン' : '利用開始');
    }
  }

  if (btnToggleAdminLogin) {
    btnToggleAdminLogin.addEventListener('click', () => {
      setLoginMode(!isAdminLoginMode, false);
      if (isAdminLoginMode && txtLoginPassword) {
        txtLoginPassword.focus();
      } else if (txtLoginEmpNo) {
        txtLoginEmpNo.focus();
      }
    });
  }

  function showLoginModal(message, asAdmin = false, requirePasswordChange = false, alertVariant = 'warning') {
    if (!loginModal) return;
    setLoginMode(asAdmin, requirePasswordChange);
    if (loginMessage) {
      if (message) {
        loginMessage.className = `alert-notice alert-${alertVariant || 'warning'}`;
        loginMessage.textContent = message;
        loginMessage.style.display = 'block';
      } else {
        loginMessage.style.display = 'none';
        loginMessage.textContent = '';
      }
    }
    if (btnLoginSubmit) {
      btnLoginSubmit.disabled = false;
      btnLoginSubmit.textContent = isPasswordChangeRequiredMode
        ? 'パスワード変更'
        : (isAdminLoginMode ? 'ログイン' : '利用開始');
    }
    loginModal.classList.add('open');
    loginModal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
    if (isPasswordChangeRequiredMode && txtLoginNewPassword) {
      txtLoginNewPassword.focus();
    } else if (isAdminLoginMode && txtLoginEmpNo && txtLoginEmpNo.value && txtLoginPassword) {
      txtLoginPassword.focus();
    } else if (txtLoginEmpNo) {
      const saved = authClient && typeof authClient.getSavedEmployeeCode === 'function'
        ? authClient.getSavedEmployeeCode()
        : null;
      if (saved && !txtLoginEmpNo.value) {
        txtLoginEmpNo.value = saved;
      }
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
    if (txtLoginNewPassword) {
      txtLoginNewPassword.value = '';
    }
    if (txtLoginNewPasswordConfirm) {
      txtLoginNewPasswordConfirm.value = '';
    }
    isPasswordChangeRequiredMode = false;
    if (txtLoginEmpNo) {
      txtLoginEmpNo.readOnly = false;
      txtLoginEmpNo.style.backgroundColor = '';
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
    if (btnHeaderSwitchUser) {
      btnHeaderSwitchUser.style.display = 'inline-flex';
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
      if (typeof updateNavScrollHint === 'function') {
        updateNavScrollHint();
        setTimeout(updateNavScrollHint, 0);
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
      updateEmployeeUI({ skipStaffFetch: true });
      ensureNewRecordDefaultLoadingDate();
    }

    // 4. Background prefetch form options & populate Base-scoped dropdowns (single shared RPC)
    if (masterClient && typeof masterClient.loadFormOptions === 'function') {
      masterClient.loadFormOptions(false).catch(() => { });
    }
    await populateBaseStaffDropdowns(false);
  }

  // 4. Session Validation & Restore (SIMPLE_EMPLOYEE_LOGIN & Auto-login)
  async function initAuthSession() {
    if (transportError) {
      showMasterError('GAS接続先エンドポイントが設定されていません。config.local.js または __SHIPPING_CONFIG__ を確認してください。');
      return false;
    }
    if (!authClient) {
      showMasterError('認証クライアントの初期化に失敗しました。');
      return false;
    }

    // A. Check for saved Employee Code for automatic lightweight login (Section 2)
    const savedEmpNo = (typeof authClient.getSavedEmployeeCode === 'function')
      ? authClient.getSavedEmployeeCode()
      : null;

    if (savedEmpNo) {
      try {
        // Must verify latest employment & availability status against GAS server.
        // Never treat as successful if GAS connection fails!
        const res = await authClient.simpleLogin(savedEmpNo);
        const ctx = (res && res.context) ? res.context : (await authClient.getAccessContext());
        if (ctx && ctx.empNo) {
          currentAccessContext = ctx;
          window.__CURRENT_ACCESS_CONTEXT__ = ctx;
          hideLoginModal();
          switchView('record');
          await applyAccessContext(ctx);
          return true;
        } else {
          throw new Error('Access context missing empNo');
        }
      } catch (err) {
        console.warn('Saved employee auto-login failed:', err);
        // Fail-Closed: If connection failed, do NOT grant login access!
        const isTransportError = err && (err.name === 'TransportError' || err.code === 'NETWORK_ERROR' || err.code === 'SERVICE_UNAVAILABLE');
        if (isTransportError) {
          showLoginModal('サーバーへの接続に失敗しました。ネットワーク接続を確認のうえ、再試行してください。');
          return false;
        }
        // If employee not found or disabled, clear saved code
        if (typeof authClient.clearSavedEmployeeCode === 'function') {
          authClient.clearSavedEmployeeCode();
        }
        showLoginModal(err.message || '社員アカウントの確認に失敗しました。再度社員番号を入力してください。');
        return false;
      }
    }

    // B. Check for existing active session token (sessionStorage)
    const hasToken = (typeof authClient.hasToken === 'function') ? authClient.hasToken() : false;
    if (hasToken) {
      try {
        const ctx = await authClient.getAccessContext();
        if (ctx && ctx.empNo) {
          currentAccessContext = ctx;
          window.__CURRENT_ACCESS_CONTEXT__ = ctx;
          hideLoginModal();
          switchView('record');
          await applyAccessContext(ctx);
          return true;
        } else {
          throw new Error('Access context missing empNo');
        }
      } catch (err) {
        if (err && (err.code === 'ERR_MUST_CHANGE_PASSWORD' || err.code === 'MUST_CHANGE_PASSWORD') && typeof authClient.validateSession === 'function') {
          try {
            const sessInfo = await authClient.validateSession();
            if (sessInfo && sessInfo.valid && sessInfo.mustChangePassword === true && sessInfo.empNo) {
              if (txtLoginEmpNo) {
                txtLoginEmpNo.value = sessInfo.empNo;
              }
              showLoginModal('初回ログインのため、新しいパスワードを設定してください。', true, true, 'info');
              return false;
            }
          } catch (vErr) {
            console.warn('Temporary session validation failed:', vErr);
          }
        }
        console.warn('Session restore failed or expired:', err);
        if (typeof SessionClient !== 'undefined' && typeof SessionClient.clearToken === 'function') {
          SessionClient.clearToken();
        }
      }
    }

    // C. No saved employee and no valid session: show login modal
    showLoginModal();
    return false;
  }

  // DOM Elements
  // TASK-005 & Base-Scoped Dropdown DOM Elements
  const selLiftOperator = document.getElementById('selLiftOperator');
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
  const txtSearchLooseItemCreator = document.getElementById('txtSearchLooseItemCreator');
  const looseCreatorSearchDropdown = document.getElementById('looseCreatorSearchDropdown');
  const looseCreatorPickerWrapper = document.getElementById('looseCreatorPickerWrapper');
  const selectedLooseCreatorsChips = document.getElementById('selectedLooseCreatorsChips');
  const looseItemCreatorEmptyNotice = document.getElementById('looseItemCreatorEmptyNotice');
  const looseItemCreatorError = document.getElementById('looseItemCreatorError');
  const txtLooseItemStatus = document.getElementById('txtLooseItemStatus');
  const selTransportCategory = document.getElementById('selTransportCategory');
  const txtCarrierName = document.getElementById('txtCarrierName');
  const txtDriverName = document.getElementById('txtDriverName');

  // Collaborative Draft, Guidance & Editing Mode DOM Elements
  const recordViewHeading = document.getElementById('recordViewHeading');
  const editingModeBanner = document.getElementById('editingModeBanner');
  const editingModeBadge = document.getElementById('editingModeBadge');
  const editingRevisionBadge = document.getElementById('editingRevisionBadge');
  const editingModeDescription = document.getElementById('editingModeDescription');
  const editingReviewResetWarning = document.getElementById('editingReviewResetWarning');
  const btnCancelEditingMode = document.getElementById('btnCancelEditingMode');
  const chkGuidanceConfirmed = document.getElementById('chkGuidanceConfirmed');
  const guidanceCheckError = document.getElementById('guidanceCheckError');
  const btnSaveDraft = document.getElementById('btnSaveDraft');
  const submitButtonsGrid = document.getElementById('submitButtonsGrid');
  const revisionConflictBanner = document.getElementById('revisionConflictBanner');
  const revisionConflictMessage = document.getElementById('revisionConflictMessage');
  const btnReloadLatestOnConflict = document.getElementById('btnReloadLatestOnConflict');

  // Settings View DOM Elements
  const lblSettingsCurrentBase = document.getElementById('lblSettingsCurrentBase');
  const settingsBaseErrorBanner = document.getElementById('settingsBaseErrorBanner');
  const lblSettingsLiftOperatorCount = document.getElementById('lblSettingsLiftOperatorCount');
  const txtNewLiftOperatorName = document.getElementById('txtNewLiftOperatorName');
  const selNewLiftOperatorPartner = document.getElementById('selNewLiftOperatorPartner');
  const hintLiftOperatorPartnerZero = document.getElementById('hintLiftOperatorPartnerZero');
  const btnAddLiftOperator = document.getElementById('btnAddLiftOperator');
  const msgSettingsLiftOperator = document.getElementById('msgSettingsLiftOperator');
  const emptySettingsLiftOperators = document.getElementById('emptySettingsLiftOperators');
  const listSettingsLiftOperators = document.getElementById('listSettingsLiftOperators');
  const lblSettingsLooseItemCreatorCount = document.getElementById('lblSettingsLooseItemCreatorCount');
  const txtNewLooseItemCreatorName = document.getElementById('txtNewLooseItemCreatorName');
  const selNewLooseItemCreatorPartner = document.getElementById('selNewLooseItemCreatorPartner');
  const hintLooseItemCreatorPartnerZero = document.getElementById('hintLooseItemCreatorPartnerZero');
  const btnAddLooseItemCreator = document.getElementById('btnAddLooseItemCreator');
  const msgSettingsLooseItemCreator = document.getElementById('msgSettingsLooseItemCreator');
  const emptySettingsLooseItemCreators = document.getElementById('emptySettingsLooseItemCreators');
  const listSettingsLooseItemCreators = document.getElementById('listSettingsLooseItemCreators');

  let currentBaseLiftOperators = [];
  let currentBaseLooseItemCreators = [];
  let currentBasePartners = [];

  const masterErrorBanner = document.getElementById('masterErrorBanner');
  const masterErrorMessage = document.getElementById('masterErrorMessage');
  const btnRetryMaster = document.getElementById('btnRetryMaster');

  // Employee Selection Modal
  const employeeModal = document.getElementById('employeeModal');
  const btnCloseModal = document.getElementById('btnCloseModal');
  const employeeSearchInput = document.getElementById('employeeSearchInput');
  const employeeList = document.getElementById('employeeList');

  function ensureNewRecordDefaultLoadingDate() {
    if (!formState || formState.editingMode !== 'NEW') {
      return;
    }
    if (!formState.explicitFlags.loadingDate && !formState.loadingDate) {
      formState.loadingDate = typeof formState.generateTokyoDate === 'function'
        ? formState.generateTokyoDate()
        : formState.generateLocalDate();
    }
    if (txtLoadingDate && formState.loadingDate && !txtLoadingDate.value) {
      txtLoadingDate.value = formState.loadingDate;
    }
  }

  // 1. Initialize inputStartAt and loadingDate
  if (txtInputStartedAt) txtInputStartedAt.value = formState.inputStartAt;
  if (txtLoadingDate) {
    txtLoadingDate.value = formState.loadingDate;
    ensureNewRecordDefaultLoadingDate();
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

  function updateEmployeeUI(options = {}) {
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
      if (!options || !options.skipStaffFetch) {
        checkBaseOperatorsAndNotify();
      }
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
        const selectAction = async () => {
          formState.setEmployee(emp, true);
          updateEmployeeUI({ skipStaffFetch: true });
          await populateBaseStaffDropdowns(true);
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


  // TASK-005 & Base-Scoped Dropdown Lift Operator UI Updater
  function updateLiftOperatorUI() {
    if (selLiftOperator) {
      const selectedCode = formState.selectedLiftOperator ? (formState.selectedLiftOperator.liftOperatorCode || '') : '';
      if (selLiftOperator.value !== selectedCode) {
        selLiftOperator.value = selectedCode;
      }
    }
    if (txtLooseItemCreator) {
      const selectedCreatorName = formState.looseItemCreatorName || '';
      if (txtLooseItemCreator.value !== selectedCreatorName) {
        txtLooseItemCreator.value = selectedCreatorName;
      }
    }

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

  // Clear Base-scoped dropdowns and Settings UI on user switch / logout / error
  function clearBaseStaffDropdownsAndSettingsUI() {
    currentBaseLiftOperators = [];
    currentBaseLooseItemCreators = [];
    currentBasePartners = [];

    if (selLiftOperator) {
      selLiftOperator.innerHTML = '<option value="">-- リフトマンを選択してください --</option>';
      selLiftOperator.value = '';
      selLiftOperator.disabled = false;
    }
    if (txtLooseItemCreator) {
      txtLooseItemCreator.innerHTML = '<option value="">-- バラ作成担当者を選択してください --</option>';
      txtLooseItemCreator.value = '';
      txtLooseItemCreator.disabled = false;
    }
    if (baseDriverEmptyNotice) {
      baseDriverEmptyNotice.style.display = 'none';
      baseDriverEmptyNotice.textContent = '設定から担当者を追加してください';
    }
    if (looseItemCreatorEmptyNotice) {
      looseItemCreatorEmptyNotice.style.display = 'none';
      looseItemCreatorEmptyNotice.textContent = '設定から担当者を追加してください';
    }
    if (driverError) {
      driverError.style.display = 'none';
      driverError.textContent = '';
    }
    if (looseItemCreatorError) {
      looseItemCreatorError.style.display = 'none';
      looseItemCreatorError.textContent = '';
    }
    if (lblSettingsCurrentBase) {
      lblSettingsCurrentBase.textContent = '---';
    }
    if (settingsBaseErrorBanner) {
      settingsBaseErrorBanner.style.display = 'none';
      settingsBaseErrorBanner.textContent = '';
    }
    if (lblSettingsLiftOperatorCount) {
      lblSettingsLiftOperatorCount.textContent = '0名';
    }
    if (lblSettingsLooseItemCreatorCount) {
      lblSettingsLooseItemCreatorCount.textContent = '0名';
    }
    if (txtNewLiftOperatorName) {
      txtNewLiftOperatorName.value = '';
      txtNewLiftOperatorName.disabled = false;
    }
    if (selNewLiftOperatorPartner) {
      selNewLiftOperatorPartner.innerHTML = '<option value="">-- 所属協力会社を選択してください --</option>';
      selNewLiftOperatorPartner.value = '';
      selNewLiftOperatorPartner.disabled = false;
    }
    if (hintLiftOperatorPartnerZero) {
      hintLiftOperatorPartnerZero.textContent = '';
      hintLiftOperatorPartnerZero.style.display = 'none';
    }
    if (btnAddLiftOperator) {
      btnAddLiftOperator.disabled = false;
    }
    if (msgSettingsLiftOperator) {
      msgSettingsLiftOperator.style.display = 'none';
      msgSettingsLiftOperator.textContent = '';
    }
    if (listSettingsLiftOperators) {
      listSettingsLiftOperators.innerHTML = '';
    }
    if (emptySettingsLiftOperators) {
      emptySettingsLiftOperators.style.display = 'block';
    }
    if (txtNewLooseItemCreatorName) {
      txtNewLooseItemCreatorName.value = '';
      txtNewLooseItemCreatorName.disabled = false;
    }
    if (selNewLooseItemCreatorPartner) {
      selNewLooseItemCreatorPartner.innerHTML = '<option value="">-- 所属協力会社を選択してください --</option>';
      selNewLooseItemCreatorPartner.value = '';
      selNewLooseItemCreatorPartner.disabled = false;
    }
    if (hintLooseItemCreatorPartnerZero) {
      hintLooseItemCreatorPartnerZero.textContent = '';
      hintLooseItemCreatorPartnerZero.style.display = 'none';
    }
    if (btnAddLooseItemCreator) {
      btnAddLooseItemCreator.disabled = false;
    }
    if (msgSettingsLooseItemCreator) {
      msgSettingsLooseItemCreator.style.display = 'none';
      msgSettingsLooseItemCreator.textContent = '';
    }
    if (listSettingsLooseItemCreators) {
      listSettingsLooseItemCreators.innerHTML = '';
    }
    if (emptySettingsLooseItemCreators) {
      emptySettingsLooseItemCreators.style.display = 'block';
    }
  }

  function resolveEffectiveBaseCode() {
    const rawBaseCode = (currentAccessContext && currentAccessContext.baseCode)
      || (formState && formState.currentEmployee && formState.currentEmployee.baseCode)
      || '';
    const trimmed = String(rawBaseCode || '').normalize('NFKC').trim();
    if (!trimmed || trimmed === '所属未登録' || trimmed === 'Base未登録') {
      return '';
    }
    return trimmed;
  }

  function formatStaffDropdownLabel(staffName, partnerName) {
    const cleanName = String(staffName || '').trim();
    const cleanPartner = String(partnerName || '').trim();
    return cleanPartner ? `${cleanName}（${cleanPartner}）` : cleanName;
  }

  function populateSettingsPartnerSelects(partners, options = {}) {
    const safePartners = Array.isArray(partners) ? partners : [];
    const baseUnassigned = Boolean(options.baseUnassigned);
    const hasError = Boolean(options.hasError);

    const configureSelect = (selectEl, zeroHintEl, addBtnEl, nameInputEl) => {
      if (!selectEl) return;
      const prevVal = selectEl.value || '';
      selectEl.innerHTML = '';

      if (baseUnassigned) {
        const opt = document.createElement('option');
        opt.value = '';
        opt.textContent = '所属Baseが未設定のため選択できません';
        selectEl.appendChild(opt);
        selectEl.value = '';
        selectEl.disabled = true;
        if (zeroHintEl) {
          zeroHintEl.textContent = '';
          zeroHintEl.style.display = 'none';
        }
        if (addBtnEl) addBtnEl.disabled = true;
        if (nameInputEl) nameInputEl.disabled = true;
        return;
      }

      if (hasError) {
        const opt = document.createElement('option');
        opt.value = '';
        opt.textContent = '協力会社一覧の取得に失敗しました';
        selectEl.appendChild(opt);
        selectEl.value = '';
        selectEl.disabled = true;
        if (zeroHintEl) {
          zeroHintEl.textContent = '';
          zeroHintEl.style.display = 'none';
        }
        if (addBtnEl) addBtnEl.disabled = true;
        return;
      }

      if (safePartners.length === 0) {
        const opt = document.createElement('option');
        opt.value = '';
        opt.textContent = 'この拠点に登録された協力会社がありません';
        selectEl.appendChild(opt);
        selectEl.value = '';
        selectEl.disabled = true;
        if (zeroHintEl) {
          zeroHintEl.textContent = 'この拠点に登録された協力会社がありません（CompanyMaster_Partnerを確認してください）';
          zeroHintEl.style.display = 'block';
        }
        if (addBtnEl) addBtnEl.disabled = true;
        return;
      }

      if (zeroHintEl) {
        zeroHintEl.textContent = '';
        zeroHintEl.style.display = 'none';
      }
      selectEl.disabled = false;
      if (addBtnEl) addBtnEl.disabled = false;
      if (nameInputEl) nameInputEl.disabled = false;

      const placeholderOpt = document.createElement('option');
      placeholderOpt.value = '';
      placeholderOpt.textContent = '-- 所属協力会社を選択してください --';
      selectEl.appendChild(placeholderOpt);

      safePartners.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.partnerCode;
        opt.textContent = p.partnerName || p.partnerCode;
        selectEl.appendChild(opt);
      });

      const stillValid = safePartners.some(p => p.partnerCode === prevVal);
      selectEl.value = stillValid ? prevVal : '';
    };

    configureSelect(selNewLiftOperatorPartner, hintLiftOperatorPartnerZero, btnAddLiftOperator, txtNewLiftOperatorName);
    configureSelect(selNewLooseItemCreatorPartner, hintLooseItemCreatorPartnerZero, btnAddLooseItemCreator, txtNewLooseItemCreatorName);
  }

  // Populate LiftOperator, LooseItemCreator & Partner dropdowns strictly for caller's Base
  async function populateBaseStaffDropdowns(forceRefresh = false) {
    const currentBaseCode = resolveEffectiveBaseCode();

    if (!currentBaseCode) {
      currentBaseLiftOperators = [];
      currentBaseLooseItemCreators = [];
      currentBasePartners = [];
      formState.clearLiftOperator();
      if (typeof formState.clearLooseItemCreator === 'function') {
        formState.clearLooseItemCreator();
      }
      if (selLiftOperator) {
        selLiftOperator.innerHTML = '<option value="">所属Baseが未設定のため選択できません</option>';
        selLiftOperator.value = '';
        selLiftOperator.disabled = true;
      }
      if (txtLooseItemCreator) {
        txtLooseItemCreator.innerHTML = '<option value="">所属Baseが未設定のため選択できません</option>';
        txtLooseItemCreator.value = '';
        txtLooseItemCreator.disabled = true;
      }
      if (baseDriverEmptyNotice) {
        baseDriverEmptyNotice.textContent = '所属Baseが設定されていないため、担当者の追加・選択はできません。';
        baseDriverEmptyNotice.style.display = 'block';
      }
      if (looseItemCreatorEmptyNotice) {
        looseItemCreatorEmptyNotice.textContent = '所属Baseが設定されていないため、担当者の追加・選択はできません。';
        looseItemCreatorEmptyNotice.style.display = 'block';
      }
      populateSettingsPartnerSelects([], { baseUnassigned: true });
      updateLiftOperatorUI();
      return { baseCode: '', partners: [], liftOperators: [], looseItemCreators: [], baseUnassigned: true };
    }

    try {
      let liftOps = [];
      let looseCreators = [];
      let basePartners = [];

      if (masterClient && typeof masterClient.listBaseStaff === 'function') {
        let res;
        try {
          res = await masterClient.listBaseStaff({ baseCode: currentBaseCode, forceRefresh: Boolean(forceRefresh) });
        } catch (firstErr) {
          const errCode = (firstErr && firstErr.code) || '';
          const errMsg = (firstErr && firstErr.message) || '';
          const isSessionError = errCode === 'AUTHORIZATION_REQUIRED' ||
            errCode === 'INVALID_SESSION' ||
            errCode === 'UNAUTHENTICATED' ||
            /Session is invalid or expired|UNAUTHENTICATED/i.test(errMsg);
          const recoveryEmpNo = (currentAccessContext && currentAccessContext.isSimpleSession && currentAccessContext.empNo)
            || (authClient && typeof authClient.getSavedEmployeeCode === 'function' ? authClient.getSavedEmployeeCode() : '');
          if (isSessionError && recoveryEmpNo && authClient && typeof authClient.simpleLogin === 'function') {
            await authClient.simpleLogin(recoveryEmpNo);
            res = await masterClient.listBaseStaff({ baseCode: currentBaseCode, forceRefresh: true });
          } else {
            throw firstErr;
          }
        }
        liftOps = Array.isArray(res && res.liftOperators) ? res.liftOperators : [];
        looseCreators = Array.isArray(res && res.looseItemCreators) ? res.looseItemCreators : [];
        basePartners = Array.isArray(res && res.partners)
          ? res.partners
          : (Array.isArray(res && res.basePartners) ? res.basePartners : []);
      } else {
        liftOps = await masterClient.getLiftOperators({
          baseCode: currentBaseCode,
          showAllDrivers: false,
          forceRefresh: Boolean(forceRefresh)
        });
        looseCreators = (typeof masterClient.getLooseItemCreators === 'function')
          ? await masterClient.getLooseItemCreators({ baseCode: currentBaseCode, forceRefresh: Boolean(forceRefresh) })
          : [];
        basePartners = Array.isArray(masterClient.cachedBasePartners)
          ? masterClient.cachedBasePartners
          : (Array.isArray(masterClient.cachedPartners)
            ? masterClient.cachedPartners.filter(p => String(p.baseCode || '').normalize('NFKC').trim() === currentBaseCode)
            : []);
      }

      // Defense-in-depth: strictly filter to caller's BaseCode and active records only
      currentBasePartners = (basePartners || []).filter(p =>
        p && Boolean(p.partnerCode) && String(p.baseCode || '').normalize('NFKC').trim() === currentBaseCode
      );
      const partnerNameByCode = {};
      currentBasePartners.forEach(p => {
        partnerNameByCode[p.partnerCode] = p.partnerName || '';
      });

      currentBaseLiftOperators = (liftOps || []).filter(op =>
        op && op.isActive !== false && String(op.baseCode || '').normalize('NFKC').trim() === currentBaseCode
      ).map(op => {
        const pCode = String(op.partnerCode || '').trim();
        const pName = String(op.partnerName || partnerNameByCode[pCode] || '').trim();
        return Object.assign({}, op, { partnerCode: pCode, partnerName: pName });
      });

      currentBaseLooseItemCreators = (looseCreators || []).filter(c =>
        c && c.isActive !== false && String(c.baseCode || '').normalize('NFKC').trim() === currentBaseCode
      ).map(c => {
        const pCode = String(c.partnerCode || '').trim();
        const pName = String(c.partnerName || partnerNameByCode[pCode] || '').trim();
        return Object.assign({}, c, { partnerCode: pCode, partnerName: pName });
      });

      populateSettingsPartnerSelects(currentBasePartners, { baseUnassigned: false });

      // Rebuild #selLiftOperator dropdown
      if (selLiftOperator) {
        selLiftOperator.disabled = false;
        selLiftOperator.innerHTML = '';
        if (currentBaseLiftOperators.length === 0) {
          const emptyOpt = document.createElement('option');
          emptyOpt.value = '';
          emptyOpt.textContent = '設定から担当者を追加してください';
          selLiftOperator.appendChild(emptyOpt);
          if (baseDriverEmptyNotice) {
            baseDriverEmptyNotice.textContent = '設定から担当者を追加してください';
            baseDriverEmptyNotice.style.display = 'block';
          }
        } else {
          const placeholderOpt = document.createElement('option');
          placeholderOpt.value = '';
          placeholderOpt.textContent = '-- リフトマンを選択してください --';
          selLiftOperator.appendChild(placeholderOpt);
          currentBaseLiftOperators.forEach(op => {
            const opt = document.createElement('option');
            opt.value = op.liftOperatorCode;
            opt.textContent = formatStaffDropdownLabel(op.liftOperatorName, op.partnerName);
            selLiftOperator.appendChild(opt);
          });
          if (baseDriverEmptyNotice) {
            baseDriverEmptyNotice.style.display = 'none';
          }
        }

        // Preserve selection only if it belongs to current Base and refresh its latest partner info
        const selectedCode = formState.selectedLiftOperator ? formState.selectedLiftOperator.liftOperatorCode : '';
        const stillValidOp = currentBaseLiftOperators.find(op => op.liftOperatorCode === selectedCode);
        if (stillValidOp) {
          if (typeof formState.selectLiftOperator === 'function') {
            await formState.selectLiftOperator(stillValidOp);
          } else {
            formState.selectedLiftOperator = stillValidOp;
          }
          selLiftOperator.value = stillValidOp.liftOperatorCode;
        } else {
          formState.clearLiftOperator();
          selLiftOperator.value = '';
        }
      }

      // Rebuild #txtLooseItemCreator dropdown
      if (txtLooseItemCreator) {
        txtLooseItemCreator.disabled = false;
        txtLooseItemCreator.innerHTML = '';
        if (currentBaseLooseItemCreators.length === 0) {
          const emptyOpt = document.createElement('option');
          emptyOpt.value = '';
          emptyOpt.textContent = '設定から担当者を追加してください';
          txtLooseItemCreator.appendChild(emptyOpt);
          if (looseItemCreatorEmptyNotice) {
            looseItemCreatorEmptyNotice.textContent = '設定から担当者を追加してください';
            looseItemCreatorEmptyNotice.style.display = 'block';
          }
        } else {
          const placeholderOpt = document.createElement('option');
          placeholderOpt.value = '';
          placeholderOpt.textContent = '-- バラ作成担当者を選択してください（任意） --';
          txtLooseItemCreator.appendChild(placeholderOpt);
          currentBaseLooseItemCreators.forEach(c => {
            const opt = document.createElement('option');
            opt.value = c.looseItemCreatorName;
            opt.setAttribute('data-code', c.looseItemCreatorCode || '');
            opt.textContent = formatStaffDropdownLabel(c.looseItemCreatorName, c.partnerName);
            txtLooseItemCreator.appendChild(opt);
          });
          if (looseItemCreatorEmptyNotice) {
            looseItemCreatorEmptyNotice.style.display = 'none';
          }
        }

        // Preserve multi-select creators belonging to current Base (or historical creators in EDIT_COMPLETED mode)
        const existingSelected = Array.isArray(formState.selectedLooseItemCreators)
          ? formState.selectedLooseItemCreators.slice()
          : [];
        const refreshedCreators = [];
        for (const selC of existingSelected) {
          const matchedMaster = currentBaseLooseItemCreators.find(c =>
            (selC.looseItemCreatorCode && c.looseItemCreatorCode === selC.looseItemCreatorCode) ||
            (selC.looseItemCreatorName && c.looseItemCreatorName === selC.looseItemCreatorName)
          );
          if (matchedMaster) {
            refreshedCreators.push(matchedMaster);
          } else if (formState.editingMode === 'EDIT_COMPLETED' && (!selC.baseCode || selC.baseCode === currentBaseCode)) {
            refreshedCreators.push(selC);
          }
        }
        if (typeof formState.setLooseItemCreators === 'function') {
          formState.setLooseItemCreators(refreshedCreators);
        }
        txtLooseItemCreator.value = refreshedCreators.length > 0 ? refreshedCreators[0].looseItemCreatorName : '';
        if (typeof renderSelectedLooseCreatorsChips === 'function') {
          renderSelectedLooseCreatorsChips();
        }
      }

      updateLiftOperatorUI();
      return {
        baseCode: currentBaseCode,
        partners: currentBasePartners,
        liftOperators: currentBaseLiftOperators,
        looseItemCreators: currentBaseLooseItemCreators,
        baseUnassigned: false
      };
    } catch (err) {
      // Fail-Closed: Never display stale cache or another Base's candidates on communication error
      console.warn('populateBaseStaffDropdowns failed:', err);
      currentBaseLiftOperators = [];
      currentBaseLooseItemCreators = [];
      currentBasePartners = [];
      formState.clearLiftOperator();
      if (typeof formState.clearLooseItemCreator === 'function') {
        formState.clearLooseItemCreator();
      } else {
        formState.looseItemCreatorName = '';
      }
      if (selLiftOperator) {
        selLiftOperator.innerHTML = '<option value="">担当者一覧の取得に失敗しました</option>';
        selLiftOperator.value = '';
      }
      if (txtLooseItemCreator) {
        txtLooseItemCreator.innerHTML = '<option value="">担当者一覧の取得に失敗しました</option>';
        txtLooseItemCreator.value = '';
      }
      populateSettingsPartnerSelects([], { hasError: true });
      updateLiftOperatorUI();
      return {
        baseCode: currentBaseCode,
        partners: [],
        liftOperators: [],
        looseItemCreators: [],
        error: err
      };
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
    await populateBaseStaffDropdowns(false);
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

  // Lift Operator Event Listeners (Dropdown & Legacy Modal)
  if (selLiftOperator) {
    selLiftOperator.addEventListener('change', async (e) => {
      const code = e.target.value;
      if (!code) {
        formState.clearLiftOperator();
        updateLiftOperatorUI();
        return;
      }
      const op = currentBaseLiftOperators.find(item => item.liftOperatorCode === code);
      if (op) {
        await formState.selectLiftOperator(op);
      } else {
        formState.clearLiftOperator();
      }
      updateLiftOperatorUI();
    });
  }

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

  let driverSearchDebounceTimer = null;
  driverSearchInput.addEventListener('input', (e) => {
    const val = e.target.value.trim();
    if (driverSearchDebounceTimer) clearTimeout(driverSearchDebounceTimer);
    driverSearchDebounceTimer = setTimeout(() => {
      driverSearchDebounceTimer = null;
      loadDriversToModal(val);
    }, 150);
  });

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
  let employeeSearchDebounceTimer = null;
  employeeSearchInput.addEventListener('input', (e) => {
    const val = e.target.value.trim();
    if (employeeSearchDebounceTimer) clearTimeout(employeeSearchDebounceTimer);
    employeeSearchDebounceTimer = setTimeout(() => {
      employeeSearchDebounceTimer = null;
      loadEmployeesToModal(val);
    }, 150);
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

  // 5. Bara Toggle (UI-REVIEW-003: はい / いいえ, plus unset draft state)
  const looseItemFieldsContainer = document.getElementById('looseItemFieldsContainer');
  function updateLooseFieldsVisibility() {
    if (looseItemFieldsContainer) {
      looseItemFieldsContainer.style.display = formState.hasLooseItems === null
        ? 'block'
        : (formState.hasLooseItems ? 'block' : 'none');
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

  // 7. Searchable Multi-Select LooseItemCreator UI & Optional Field Bindings
  function renderSelectedLooseCreatorsChips() {
    if (!selectedLooseCreatorsChips) return;
    selectedLooseCreatorsChips.innerHTML = '';
    const selected = Array.isArray(formState.selectedLooseItemCreators)
      ? formState.selectedLooseItemCreators
      : [];

    selected.forEach((c) => {
      const chip = document.createElement('span');
      chip.className = 'creator-chip';
      const key = c.looseItemCreatorCode || c.looseItemCreatorName;
      const partnerPart = c.partnerName ? `（${escapeHtml(c.partnerName)}）` : '';
      chip.innerHTML =
        `<span class="creator-chip-label">${escapeHtml(c.looseItemCreatorName)}${partnerPart}</span>` +
        `<button type="button" class="creator-chip-remove" data-creator-key="${escapeHtml(key)}" aria-label="${escapeHtml(c.looseItemCreatorName)} を選択解除">×</button>`;
      selectedLooseCreatorsChips.appendChild(chip);
    });

    if (txtLooseItemCreator) {
      txtLooseItemCreator.value = selected.length > 0 ? selected[0].looseItemCreatorName : '';
    }
  }

  function closeLooseCreatorDropdown() {
    if (looseCreatorSearchDropdown) {
      looseCreatorSearchDropdown.style.display = 'none';
    }
  }

  function renderLooseCreatorSearchDropdown(query = '') {
    if (!looseCreatorSearchDropdown) return;
    looseCreatorSearchDropdown.innerHTML = '';

    if (!currentBaseLooseItemCreators || currentBaseLooseItemCreators.length === 0) {
      looseCreatorSearchDropdown.innerHTML =
        '<div class="loose-creator-empty">この拠点に登録されたバラ作成担当者はいません。「設定」画面から追加してください。</div>';
      looseCreatorSearchDropdown.style.display = 'block';
      return;
    }

    const matches = typeof formState.searchLooseItemCreators === 'function'
      ? formState.searchLooseItemCreators(currentBaseLooseItemCreators, query)
      : currentBaseLooseItemCreators;

    if (matches.length === 0) {
      looseCreatorSearchDropdown.innerHTML =
        '<div class="loose-creator-empty">条件に一致するバラ作成担当者が見つかりません。</div>';
      looseCreatorSearchDropdown.style.display = 'block';
      return;
    }

    matches.forEach((c) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'loose-creator-option' + (c.isSelected ? ' is-selected' : '');
      btn.setAttribute('role', 'option');
      btn.setAttribute('aria-selected', c.isSelected ? 'true' : 'false');
      const partnerLabel = c.partnerName ? `（${escapeHtml(c.partnerName)}）` : '';
      const codeLabel = c.looseItemCreatorCode ? ` <span style="font-size:0.76rem;color:#64748B;">[${escapeHtml(c.looseItemCreatorCode)}]</span>` : '';
      const statusBadge = c.isSelected
        ? '<span class="badge" style="background:#DBEAFE;color:#1E40AF;font-size:0.75rem;">選択済</span>'
        : '<span style="font-size:0.8rem;color:#1D4ED8;font-weight:700;">＋追加</span>';

      btn.innerHTML =
        `<span style="min-width:0;overflow:hidden;text-overflow:ellipsis;"><strong>${escapeHtml(c.looseItemCreatorName)}</strong>${partnerLabel}${codeLabel}</span>` +
        statusBadge;

      btn.addEventListener('click', () => {
        if (!c.isSelected) {
          formState.addLooseItemCreator(c);
          renderSelectedLooseCreatorsChips();
          if (txtSearchLooseItemCreator) {
            txtSearchLooseItemCreator.value = '';
          }
          renderLooseCreatorSearchDropdown('');
        }
      });
      looseCreatorSearchDropdown.appendChild(btn);
    });

    looseCreatorSearchDropdown.style.display = 'block';
  }

  if (selectedLooseCreatorsChips) {
    selectedLooseCreatorsChips.addEventListener('click', (e) => {
      const remBtn = e.target.closest('.creator-chip-remove');
      if (!remBtn) return;
      const key = remBtn.getAttribute('data-creator-key');
      if (key) {
        formState.removeLooseItemCreator(key);
        renderSelectedLooseCreatorsChips();
        if (looseCreatorSearchDropdown && looseCreatorSearchDropdown.style.display !== 'none') {
          renderLooseCreatorSearchDropdown(txtSearchLooseItemCreator ? txtSearchLooseItemCreator.value : '');
        }
      }
    });
  }

  if (txtSearchLooseItemCreator) {
    txtSearchLooseItemCreator.addEventListener('focus', () => {
      renderLooseCreatorSearchDropdown(txtSearchLooseItemCreator.value);
    });
    txtSearchLooseItemCreator.addEventListener('input', (e) => {
      renderLooseCreatorSearchDropdown(e.target.value);
    });
    txtSearchLooseItemCreator.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        closeLooseCreatorDropdown();
      }
    });
  }

  document.addEventListener('click', (e) => {
    if (looseCreatorPickerWrapper && !looseCreatorPickerWrapper.contains(e.target)) {
      closeLooseCreatorDropdown();
    }
  });

  if (txtLooseItemCreator) {
    const onLooseCreatorChange = (e) => {
      const val = e.target.value || '';
      if (!val) {
        formState.clearLooseItemCreator();
        renderSelectedLooseCreatorsChips();
        return;
      }
      const matched = currentBaseLooseItemCreators.find(
        c => c.looseItemCreatorName === val || c.looseItemCreatorCode === val
      );
      if (matched) {
        formState.addLooseItemCreator(matched);
      } else {
        formState.addLooseItemCreator({ looseItemCreatorName: val });
      }
      renderSelectedLooseCreatorsChips();
    };
    txtLooseItemCreator.addEventListener('change', onLooseCreatorChange);
    txtLooseItemCreator.addEventListener('input', onLooseCreatorChange);
  }

  if (txtLooseItemStatus) {
    txtLooseItemStatus.addEventListener('input', (e) => {
      if (typeof formState.setLooseItemStatus === 'function') {
        formState.setLooseItemStatus(e.target.value);
      } else {
        formState.looseItemStatus = e.target.value;
      }
    });
  }
  if (selTransportCategory) {
    selTransportCategory.addEventListener('change', (e) => {
      if (typeof formState.setTransportCategory === 'function') {
        formState.setTransportCategory(e.target.value);
      } else {
        formState.transportCategory = e.target.value;
      }
    });
  }
  if (txtCarrierName) txtCarrierName.addEventListener('input', (e) => formState.carrierName = e.target.value);
  if (txtDriverName) txtDriverName.addEventListener('input', (e) => formState.driverName = e.target.value);

  function syncGuidanceCheckboxUI() {
    if (!chkGuidanceConfirmed) return;
    chkGuidanceConfirmed.checked = Boolean(formState.guidanceConfirmed);
    const rowLabel = chkGuidanceConfirmed.closest('.guidance-check-row');
    if (rowLabel) {
      rowLabel.classList.toggle('is-checked', Boolean(formState.guidanceConfirmed));
    }
    if (guidanceCheckError && formState.guidanceConfirmed) {
      guidanceCheckError.style.display = 'none';
      guidanceCheckError.textContent = '';
    }
  }

  var isOpeningRecordForEditing = false;
  var lastSubmitBannerOrigin = '';

  function resolveLoadingManager() {
    if (typeof window !== 'undefined' && window.loadingManager) {
      return window.loadingManager;
    }
    if (typeof LoadingComponent !== 'undefined' && LoadingComponent && LoadingComponent.loadingManager) {
      return LoadingComponent.loadingManager;
    }
    return null;
  }

  function syncClientValidationBannerIfResolved() {
    if (lastSubmitBannerOrigin !== 'client_validation') return;
    const hasTopErr = Boolean(formState.errors && Object.keys(formState.errors).length > 0);
    const hasDetErr = Boolean(formState.detailErrors && Object.keys(formState.detailErrors).length > 0);
    const hasAttErr = Boolean(formState.attachmentErrors && Object.keys(formState.attachmentErrors).length > 0);
    const sBanner = document.getElementById('submitResultBanner');
    const sMsg = document.getElementById('submitResultMessage');
    if (!hasTopErr && !hasDetErr && !hasAttErr) {
      if (sBanner) sBanner.style.display = 'none';
      lastSubmitBannerOrigin = '';
    } else if (sMsg && formState.errors) {
      if (formState.errors.guidanceConfirmed) {
        sMsg.textContent = formState.errors.guidanceConfirmed;
      } else if (formState.errors.errorDetails && !formState.errors.liftOperator && !formState.errors.totalMaterialTypeCount) {
        sMsg.textContent = `入力内容に不備があります。${formState.errors.errorDetails}`;
      }
    }
  }

  if (chkGuidanceConfirmed) {
    chkGuidanceConfirmed.addEventListener('change', (e) => {
      formState.setGuidanceConfirmed(e.target.checked);
      syncGuidanceCheckboxUI();
      syncClientValidationBannerIfResolved();
    });
  }

  function hideRevisionConflictBanner() {
    if (revisionConflictBanner) {
      revisionConflictBanner.style.display = 'none';
    }
    if (revisionConflictMessage) {
      revisionConflictMessage.textContent = '';
    }
  }

  function showRevisionConflictBanner(message) {
    if (!revisionConflictBanner || !revisionConflictMessage) return;
    revisionConflictMessage.textContent = message || '他の社員によって更新されました。最新の内容を読み込んでから再度保存してください。';
    revisionConflictBanner.style.display = 'block';
  }

  function updateEditingModeBannerUI() {
    const mode = formState.editingMode || 'NEW';
    const btnSubmitEl = document.getElementById('btnSubmitCheck');
    if (mode === 'NEW') {
      if (recordViewHeading) recordViewHeading.textContent = '出荷チェック新規登録';
      if (editingModeBanner) editingModeBanner.style.display = 'none';
      if (btnSaveDraft) {
        btnSaveDraft.style.display = '';
        btnSaveDraft.textContent = '一時保存';
      }
      if (submitButtonsGrid) submitButtonsGrid.classList.remove('is-single-action');
      if (btnSubmitEl && !isSubmittingShipmentWithAttachments) {
        btnSubmitEl.textContent = '完了登録';
      }
      return;
    }

    const meta = formState.recordMetadata || {};
    const creatorStr = meta.createdByName
      ? `${meta.createdByName}${meta.createdByEmpNo ? ' (' + meta.createdByEmpNo + ')' : ''}`
      : (meta.createdByEmpNo || '---');
    const updaterStr = meta.updatedByName
      ? `${meta.updatedByName}${meta.updatedByEmpNo ? ' (' + meta.updatedByEmpNo + ')' : ''}`
      : (meta.updatedByEmpNo || '---');

    if (editingModeBanner) {
      editingModeBanner.style.display = 'flex';
      editingModeBanner.classList.toggle('is-completed-edit', mode === 'EDIT_COMPLETED');
    }
    if (editingRevisionBadge) {
      editingRevisionBadge.textContent = `Rev.${formState.expectedRevision || 1}`;
      editingRevisionBadge.style.display = 'none';
    }
    if (editingModeDescription) {
      editingModeDescription.textContent = `初回作成: ${creatorStr} ／ 最終更新: ${updaterStr}`;
    }

    if (mode === 'DRAFT') {
      if (recordViewHeading) recordViewHeading.textContent = '出荷チェック入力再開（一時保存）';
      if (editingModeBadge) {
        editingModeBadge.className = 'badge-record-status is-draft';
        editingModeBadge.textContent = '一時保存データを編集中';
      }
      if (editingReviewResetWarning) editingReviewResetWarning.style.display = 'none';
      if (btnSaveDraft) {
        btnSaveDraft.style.display = '';
        btnSaveDraft.textContent = '一時保存を更新';
      }
      if (submitButtonsGrid) submitButtonsGrid.classList.remove('is-single-action');
      if (btnSubmitEl && !isSubmittingShipmentWithAttachments) {
        btnSubmitEl.textContent = '完了登録';
      }
    } else {
      if (recordViewHeading) recordViewHeading.textContent = '出荷チェック実績の編集';
      if (editingModeBadge) {
        editingModeBadge.className = 'badge-record-status is-completed';
        editingModeBadge.textContent = '完了登録済み実績を共同編集中';
      }
      const isReviewed = formState.originalReviewStatus === 'OK' || formState.originalReviewStatus === 'NG';
      if (editingReviewResetWarning) {
        editingReviewResetWarning.style.display = isReviewed ? 'block' : 'none';
      }
      if (btnSaveDraft) {
        btnSaveDraft.style.display = 'none';
      }
      if (submitButtonsGrid) submitButtonsGrid.classList.add('is-single-action');
      if (btnSubmitEl && !isSubmittingShipmentWithAttachments) {
        btnSubmitEl.textContent = '変更を保存する';
      }
    }
  }

  function syncFormControlsFromState() {
    if (txtLoadingDate) {
      txtLoadingDate.value = formState.loadingDate || '';
    }
    if (numEquipmentTypeCount) {
      numEquipmentTypeCount.value = (formState.totalMaterialTypeCount === null || formState.totalMaterialTypeCount === undefined)
        ? ''
        : String(formState.totalMaterialTypeCount);
    }
    if (radLooseYes && radLooseNo) {
      if (formState.hasLooseItems === true) {
        radLooseYes.checked = true;
        radLooseNo.checked = false;
      } else if (formState.hasLooseItems === false) {
        radLooseYes.checked = false;
        radLooseNo.checked = true;
      } else {
        radLooseYes.checked = false;
        radLooseNo.checked = false;
      }
    }
    updateLooseFieldsVisibility();
    renderSelectedLooseCreatorsChips();
    if (txtSearchLooseItemCreator) {
      txtSearchLooseItemCreator.value = '';
    }
    closeLooseCreatorDropdown();

    if (txtLooseItemStatus) {
      txtLooseItemStatus.value = formState.looseItemStatus || '';
    }
    if (selTransportCategory) {
      selTransportCategory.value = formState.transportCategory || '未指定';
    }
    if (txtCarrierName) {
      txtCarrierName.value = formState.carrierName || '';
    }
    if (txtDriverName) {
      txtDriverName.value = formState.driverName || '';
    }
    if (optionalAccordion && (formState.carrierName || formState.driverName || (formState.transportCategory && formState.transportCategory !== '未指定'))) {
      optionalAccordion.classList.add('open');
      if (accordionHeader) accordionHeader.setAttribute('aria-expanded', 'true');
    }

    syncGuidanceCheckboxUI();
    updateLiftOperatorUI();
    if (typeof renderErrorDetailCards === 'function') {
      renderErrorDetailCards();
    }
    if (typeof renderAttachments === 'function') {
      renderAttachments();
    }
    updateEditingModeBannerUI();
  }

  if (btnCancelEditingMode) {
    btnCancelEditingMode.addEventListener('click', () => {
      if (isSubmittingShipmentWithAttachments) return;
      hideRevisionConflictBanner();
      const sBanner = document.getElementById('submitResultBanner');
      if (sBanner) sBanner.style.display = 'none';
      formState.resetForm({ preserveLiftOperator: false, preserveEmployee: true });
      const client = resolveActiveShipmentClient();
      if (client && typeof client.startNewSubmission === 'function') {
        client.startNewSubmission();
      }
      syncFormControlsFromState();
    });
  }

  if (btnReloadLatestOnConflict) {
    btnReloadLatestOnConflict.addEventListener('click', async () => {
      if (isOpeningRecordForEditing || isSubmittingShipmentWithAttachments) return;
      const targetId = formState.editingMode === 'DRAFT'
        ? formState.draftId
        : formState.editingShippingCheckId;
      if (!targetId) return;
      btnReloadLatestOnConflict.disabled = true;
      const lm = resolveLoadingManager();
      if (lm) {
        lm.showProgressBar();
        lm.showBlockingLoader(
          '実績データを読み込み中...',
          '保存済みの入力情報・添付情報を取得しています。しばらくお待ちください。'
        );
      }
      try {
        const client = resolveActiveShipmentClient();
        const res = await client.getShipment(targetId);
        const latestData = (res && res.payload) ? res.payload : res;
        if (latestData) {
          await openRecordForEditing(latestData, { preserveUnpersistedAttachments: true });
          hideRevisionConflictBanner();
          showSubmitBanner('warning', '最新の内容を読み込みました。内容を確認して再度保存してください。');
        }
      } catch (reloadErr) {
        showSubmitBanner('error', (reloadErr && reloadErr.message) || '最新データの再読み込みに失敗しました。');
      } finally {
        if (lm) {
          lm.hideBlockingLoader();
          lm.hideProgressBar();
        }
        btnReloadLatestOnConflict.disabled = false;
      }
    });
  }

  // Expose to window for automated testing
  window.__SHIPPING_ERROR_FORM_STATE__ = formState;

  // Initialize
  initEmployee();


  // ============================================================================
  // TASK-006: ShippingErrorDetail 1:N Controller & Material Search Modal
  // ============================================================================
  const errorDetailsContainer = document.getElementById('errorDetailsContainer');
  const btnAddErrorDetail = document.getElementById('btnAddErrorDetail');

  // TASK-007: Attachment DOM Elements (Google Drive Photo & PDF Upload)
  const fileCapturePhoto = document.getElementById('fileCapturePhoto');
  const btnCapturePhoto = document.getElementById('btnCapturePhoto');
  const fileSelectPdf = document.getElementById('fileSelectPdf');
  const btnSelectPdf = document.getElementById('btnSelectPdf');
  const attachmentUploadStatus = document.getElementById('attachmentUploadStatus');
  const attachmentList = document.getElementById('attachmentList');
  const attachmentEmptyNotice = document.getElementById('attachmentEmptyNotice');
  const attachmentGlobalError = document.getElementById('attachmentGlobalError');
  const errorDetailsGlobalError = document.getElementById('errorDetailsGlobalError');

  // Attachment Viewer Modal DOM Elements (STEP 5: Authenticated Detail Viewing)
  const attachmentViewerModal = document.getElementById('attachmentViewerModal');
  const attachmentViewerTitle = document.getElementById('attachmentViewerTitle');
  const attachmentViewerBody = document.getElementById('attachmentViewerBody');
  const btnAttachmentOpenTab = document.getElementById('btnAttachmentOpenTab');
  const btnAttachmentDownload = document.getElementById('btnAttachmentDownload');
  const btnCloseAttachmentViewer = document.getElementById('btnCloseAttachmentViewer');
  const btnFooterCloseAttachmentViewer = document.getElementById('btnFooterCloseAttachmentViewer');

  const materialModal = document.getElementById('materialModal');
  const btnCloseMaterialModal = document.getElementById('btnCloseMaterialModal');
  const materialSearchInput = document.getElementById('materialSearchInput');
  const materialList = document.getElementById('materialList');
  const materialEmptyNotice = document.getElementById('materialEmptyNotice');
  const materialErrorNotice = document.getElementById('materialErrorNotice');

  let activeDetailIdForMaterial = null;
  let cachedMaterials = null;

  function syncErrorDetailValidationDOM() {
    if (errorDetailsContainer) {
      const cardNodes = errorDetailsContainer.querySelectorAll('.error-detail-card');
      cardNodes.forEach((cardEl) => {
        const detId = cardEl.dataset ? cardEl.dataset.detailId : '';
        const ce = detId && formState.detailErrors ? formState.detailErrors[detId] : null;
        const hasErr = Boolean(ce && Object.keys(ce).length > 0);
        cardEl.classList.toggle('has-error', hasErr);
      });
    }
    if (errorDetailsGlobalError) {
      if (formState.errors && formState.errors.errorDetails) {
        errorDetailsGlobalError.textContent = formState.errors.errorDetails;
        errorDetailsGlobalError.style.display = 'block';
      } else {
        errorDetailsGlobalError.textContent = '';
        errorDetailsGlobalError.style.display = 'none';
      }
    }
    syncClientValidationBannerIfResolved();
  }

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

      // 2. Material Name / Code Search Combobox (FRONTEND-001)
      const matGroup = document.createElement('div');
      matGroup.className = 'form-group';
      const comboboxMountId = `combobox_${detail.clientDetailId}`;
      matGroup.innerHTML = `
        <label class="form-label">資材名 / 資材コード <span class="required-asterisk">*</span></label>
        <div id="${comboboxMountId}" class="material-combobox-mount"></div>
        <div class="form-hint" style="margin-top: 4px; font-size: 0.8rem; color: var(--color-text-muted);">※資材名の一部（例: 足場板・単管・クランプ）または資材コードを入力して候補から選択してください。</div>
        <div class="form-error" style="${cardErrors.material ? 'display:block;' : ''}">${cardErrors.material || ''}</div>
      `;
      card.appendChild(matGroup);

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

      // Wire Cause textarea input + IME compositionend + change
      const textarea = causeGroup.querySelector('textarea');
      const handleCauseChange = (e) => {
        const nextVal = (e && e.target && typeof e.target.value === 'string') ? e.target.value : textarea.value;
        formState.updateErrorDetail(detail.clientDetailId, { causeDetail: nextVal });
        const errDiv = causeGroup.querySelector('.form-error');
        if (errDiv && !formState.detailErrors[detail.clientDetailId]?.causeDetail) {
          errDiv.textContent = '';
          errDiv.style.display = 'none';
        }
        syncErrorDetailValidationDOM();
      };
      textarea.addEventListener('input', handleCauseChange);
      textarea.addEventListener('change', handleCauseChange);
      textarea.addEventListener('compositionend', handleCauseChange);

      errorDetailsContainer.appendChild(card);

      // Synchronously mount independent MaterialCombobox instance for this detail card
      const mount = matGroup.querySelector('.material-combobox-mount') || document.getElementById(comboboxMountId);
      if (mount && typeof MaterialCombobox !== 'undefined') {
        new MaterialCombobox({
          container: mount,
          browseOnFocus: true,
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
            const errDiv = matGroup.querySelector('.form-error');
            if (errDiv && !formState.detailErrors[detail.clientDetailId]?.material) {
              errDiv.textContent = '';
              errDiv.style.display = 'none';
            }
            syncErrorDetailValidationDOM();
          },
          onClear: () => {
            formState.setMaterialForDetail(detail.clientDetailId, {
              materialCode: '',
              materialName: '',
              matCode: '',
              matName: ''
            });
            syncErrorDetailValidationDOM();
          }
        });
      }
    });

    syncErrorDetailValidationDOM();
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

      // 2. Category button (update in-place to preserve MaterialCombobox & textarea state across cards)
      const catBtn = e.target.closest('.category-btn');
      if (catBtn) {
        const detailId = catBtn.dataset.id;
        const cat = catBtn.dataset.cat;
        if (detailId && cat) {
          formState.updateErrorDetail(detailId, { category: cat });
          const cardEl = catBtn.closest('.error-detail-card');
          if (cardEl) {
            const allCatBtns = cardEl.querySelectorAll('.category-btn');
            allCatBtns.forEach((b) => {
              const sel = b.dataset.cat === cat;
              b.classList.toggle('is-selected', sel);
              b.setAttribute('aria-checked', String(sel));
            });
            const catGroupEl = catBtn.closest('.form-group');
            const catErrDiv = catGroupEl ? catGroupEl.querySelector('.form-error') : null;
            if (catErrDiv && !formState.detailErrors[detailId]?.category) {
              catErrDiv.textContent = '';
              catErrDiv.style.display = 'none';
            }
            syncErrorDetailValidationDOM();
          } else {
            renderErrorDetailCards();
          }
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
  // TASK-007: Evidence Attachment UI Controller (Google Drive Photo & PDF)
  // =========================================================================

  let isSubmittingShipmentWithAttachments = false;
  const detailAttachmentBlobCache = new Map(); // cacheKey -> { blobUrl, mimeType, originalFilename }

  function resolveActiveShipmentClient() {
    return shipmentClient || (typeof ShippingShipmentClient !== 'undefined' && rpcClient
      ? ShippingShipmentClient.createShipmentClient({ rpcClient })
      : (window.shippingClient || window.shipmentClient || null));
  }

  function clearDetailAttachmentBlobCache() {
    if (typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
      detailAttachmentBlobCache.forEach((entry) => {
        if (entry && entry.blobUrl) {
          try { URL.revokeObjectURL(entry.blobUrl); } catch (e) { }
        }
      });
    }
    detailAttachmentBlobCache.clear();
  }

  function formatFileSize(bytes) {
    if (typeof bytes !== 'number' || isNaN(bytes) || bytes <= 0) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  }

  function setAttachmentStatusBanner(variant, message) {
    if (!attachmentUploadStatus) return;
    if (!message) {
      attachmentUploadStatus.style.display = 'none';
      attachmentUploadStatus.textContent = '';
      attachmentUploadStatus.className = 'attachment-upload-banner';
      return;
    }
    attachmentUploadStatus.textContent = message;
    attachmentUploadStatus.className = 'attachment-upload-banner' +
      (variant === 'error' ? ' is-error' : (variant === 'success' ? ' is-success' : ''));
    attachmentUploadStatus.style.display = 'block';
  }

  function setAttachmentErrorText(message) {
    if (!attachmentGlobalError) return;
    if (!message) {
      attachmentGlobalError.style.display = 'none';
      attachmentGlobalError.textContent = '';
      return;
    }
    attachmentGlobalError.textContent = message;
    attachmentGlobalError.style.display = 'block';
  }

  function readFileAsBase64(fileObj) {
    if (!fileObj) {
      return Promise.reject(new Error('ファイルデータが見つかりません。'));
    }
    if (typeof fileObj._base64Data === 'string') {
      return Promise.resolve(fileObj._base64Data);
    }
    if (typeof FileReader !== 'undefined') {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = String(reader.result || '');
          const commaIdx = result.indexOf(',');
          resolve(commaIdx !== -1 ? result.substring(commaIdx + 1) : result);
        };
        reader.onerror = () => reject(new Error('ファイルの読み取りに失敗しました。'));
        reader.readAsDataURL(fileObj);
      });
    }
    if (typeof fileObj.arrayBuffer === 'function') {
      return fileObj.arrayBuffer().then((ab) => {
        if (typeof Buffer !== 'undefined') {
          return Buffer.from(ab).toString('base64');
        }
        const bytes = new Uint8Array(ab);
        let binary = '';
        for (let i = 0; i < bytes.length; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        return btoa(binary);
      });
    }
    return Promise.reject(new Error('この環境ではファイルを読み取れません。'));
  }

  /**
   * Compresses large smartphone photos (and converts iPhone HEIC/HEIF when supported by browser)
   * to a legible JPEG (max 1920px, quality 0.82) to stay well within GAS execution/payload limits.
   */
  async function preparePhotoFileForAttachment(rawFile) {
    if (!rawFile) {
      throw new Error('画像ファイルが指定されていません。');
    }
    if (rawFile.size <= 0) {
      throw new Error('0バイトの画像ファイルは添付できません。');
    }
    const maxRawBytes = (typeof ATTACHMENT_LIMITS !== 'undefined' && ATTACHMENT_LIMITS.MAX_RAW_PHOTO_BYTES)
      ? ATTACHMENT_LIMITS.MAX_RAW_PHOTO_BYTES
      : 20 * 1024 * 1024;
    if (rawFile.size > maxRawBytes) {
      throw new Error('画像ファイルが大きすぎます（20MB以下の写真を選択してください）。');
    }

    const rawName = String(rawFile.name || ('photo_' + Date.now() + '.jpg')).trim();
    const rawMime = String(rawFile.type || '').trim().toLowerCase();
    const isHeic = rawMime === 'image/heic' || rawMime === 'image/heif' || /\.(heic|heif)$/i.test(rawName);
    const isStandardPhoto = rawMime === 'image/jpeg' || rawMime === 'image/png' || rawMime === 'image/webp' ||
      (!rawMime && /\.(jpe?g|png|webp)$/i.test(rawName));

    if (!isStandardPhoto && !isHeic) {
      throw new Error('写真は JPEG・PNG・WebP 形式のみ添付できます。');
    }

    const shouldAttemptCanvas = isHeic || rawFile.size > 900 * 1024;
    const canUseCanvas = typeof document !== 'undefined' &&
      typeof Image !== 'undefined' &&
      typeof URL !== 'undefined' &&
      typeof URL.createObjectURL === 'function';

    if (!shouldAttemptCanvas || !canUseCanvas) {
      if (isHeic) {
        throw new Error('HEIC形式の画像はこの環境で変換できません。JPEG・PNG・WebP画像またはPDFを選択してください。');
      }
      return { file: rawFile, originalFilename: rawName, mimeType: rawMime || 'image/jpeg', wasCompressed: false };
    }

    let tempObjUrl = '';
    try {
      tempObjUrl = URL.createObjectURL(rawFile);
      const img = await new Promise((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error('IMAGE_DECODE_FAILED'));
        el.src = tempObjUrl;
      });

      const origW = img.naturalWidth || img.width || 0;
      const origH = img.naturalHeight || img.height || 0;
      if (!origW || !origH) {
        throw new Error('IMAGE_DECODE_FAILED');
      }

      const maxDim = 1920;
      let targetW = origW;
      let targetH = origH;
      if (origW > maxDim || origH > maxDim) {
        if (origW >= origH) {
          targetW = maxDim;
          targetH = Math.max(1, Math.round((origH * maxDim) / origW));
        } else {
          targetH = maxDim;
          targetW = Math.max(1, Math.round((origW * maxDim) / origH));
        }
      }

      const canvas = document.createElement('canvas');
      canvas.width = targetW;
      canvas.height = targetH;
      const ctx = canvas.getContext('2d');
      if (!ctx || typeof canvas.toBlob !== 'function') {
        if (isHeic) {
          throw new Error('HEIC_UNSUPPORTED');
        }
        return { file: rawFile, originalFilename: rawName, mimeType: rawMime || 'image/jpeg', wasCompressed: false };
      }

      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, targetW, targetH);
      ctx.drawImage(img, 0, 0, targetW, targetH);

      const compressedBlob = await new Promise((resolve) => {
        canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.82);
      });

      if (!compressedBlob || compressedBlob.size <= 0) {
        if (isHeic) throw new Error('HEIC_UNSUPPORTED');
        return { file: rawFile, originalFilename: rawName, mimeType: rawMime || 'image/jpeg', wasCompressed: false };
      }

      if (!isHeic && compressedBlob.size >= rawFile.size && rawFile.size <= 5 * 1024 * 1024) {
        return { file: rawFile, originalFilename: rawName, mimeType: rawMime || 'image/jpeg', wasCompressed: false };
      }

      const baseStem = rawName.replace(/\.[^.]+$/, '') || ('photo_' + Date.now());
      const jpgName = baseStem + '.jpg';
      let finalFile = compressedBlob;
      if (typeof File === 'function') {
        try {
          finalFile = new File([compressedBlob], jpgName, { type: 'image/jpeg', lastModified: Date.now() });
        } catch (eFile) {
          compressedBlob.name = jpgName;
          finalFile = compressedBlob;
        }
      } else {
        compressedBlob.name = jpgName;
        finalFile = compressedBlob;
      }

      return {
        file: finalFile,
        originalFilename: jpgName,
        mimeType: 'image/jpeg',
        wasCompressed: true
      };
    } catch (convErr) {
      if (isHeic) {
        throw new Error('HEIC形式の画像はこのブラウザで変換できません。カメラ設定またはJPEG・PNG・PDFファイルをご利用ください。');
      }
      // Non-HEIC standard photo: fall back to original file if within 5MB limit
      return { file: rawFile, originalFilename: rawName, mimeType: rawMime || 'image/jpeg', wasCompressed: false };
    } finally {
      if (tempObjUrl && typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
        try { URL.revokeObjectURL(tempObjUrl); } catch (e) { }
      }
    }
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
      const badgeLabel = isPhoto ? '写真' : 'PDF';
      const displayName = att.originalFilename || (isPhoto ? '写真ファイル' : 'PDFファイル');
      const sizeStr = formatFileSize(att.fileSize) || '---';
      const mimeShort = isPhoto
        ? String(att.mimeType || 'image/jpeg').replace('image/', '').toUpperCase()
        : 'PDF';

      let statusClass = 'is-pending';
      let statusLabel = '保存待機';
      if (att.persisted === true || att.uploadState === 'persisted') {
        statusClass = 'is-persisted';
        statusLabel = 'Drive保存済';
      } else if (att.uploadState === 'uploading') {
        statusClass = 'is-uploading';
        statusLabel = 'Drive保存中...';
      } else if (att.uploadState === 'uploaded') {
        statusClass = 'is-uploaded';
        statusLabel = 'Drive一時保存済';
      } else if (att.uploadState === 'error') {
        statusClass = 'is-error';
        statusLabel = '保存エラー';
      }

      const canPreviewSaved = Boolean(att.persisted === true && att.shippingCheckId && att.attachmentId);
      let thumbHtml = '';
      if (isPhoto) {
        const previewSrc = att.localPreviewUrl || '';
        const lazyClass = (!previewSrc && canPreviewSaved) ? ' js-form-persisted-photo-thumb' : '';
        const dataAttrs = canPreviewSaved
          ? ` data-check-id="${escapeHtml(att.shippingCheckId)}" data-attachment-id="${escapeHtml(att.attachmentId)}" data-filename="${escapeHtml(displayName)}" data-mime="${escapeHtml(att.mimeType || 'image/jpeg')}" style="cursor:pointer;"`
          : '';
        thumbHtml = '<div class="attachment-thumb-wrap' + lazyClass + '"' + dataAttrs + '>' +
          (previewSrc
            ? '<img src="' + escapeHtml(previewSrc) + '" alt="証跡写真プレビュー ' + (idx + 1) + '" class="attachment-thumb-img">'
            : '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#1D4ED8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>') +
          '</div>';
      } else {
        thumbHtml = '<div class="attachment-thumb-wrap" style="background: #FEF2F2; border-color: #FECACA;">' +
          '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#B91C1C" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>' +
          '</div>';
      }

      const metaInfo = `${mimeShort} / ${sizeStr}` + (att.wasCompressed ? '（自動圧縮済）' : '');
      const errDetailHtml = att.uploadError
        ? '<div style="font-size: 0.76rem; color: #DC2626; font-weight: 600; margin-top: 2px;">' + escapeHtml(att.uploadError) + '</div>'
        : '';

      const viewSavedBtnHtml = canPreviewSaved
        ? '<button type="button" class="btn btn-secondary btn-preview-persisted-attachment" style="min-height: 36px; padding: 4px 10px; font-size: 0.8rem; margin-right: 4px;" ' +
        'data-check-id="' + escapeHtml(att.shippingCheckId) + '" ' +
        'data-attachment-id="' + escapeHtml(att.attachmentId) + '" ' +
        'data-attachment-type="' + escapeHtml(att.attachmentType) + '" ' +
        'data-filename="' + escapeHtml(displayName) + '" ' +
        'data-mime="' + escapeHtml(att.mimeType || '') + '">確認</button>'
        : '';

      item.innerHTML =
        thumbHtml +
        '<div class="attachment-info">' +
        '<div class="attachment-header-row">' +
        '<span class="attachment-type-badge ' + badgeClass + '">' + badgeLabel + '</span>' +
        '<span class="attachment-status-badge ' + statusClass + '">' + statusLabel + '</span>' +
        '<span class="attachment-filename" title="' + escapeHtml(displayName) + '">' + escapeHtml(displayName) + '</span>' +
        '</div>' +
        '<div class="attachment-meta" title="' + escapeHtml(metaInfo) + '">' + escapeHtml(metaInfo) + '</div>' +
        errDetailHtml +
        '</div>' +
        viewSavedBtnHtml +
        '<button type="button" class="btn-remove-attachment" ' + (isSubmittingShipmentWithAttachments ? 'disabled ' : '') +
        'data-attachment-id="' + escapeHtml(att.clientAttachmentId) + '" aria-label="' + escapeHtml(displayName) + ' を取り消す">' +
        '取消' +
        '</button>';

      attachmentList.appendChild(item);
    });

    // Lazy-load Drive thumbnails for persisted photo attachments when editing
    const persistedThumbs = attachmentList.querySelectorAll('.js-form-persisted-photo-thumb');
    persistedThumbs.forEach(async (thumbEl) => {
      const checkId = thumbEl.getAttribute('data-check-id') || '';
      const attId = thumbEl.getAttribute('data-attachment-id') || '';
      const fname = thumbEl.getAttribute('data-filename') || '写真';
      const mime = thumbEl.getAttribute('data-mime') || 'image/jpeg';
      if (!checkId || !attId || typeof fetchAuthorizedAttachmentBlobEntry !== 'function') return;
      try {
        const entry = await fetchAuthorizedAttachmentBlobEntry(checkId, attId, mime, fname);
        if (!thumbEl.isConnected) return;
        thumbEl.innerHTML = `<img src="${escapeHtml(entry.blobUrl)}" alt="${escapeHtml(fname)}" class="attachment-thumb-img">`;
      } catch (eThumb) { }
    });
  }

  // Event Delegation for Attachment Preview & Pre-Save Cancellation
  if (attachmentList) {
    attachmentList.addEventListener('click', (e) => {
      const previewBtn = e.target.closest('.btn-preview-persisted-attachment, .js-form-persisted-photo-thumb');
      if (previewBtn && typeof openAttachmentViewer === 'function') {
        const checkId = previewBtn.getAttribute('data-check-id') || '';
        const attId = previewBtn.getAttribute('data-attachment-id') || '';
        const attType = previewBtn.getAttribute('data-attachment-type') || 'photo';
        const fname = previewBtn.getAttribute('data-filename') || '証跡プレビュー';
        const mime = previewBtn.getAttribute('data-mime') || '';
        if (checkId && attId) {
          openAttachmentViewer({
            shippingCheckId: checkId,
            attachmentId: attId,
            attachmentType: attType,
            originalFilename: fname,
            mimeType: mime
          });
          return;
        }
      }

      if (isSubmittingShipmentWithAttachments) return;
      const removeBtn = e.target.closest('.btn-remove-attachment');
      if (removeBtn) {
        const attId = removeBtn.getAttribute('data-attachment-id');
        if (attId) {
          const removed = formState.removeAttachment(attId);
          // Discard staged uncommitted Drive file immediately; persisted files are cleaned up ONLY on save/update commit
          if (removed && !removed.persisted && removed.stagedUpload && removed.stagedUpload.driveFileId) {
            const client = resolveActiveShipmentClient();
            if (client && typeof client.discardStagedAttachment === 'function') {
              client.discardStagedAttachment(removed.stagedUpload).catch(() => { });
            }
          }
          setAttachmentErrorText('');
          if (!formState.attachments || formState.attachments.length === 0) {
            setAttachmentStatusBanner('', '');
          }
          renderAttachments();
        }
      }
    });
  }

  // 1. Photo Capture & Selection (Smartphone Camera / Library & PC Image Picker)
  if (btnCapturePhoto && fileCapturePhoto) {
    btnCapturePhoto.addEventListener('click', () => {
      if (isSubmittingShipmentWithAttachments) return;
      setAttachmentErrorText('');
      fileCapturePhoto.click();
    });

    fileCapturePhoto.addEventListener('change', async (e) => {
      const files = e.target.files ? Array.from(e.target.files) : [];
      fileCapturePhoto.value = '';
      if (files.length === 0) return;

      setAttachmentErrorText('');
      const errors = [];
      if (files.length > 0) {
        setAttachmentStatusBanner('info', '写真ファイルを読み込み中...');
      }

      for (let i = 0; i < files.length; i++) {
        try {
          const prepared = await preparePhotoFileForAttachment(files[i]);
          formState.addPhotoAttachment(prepared.file, {
            originalFilename: prepared.originalFilename,
            mimeType: prepared.mimeType,
            wasCompressed: prepared.wasCompressed
          });
        } catch (err) {
          errors.push(err && err.message ? err.message : '写真の追加に失敗しました。');
        }
      }

      setAttachmentStatusBanner('', '');
      if (errors.length > 0) {
        setAttachmentErrorText(errors.join(' / '));
      }
      renderAttachments();
    });
  }

  // 2. Direct PDF File Selection (PC & Smartphone Files Picker)
  if (btnSelectPdf && fileSelectPdf) {
    btnSelectPdf.addEventListener('click', () => {
      if (isSubmittingShipmentWithAttachments) return;
      setAttachmentErrorText('');
      fileSelectPdf.click();
    });

    fileSelectPdf.addEventListener('change', (e) => {
      const files = e.target.files ? Array.from(e.target.files) : [];
      fileSelectPdf.value = '';
      if (files.length === 0) return;

      setAttachmentErrorText('');
      const errors = [];
      for (let i = 0; i < files.length; i++) {
        try {
          formState.addPdfAttachment(files[i]);
        } catch (err) {
          errors.push(err && err.message ? err.message : 'PDFファイルの追加に失敗しました。');
        }
      }
      if (errors.length > 0) {
        setAttachmentErrorText(errors.join(' / '));
      }
      renderAttachments();
    });
  }

  // Memory cleanup on page unload
  window.addEventListener('beforeunload', () => {
    if (formState && typeof formState.cleanupAttachments === 'function') {
      formState.cleanupAttachments();
    }
    clearDetailAttachmentBlobCache();
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

  function ensureSubmitResultActionsEl() {
    if (!submitResultBanner) return null;
    let actEl = document.getElementById('submitResultActions');
    if (!actEl) {
      actEl = document.createElement('div');
      actEl.id = 'submitResultActions';
      actEl.style.display = 'none';
      actEl.style.marginTop = '10px';
      actEl.style.gap = '8px';
      actEl.style.flexWrap = 'wrap';
      submitResultBanner.appendChild(actEl);
    }
    return actEl;
  }

  function clearSubmitResultActions() {
    const actEl = document.getElementById('submitResultActions');
    if (actEl) {
      actEl.innerHTML = '';
      actEl.style.display = 'none';
    }
  }

  function showSubmitBanner(type, message, origin = 'server_result') {
    if (!submitResultBanner || !submitResultMessage) return;
    lastSubmitBannerOrigin = origin;
    clearSubmitResultActions();
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

  let draftToastHideTimer = null;

  function scrollPageToTop() {
    try {
      if (typeof window !== 'undefined' && typeof window.scrollTo === 'function') {
        window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
      }
    } catch (e) {
      try {
        if (typeof window !== 'undefined' && typeof window.scrollTo === 'function') {
          window.scrollTo(0, 0);
        }
      } catch (e2) {}
    }
    if (typeof document !== 'undefined') {
      if (document.documentElement) document.documentElement.scrollTop = 0;
      if (document.body) document.body.scrollTop = 0;
      const mainEl = document.getElementById('mainContent');
      if (mainEl) mainEl.scrollTop = 0;
    }
  }

  function showDraftSavedToast(titleText, subText) {
    if (typeof document === 'undefined') return;
    const toastEl = document.getElementById('draftSavedToast');
    const titleEl = document.getElementById('draftSavedToastTitle');
    const subEl = document.getElementById('draftSavedToastSub');
    if (titleEl) titleEl.textContent = titleText || '一時保存しました';
    if (subEl) subEl.textContent = subText || '後から続きを入力できます。';
    if (!toastEl) return;
    if (draftToastHideTimer) {
      clearTimeout(draftToastHideTimer);
      draftToastHideTimer = null;
    }
    toastEl.style.display = 'flex';
    draftToastHideTimer = setTimeout(() => {
      if (toastEl) toastEl.style.display = 'none';
      draftToastHideTimer = null;
    }, 3800);
  }

  function setSaveCompletionBackgroundLocked(locked) {
    if (typeof document === 'undefined') return;
    const targets = [
      document.querySelector ? document.querySelector('.app-header') : null,
      document.getElementById('mainContent')
    ];
    targets.forEach((el) => {
      if (!el) return;
      if (locked) {
        el.inert = true;
        if (typeof el.setAttribute === 'function') el.setAttribute('aria-hidden', 'true');
      } else {
        el.inert = false;
        if (typeof el.removeAttribute === 'function') el.removeAttribute('aria-hidden');
      }
    });
    if (document.body && document.body.style) {
      document.body.style.overflow = locked ? 'hidden' : '';
    }
  }

  function closeSaveCompletionModal(options = {}) {
    if (typeof document === 'undefined') return;
    const modalEl = document.getElementById('saveCompletionModal');
    if (modalEl) {
      modalEl.classList.remove('open');
      modalEl.style.display = 'none';
    }
    setSaveCompletionBackgroundLocked(false);

    if (options && options.navigateToList === true) {
      scrollPageToTop();
      if (typeof switchView === 'function') {
        switchView('list');
      }
      if (typeof loadShipmentCheckList === 'function') {
        loadShipmentCheckList(1, true);
      }
      return;
    }

    const focusTarget = document.getElementById('txtLoadingDate') || document.getElementById('btnNavRecord');
    if (focusTarget && typeof focusTarget.focus === 'function') {
      try { focusTarget.focus({ preventScroll: true }); } catch (e) {}
    }
  }

  function openSaveCompletionModal(mode) {
    if (typeof document === 'undefined') return;
    const isEdit = mode === 'EDIT_COMPLETED';
    const titleStr = isEdit ? '変更を保存しました' : '登録が完了しました';
    const descStr = '入力内容は正常に保存されました。';

    scrollPageToTop();

    if (submitResultBanner) {
      submitResultBanner.style.display = 'none';
    }
    clearSubmitResultActions();

    const modalEl = document.getElementById('saveCompletionModal');
    const titleEl = document.getElementById('saveCompletionTitle');
    const descEl = document.getElementById('saveCompletionDesc');
    if (titleEl) titleEl.textContent = titleStr;
    if (descEl) descEl.textContent = descStr;

    if (!modalEl) {
      showSubmitBanner('success', `${titleStr}。${descStr}`);
      return;
    }

    setSaveCompletionBackgroundLocked(true);
    modalEl.style.display = 'flex';
    modalEl.classList.add('open');

    const primaryBtn = document.getElementById('btnSaveCompletionGoList');
    if (primaryBtn && typeof primaryBtn.focus === 'function') {
      try { primaryBtn.focus({ preventScroll: true }); } catch (e) {}
    }
  }

  if (typeof window !== 'undefined') {
    window.closeSaveCompletionModal = closeSaveCompletionModal;
    window.openSaveCompletionModal = openSaveCompletionModal;
  }

  (function bindSaveCompletionModalEvents() {
    if (typeof document === 'undefined') return;
    const modalEl = document.getElementById('saveCompletionModal');
    const btnGoList = document.getElementById('btnSaveCompletionGoList');
    const btnCloseBottom = document.getElementById('btnSaveCompletionClose');
    const btnCloseTop = document.getElementById('btnCloseSaveCompletion');

    if (btnGoList) {
      btnGoList.addEventListener('click', () => {
        closeSaveCompletionModal({ navigateToList: true });
      });
    }
    if (btnCloseBottom) {
      btnCloseBottom.addEventListener('click', () => {
        closeSaveCompletionModal({ navigateToList: false });
      });
    }
    if (btnCloseTop) {
      btnCloseTop.addEventListener('click', () => {
        closeSaveCompletionModal({ navigateToList: false });
      });
    }
    if (modalEl) {
      modalEl.addEventListener('click', (e) => {
        if (e.target === modalEl) {
          closeSaveCompletionModal({ navigateToList: false });
        }
      });
      modalEl.addEventListener('keydown', (e) => {
        if (e.key !== 'Tab') return;
        const focusables = [btnCloseTop, btnGoList, btnCloseBottom].filter(Boolean);
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      });
    }
  })();

  /**
   * Read-only state verification when a mutation response is lost or times out.
   * NEVER re-sends or mutates any server record.
   */
  async function verifyMutationOutcomeReadOnly(client, mutationCtx) {
    if (!client || !mutationCtx) {
      return { status: 'UNKNOWN', aggregate: null };
    }
    const subRef = String(mutationCtx.submittedOpRef || '').trim();
    const targetId = String(mutationCtx.targetId || '').trim();

    try {
      if (targetId && typeof client.getShipment === 'function') {
        const getRes = await client.getShipment(targetId);
        if (!getRes || getRes.ok === false) {
          return { status: 'UNKNOWN', aggregate: null };
        }
        const agg = getRes.payload || getRes.data || getRes;
        if (!agg || typeof agg !== 'object') {
          return { status: 'UNKNOWN', aggregate: null };
        }
        if (agg.recoveryRequired === true || agg.recoveryStatus === 'RECOVERY_REQUIRED') {
          return { status: 'QUARANTINED', aggregate: agg };
        }
        const hist = Array.isArray(agg.editHistory) ? agg.editHistory : [];
        const matchedHist = subRef
          ? hist.some((h) => h && h.changeSummary && h.changeSummary.opRef === subRef)
          : false;
        const scParent = agg.shipmentCheck || {};
        const matchedParentSub = Boolean(
          subRef && (
            scParent.clientSubmissionId === subRef ||
            agg.clientSubmissionId === subRef
          )
        );
        if (matchedHist || (mutationCtx.mode === 'PROMOTE_DRAFT' && agg.recordStatus === 'COMPLETED' && matchedParentSub)) {
          return {
            status: 'SAVED_CONFIRMED',
            revision: Number(agg.revision || (agg.governance && agg.governance.revision)) || 1,
            recordId: String(scParent.shippingCheckId || agg.shippingCheckId || agg.draftId || targetId),
            aggregate: agg
          };
        }
        return {
          status: 'NOT_CONFIRMED',
          currentRevision: Number(agg.revision || (agg.governance && agg.governance.revision)) || 1,
          recordStatus: agg.recordStatus || '',
          aggregate: agg
        };
      }

      if (subRef && typeof client.listShipments === 'function') {
        const listRes = await client.listShipments({ includeDrafts: true, baseScope: 'BASE', page: 1, limit: 30 });
        if (listRes && listRes.ok !== false) {
          const payloadObj = listRes.payload || listRes.data || listRes;
          const items = Array.isArray(payloadObj)
            ? payloadObj
            : (Array.isArray(payloadObj && payloadObj.shipments)
              ? payloadObj.shipments
              : (Array.isArray(payloadObj && payloadObj.items) ? payloadObj.items : []));
          const foundItem = items.find((it) => it && it.clientSubmissionId === subRef);
          if (foundItem) {
            const foundId = String(foundItem.shippingCheckId || foundItem.draftId || '').trim();
            if (foundId && typeof client.getShipment === 'function') {
              const detailRes = await client.getShipment(foundId);
              const fullAgg = (detailRes && detailRes.payload) ? detailRes.payload : detailRes;
              if (fullAgg && detailRes.ok !== false) {
                return {
                  status: 'SAVED_CONFIRMED',
                  revision: Number(fullAgg.revision) || 1,
                  recordId: foundId,
                  aggregate: fullAgg
                };
              }
            }
            return {
              status: 'SAVED_CONFIRMED',
              revision: Number(foundItem.revision) || 1,
              recordId: foundId || '---',
              aggregate: foundItem
            };
          }
        }
      }
    } catch (verifyErr) {
      return { status: 'UNKNOWN', aggregate: null };
    }
    return { status: 'UNKNOWN', aggregate: null };
  }

  function applyVerifiedSavedOutcome(client, mutationCtx, reconcile) {
    try {
      if (typeof shipmentCache !== 'undefined' && shipmentCache.invalidateMutations) {
        shipmentCache.invalidateMutations();
      }
    } catch (cacheErr) { }

    if (client && typeof client.startNewSubmission === 'function') {
      client.startNewSubmission();
    }
    if (rpcClient && rpcClient.mutationBlocked === true) {
      rpcClient.mutationBlocked = false;
    }

    setAttachmentStatusBanner('', '');
    setAttachmentErrorText('');

    if (mutationCtx.mode === 'SAVE_DRAFT') {
      if (reconcile && reconcile.aggregate) {
        formState.hydrateFromAggregate(reconcile.aggregate);
        syncFormControlsFromState();
      }
      showSubmitBanner(
        'warning',
        '通信応答がタイムアウトしましたが、最新状態を再取得して照合した結果、サーバー側で一時保存が完了していることを確認しました。二重登録防止のため再送は不要です。',
        'server_result'
      );
      return;
    }

    try {
      if (typeof formState.resetForm === 'function') {
        formState.resetForm({ preserveLiftOperator: false, preserveEmployee: true });
      } else if (typeof formState.reset === 'function') {
        formState.reset({ preserveLiftOperator: false, preserveEmployee: true });
      }
      syncFormControlsFromState();
    } catch (resetErr) { }

    showSubmitBanner(
      'warning',
      '通信応答がタイムアウトしましたが、最新実績を再取得して照合した結果、サーバー側で変更が保存済みであることを確認しました。二重登録防止のため再送は不要です。',
      'server_result'
    );
  }

  function renderTimeoutVerificationBanner(client, mutationCtx, initialReconcile) {
    if (initialReconcile && initialReconcile.status === 'QUARANTINED') {
      try {
        if (typeof shipmentCache !== 'undefined' && shipmentCache.invalidateMutations) {
          shipmentCache.invalidateMutations();
        }
      } catch (cacheErr) { }
      showSubmitBanner(
        'error',
        'データ確認が必要です：サーバー側で更新処理が中断された可能性があるため、安全保護中です。再送せず実績一覧を確認してください。',
        'timeout_uncertain'
      );
      return;
    }

    let timeoutGuidance = 'サーバー通信がタイムアウトしました（応答未達のため保存完了とは確定していません）。二重登録を防ぐため自動再送は行っていません。「最新の保存状態を確認する」または「実績一覧を確認する」で最新状態をご確認ください。';
    if (initialReconcile && initialReconcile.status === 'NOT_CONFIRMED') {
      timeoutGuidance = 'サーバー通信がタイムアウトしました。現時点ではサーバーへの保存完了が確認されていないため、保存成功とは扱っていません。二重登録を防ぐため自動再送は行っていません。数秒後に「最新の保存状態を確認する」を押すか、「実績一覧を確認する」から最新状態をご確認ください。';
    }

    showSubmitBanner('error', timeoutGuidance, 'timeout_uncertain');

    const actEl = ensureSubmitResultActionsEl();
    if (!actEl) return;

    actEl.innerHTML = '';
    actEl.style.display = 'flex';

    const btnVerify = document.createElement('button');
    btnVerify.type = 'button';
    btnVerify.id = 'btnVerifyTimeoutOutcome';
    btnVerify.className = 'btn btn-secondary';
    btnVerify.style.minHeight = '44px';
    btnVerify.style.fontWeight = '700';
    btnVerify.textContent = '最新の保存状態を確認する（再送なし）';

    const btnGoList = document.createElement('button');
    btnGoList.type = 'button';
    btnGoList.id = 'btnGoListAfterTimeout';
    btnGoList.className = 'btn btn-secondary';
    btnGoList.style.minHeight = '44px';
    btnGoList.textContent = '実績一覧を確認する';

    btnVerify.addEventListener('click', async () => {
      if (btnVerify.disabled) return;
      btnVerify.disabled = true;
      const lm = resolveLoadingManager();
      if (lm) {
        lm.showProgressBar();
        lm.showBlockingLoader(
          '最新の保存状態を確認しています...',
          '再送は行わず、サーバー側の最新レコード状態のみを照合しています。'
        );
      }
      try {
        const nextRec = await verifyMutationOutcomeReadOnly(client, mutationCtx);
        if (nextRec && nextRec.status === 'SAVED_CONFIRMED') {
          applyVerifiedSavedOutcome(client, mutationCtx, nextRec);
        } else {
          renderTimeoutVerificationBanner(client, mutationCtx, nextRec);
        }
      } finally {
        if (lm) {
          lm.hideBlockingLoader();
          lm.hideProgressBar();
        }
        if (btnVerify.isConnected) {
          btnVerify.disabled = false;
        }
      }
    });

    btnGoList.addEventListener('click', () => {
      if (typeof switchView === 'function') {
        switchView('list');
      }
      if (typeof loadShipmentCheckList === 'function') {
        loadShipmentCheckList(1, true);
      }
    });

    actEl.appendChild(btnVerify);
    actEl.appendChild(btnGoList);
  }
  function renderValidationErrors() {
    if (formState && formState.errors) {
      if (formState.errors.liftOperator) {
        if (driverError) {
          driverError.textContent = formState.errors.liftOperator;
          driverError.style.display = 'block';
        }
      } else {
        if (driverError) driverError.style.display = 'none';
      }
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
      if (formState.errors.guidanceConfirmed) {
        if (guidanceCheckError) {
          guidanceCheckError.textContent = formState.errors.guidanceConfirmed;
          guidanceCheckError.style.display = 'block';
        }
      } else {
        if (guidanceCheckError) guidanceCheckError.style.display = 'none';
      }
    }
  }

  /**
   * Uploads only newly added local attachments (skipping persisted Drive attachments)
   * prior to draft save, completion, or completed-record update.
   */
  async function uploadPendingAttachmentsToDrive(client, progressBtn) {
    const activeSubId = typeof client.getCurrentSubmissionId === 'function'
      ? client.getCurrentSubmissionId()
      : '';
    const allAtts = Array.isArray(formState.attachments) ? formState.attachments : [];
    const pendingExists = allAtts.some(a => !a.persisted);
    if (!pendingExists) {
      return true;
    }

    if (typeof client.uploadAttachment !== 'function') {
      throw new Error('証跡アップロードクライアントが利用できません。ページを再読み込みしてください。');
    }

    for (let i = 0; i < allAtts.length; i++) {
      const att = allAtts[i];
      if (att.persisted === true) {
        continue; // Already persisted in Google Drive; never re-upload
      }
      const alreadyUploadedForThisSub =
        att.uploadState === 'uploaded' &&
        att.stagedUpload &&
        att.stagedUpload.driveFileId &&
        att.stagedUpload.uploadSignature &&
        (!activeSubId || att.stagedUpload.clientSubmissionId === activeSubId);

      if (alreadyUploadedForThisSub) {
        continue;
      }

      const progressText = `証跡をGoogle Driveへ保存中 (${i + 1}/${allAtts.length}): ${att.originalFilename}`;
      if (progressBtn) {
        progressBtn.textContent = `証跡保存中 (${i + 1}/${allAtts.length})...`;
      }
      const uploadLm = resolveLoadingManager();
      if (uploadLm && typeof uploadLm.updateBlockingLoaderMessage === 'function') {
        uploadLm.updateBlockingLoaderMessage(
          '証跡ファイルを保存しています...',
          `Google Driveへ証跡を保存中です (${i + 1}/${allAtts.length})。そのままお待ちください。`
        );
      }
      setAttachmentStatusBanner('info', progressText);
      formState.markAttachmentUploading(att.clientAttachmentId);
      renderAttachments();

      try {
        const base64Data = await readFileAsBase64(att.fileObject);
        const staged = await client.uploadAttachment({
          clientAttachmentId: att.clientAttachmentId,
          attachmentType: att.attachmentType,
          originalFilename: att.originalFilename,
          mimeType: att.mimeType,
          fileSize: att.fileSize,
          base64Data
        });
        formState.markAttachmentUploaded(att.clientAttachmentId, staged);
        renderAttachments();
      } catch (uploadErr) {
        const upReason = (uploadErr && uploadErr.message && !uploadErr.message.includes('fetch'))
          ? uploadErr.message
          : '証跡ファイルのアップロード中に通信エラーが発生しました。';
        formState.markAttachmentUploadError(att.clientAttachmentId, upReason);
        renderAttachments();
        setAttachmentStatusBanner(
          'error',
          `証跡「${att.originalFilename}」の保存に失敗しました。通信状況を確認して再度ボタンを押すか、該当ファイルを取り消してください。`
        );
        showSubmitBanner(
          'error',
          `証跡ファイル「${att.originalFilename}」のアップロードに失敗したため中断しました（${upReason}）。再試行できます。`
        );
        return false;
      }
    }
    return true;
  }

  function isServerStagedAttachmentCleaned(errOrRes) {
    if (!errOrRes || typeof errOrRes !== 'object') return false;
    if (errOrRes.stagedAttachmentsCleaned === true) return true;
    if (errOrRes.error && errOrRes.error.stagedAttachmentsCleaned === true) return true;
    if (errOrRes.details && typeof errOrRes.details === 'object') {
      if (errOrRes.details.stagedAttachmentsCleaned === true) return true;
      if (errOrRes.details.error && errOrRes.details.error.stagedAttachmentsCleaned === true) return true;
      if (errOrRes.details.raw && typeof errOrRes.details.raw === 'object') {
        if (errOrRes.details.raw.stagedAttachmentsCleaned === true) return true;
        if (errOrRes.details.raw.error && errOrRes.details.raw.error.stagedAttachmentsCleaned === true) return true;
      }
    }
    return false;
  }

  // Server-Persisted Draft Save Handler (一時保存)
  if (btnSaveDraft) {
    btnSaveDraft.addEventListener('click', async () => {
      if (isSubmittingShipmentWithAttachments) {
        showSubmitBanner('warning', '現在保存処理中です。しばらくお待ちください。');
        return;
      }
      if (submitResultBanner) submitResultBanner.style.display = 'none';
      clearSubmitResultActions();
      hideRevisionConflictBanner();
      setAttachmentErrorText('');

      isSubmittingShipmentWithAttachments = true;
      renderAttachments();
      if (btnCapturePhoto) btnCapturePhoto.disabled = true;
      if (btnSelectPdf) btnSelectPdf.disabled = true;
      if (btnSubmitCheck) btnSubmitCheck.disabled = true;
      if (btnCancelEditingMode) btnCancelEditingMode.disabled = true;
      btnSaveDraft.disabled = true;
      btnSaveDraft.setAttribute('aria-busy', 'true');
      btnSaveDraft.textContent = '一時保存しています...';

      const saveLm = resolveLoadingManager();
      if (saveLm) {
        saveLm.showProgressBar();
        saveLm.showBlockingLoader(
          '一時保存しています...',
          '入力内容と添付情報をサーバーへ保存しています。二重登録防止のためそのままお待ちください。'
        );
      }
      let slowDraftTimer = setTimeout(() => {
        if (!isSubmittingShipmentWithAttachments) return;
        const activeLm = resolveLoadingManager();
        if (activeLm && typeof activeLm.updateBlockingLoaderMessage === 'function') {
          activeLm.updateBlockingLoaderMessage(
            '一時保存しています...',
            'Google Sheetsへ書き込み中です。二重登録防止のため再送せずそのままお待ちください。'
          );
        }
      }, 6000);

      let activeClient = null;
      let draftMutationCtx = null;

      try {
        const client = resolveActiveShipmentClient();
        activeClient = client;
        if (!client || typeof client.saveDraft !== 'function') {
          throw new Error('一時保存クライアントが利用できません。ページを再読み込みしてください。');
        }

        const uploadedOk = await uploadPendingAttachmentsToDrive(client, btnSaveDraft);
        if (!uploadedOk) {
          return;
        }

        btnSaveDraft.textContent = '一時保存しています...';
        if (saveLm && typeof saveLm.updateBlockingLoaderMessage === 'function') {
          saveLm.updateBlockingLoaderMessage(
            '一時保存しています...',
            '入力内容と添付情報をサーバーへ保存しています。二重登録防止のためそのままお待ちください。'
          );
        }
        if (formState.editingMode === 'NEW' && txtLoadingDate && txtLoadingDate.value) {
          formState.setLoadingDate(txtLoadingDate.value);
        }
        const draftPayload = formState.getDraftSavePayload();
        const submittedOpRef = (typeof client.getCurrentSubmissionId === 'function' && client.getCurrentSubmissionId()) || '';
        draftMutationCtx = {
          mode: 'SAVE_DRAFT',
          targetId: formState.editingMode === 'DRAFT' ? formState.draftId : null,
          expectedPrevRev: Number(formState.expectedRevision) || 0,
          submittedOpRef: submittedOpRef
        };

        const res = await client.saveDraft(draftPayload);
        if (res && res.ok) {
          const resData = res.payload || res.data || {};
          try {
            if (typeof shipmentCache !== 'undefined' && shipmentCache.invalidateMutations) {
              shipmentCache.invalidateMutations();
            }
          } catch (cacheErr) { }

          formState.hydrateFromAggregate(resData);
          syncFormControlsFromState();
          setAttachmentStatusBanner('', '');
          setAttachmentErrorText('');

          showSubmitBanner(
            'success',
            '一時保存しました。後から続きを入力できます。'
          );
          showDraftSavedToast('一時保存しました', '後から続きを入力できます。');
        } else {
          if (isServerStagedAttachmentCleaned(res) && typeof formState.clearStagedUploads === 'function') {
            formState.clearStagedUploads();
          }
          setAttachmentStatusBanner('', '');
          const errCode = res && res.error && res.error.code;
          const errMsg = (res && res.error && res.error.message) || '一時保存中にエラーが発生しました。';
          if (
            errCode === 'RECORD_RECOVERY_REQUIRED' ||
            errCode === 'TRANSACTION_STATE_UNCERTAIN' ||
            errCode === 'QUARANTINE_UNLOCK_FAILED'
          ) {
            try {
              if (typeof shipmentCache !== 'undefined' && shipmentCache.invalidateMutations) {
                shipmentCache.invalidateMutations();
              }
            } catch (cacheErr) { }
            showSubmitBanner('error', errMsg.includes('データ確認が必要です') ? errMsg : `データ確認が必要です：${errMsg}`);
          } else if (errCode === 'ERR_REVISION_CONFLICT') {
            showRevisionConflictBanner(errMsg);
          } else {
            showSubmitBanner('error', errMsg);
          }
        }
      } catch (err) {
        const cleanedOnServer = isServerStagedAttachmentCleaned(err);
        if (cleanedOnServer && typeof formState.clearStagedUploads === 'function') {
          formState.clearStagedUploads();
        }
        setAttachmentStatusBanner('', '');
        const code = (err && err.code) || '';

        if (code === 'CLIENT_TIMEOUT' || code === 'NETWORK_TIMEOUT' || code === 'TRANSPORT_UNCERTAIN') {
          if (slowDraftTimer) {
            clearTimeout(slowDraftTimer);
            slowDraftTimer = null;
          }
          if (saveLm && typeof saveLm.updateBlockingLoaderMessage === 'function') {
            saveLm.updateBlockingLoaderMessage(
              'サーバーの保存状態を確認しています...',
              '再送は行わず、サーバー側の最新状態を照合しています。'
            );
          }
          const rec = activeClient && draftMutationCtx
            ? await verifyMutationOutcomeReadOnly(activeClient, draftMutationCtx)
            : { status: 'UNKNOWN', aggregate: null };
          if (rec && rec.status === 'SAVED_CONFIRMED') {
            applyVerifiedSavedOutcome(activeClient, draftMutationCtx, rec);
          } else {
            renderTimeoutVerificationBanner(activeClient, draftMutationCtx || { mode: 'SAVE_DRAFT' }, rec);
          }
          return;
        }

        const errMsg = (err && err.message && !err.message.includes('fetch'))
          ? err.message
          : '一時保存中に通信エラーが発生しました。';
        if (
          code === 'RECORD_RECOVERY_REQUIRED' ||
          code === 'TRANSACTION_STATE_UNCERTAIN' ||
          code === 'QUARANTINE_UNLOCK_FAILED'
        ) {
          try {
            if (typeof shipmentCache !== 'undefined' && shipmentCache.invalidateMutations) {
              shipmentCache.invalidateMutations();
            }
          } catch (cacheErr) { }
          showSubmitBanner('error', errMsg.includes('データ確認が必要です') ? errMsg : `データ確認が必要です：${errMsg}`);
        } else if (code === 'ERR_REVISION_CONFLICT') {
          showRevisionConflictBanner(errMsg);
        } else {
          showSubmitBanner('error', errMsg);
        }
      } finally {
        if (slowDraftTimer) {
          clearTimeout(slowDraftTimer);
          slowDraftTimer = null;
        }
        if (saveLm) {
          saveLm.hideBlockingLoader();
          saveLm.hideProgressBar();
        }
        isSubmittingShipmentWithAttachments = false;
        if (btnCapturePhoto) btnCapturePhoto.disabled = false;
        if (btnSelectPdf) btnSelectPdf.disabled = false;
        if (btnSubmitCheck) btnSubmitCheck.disabled = false;
        if (btnCancelEditingMode) btnCancelEditingMode.disabled = false;
        btnSaveDraft.disabled = false;
        btnSaveDraft.removeAttribute('aria-busy');
        updateEditingModeBannerUI();
        renderAttachments();
      }
    });
  }

  if (btnSubmitCheck) {
    btnSubmitCheck.addEventListener('click', async () => {
      if (isSubmittingShipmentWithAttachments) {
        showSubmitBanner('warning', '現在保存処理中です。しばらくお待ちください。');
        return;
      }
      if (submitResultBanner) submitResultBanner.style.display = 'none';
      clearSubmitResultActions();
      hideRevisionConflictBanner();
      setAttachmentErrorText('');

      // 1. Client validation (requires LiftOperator, ErrorDetails, AND GuidanceConfirmation)
      const isValid = formState.validate({
        requireLiftOperator: true,
        requireErrorDetails: true,
        requireGuidanceConfirmed: true
      });

      if (!isValid) {
        renderValidationErrors();
        renderErrorDetailCards();
        let valBannerMsg = '入力内容に不備があります。エラー項目を確認してください。';
        if (formState.errors.guidanceConfirmed) {
          valBannerMsg = formState.errors.guidanceConfirmed;
        } else if (formState.errors.errorDetails && !formState.errors.liftOperator && !formState.errors.totalMaterialTypeCount) {
          valBannerMsg = `入力内容に不備があります。${formState.errors.errorDetails}`;
        }
        showSubmitBanner('error', valBannerMsg, 'client_validation');
        return;
      }

      // 2. Coordinated Staged Drive Upload + Aggregate Completion / Update
      const isEditingCompleted = formState.editingMode === 'EDIT_COMPLETED' && Boolean(formState.editingShippingCheckId);
      const primaryProgressTitle = isEditingCompleted ? '変更を保存しています...' : '完了登録しています...';
      isSubmittingShipmentWithAttachments = true;
      renderAttachments();
      if (btnCapturePhoto) btnCapturePhoto.disabled = true;
      if (btnSelectPdf) btnSelectPdf.disabled = true;
      if (btnSaveDraft) btnSaveDraft.disabled = true;
      if (btnCancelEditingMode) btnCancelEditingMode.disabled = true;

      const submitLm = resolveLoadingManager();
      if (submitLm) {
        submitLm.showProgressBar();
        submitLm.showBlockingLoader(
          primaryProgressTitle,
          '入力内容と添付情報をサーバーへ保存しています。二重登録防止のためそのままお待ちください。'
        );
      }
      let slowSaveTimer = setTimeout(() => {
        if (!isSubmittingShipmentWithAttachments) return;
        const activeLm = resolveLoadingManager();
        if (activeLm && typeof activeLm.updateBlockingLoaderMessage === 'function') {
          activeLm.updateBlockingLoaderMessage(
            primaryProgressTitle,
            'Google Sheetsへ書き込み・整合性確認を行っています。二重登録防止のため再送せずそのままお待ちください。'
          );
        }
      }, 6000);

      let activeClient = null;
      let submitMutationCtx = null;

      try {
        btnSubmitCheck.disabled = true;
        btnSubmitCheck.setAttribute('aria-busy', 'true');
        btnSubmitCheck.textContent = primaryProgressTitle;

        const client = resolveActiveShipmentClient();
        activeClient = client;
        if (!client || (typeof client.completeShipment !== 'function' && typeof client.createShipment !== 'function')) {
          throw new Error('RPCクライアントが利用できません。ページを再読み込みしてください。');
        }

        // Phase A: Upload newly added attachments to private Google Drive folder (persisted attachments are skipped)
        const uploadedOk = await uploadPendingAttachmentsToDrive(client, btnSubmitCheck);
        if (!uploadedOk) {
          return;
        }

        // Phase B: Gather finalized payload and commit (completeShipment / updateShipment / fallback createShipment)
        btnSubmitCheck.textContent = primaryProgressTitle;
        if (submitLm && typeof submitLm.updateBlockingLoaderMessage === 'function') {
          submitLm.updateBlockingLoaderMessage(
            primaryProgressTitle,
            '入力内容と添付情報をサーバーへ保存しています。二重登録防止のためそのままお待ちください。'
          );
        }
        const payload = formState.getDraftPayload();
        const submittedOpRef = (typeof client.getCurrentSubmissionId === 'function' && client.getCurrentSubmissionId())
          || payload.clientSubmissionId
          || '';
        submitMutationCtx = {
          mode: isEditingCompleted ? 'EDIT_COMPLETED' : (formState.editingMode === 'DRAFT' ? 'PROMOTE_DRAFT' : 'COMPLETE_NEW'),
          targetId: isEditingCompleted
            ? formState.editingShippingCheckId
            : (formState.editingMode === 'DRAFT' ? formState.draftId : null),
          expectedPrevRev: Number(formState.expectedRevision) || 1,
          submittedOpRef: submittedOpRef
        };

        const res = isEditingCompleted
          ? await client.updateShipment(formState.editingShippingCheckId, payload)
          : (typeof client.completeShipment === 'function'
            ? await client.completeShipment(payload)
            : await client.createShipment(payload));

        if (res && res.ok) {
          const resData = res.payload || res.data || {};
          const isIdempotentReplay = Boolean(resData.idempotentReplay || resData.isNew === false);

          try {
            if (typeof shipmentCache !== 'undefined' && shipmentCache.invalidateMutations) {
              shipmentCache.invalidateMutations();
            }
          } catch (cacheErr) {
            console.warn('Cache invalidation notice:', cacheErr);
          }

          setAttachmentStatusBanner('', '');
          setAttachmentErrorText('');

          try {
            if (typeof formState.resetForm === 'function') {
              formState.resetForm({ preserveLiftOperator: false, preserveEmployee: true });
            } else if (typeof formState.reset === 'function') {
              formState.reset({ preserveLiftOperator: false, preserveEmployee: true });
            }
            syncFormControlsFromState();
          } catch (resetErr) {
            console.warn('Form reset non-critical notice:', resetErr);
          }

          const msg = isEditingCompleted
            ? '変更を保存しました。入力内容は正常に保存されました。'
            : (isIdempotentReplay
              ? '登録が完了しました。入力内容は正常に保存されました。'
              : '登録が完了しました。入力内容は正常に保存されました。');
          if (document.getElementById('saveCompletionModal')) {
            openSaveCompletionModal(isEditingCompleted ? 'EDIT_COMPLETED' : 'NEW_COMPLETED');
          } else {
            showSubmitBanner('success', msg);
          }
        } else {
          if (res && res.error && res.error.stagedAttachmentsCleaned === true) {
            formState.clearStagedUploads();
            renderAttachments();
          }
          setAttachmentStatusBanner('', '');
          const errCode = res && res.error && res.error.code;
          const errMsg = (res && res.error && res.error.message) || '登録処理中にエラーが発生しました。';
          if (
            errCode === 'RECORD_RECOVERY_REQUIRED' ||
            errCode === 'TRANSACTION_STATE_UNCERTAIN' ||
            errCode === 'QUARANTINE_UNLOCK_FAILED'
          ) {
            try {
              if (typeof shipmentCache !== 'undefined' && shipmentCache.invalidateMutations) {
                shipmentCache.invalidateMutations();
              }
            } catch (cacheErr) { }
            showSubmitBanner('error', errMsg.includes('データ確認が必要です') ? errMsg : `データ確認が必要です：${errMsg}`);
          } else if (errCode === 'ERR_REVISION_CONFLICT') {
            showRevisionConflictBanner(errMsg);
          } else {
            showSubmitBanner('error', errMsg);
          }
        }
      } catch (err) {
        const cleanedOnServer = Boolean(
          err && (
            err.stagedAttachmentsCleaned === true ||
            (err.details && err.details.raw && err.details.raw.stagedAttachmentsCleaned === true) ||
            err.code === 'INVALID_ATTACHMENT_SIGNATURE' ||
            err.code === 'STAGED_ATTACHMENT_MISSING'
          )
        );
        if (cleanedOnServer && typeof formState.clearStagedUploads === 'function') {
          formState.clearStagedUploads();
        }
        setAttachmentStatusBanner('', '');

        const code = (err && err.code) || '';
        if (code === 'ERR_REVISION_CONFLICT') {
          showRevisionConflictBanner(err.message || '他の社員によって更新されました。最新の内容を読み込んでください。');
          return;
        }
        if (code === 'CLIENT_TIMEOUT' || code === 'NETWORK_TIMEOUT' || code === 'TRANSPORT_UNCERTAIN') {
          if (slowSaveTimer) {
            clearTimeout(slowSaveTimer);
            slowSaveTimer = null;
          }
          if (submitLm && typeof submitLm.updateBlockingLoaderMessage === 'function') {
            submitLm.updateBlockingLoaderMessage(
              'サーバーの保存状態を確認しています...',
              '再送は行わず、サーバー側の最新レコード状態を照合しています。'
            );
          }
          const rec = activeClient && submitMutationCtx
            ? await verifyMutationOutcomeReadOnly(activeClient, submitMutationCtx)
            : { status: 'UNKNOWN', aggregate: null };
          if (rec && rec.status === 'SAVED_CONFIRMED') {
            applyVerifiedSavedOutcome(activeClient, submitMutationCtx, rec);
          } else {
            renderTimeoutVerificationBanner(activeClient, submitMutationCtx || { mode: 'EDIT_COMPLETED' }, rec);
          }
          return;
        }

        let errMsg = 'サーバーとの通信に失敗しました。接続環境を確認してください。';
        if (
          code === 'RECORD_RECOVERY_REQUIRED' ||
          code === 'TRANSACTION_STATE_UNCERTAIN' ||
          code === 'QUARANTINE_UNLOCK_FAILED'
        ) {
          try {
            if (typeof shipmentCache !== 'undefined' && shipmentCache.invalidateMutations) {
              shipmentCache.invalidateMutations();
            }
          } catch (cacheErr) { }
          const rawRecMsg = (err && err.message && !err.message.includes('fetch'))
            ? err.message
            : '前回の更新処理が中断されたため保護隔離中です。管理者に連絡してください。';
          errMsg = rawRecMsg.includes('データ確認が必要です') ? rawRecMsg : `データ確認が必要です：${rawRecMsg}`;
        } else if (code === 'UNAUTHENTICATED' || code === 'AUTH_EXPIRED') {
          errMsg = '認証セッションの有効期限が切れました。再度ログインしてください。';
        } else if (code === 'ACCESS_DENIED' || code === 'CROSS_BASE_EDIT_DENIED' || code === 'CROSS_BASE_ACCESS_DENIED') {
          errMsg = (err && err.message) || 'このデータを登録・編集する権限がありません。';
        } else if (code === 'SUBMISSION_IN_PROGRESS') {
          errMsg = '現在保存処理中です。しばらくお待ちください。';
        } else if (err && err.message && !err.message.includes('fetch')) {
          errMsg = err.message;
        }
        showSubmitBanner('error', errMsg);
      } finally {
        if (slowSaveTimer) {
          clearTimeout(slowSaveTimer);
          slowSaveTimer = null;
        }
        if (submitLm) {
          submitLm.hideBlockingLoader();
          submitLm.hideProgressBar();
        }
        isSubmittingShipmentWithAttachments = false;
        if (btnCapturePhoto) btnCapturePhoto.disabled = false;
        if (btnSelectPdf) btnSelectPdf.disabled = false;
        if (btnSaveDraft) btnSaveDraft.disabled = false;
        if (btnCancelEditingMode) btnCancelEditingMode.disabled = false;
        btnSubmitCheck.disabled = false;
        btnSubmitCheck.removeAttribute('aria-busy');
        updateEditingModeBannerUI();
        renderAttachments();
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
    if (!appNav) return;
    let contentWidth = appNav.scrollWidth;
    if (appNav.children && appNav.children.length > 0 && typeof appNav.getBoundingClientRect === 'function') {
      const navRect = appNav.getBoundingClientRect();
      if (navRect.width > 0) {
        for (let i = 0; i < appNav.children.length; i++) {
          const child = appNav.children[i];
          if (child && !child.hidden && child.style?.display !== 'none' && typeof child.getBoundingClientRect === 'function') {
            const childRect = child.getBoundingClientRect();
            const relativeRight = (childRect.right - navRect.left) + (appNav.scrollLeft || 0);
            if (relativeRight > contentWidth) {
              contentWidth = relativeRight;
            }
          }
        }
      }
    }
    const isOverflowing = (appNav.scrollWidth > appNav.clientWidth + 2) || (contentWidth > appNav.clientWidth + 2);
    appNav.classList.toggle('is-scrollable', isOverflowing);
    appNav.classList.toggle('is-locked', !isOverflowing);
    if (!isOverflowing && appNav.scrollLeft !== 0) {
      appNav.scrollLeft = 0;
    }
    if (appNav.scrollTop !== 0) {
      appNav.scrollTop = 0;
    }
    if (navScrollHint) {
      const totalWidth = Math.max(appNav.scrollWidth, contentWidth);
      const isEnd = (appNav.scrollLeft + appNav.clientWidth) >= (totalWidth - 6);
      navScrollHint.classList.toggle('is-visible', isOverflowing && !isEnd);
    }
  }

  if (appNav) {
    appNav.addEventListener('scroll', updateNavScrollHint, { passive: true });
    window.addEventListener('resize', updateNavScrollHint);
    if (typeof ResizeObserver === 'function') {
      const navResizeObserver = new ResizeObserver(() => updateNavScrollHint());
      navResizeObserver.observe(appNav);
    }
    updateNavScrollHint();
    setTimeout(updateNavScrollHint, 100);
  }

  const btnNavRecord = document.getElementById('btnNavRecord');
  const btnNavList = document.getElementById('btnNavList');
  const btnNavAnalytics = document.getElementById('btnNavAnalytics');
  const btnNavSettings = document.getElementById('btnNavSettings');
  const viewReviewSection = document.getElementById('viewReviewSection');
  const viewRecordSection = document.getElementById('viewRecordSection');
  const viewListSection = document.getElementById('viewListSection');
  const viewAnalyticsSection = document.getElementById('viewAnalyticsSection');
  const viewSettingsSection = document.getElementById('viewSettingsSection');

  // ==========================================================================
  // STEP 1 & STEP 2: Settings View Controller (Base-Scoped Staff Management)
  // ==========================================================================
  function showSettingsFeedback(targetEl, type, message) {
    if (!targetEl) return;
    if (!message) {
      targetEl.style.display = 'none';
      targetEl.textContent = '';
      targetEl.className = 'settings-feedback-msg';
      return;
    }
    targetEl.textContent = message;
    targetEl.className = `settings-feedback-msg is-${type}`;
    targetEl.style.display = 'block';
  }

  function renderSettingsStaffLists(liftOps, looseCreators) {
    const safeLiftOps = Array.isArray(liftOps) ? liftOps : [];
    const safeLooseCreators = Array.isArray(looseCreators) ? looseCreators : [];

    const pencilSvg = (typeof getLucideIcon === 'function')
      ? getLucideIcon('pencil', { size: 16, ariaHidden: true })
      : '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide-icon" aria-hidden="true"><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/></svg>';
    const checkSvg = (typeof getLucideIcon === 'function')
      ? getLucideIcon('check', { size: 16, ariaHidden: true })
      : '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide-icon" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';
    const closeSvg = (typeof getLucideIcon === 'function')
      ? getLucideIcon('x', { size: 16, ariaHidden: true })
      : '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide-icon" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';

    const buildStaffListItem = (item, idx, roleConfig) => {
      const staffCode = String(item[roleConfig.codeKey] || '').trim();
      const staffName = String(item[roleConfig.nameKey] || '').trim();
      const currentPartnerCode = String(item.partnerCode || '').trim();
      const resolvedPartnerName = String(item.partnerName || '').trim();

      const li = document.createElement('li');
      li.className = 'settings-staff-item';
      li.setAttribute('data-staff-code', staffCode);

      const mainRow = document.createElement('div');
      mainRow.className = 'settings-staff-row-main';

      const nameSpan = document.createElement('span');
      nameSpan.className = 'settings-staff-name';
      nameSpan.textContent = staffName;

      const rightWrap = document.createElement('div');
      rightWrap.className = 'settings-staff-actions';

      const partnerSpan = document.createElement('span');
      partnerSpan.className = resolvedPartnerName
        ? 'settings-staff-partner-badge'
        : 'settings-staff-partner-badge is-unset';
      partnerSpan.textContent = resolvedPartnerName || '協力会社未設定';

      const metaSpan = document.createElement('span');
      metaSpan.className = 'settings-staff-meta';
      metaSpan.textContent = `No.${idx + 1}`;

      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'btn-icon-edit-partner';
      editBtn.setAttribute('aria-label', '所属協力会社を変更');
      editBtn.setAttribute('title', '所属協力会社を変更');
      editBtn.setAttribute('data-tooltip', '所属協力会社を変更');
      editBtn.setAttribute('aria-expanded', 'false');
      editBtn.innerHTML = pencilSvg;

      rightWrap.appendChild(partnerSpan);
      rightWrap.appendChild(metaSpan);
      rightWrap.appendChild(editBtn);
      mainRow.appendChild(nameSpan);
      mainRow.appendChild(rightWrap);

      const editorWrap = document.createElement('div');
      editorWrap.className = 'settings-inline-partner-editor';
      editorWrap.style.display = 'none';

      const partnerSelect = document.createElement('select');
      partnerSelect.className = 'form-control settings-inline-partner-select';
      partnerSelect.setAttribute('aria-label', `${staffName}の所属協力会社を選択`);

      const saveBtn = document.createElement('button');
      saveBtn.type = 'button';
      saveBtn.className = 'btn-icon-save-partner';
      saveBtn.setAttribute('aria-label', '変更を保存');
      saveBtn.setAttribute('title', '変更を保存');
      saveBtn.setAttribute('data-tooltip', '変更を保存');
      saveBtn.innerHTML = checkSvg;

      const cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.className = 'btn-icon-cancel-partner';
      cancelBtn.setAttribute('aria-label', '変更をキャンセル');
      cancelBtn.setAttribute('title', '変更をキャンセル');
      cancelBtn.setAttribute('data-tooltip', '変更をキャンセル');
      cancelBtn.innerHTML = closeSvg;

      const editorActions = document.createElement('div');
      editorActions.className = 'settings-inline-partner-actions';
      editorActions.appendChild(saveBtn);
      editorActions.appendChild(cancelBtn);

      editorWrap.appendChild(partnerSelect);
      editorWrap.appendChild(editorActions);

      const populateInlineSelectOptions = () => {
        partnerSelect.innerHTML = '';
        const safePartners = Array.isArray(currentBasePartners) ? currentBasePartners : [];
        if (safePartners.length === 0) {
          const emptyOpt = document.createElement('option');
          emptyOpt.value = '';
          emptyOpt.textContent = 'この拠点に登録された協力会社がありません';
          partnerSelect.appendChild(emptyOpt);
          partnerSelect.value = '';
          partnerSelect.disabled = true;
          saveBtn.disabled = true;
          return;
        }

        partnerSelect.disabled = false;
        saveBtn.disabled = false;

        const placeholderOpt = document.createElement('option');
        placeholderOpt.value = '';
        placeholderOpt.textContent = '-- 所属協力会社を選択してください --';
        partnerSelect.appendChild(placeholderOpt);

        safePartners.forEach(p => {
          const opt = document.createElement('option');
          opt.value = p.partnerCode;
          opt.textContent = p.partnerName || p.partnerCode;
          partnerSelect.appendChild(opt);
        });

        const hasCurrent = Boolean(
          currentPartnerCode && safePartners.some(p => p.partnerCode === currentPartnerCode)
        );
        partnerSelect.value = hasCurrent ? currentPartnerCode : '';
      };

      const openEditor = () => {
        showSettingsFeedback(roleConfig.feedbackEl, 'info', '');
        populateInlineSelectOptions();
        editorWrap.style.display = 'flex';
        li.classList.add('is-editing');
        editBtn.setAttribute('aria-expanded', 'true');
        if (typeof partnerSelect.focus === 'function') {
          partnerSelect.focus();
        }
      };

      const closeEditor = (restoreFocus = false) => {
        editorWrap.style.display = 'none';
        li.classList.remove('is-editing');
        editBtn.setAttribute('aria-expanded', 'false');
        if (restoreFocus && typeof editBtn.focus === 'function') {
          editBtn.focus();
        }
      };

      const savePartnerChange = async () => {
        showSettingsFeedback(roleConfig.feedbackEl, 'info', '');
        const newPartnerCode = String(partnerSelect.value || '').trim();
        if (!newPartnerCode) {
          showSettingsFeedback(roleConfig.feedbackEl, 'error', '所属協力会社を選択してください。');
          return;
        }

        partnerSelect.disabled = true;
        saveBtn.disabled = true;
        cancelBtn.disabled = true;
        editBtn.disabled = true;
        try {
          const updatedRes = await roleConfig.updatePartner(staffCode, newPartnerCode);
          await populateBaseStaffDropdowns(true);
          renderSettingsStaffLists(currentBaseLiftOperators, currentBaseLooseItemCreators);
          const updatedEntity = updatedRes && (updatedRes[roleConfig.entityKey] || updatedRes.updated);
          const newPartnerName = (updatedEntity && updatedEntity.partnerName)
            || (currentBasePartners.find(p => p.partnerCode === newPartnerCode)?.partnerName)
            || newPartnerCode;
          showSettingsFeedback(
            roleConfig.feedbackEl,
            'success',
            `${roleConfig.roleLabel}「${staffName}」の所属協力会社を「${newPartnerName}」に変更しました。`
          );
        } catch (err) {
          const msg = (err && err.message) ? err.message : `${roleConfig.roleLabel}の所属協力会社の変更に失敗しました。`;
          showSettingsFeedback(roleConfig.feedbackEl, 'error', msg);
          partnerSelect.disabled = false;
          saveBtn.disabled = false;
          cancelBtn.disabled = false;
          editBtn.disabled = false;
        }
      };

      editBtn.addEventListener('click', () => {
        if (editorWrap.style.display !== 'none') {
          closeEditor(true);
        } else {
          openEditor();
        }
      });

      cancelBtn.addEventListener('click', () => {
        closeEditor(true);
      });

      saveBtn.addEventListener('click', savePartnerChange);

      partnerSelect.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          closeEditor(true);
        } else if (e.key === 'Enter') {
          e.preventDefault();
          savePartnerChange();
        }
      });

      li.appendChild(mainRow);
      li.appendChild(editorWrap);
      return li;
    };

    if (lblSettingsLiftOperatorCount) {
      lblSettingsLiftOperatorCount.textContent = `${safeLiftOps.length}名`;
    }
    if (listSettingsLiftOperators) {
      listSettingsLiftOperators.innerHTML = '';
      if (safeLiftOps.length === 0) {
        if (emptySettingsLiftOperators) emptySettingsLiftOperators.style.display = 'block';
      } else {
        if (emptySettingsLiftOperators) emptySettingsLiftOperators.style.display = 'none';
        const liftRoleConfig = {
          codeKey: 'liftOperatorCode',
          nameKey: 'liftOperatorName',
          entityKey: 'liftOperator',
          roleLabel: 'リフトマン',
          feedbackEl: msgSettingsLiftOperator,
          updatePartner: (code, partnerCode) => masterClient.updateLiftOperatorPartner(code, partnerCode)
        };
        safeLiftOps.forEach((op, idx) => {
          listSettingsLiftOperators.appendChild(buildStaffListItem(op, idx, liftRoleConfig));
        });
      }
    }

    if (lblSettingsLooseItemCreatorCount) {
      lblSettingsLooseItemCreatorCount.textContent = `${safeLooseCreators.length}名`;
    }
    if (listSettingsLooseItemCreators) {
      listSettingsLooseItemCreators.innerHTML = '';
      if (safeLooseCreators.length === 0) {
        if (emptySettingsLooseItemCreators) emptySettingsLooseItemCreators.style.display = 'block';
      } else {
        if (emptySettingsLooseItemCreators) emptySettingsLooseItemCreators.style.display = 'none';
        const creatorRoleConfig = {
          codeKey: 'looseItemCreatorCode',
          nameKey: 'looseItemCreatorName',
          entityKey: 'looseItemCreator',
          roleLabel: 'バラ作成担当者',
          feedbackEl: msgSettingsLooseItemCreator,
          updatePartner: (code, partnerCode) => masterClient.updateLooseItemCreatorPartner(code, partnerCode)
        };
        safeLooseCreators.forEach((c, idx) => {
          listSettingsLooseItemCreators.appendChild(buildStaffListItem(c, idx, creatorRoleConfig));
        });
      }
    }
  }

  async function loadSettingsView(forceRefresh = false) {
    const currentBaseCode = resolveEffectiveBaseCode();
    const currentBaseName = (currentAccessContext && currentAccessContext.baseName)
      || (formState && formState.currentEmployee && formState.currentEmployee.baseName)
      || '';

    if (lblSettingsCurrentBase) {
      if (currentBaseCode) {
        lblSettingsCurrentBase.textContent = currentBaseName
          ? `${currentBaseName} (${currentBaseCode})`
          : currentBaseCode;
      } else {
        lblSettingsCurrentBase.textContent = '所属Base未設定';
      }
    }

    if (!currentBaseCode) {
      if (settingsBaseErrorBanner) {
        settingsBaseErrorBanner.textContent = '所属Baseが設定されていないため、担当者の追加・選択はできません。管理者へ社員マスターの所属Base設定を依頼してください。';
        settingsBaseErrorBanner.style.display = 'block';
      }
      populateSettingsPartnerSelects([], { baseUnassigned: true });
      renderSettingsStaffLists([], []);
      return;
    }

    if (settingsBaseErrorBanner) {
      settingsBaseErrorBanner.style.display = 'none';
      settingsBaseErrorBanner.textContent = '';
    }

    const result = await populateBaseStaffDropdowns(Boolean(forceRefresh));
    if (result && result.error) {
      if (settingsBaseErrorBanner) {
        settingsBaseErrorBanner.textContent = result.error.message || '担当者一覧の取得に失敗しました。';
        settingsBaseErrorBanner.style.display = 'block';
      }
      renderSettingsStaffLists([], []);
      return;
    }
    renderSettingsStaffLists(currentBaseLiftOperators, currentBaseLooseItemCreators);
  }

  async function handleAddLiftOperator() {
    showSettingsFeedback(msgSettingsLiftOperator, 'info', '');
    const currentBaseCode = resolveEffectiveBaseCode();
    if (!currentBaseCode) {
      showSettingsFeedback(
        msgSettingsLiftOperator,
        'error',
        '所属Baseが設定されていないため、担当者の追加・選択はできません。'
      );
      return;
    }

    const rawName = txtNewLiftOperatorName ? txtNewLiftOperatorName.value : '';
    const trimmedName = String(rawName || '').normalize('NFC').replace(/[\u3000\s]+/g, ' ').trim();
    if (!trimmedName) {
      showSettingsFeedback(msgSettingsLiftOperator, 'error', 'リフトマン氏名を入力してください。');
      return;
    }

    const selectedPartnerCode = selNewLiftOperatorPartner ? String(selNewLiftOperatorPartner.value || '').trim() : '';
    if (!selectedPartnerCode) {
      showSettingsFeedback(msgSettingsLiftOperator, 'error', '所属協力会社を選択してください。');
      return;
    }

    if (btnAddLiftOperator) {
      btnAddLiftOperator.disabled = true;
      btnAddLiftOperator.textContent = '追加中...';
    }
    try {
      const createdRes = await masterClient.createLiftOperator(trimmedName, selectedPartnerCode);
      if (txtNewLiftOperatorName) {
        txtNewLiftOperatorName.value = '';
      }
      await populateBaseStaffDropdowns(true);
      renderSettingsStaffLists(currentBaseLiftOperators, currentBaseLooseItemCreators);
      const partnerName = (createdRes && createdRes.liftOperator && createdRes.liftOperator.partnerName)
        || (currentBasePartners.find(p => p.partnerCode === selectedPartnerCode)?.partnerName)
        || '';
      showSettingsFeedback(
        msgSettingsLiftOperator,
        'success',
        partnerName
          ? `リフトマン「${trimmedName}」（${partnerName}）を追加しました。`
          : `リフトマン「${trimmedName}」を追加しました。`
      );
    } catch (err) {
      const msg = (err && err.message) ? err.message : 'リフトマンの追加に失敗しました。';
      showSettingsFeedback(msgSettingsLiftOperator, 'error', msg);
    } finally {
      if (btnAddLiftOperator) {
        btnAddLiftOperator.disabled = currentBasePartners.length === 0;
        btnAddLiftOperator.textContent = '追加';
      }
    }
  }

  async function handleAddLooseItemCreator() {
    showSettingsFeedback(msgSettingsLooseItemCreator, 'info', '');
    const currentBaseCode = resolveEffectiveBaseCode();
    if (!currentBaseCode) {
      showSettingsFeedback(
        msgSettingsLooseItemCreator,
        'error',
        '所属Baseが設定されていないため、担当者の追加・選択はできません。'
      );
      return;
    }

    const rawName = txtNewLooseItemCreatorName ? txtNewLooseItemCreatorName.value : '';
    const trimmedName = String(rawName || '').normalize('NFC').replace(/[\u3000\s]+/g, ' ').trim();
    if (!trimmedName) {
      showSettingsFeedback(msgSettingsLooseItemCreator, 'error', 'バラ作成担当者氏名を入力してください。');
      return;
    }

    const selectedPartnerCode = selNewLooseItemCreatorPartner ? String(selNewLooseItemCreatorPartner.value || '').trim() : '';
    if (!selectedPartnerCode) {
      showSettingsFeedback(msgSettingsLooseItemCreator, 'error', '所属協力会社を選択してください。');
      return;
    }

    if (btnAddLooseItemCreator) {
      btnAddLooseItemCreator.disabled = true;
      btnAddLooseItemCreator.textContent = '追加中...';
    }
    try {
      const createdRes = await masterClient.createLooseItemCreator(trimmedName, selectedPartnerCode);
      if (txtNewLooseItemCreatorName) {
        txtNewLooseItemCreatorName.value = '';
      }
      await populateBaseStaffDropdowns(true);
      renderSettingsStaffLists(currentBaseLiftOperators, currentBaseLooseItemCreators);
      const partnerName = (createdRes && createdRes.looseItemCreator && createdRes.looseItemCreator.partnerName)
        || (currentBasePartners.find(p => p.partnerCode === selectedPartnerCode)?.partnerName)
        || '';
      showSettingsFeedback(
        msgSettingsLooseItemCreator,
        'success',
        partnerName
          ? `バラ作成担当者「${trimmedName}」（${partnerName}）を追加しました。`
          : `バラ作成担当者「${trimmedName}」を追加しました。`
      );
    } catch (err) {
      const msg = (err && err.message) ? err.message : 'バラ作成担当者の追加に失敗しました。';
      showSettingsFeedback(msgSettingsLooseItemCreator, 'error', msg);
    } finally {
      if (btnAddLooseItemCreator) {
        btnAddLooseItemCreator.disabled = currentBasePartners.length === 0;
        btnAddLooseItemCreator.textContent = '追加';
      }
    }
  }

  if (btnAddLiftOperator) {
    btnAddLiftOperator.addEventListener('click', handleAddLiftOperator);
  }
  if (txtNewLiftOperatorName) {
    txtNewLiftOperatorName.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleAddLiftOperator();
      }
    });
  }
  if (btnAddLooseItemCreator) {
    btnAddLooseItemCreator.addEventListener('click', handleAddLooseItemCreator);
  }
  if (txtNewLooseItemCreatorName) {
    txtNewLooseItemCreatorName.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleAddLooseItemCreator();
      }
    });
  }

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
    btnNavSettings?.classList.toggle('is-active', viewName === 'settings');

    btnNavRecord?.setAttribute('aria-current', viewName === 'record' ? 'page' : 'false');
    btnNavList?.setAttribute('aria-current', viewName === 'list' ? 'page' : 'false');
    btnNavReview?.setAttribute('aria-current', viewName === 'review' ? 'page' : 'false');
    btnNavAnalytics?.setAttribute('aria-current', viewName === 'analytics' ? 'page' : 'false');
    btnNavSettings?.setAttribute('aria-current', viewName === 'settings' ? 'page' : 'false');

    // Horizontal scroll active tab into view only when nav overflows, preventing vertical/diagonal page jitter
    updateNavScrollHint();
    const activeBtn = [btnNavRecord, btnNavList, btnNavReview, btnNavAnalytics, btnNavSettings].find(btn => btn?.classList.contains('is-active'));
    if (appNav && activeBtn && appNav.scrollWidth > appNav.clientWidth + 2 && typeof appNav.getBoundingClientRect === 'function' && typeof activeBtn.getBoundingClientRect === 'function') {
      try {
        const navRect = appNav.getBoundingClientRect();
        const btnRect = activeBtn.getBoundingClientRect();
        if (btnRect.left < navRect.left || btnRect.right > navRect.right) {
          const maxScrollLeft = Math.max(0, appNav.scrollWidth - appNav.clientWidth);
          const rawTargetLeft = btnRect.left < navRect.left
            ? appNav.scrollLeft - (navRect.left - btnRect.left) - 12
            : appNav.scrollLeft + (btnRect.right - navRect.right) + 12;
          const targetLeft = Math.max(0, Math.min(maxScrollLeft, rawTargetLeft));
          if (typeof appNav.scrollTo === 'function') {
            appNav.scrollTo({ left: targetLeft, behavior: 'smooth' });
          } else {
            appNav.scrollLeft = targetLeft;
          }
        }
      } catch {
        // fallback
      }
    }

    if (viewRecordSection) viewRecordSection.style.display = viewName === 'record' ? 'block' : 'none';
    if (viewListSection) viewListSection.style.display = viewName === 'list' ? 'block' : 'none';
    if (viewReviewSection) viewReviewSection.style.display = viewName === 'review' ? 'block' : 'none';
    if (viewAnalyticsSection) viewAnalyticsSection.style.display = viewName === 'analytics' ? 'block' : 'none';
    if (viewSettingsSection) viewSettingsSection.style.display = viewName === 'settings' ? 'block' : 'none';

    if (viewName === 'record') {
      ensureNewRecordDefaultLoadingDate();
    }

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
    } else if (viewName === 'settings') {
      loadSettingsView(true);
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
        formState.selectedLooseItemCreator = null;
        formState.looseItemCreatorName = '';
        formState.errors = {};
      }
    }

    // Clear Base-scoped dropdown candidates & Settings UI
    clearBaseStaffDropdownsAndSettingsUI();

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
    if (typeof syncFormControlsFromState === 'function') {
      syncFormControlsFromState();
    } else {
      if (typeof updateLiftOperatorUI === 'function') updateLiftOperatorUI();
      if (typeof renderErrorDetailCards === 'function') renderErrorDetailCards();
      if (typeof renderAttachments === 'function') renderAttachments();
    }
    if (typeof hideRevisionConflictBanner === 'function') hideRevisionConflictBanner();

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
    const selListRecordStatus = document.getElementById('selListRecordStatus');
    if (selListRecordStatus) selListRecordStatus.value = 'ALL';

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

    // 5. Close Detail & Attachment Viewer Modals and purge detail body & blob cache
    if (typeof closeAttachmentViewerModal === 'function') {
      closeAttachmentViewerModal();
    }
    clearDetailAttachmentBlobCache();
    setAttachmentStatusBanner('', '');
    setAttachmentErrorText('');
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

    // 7. Clear Master Client, Shipment List, and Material Search session caches
    if (window.masterClient && typeof window.masterClient.clearCache === 'function') {
      window.masterClient.clearCache();
    }
    if (typeof shipmentCache !== 'undefined' && typeof shipmentCache.invalidateAll === 'function') {
      shipmentCache.invalidateAll();
    }
    if (typeof MaterialCombobox !== 'undefined' && typeof MaterialCombobox.clearSharedCache === 'function') {
      MaterialCombobox.clearSharedCache();
    }
  }

  if (btnNavRecord) btnNavRecord.addEventListener('click', () => switchView('record'));
  if (btnNavList) btnNavList.addEventListener('click', () => switchView('list'));
  if (btnNavReview) btnNavReview.addEventListener('click', () => switchView('review'));
  if (btnNavAnalytics) btnNavAnalytics.addEventListener('click', () => switchView('analytics'));
  if (btnNavSettings) btnNavSettings.addEventListener('click', () => switchView('settings'));
  if (btnRefreshList) btnRefreshList.addEventListener('click', () => loadShipmentCheckList(currentListPage, true));
  if (btnRetryList) btnRetryList.addEventListener('click', () => loadShipmentCheckList(currentListPage, true));

  // Login Form Submission (BROWSER_INTEGRATION_PHASE_1 & SIMPLE_EMPLOYEE_LOGIN)
  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!authClient) {
        showLoginModal('認証クライアントが初期化されていません。', isAdminLoginMode, isPasswordChangeRequiredMode);
        return;
      }

      const empNo = txtLoginEmpNo ? txtLoginEmpNo.value.trim() : '';
      const password = txtLoginPassword ? txtLoginPassword.value : '';
      const newPassword = txtLoginNewPassword ? txtLoginNewPassword.value : '';
      const newPasswordConfirm = txtLoginNewPasswordConfirm ? txtLoginNewPasswordConfirm.value : '';

      if (!empNo) {
        showLoginModal('社員番号を入力してください。', isAdminLoginMode, false, 'error');
        return;
      }
      if (isPasswordChangeRequiredMode) {
        const normalizedNewPw = typeof newPassword.normalize === 'function' ? newPassword.normalize('NFC') : newPassword;
        const newPwLen = Array.from(normalizedNewPw).length;
        if (!newPassword || newPwLen < 4) {
          showLoginModal('パスワードは4文字以上で入力してください。', true, true, 'error');
          return;
        }
        if (newPwLen > 128) {
          showLoginModal('パスワードは128文字以下である必要があります。', true, true, 'error');
          return;
        }
        if (typeof PasswordKdf !== 'undefined' && typeof PasswordKdf.containsEmployeeNumber === 'function' && PasswordKdf.containsEmployeeNumber(normalizedNewPw, empNo)) {
          showLoginModal('社員番号を含むパスワードは使用できません。', true, true, 'error');
          return;
        }
        if (newPassword !== newPasswordConfirm) {
          showLoginModal('新しいパスワードと確認用パスワードが一致しません。', true, true, 'error');
          return;
        }
      } else if (isAdminLoginMode && !password) {
        showLoginModal('パスワードを入力してください。', true, false, 'error');
        return;
      }

      if (btnLoginSubmit) {
        btnLoginSubmit.disabled = true;
        btnLoginSubmit.textContent = isPasswordChangeRequiredMode
          ? 'パスワード変更中...'
          : (isAdminLoginMode ? '認証中...' : '確認中...');
      }

      try {
        let ctx = null;
        if (isPasswordChangeRequiredMode) {
          await authClient.changePassword(newPassword, { empNo });
          currentAccessContext = null;
          window.__CURRENT_ACCESS_CONTEXT__ = null;
          if (txtLoginEmpNo) {
            txtLoginEmpNo.value = empNo;
          }
          showLoginModal('パスワードを変更しました。新しいパスワードで再度ログインしてください。', true, false, 'success');
          return;
        } else if (isAdminLoginMode) {
          const loginRes = await authClient.login(empNo, password);
          if (loginRes && loginRes.mustChangePassword === true) {
            showLoginModal('初回ログインのため、新しいパスワードを設定してください。', true, true, 'info');
            return;
          }
          ctx = await authClient.getAccessContext();
        } else {
          const res = await authClient.simpleLogin(empNo);
          ctx = (res && res.context) ? res.context : (await authClient.getAccessContext());
        }

        if (ctx && ctx.empNo) {
          currentAccessContext = ctx;
          window.__CURRENT_ACCESS_CONTEXT__ = ctx;
          hideLoginModal();
          if (typeof closeEmployeeModal === 'function') {
            closeEmployeeModal();
          }
          switchView('record');
          await applyAccessContext(ctx);
        } else {
          throw new Error('Access context resolution failed');
        }
      } catch (loginErr) {
        console.error('Login failed:', loginErr);
        if (loginErr && (loginErr.code === 'MUST_CHANGE_PASSWORD' || loginErr.code === 'ERR_MUST_CHANGE_PASSWORD')) {
          showLoginModal('初回ログインのため、新しいパスワードを設定してください。', true, true, 'info');
          return;
        }
        let msg = (loginErr && loginErr.message) ? loginErr.message : '社員番号が正しくありません。';
        if (loginErr && loginErr.name === 'TransportError') {
          msg = loginErr.message || '通信エラーが発生しました。接続状況を確認の上、再試行してください。';
        } else if (loginErr && loginErr.code === 'INVALID_CREDENTIALS') {
          msg = '社員番号またはパスワードが正しくありません。';
        } else if (loginErr && loginErr.code === 'ACCOUNT_LOCKED') {
          msg = 'アカウントが一時的にロックされています。時間をおいて再試行してください。';
        } else if (loginErr && loginErr.code === 'EMPLOYEE_NOT_FOUND') {
          msg = '社員番号が見つかりません。入力内容を確認してください。';
        } else if (loginErr && loginErr.code === 'EMPLOYEE_DISABLED') {
          msg = 'この社員アカウントは無効化されています。';
        }
        showLoginModal(msg, isAdminLoginMode, isPasswordChangeRequiredMode, 'error');
      } finally {
        if (btnLoginSubmit) {
          btnLoginSubmit.disabled = false;
          btnLoginSubmit.textContent = isPasswordChangeRequiredMode
            ? 'パスワード変更'
            : (isAdminLoginMode ? 'ログイン' : '利用開始');
        }
      }
    });
  }

  // Switch Employee Handler (Section 2: 社員切替)
  let isSwitchingUser = false;
  if (btnHeaderSwitchUser) {
    btnHeaderSwitchUser.addEventListener('click', async () => {
      if (isSwitchingUser) return;
      isSwitchingUser = true;

      btnHeaderSwitchUser.disabled = true;
      btnHeaderSwitchUser.setAttribute('aria-busy', 'true');

      try {
        if (authClient && typeof authClient.logout === 'function') {
          const logoutPromise = authClient.logout();
          const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('TIMEOUT')), 3000)
          );
          await Promise.race([logoutPromise, timeoutPromise]).catch(() => { });
        }
      } finally {
        if (authClient && typeof authClient.clearSavedEmployeeCode === 'function') {
          authClient.clearSavedEmployeeCode();
        } else if (typeof SessionClient !== 'undefined' && typeof SessionClient.clearSavedEmployeeCode === 'function') {
          SessionClient.clearSavedEmployeeCode();
        }
        if (typeof SessionClient !== 'undefined' && typeof SessionClient.clearToken === 'function') {
          SessionClient.clearToken();
        }
        if (typeof shipmentCache !== 'undefined' && shipmentCache.invalidateAll) {
          shipmentCache.invalidateAll();
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
        } catch (e) { }
        if (headerUserName) headerUserName.textContent = '';
        if (btnHeaderLogout) btnHeaderLogout.style.display = 'none';
        btnHeaderSwitchUser.style.display = 'none';
        btnHeaderSwitchUser.disabled = false;
        btnHeaderSwitchUser.removeAttribute('aria-busy');
        if (btnNavReview) {
          btnNavReview.style.display = 'none';
          btnNavReview.setAttribute('hidden', '');
        }
        updateNavScrollHint();
        try {
          resetViewsForLogout();
        } catch (e) { }
        isSwitchingUser = false;
        if (txtLoginEmpNo) {
          txtLoginEmpNo.value = '';
        }
        showLoginModal('社員番号を入力して利用を開始してください。', false);
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
        if (authClient && typeof authClient.clearSavedEmployeeCode === 'function') {
          authClient.clearSavedEmployeeCode();
        } else if (typeof SessionClient !== 'undefined' && typeof SessionClient.clearSavedEmployeeCode === 'function') {
          SessionClient.clearSavedEmployeeCode();
        }
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
          if (btnHeaderSwitchUser) {
            btnHeaderSwitchUser.style.display = 'none';
            btnHeaderSwitchUser.disabled = false;
          }
          if (btnNavReview) {
            btnNavReview.style.display = 'none';
            btnNavReview.setAttribute('hidden', '');
          }
          updateNavScrollHint();
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
        showLoginModal(noticeMsg, false);
      }
    });
  }

  // Helper: Review / Record Status Badge
  function getReviewBadgeHtml(status, recordStatus) {
    if (recordStatus === 'DRAFT' || status === '一時保存') {
      return '<span class="badge-review review-draft">一時保存</span>';
    }
    const s = status || '未確認';
    let cls = 'review-unconfirmed';
    if (s === 'OK') cls = 'review-ok';
    else if (s === 'NG') cls = 'review-ng';
    return `<span class="badge-review ${cls}">${escapeHtml(s)}</span>`;
  }

  function formatDisplayDate(dateVal) {
    if (!dateVal) return '---';
    if (formState && typeof formState.normalizeLoadingDate === 'function') {
      const normalized = formState.normalizeLoadingDate(dateVal);
      if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
        return normalized.replace(/-/g, '/');
      }
    }
    if (typeof dateVal === 'string') {
      const trimmed = dateVal.trim();
      if (/^\d{4}[-/]\d{2}[-/]\d{2}$/.test(trimmed)) {
        return trimmed.replace(/-/g, '/');
      }
      if (trimmed.includes('T') || trimmed.includes('Z')) {
        try {
          const d = new Date(trimmed);
          if (!isNaN(d.getTime())) {
            const jst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
            const yr = jst.getUTCFullYear();
            const mo = String(jst.getUTCMonth() + 1).padStart(2, '0');
            const da = String(jst.getUTCDate()).padStart(2, '0');
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
    const selListRecordStatus = document.getElementById('selListRecordStatus');
    const selectedRecordStatus = selListRecordStatus ? selListRecordStatus.value : 'ALL';

    const cacheScope = {
      action: 'shipment.list',
      empNo: userEmpNo,
      callerBaseCode: userBaseCode || '',
      baseCode: effectiveBaseCode || 'ALL',
      recordStatus: selectedRecordStatus,
      includeDrafts: selectedRecordStatus !== 'COMPLETED',
      month: currentListCustomRange ? '' : currentListMonth,
      startDate: currentListCustomRange ? currentListCustomRange.startDate : '',
      endDate: currentListCustomRange ? currentListCustomRange.endDate : '',
      page: page,
      limit: listPageLimit
    };
    const cacheKey = (typeof shipmentCache !== 'undefined')
      ? shipmentCache.buildKey(cacheScope)
      : `shipment.list:${userEmpNo}:${effectiveBaseCode || 'ALL'}:${selectedRecordStatus}:${currentListMonth}:${page}`;

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
          baseCode: effectiveBaseCode,
          recordStatus: selectedRecordStatus,
          includeDrafts: selectedRecordStatus !== 'COMPLETED'
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
  const selListRecordStatusEl = document.getElementById('selListRecordStatus');
  if (selListRecordStatusEl) {
    selListRecordStatusEl.addEventListener('change', () => {
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
      const checkId = item.shippingCheckId || item.draftId;
      const isDraft = item.recordStatus === 'DRAFT' || item.reviewStatus === '一時保存';
      const rawDate = item.loadingDate || (isDraft ? '' : (item.inputStartedAt ? item.inputStartedAt.slice(0, 10) : '---'));
      const loadingDate = rawDate ? formatDisplayDate(rawDate) : '積込日未入力';
      const baseName = item.historicalBaseName || item.HistoricalBaseName || item.baseName || item.BaseName || '---';
      const empName = item.updatedByName || item.employeeName || item.EmployeeName || item.empName || '---';
      const liftName = item.liftOperatorName || item.LiftOperatorName || (isDraft ? '未選択' : '---');
      const partnerName = item.partnerName || item.PartnerName || (isDraft ? '未選択' : '---');
      const errCount = (typeof item.errorDetailsCount === 'number')
        ? item.errorDetailsCount
        : ((item.errorDetails && Array.isArray(item.errorDetails))
          ? item.errorDetails.length
          : (isDraft
            ? (typeof item.equipmentTypeCount === 'number' ? item.equipmentTypeCount : 0)
            : ((typeof item.equipmentTypeCount === 'number' && item.equipmentTypeCount > 0) ? item.equipmentTypeCount : 1)));
      const isRecoveryRequired = Boolean(item.recoveryRequired === true || item.recoveryStatus === 'RECOVERY_REQUIRED');
      const badgeHtml = getReviewBadgeHtml(item.reviewStatus, item.recordStatus);
      const recoveryBadgeHtml = isRecoveryRequired
        ? ' <span class="badge-review review-ng" style="background:#FEE2E2;color:#991B1B;border:1px solid #EF4444;">データ確認が必要です</span>'
        : '';
      const revBadgeHtml = (item.revision && item.revision > 1)
        ? ` <span style="font-size:0.75rem;color:#64748B;font-weight:600;">Rev.${escapeHtml(String(item.revision))}</span>`
        : '';
      const countCellLabel = isDraft
        ? (item.attachmentsCount > 0 ? `証跡${item.attachmentsCount}件` : '下書き')
        : `${errCount}件`;

      // 1. Desktop Table Row (7 canonical columns)
      const tr = document.createElement('tr');
      tr.tabIndex = 0;
      tr.setAttribute('role', 'button');
      tr.setAttribute('aria-label', `${loadingDate} ${baseName} の詳細を開く`);
      if (isRecoveryRequired) {
        tr.style.backgroundColor = '#FEF2F2';
      } else if (isDraft) {
        tr.style.backgroundColor = '#FFFDF5';
      }
      tr.innerHTML = `
        <td style="font-weight: 700; color: var(--palette-headline); font-size: 0.95rem;">${escapeHtml(loadingDate)}</td>
        <td>${escapeHtml(baseName)}</td>
        <td>${escapeHtml(empName)}</td>
        <td>${escapeHtml(partnerName)}</td>
        <td>${escapeHtml(liftName)}</td>
        <td style="text-align: center; font-weight: 700; color: ${isDraft ? '#92400E' : '#DC2626'};">${escapeHtml(countCellLabel)}</td>
        <td style="text-align: center;">${badgeHtml}${recoveryBadgeHtml}${revBadgeHtml}</td>
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
      const card = document.createElement('div');
      card.className = 'compact-result-card';
      if (isRecoveryRequired) {
        card.style.borderLeft = '4px solid #DC2626';
        card.style.backgroundColor = '#FEF2F2';
      } else if (isDraft) {
        card.style.borderLeft = '4px solid #F59E0B';
        card.style.backgroundColor = '#FFFDF5';
      }
      card.tabIndex = 0;
      card.setAttribute('role', 'button');
      card.setAttribute('aria-label', `${loadingDate} ${baseName} の詳細を開く`);
      card.innerHTML = `
        <div class="compact-card-row-1">
          <span class="compact-date-base">${escapeHtml(loadingDate)}　${isDraft ? (item.attachmentsCount ? '証跡' + item.attachmentsCount + '件' : '一時保存中') : `エラー ${errCount}件`}</span>
          <span>${badgeHtml}${recoveryBadgeHtml}${revBadgeHtml}</span>
        </div>
        <div class="compact-card-row-2">
          ${escapeHtml(baseName)} / ${escapeHtml(empName)}
        </div>
        <div class="compact-card-row-3">
          <span>${escapeHtml(partnerName)} / ${escapeHtml(liftName)}</span>
          <span style="font-size: 0.8rem; color: ${isRecoveryRequired ? '#991B1B' : 'var(--palette-paragraph)'}; font-weight: ${isRecoveryRequired ? '700' : '400'};">${isRecoveryRequired ? 'データ確認が必要です →' : (isDraft ? '入力再開 →' : '詳細 →')}</span>
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

  async function openRecordForEditing(aggregateData, hydrateOptions = {}) {
    if (!aggregateData || isOpeningRecordForEditing) return;
    if (
      aggregateData.recoveryRequired === true ||
      aggregateData.recoveryStatus === 'RECOVERY_REQUIRED' ||
      aggregateData.canEdit === false
    ) {
      const blockMsg = (aggregateData.recoveryRequired === true || aggregateData.recoveryStatus === 'RECOVERY_REQUIRED')
        ? 'データ確認が必要です：前回の更新処理が中断されたため編集できません。管理者に連絡してください。'
        : 'このデータは編集できません。';
      showSubmitBanner('error', blockMsg);
      return;
    }

    isOpeningRecordForEditing = true;
    const triggerBtn = document.getElementById('btnResumeOrEditRecord');
    const originalBtnText = triggerBtn ? triggerBtn.textContent : '';
    if (triggerBtn) {
      triggerBtn.disabled = true;
      triggerBtn.setAttribute('aria-busy', 'true');
      triggerBtn.textContent = '読み込み中...';
    }

    const prevModalErr = document.getElementById('detailEditLoadErrorBanner');
    if (prevModalErr && prevModalErr.parentNode) {
      prevModalErr.parentNode.removeChild(prevModalErr);
    }

    const lm = resolveLoadingManager();
    if (lm) {
      lm.showProgressBar();
      lm.showBlockingLoader(
        '実績データを読み込み中...',
        '保存済みの入力情報・添付情報を取得しています。しばらくお待ちください。'
      );
    }

    const slowNoticeMs = typeof hydrateOptions.slowNoticeMs === 'number' ? hydrateOptions.slowNoticeMs : 4000;
    let slowLoadTimer = setTimeout(() => {
      if (!isOpeningRecordForEditing) return;
      const activeLm = resolveLoadingManager();
      if (activeLm && typeof activeLm.updateBlockingLoaderMessage === 'function') {
        activeLm.updateBlockingLoaderMessage(
          '実績データを読み込み中...',
          '通信に時間がかかっています。保存済みの入力情報・添付情報を取得中のため、再操作せずそのままお待ちください。'
        );
      }
    }, slowNoticeMs);

    try {
      const client = resolveActiveShipmentClient();
      const targetId = String(
        aggregateData.draftId ||
        aggregateData.shippingCheckId ||
        (aggregateData.shipmentCheck && aggregateData.shipmentCheck.shippingCheckId) ||
        ''
      ).trim();

      let effectiveData = aggregateData;
      if (hydrateOptions.fetchLatest === true && targetId && client && typeof client.getShipment === 'function') {
        const [freshRes] = await Promise.all([
          client.getShipment(targetId),
          populateBaseStaffDropdowns(false)
        ]);
        if (!freshRes || freshRes.ok === false) {
          throw new Error((freshRes && freshRes.error && freshRes.error.message) || '保存済みデータの取得に失敗しました。');
        }
        effectiveData = freshRes.payload || freshRes.data || freshRes;
      } else {
        await populateBaseStaffDropdowns(false);
      }

      if (
        effectiveData && (
          effectiveData.recoveryRequired === true ||
          effectiveData.recoveryStatus === 'RECOVERY_REQUIRED' ||
          effectiveData.canEdit === false
        )
      ) {
        const latestBlockMsg = (effectiveData.recoveryRequired === true || effectiveData.recoveryStatus === 'RECOVERY_REQUIRED')
          ? 'データ確認が必要です：前回の更新処理が中断されたため編集できません。管理者に連絡してください。'
          : 'このデータは編集できません。';
        throw new Error(latestBlockMsg);
      }

      closeDetailModal();
      hideRevisionConflictBanner();
      const sBanner = document.getElementById('submitResultBanner');
      if (sBanner) sBanner.style.display = 'none';
      clearSubmitResultActions();

      formState.hydrateFromAggregate(effectiveData, hydrateOptions);
      if (client && typeof client.startNewSubmission === 'function') {
        client.startNewSubmission();
      }
      syncFormControlsFromState();
      switchView('record');
      if (typeof window.scrollTo === 'function') {
        try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch (e) { }
      }
    } catch (loadErr) {
      const rawMsg = (loadErr && loadErr.message && !loadErr.message.includes('fetch'))
        ? loadErr.message
        : '保存済みの入力情報・添付情報の取得に失敗しました。接続状況を確認してください。';
      const fullErrMsg = rawMsg.startsWith('データ確認が必要です')
        ? rawMsg
        : ('実績データの読み込みに失敗しました：' + rawMsg);

      if (detailModal && detailModal.classList.contains('open') && detailBodyContent) {
        const errBanner = document.createElement('div');
        errBanner.id = 'detailEditLoadErrorBanner';
        errBanner.setAttribute('role', 'alert');
        errBanner.style.cssText = 'padding: 12px 16px; margin-bottom: 12px; border-radius: 8px; background-color: #FEF2F2; border: 1px solid #FECACA; color: #991B1B; display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px;';

        const msgSpan = document.createElement('div');
        msgSpan.style.cssText = 'font-size: 0.9rem; font-weight: 700; flex: 1; min-width: 200px;';
        msgSpan.textContent = fullErrMsg;

        const backBtn = document.createElement('button');
        backBtn.type = 'button';
        backBtn.id = 'btnBackToListFromEditError';
        backBtn.className = 'btn btn-secondary';
        backBtn.style.cssText = 'min-height: 44px; font-weight: 700; white-space: nowrap;';
        backBtn.textContent = '実績一覧へ戻る';
        backBtn.addEventListener('click', () => {
          closeDetailModal();
          switchView('list');
        });

        errBanner.appendChild(msgSpan);
        errBanner.appendChild(backBtn);
        detailBodyContent.insertBefore(errBanner, detailBodyContent.firstChild);
      } else {
        showSubmitBanner('error', fullErrMsg);
      }
    } finally {
      if (slowLoadTimer) {
        clearTimeout(slowLoadTimer);
        slowLoadTimer = null;
      }
      isOpeningRecordForEditing = false;
      if (triggerBtn && triggerBtn.isConnected) {
        triggerBtn.disabled = false;
        triggerBtn.removeAttribute('aria-busy');
        if (originalBtnText) triggerBtn.textContent = originalBtnText;
      }
      if (lm) {
        lm.hideBlockingLoader();
        lm.hideProgressBar();
      }
    }
  }

  let currentDetailLoadSeq = 0;

  // Open Detail View
  async function openDetailView(shippingCheckId) {
    if (!detailModal || !detailBodyContent) return;

    currentDetailLoadSeq = (currentDetailLoadSeq || 0) + 1;
    const seq = currentDetailLoadSeq;

    document.body.style.overflow = 'hidden';
    detailBodyContent.innerHTML = '<div style="padding: 32px; text-align: center; color: var(--color-text-muted); display: flex; flex-direction: column; align-items: center; gap: 12px;"><div class="inline-spinner" style="width: 28px; height: 28px;" aria-hidden="true"></div><div>実績詳細を読み込み中...</div></div>';
    detailModal.classList.add('open');

    try {
      const fetchDetailFn = async () => {
        if (shipmentClient && typeof shipmentClient.getShipment === 'function') {
          const res = await shipmentClient.getShipment(shippingCheckId);
          return (res && res.payload) ? res.payload : (res || {});
        } else if (rpcClient && typeof rpcClient.call === 'function') {
          const res = await rpcClient.call('shipment.get', { shippingCheckId: shippingCheckId });
          return (res && res.payload) ? res.payload : (res || {});
        }
        throw new Error('RPCクライアントが利用できません');
      };

      let detailData = null;
      if (typeof shipmentCache !== 'undefined' && typeof shipmentCache.fetchDetailWithDeduplication === 'function') {
        const empKey = currentAccessContext?.empNo || 'ANON';
        const dedupRes = await shipmentCache.fetchDetailWithDeduplication(
          `shipment.get:${empKey}:${shippingCheckId}`,
          fetchDetailFn
        );
        detailData = dedupRes.data;
      } else {
        detailData = await fetchDetailFn();
      }

      if (seq !== currentDetailLoadSeq) return;

      renderDetailContent(detailData);
    } catch (err) {
      if (seq !== currentDetailLoadSeq) return;
      const errMsg = (err && err.message && !err.message.includes('fetch'))
        ? err.message
        : '詳細データの取得に失敗しました。接続状況を確認の上、再試行してください。';
      detailBodyContent.innerHTML = `<div style="padding: 24px; color: #DC2626; font-weight: 600; text-align: center;">${escapeHtml(errMsg)}</div>`;
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

  // Render Detail Content (supports both DRAFT and COMPLETED aggregates, co-editing & edit history)
  function renderDetailContent(data) {
    if (!detailBodyContent) return;

    const isDraft = Boolean(data && data.recordStatus === 'DRAFT');
    const draftState = isDraft ? (data.draftState || {}) : null;
    const parent = isDraft
      ? {
        shippingCheckId: data.draftId || data.shippingCheckId,
        loadingDate: draftState.loadingDate,
        registeredAt: data.updatedAt || data.createdAt,
        inputStartedAt: draftState.inputStartedAt || data.createdAt,
        employeeCode: data.createdByEmpNo,
        employeeName: data.createdByName,
        historicalBaseCode: data.baseCode,
        historicalBaseName: data.baseName,
        historicalAreaName: data.areaName,
        liftOperatorCode: draftState.liftOperatorCode,
        liftOperatorName: draftState.liftOperatorName,
        partnerCode: draftState.partnerCode,
        partnerName: draftState.partnerName,
        equipmentTypeCount: draftState.equipmentTypeCount,
        hasLooseItems: draftState.hasLooseItems,
        looseItemCreatorName: draftState.looseItemCreatorName,
        looseItemStatus: draftState.looseItemStatus,
        transportCategory: draftState.transportCategory,
        carrierName: draftState.carrierName,
        driverName: draftState.driverName,
        reviewStatus: '一時保存'
      }
      : ((data && data.shipmentCheck) ? data.shipmentCheck : (data || {}));

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
    const looseCreatorsList = Array.isArray(data && data.looseItemCreators) ? data.looseItemCreators : [];
    const gov = (data && data.governance) || null;
    const editHistory = Array.isArray(data && data.editHistory) ? data.editHistory : [];
    const revision = Number((data && data.revision) || (gov && gov.revision)) || 1;
    const isRecoveryRequired = Boolean(
      data && (data.recoveryRequired === true || data.recoveryStatus === 'RECOVERY_REQUIRED')
    );
    const canEdit = !isRecoveryRequired && Boolean(data && data.canEdit === true);

    function cleanDetailVal(raw) {
      if (raw === null || raw === undefined) return '';
      const s = String(raw).trim();
      if (!s || s === '---' || s === '未選択' || s === '未設定' || s === '未指定' || s === 'エリア未設定') {
        return '';
      }
      return s;
    }

    function renderDetailItem(label, rawVal, opts = {}) {
      const valStr = cleanDetailVal(rawVal);
      const isEmpty = !valStr;
      const itemCls = `detail-info-item${opts.fullSpan ? ' is-full-span' : ''}`;
      const valCls = `detail-info-val${isEmpty ? ' is-empty' : ''}${opts.extraValClass ? ' ' + opts.extraValClass : ''}`;
      return `
        <div class="${itemCls}">
          <span class="detail-info-label">${escapeHtml(label)}</span>
          <span class="${valCls}">${escapeHtml(isEmpty ? '未入力' : valStr)}</span>
        </div>
      `;
    }

    function formatActorText(nameRaw, codeRaw) {
      const n = cleanDetailVal(nameRaw);
      const c = cleanDetailVal(codeRaw);
      if (n && c) return `${n}（${c}）`;
      return n || c || '';
    }

    const createdByDisplay = (data && (data.createdByName || data.createdByEmpNo))
      ? formatActorText(data.createdByName, data.createdByEmpNo)
      : formatActorText(parent.employeeName, parent.employeeCode);
    const updatedByDisplay = (data && (data.updatedByName || data.updatedByEmpNo))
      ? formatActorText(data.updatedByName, data.updatedByEmpNo)
      : createdByDisplay;

    const baseNameClean = cleanDetailVal(parent.historicalBaseName);
    const areaNameClean = cleanDetailVal(parent.historicalAreaName);
    const baseDisplay = baseNameClean
      ? (areaNameClean ? `${baseNameClean}（${areaNameClean}）` : baseNameClean)
      : (areaNameClean || '');

    const eqCountDisplay = (parent.equipmentTypeCount !== null && parent.equipmentTypeCount !== undefined && parent.equipmentTypeCount !== '')
      ? `${parent.equipmentTypeCount} 品種`
      : '';

    const createdAtRaw = formatDateTimeString((data && data.createdAt) || parent.registeredAt);
    const updatedAtRaw = formatDateTimeString((data && data.updatedAt) || parent.registeredAt);
    const inStartRaw = formatDateTimeString(parent.inputStartedAt || parent.inputStartAt);
    const createdAtLabel = cleanDetailVal(createdAtRaw) || '未入力';
    const updatedAtLabel = cleanDetailVal(updatedAtRaw) || '未入力';
    const inStartTime = cleanDetailVal(inStartRaw) || '未入力';

    const badgeHtml = getReviewBadgeHtml(parent.reviewStatus, data && data.recordStatus);
    const recoveryBadgeHtml = isRecoveryRequired
      ? ' <span class="badge-review review-ng" style="background:#FEE2E2;color:#991B1B;border:1px solid #EF4444;">データ確認が必要です</span>'
      : '';

    // Loose items & plain-text multi-creator formatting (no blue chips)
    let looseDisplayText = '';
    if (parent.hasLooseItems === true) looseDisplayText = 'バラあり';
    else if (parent.hasLooseItems === false) looseDisplayText = 'バラなし';

    let creatorsPlainText = '';
    if (looseCreatorsList.length > 0) {
      creatorsPlainText = looseCreatorsList
        .map((c) => cleanDetailVal(c && c.looseItemCreatorName))
        .filter(Boolean)
        .join('、');
    }
    if (!creatorsPlainText && parent.looseItemCreatorName) {
      creatorsPlainText = String(parent.looseItemCreatorName)
        .split(/\s*[,、]\s*/)
        .map((s) => cleanDetailVal(s))
        .filter(Boolean)
        .join('、');
    }

    // Guidance confirmation fields
    let guidanceStateHtml = '<span class="detail-info-val is-empty">未入力</span>';
    let guidanceActorDisplay = '';
    let guidanceTimeDisplay = '';
    if (isDraft) {
      guidanceStateHtml = (draftState && draftState.guidanceConfirmed)
        ? '<span class="detail-guidance-state is-confirmed">確認済（一時保存中）</span>'
        : '<span class="detail-guidance-state is-pending">未確認（完了登録時に確認）</span>';
    } else if (gov && gov.guidanceConfirmed) {
      guidanceStateHtml = '<span class="detail-guidance-state is-confirmed">指導実施確認済</span>';
      guidanceActorDisplay = formatActorText(gov.guidanceConfirmedByName, gov.guidanceConfirmedByEmpNo);
      guidanceTimeDisplay = gov.guidanceConfirmedAt ? cleanDetailVal(formatDateTimeString(gov.guidanceConfirmedAt)) : '';
    }

    // 1. Header Summary & Co-Editing / Quarantine Action Bar
    let coEditBarHtml = '';
    if (isRecoveryRequired) {
      const recNotice = (data && data.recoveryMessage) ? String(data.recoveryMessage) : 'データ確認が必要です';
      coEditBarHtml = `
        <div class="detail-edit-action-bar" id="detailRecoveryNoticeBar" role="alert" style="background-color: #FEF2F2; border: 2px solid #EF4444; color: #991B1B;">
          <div style="font-size: 0.9rem; font-weight: 700;">
            【重要】${escapeHtml(recNotice)}：前回の更新処理が中断された可能性があるため、データ保護のため編集・完了登録・審査判定を停止しています。管理者へ連絡してください。
          </div>
        </div>
      `;
    } else if (canEdit) {
      const btnText = isDraft ? '続きを入力する（入力再開・完了登録へ）' : 'この実績を編集する';
      coEditBarHtml = `
        <div class="detail-edit-action-bar">
          <div style="font-size: 0.85rem; color: var(--color-text-muted);">
            同じ拠点の社員が内容を編集できます。
          </div>
          <button type="button" id="btnResumeOrEditRecord" class="btn btn-primary" style="min-height: 44px; padding: 8px 18px; font-weight: 700;">
            ${escapeHtml(btnText)}
          </button>
        </div>
      `;
    } else if (!isDraft && data && data.canEdit === false) {
      coEditBarHtml = `
        <div class="detail-edit-action-bar" style="background-color: #F8FAFC;">
          <div style="font-size: 0.84rem; color: var(--color-text-muted);">
            ※他Base（拠点）の完了実績のため閲覧専用です（編集は所属Baseの社員のみ可能）。
          </div>
        </div>
      `;
    }

    const formattedLoadingDate = parent.loadingDate ? cleanDetailVal(formatDisplayDate(parent.loadingDate)) : '';
    const headerSummaryHtml = `
      <div class="detail-top-summary">
        <div class="detail-top-date-block">
          <span class="detail-info-label">積込日</span>
          <span class="detail-top-date-val${formattedLoadingDate ? '' : ' is-empty'}">${escapeHtml(formattedLoadingDate || '未入力')}</span>
        </div>
        <div class="detail-top-status-block" aria-label="確認状況">
          ${badgeHtml}${recoveryBadgeHtml}
        </div>
      </div>
      ${coEditBarHtml}
    `;

    // 2. 基本情報
    const showSeparateUpdater = Boolean(updatedByDisplay && updatedByDisplay !== createdByDisplay);
    const basicInfoHtml = `
      <section class="detail-group-section" aria-label="基本情報">
        <h3 class="detail-group-title">基本情報</h3>
        <div class="detail-info-grid">
          ${renderDetailItem('所属Base', baseDisplay)}
          ${renderDetailItem('登録者', createdByDisplay)}
          ${showSeparateUpdater ? renderDetailItem('最終更新者', updatedByDisplay) : ''}
          ${renderDetailItem('点検品種数', eqCountDisplay)}
          ${renderDetailItem('便種別（車両区分）', parent.transportCategory)}
          ${renderDetailItem('リフトマン', parent.liftOperatorName)}
          ${renderDetailItem('協力会社', parent.partnerName)}
          ${renderDetailItem('運送会社', parent.carrierName)}
          ${renderDetailItem('運転手名', parent.driverName)}
        </div>
      </section>
    `;

    // 3. バラ作成情報
    const looseInfoHtml = `
      <section class="detail-group-section" aria-label="バラ作成情報">
        <h3 class="detail-group-title">バラ作成情報</h3>
        <div class="detail-info-grid">
          ${renderDetailItem('バラ荷の有無', looseDisplayText)}
          ${renderDetailItem('バラ作成状況', parent.looseItemStatus)}
          ${renderDetailItem('バラ作成担当者', creatorsPlainText, { fullSpan: true, extraValClass: 'detail-creators-text' })}
        </div>
      </section>
    `;

    // 4. 指導実施確認
    const guidanceSectionHtml = `
      <section class="detail-group-section" aria-label="指導実施確認">
        <h3 class="detail-group-title">指導実施確認</h3>
        <div class="detail-info-grid">
          <div class="detail-info-item">
            <span class="detail-info-label">指導確認状態</span>
            <div>${guidanceStateHtml}</div>
          </div>
          ${renderDetailItem('確認者', guidanceActorDisplay)}
          ${renderDetailItem('確認日時', guidanceTimeDisplay)}
        </div>
      </section>
    `;

    // 5. 積み間違い資材
    let detailsHtml = `
      <section class="detail-group-section" aria-label="積み間違い資材">
        <div class="detail-group-header">
          <h3 class="detail-group-title">積み間違い資材</h3>
          <span class="detail-count-badge">${details.length}件</span>
        </div>
    `;

    if (details.length === 0) {
      detailsHtml += `<div class="detail-empty-box">${isDraft ? '未入力（一時保存中）' : '積み間違い資材はありません'}</div>`;
    } else {
      details.forEach((d, idx) => {
        const cat = cleanDetailVal(d && d.category) || '未入力';
        const matName = cleanDetailVal(d && d.materialName) || '未入力';
        const matCode = cleanDetailVal(d && d.materialCode) || '未入力';
        const cause = cleanDetailVal(d && d.causeDetail) || '未入力';

        detailsHtml += `
          <div class="detail-child-card">
            <div class="detail-child-header">
              <span class="detail-child-num">明細 #${idx + 1}</span>
              <span class="detail-category-tag">${escapeHtml(cat)}</span>
            </div>
            <div class="detail-info-grid" style="margin-bottom: 10px;">
              ${renderDetailItem('資材名', matName)}
              ${renderDetailItem('資材コード', matCode)}
            </div>
            <div class="detail-info-item">
              <span class="detail-info-label">原因・詳細</span>
              <div class="detail-child-cause-box${cause === '未入力' ? ' is-empty' : ''}">${escapeHtml(cause)}</div>
            </div>
          </div>
        `;
      });
    }
    detailsHtml += '</section>';

    // 6. 証跡添付 (Authenticated Google Drive Photo & PDF Viewing)
    const targetShippingCheckId = String(parent.shippingCheckId || (data && (data.draftId || data.shippingCheckId)) || '').trim();
    let attHtml = `
      <section class="detail-group-section" aria-label="証跡添付">
        <div class="detail-group-header">
          <h3 class="detail-group-title">証跡添付</h3>
          <span class="detail-count-badge">${attachments.length}件</span>
        </div>
    `;

    if (attachments.length === 0) {
      attHtml += '<div class="detail-empty-box">未入力（添付ファイルなし）</div>';
    } else {
      attachments.forEach((a, idx) => {
        const normType = String(a.attachmentType || '').toLowerCase() === 'pdf' ? 'pdf' : 'photo';
        const isPdf = normType === 'pdf';
        const typeBadge = isPdf
          ? '<span class="attachment-type-badge pdf">PDF</span>'
          : '<span class="attachment-type-badge photo">写真</span>';
        const filename = a.originalFilename || (isPdf ? 'PDFファイル.pdf' : '伝票写真.jpg');
        const attId = String(a.attachmentId || '').trim();
        const sizeLabel = formatFileSize(Number(a.fileSize) || 0);
        const createdLabel = a.createdAt ? cleanDetailVal(formatDateTimeString(a.createdAt)) : '';
        const subMeta = [sizeLabel, createdLabel].filter(Boolean).join(' / ') || (isPdf ? 'PDFドキュメント' : '画像ファイル');

        const thumbBoxHtml = isPdf
          ? `<div class="detail-attachment-thumb btn-open-attachment-viewer" data-check-id="${escapeHtml(targetShippingCheckId)}" data-attachment-id="${escapeHtml(attId)}" data-attachment-type="pdf" data-filename="${escapeHtml(filename)}" data-mime="${escapeHtml(a.mimeType || 'application/pdf')}" role="button" tabindex="0" aria-label="${escapeHtml(filename)} を開く" style="background: #FEF2F2; border-color: #FECACA;">
               <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#B91C1C" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
             </div>`
          : `<div class="detail-attachment-thumb btn-open-attachment-viewer js-lazy-photo-thumb" data-check-id="${escapeHtml(targetShippingCheckId)}" data-attachment-id="${escapeHtml(attId)}" data-attachment-type="photo" data-filename="${escapeHtml(filename)}" data-mime="${escapeHtml(a.mimeType || 'image/jpeg')}" data-index="${idx + 1}" role="button" tabindex="0" aria-label="${escapeHtml(filename)} を拡大表示">
               <span style="font-size: 0.72rem; color: var(--color-text-muted);">読込中...</span>
             </div>`;

        const actionBtnLabel = isPdf ? 'PDFを開く' : '拡大表示';

        attHtml += `
          <div class="detail-attachment-card">
            <div style="display: flex; align-items: center; gap: 12px; flex: 1; min-width: 0;">
              ${thumbBoxHtml}
              <div style="flex: 1; min-width: 0;">
                <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px; flex-wrap: wrap;">
                  ${typeBadge}
                  <span style="font-weight: 600; font-size: 0.9rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%;" title="${escapeHtml(filename)}">${escapeHtml(filename)}</span>
                </div>
                <div style="font-size: 0.8rem; color: var(--color-text-muted);">
                  ${escapeHtml(subMeta)}
                </div>
              </div>
            </div>
            <div class="detail-attachment-actions">
              <button type="button" class="btn btn-secondary btn-open-attachment-viewer"
                data-check-id="${escapeHtml(targetShippingCheckId)}"
                data-attachment-id="${escapeHtml(attId)}"
                data-attachment-type="${normType}"
                data-filename="${escapeHtml(filename)}"
                data-mime="${escapeHtml(a.mimeType || (isPdf ? 'application/pdf' : 'image/jpeg'))}"
                style="min-height: 40px; min-width: auto; padding: 6px 14px; font-size: 0.85rem; white-space: nowrap;">
                ${actionBtnLabel}
              </button>
            </div>
          </div>
        `;
      });
    }
    attHtml += '</section>';

    // 7. 審査情報・変更履歴
    const reviewerDisplay = formatActorText(parent.reviewerName, parent.reviewerEmpNo);
    const reviewedAtDisplay = parent.reviewedAt ? cleanDetailVal(formatDateTimeString(parent.reviewedAt)) : '';
    const reviewInfoGridHtml = isDraft
      ? ''
      : `
        <div class="detail-info-grid">
          <div class="detail-info-item">
            <span class="detail-info-label">審査状況</span>
            <div>${badgeHtml}</div>
          </div>
          ${renderDetailItem('審査者', reviewerDisplay)}
          ${renderDetailItem('審査日時', reviewedAtDisplay)}
          ${renderDetailItem('審査コメント', parent.reviewComment, { fullSpan: true })}
        </div>
      `;

    const actionLabelMap = {
      DRAFT_CREATE: '一時保存を新規作成',
      DRAFT_UPDATE: '一時保存を更新',
      DRAFT_PROMOTE_COMPLETE: '一時保存から完了登録',
      COMPLETE: '新規完了登録',
      COMPLETED_EDIT: '完了実績を更新',
      GUIDANCE_CONFIRM_ONLY: '対象者への指導実施確認を記録',
      REVIEW_RESET_ON_EDIT: '審査済み実績を更新（再審査待ちへリセット）',
      ADMIN_RECOVERY_RELEASED: '管理者による整合性確認・隔離解除',
      RECOVERY_REQUIRED: '不整合検知による保護隔離'
    };

    const historyItemsHtml = editHistory.length > 0
      ? editHistory.slice().reverse().map((h) => {
          const actLabel = actionLabelMap[h.actionType] || h.actionType || '更新';
          const authTag = h.authMode === 'SIMPLE_EMPNO' ? '社員番号簡易ログイン' : 'パスワード認証';
          const editorStr = formatActorText(h.editorName, h.editorEmpNo) || '未入力';
          const prevRevNote = (h.prevReview && h.prevReview.reviewStatus)
            ? `<div style="font-size:0.8rem;color:#991B1B;margin-top:4px;">旧審査記録: ${escapeHtml(h.prevReview.reviewStatus)}（審査者: ${escapeHtml(formatActorText(h.prevReview.reviewerName, h.prevReview.reviewerEmpNo) || '未入力')}）</div>`
            : '';
          return `
            <div class="detail-history-item">
              <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:4px;font-weight:700;color:var(--color-text-main);">
                <span>Rev.${h.newRevision}：${escapeHtml(actLabel)}</span>
                <span style="font-weight:500;color:var(--color-text-muted);">${escapeHtml(cleanDetailVal(formatDateTimeString(h.editedAt)) || '未入力')}</span>
              </div>
              <div style="margin-top:2px;color:#475569;">
                操作者: ${escapeHtml(editorStr)} ／ ${escapeHtml(authTag)}
              </div>
              ${prevRevNote}
            </div>
          `;
        }).join('')
      : '<div style="font-size:0.85rem;color:#64748B;">変更履歴はありません</div>';

    const reviewAndHistoryHtml = `
      <section class="detail-group-section" aria-label="審査情報・変更履歴">
        <h3 class="detail-group-title">審査情報・変更履歴</h3>
        ${reviewInfoGridHtml}
        <details class="detail-collapsible">
          <summary class="detail-collapsible-summary">
            変更履歴・記録日時を表示（履歴 ${editHistory.length}件）
          </summary>
          <div class="detail-collapsible-body">
            <div class="detail-info-grid" style="margin-bottom: 12px;">
              ${renderDetailItem('初回登録日時', createdAtLabel)}
              ${renderDetailItem('最終更新日時', updatedAtLabel)}
              ${renderDetailItem('入力開始日時', inStartTime)}
            </div>
            <div>${historyItemsHtml}</div>
          </div>
        </details>
      </section>
    `;

    // TASK-010: Render Review Action Panel ONLY for COMPLETED records
    const accessCtx = (typeof currentAccessContext !== 'undefined' ? currentAccessContext : null)
      || (typeof window !== 'undefined' ? window.__CURRENT_ACCESS_CONTEXT__ : null);
    const hasReviewCapability = (typeof AuthorizationClient !== 'undefined' && typeof AuthorizationClient.hasCapability === 'function')
      ? AuthorizationClient.hasCapability(accessCtx, 'SHIPMENT_REVIEW_NATIONWIDE')
      : Boolean(accessCtx && Array.isArray(accessCtx.capabilities) && accessCtx.capabilities.includes('SHIPMENT_REVIEW_NATIONWIDE'));

    const reviewSecElem = (typeof viewReviewSection !== 'undefined' ? viewReviewSection : null)
      || (typeof document !== 'undefined' ? document.getElementById('viewReviewSection') : null);
    const isReviewViewActive = Boolean(reviewSecElem && reviewSecElem.style.display !== 'none');
    const shouldRenderReviewPanel = !isDraft && (hasReviewCapability || isReviewViewActive);

    let reviewSecHtml = '';
    if (shouldRenderReviewPanel) {
      reviewSecHtml = '<div id="detailReviewActionSection" class="detail-review-action-section" style="margin-top: var(--space-lg); margin-bottom: 24px;"></div>';
    }

    detailBodyContent.innerHTML =
      headerSummaryHtml +
      basicInfoHtml +
      looseInfoHtml +
      guidanceSectionHtml +
      detailsHtml +
      attHtml +
      reviewAndHistoryHtml +
      reviewSecHtml;

    const btnResumeOrEdit = document.getElementById('btnResumeOrEditRecord');
    if (btnResumeOrEdit && canEdit) {
      btnResumeOrEdit.addEventListener('click', () => {
        openRecordForEditing(data, { fetchLatest: true });
      });
    }

    if (shouldRenderReviewPanel) {
      const reviewActionContainer = document.getElementById('detailReviewActionSection');
      if (reviewActionContainer && window.ReviewManager && typeof window.ReviewManager.renderReviewActionPanel === 'function') {
        if (!parent.shippingCheckId && data && data.shippingCheckId) {
          parent.shippingCheckId = data.shippingCheckId;
        }
        parent.recoveryRequired = isRecoveryRequired;
        parent.recoveryStatus = isRecoveryRequired ? 'RECOVERY_REQUIRED' : 'NORMAL';
        parent.recoveryMessage = isRecoveryRequired
          ? ((data && data.recoveryMessage) || 'データ確認が必要です')
          : '';
        window.ReviewManager.renderReviewActionPanel(reviewActionContainer, parent);
      }
    }

    // Bind interactive viewer triggers & lazy-load authenticated photo thumbnails
    bindDetailAttachmentViewers(detailBodyContent);
  }

  function decodeBase64ToUint8Array(base64Str) {
    const clean = String(base64Str || '').replace(/\s+/g, '');
    if (typeof atob === 'function') {
      const bin = atob(clean);
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) {
        out[i] = bin.charCodeAt(i);
      }
      return out;
    }
    if (typeof Buffer !== 'undefined') {
      return new Uint8Array(Buffer.from(clean, 'base64'));
    }
    return new Uint8Array(0);
  }

  async function fetchAuthorizedAttachmentBlobEntry(shippingCheckId, attachmentId, fallbackMime, fallbackName) {
    const cacheKey = `${shippingCheckId}::${attachmentId}`;
    if (detailAttachmentBlobCache.has(cacheKey)) {
      return detailAttachmentBlobCache.get(cacheKey);
    }

    const client = resolveActiveShipmentClient();
    let res = null;
    if (client && typeof client.getAttachmentContent === 'function') {
      res = await client.getAttachmentContent(shippingCheckId, attachmentId);
    } else if (rpcClient && typeof rpcClient.call === 'function') {
      res = await rpcClient.call('attachment.getContent', { shippingCheckId, attachmentId });
    } else {
      throw new Error('証跡取得クライアントが利用できません。');
    }

    const payload = (res && res.payload) ? res.payload : (res || {});
    if (!payload || !payload.base64Data) {
      throw new Error('証跡ファイルデータを取得できませんでした。');
    }

    const mimeType = String(payload.mimeType || fallbackMime || 'application/octet-stream').trim();
    const originalFilename = String(payload.originalFilename || fallbackName || 'attachment').trim();
    const bytes = decodeBase64ToUint8Array(payload.base64Data);
    let blobUrl = '';
    if (typeof Blob !== 'undefined' && typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
      const blob = new Blob([bytes], { type: mimeType });
      blobUrl = URL.createObjectURL(blob);
    } else {
      blobUrl = `data:${mimeType};base64,${payload.base64Data}`;
    }

    const entry = { blobUrl, mimeType, originalFilename };
    detailAttachmentBlobCache.set(cacheKey, entry);
    return entry;
  }

  let currentAttachmentViewerSeq = 0;
  let savedDetailScrollTop = null;

  function closeAttachmentViewerModal() {
    currentAttachmentViewerSeq++;
    if (attachmentViewerModal) {
      attachmentViewerModal.classList.remove('open');
      attachmentViewerModal.style.display = '';
    }
    if (attachmentViewerBody) {
      attachmentViewerBody.innerHTML = '';
    }
    if (btnAttachmentOpenTab) {
      btnAttachmentOpenTab.style.display = 'none';
      btnAttachmentOpenTab.setAttribute('href', '#');
    }
    if (btnAttachmentDownload) {
      btnAttachmentDownload.style.display = 'none';
      btnAttachmentDownload.setAttribute('href', '#');
    }
    if (detailModal) {
      detailModal.inert = false;
      detailModal.removeAttribute('aria-hidden');
    }
    if (detailModal && detailModal.classList.contains('open')) {
      document.body.style.overflow = 'hidden';
      if (detailBodyContent && savedDetailScrollTop !== null) {
        detailBodyContent.scrollTop = savedDetailScrollTop;
      }
    } else {
      document.body.style.overflow = '';
    }
    savedDetailScrollTop = null;
  }
  window.closeAttachmentViewerModal = closeAttachmentViewerModal;

  if (btnCloseAttachmentViewer) {
    btnCloseAttachmentViewer.addEventListener('click', (e) => {
      e.stopPropagation();
      closeAttachmentViewerModal();
    });
  }
  if (btnFooterCloseAttachmentViewer) {
    btnFooterCloseAttachmentViewer.addEventListener('click', (e) => {
      e.stopPropagation();
      closeAttachmentViewerModal();
    });
  }
  if (attachmentViewerModal) {
    attachmentViewerModal.addEventListener('click', (e) => {
      if (e.target === attachmentViewerModal) {
        e.stopPropagation();
        closeAttachmentViewerModal();
      }
    });
  }

  async function openAttachmentViewer(meta) {
    if (!attachmentViewerModal || !attachmentViewerBody) return;
    const seq = ++currentAttachmentViewerSeq;
    const filename = meta.originalFilename || '証跡プレビュー';
    const isPdf = meta.attachmentType === 'pdf';

    if (detailModal && detailModal.classList.contains('open')) {
      savedDetailScrollTop = detailBodyContent ? detailBodyContent.scrollTop : null;
      detailModal.inert = true;
      detailModal.setAttribute('aria-hidden', 'true');
    } else {
      savedDetailScrollTop = null;
    }

    if (attachmentViewerTitle) {
      attachmentViewerTitle.textContent = filename;
    }
    if (btnAttachmentOpenTab) btnAttachmentOpenTab.style.display = 'none';
    if (btnAttachmentDownload) btnAttachmentDownload.style.display = 'none';

    attachmentViewerBody.innerHTML = '<div class="attachment-viewer-stage"><div style="padding: 32px; color: #F8FAFC; font-weight: 600; text-align: center;">証跡ファイルを読み込み中...</div></div>';
    attachmentViewerModal.classList.add('open');
    document.body.style.overflow = 'hidden';
    if (btnCloseAttachmentViewer && typeof btnCloseAttachmentViewer.focus === 'function') {
      try { btnCloseAttachmentViewer.focus({ preventScroll: true }); } catch (e) { }
    }

    try {
      const entry = await fetchAuthorizedAttachmentBlobEntry(
        meta.shippingCheckId,
        meta.attachmentId,
        meta.mimeType,
        filename
      );
      if (seq !== currentAttachmentViewerSeq) return;

      if (btnAttachmentOpenTab) {
        btnAttachmentOpenTab.href = entry.blobUrl;
        btnAttachmentOpenTab.style.display = 'inline-flex';
      }
      if (btnAttachmentDownload) {
        btnAttachmentDownload.href = entry.blobUrl;
        btnAttachmentDownload.setAttribute('download', entry.originalFilename || filename);
        btnAttachmentDownload.style.display = 'inline-flex';
      }

      if (isPdf) {
        attachmentViewerBody.innerHTML =
          `<div class="attachment-viewer-stage"><iframe class="attachment-viewer-pdf-frame" src="${escapeHtml(entry.blobUrl)}" title="${escapeHtml(entry.originalFilename || filename)}"></iframe></div>`;
      } else {
        attachmentViewerBody.innerHTML =
          `<div class="attachment-viewer-stage"><img class="attachment-viewer-img" src="${escapeHtml(entry.blobUrl)}" alt="${escapeHtml(entry.originalFilename || filename)}"></div>`;
      }
    } catch (err) {
      if (seq !== currentAttachmentViewerSeq) return;
      const msg = (err && err.message && !err.message.includes('fetch'))
        ? err.message
        : '証跡ファイルの取得に失敗しました。権限または通信状況を確認してください。';
      attachmentViewerBody.innerHTML =
        `<div class="attachment-viewer-stage"><div style="padding: 24px; background: #FEF2F2; color: #991B1B; border: 1px solid #FECACA; border-radius: 6px; font-weight: 600; text-align: center; max-width: 480px;">${escapeHtml(msg)}</div></div>`;
    }
  }

  function bindDetailAttachmentViewers(container) {
    if (!container) return;

    const triggers = container.querySelectorAll('.btn-open-attachment-viewer');
    triggers.forEach((el) => {
      const activate = () => {
        const checkId = el.getAttribute('data-check-id') || '';
        const attId = el.getAttribute('data-attachment-id') || '';
        const attType = el.getAttribute('data-attachment-type') || 'photo';
        const fname = el.getAttribute('data-filename') || '証跡ファイル';
        const mime = el.getAttribute('data-mime') || '';
        if (!checkId || !attId) return;
        openAttachmentViewer({
          shippingCheckId: checkId,
          attachmentId: attId,
          attachmentType: attType,
          originalFilename: fname,
          mimeType: mime
        });
      };
      el.addEventListener('click', activate);
      if (el.tagName !== 'BUTTON') {
        el.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            activate();
          }
        });
      }
    });

    // Lazy-load authenticated photo thumbnails inside Detail Modal
    const lazyThumbs = container.querySelectorAll('.js-lazy-photo-thumb');
    lazyThumbs.forEach(async (thumbEl) => {
      const checkId = thumbEl.getAttribute('data-check-id') || '';
      const attId = thumbEl.getAttribute('data-attachment-id') || '';
      const fname = thumbEl.getAttribute('data-filename') || '伝票写真';
      const mime = thumbEl.getAttribute('data-mime') || 'image/jpeg';
      if (!checkId || !attId) return;
      try {
        const entry = await fetchAuthorizedAttachmentBlobEntry(checkId, attId, mime, fname);
        if (!thumbEl.isConnected) return;
        thumbEl.innerHTML = `<img src="${escapeHtml(entry.blobUrl)}" alt="${escapeHtml(fname)}">`;
      } catch {
        if (!thumbEl.isConnected) return;
        thumbEl.innerHTML = '<span style="font-size: 0.7rem; color: #DC2626;">読込失敗</span>';
      }
    });
  }

  // 5. Initialize Authentication & Session Restore (BROWSER_INTEGRATION_PHASE_1)
  await initAuthSession();

});


  // Global Escape key handler for modal dialogs (TASK-012 Accessibility / UI-REVIEW-003-R1)
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' || e.keyCode === 27) {
      const saveCompOverlay = document.getElementById('saveCompletionModal');
      if (saveCompOverlay && saveCompOverlay.classList.contains('open')) {
        if (typeof window.closeSaveCompletionModal === 'function') {
          window.closeSaveCompletionModal({ navigateToList: false });
        } else {
          saveCompOverlay.classList.remove('open');
          saveCompOverlay.style.display = 'none';
        }
        return;
      }
      const viewerOverlay = document.getElementById('attachmentViewerModal');
      if (viewerOverlay && viewerOverlay.classList.contains('open')) {
        if (typeof window.closeAttachmentViewerModal === 'function') {
          window.closeAttachmentViewerModal();
        } else {
          viewerOverlay.classList.remove('open');
        }
        return;
      }
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