/**
 * review.js - TASK-010: Area Manager Three-State Review Workflow
 * Handles Review View, filters (未確認のみ表示, Area絞り込み), and review action panel.
 */
(function (window, document) {
  'use strict';

  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function getReviewStatusBadge(status) {
    const s = String(status || '未確認');
    if (s === 'OK') {
      return '<span class="badge badge-ok" style="background:#DCFCE7; color:#166534; border:1px solid #86EFAC; font-weight:700; padding:3px 10px; border-radius:4px; font-size:0.85rem;">OK</span>';
    } else if (s === 'NG') {
      return '<span class="badge badge-ng" style="background:#FEE2E2; color:#991B1B; border:1px solid #FCA5A5; font-weight:700; padding:3px 10px; border-radius:4px; font-size:0.85rem;">NG</span>';
    } else {
      return '<span class="badge badge-unconfirmed" style="background:#FEF9C3; color:#854D0E; border:1px solid #FDE047; font-weight:700; padding:3px 10px; border-radius:4px; font-size:0.85rem;">未確認</span>';
    }
  }

  const ReviewManager = {
    currentPage: 1,
    limit: 20,
    currentRecord: null,
    canSubmitReview: false,
    authCheckSeq: 0,
    onReviewSavedCallbacks: [],
    targetMonth: (typeof JstDateUtils !== 'undefined' ? JstDateUtils.getTokyoNow().yyyyMm : '2026-10'),
    customRange: null,
    lastRenderedReviewItems: null,
    isInitialized: false,
    eventsBound: false,
    loadSeq: 0,

    init: function () {
      if (this.isInitialized) {
        this.updateMonthDisplayReview();
        return;
      }
      this.isInitialized = true;
      if (typeof JstDateUtils !== 'undefined') {
        this.targetMonth = JstDateUtils.getTokyoNow().yyyyMm;
      }
      this.bindFilterEvents();
      this.updateMonthDisplayReview();
    },

    updateMonthDisplayReview: function () {
      const txt = document.getElementById('txtMonthDisplayReview');
      const input = document.getElementById('inputMonthReview');
      if (txt && typeof JstDateUtils !== 'undefined') {
        txt.textContent = JstDateUtils.formatYearMonthJp(this.targetMonth);
      }
      if (input) {
        input.value = this.targetMonth;
      }
    },

    toggleCustomRangeReview: function () {
      const panel = document.getElementById('customRangePanelReview');
      const btn = document.getElementById('btnToggleRangeReview');
      if (!panel) return;
      const isOpen = panel.style.display !== 'none';
      if (isOpen) {
        panel.style.display = 'none';
        btn?.classList.remove('is-active');
        btn?.setAttribute('aria-expanded', 'false');
      } else {
        panel.style.display = 'block';
        btn?.classList.add('is-active');
        btn?.setAttribute('aria-expanded', 'true');
        const startInput = document.getElementById('inputStartDateReview');
        const endInput = document.getElementById('inputEndDateReview');
        if (startInput && endInput && typeof JstDateUtils !== 'undefined') {
          const range = JstDateUtils.getMonthDateRange(this.targetMonth);
          if (!startInput.value) startInput.value = range.startDate;
          if (!endInput.value) endInput.value = range.endDate;
        }
      }
    },

    onReviewSaved: function (cb) {
      if (typeof cb === 'function') {
        this.onReviewSavedCallbacks.push(cb);
      }
    },

    bindFilterEvents: function () {
      if (this.eventsBound) return;
      this.eventsBound = true;
      this.updateMonthDisplayReview();

      const btnPrev = document.getElementById('btnPrevMonthReview');
      if (btnPrev) {
        btnPrev.addEventListener('click', () => {
          this.customRange = null;
          if (typeof JstDateUtils !== 'undefined') {
            this.targetMonth = JstDateUtils.shiftMonth(this.targetMonth, -1);
          }
          this.updateMonthDisplayReview();
          const panel = document.getElementById('customRangePanelReview');
          if (panel) panel.style.display = 'none';
          document.getElementById('btnToggleRangeReview')?.classList.remove('is-active');
          this.currentPage = 1;
          this.loadReviewList();
        });
      }

      const btnNext = document.getElementById('btnNextMonthReview');
      if (btnNext) {
        btnNext.addEventListener('click', () => {
          this.customRange = null;
          if (typeof JstDateUtils !== 'undefined') {
            this.targetMonth = JstDateUtils.shiftMonth(this.targetMonth, 1);
          }
          this.updateMonthDisplayReview();
          const panel = document.getElementById('customRangePanelReview');
          if (panel) panel.style.display = 'none';
          document.getElementById('btnToggleRangeReview')?.classList.remove('is-active');
          this.currentPage = 1;
          this.loadReviewList();
        });
      }

      const inputMonth = document.getElementById('inputMonthReview');
      if (inputMonth) {
        inputMonth.addEventListener('change', (e) => {
          if (e.target.value) {
            this.customRange = null;
            this.targetMonth = e.target.value;
            this.updateMonthDisplayReview();
            const panel = document.getElementById('customRangePanelReview');
            if (panel) panel.style.display = 'none';
            document.getElementById('btnToggleRangeReview')?.classList.remove('is-active');
            this.currentPage = 1;
            this.loadReviewList();
          }
        });
      }

      const btnToggleRange = document.getElementById('btnToggleRangeReview');
      if (btnToggleRange) {
        btnToggleRange.addEventListener('click', () => {
          this.toggleCustomRangeReview();
        });
      }

      const btnApplyRange = document.getElementById('btnApplyRangeReview');
      if (btnApplyRange) {
        btnApplyRange.addEventListener('click', async () => {
          const start = document.getElementById('inputStartDateReview')?.value;
          const end = document.getElementById('inputEndDateReview')?.value;
          const errDiv = document.getElementById('rangeErrorReview');
          if (typeof JstDateUtils !== 'undefined') {
            const val = JstDateUtils.validateRange(start, end);
            if (!val.valid) {
              if (errDiv) {
                errDiv.textContent = val.error;
                errDiv.style.display = 'block';
              }
              return;
            }
          }
          if (errDiv) errDiv.style.display = 'none';
          this.customRange = { startDate: start, endDate: end };
          this.currentPage = 1;
          btnApplyRange.disabled = true;
          btnApplyRange.setAttribute('aria-busy', 'true');
          const originalText = btnApplyRange.textContent;
          btnApplyRange.innerHTML = '<span class="inline-spinner" role="status" aria-label="読み込み中" style="margin-right:0;"></span>';
          try {
            await this.loadReviewList();
          } finally {
            btnApplyRange.disabled = false;
            btnApplyRange.removeAttribute('aria-busy');
            btnApplyRange.textContent = originalText || '適用';
          }
        });
      }

      const btnResetRange = document.getElementById('btnResetRangeReview');
      if (btnResetRange) {
        btnResetRange.addEventListener('click', () => {
          this.customRange = null;
          const panel = document.getElementById('customRangePanelReview');
          if (panel) panel.style.display = 'none';
          document.getElementById('btnToggleRangeReview')?.classList.remove('is-active');
          const errDiv = document.getElementById('rangeErrorReview');
          if (errDiv) errDiv.style.display = 'none';
          this.currentPage = 1;
          this.loadReviewList();
        });
      }

      const btnRefresh = document.getElementById('btnRefreshReviewList');
      if (btnRefresh) {
        btnRefresh.addEventListener('click', () => {
          this.loadReviewList(true);
        });
      }

      const chkUnreviewed = document.getElementById('chkReviewOnlyUnreviewed');
      if (chkUnreviewed) {
        chkUnreviewed.addEventListener('change', () => {
          this.currentPage = 1;
          this.loadReviewList();
        });
      }

      const selArea = document.getElementById('selReviewAreaFilter');
      if (selArea) {
        selArea.addEventListener('change', () => {
          this.currentPage = 1;
          this.loadReviewList();
        });
      }
    },

    updateAreaFilterOptions: function (areas) {
      const selArea = document.getElementById('selReviewAreaFilter');
      if (!selArea || !Array.isArray(areas)) return;

      const currentVal = selArea.value;
      const existingVals = new Set(Array.from(selArea.options).map(o => o.value));

      areas.sort().forEach(area => {
        if (area && typeof area === 'string' && area.trim() && !existingVals.has(area.trim())) {
          const opt = document.createElement('option');
          opt.value = area.trim();
          opt.textContent = area.trim();
          selArea.appendChild(opt);
          existingVals.add(area.trim());
        }
      });

      if (currentVal && existingVals.has(currentVal)) {
        selArea.value = currentVal;
      }
    },

    populateAreaFilter: async function () {
      const selArea = document.getElementById('selReviewAreaFilter');
      if (!selArea) return;
      if (selArea.options.length > 1) return;

      try {
        const areas = new Set();

        // 1. Current user's area from authenticated AccessContext
        if (typeof window !== 'undefined' && window.__CURRENT_ACCESS_CONTEXT__?.areaName) {
          areas.add(window.__CURRENT_ACCESS_CONTEXT__.areaName);
        }

        // 2. Query canonical unpaged areas from MasterClient (deduplicates getBases and fixtures)
        const client = window.MasterClient || window.masterClient || (typeof MasterApiClient !== 'undefined' ? new MasterApiClient() : null);
        if (client && typeof client.getAreas === 'function') {
          const masterAreas = await client.getAreas();
          if (Array.isArray(masterAreas)) {
            masterAreas.forEach(a => areas.add(a));
          }
        }

        // 3. Fixtures fallback (M_Employee / M_Partner contain AreaName in canonical schema)
        if (typeof window !== 'undefined' && window.__SHIPPING_ERROR_MASTER_FIXTURES__) {
          const fixtures = window.__SHIPPING_ERROR_MASTER_FIXTURES__;
          const empSource = fixtures.M_Employee || fixtures.employees;
          if (Array.isArray(empSource)) {
            empSource.forEach(e => {
              const a = e.AreaName || e.areaName;
              if (a) areas.add(a);
            });
          }
          const partnerSource = fixtures.M_Partner || fixtures.partners;
          if (Array.isArray(partnerSource)) {
            partnerSource.forEach(p => {
              const a = p.AreaName || p.areaName;
              if (a) areas.add(a);
            });
          }
        }

        if (areas.size > 0) {
          this.updateAreaFilterOptions(Array.from(areas));
        }
      } catch (err) {
        console.warn('Failed to populate areas for review filter:', err);
      }
    },

    loadReviewList: async function (bypassCache = false) {
      const container = document.getElementById('reviewListContainer');
      if (!container) return;

      this.loadSeq = (this.loadSeq || 0) + 1;
      const seq = this.loadSeq;

      const hasExistingCards = container.querySelector('.review-card') !== null;
      if (!hasExistingCards) {
        container.innerHTML = '<div style="text-align:center; padding:32px; color:var(--color-text-muted);"><span class="inline-spinner" role="status" aria-label="読み込み中"></span> レビュー対象データを読み込み中...</div>';
      } else {
        container.style.opacity = '0.6';
        container.setAttribute('aria-busy', 'true');
      }

      const reviewLoadingIndicator = document.getElementById('reviewLoadingIndicator');
      if (reviewLoadingIndicator) reviewLoadingIndicator.style.display = 'inline-block';

      const btnRefresh = document.getElementById('btnRefreshReviewList');
      if (btnRefresh) {
        btnRefresh.disabled = true;
        btnRefresh.setAttribute('aria-busy', 'true');
      }

      const chkUnreviewed = document.getElementById('chkReviewOnlyUnreviewed');
      const unreviewedOnly = chkUnreviewed ? chkUnreviewed.checked : true;

      const selArea = document.getElementById('selReviewAreaFilter');
      const area = selArea ? selArea.value : '全国';

      try {
        const rpcClient = window.shippingRpcClient;
        let shipmentClient = window.shippingClient || window.shipmentClient;
        if (!shipmentClient && rpcClient && window.ShippingShipmentClient && typeof window.ShippingShipmentClient.createShipmentClient === 'function') {
          shipmentClient = window.ShippingShipmentClient.createShipmentClient({ rpcClient: rpcClient, sessionClient: window.sessionClient || window.SessionClient });
        }

        const currentCtx = window.__CURRENT_ACCESS_CONTEXT__ || {};
        const cacheScope = {
          action: 'shipment.list.review',
          empNo: currentCtx.empNo || 'REVIEWER',
          baseCode: 'ALL',
          month: this.customRange ? '' : this.targetMonth,
          startDate: this.customRange ? this.customRange.startDate : '',
          endDate: this.customRange ? this.customRange.endDate : '',
          page: this.currentPage,
          limit: this.limit,
          unreviewedOnly: unreviewedOnly,
          area: area
        };
        const cacheKey = (typeof shipmentCache !== 'undefined')
          ? shipmentCache.buildKey(cacheScope)
          : `review.list:${currentCtx.empNo}:${this.targetMonth}:${this.currentPage}`;

        const fetcher = async () => {
          const queryOptions = {
            page: this.currentPage,
            limit: this.limit,
            month: this.customRange ? undefined : this.targetMonth,
            startDate: this.customRange ? this.customRange.startDate : undefined,
            endDate: this.customRange ? this.customRange.endDate : undefined,
            unreviewedOnly: unreviewedOnly,
            area: (area && area !== '全国') ? area : undefined
          };
          if (shipmentClient && typeof shipmentClient.listShipments === 'function') {
            return await shipmentClient.listShipments(queryOptions);
          } else if (rpcClient && typeof rpcClient.call === 'function') {
            return await rpcClient.call('shipment.list', { options: queryOptions });
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

        if (seq !== this.loadSeq) {
          return;
        }

        let allShipments = (res && res.payload && Array.isArray(res.payload.shipments))
          ? res.payload.shipments
          : ((res && Array.isArray(res.shipments)) ? res.shipments : []);

        // Dynamically extract and register canonical areas present in returned shipments
        const areasFromData = new Set();
        allShipments.forEach(item => {
          const a = item.historicalAreaName || item.areaName;
          if (a && typeof a === 'string' && a.trim()) {
            areasFromData.add(a.trim());
          }
        });
        if (areasFromData.size > 0) {
          this.updateAreaFilterOptions(Array.from(areasFromData));
        }

        const rawTotal = (res && res.payload && typeof res.payload.total === 'number')
          ? res.payload.total
          : ((res && typeof res.total === 'number') ? res.total : null);
        const isServerPaginated = rawTotal !== null;

        let pagedItems;
        let totalCount;
        let totalPages;
        let safePage;

        if (isServerPaginated) {
          // GAS Version 10: Server has filtered month/date/unreviewed/area before pagination (RELEASE-002, RELEASE-003, RELEASE-004)
          pagedItems = allShipments; // Server already filtered and sliced the requested page
          safePage = (res.payload?.page ?? res.page) || this.currentPage;
          totalCount = rawTotal;
          totalPages = (res.payload?.totalPages ?? res.totalPages) || (totalCount === 0 ? 1 : Math.ceil(totalCount / this.limit));
        } else {
          // Legacy Version 9 fallback: client-side filtering and slicing (PAGE-010 / RELEASE-006)
          let dateFiltered = allShipments.filter(item => {
            const dateStr = item.loadingDate || (item.inputStartedAt ? item.inputStartedAt.slice(0, 10) : (item.registeredAt ? item.registeredAt.slice(0, 10) : ''));
            if (!dateStr) return false;
            if (this.customRange) {
              return dateStr >= this.customRange.startDate && dateStr <= this.customRange.endDate;
            } else {
              return dateStr.startsWith(this.targetMonth);
            }
          });

          let filtered = dateFiltered.slice();
          if (unreviewedOnly) {
            filtered = filtered.filter(item => (item.reviewStatus || '未確認') === '未確認');
          }
          if (area && area !== '全国') {
            filtered = filtered.filter(item => item.historicalAreaName === area);
          }

          totalCount = filtered.length;
          totalPages = Math.max(1, Math.ceil(totalCount / this.limit));
          safePage = Math.min(this.currentPage, totalPages);
          pagedItems = filtered.slice((safePage - 1) * this.limit, safePage * this.limit);
        }

        const pagination = {
          page: safePage,
          limit: this.limit,
          totalCount: totalCount,
          totalPages: totalPages,
          hasPrev: safePage > 1,
          hasNext: safePage < totalPages
        };

        const lblTotal = document.getElementById('lblReviewTotalCount');
        if (lblTotal) {
          lblTotal.textContent = String(totalCount);
        }

        // Response Change Detection (skip DOM replacement if identical)
        if (typeof isSameShipmentList === 'function' && isSameShipmentList(this.lastRenderedReviewItems, pagedItems) && container.children.length > 0 && !container.innerHTML.includes('読み込み中')) {
          return;
        }
        this.lastRenderedReviewItems = pagedItems;

        this.renderReviewList(pagedItems, pagination);
      } catch (err) {
        if (seq !== this.loadSeq) return;
        container.innerHTML = `
          <div style="padding:24px; background:#FEF2F2; border:1px solid #F87171; border-radius:6px; color:#991B1B;">
            <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
              <strong>レビュー一覧の取得に失敗しました</strong>
              <button type="button" class="btn btn-secondary" id="btnRetryReview" style="min-height:36px; padding:4px 12px; font-size:0.85rem;" onclick="ReviewManager.loadReviewList();">再試行</button>
            </div>
            <p style="margin:8px 0 0 0; font-size:0.9rem; color:#7F1D1D;">接続状況を確認の上、時間をおいて再試行してください。</p>
          </div>
        `;
      } finally {
        if (seq === this.loadSeq) {
          container.style.opacity = '1';
          container.removeAttribute('aria-busy');
          const indicator = document.getElementById('reviewLoadingIndicator');
          if (indicator) indicator.style.display = 'none';
          const refreshBtn = document.getElementById('btnRefreshReviewList');
          if (refreshBtn) {
            refreshBtn.disabled = false;
            refreshBtn.removeAttribute('aria-busy');
          }
        }
      }
    },

    renderReviewList: function (items, pagination) {
      const container = document.getElementById('reviewListContainer');
      if (!container) return;

      if (items.length === 0) {
        container.innerHTML = `
          <div style="text-align:center; padding:48px 16px; background:#FFFFFF; border:1px solid var(--color-border); border-radius:var(--radius-sm); color:var(--color-text-muted);">
            <div style="font-size:1.1rem; font-weight:600; margin-bottom:8px;">該当する実績データはありません</div>
            <p style="font-size:0.9rem;">フィルター条件を変更するか、「新規登録」からチェック実績を登録してください。</p>
          </div>
        `;
        return;
      }

      let html = '<div class="review-cards-list" style="display:flex; flex-direction:column; gap:12px;">';

      items.forEach(item => {
        const badge = getReviewStatusBadge(item.reviewStatus);
        let regDate = '---';
        if (item.registeredAt) {
          try {
            const d = new Date(item.registeredAt);
            if (!isNaN(d.getTime())) {
              const yr = d.getFullYear();
              const mo = String(d.getMonth() + 1).padStart(2, '0');
              const da = String(d.getDate()).padStart(2, '0');
              const hr = String(d.getHours()).padStart(2, '0');
              const mi = String(d.getMinutes()).padStart(2, '0');
              regDate = `${yr}/${mo}/${da} ${hr}:${mi}`;
            } else {
              regDate = item.registeredAt.replace('T', ' ').substring(0, 16);
            }
          } catch {
            regDate = item.registeredAt.replace('T', ' ').substring(0, 16);
          }
        }
        const errCount = (typeof item.errorDetailsCount === 'number')
          ? item.errorDetailsCount
          : ((item.errorDetails && Array.isArray(item.errorDetails))
            ? item.errorDetails.length
            : ((typeof item.equipmentTypeCount === 'number' && item.equipmentTypeCount > 0) ? item.equipmentTypeCount : 1));
        const attCount = item.attachmentsCount || 0;

        html += `
          <div class="review-card card" data-id="${escapeHtml(item.shippingCheckId)}" style="cursor:pointer; padding:16px; background:#FFFFFF; border:1px solid var(--color-border); border-radius:var(--radius-sm); transition:all 0.15s ease;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; flex-wrap:wrap; gap:8px;">
              <div style="display:flex; align-items:center; gap:8px;">
                ${badge}
                <span style="font-size:0.95rem; font-weight:700; color:var(--color-text-main);">${escapeHtml(item.historicalBaseName || '---')}</span>
                <span style="font-size:0.82rem; color:var(--color-text-muted);">(${escapeHtml(item.historicalAreaName || 'エリア未設定')})</span>
              </div>
              <span style="font-size:0.82rem; color:var(--color-text-muted);">${escapeHtml(regDate)}</span>
            </div>

            <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(140px, 1fr)); gap:8px; font-size:0.88rem; margin-bottom:12px;">
              <div><span style="color:var(--color-text-muted);">担当:</span> <strong>${escapeHtml(item.employeeName || '---')}</strong></div>
              <div><span style="color:var(--color-text-muted);">リフトマン:</span> <strong>${escapeHtml(item.liftOperatorName || '---')}</strong></div>
              <div><span style="color:var(--color-text-muted);">協力会社:</span> ${escapeHtml(item.partnerName || '---')}</div>
              <div><span style="color:var(--color-text-muted);">明細/添付:</span> エラー <strong>${errCount}</strong>件 / 証跡 <strong>${attCount}</strong>件</div>
            </div>

            <div style="display:flex; justify-content:flex-end;">
              <button type="button" class="btn btn-secondary btn-review-detail" data-id="${escapeHtml(item.shippingCheckId)}" aria-label="詳細を確認・判定する" style="min-height:40px; padding:6px 14px; font-size:0.88rem; font-weight:600;">
                確認・判定
              </button>
            </div>
          </div>
        `;
      });

      html += '</div>';

      // Pagination (P2-003: clearly show current page and total pages even when 1 page)
      if (pagination && pagination.totalCount > 0) {
        html += `
          <div class="review-pagination-container" id="reviewPaginationContainer" style="display:flex; justify-content:center; align-items:center; gap:16px; margin-top:20px; padding:12px;">
            <button type="button" class="btn btn-secondary" id="btnReviewPrev" ${!pagination.hasPrev ? 'disabled' : ''} style="min-height:44px; padding:6px 16px;">前へ</button>
            <span id="reviewPageIndicator" style="font-size:0.9rem; font-weight:600;">${pagination.page} / ${pagination.totalPages} ページ (全 ${pagination.totalCount} 件)</span>
            <button type="button" class="btn btn-secondary" id="btnReviewNext" ${!pagination.hasNext ? 'disabled' : ''} style="min-height:44px; padding:6px 16px;">次へ</button>
          </div>
        `;
      }

      container.innerHTML = html;

      // Event listeners for cards and detail buttons
      const openDetailFn = (id) => {
        if (!id) return;
        if (typeof window.openShipmentCheckDetail === 'function') {
          window.openShipmentCheckDetail(id);
        } else if (typeof window.openDetailView === 'function') {
          window.openDetailView(id);
        } else {
          console.warn('Detail modal opener not available for ID:', id);
        }
      };

      container.querySelectorAll('.review-card').forEach(card => {
        card.addEventListener('click', (e) => {
          if (e.target.closest('button')) return;
          const id = card.getAttribute('data-id');
          openDetailFn(id);
        });
      });

      container.querySelectorAll('.btn-review-detail').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const id = btn.getAttribute('data-id');
          openDetailFn(id);
        });
      });

      const btnPrev = document.getElementById('btnReviewPrev');
      if (btnPrev) {
        btnPrev.addEventListener('click', () => {
          if (this.currentPage > 1) {
            this.currentPage--;
            this.loadReviewList();
          }
        });
      }

      const btnNext = document.getElementById('btnReviewNext');
      if (btnNext) {
        btnNext.addEventListener('click', () => {
          this.currentPage++;
          this.loadReviewList();
        });
      }
    },

    initReviewActionPanel: function (containerOrId, maybeRecord, maybeComment) {
      var c = (typeof containerOrId === 'string')
        ? (document.getElementById(containerOrId) || document.getElementById('detailModalContainer') || document.body)
        : containerOrId;
      var r = (typeof maybeRecord === 'object' && maybeRecord !== null)
        ? maybeRecord
        : {
            shippingCheckId: (typeof containerOrId === 'string' && containerOrId !== 'detailModalContainer') ? containerOrId : 'UNKNOWN',
            reviewStatus: (typeof maybeRecord === 'string') ? maybeRecord : '未確認',
            reviewComment: maybeComment || ''
          };
      return this.renderReviewActionPanel(c, r);
    },

    renderReviewActionPanel: function (container, currentRecord) {
      if (!container || !currentRecord) return;

      const checkRecord = (currentRecord && currentRecord.shipmentCheck)
        ? currentRecord.shipmentCheck
        : currentRecord;

      this.currentRecord = checkRecord;
      this.canSubmitReview = false;
      const authSeq = ++this.authCheckSeq;
      const targetCheckId = checkRecord ? checkRecord.shippingCheckId : null;
      const currentStatus = checkRecord.reviewStatus || '未確認';
      const currentComment = checkRecord.reviewComment || '';

      container.innerHTML = `
        <div class="review-action-box" style="margin-top:24px; padding:16px; background:#F8FAFC; border:2px solid var(--color-primary); border-radius:var(--radius-sm);">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; flex-wrap:wrap; gap:8px;">
            <h3 style="font-size:1.05rem; font-weight:bold; color:var(--color-text-main); margin:0;">
              エリアマネージャー判定
            </h3>
            <div>${getReviewStatusBadge(currentStatus)}</div>
          </div>

          <div style="margin-bottom:14px;">
            <label style="display:block; font-size:0.9rem; font-weight:600; margin-bottom:6px; color:var(--color-text-main);">
              判定ステータス選択:
            </label>
            <div class="review-status-options" style="display:flex; gap:12px; flex-wrap:wrap;">
              <label class="review-radio-label" style="display:flex; align-items:center; gap:8px; padding:8px 16px; background:#FFFFFF; border:2px solid ${currentStatus === 'OK' ? '#10B981' : 'var(--color-border)'}; border-radius:6px; cursor:pointer; min-height:48px;">
                <input type="radio" name="radReviewStatus" id="radStatusOK" value="OK" ${currentStatus === 'OK' ? 'checked' : ''} style="width:20px; height:20px; accent-color:#10B981;" />
                <span style="font-weight:700; color:#166534; font-size:0.95rem;">承認 (OK)</span>
              </label>

              <label class="review-radio-label" style="display:flex; align-items:center; gap:8px; padding:8px 16px; background:#FFFFFF; border:2px solid ${currentStatus === 'NG' ? '#EF4444' : 'var(--color-border)'}; border-radius:6px; cursor:pointer; min-height:48px;">
                <input type="radio" name="radReviewStatus" id="radStatusNG" value="NG" ${currentStatus === 'NG' ? 'checked' : ''} style="width:20px; height:20px; accent-color:#EF4444;" />
                <span style="font-weight:700; color:#991B1B; font-size:0.95rem;">差戻し (NG)</span>
              </label>
            </div>
          </div>

          <div style="margin-bottom:14px;">
            <label for="txtReviewComment" style="display:block; font-size:0.9rem; font-weight:600; margin-bottom:4px; color:var(--color-text-main);">
              レビューコメント <span id="lblCommentRequiredNotice" class="required-asterisk" style="${currentStatus === 'NG' ? 'display:inline;' : 'display:none;'}">*</span>
            </label>
            <textarea id="txtReviewComment" rows="3" class="form-control" placeholder="判定理由や指示を入力" style="width:100%; box-sizing:border-box; font-size:0.95rem; line-height:1.4; padding:8px 12px; border:1px solid var(--color-border); border-radius:4px;">${escapeHtml(currentComment)}</textarea>
            <div id="reviewCommentError" style="display:none; color:#DC2626; font-size:0.85rem; font-weight:600; margin-top:4px;">
              NG判定時はレビューコメントの入力が必須です。
            </div>
          </div>

          <div id="reviewSaveBtnContainer" style="display:flex; justify-content:flex-end; gap:8px; align-items:center;">
            <span id="reviewSaveFeedback" style="display:none; font-size:0.9rem; font-weight:600;"></span>
            <!-- Button is dynamically injected below -->
          </div>
        </div>
      `;

      // Radio change handlers to show/hide required notice and highlight
      const radios = container.querySelectorAll('input[name="radReviewStatus"]');
      const requiredNotice = document.getElementById('lblCommentRequiredNotice');
      const errorDiv = document.getElementById('reviewCommentError');
      const commentTxt = document.getElementById('txtReviewComment');

      radios.forEach(radio => {
        radio.addEventListener('change', () => {
          container.querySelectorAll('.review-radio-label').forEach(lbl => {
            lbl.style.borderColor = 'var(--color-border)';
          });
          const parentLabel = radio.closest('.review-radio-label');
          if (radio.value === 'OK') {
            if (parentLabel) parentLabel.style.borderColor = '#10B981';
            if (requiredNotice) requiredNotice.style.display = 'none';
          } else if (radio.value === 'NG') {
            if (parentLabel) parentLabel.style.borderColor = '#EF4444';
            if (requiredNotice) requiredNotice.style.display = 'inline';
          } else {
            if (parentLabel) parentLabel.style.borderColor = '#F59E0B';
            if (requiredNotice) requiredNotice.style.display = 'none';
          }
          if (errorDiv) errorDiv.style.display = 'none';
          if (commentTxt) commentTxt.style.borderColor = 'var(--color-border)';
        });
      });

      // Dynamically mount review submission action button within the modal container
      // Evaluates SHIPMENT_REVIEW_NATIONWIDE capability for client UI advisory control
      const btnContainer = document.getElementById('reviewSaveBtnContainer');
      if (!btnContainer) return;

      // Ensure feedback element is preserved
      let feedback = document.getElementById('reviewSaveFeedback');
      if (!feedback) {
        feedback = document.createElement('span');
        feedback.id = 'reviewSaveFeedback';
        feedback.style.display = 'none';
        feedback.style.fontSize = '0.9rem';
        feedback.style.fontWeight = '600';
      }

      let saveBtn = document.getElementById('btnSaveReview');
      if (!saveBtn) {
        saveBtn = document.createElement('button');
        saveBtn.type = 'button';
        saveBtn.id = 'btnSaveReview';
        saveBtn.className = 'btn btn-primary';
        saveBtn.textContent = '保存';
        saveBtn.style.minHeight = '48px';
        saveBtn.style.padding = '8px 24px';
        saveBtn.style.fontSize = '1rem';
        saveBtn.style.fontWeight = '700';
      }
      // Initialize in Fail-Closed disabled state pending asynchronous authorization resolution
      saveBtn.disabled = true;
      saveBtn.style.opacity = '0.5';
      saveBtn.style.cursor = 'wait';
      saveBtn.title = '権限を確認中...';

      btnContainer.innerHTML = '';
      btnContainer.appendChild(feedback);
      btnContainer.appendChild(saveBtn);

      // Client-side advisory authorization check with comprehensive sessionToken resolution
      const rpcClient = window.shippingRpcClient;
      const resolveToken = () => {
        if (window.SessionClient && typeof window.SessionClient.getToken === 'function') {
          return window.SessionClient.getToken();
        }
        if (window.sessionClient && typeof window.sessionClient.getToken === 'function') {
          return window.sessionClient.getToken();
        }
        if (typeof SessionClient !== 'undefined' && typeof SessionClient.getToken === 'function') {
          return SessionClient.getToken();
        }
        return null;
      };
      const sessionToken = resolveToken();

      const applyAuthUI = (hasCap, selfRev) => {
        let notice = document.getElementById('reviewAuthNotice');
        if (!hasCap) {
          this.canSubmitReview = false;
          saveBtn.disabled = true;
          saveBtn.style.opacity = '0.5';
          saveBtn.style.cursor = 'not-allowed';
          saveBtn.title = '審査権限（SHIPMENT_REVIEW_NATIONWIDE）がありません';
          if (!notice) {
            notice = document.createElement('div');
            notice.id = 'reviewAuthNotice';
            notice.style.fontSize = '0.85rem';
            notice.style.color = '#B91C1C';
            notice.style.marginTop = '8px';
            btnContainer.appendChild(notice);
          }
          notice.textContent = '※ 審査権限保有ユーザー（AreaManager / Manager / Admin）のみ判定保存できます。';
        } else if (selfRev) {
          this.canSubmitReview = false;
          saveBtn.disabled = true;
          saveBtn.style.opacity = '0.5';
          saveBtn.style.cursor = 'not-allowed';
          saveBtn.title = '自己登録レコードの審査は禁止されています（AUTHZ-006）';
          if (!notice) {
            notice = document.createElement('div');
            notice.id = 'reviewAuthNotice';
            notice.style.fontSize = '0.85rem';
            notice.style.color = '#B91C1C';
            notice.style.marginTop = '8px';
            btnContainer.appendChild(notice);
          }
          notice.textContent = '※ 登録者本人による自己審査は禁止されています（AUTHZ-006）。他の審査者による判定をお待ちください。';
        } else {
          this.canSubmitReview = true;
          saveBtn.disabled = false;
          saveBtn.style.opacity = '1';
          saveBtn.style.cursor = 'pointer';
          saveBtn.title = '';
          if (notice) notice.remove();
        }
      };

      // Check synchronous cached context immediately (CACHE-FIRST for instant UI response)
      const cachedCtx = window.__CURRENT_ACCESS_CONTEXT__;
      if (cachedCtx) {
        let cachedCap = false;
        let cachedSelf = false;
        if (window.AuthorizationClient && typeof window.AuthorizationClient.hasCapability === 'function') {
          cachedCap = window.AuthorizationClient.hasCapability(cachedCtx, 'SHIPMENT_REVIEW_NATIONWIDE');
        } else if (cachedCtx.capabilities && Array.isArray(cachedCtx.capabilities)) {
          cachedCap = cachedCtx.capabilities.indexOf('SHIPMENT_REVIEW_NATIONWIDE') !== -1;
        }
        if (checkRecord && cachedCtx.empNo) {
          const recordCreator = checkRecord.employeeCode || checkRecord.EmployeeCode || checkRecord.empNo;
          if (recordCreator && String(recordCreator).trim() === String(cachedCtx.empNo).trim()) {
            cachedSelf = true;
          }
        }
        applyAuthUI(cachedCap, cachedSelf);
      }

      const checkAndRenderAuth = async () => {
        let hasReviewCapability = false;
        let isSelfReview = false;
        try {
          if (rpcClient && typeof rpcClient.call === 'function' && sessionToken) {
            const ctxRes = await rpcClient.call('authz.getAccessContext', { sessionToken: sessionToken });
            const ctx = (ctxRes && ctxRes.payload) ? ctxRes.payload : ctxRes;
            if (window.AuthorizationClient && typeof window.AuthorizationClient.hasCapability === 'function') {
              hasReviewCapability = window.AuthorizationClient.hasCapability(ctx, 'SHIPMENT_REVIEW_NATIONWIDE');
            } else if (ctx && Array.isArray(ctx.capabilities)) {
              hasReviewCapability = ctx.capabilities.indexOf('SHIPMENT_REVIEW_NATIONWIDE') !== -1;
            }

            // SSOT AUTHZ-006: Self-review prohibition advisory check
            if (checkRecord && ctx && ctx.empNo) {
              const recordCreator = checkRecord.employeeCode || checkRecord.EmployeeCode || checkRecord.empNo;
              if (recordCreator && String(recordCreator).trim() === String(ctx.empNo).trim()) {
                isSelfReview = true;
              }
            }
          } else if (cachedCtx) {
            return; // Already resolved via cached context
          } else if (!rpcClient) {
            // Fallback only when rpcClient is entirely absent (e.g. static mockup demo)
            hasReviewCapability = true;
          }
        } catch (e) {
          if (cachedCtx) return; // Keep cached context resolution on network error
          hasReviewCapability = false;
        }

        // Discard stale async authorization responses if user switched to another record
        if (authSeq !== this.authCheckSeq || !this.currentRecord || this.currentRecord.shippingCheckId !== targetCheckId) {
          return;
        }

        applyAuthUI(hasReviewCapability, isSelfReview);
      };
      checkAndRenderAuth();

      saveBtn.onclick = async () => {
        const id = (checkRecord && checkRecord.shippingCheckId)
          || (this.currentRecord && this.currentRecord.shippingCheckId);
        await this.handleSaveReview(id);
      };
    },

    handleSaveReview: async function (shippingCheckId) {
      const targetId = shippingCheckId
        || (this.currentRecord && this.currentRecord.shippingCheckId)
        || (this.currentRecord && this.currentRecord.shipmentCheck && this.currentRecord.shipmentCheck.shippingCheckId);

      if (!targetId) {
        alert('エラー: 審査対象IDが見つかりません。');
        return;
      }
      if (!this.canSubmitReview) {
        alert('審査権限がないか、自己審査は禁止されています。');
        return;
      }
      if (this.currentRecord) {
        const creator = this.currentRecord.employeeCode || this.currentRecord.EmployeeCode || this.currentRecord.empNo;
        const curEmpNo = (window.sessionClient && typeof window.sessionClient.getEmpNo === 'function')
          ? window.sessionClient.getEmpNo()
          : null;
        if (creator && curEmpNo && String(creator).trim() === String(curEmpNo).trim()) {
          alert('登録者本人による自己審査は禁止されています（AUTHZ-006）。他の審査者による判定をお待ちください。');
          return;
        }
      }

      const selectedRadio = document.querySelector('input[name="radReviewStatus"]:checked');
      if (!selectedRadio) {
        alert('審査判定（OKまたはNG）を選択してください。');
        return;
      }
      const status = selectedRadio.value;
      if (status !== 'OK' && status !== 'NG') {
        alert('審査判定は「OK」または「NG」を選択してください。未確認状態のまま保存することはできません。');
        return;
      }
      const commentInput = document.getElementById('txtReviewComment');
      const comment = commentInput ? commentInput.value.trim() : '';
      const errorDiv = document.getElementById('reviewCommentError');
      const feedback = document.getElementById('reviewSaveFeedback');
      const saveBtn = document.getElementById('btnSaveReview');

      // NG validation: must have non-empty comment
      if (status === 'NG' && !comment) {
        if (errorDiv) {
          errorDiv.style.display = 'block';
          errorDiv.textContent = 'NG判定時はレビューコメントの入力が必須です。';
        }
        if (commentInput) {
          commentInput.style.borderColor = '#DC2626';
          commentInput.focus();
        }
        return;
      }

      if (errorDiv) errorDiv.style.display = 'none';
      if (commentInput) commentInput.style.borderColor = 'var(--color-border)';

      if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.textContent = '保存中...';
      }

      try {
        const shipmentClient = window.shippingClient || (typeof ShippingShipmentClient !== 'undefined' && typeof ShippingShipmentClient.createShipmentClient === 'function'
          ? ShippingShipmentClient.createShipmentClient({ rpcClient: window.shippingRpcClient })
          : null);
        const rpcClient = window.shippingRpcClient;
        const resolveToken = () => {
          if (window.SessionClient && typeof window.SessionClient.getToken === 'function') return window.SessionClient.getToken();
          if (window.sessionClient && typeof window.sessionClient.getToken === 'function') return window.sessionClient.getToken();
          if (typeof SessionClient !== 'undefined' && typeof SessionClient.getToken === 'function') return SessionClient.getToken();
          return null;
        };
        const sessionToken = resolveToken();

        const checkRec = (this.currentRecord && this.currentRecord.shipmentCheck)
          ? this.currentRecord.shipmentCheck
          : this.currentRecord;
        const expectedReviewedAt = (checkRec && (checkRec.reviewedAt !== undefined ? checkRec.reviewedAt : (checkRec.ReviewedAt !== undefined ? checkRec.ReviewedAt : null))) || null;
        const reviewInput = {
          reviewStatus: status,
          reviewComment: comment || '',
          expectedReviewedAt: expectedReviewedAt
        };

        let res;
        if (shipmentClient && typeof shipmentClient.reviewShipment === 'function') {
          res = await shipmentClient.reviewShipment(targetId, reviewInput, sessionToken);
        } else if (rpcClient && typeof rpcClient.call === 'function') {
          res = await rpcClient.call('shipment.review', {
            sessionToken: sessionToken,
            shippingCheckId: targetId,
            reviewInput: reviewInput
          });
        } else {
          throw new Error('RPCクライアントが利用できません');
        }

        const data = (res && res.payload) ? res.payload : res;

        if (feedback) {
          feedback.style.display = 'inline';
          feedback.style.color = '#166534';
          feedback.textContent = '判定を保存しました！';
          setTimeout(() => { feedback.style.display = 'none'; }, 3000);
        }

        // Invalidate shipment & review caches on mutation
        if (typeof shipmentCache !== 'undefined' && shipmentCache.invalidateMutations) {
          shipmentCache.invalidateMutations();
        }

        // Notify listeners to update lists
        this.onReviewSavedCallbacks.forEach(cb => cb(data));

        // Reload review list if visible
        this.loadReviewList();
      } catch (err) {
        if (err && (err.code === 'ERR_CONFLICT_STALE_RECORD' || (err.message && err.message.indexOf('ERR_CONFLICT_STALE_RECORD') !== -1))) {
          alert('【競合エラー】他の審査者によって判定が更新されたか、最新状態ではありません。\n最新データを再読み込みしてください。');
        } else {
          const errMsg = (err && err.message) ? err.message : String(err);
          alert('エラー: ' + errMsg);
        }
      } finally {
        if (saveBtn) {
          saveBtn.textContent = '保存';
          if (this.canSubmitReview) {
            saveBtn.disabled = false;
            saveBtn.style.opacity = '1';
            saveBtn.style.cursor = 'pointer';
          } else {
            saveBtn.disabled = true;
            saveBtn.style.opacity = '0.5';
            saveBtn.style.cursor = 'not-allowed';
          }
        }
      }
    }
  };

  window.ReviewManager = ReviewManager;

  // Auto-initialize when DOM is ready
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        ReviewManager.init();
      });
    } else {
      ReviewManager.init();
    }
  }

})(window, document);
