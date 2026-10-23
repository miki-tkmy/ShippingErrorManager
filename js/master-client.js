/**
 * MasterApiClient
 * Client-side interface to canonical GAS Master RPC (shipment.getFormOptions).
 * Integrates lift operators, materials, partners, bases, and areas into a unified,
 * cached, deduplicated master data service.
 */
class MasterApiClient {
  constructor(baseUrl = '/api/master') {
    this.baseUrl = baseUrl;
    this.cachedFormOptions = null;
    this.cachedEmployees = null;
    this.cachedPartners = null;
    this.cachedBases = null;
    this.cachedAreas = null;
    this.cachedMaterials = null;
    this.cachedLiftOperators = null;
    this.inFlightFormOptionsPromise = null;
    this.loadSeq = 0;
    this.formOptionsCachedAt = 0;
  }

  clearCache() {
    this.loadSeq++;
    this.formOptionsCachedAt = 0;
    this.cachedFormOptions = null;
    this.cachedEmployees = null;
    this.cachedPartners = null;
    this.cachedBases = null;
    this.cachedAreas = null;
    this.cachedMaterials = null;
    this.cachedLiftOperators = null;
    this.inFlightFormOptionsPromise = null;
  }

  /**
   * Helper to load data from test fixtures in unit test or mock environments.
   * @private
   */
  _loadFromTestFixtures() {
    if (typeof window === 'undefined') return null;
    const fixtures = window.__SHIPPING_ERROR_MASTER_FIXTURES__;
    const liftOps = window.__SHIPPING_ERROR_LIFT_OPERATORS__;
    if (!fixtures && !liftOps) return null;

    const baseSource = fixtures?.M_Base || fixtures?.bases || fixtures?.M_Employee;
    const bases = Array.isArray(baseSource) ? baseSource.map(b => ({
      baseCode: b.BaseCode || b.baseCode,
      baseName: b.BaseName || b.baseName || b.BaseCode || b.baseCode,
      areaName: b.AreaName || b.areaName || ''
    })) : [];

    const matSource = fixtures?.M_Material || fixtures?.materials;
    const materials = Array.isArray(matSource) ? matSource.map(m => ({
      materialCode: String(m.MatCode || m.materialCode || '').trim(),
      materialName: String(m.MatName || m.materialName || '').trim(),
      matCode: String(m.MatCode || m.materialCode || '').trim(),
      matName: String(m.MatName || m.materialName || '').trim(),
      unitWeight: m.UnitWeight !== undefined ? Number(m.UnitWeight) : null
    })) : [];

    const partnerSource = fixtures?.M_Partner || fixtures?.partners;
    const partners = Array.isArray(partnerSource) ? partnerSource.map(p => ({
      partnerCode: String(p.PartnerCode || p.partnerCode || '').trim(),
      partnerName: String(p.PartnerName || p.partnerName || '').trim(),
      baseCode: String(p.BaseCode || p.baseCode || '').trim(),
      baseName: String(p.BaseName || p.baseName || '').trim(),
      areaCode: p.AreaCode || p.areaCode || null,
      areaName: String(p.AreaName || p.areaName || '').trim()
    })) : [];

    const opsSource = liftOps || fixtures?.liftOperators;
    const operators = Array.isArray(opsSource) ? opsSource.map(op => ({
      liftOperatorCode: String(op.liftOperatorCode || op.LiftOperatorCode || '').trim(),
      liftOperatorName: String(op.liftOperatorName || op.LiftOperatorName || '').trim(),
      baseCode: String(op.baseCode || op.BaseCode || '').trim(),
      partnerCode: String(op.partnerCode || op.PartnerCode || '').trim(),
      isEnabled: op.isEnabled !== false,
      sortOrder: op.sortOrder !== undefined ? op.sortOrder : 999
    })) : [];

    return {
      bases,
      materials,
      partners,
      liftOperators: operators,
      canonicalCategories: fixtures?.canonicalCategories || []
    };
  }

