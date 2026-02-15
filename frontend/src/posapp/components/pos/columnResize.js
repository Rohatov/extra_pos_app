/**
 * Column Resize utility for v-data-table-virtual
 * Adds Google Sheets-like column resizing to Vuetify data tables.
 *
 * Fixes:
 *   - Dragging one column does NOT affect other columns (all frozen during resize)
 *   - Column widths persist across Vuetify re-renders (MutationObserver watches thead)
 *   - Double-click a handle to auto-reset that column
 *
 * Usage (Vue Options API mixin):
 *   import { columnResizeMixin } from './columnResize.js';
 *   mixins: [columnResizeMixin('myTableRef', 'myStorageKey')]
 */

const MIN_COL_WIDTH = 30; // px

/**
 * Core class that manages resize handles for a single table element.
 */
class TableColumnResizer {
	constructor(tableEl, storageKey) {
		this.tableEl = tableEl;
		this.storageKey = storageKey;
		this.handles = [];
		this.isResizing = false;
		this._savedWidths = null;
		this._observer = null;
		this._reapplyTimer = null;
		this._onMouseMove = this._onMouseMove.bind(this);
		this._onMouseUp = this._onMouseUp.bind(this);
	}

	// -------- Helpers --------

	_getThs() {
		return Array.from(this.tableEl.querySelectorAll('thead th'));
	}

	/** Are the resize handles still attached to the live DOM? */
	_handlesLost() {
		return (
			this.handles.length === 0 ||
			(this.handles.length > 0 && !this.handles[0].isConnected)
		);
	}

	// -------- Init / Destroy --------

	init() {
		this.destroy();
		const ths = this._getThs();
		if (!ths.length) return;

		// Load saved widths from localStorage
		this._savedWidths = this._loadWidths();

		// Validate saved widths: must match column count
		if (this._savedWidths && this._savedWidths.length !== ths.length) {
			this._savedWidths = null;
			try { localStorage.removeItem(this.storageKey); } catch (_) {}
		}

		if (this._savedWidths) {
			// Saved widths exist — apply them directly
			this._applyAndLockWidths(ths);
		} else {
			// No saved widths — auto-fit to content first, then lock
			this._autoFitThenLock(ths);
		}

		// Attach drag handles
		this._attachHandles(ths);

		// Watch for Vuetify re-rendering the headers (replaces <th> elements)
		this._startObserving();
	}

	destroy() {
		if (this._observer) {
			this._observer.disconnect();
			this._observer = null;
		}
		clearTimeout(this._reapplyTimer);
		this.handles.forEach((h) => {
			try { h.remove(); } catch (_) { /* ignore */ }
		});
		this.handles = [];
		document.removeEventListener('mousemove', this._onMouseMove);
		document.removeEventListener('mouseup', this._onMouseUp);
		document.removeEventListener('touchmove', this._onMouseMove);
		document.removeEventListener('touchend', this._onMouseUp);
	}

	// -------- Width management --------

	/**
	 * Auto-fit columns to content, then lock the resulting widths.
	 * Temporarily uses table-layout:auto so the browser sizes to content,
	 * reads the rendered widths, then switches to fixed and locks them.
	 */
	_autoFitThenLock(ths) {
		// Remove any prior colgroup / inline styles so browser can auto-size
		const existing = this.tableEl.querySelector('colgroup.pos-resize-colgroup');
		if (existing) existing.remove();
		ths.forEach((th) => {
			th.style.width = '';
			th.style.minWidth = '';
			th.style.maxWidth = '';
		});

		// Let the browser auto-size based on content
		this.tableEl.style.setProperty('table-layout', 'auto', 'important');
		this.tableEl.style.setProperty('width', 'auto', 'important');
		this.tableEl.style.setProperty('max-width', 'none', 'important');

		// Force a reflow so the browser calculates auto widths
		void this.tableEl.offsetWidth;

		// Read the auto-calculated widths
		const autoWidths = ths.map((th) => Math.max(th.offsetWidth, MIN_COL_WIDTH));

		// Now switch to fixed layout and lock
		this.tableEl.style.setProperty('table-layout', 'fixed', 'important');
		this._savedWidths = autoWidths;
		this._applyAndLockWidths(ths);
	}

