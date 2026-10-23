/**
 * =============================================================================
 * ShippingErrorManager - Material Code Search Combobox Component
 * =============================================================================
 * Phase: FRONTEND-001 (GITHUB_PAGES_SECURE_FRONTEND_AND_MATERIAL_CODE_SEARCH)
 *
 * Rules & Contract:
 *   - No <select> element (prohibited per Section 20)
 *   - Minimum 2 characters trigger (Section 21)
 *   - Debounce 200ms - 250ms (Section 21)
 *   - Stale responses discarded using incremental sequence counter (Section 21)
 *   - Never downloads full Material master to frontend (Section 21, 28)
 *   - Query-level caching (5 min TTL) with instant local candidate preview (Fast UX)
 *   - In-flight request deduplication for concurrent identical queries
 *   - Exact code match prioritization: when exact match exists, suppresses fuzzy matches
 *   - Popover displays max 10 candidates with MaterialCode and MaterialName (Section 20, 23)
 *   - Keyboard navigation: ArrowUp, ArrowDown, Enter, Escape (Section 27)
 *   - iPhone touch target >= 44px (Section 27)
 *   - 0 results displays "該当する資材がありません" (Section 27)
 *   - Canonical MaterialCode is preserved and emitted (Section 25, 26)
 *   - Independent search state per instance (Section 29)
 * =============================================================================
 */