  /**
   * Central orchestrator for loading master options via authenticated GAS RPC (shipment.getFormOptions).
   * Deduplicates concurrent calls via shared in-flight Promise.
   *
   * @param {boolean} [forceRefresh=false]
   * @return {Promise<Object>} Form options payload
   */
  async loadFormOptions(forceRefresh = false) {
    const isExpired = !this.formOptionsCachedAt || (Date.now() - this.formOptionsCachedAt > 60000);
    if (!forceRefresh && !isExpired && this.cachedFormOptions) {
      return this.cachedFormOptions;
    }

    if (this.inFlightFormOptionsPromise) {
      return this.inFlightFormOptionsPromise;
    }

    const currentSeq = ++this.loadSeq;

    this.inFlightFormOptionsPromise = (async () => {
      try {
        const shipmentClient = this.shipmentClient || ((typeof window !== 'undefined')
          ? (window.shippingClient || window.shipmentClient)
          : null);

        let payload = null;

        // 1. Try authenticated GAS RPC (Production & Preproduction primary path)
        if (shipmentClient && typeof shipmentClient.getFormOptions === 'function') {
          try {
            const res = await shipmentClient.getFormOptions();
            const candidatePayload = (res && res.payload) ? res.payload : res;
            const hasCollections = candidatePayload && typeof candidatePayload === 'object' && (
              (Array.isArray(candidatePayload.bases) && candidatePayload.bases.length > 0) ||
              (Array.isArray(candidatePayload.liftOperators) && candidatePayload.liftOperators.length > 0) ||
              (Array.isArray(candidatePayload.partners) && candidatePayload.partners.length > 0)
            );
            if (hasCollections) {
              payload = candidatePayload;
            } else {
              const isDev = this._isDevEnv();
              const hasFixtures = typeof window !== 'undefined'
                && (window.__SHIPPING_ERROR_MASTER_FIXTURES__ || window.__SHIPPING_ERROR_LIFT_OPERATORS__);
              if (!hasFixtures && !isDev) {
                payload = candidatePayload;
              }
            }
          } catch (rpcErr) {
            const isDev = this._isDevEnv();
            const hasFixtures = typeof window !== 'undefined'
              && (window.__SHIPPING_ERROR_MASTER_FIXTURES__ || window.__SHIPPING_ERROR_LIFT_OPERATORS__);
            if (!hasFixtures && !isDev) {
              throw new Error('マスターデータの取得に失敗しました。時間をおいて再試行してください。');
            }
          }
        }

        // 2. Fallback to test fixtures if running in unit test / mock harness
        if (!payload) {
          payload = this._loadFromTestFixtures();
        }

        // 3. Local Node / Express master REST endpoint (dev server / tests only)
        const isDevEnv = this._isDevEnv();
        if (!payload && isDevEnv && typeof fetch === 'function') {
          try {
            const [resBases, resMats, resOps, resPartners] = await Promise.allSettled([
              fetch(`${this.baseUrl}/bases`),
              fetch(`${this.baseUrl}/materials`),
              fetch(`${this.baseUrl}/lift-operators`),
              fetch(`${this.baseUrl}/partners`)
            ]);
            const bases = (resBases.status === 'fulfilled' && resBases.value && resBases.value.ok) ? await resBases.value.json() : [];
            const materials = (resMats.status === 'fulfilled' && resMats.value && resMats.value.ok) ? await resMats.value.json() : [];
            const liftOpsData = (resOps.status === 'fulfilled' && resOps.value && resOps.value.ok) ? await resOps.value.json() : {};
            const liftOps = Array.isArray(liftOpsData) ? liftOpsData : (Array.isArray(liftOpsData?.liftOperators) ? liftOpsData.liftOperators : []);
            const partners = (resPartners.status === 'fulfilled' && resPartners.value && resPartners.value.ok) ? await resPartners.value.json() : [];

            payload = {
              bases: Array.isArray(bases) ? bases : [],
              materials: Array.isArray(materials) ? materials : [],
              partners: Array.isArray(partners) ? partners : [],
              liftOperators: Array.isArray(liftOps) ? liftOps : []
            };
          } catch (e) {
            // Ignored in dev
          }
        }

        // Drop stale responses if cache was invalidated (e.g. logout or user switch)
        if (currentSeq !== this.loadSeq) {
          throw new Error('セッションが無効化されたため、マスター取得を中断しました。');
        }

        if (!payload || typeof payload !== 'object') {
          throw new Error('マスターデータの取得に失敗しました。時間をおいて再試行してください。');
        }

        this.cachedFormOptions = payload;
        this.formOptionsCachedAt = Date.now();

        // Populate Bases
        if (Array.isArray(payload.bases)) {
          this.cachedBases = payload.bases.map(b => ({
            baseCode: String(b.baseCode || b.BaseCode || '').trim(),
            baseName: String(b.baseName || b.BaseName || b.baseCode || b.BaseCode || '').trim(),
            areaName: String(b.areaName || b.AreaName || '').trim()
          }));
        } else {
          this.cachedBases = [];
        }

        // Populate Materials (preserve on-demand cache if payload.materials is empty)
        if (Array.isArray(payload.materials) && payload.materials.length > 0) {
          this.cachedMaterials = payload.materials.map(m => {
            const code = String(m.materialCode || m.MaterialCode || m.matCode || m.MatCode || '').trim();
            const name = String(m.materialName || m.MaterialName || m.matName || m.MatName || '').trim();
            return {
              matCode: code,
              matName: name,
              materialCode: code,
              materialName: name,
              unitWeight: m.unitWeight !== undefined ? Number(m.unitWeight) : null
            };
          });
        } else if (!this.cachedMaterials) {
          this.cachedMaterials = [];
        }

        // Populate Partners
        if (Array.isArray(payload.partners)) {
          this.cachedPartners = payload.partners.map(p => ({
            partnerCode: String(p.partnerCode || p.PartnerCode || '').trim(),
            partnerName: String(p.partnerName || p.PartnerName || '').trim(),
            baseCode: String(p.baseCode || p.BaseCode || '').trim(),
            baseName: String(p.baseName || p.BaseName || '').trim(),
            areaCode: p.areaCode || p.AreaCode || null,
            areaName: String(p.areaName || p.AreaName || '').trim()
          }));
        } else {
          this.cachedPartners = [];
        }

        // Populate Lift Operators
        if (Array.isArray(payload.liftOperators)) {
          this.cachedLiftOperators = payload.liftOperators.map(op => ({
            liftOperatorCode: String(op.liftOperatorCode || op.LiftOperatorCode || '').trim(),
            liftOperatorName: String(op.liftOperatorName || op.LiftOperatorName || '').trim(),
            baseCode: String(op.baseCode || op.BaseCode || '').trim(),
            partnerCode: String(op.partnerCode || op.PartnerCode || '').trim(),
            isEnabled: op.isEnabled !== false,
            sortOrder: op.sortOrder !== undefined ? op.sortOrder : 999
          }));
        } else {
          this.cachedLiftOperators = [];
        }

        // Populate Areas (derived from Bases, AccessContext, Partners)
        const areaSet = new Set();
        if (typeof window !== 'undefined' && window.__CURRENT_ACCESS_CONTEXT__?.areaName) {
          const a = window.__CURRENT_ACCESS_CONTEXT__.areaName.trim();
          if (a) areaSet.add(a);
        }
        this.cachedBases.forEach(b => {
          if (b.areaName) areaSet.add(b.areaName);
        });
        this.cachedPartners.forEach(p => {
          if (p.areaName) areaSet.add(p.areaName);
        });
        this.cachedAreas = Array.from(areaSet).sort();

        return payload;
      } finally {
        if (currentSeq === this.loadSeq) {
          this.inFlightFormOptionsPromise = null;
        }
      }
    })();

    return this.inFlightFormOptionsPromise;
  }

