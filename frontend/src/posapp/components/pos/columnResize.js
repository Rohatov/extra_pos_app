/**
 * Column Resize utility for v-data-table-virtual
 * Adds Google Sheets-like column resizing to Vuetify data tables.
 *
 * Usage (Vue Options API mixin):
 *   import { columnResizeMixin } from './columnResize.js';
 *   mixins: [columnResizeMixin('myTableRef', 'myStorageKey')]
 *
 * The mixin will:
 *   - Add drag handles to every <th> in the table
 *   - Persist widths to localStorage under the given key
 *   - Restore widths on mount
 */

const MIN_COL_WIDTH = 40; // px

/**
 * Core class that manages resize handles for a single table element.
 */
class TableColumnResizer {
	constructor(tableEl, storageKey) {
		this.tableEl = tableEl;
		this.storageKey = storageKey;
		this.handles = [];
		this.isResizing = false;
		this._onMouseMove = this._onMouseMove.bind(this);
		this._onMouseUp = this._onMouseUp.bind(this);
		this._lastThCount = 0;
	}

	/** Check if handles need re-init (column count changed or handles were lost) */
	needsReinit() {
		const ths = this.tableEl.querySelectorAll('thead th');
		if (ths.length !== this._lastThCount || this.handles.length === 0) return true;
		// Also check if handles are still in the DOM (Vuetify may re-render headers)
		if (this.handles.length > 0 && !this.handles[0].parentElement) return true;
		return false;
	}

	/** Attach resize handles to every <th> */
	init() {
		this.destroy(); // clean up previous handles
		const ths = this.tableEl.querySelectorAll('thead th');
		if (!ths.length) return;
		this._lastThCount = ths.length;

		// Restore saved widths
		const saved = this._loadWidths();

		ths.forEach((th, idx) => {
			// Apply saved width
			if (saved && saved[idx] != null) {
				th.style.width = saved[idx] + 'px';
				th.style.minWidth = saved[idx] + 'px';
			}

			// Create handle element
			const handle = document.createElement('div');
			handle.className = 'col-resize-handle';
			handle.addEventListener('mousedown', (e) => this._onMouseDown(e, th, idx));
			handle.addEventListener('touchstart', (e) => this._onTouchStart(e, th, idx), { passive: false });
			handle.addEventListener('dblclick', (e) => this._onDoubleClick(e, th, idx));
			th.style.position = 'relative';
			th.appendChild(handle);
			this.handles.push(handle);
		});
	}

	/** Remove all handles and listeners */
	destroy() {
		this.handles.forEach((h) => h.remove());
		this.handles = [];
		document.removeEventListener('mousemove', this._onMouseMove);
		document.removeEventListener('mouseup', this._onMouseUp);
		document.removeEventListener('touchmove', this._onMouseMove);
		document.removeEventListener('touchend', this._onMouseUp);
	}

	// -------- Mouse events --------

	_onMouseDown(e, th, idx) {
		e.preventDefault();
		e.stopPropagation();
		this._startResize(e.pageX, th, idx);
		document.addEventListener('mousemove', this._onMouseMove);
		document.addEventListener('mouseup', this._onMouseUp);
	}

	_onTouchStart(e, th, idx) {
		e.preventDefault();
		e.stopPropagation();
		const touch = e.touches[0];
		this._startResize(touch.pageX, th, idx);
		document.addEventListener('touchmove', this._onMouseMove, { passive: false });
		document.addEventListener('touchend', this._onMouseUp);
	}

	_startResize(pageX, th, idx) {
		this.isResizing = true;
		this._startX = pageX;
		this._startWidth = th.offsetWidth;
		this._currentTh = th;
		this._currentIdx = idx;
		document.body.style.cursor = 'col-resize';
		document.body.style.userSelect = 'none';
		// Add visual feedback
		th.classList.add('col-resizing');
	}

	_onMouseMove(e) {
		if (!this.isResizing) return;
		e.preventDefault();
		const pageX = e.pageX ?? e.touches?.[0]?.pageX ?? 0;
		const diff = pageX - this._startX;
		const newWidth = Math.max(MIN_COL_WIDTH, this._startWidth + diff);
		this._currentTh.style.width = newWidth + 'px';
		this._currentTh.style.minWidth = newWidth + 'px';
	}

