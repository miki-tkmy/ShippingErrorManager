/**
 * analytics.js - TASK-011: Nationwide Multi-Axis Analytics Engine
 * Handles Nationwide Analytics UI:
 * - Metric Cards: affectedShipmentCheckCount (対象出荷チェック件数), errorDetailCount (積み間違い明細件数)
 * - 8 Canonical Axes: area, base, category, material, partner, driver, loose, transport
 * - Filter Panel: date range, area, base, category, material, partner, liftOperator, hasLooseItems, transportCategory
 * - Breakdown Table with visual comparison bars
 * - CSV Export (formula-injection protected, no error-rate column)
 * - Strict prohibition on error-rate / percentage calculations
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

  const CANONICAL_AXES = [
    'area',
    'base',
    'category',
    'material',
    'partner',
    'driver',
    'loose',
    'transport'
  ];

  const AXIS_NAMES = {
    area: 'エリア別',
    base: '拠点別',
    category: '区分別',
    material: '資材別',
    partner: '運送会社別',
    driver: 'リフトマン別',
    loose: 'バラ有無別',
    transport: '便種別'
  };

  const AnalyticsView = {
    currentAxis: 'area',
    filters: {},

    init: function () {
      this.bindEvents();
    },

    populateMasterFilters: function () {
      if (window.MasterClient && typeof window.MasterClient.getBases === 'function') {
        window.MasterClient.getBases().then(bases => {
          if (!bases || !Array.isArray(bases)) return;
          const areas = Array.from(new Set(bases.map(b => b.areaName || b.area).filter(Boolean))).sort();
          const selArea = document.getElementById('selAnalyticsArea');
          if (selArea && selArea.options.length <= 1) {
            areas.forEach(a => {
              const opt = document.createElement('option');
              opt.value = a;
              opt.textContent = a;
              selArea.appendChild(opt);
            });
          }
          const selBase = document.getElementById('selAnalyticsBase');
          if (selBase && selBase.options.length <= 1) {
            bases.forEach(b => {
              const opt = document.createElement('option');
              opt.value = b.baseCode;
              opt.textContent = `${b.baseName} (${b.baseCode})`;
              selBase.appendChild(opt);
            });
          }
        }).catch(err => {
          console.warn('Failed to populate master filters for analytics:', err);
        });
      }
    },

    bindEvents: function () {
      // Axis buttons
      CANONICAL_AXES.forEach(axis => {
        const btn = document.getElementById(`btnAxis${axis.charAt(0).toUpperCase() + axis.slice(1)}`);
        if (btn) {
          btn.addEventListener('click', () => {
            this.setAxis(axis);
          });
        }
      });

      // Filter apply / reset
      const btnApply = document.getElementById('btnApplyAnalyticsFilter');
      if (btnApply) {
        btnApply.addEventListener('click', () => {
          this.applyFilters();
        });
      }

      const btnReset = document.getElementById('btnResetAnalyticsFilter');
      if (btnReset) {
        btnReset.addEventListener('click', () => {
          this.resetFilters();
        });
      }

      // Export CSV
      const btnExport = document.getElementById('btnExportCsv');
      if (btnExport) {
        btnExport.addEventListener('click', () => {
          this.exportCsv();
        });
      }
    },

    setAxis: function (axis) {
      if (!CANONICAL_AXES.includes(axis)) return;
      this.currentAxis = axis;

      // Update button active state
      CANONICAL_AXES.forEach(a => {
        const btn = document.getElementById(`btnAxis${a.charAt(0).toUpperCase() + a.slice(1)}`);
        if (btn) {
          if (a === axis) {
            btn.classList.add('is-active');
            btn.setAttribute('aria-pressed', 'true');
          } else {
            btn.classList.remove('is-active');
            btn.setAttribute('aria-pressed', 'false');
          }
        }
      });

      // Update table title
      const lblCurrentAxis = document.getElementById('lblCurrentAxisTitle');
      if (lblCurrentAxis) {
        lblCurrentAxis.textContent = AXIS_NAMES[axis] || axis;
      }

      this.loadBreakdown();
    },

    readFilterInputs: function () {
      const filters = {};
      const dtStart = document.getElementById('dtAnalyticsStart');
      const dtEnd = document.getElementById('dtAnalyticsEnd');
      const selArea = document.getElementById('selAnalyticsArea');
      const selBase = document.getElementById('selAnalyticsBase');
      const selCategory = document.getElementById('selAnalyticsCategory');
      const txtMaterial = document.getElementById('txtAnalyticsMaterial');
      const txtPartner = document.getElementById('txtAnalyticsPartner');
      const txtDriver = document.getElementById('txtAnalyticsDriver');
      const selLoose = document.getElementById('selAnalyticsLoose');
      const selTransport = document.getElementById('selAnalyticsTransport');

      if (dtStart && dtStart.value) filters.startDate = dtStart.value;
      if (dtEnd && dtEnd.value) filters.endDate = dtEnd.value;
      if (selArea && selArea.value) filters.area = selArea.value;
      if (selBase && selBase.value) filters.base = selBase.value;
      if (selCategory && selCategory.value) filters.category = selCategory.value;
      if (txtMaterial && txtMaterial.value.trim()) filters.material = txtMaterial.value.trim();
      if (txtPartner && txtPartner.value.trim()) filters.partner = txtPartner.value.trim();
      if (txtDriver && txtDriver.value.trim()) filters.liftOperator = txtDriver.value.trim();
      if (selLoose && selLoose.value !== '') filters.hasLooseItems = selLoose.value;
      if (selTransport && selTransport.value) filters.transportCategory = selTransport.value;

      return filters;
    },

    applyFilters: function () {
      this.filters = this.readFilterInputs();
      this.renderActiveFilterBadges();
      this.loadAnalytics();
    },

    resetFilters: function () {
      const dtStart = document.getElementById('dtAnalyticsStart');
      const dtEnd = document.getElementById('dtAnalyticsEnd');
      const selArea = document.getElementById('selAnalyticsArea');
      const selBase = document.getElementById('selAnalyticsBase');
      const selCategory = document.getElementById('selAnalyticsCategory');
      const txtMaterial = document.getElementById('txtAnalyticsMaterial');
      const txtPartner = document.getElementById('txtAnalyticsPartner');
      const txtDriver = document.getElementById('txtAnalyticsDriver');
      const selLoose = document.getElementById('selAnalyticsLoose');
      const selTransport = document.getElementById('selAnalyticsTransport');

      if (dtStart) dtStart.value = '';
      if (dtEnd) dtEnd.value = '';
      if (selArea) selArea.value = '';
      if (selBase) selBase.value = '';
      if (selCategory) selCategory.value = '';
      if (txtMaterial) txtMaterial.value = '';
      if (txtPartner) txtPartner.value = '';
      if (txtDriver) txtDriver.value = '';
      if (selLoose) selLoose.value = '';
      if (selTransport) selTransport.value = '';

      this.filters = {};
      this.renderActiveFilterBadges();
      this.loadAnalytics();
    },

    renderActiveFilterBadges: function () {
      const container = document.getElementById('analyticsActiveFilters');
      if (!container) return;

      const keys = Object.keys(this.filters);
      if (keys.length === 0) {
        container.innerHTML = '<span class="filter-none-text">フィルタなし（全件対象）</span>';
        return;
      }

      const labels = {
        startDate: '開始日',
        endDate: '終了日',
        area: 'エリア',
        base: '拠点',
        category: '区分',
        material: '資材',
        partner: '運送会社',
        liftOperator: 'リフトマン',
        hasLooseItems: 'バラ有無',
        transportCategory: '便種'
      };

      let html = '<div class="active-filters-list">';
      keys.forEach(k => {
        let val = this.filters[k];
        if (k === 'hasLooseItems') {
          val = val === 'true' || val === true ? 'バラあり' : 'バラなし';
        }
        html += `<span class="badge-filter">${escapeHtml(labels[k] || k)}: ${escapeHtml(val)}</span>`;
      });
      html += '</div>';
      container.innerHTML = html;
    },

    buildQueryString: function (extraParams) {
      const params = new URLSearchParams();
      const merged = Object.assign({}, this.filters, extraParams || {});
      for (const [key, val] of Object.entries(merged)) {
        if (val !== undefined && val !== null && val !== '') {
          params.set(key, val);
        }
      }
      const qs = params.toString();
      return qs ? `?${qs}` : '';
    },

    loadAnalytics: function () {
      this.loadSummary();
      this.loadBreakdown();
    },

    loadSummary: function () {
      const qs = this.buildQueryString();
      fetch(`/api/analytics/summary${qs}`)
        .then(res => res.json())
        .then(res => {
          if (res && res.success && res.data) {
            this.renderSummary(res.data);
          } else {
            console.error('Failed to load summary:', res);
          }
        })
        .catch(err => {
          console.error('Summary fetch error:', err);
        });
    },

    renderSummary: function (data) {
      const elShipments = document.getElementById('valAffectedShipments');
      const elDetails = document.getElementById('valErrorDetails');

      if (elShipments) {
        elShipments.textContent = Number(data.affectedShipmentCheckCount || 0).toLocaleString();
      }
      if (elDetails) {
        elDetails.textContent = Number(data.errorDetailCount || 0).toLocaleString();
      }
    },

    loadBreakdown: function () {
      const tbody = document.getElementById('tbodyAnalyticsBreakdown');
      const emptyState = document.getElementById('analyticsEmptyState');
      const loadingState = document.getElementById('analyticsLoadingState');

      if (loadingState) loadingState.style.display = 'block';
      if (emptyState) emptyState.style.display = 'none';
      if (tbody) tbody.innerHTML = '';

      const qs = this.buildQueryString({ axis: this.currentAxis });
      fetch(`/api/analytics/breakdown${qs}`)
        .then(res => res.json())
        .then(res => {
          if (loadingState) loadingState.style.display = 'none';
          if (res && res.success && res.data) {
            this.renderBreakdown(res.data);
          } else {
            if (emptyState) {
              emptyState.textContent = 'データの取得に失敗しました。';
              emptyState.style.display = 'block';
            }
          }
        })
        .catch(err => {
          if (loadingState) loadingState.style.display = 'none';
          if (emptyState) {
            emptyState.textContent = '通信エラーが発生しました。';
            emptyState.style.display = 'block';
          }
          console.error('Breakdown fetch error:', err);
        });
    },

    renderBreakdown: function (data) {
      const tbody = document.getElementById('tbodyAnalyticsBreakdown');
      const emptyState = document.getElementById('analyticsEmptyState');
      if (!tbody) return;

      const items = (data && Array.isArray(data.items)) ? data.items : [];
      if (items.length === 0) {
        if (emptyState) {
          emptyState.textContent = '該当する集計データがありません。';
          emptyState.style.display = 'block';
        }
        tbody.innerHTML = '';
        return;
      }

      if (emptyState) emptyState.style.display = 'none';

      const maxDetails = Math.max(...items.map(it => it.errorDetailCount || 0), 1);

      let html = '';
      items.forEach(item => {
        const name = item.groupName || item.groupCode || '未設定';
        const code = item.groupCode || '---';
        const shipments = Number(item.affectedShipmentCheckCount || 0);
        const details = Number(item.errorDetailCount || 0);

        const ratioVal = Number(item.compositionRatio !== undefined ? item.compositionRatio : (item.composition_ratio || 0));
        const ratioPctStr = (ratioVal * 100).toFixed(1) + '%';
        const barPct = Math.min(100, Math.max(0, Math.round(ratioVal * 100)));

        html += `
          <tr class="analytics-row">
            <td class="col-name">
              <div class="group-name-cell">
                <span class="group-name-text">${escapeHtml(name)}</span>
              </div>
            </td>
            <td class="col-code">
              <span class="group-code-badge">${escapeHtml(code)}</span>
            </td>
            <td class="col-shipments" style="text-align: right; font-weight: 600;">
              ${shipments.toLocaleString()}
            </td>
            <td class="col-details" style="text-align: right; font-weight: 700; color: var(--color-primary-dark, #1E40AF);">
              ${details.toLocaleString()}
            </td>
            <td class="col-ratio" style="text-align: right; font-weight: 600; color: #0F766E;">
              ${ratioPctStr}
            </td>
            <td class="col-bar">
              <div class="analytics-bar-wrapper" title="構成比: ${ratioPctStr} (明細件数: ${details})">
                <div class="analytics-bar-fill" style="width: ${barPct}%;"></div>
              </div>
            </td>
          </tr>
        `;
      });

      tbody.innerHTML = html;
    },

    exportCsv: function () {
      const qs = this.buildQueryString({ axis: this.currentAxis, format: 'csv' });
      const url = `/api/analytics/export${qs}`;

      fetch(url)
        .then(res => {
          if (!res.ok) throw new Error('Export request failed: ' + res.status);
          return res.json();
        })
        .then(res => {
          if (res && res.success && res.data) {
            const blob = new Blob([res.data.content], { type: 'text/csv;charset=utf-8;' });
            const link = document.createElement('a');
            const urlObj = URL.createObjectURL(blob);
            link.setAttribute('href', urlObj);
            link.setAttribute('download', res.data.filename || `shipping_error_analytics_${this.currentAxis}.csv`);
            link.style.visibility = 'hidden';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(urlObj);
          } else {
            alert('CSVエクスポートに失敗しました。');
          }
        })
        .catch(err => {
          console.error('Export error:', err);
          alert('CSVエクスポート中にエラーが発生しました。');
        });
    }
  };

  window.AnalyticsView = AnalyticsView;

  document.addEventListener('DOMContentLoaded', () => {
    AnalyticsView.init();
  });

})(window, document);