  /**
   * Lift Operator lookup.
   * Consumes canonical GAS RPC liftOperators collection with sorting and filtering.
   *
   * @param {Object} [filter]
   * @param {string} [filter.baseCode]
   * @param {boolean} [filter.showAllDrivers]
   * @param {string} [filter.query]
   * @return {Promise<Array<Object>>}
   */
  async getLiftOperators(filter = {}) {
    const { baseCode = '', showAllDrivers = false, query = '', forceRefresh = false } = filter;

    await this.loadFormOptions(Boolean(forceRefresh));

    let list = Array.isArray(this.cachedLiftOperators) ? [...this.cachedLiftOperators] : [];

    // 1. Filter enabled only (disabled excluded from normal search)
    list = list.filter(op => op.isEnabled !== false);

    // 2. Base filter: If NOT showAllDrivers and baseCode is specified, filter by baseCode
    if (!showAllDrivers && baseCode) {
      list = list.filter(op => op.baseCode === baseCode);
    }

    // 3. Name/code query filter
    if (query && query.trim()) {
      const q = query.trim().toLowerCase();
      list = list.filter(op =>
        op.liftOperatorName.toLowerCase().includes(q) ||
        op.liftOperatorCode.toLowerCase().includes(q)
      );
    }

    // 4. Deterministic sort: sortOrder then liftOperatorName
    list.sort((a, b) => {
      const soA = a.sortOrder !== undefined ? a.sortOrder : 999;
      const soB = b.sortOrder !== undefined ? b.sortOrder : 999;
      if (soA !== soB) return soA - soB;
      return a.liftOperatorName.localeCompare(b.liftOperatorName, 'ja');
    });

    return list;
  }