	/**
	 * Apply saved widths (or current widths) and lock each column with
	 * width + minWidth + maxWidth so the browser cannot redistribute.
	 */
	_applyAndLockWidths(ths) {
		ths = ths || this._getThs();
		if (!ths.length) return;

		// Must be fixed layout for explicit widths to work
		this.tableEl.style.setProperty('table-layout', 'fixed', 'important');

		const saved = this._savedWidths;
		const colCount = ths.length;

		// Collect target widths: saved value or current rendered width
		const widths = ths.map((th, idx) => {
			if (saved && idx < saved.length && saved[idx] != null && saved[idx] > 0) {
				return saved[idx];
			}
			return th.offsetWidth || MIN_COL_WIDTH;
		});

		// Lock each column
		ths.forEach((th, idx) => {
			const w = widths[idx];
			th.style.width = w + 'px';
			th.style.minWidth = w + 'px';
			th.style.maxWidth = w + 'px';
		});

		// Match corresponding <td> widths via <col> elements or inline styles
		this._syncTdWidths(widths);

		// Set table width = sum of columns so no redistribution happens
		const totalWidth = widths.reduce((a, b) => a + b, 0);
		const containerWidth = this.tableEl.parentElement?.offsetWidth || 0;
		const tableWidth = Math.max(totalWidth, containerWidth);
		this.tableEl.style.setProperty('width', tableWidth + 'px', 'important');
		this.tableEl.style.setProperty('max-width', 'none', 'important');
	}

	/** Sync td widths using a <colgroup> for consistent column sizing */
	_syncTdWidths(widths) {
		// Remove any existing colgroup we created
		const existing = this.tableEl.querySelector('colgroup.pos-resize-colgroup');
		if (existing) existing.remove();

		const colgroup = document.createElement('colgroup');
		colgroup.className = 'pos-resize-colgroup';
		widths.forEach((w) => {
			const col = document.createElement('col');
			col.style.width = w + 'px';
			col.style.minWidth = w + 'px';
			col.style.maxWidth = w + 'px';
			colgroup.appendChild(col);
		});
		this.tableEl.prepend(colgroup);
	}

	// -------- Handles --------

	_attachHandles(ths) {
		ths.forEach((th, idx) => {
			const handle = document.createElement('div');
			handle.className = 'col-resize-handle';
			handle.addEventListener('mousedown', (e) => this._onMouseDown(e, th, idx));
			handle.addEventListener('touchstart', (e) => this._onTouchStart(e, th, idx), {
				passive: false,
			});
			handle.addEventListener('dblclick', (e) => this._onDoubleClick(e, th, idx));
			th.style.position = 'relative';
			th.appendChild(handle);
			this.handles.push(handle);
		});
	}

	// -------- MutationObserver --------

	_startObserving() {
		const thead = this.tableEl.querySelector('thead');
		if (!thead) return;

		this._observer = new MutationObserver(() => {
			if (this.isResizing) return; // never interfere during active drag
			clearTimeout(this._reapplyTimer);
			this._reapplyTimer = setTimeout(() => this._onHeaderMutated(), 30);
		});

		this._observer.observe(thead, { childList: true, subtree: true });
	}

	/** Called when Vuetify replaces <th> elements (e.g. after clicking an item) */
	_onHeaderMutated() {
		if (!this._handlesLost()) return; // handles still present, nothing to do
		const ths = this._getThs();
		if (!ths.length) return;

		// Clean up stale handle references
		this.handles = [];

		// Re-apply saved widths and re-attach handles
		if (this._savedWidths && this._savedWidths.length === ths.length) {
			this._applyAndLockWidths(ths);
		} else {
			this._autoFitThenLock(ths);
		}
		this._attachHandles(ths);
	}

	// -------- Mouse / Touch events --------

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

		// Ensure fixed layout so explicit widths are honoured
		this.tableEl.style.setProperty('table-layout', 'fixed', 'important');

		// Freeze ALL columns at current rendered widths
		const ths = this._getThs();
		this._frozenWidths = ths.map((t) => t.offsetWidth);
		ths.forEach((t, i) => {
			const w = this._frozenWidths[i];
			t.style.width = w + 'px';
			t.style.minWidth = w + 'px';
			t.style.maxWidth = w + 'px';
		});

		// Pin table width = exact sum of frozen columns
		const totalWidth = this._frozenWidths.reduce((a, b) => a + b, 0);
		this.tableEl.style.setProperty('width', totalWidth + 'px', 'important');

