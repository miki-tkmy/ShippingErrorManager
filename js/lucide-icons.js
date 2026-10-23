/**
 * =============================================================================
 * ShippingErrorManager - Local Lucide Icons Bundle (SVG Provider)
 * =============================================================================
 * Phase: UI-REVIEW-002
 *
 * Provides locally bundled Lucide icons (pure SVG) without external CDN dependency.
 * Fully compatible with strict Content-Security-Policy (CSP).
 *
 * Supported icons:
 *   - FilePlus2
 *   - ClipboardList
 *   - UserRound
 *   - CalendarDays
 *   - Truck
 *   - PackageSearch
 *   - CircleCheck
 *   - CircleX
 *   - TriangleAlert
 *   - Info
 *   - LoaderCircle
 *   - RefreshCw
 *   - Plus
 *   - Trash2
 *   - X
 *   - ChevronDown
 *   - Search
 * =============================================================================
 */

(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else {
    var exports = factory();
    root.LucideIcons = exports;
    root.getLucideIcon = exports.getLucideIcon;
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var ICON_PATHS = {
    FilePlus2: '<path d="M4 22h14a2 2 0 0 0 2-2V7l-5-5H6a2 2 0 0 0-2 2v4"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M3 15h6"/><path d="M6 12v6"/>',
    ClipboardList: '<path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/><path d="M12 11h4"/><path d="M12 16h4"/><circle cx="8" cy="11" r="1"/><circle cx="8" cy="16" r="1"/>',
    UserRound: '<circle cx="12" cy="8" r="5"/><path d="M20 21a8 8 0 0 0-16 0"/>',
    CalendarDays: '<rect width="18" height="18" x="3" y="4" rx="2"/><line x1="16" x2="16" y1="2" y2="6"/><line x1="8" x2="8" y1="2" y2="6"/><line x1="3" x2="21" y1="10" y2="10"/><path d="M8 14h.01"/><path d="M12 14h.01"/><path d="M16 14h.01"/><path d="M8 18h.01"/><path d="M12 18h.01"/><path d="M16 18h.01"/>',
    Truck: '<path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><path d="M15 18H9"/><path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14"/><circle cx="17" cy="18.5" r="2.5"/><circle cx="7" cy="18.5" r="2.5"/>',
    PackageSearch: '<path d="M21 10V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l2-1.14"/><path d="m7.5 4.27 9 5.15"/><polyline points="3.29 7 12 12 20.71 7"/><line x1="12" x2="12" y1="22" y2="12"/><circle cx="18.5" cy="15.5" r="2.5"/><path d="M20.27 17.27 22 19"/>',
    CircleCheck: '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
    CircleX: '<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/>',
    TriangleAlert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" x2="12" y1="9" y2="13"/><line x1="12" x2="12.01" y1="17" y2="17"/>',
    Info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
    LoaderCircle: '<path d="M21 12a9 9 0 1 1-6.219-8.56"/>',
    RefreshCw: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
    Plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
    Trash2: '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/>',
    X: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    ChevronDown: '<path d="m6 9 6 6 6-6"/>',
    Search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>'
  };

  /**
   * Generates inline SVG markup for a requested Lucide icon.
   *
   * @param {string} name Icon name (e.g. 'CircleCheck', 'Search')
   * @param {Object} [options]
   * @param {number} [options.size=20] Icon width & height in px
   * @param {number} [options.strokeWidth=2] SVG stroke-width
   * @param {string} [options.className=''] CSS class names
   * @param {string} [options.ariaLabel=''] Accessible label (if provided, sets role="img" and aria-label)
   * @param {boolean} [options.ariaHidden=true] Whether to set aria-hidden="true" (default if no ariaLabel)
   * @return {string} SVG HTML markup
   */
  function getLucideIcon(name, options) {
    var opts = options || {};
    var inner = ICON_PATHS[name];
    if (!inner) {
      console.warn('Unknown Lucide icon name: ' + name);
      return '';
    }

    var size = typeof opts.size === 'number' ? opts.size : 20;
    var strokeWidth = typeof opts.strokeWidth === 'number' ? opts.strokeWidth : 2;
    var className = opts.className ? ' class="lucide-icon ' + opts.className + '"' : ' class="lucide-icon"';

    var ariaAttrs = '';
    if (opts.ariaLabel) {
      ariaAttrs = ' role="img" aria-label="' + opts.ariaLabel.replace(/"/g, '&quot;') + '"';
    } else if (opts.ariaHidden !== false) {
      ariaAttrs = ' aria-hidden="true"';
    }

    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="' + strokeWidth + '" stroke-linecap="round" stroke-linejoin="round"' + className + ariaAttrs + '>' + inner + '</svg>';
  }

  return {
    getLucideIcon: getLucideIcon,
    ICON_NAMES: Object.keys(ICON_PATHS)
  };
});