(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else {
    root.MaterialCombobox = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /**
   * Filter candidates with strict exact match priority.
   * If any candidate exactly matches query as MaterialCode, return ONLY exact matches.
   * Otherwise, return all candidates (prefix/substring/fuzzy) up to 10.
   */
  function filterExactMatch(candidates, query) {
    if (!Array.isArray(candidates) || candidates.length === 0) return [];
    var qUpper = String(query || '').trim().toUpperCase();
    if (!qUpper) return candidates;

    var exactMatches = candidates.filter(function (c) {
      var code = String(c.materialCode || c.MaterialCode || '').trim().toUpperCase();
      return code === qUpper;
    });

    if (exactMatches.length > 0) {
      return exactMatches;
    }
    return candidates;
  }

  function renderLucideSvg(name, options) {
    if (typeof getLucideIcon === 'function') {
      return getLucideIcon(name, options);
    }
    if (typeof LucideIcons !== 'undefined' && typeof LucideIcons.getLucideIcon === 'function') {
      return LucideIcons.getLucideIcon(name, options);
    }
    if (typeof require !== 'undefined') {
      try {
        var lib = require('./lucide-icons.js');
        return lib.getLucideIcon(name, options);
      } catch (e) {}
    }
    if (name === 'Search') {
      return '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>';
    }
    if (name === 'X') {
      return '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';
    }
    return '';
  }

  /**
   * MaterialCombobox Constructor.
   *
   * @param {Object} options
   * @param {HTMLElement} options.container Target mounting container
   * @param {Object} options.rpcClient RpcClient instance
   * @param {Function} [options.getSessionToken] Function returning current sessionToken
   * @param {Function} [options.onSelect] Callback when a canonical material is selected: ({ materialCode, materialName, category }) => void
   * @param {Function} [options.onClear] Callback when selection is cleared: () => void
   * @param {Object} [options.initialValue] Initial selected material: { materialCode, materialName }
   * @param {number} [options.debounceMs] Debounce delay in ms (default: 200)
   * @param {number} [options.minQueryLength] Minimum character length (default: 2)
   */
  function MaterialCombobox(options) {
    var opts = options || {};
    this.container = opts.container;
    this.rpcClient = opts.rpcClient;
    this.getSessionToken = opts.getSessionToken || function () { return ''; };
    this.onSelect = opts.onSelect || function () {};
    this.onClear = opts.onClear || function () {};
    this.debounceMs = typeof opts.debounceMs === 'number' ? opts.debounceMs : 200;
    this.minQueryLength = typeof opts.minQueryLength === 'number' ? opts.minQueryLength : 2;

    if (opts.initialValue) {
      var initCode = opts.initialValue.materialCode || opts.initialValue.matCode || opts.initialValue.MaterialCode || '';
      var initName = opts.initialValue.materialName || opts.initialValue.matName || opts.initialValue.MaterialName || '';
      if (initCode) {
        this.selectedMaterial = {
          materialCode: String(initCode).trim(),
          materialName: String(initName).trim(),
          category: String(opts.initialValue.category || '').trim()
        };
      } else {
        this.selectedMaterial = null;
      }
    } else {
      this.selectedMaterial = null;
    }
    this.searchSequence = 0;
    this.debounceTimer = null;
    this.candidates = [];
    this.highlightedIndex = -1;
    this.isOpen = false;
    this.isLoading = false;

    // Fast Cache & Deduplication structures
    this.queryCache = new Map(); // normalizedQuery -> { timestamp, candidates }
    this.inFlightRequests = new Map(); // normalizedQuery -> Promise
    this.knownMaterials = new Map(); // upperMaterialCode -> canonicalItem
    this.lastSessionToken = null;

    this._initElements();
    this._bindEvents();
    if (this.selectedMaterial && this.selectedMaterial.materialCode) {
      this._renderSelection();
    }
  }

  MaterialCombobox.prototype._initElements = function () {
    if (!this.container) return;
    this.container.innerHTML = [
      '<div class="material-combobox-container">',
      '  <div class="material-combobox-input-wrapper" style="position: relative; display: flex; align-items: center;">',
      '    <span class="combobox-search-icon" style="position: absolute; left: 12px; pointer-events: none; color: var(--palette-paragraph, #475D5B); display: flex; align-items: center;">' + renderLucideSvg('Search', { size: 18 }) + '</span>',
      '    <input type="text" class="material-combobox-input" ',
      '      style="padding-left: 38px;" ',
      '      placeholder="資材コード・名称で検索" ',
      '      autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" ',
      '      aria-autocomplete="list" aria-expanded="false" role="combobox">',
      '  </div>',
      '  <ul class="material-combobox-popover" role="listbox" style="display: none;"></ul>',
      '  <div class="material-selected-card" style="display: none;">',
      '    <div class="material-selected-info">',
      '      <span class="material-selected-code"></span>',
      '      <span class="material-selected-name"></span>',
      '    </div>',
      '    <button type="button" class="btn-clear-material" aria-label="選択を解除">' + renderLucideSvg('X', { size: 20 }) + '</button>',
      '  </div>',
      '</div>'
    ].join('\n');

    this.wrapperEl = this.container.querySelector('.material-combobox-container');
    this.inputWrapperEl = this.container.querySelector('.material-combobox-input-wrapper');
    this.inputEl = this.container.querySelector('.material-combobox-input');
    this.popoverEl = this.container.querySelector('.material-combobox-popover');
    this.selectedCardEl = this.container.querySelector('.material-selected-card');
    this.selectedCodeEl = this.container.querySelector('.material-selected-code');
    this.selectedNameEl = this.container.querySelector('.material-selected-name');
    this.clearBtnEl = this.container.querySelector('.btn-clear-material');
  };

  MaterialCombobox.prototype._bindEvents = function () {
    var self = this;
    if (!self.inputEl) return;

    self.inputEl.addEventListener('input', function (e) {
      self._onInput(e.target.value);
    });

    self.inputEl.addEventListener('keydown', function (e) {
      self._onKeyDown(e);
    });

    self.clearBtnEl.addEventListener('click', function () {
      self.clear();
    });

    // Close on outside click
    if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
      document.addEventListener('click', function (e) {
        if (self.wrapperEl && !self.wrapperEl.contains(e.target)) {
          self.closePopover();
        }
      });
    }
  };

  MaterialCombobox.prototype._onInput = function (value) {
    var self = this;
    var query = String(value || '').trim();

    if (self.debounceTimer !== null) {
      clearTimeout(self.debounceTimer);
      self.debounceTimer = null;
    }

    if (query.length < self.minQueryLength) {
      self.closePopover();
      self.candidates = [];
      return;
    }

    var normQuery = query.toUpperCase();

    // Check query cache first: if cached, render immediately without debounce delay!
    var cached = self.queryCache.get(normQuery);
    if (cached && (Date.now() - cached.timestamp < 300000)) {
      self._applyCandidates(cached.candidates, query);
      return;
    }

    // Instant local candidate preview if any match exists in knownMaterials
    var localMatches = self._findLocalMatches(normQuery);
    if (localMatches.length > 0) {
      self._applyCandidates(localMatches, query);
    }

    // Debounce network RPC call
    self.debounceTimer = setTimeout(function () {
      self._fetchCandidates(query);
    }, self.debounceMs);
  };

  MaterialCombobox.prototype._findLocalMatches = function (normQuery) {
    var results = [];
    var self = this;
    if (!self.knownMaterials || self.knownMaterials.size === 0) return results;

    self.knownMaterials.forEach(function (item) {
      var cUpper = item.materialCode.toUpperCase();
      var nUpper = item.materialName.toUpperCase();
      if (cUpper === normQuery) {
        results.unshift(item); // Exact match first
      } else if (cUpper.startsWith(normQuery) || cUpper.indexOf(normQuery) !== -1 || (nUpper && nUpper.indexOf(normQuery) !== -1)) {
        results.push(item);
      }
    });
    return results;
  };

  MaterialCombobox.prototype._applyCandidates = function (rawList, query) {
    var filtered = filterExactMatch(rawList, query);
    this.candidates = filtered.slice(0, 10);
    this.highlightedIndex = -1;
    this._renderCandidates();
  };

  MaterialCombobox.prototype._fetchCandidates = function (query) {
    var self = this;
    var normQuery = String(query || '').trim().toUpperCase();
    if (normQuery.length < self.minQueryLength) return;

    var token = self.getSessionToken();
    if (self.lastSessionToken !== token) {
      self.clearCache();
      self.lastSessionToken = token;
    }

    // If cache valid, skip RPC completely
    var cached = self.queryCache.get(normQuery);
    if (cached && (Date.now() - cached.timestamp < 300000)) {
      self.isLoading = false;
      self._applyCandidates(cached.candidates, query);
      return;
    }

    self.searchSequence++;
    var currentSeq = self.searchSequence;

    // Show loading spinner only if we don't have local preview candidates yet
    if (self.candidates.length === 0) {
      self.isLoading = true;
      self._renderLoading();
    }

    if (!self.rpcClient) {
      self.isLoading = false;
      return;
    }

    // In-flight deduplication: reuse running promise if already fetching normQuery
    var inFlightPromise = self.inFlightRequests.get(normQuery);
    if (!inFlightPromise) {
      inFlightPromise = self.rpcClient.call('material.search', {
        query: query,
        sessionToken: token,
        limit: 10
      });
      self.inFlightRequests.set(normQuery, inFlightPromise);
    }

    inFlightPromise
      .then(function (response) {
        self.inFlightRequests.delete(normQuery);
        // Discard stale responses from superseded queries (Section 21)
        if (currentSeq !== self.searchSequence) {
          return;
        }
        self.isLoading = false;
        var list = (response && response.payload && Array.isArray(response.payload)) ? response.payload : [];

        // Register into knownMaterials pool
        list.forEach(function (m) {
          var code = String(m.materialCode || m.MaterialCode || '').trim();
          if (code) {
            self.knownMaterials.set(code.toUpperCase(), {
              materialCode: code,
              materialName: String(m.materialName || m.MaterialName || '').trim(),
              category: String(m.category || m.Category || '').trim()
            });
          }
        });

        // Store into queryCache (LRU max 100 entries)
        if (self.queryCache.size >= 100) {
          var firstKey = self.queryCache.keys().next().value;
          self.queryCache.delete(firstKey);
        }
        self.queryCache.set(normQuery, { timestamp: Date.now(), candidates: list });

        self._applyCandidates(list, query);
      })
      .catch(function (err) {
        self.inFlightRequests.delete(normQuery);
        if (currentSeq !== self.searchSequence) {
          return;
        }
        self.isLoading = false;
        // Do not overwrite existing local candidates with error if preview is active
        if (self.candidates.length === 0) {
          self._renderError(err);
        }
      });
  };

  MaterialCombobox.prototype._renderLoading = function () {
    if (!this.popoverEl) return;
    this.popoverEl.innerHTML = '<li class="material-combobox-loading">検索中...</li>';
    this.popoverEl.style.display = 'block';
    this.isOpen = true;
    if (this.inputEl) this.inputEl.setAttribute('aria-expanded', 'true');
  };

  MaterialCombobox.prototype._renderError = function (err) {
    if (!this.popoverEl) return;
    this.popoverEl.innerHTML = '<li class="material-combobox-empty">マスターデータを取得できませんでした。</li>';
    this.popoverEl.style.display = 'block';
    this.isOpen = true;
  };

  MaterialCombobox.prototype._renderCandidates = function () {
    var self = this;
    if (!self.popoverEl) return;

    if (self.candidates.length === 0) {
      self.popoverEl.innerHTML = '<li class="material-combobox-empty">該当する資材がありません</li>';
      self.popoverEl.style.display = 'block';
      self.isOpen = true;
      if (self.inputEl) self.inputEl.setAttribute('aria-expanded', 'true');
      return;
    }

    var html = self.candidates.map(function (mat, idx) {
      var isHigh = idx === self.highlightedIndex;
      return [
        '<li role="option" class="material-combobox-item' + (isHigh ? ' is-highlighted' : '') + '" ',
        '    data-index="' + idx + '" ',
        '    data-code="' + escapeHtml(mat.materialCode) + '" ',
        '    data-name="' + escapeHtml(mat.materialName) + '">',
        '  <span class="combobox-item-code">' + escapeHtml(mat.materialCode) + '</span>',
        '  <span class="combobox-item-name">' + escapeHtml(mat.materialName) + '</span>',
        '</li>'
      ].join('');
    }).join('\n');

    self.popoverEl.innerHTML = html;
    self.popoverEl.style.display = 'block';
    self.isOpen = true;
    if (self.inputEl) self.inputEl.setAttribute('aria-expanded', 'true');

    // Attach touch / click listeners
    var items = self.popoverEl.querySelectorAll('.material-combobox-item');
    items.forEach(function (el) {
      el.addEventListener('click', function () {
        var idx = parseInt(el.dataset.index, 10);
        if (!isNaN(idx) && self.candidates[idx]) {
          self.selectCandidate(self.candidates[idx]);
        }
      });
    });
  };

  MaterialCombobox.prototype._onKeyDown = function (e) {
    var self = this;
    if (!self.isOpen) {
      if (e.key === 'ArrowDown' && self.candidates.length > 0) {
        self.popoverEl.style.display = 'block';
        self.isOpen = true;
        e.preventDefault();
      }
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      self.highlightedIndex = Math.min(self.candidates.length - 1, self.highlightedIndex + 1);
      self._updateHighlight();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      self.highlightedIndex = Math.max(0, self.highlightedIndex - 1);
      self._updateHighlight();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (self.highlightedIndex >= 0 && self.candidates[self.highlightedIndex]) {
        self.selectCandidate(self.candidates[self.highlightedIndex]);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      self.closePopover();
    }
  };

  MaterialCombobox.prototype._updateHighlight = function () {
    if (!this.popoverEl) return;
    var items = this.popoverEl.querySelectorAll('.material-combobox-item');
    for (var i = 0; i < items.length; i++) {
      if (i === this.highlightedIndex) {
        items[i].classList.add('is-highlighted');
        items[i].scrollIntoView({ block: 'nearest' });
      } else {
        items[i].classList.remove('is-highlighted');
      }
    }
  };

  MaterialCombobox.prototype.selectCandidate = function (candidate) {
    if (!candidate || !candidate.materialCode) return;
    this.selectedMaterial = {
      materialCode: String(candidate.materialCode).trim(),
      materialName: String(candidate.materialName || '').trim(),
      category: String(candidate.category || '').trim()
    };
    this.closePopover();
    this._renderSelection();
    this.onSelect(this.selectedMaterial);
  };

  MaterialCombobox.prototype._renderSelection = function () {
    if (!this.selectedCardEl || !this.selectedMaterial) return;
    if (this.selectedCodeEl) this.selectedCodeEl.textContent = '資材コード: ' + this.selectedMaterial.materialCode;
    if (this.selectedNameEl) this.selectedNameEl.textContent = this.selectedMaterial.materialName;
    if (this.selectedCardEl && this.selectedCardEl.style) {
      this.selectedCardEl.style.display = 'flex';
    }
    if (this.inputWrapperEl && this.inputWrapperEl.style) {
      this.inputWrapperEl.style.display = 'none';
    }
  };

  MaterialCombobox.prototype.clear = function () {
    this.selectedMaterial = null;
    if (this.inputEl) this.inputEl.value = '';
    if (this.selectedCardEl && this.selectedCardEl.style) {
      this.selectedCardEl.style.display = 'none';
    }
    if (this.inputWrapperEl && this.inputWrapperEl.style) {
      this.inputWrapperEl.style.display = 'flex';
    }
    this.candidates = [];
    this.highlightedIndex = -1;
    this.closePopover();
    this.onClear();
  };

  MaterialCombobox.prototype.closePopover = function () {
    this.isOpen = false;
    if (this.popoverEl && this.popoverEl.style) {
      this.popoverEl.style.display = 'none';
    }
    if (this.inputEl && typeof this.inputEl.setAttribute === 'function') {
      this.inputEl.setAttribute('aria-expanded', 'false');
    }
  };

  MaterialCombobox.prototype.getValue = function () {
    return this.selectedMaterial;
  };

  MaterialCombobox.prototype.clearCache = function () {
    if (this.queryCache) this.queryCache.clear();
    if (this.inFlightRequests) this.inFlightRequests.clear();
    if (this.knownMaterials) this.knownMaterials.clear();
  };

  return MaterialCombobox;
});