  /**
   * Alias for getLiftOperators for UI compatibility.
   */
  async getDrivers(filter = {}) {
    return this.getLiftOperators(filter);
  }

  _resolveRpcClient() {
    if (this.rpcClient) return this.rpcClient;
    if (typeof window !== 'undefined') {
      if (window.shippingRpcClient) return window.shippingRpcClient;
      if (window.shippingClient && window.shippingClient.rpcClient) return window.shippingClient.rpcClient;
      if (window.shipmentClient && window.shipmentClient.rpcClient) return window.shipmentClient.rpcClient;
    }
    return null;
  }

  _resolveSessionToken() {
    if (this.sessionToken) return this.sessionToken;
    const win = (typeof window !== 'undefined') ? window : ((typeof global !== 'undefined' && global.window) ? global.window : null);
    if (win) {
      if (win.sessionClient && typeof win.sessionClient.getToken === 'function') {
        return win.sessionClient.getToken();
      }
    }
    if (typeof window !== 'undefined') {
      if (window.sessionClient && typeof window.sessionClient.getToken === 'function') {
        return window.sessionClient.getToken();
      }
      if (typeof SessionClient !== 'undefined' && typeof SessionClient.getToken === 'function') {
        return SessionClient.getToken();
      }
    }
    return null;
  }

  _isDevEnv() {
    if (typeof window === 'undefined') return false;
    const host = window.location && window.location.hostname;
    return Boolean(host === 'localhost' || host === '127.0.0.1' || window.__ALLOW_LOCAL_MASTER_REST__);
  }