	_onMouseUp() {
		if (!this.isResizing) return;
		this.isResizing = false;
		document.body.style.cursor = '';
		document.body.style.userSelect = '';
		if (this._currentTh) {
			this._currentTh.classList.remove('col-resizing');
		}
		document.removeEventListener('mousemove', this._onMouseMove);
		document.removeEventListener('mouseup', this._onMouseUp);
		document.removeEventListener('touchmove', this._onMouseMove);
		document.removeEventListener('touchend', this._onMouseUp);
		this._saveWidths();
	}

	_onDoubleClick(e, th, idx) {
		// Double-click auto-fits column (reset to auto)
		e.preventDefault();
		e.stopPropagation();
		th.style.width = '';
		th.style.minWidth = '';
		this._saveWidths();
	}

	// -------- Persistence --------

	_saveWidths() {
		if (!this.storageKey) return;
		const ths = this.tableEl.querySelectorAll('thead th');
		const widths = Array.from(ths).map((th) => th.offsetWidth);
		try {
			localStorage.setItem(this.storageKey, JSON.stringify(widths));
		} catch (e) {
			// ignore quota errors
		}
	}

	_loadWidths() {
		if (!this.storageKey) return null;
		try {
			const raw = localStorage.getItem(this.storageKey);
			return raw ? JSON.parse(raw) : null;
		} catch (e) {
			return null;
		}
	}
}

/**
 * Returns a Vue Options-API mixin that wires up column resizing for the
 * `v-data-table-virtual` reachable via the given ref name.
 *
 * @param {string} tableRefName   – the ref="..." name on the component / wrapper
 * @param {string} storageKey     – localStorage key for persisting widths
 * @param {Function} [getTableEl] – optional function(component) returning the
 *                                   raw <table> DOM element; default walks the
 *                                   ref's $el.
 */
export function columnResizeMixin(tableRefName, storageKey, getTableEl) {
	let resizer = null;

	const findTable = (vm) => {
		if (getTableEl) return getTableEl(vm);
		const refEl = vm.$refs[tableRefName];
		if (!refEl) return null;
		const el = refEl.$el || refEl;
		return el.querySelector('table') || el;
	};

	const setup = (vm, force) => {
		const tableEl = findTable(vm);
		if (!tableEl) return;
		// Only init if table has rendered headers
		if (!tableEl.querySelector('thead th')) return;
		// Skip re-init if column count hasn't changed (unless forced)
		if (!force && resizer && !resizer.needsReinit()) return;
		if (resizer) resizer.destroy();
		resizer = new TableColumnResizer(tableEl, storageKey);
		resizer.init();
	};

	return {
		mounted() {
			this.$nextTick(() => setup(this, true));
		},
		updated() {
			// Only re-attach if column count changed (e.g. column visibility toggle)
			this.$nextTick(() => setup(this, false));
		},
		beforeUnmount() {
			if (resizer) {
				resizer.destroy();
				resizer = null;
			}
		},
	};
}

/**
 * CSS that should be injected once (or included in a global stylesheet).
 * We inject it programmatically so consumers don't need a separate import.
 */
const STYLE_ID = 'pos-col-resize-styles';

function ensureStyles() {
	if (document.getElementById(STYLE_ID)) return;
	const style = document.createElement('style');
	style.id = STYLE_ID;
	style.textContent = `
/* Column resize handle */
.col-resize-handle {
	position: absolute;
	right: -3px;
	top: 0;
	bottom: 0;
	width: 7px;
	cursor: col-resize;
	z-index: 20;
	background: transparent;
	transition: background 0.15s ease;
	touch-action: none;
}
.col-resize-handle:hover,
.col-resizing .col-resize-handle {
	background: rgba(25, 118, 210, 0.35);
}
.col-resize-handle::after {
	content: '';
	position: absolute;
	right: 3px;
	top: 20%;
	bottom: 20%;
	width: 2px;
	border-radius: 1px;
	background: rgba(25, 118, 210, 0.3);
	transition: background 0.15s ease;
}
.col-resize-handle:hover::after,
.col-resizing .col-resize-handle::after {
	background: rgb(25, 118, 210);
}
th.col-resizing {
	background: rgba(25, 118, 210, 0.08) !important;
}
`;
	document.head.appendChild(style);
}

// Inject styles on import
ensureStyles();

export default TableColumnResizer;