		document.body.style.cursor = 'col-resize';
		document.body.style.userSelect = 'none';
		th.classList.add('col-resizing');
	}

	_onMouseMove(e) {
		if (!this.isResizing) return;
		e.preventDefault();
		const pageX = e.pageX ?? e.touches?.[0]?.pageX ?? 0;
		const diff = pageX - this._startX;
		const newWidth = Math.max(MIN_COL_WIDTH, this._startWidth + diff);

		// Only change the target column
		this._currentTh.style.width = newWidth + 'px';
		this._currentTh.style.minWidth = newWidth + 'px';
		this._currentTh.style.maxWidth = newWidth + 'px';

		// Update <col> element for this column too
		const colgroup = this.tableEl.querySelector('colgroup.pos-resize-colgroup');
		if (colgroup) {
			const col = colgroup.children[this._currentIdx];
			if (col) {
				col.style.width = newWidth + 'px';
				col.style.minWidth = newWidth + 'px';
				col.style.maxWidth = newWidth + 'px';
			}
		}

		// Update table width = frozen total ± delta
		const widthDelta = newWidth - this._frozenWidths[this._currentIdx];
		const frozenTotal = this._frozenWidths.reduce((a, b) => a + b, 0);
		this.tableEl.style.setProperty('width', (frozenTotal + widthDelta) + 'px', 'important');
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

		// Re-sync colgroup and td widths after save
		if (this._savedWidths) {
			this._syncTdWidths(this._savedWidths);
		}
	}

	_onDoubleClick(e, th, idx) {
		e.preventDefault();
		e.stopPropagation();
		// Auto-fit this column to its content width
		// Temporarily unlock, measure, then re-lock
		th.style.width = '';
		th.style.minWidth = '';
		th.style.maxWidth = '';
		const colgroup = this.tableEl.querySelector('colgroup.pos-resize-colgroup');
		if (colgroup && colgroup.children[idx]) {
			colgroup.children[idx].style.width = '';
			colgroup.children[idx].style.minWidth = '';
			colgroup.children[idx].style.maxWidth = '';
		}
		this.tableEl.style.setProperty('table-layout', 'auto', 'important');
		void this.tableEl.offsetWidth; // reflow
		const autoWidth = Math.max(th.offsetWidth, MIN_COL_WIDTH);
		this.tableEl.style.setProperty('table-layout', 'fixed', 'important');

		th.style.width = autoWidth + 'px';
		th.style.minWidth = autoWidth + 'px';
		th.style.maxWidth = autoWidth + 'px';
		if (colgroup && colgroup.children[idx]) {
			colgroup.children[idx].style.width = autoWidth + 'px';
			colgroup.children[idx].style.minWidth = autoWidth + 'px';
			colgroup.children[idx].style.maxWidth = autoWidth + 'px';
		}

		this._saveWidths();
	}

	// -------- Persistence --------

	_saveWidths() {
		if (!this.storageKey) return;
		const ths = this._getThs();
		const widths = ths.map((th) => th.offsetWidth);
		this._savedWidths = widths;
		try {
			localStorage.setItem(this.storageKey, JSON.stringify(widths));
		} catch (_) {
			// ignore quota errors
		}
	}

	_loadWidths() {
		if (!this.storageKey) return null;
		try {
			const raw = localStorage.getItem(this.storageKey);
			return raw ? JSON.parse(raw) : null;
		} catch (_) {
			return null;
		}
	}
}

/**
 * Returns a localStorage key prefixed with the current user.
 * @param {string} key – base key name
 * @returns {string}
 */
export function userKey(key) {
	const user = (typeof frappe !== 'undefined' && frappe.session?.user) || 'Guest';
	return user + ':' + key;
}

/**
 * Returns a Vue Options-API mixin that wires up column resizing.
 *
 * @param {string} tableRefName   – the ref="..." name on the table component
 * @param {string} storageKey     – localStorage key for persisting widths
 * @param {Function} [getTableEl] – optional fn(vm) returning raw <table> element
 */
export function columnResizeMixin(tableRefName, storageKey, getTableEl) {
	let resizer = null;
	const prefixedKey = userKey(storageKey);

	const findTable = (vm) => {
		if (getTableEl) return getTableEl(vm);
		const refEl = vm.$refs[tableRefName];
		if (!refEl) return null;
		const el = refEl.$el || refEl;
		return el.querySelector('table') || el;
	};

	const setup = (vm) => {
		const tableEl = findTable(vm);
		if (!tableEl) return;
		if (!tableEl.querySelector('thead th')) return;
		// If resizer exists but its table element was replaced, destroy it
		if (resizer && resizer.tableEl !== tableEl) {
			resizer.destroy();
			resizer = null;
		}
		// If resizer already exists and handles are fine, do nothing
		if (resizer && !resizer._handlesLost()) return;
		if (resizer) resizer.destroy();
		resizer = new TableColumnResizer(tableEl, prefixedKey);
		resizer.init();
	};

	return {
		mounted() {
			this.$nextTick(() => setup(this));
		},
		updated() {
			// MutationObserver handles most re-renders, but as a safety net
			// we also check in updated() for cases where the table element
			// itself was replaced (e.g. v-if toggle).
			this.$nextTick(() => {
				if (resizer && !resizer._handlesLost()) return;
				setup(this);
			});
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
 * CSS injected once for resize handles.
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
