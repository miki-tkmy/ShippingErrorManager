/**
 * ShipmentDataCache & JstDateUtils
 * In-memory caching, request deduplication, cache invalidation, and JST monthly date helpers.
 *
 * Implements:
 * - CACHE-001 ~ CACHE-008
 * - MONTH-001 ~ MONTH-010
 */
(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    const exports = factory();
    root.ShipmentDataCache = exports.ShipmentDataCache;
    root.JstDateUtils = exports.JstDateUtils;
    root.shipmentCache = exports.shipmentCache;
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /**
   * JST Date Utilities for Monthly and Custom Date Range handling.
   */
  const JstDateUtils = {
    /**
     * Returns current time broken down by Asia/Tokyo timezone.
     */
    getTokyoNow: function () {
      const now = new Date();
      let yyyyMmDd = '';
      try {
        const dtf = new Intl.DateTimeFormat('en-CA', {
          timeZone: 'Asia/Tokyo',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit'
        });
        yyyyMmDd = dtf.format(now);
      } catch (e) {
        // Fallback calculation for older engines
        const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
        const jstDate = new Date(utc + (3600000 * 9));
        const y = jstDate.getFullYear();
        const m = String(jstDate.getMonth() + 1).padStart(2, '0');
        const d = String(jstDate.getDate()).padStart(2, '0');
        yyyyMmDd = `${y}-${m}-${d}`;
      }

      const parts = yyyyMmDd.split('-');
      const year = parseInt(parts[0], 10);
      const month = parseInt(parts[1], 10);
      const day = parseInt(parts[2], 10);
      const yyyyMm = `${parts[0]}-${parts[1]}`;

      return {
        year: year,
        month: month,
        day: day,
        yyyyMm: yyyyMm,
        yyyyMmDd: yyyyMmDd
      };
    },

    /**
     * Formats YYYY-MM into Japanese display: "YYYY年M月"
     */
    formatYearMonthJp: function (yyyyMm) {
      if (!yyyyMm || typeof yyyyMm !== 'string' || !/^\d{4}-\d{2}$/.test(yyyyMm)) {
        return '';
      }
      const parts = yyyyMm.split('-');
      const y = parts[0];
      const m = parseInt(parts[1], 10);
      return `${y}年${m}月`;
    },

    /**
     * Shifts YYYY-MM by delta months (handles year boundary correctly).
     */
    shiftMonth: function (yyyyMm, delta) {
      if (!yyyyMm || typeof yyyyMm !== 'string') {
        yyyyMm = this.getTokyoNow().yyyyMm;
      }
      const parts = yyyyMm.split('-');
      let y = parseInt(parts[0], 10);
      let m = parseInt(parts[1], 10) + delta;

      while (m < 1) {
        m += 12;
        y -= 1;
      }
      while (m > 12) {
        m -= 12;
        y += 1;
      }

      return `${y}-${String(m).padStart(2, '0')}`;
    },

    /**
     * Returns { startDate, endDate } covering the entire specified YYYY-MM.
     */
    getMonthDateRange: function (yyyyMm) {
      if (!yyyyMm || typeof yyyyMm !== 'string') {
        yyyyMm = this.getTokyoNow().yyyyMm;
      }
      const parts = yyyyMm.split('-');
      const y = parseInt(parts[0], 10);
      const m = parseInt(parts[1], 10);
      const startDate = `${yyyyMm}-01`;
      // Day 0 of month m+1 (in 0-indexed terms) gives the last day of month m
      const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
      const endDate = `${yyyyMm}-${String(lastDay).padStart(2, '0')}`;
      return { startDate: startDate, endDate: endDate };
    },

    /**
     * Validates start <= end.
     */
    validateRange: function (startDate, endDate) {
      if (!startDate || !endDate) {
        return { valid: false, error: '開始日と終了日を両方指定してください。' };
      }
      if (startDate > endDate) {
        return { valid: false, error: '開始日は終了日以前の日付を指定してください。' };
      }
      return { valid: true, error: null };
    }
  };

  /**
   * Deterministic comparison for Response Change Detection (Section 12 & CACHE-007).
   */
  function isSameShipmentList(prevList, newList) {
    if (!prevList || !newList) return false;
    if (!Array.isArray(prevList) || !Array.isArray(newList)) return false;
    if (prevList.length !== newList.length) return false;

    for (let i = 0; i < prevList.length; i++) {
      const a = prevList[i];
      const b = newList[i];
      if (!a || !b) return false;
      if (a.shippingCheckId !== b.shippingCheckId) return false;
      if (a.recordStatus !== b.recordStatus) return false;
      if (a.revision !== b.revision) return false;
      if (a.updatedAt !== b.updatedAt) return false;
      if (a.guidanceConfirmed !== b.guidanceConfirmed) return false;
      if (a.looseItemCreatorsCount !== b.looseItemCreatorsCount) return false;
      if (a.attachmentsCount !== b.attachmentsCount) return false;
      if (a.recoveryRequired !== b.recoveryRequired) return false;
      if (a.reviewStatus !== b.reviewStatus) return false;
      if (a.reviewedAt !== b.reviewedAt) return false;
      if (a.reviewComment !== b.reviewComment) return false;
      if (a.registeredAt !== b.registeredAt) return false;
      if (a.loadingDate !== b.loadingDate) return false;
      if (a.historicalBaseName !== b.historicalBaseName) return false;
      if (a.employeeName !== b.employeeName) return false;
      if (a.partnerName !== b.partnerName) return false;
      if (a.liftOperatorName !== b.liftOperatorName) return false;
    }
    return true;
  }

  /**
   * ShipmentDataCache: In-memory TTL cache with request deduplication (in-flight promise sharing).
   */
  class ShipmentDataCache {
    constructor(ttlMs = 60000) {
      this.ttlMs = ttlMs;
      this.cache = new Map();
      this.inFlight = new Map();
      this.detailInFlight = new Map();
    }

    _resolveRuntimeEnv(scopeEnv) {
      if (scopeEnv && typeof scopeEnv === 'string') return scopeEnv.trim();
      if (typeof window !== 'undefined' && window.__SHIPPING_ERROR_RUNTIME_CONFIG__?.environment) {
        return String(window.__SHIPPING_ERROR_RUNTIME_CONFIG__.environment).trim();
      }
      return 'DEFAULT';
    }

    /**
     * Constructs a scoped deterministic cache key including environment, user, Base, recordStatus, and schema version.
     */
    buildKey(scope) {
      if (!scope || typeof scope !== 'object') return 'shipment.list:DEFAULT:ANON:ALL:ALL:v2';
      const env = this._resolveRuntimeEnv(scope.env);
      const action = scope.action || 'shipment.list';
      const empNo = scope.empNo || 'ANON';
      const callerBaseCode = scope.callerBaseCode || '';
      const baseCode = scope.baseCode || 'ALL';
      const recordStatus = scope.recordStatus ? String(scope.recordStatus).toUpperCase() : 'ALL';
      const includeDrafts = scope.includeDrafts === false ? 'noDrafts' : 'withDrafts';
      const month = scope.month || '';
      const startDate = scope.startDate || '';
      const endDate = scope.endDate || '';
      const page = scope.page !== undefined ? scope.page : 1;
      const limit = scope.limit !== undefined ? scope.limit : 20;
      const unreviewedOnly = scope.unreviewedOnly ? 'unreviewed' : 'all';
      const area = scope.area || '全国';

      return [
        action,
        env,
        empNo,
        callerBaseCode,
        baseCode,
        recordStatus,
        includeDrafts,
        month,
        startDate,
        endDate,
        page,
        limit,
        unreviewedOnly,
        area,
        'v2'
      ].join(':');
    }

    /**
     * Deduplicates simultaneous identical detail reads without persisting stale Revision across time.
     */
    async fetchDetailWithDeduplication(detailKey, fetcherFn) {
      const safeKey = String(detailKey || '');
      if (safeKey && this.detailInFlight.has(safeKey)) {
        const shared = this.detailInFlight.get(safeKey);
        const data = await shared;
        return { data: data, deduplicated: true };
      }
      const p = (async () => {
        try {
          return await fetcherFn();
        } finally {
          if (safeKey) {
            this.detailInFlight.delete(safeKey);
          }
        }
      })();
      if (safeKey) {
        this.detailInFlight.set(safeKey, p);
      }
      const data = await p;
      return { data: data, deduplicated: false };
    }

    get(key) {
      const entry = this.cache.get(key);
      if (!entry) return null;
      if (Date.now() - entry.timestamp > this.ttlMs) {
        this.cache.delete(key);
        return null;
      }
      return entry.data;
    }

    set(key, data) {
      this.cache.set(key, {
        timestamp: Date.now(),
        data: data
      });
    }

    has(key) {
      return this.get(key) !== null;
    }

    /**
     * Executes fetcherFn with deduplication and in-memory TTL caching.
     */
    async fetchWithDeduplication(key, fetcherFn, options = {}) {
      const bypassCache = options.bypassCache === true;

      if (!bypassCache) {
        const cached = this.get(key);
        if (cached !== null) {
          return { data: cached, fromCache: true, deduplicated: false };
        }
      }

      // In-flight Promise sharing
      if (this.inFlight.has(key)) {
        const sharedPromise = this.inFlight.get(key);
        const data = await sharedPromise;
        return { data: data, fromCache: false, deduplicated: true };
      }

      const p = (async () => {
        try {
          const result = await fetcherFn();
          this.set(key, result);
          return result;
        } finally {
          this.inFlight.delete(key);
        }
      })();

      this.inFlight.set(key, p);
      const data = await p;
      return { data: data, fromCache: false, deduplicated: false };
    }

    invalidateAll() {
      this.cache.clear();
      this.inFlight.clear();
      this.detailInFlight.clear();
    }

    invalidateUser(empNo) {
      if (!empNo) return;
      for (const k of Array.from(this.cache.keys())) {
        if (k.includes(`:${empNo}:`)) {
          this.cache.delete(k);
        }
      }
      this.detailInFlight.clear();
    }

    invalidateMutations() {
      // Clear shipment.list and review caches on create, draft save, update, or review
      this.cache.clear();
      this.detailInFlight.clear();
    }
  }

  const defaultCache = new ShipmentDataCache(60000); // 60 seconds default TTL

  return {
    ShipmentDataCache: ShipmentDataCache,
    JstDateUtils: JstDateUtils,
    isSameShipmentList: isSameShipmentList,
    shipmentCache: defaultCache
  };
});