  /**
   * Materials search/lookup.
   * Connects to canonical material.search GAS RPC on demand (per docs/52)
   * while falling back to cached materials or test fixtures.
   *
   * @param {Object} [filter]
   * @param {string} [filter.query]
   * @param {string} [filter.matCode]
   * @param {number} [filter.limit=50]
   * @return {Promise<Array<Object>>}
   */
  async getMaterials(filter = {}) {
    const { query = '', matCode = '', limit = 50 } = filter;
    const searchQuery = (query || matCode || '').trim();
    const reqSeq = this.loadSeq;

    // Per docs/52:64, material search requires at least 2 characters if query is specified.
    // If query is provided with less than 2 characters (and no exact matCode lookup),
    // return empty list to avoid returning partial cached candidates as full results.
    const isQueryFiltered = Boolean(query && query.trim().length > 0);
    if (isQueryFiltered && query.trim().length < 2 && !matCode) {
      return [];
    }

    // 1. Try on-demand material.search RPC if query has at least 2 chars (per docs/52)
    if (searchQuery.length >= 2) {
      const rpc = this._resolveRpcClient();
      const token = this._resolveSessionToken();
      if (rpc && token) {
        try {
          const res = await rpc.call('material.search', {
            query: searchQuery,
            sessionToken: token,
            limit: Math.min(limit || 10, 10)
          });
          // Discard response if cache was cleared/user switched during RPC (docs/12)
          if (this.loadSeq !== reqSeq) {
            return [];
          }
          const rawResults = (res && res.payload && Array.isArray(res.payload)) ? res.payload : (Array.isArray(res) ? res : null);
          if (Array.isArray(rawResults)) {
            const mapped = rawResults.map(m => {
              const code = String(m.materialCode || m.matCode || '').trim();
              const name = String(m.materialName || m.matName || '').trim();
              return {
                matCode: code,
                matName: name,
                materialCode: code,
                materialName: name,
                unitWeight: m.unitWeight !== undefined ? Number(m.unitWeight) : null
              };
            });
            if (!Array.isArray(this.cachedMaterials)) {
              this.cachedMaterials = [];
            }
            mapped.forEach(item => {
              if (!this.cachedMaterials.some(c => c.matCode === item.matCode)) {
                this.cachedMaterials.push(item);
              }
            });
            return mapped;
          }
        } catch (rpcErr) {
          if (this.loadSeq !== reqSeq) {
            return [];
          }
          const isDevEnv = this._isDevEnv();
          const hasFixtures = typeof window !== 'undefined' && (window.__SHIPPING_ERROR_MASTER_FIXTURES__?.M_Material || window.__SHIPPING_ERROR_MASTER_FIXTURES__?.materials);
          if (!isDevEnv && !hasFixtures) {
            throw rpcErr;
          }
        }
      }
    }

    await this.loadFormOptions();

    let list = Array.isArray(this.cachedMaterials) ? [...this.cachedMaterials] : [];

    if (matCode) {
      const cleanC = matCode.trim().toLowerCase();
      list = list.filter(m => m.matCode.toLowerCase() === cleanC || m.materialCode.toLowerCase() === cleanC);
    }

    if (query && query.trim()) {
      const q = query.trim().toLowerCase();
      list = list.filter(m =>
        m.matCode.toLowerCase().includes(q) ||
        m.matName.toLowerCase().includes(q)
      );
    }

    if (limit && list.length > limit) {
      list = list.slice(0, limit);
    }

    return list;
  }

  /**
   * Get single material by MatCode.
   *
   * @param {string} matCode
   * @return {Promise<Object|null>}
   */
  async getMaterialByCode(matCode) {
    if (!matCode) return null;
    const clean = String(matCode).trim();
    const reqSeq = this.loadSeq;

    await this.loadFormOptions();

    if (Array.isArray(this.cachedMaterials)) {
      const found = this.cachedMaterials.find(m =>
        m.matCode === clean || m.materialCode === clean
      );
      if (found) {
        return {
          matCode: found.matCode,
          matName: found.matName,
          materialCode: found.materialCode,
          materialName: found.materialName,
          unitWeight: found.unitWeight
        };
      }
    }

    // Try resolving via material.search if code is at least 2 characters
    if (clean.length >= 2) {
      const rpc = this._resolveRpcClient();
      const token = this._resolveSessionToken();
      if (rpc && token) {
        try {
          const res = await rpc.call('material.search', {
            query: clean,
            sessionToken: token,
            limit: 10
          });
          if (this.loadSeq !== reqSeq) {
            return null;
          }
          const rawResults = (res && res.payload && Array.isArray(res.payload)) ? res.payload : (Array.isArray(res) ? res : null);
          if (Array.isArray(rawResults)) {
            const exact = rawResults.find(m =>
              String(m.materialCode || m.matCode || '').trim().toLowerCase() === clean.toLowerCase()
            );
            if (exact) {
              const item = {
                matCode: exact.materialCode || exact.matCode,
                matName: exact.materialName || exact.matName,
                materialCode: exact.materialCode || exact.matCode,
                materialName: exact.materialName || exact.matName,
                unitWeight: exact.unitWeight !== undefined ? Number(exact.unitWeight) : null
              };
              if (!Array.isArray(this.cachedMaterials)) {
                this.cachedMaterials = [];
              }
              this.cachedMaterials.push(item);
              return item;
            }
            return null;
          }
        } catch (e) {
          // Fall through
        }
      }
    }

    return null;
  }

  /**
   * Partner lookup from canonical GAS master data.
   *
   * @param {Object} [filter]
   * @return {Promise<Array<Object>>}
   */
  async getPartners(filter = {}) {
    await this.loadFormOptions();
    let list = Array.isArray(this.cachedPartners) ? [...this.cachedPartners] : [];
    if (filter.baseCode) {
      list = list.filter(p => p.baseCode === filter.baseCode);
    }
    if (filter.query) {
      const q = filter.query.trim().toLowerCase();
      list = list.filter(p => p.partnerName.toLowerCase().includes(q) || p.partnerCode.toLowerCase().includes(q));
    }
    return list;
  }

  /**
   * Partner lookup by PartnerCode.
   *
   * @param {string} partnerCode
   * @return {Promise<Object|null>}
   */
  async getPartnerByCode(partnerCode) {
    if (!partnerCode) return null;
    const clean = String(partnerCode).trim();

    try {
      await this.loadFormOptions();
      if (Array.isArray(this.cachedPartners)) {
        const found = this.cachedPartners.find(p =>
          (p.partnerCode && p.partnerCode.toLowerCase() === clean.toLowerCase()) ||
          (p.PartnerCode && p.PartnerCode.toLowerCase() === clean.toLowerCase())
        );
        if (found && (found.partnerName || found.PartnerName)) {
          return {
            partnerCode: found.partnerCode || found.PartnerCode,
            partnerName: found.partnerName || found.PartnerName,
            baseCode: found.baseCode || found.BaseCode,
            baseName: found.baseName || found.BaseName,
            areaCode: found.areaCode || found.AreaCode,
            areaName: found.areaName || found.AreaName
          };
        }
      }
    } catch (e) {
      const isDevEnv = this._isDevEnv();
      const hasFixtures = typeof window !== 'undefined' && window.__SHIPPING_ERROR_MASTER_FIXTURES__?.M_Partner;
      if (!isDevEnv && !hasFixtures) {
        throw e;
      }
    }

    // Fallback to test fixtures
    if (typeof window !== 'undefined' && window.__SHIPPING_ERROR_MASTER_FIXTURES__?.M_Partner) {
      const found = window.__SHIPPING_ERROR_MASTER_FIXTURES__.M_Partner.find(p =>
        String(p.PartnerCode || p.partnerCode || '').trim() === clean
      );
      if (found) {
        return {
          partnerCode: found.PartnerCode || found.partnerCode,
          partnerName: found.PartnerName || found.partnerName,
          baseCode: found.BaseCode || found.baseCode,
          baseName: found.BaseName || found.baseName,
          areaCode: found.AreaCode || found.areaCode,
          areaName: found.AreaName || found.areaName
        };
      }
    }

    // Fallback to dev REST
    const isDevEnv = this._isDevEnv();
    if (isDevEnv && typeof fetch === 'function') {
      try {
        const url = `${this.baseUrl}/partners/${encodeURIComponent(clean)}`;
        const res = await fetch(url);
        if (res.ok) {
          return await res.json();
        }
      } catch (err) {}
    }

    return null;
  }

  /**
   * Get unique bases from master.
   * Prioritizes authenticated GAS RPC (shipment.getFormOptions), then fixtures, then dev server REST.
   *
   * @return {Promise<Array<Object>>}
   */
  async getBases() {
    const forceRefresh = arguments.length > 0 && typeof arguments[0] === 'boolean' ? arguments[0] : Boolean(arguments[0]?.forceRefresh);
    const isExpired = !this.formOptionsCachedAt || (Date.now() - this.formOptionsCachedAt > 60000);
    if (!forceRefresh && !isExpired && this.cachedBases && Array.isArray(this.cachedBases) && this.cachedBases.length > 0) {
      return this.cachedBases;
    }

    // 1. Try loading canonical form options (GAS RPC / fixtures / dev REST)
    try {
      await this.loadFormOptions(Boolean(forceRefresh));
      if (this.cachedBases && this.cachedBases.length > 0) {
        return this.cachedBases;
      }
    } catch (e) {
      // Fall through to dev fallback
    }

    // Dev server REST fallback
    const isDevEnv = this._isDevEnv();
    if (isDevEnv && typeof fetch === 'function') {
      try {
        const res = await fetch(`${this.baseUrl}/bases`);
        if (res.ok) {
          const list = await res.json();
          if (Array.isArray(list)) {
            const mapped = list.map(b => ({
              baseCode: b.baseCode || b.BaseCode,
              baseName: b.baseName || b.BaseName || b.baseCode || b.BaseCode,
              areaName: b.areaName || b.AreaName || ''
            }));
            this.cachedBases = mapped;
            return mapped;
          }
        }
      } catch (e) {
        // Ignored
      }
    }

    return this.cachedBases || [];
  }

  /**
   * Get all canonical area names from unpaged master data (Bases / Partners).
   *
   * @return {Promise<Array<string>>}
   */
  async getAreas() {
    const forceRefresh = arguments.length > 0 && typeof arguments[0] === 'boolean' ? arguments[0] : Boolean(arguments[0]?.forceRefresh);
    const isExpired = !this.formOptionsCachedAt || (Date.now() - this.formOptionsCachedAt > 60000);
    if (!forceRefresh && !isExpired && this.cachedAreas && Array.isArray(this.cachedAreas) && this.cachedAreas.length > 0) {
      return this.cachedAreas;
    }

    try {
      await this.loadFormOptions(Boolean(forceRefresh));
      if (this.cachedAreas && this.cachedAreas.length > 0) {
        return this.cachedAreas;
      }
    } catch (e) {
      // Fall through to fallback
    }

    const areas = new Set();

    // 1. Current user's area from authenticated AccessContext
    if (typeof window !== 'undefined' && window.__CURRENT_ACCESS_CONTEXT__?.areaName) {
      const a = window.__CURRENT_ACCESS_CONTEXT__.areaName.trim();
      if (a) areas.add(a);
    }

    // 2. Fixtures (M_Employee / M_Partner contain AreaName in canonical schema)
    if (typeof window !== 'undefined' && window.__SHIPPING_ERROR_MASTER_FIXTURES__) {
      const fixtures = window.__SHIPPING_ERROR_MASTER_FIXTURES__;
      const empSource = fixtures.M_Employee || fixtures.employees;
      if (Array.isArray(empSource)) {
        empSource.forEach(e => {
          const a = e.AreaName || e.areaName;
          if (a && typeof a === 'string' && a.trim()) areas.add(a.trim());
        });
      }
      const partnerSource = fixtures.M_Partner || fixtures.partners;
      if (Array.isArray(partnerSource)) {
        partnerSource.forEach(p => {
          const a = p.AreaName || p.areaName;
          if (a && typeof a === 'string' && a.trim()) areas.add(a.trim());
        });
      }
    }

    // 3. Areas from getBases()
    try {
      const bases = await this.getBases();
      if (Array.isArray(bases)) {
        bases.forEach(b => {
          const a = b.areaName || b.AreaName;
          if (a && typeof a === 'string' && a.trim()) areas.add(a.trim());
        });
      }
    } catch (e) {
      // Ignored
    }

    const result = Array.from(areas).sort();
    if (result.length > 0) {
      this.cachedAreas = result;
    }
    return result;
  }

  /**
   * Employee lookup.
   * Strictly adheres to PII minimization in production.
   *
   * @param {Object} [filter]
   * @return {Promise<Array<Object>>}
   */
  async getEmployees(filter = {}) {
    // 1. Unit test / mock fixture environment
    if (typeof window !== 'undefined' && window.__SHIPPING_ERROR_MASTER_FIXTURES__?.M_Employee) {
      let list = window.__SHIPPING_ERROR_MASTER_FIXTURES__.M_Employee.map(e => ({
        empNo: e.EmpNo || e.empNo,
        empName: e.EmpName || e.empName,
        baseCode: e.BaseCode || e.baseCode,
        baseName: e.BaseName || e.baseName,
        areaName: e.AreaName || e.areaName
      }));
      if (filter.baseCode) list = list.filter(e => e.baseCode === filter.baseCode);
      if (filter.name) list = list.filter(e => e.empName.includes(filter.name));
      if (filter.empNo) list = list.filter(e => e.empNo === filter.empNo);
      return list;
    }

    // 2. Production: Return authenticated self context if requested
    if (typeof window !== 'undefined' && window.__CURRENT_ACCESS_CONTEXT__) {
      const ctx = window.__CURRENT_ACCESS_CONTEXT__;
      const selfEmp = {
        empNo: ctx.empNo,
        empName: ctx.employeeName || ctx.empName || ctx.empNo,
        baseCode: ctx.baseCode || '',
        baseName: ctx.baseName || '',
        areaName: ctx.areaName || ''
      };
      if (filter.empNo && filter.empNo !== ctx.empNo) return [];
      if (filter.name && !selfEmp.empName.includes(filter.name)) return [];
      return [selfEmp];
    }

    return [];
  }

  /**
   * Single employee lookup by empNo.
   *
   * @param {string} empNo
   * @return {Promise<Object|null>}
   */
  async getEmployeeByEmpNo(empNo) {
    if (!empNo) return null;
    const clean = String(empNo).trim();

    if (typeof window !== 'undefined' && window.__CURRENT_ACCESS_CONTEXT__?.empNo === clean) {
      const ctx = window.__CURRENT_ACCESS_CONTEXT__;
      return {
        empNo: ctx.empNo,
        empName: ctx.employeeName || ctx.empName || ctx.empNo,
        baseCode: ctx.baseCode || '',
        baseName: ctx.baseName || '',
        areaName: ctx.areaName || ''
      };
    }

    if (typeof window !== 'undefined' && window.__SHIPPING_ERROR_MASTER_FIXTURES__?.M_Employee) {
      const found = window.__SHIPPING_ERROR_MASTER_FIXTURES__.M_Employee.find(
        e => (e.EmpNo || e.empNo) === clean
      );
      if (!found) return null;
      return {
        empNo: found.EmpNo || found.empNo,
        empName: found.EmpName || found.empName,
        baseCode: found.BaseCode || found.baseCode,
        baseName: found.BaseName || found.baseName,
        areaName: found.AreaName || found.areaName
      };
    }

    return null;
  }
}

if (typeof window !== 'undefined') {
  window.MasterApiClient = MasterApiClient;
  if (!window.masterClient) {
    window.masterClient = new MasterApiClient();
  }
  window.MasterClient = window.masterClient;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { MasterApiClient };
}
