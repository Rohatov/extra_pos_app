import {
	persist,
	checkDbHealth,
	terminatePersistWorker,
	initPersistWorker,
	isElectron,
} from "./core.js";
import { clearPriceListCache } from "./items.js";

const CACHE_STRUCTURE = {
	items: ["item_code", "item_name", "item_group", "barcodes", "serials", "batches"],
	item_prices: ["price_list", "item_code", "price_list_rate", "timestamp"],
	customers: ["name", "customer_name", "mobile_no", "email_id", "tax_id", "customer_group"],
	local_stock: ["key", "value"],
	coupons: ["code", "valid_from", "valid_upto"],
	item_groups: ["name", "parent_item_group"],
	translations: ["key", "language"],
	pricing_rules: ["snapshot", "context", "stale_at"],
	draft_invoices: ["name", "customer", "customer_name", "grand_total", "posting_date"],
};

function hashStructure(structure) {
	const json = JSON.stringify(structure);
	let hash = 0;
	for (let i = 0; i < json.length; i++) {
		const chr = json.charCodeAt(i);
		hash = (hash << 5) - hash + chr;
		hash |= 0; // Convert to 32bit integer
	}
	return Math.abs(hash);
}

function computeCacheVersion() {
	const structureHash = hashStructure(CACHE_STRUCTURE);
	if (typeof localStorage === "undefined") {
		return structureHash;
	}

	const storedHash = localStorage.getItem("posa_cache_structure_hash");
	const storedVersion = parseInt(localStorage.getItem("posa_cache_version") || "1", 10) || 1;

	if (!storedHash || storedHash !== String(structureHash)) {
		const nextVersion = storedVersion + 1;
		localStorage.setItem("posa_cache_structure_hash", String(structureHash));
		localStorage.setItem("posa_cache_version", String(nextVersion));
		return nextVersion;
	}

	return storedVersion;
}

// Increment this number whenever the cache data structure changes
export const CACHE_VERSION = computeCacheVersion();

export const MAX_QUEUE_ITEMS = 1000;

let cacheUsageEstimatePromise = null;

// Memory cache object
export const memory = {
	offline_invoices: [],
	offline_customers: [],
	offline_payments: [],
	draft_invoices: [],
	pos_last_sync_totals: { pending: 0, synced: 0, drafted: 0 },
	uom_cache: {},
	offers_cache: [],
	customer_balance_cache: {},
	local_stock_cache: {},
	stock_cache_ready: false,
	customer_storage: [],
	pos_opening_storage: null,
	opening_dialog_storage: null,
	sales_persons_storage: [],
	item_details_cache: {},
	tax_template_cache: {},
	translation_cache: {},
	coupons_cache: {},
	item_groups_cache: [],
	price_list_names: [],
	pricing_rules_snapshot: [],
	pricing_rules_context: null,
	pricing_rules_last_sync: null,
	pricing_rules_stale_at: null,
	items_last_sync: null,
	customers_last_sync: null,
	// Track the current cache schema version
	cache_version: CACHE_VERSION,
	cache_ready: false,
	tax_inclusive: false,
	manual_offline: false,
	print_template: "",
	terms_and_conditions: "",
};

// Initialize memory from localStorage and expose a promise for consumers
export const memoryInitPromise = (async () => {
	try {
		for (const key of Object.keys(memory)) {
			if (typeof localStorage !== "undefined") {
				const ls = localStorage.getItem(`posa_${key}`);
				if (ls) {
					try {
						memory[key] = JSON.parse(ls);
					} catch (err) {
						console.error("Failed to parse localStorage for", key, err);
					}
				}
			}
		}

		// Verify cache version and clear outdated caches
		let storedVersion = null;
		if (typeof localStorage !== "undefined") {
			const v = localStorage.getItem("posa_cache_version");
			if (v) storedVersion = parseInt(v, 10);
		}
		if (storedVersion !== CACHE_VERSION) {
			await forceClearAllCache();
			memory.cache_version = CACHE_VERSION;
			if (typeof localStorage !== "undefined") {
				localStorage.setItem("posa_cache_version", String(CACHE_VERSION));
			}
			persist("cache_version", CACHE_VERSION);
		} else {
			memory.cache_version = storedVersion || CACHE_VERSION;
		}
		// Mark caches initialized
		memory.cache_ready = true;
		persist("cache_ready", true);

		// In Electron mode, register sync-completed listener to refresh data
		if (isElectron() && window.posAPI.onSyncCompleted) {
			window.posAPI.onSyncCompleted((result) => {
				console.log("[sync] Background sync completed:", result);
				// Invalidate memory items cache so next load fetches fresh from SQLite
				_storedItems.length = 0;
				_storedCustomers.length = 0;
			});
		}
	} catch (e) {
		console.error("Failed to initialize memory from storage", e);
	}
})();

// Reset cached invoices and customers after syncing
export function resetOfflineState() {
	memory.offline_invoices = [];
	memory.offline_customers = [];
	memory.offline_payments = [];
	memory.pos_last_sync_totals = { pending: 0, synced: 0, drafted: 0 };

	persist("offline_invoices", memory.offline_invoices);
	persist("offline_customers", memory.offline_customers);
	persist("offline_payments", memory.offline_payments);
	persist("pos_last_sync_totals", memory.pos_last_sync_totals);
}

export function reduceCacheUsage() {
	clearPriceListCache();
	memory.item_details_cache = {};
	memory.uom_cache = {};
	memory.offers_cache = [];
	memory.customer_balance_cache = {};
	memory.local_stock_cache = {};
	memory.stock_cache_ready = false;
	memory.coupons_cache = {};
	memory.item_groups_cache = [];
	persist("item_details_cache", memory.item_details_cache);
	persist("uom_cache", memory.uom_cache);
	persist("offers_cache", memory.offers_cache);
	persist("customer_balance_cache", memory.customer_balance_cache);
	persist("local_stock_cache", memory.local_stock_cache);
	persist("stock_cache_ready", memory.stock_cache_ready);
	persist("coupons_cache", memory.coupons_cache);
	persist("item_groups_cache", memory.item_groups_cache);
}

function sanitiseSnapshot(snapshot = []) {
	if (!Array.isArray(snapshot)) {
		return [];
	}
	try {
		return JSON.parse(JSON.stringify(snapshot));
	} catch (error) {
		console.error("Failed to sanitise pricing rules snapshot", error);
		return [];
	}
}

export function savePricingRulesSnapshot(snapshot = [], context = null, staleAt = null) {
	memory.pricing_rules_snapshot = sanitiseSnapshot(snapshot);
	memory.pricing_rules_context = context || null;
	memory.pricing_rules_last_sync = new Date().toISOString();
	memory.pricing_rules_stale_at = staleAt || null;

	persist("pricing_rules_snapshot", memory.pricing_rules_snapshot);
	persist("pricing_rules_context", memory.pricing_rules_context);
	persist("pricing_rules_last_sync", memory.pricing_rules_last_sync);
	persist("pricing_rules_stale_at", memory.pricing_rules_stale_at);
}

export function getCachedPricingRulesSnapshot() {
	return {
		snapshot: Array.isArray(memory.pricing_rules_snapshot) ? memory.pricing_rules_snapshot : [],
		context: memory.pricing_rules_context || null,
		lastSync: memory.pricing_rules_last_sync || null,
		staleAt: memory.pricing_rules_stale_at || null,
	};
}

export function clearPricingRulesSnapshot() {
	memory.pricing_rules_snapshot = [];
	memory.pricing_rules_context = null;
	memory.pricing_rules_last_sync = null;
	memory.pricing_rules_stale_at = null;

	persist("pricing_rules_snapshot", memory.pricing_rules_snapshot);
	persist("pricing_rules_context", memory.pricing_rules_context);
	persist("pricing_rules_last_sync", memory.pricing_rules_last_sync);
	persist("pricing_rules_stale_at", memory.pricing_rules_stale_at);
}

// --- Generic getters and setters for cached data ----------------------------
// In web mode these use in-memory arrays. The Adapter layer will replace
// these with Electron IPC calls when running in native mode.

const _storedItems = [];

export async function getStoredItems() {
	if (isElectron()) {
		return window.posAPI.getItems({ limit: 50000 });
	}
	return _storedItems;
}

export async function getStoredItemsCount() {
	if (isElectron()) {
		return window.posAPI.getItemsCount();
	}
	return _storedItems.length;
}

export async function saveItems(items) {
	if (isElectron()) {
		try {
			await window.posAPI.saveItemsBulk(items);
		} catch (e) {
			console.error("Failed to save items to SQLite", e);
		}
		return;
	}
	try {
		const clean = JSON.parse(JSON.stringify(items));
		_storedItems.length = 0;
		_storedItems.push(...clean);
	} catch (e) {
		console.error("Failed to save items", e);
	}
}

export async function clearStoredItems() {
	if (isElectron()) {
		try {
			await window.posAPI.clearAllItems();
		} catch (e) {
			console.error("Failed to clear items in SQLite", e);
		}
		return;
	}
	_storedItems.length = 0;
}

const _storedCustomers = [];

export async function getCustomerStorage(limit = Infinity, offset = 0) {
	if (isElectron()) {
		const opts = {};
		if (Number.isFinite(limit) && limit < Infinity) {
			opts.limit = limit;
		} else {
			opts.limit = 100000;
		}
		if (offset > 0) opts.offset = offset;
		return window.posAPI.getCustomers(opts);
	}
	return _storedCustomers.slice(offset, offset + limit);
}

export async function setCustomerStorage(customers) {
	if (isElectron()) {
		try {
			await window.posAPI.saveCustomers(customers);
		} catch (e) {
			console.error("Failed to save customers to SQLite", e);
		}
		return;
	}
	try {
		const clean = customers.map((c) => ({
			name: c.name,
			customer_name: c.customer_name,
			mobile_no: c.mobile_no,
			email_id: c.email_id,
			primary_address: c.primary_address,
			tax_id: c.tax_id,
			customer_group: c.customer_group,
		}));
		_storedCustomers.length = 0;
		_storedCustomers.push(...clean);
	} catch (e) {
		console.error("Failed to set customer storage", e);
	}
}

export async function getCustomerStorageCount() {
	if (isElectron()) {
		return window.posAPI.getCustomersCount();
	}
	return _storedCustomers.length;
}

export async function clearCustomerStorage() {
	if (isElectron()) {
		try {
			await window.posAPI.clearAllCustomers();
		} catch (e) {
			console.error("Failed to clear customers in SQLite", e);
		}
		return;
	}
	_storedCustomers.length = 0;
}

export function getItemsLastSync() {
	return memory.items_last_sync || null;
}

export function setItemsLastSync(ts) {
	memory.items_last_sync = ts;
	persist("items_last_sync", memory.items_last_sync);
}

export function getCustomersLastSync() {
	return memory.customers_last_sync || null;
}

export function setCustomersLastSync(ts) {
	memory.customers_last_sync = ts;
	persist("customers_last_sync", memory.customers_last_sync);
}

export function getSalesPersonsStorage() {
	return memory.sales_persons_storage || [];
}

export function setSalesPersonsStorage(data) {
	try {
		let clean;
		try {
			clean = JSON.parse(JSON.stringify(data));
		} catch (err) {
			console.error("Failed to serialize sales persons", err);
			clean = [];
		}
		memory.sales_persons_storage = clean;
		persist("sales_persons_storage", memory.sales_persons_storage);
	} catch (e) {
		console.error("Failed to set sales persons storage", e);
	}
}

export function getOpeningStorage() {
	return memory.pos_opening_storage || null;
}

export function setOpeningStorage(data) {
	try {
		let clean;
		try {
			clean = JSON.parse(JSON.stringify(data));
		} catch (err) {
			console.error("Failed to serialize opening storage", err);
			clean = {};
		}
		memory.pos_opening_storage = clean;
		persist("pos_opening_storage", memory.pos_opening_storage);
	} catch (e) {
		console.error("Failed to set opening storage", e);
	}
}

export function clearOpeningStorage() {
	try {
		memory.pos_opening_storage = null;
		persist("pos_opening_storage", memory.pos_opening_storage);
	} catch (e) {
		console.error("Failed to clear opening storage", e);
	}
}

export function getOpeningDialogStorage() {
	return memory.opening_dialog_storage || null;
}

export function setOpeningDialogStorage(data) {
	try {
		let clean;
		try {
			clean = JSON.parse(JSON.stringify(data));
		} catch (err) {
			console.error("Failed to serialize opening dialog", err);
			clean = {};
		}
		memory.opening_dialog_storage = clean;
		persist("opening_dialog_storage", memory.opening_dialog_storage);
	} catch (e) {
		console.error("Failed to set opening dialog storage", e);
	}
}

export function getTaxTemplate(name) {
	try {
		const cache = memory.tax_template_cache || {};
		return cache[name] || null;
	} catch (e) {
		console.error("Failed to get cached tax template", e);
		return null;
	}
}

export function setTaxTemplate(name, doc) {
	try {
		const cache = memory.tax_template_cache || {};
		let cleanDoc;
		try {
			cleanDoc = JSON.parse(JSON.stringify(doc));
		} catch (err) {
			console.error("Failed to serialize tax template", err);
			cleanDoc = doc ? { ...doc } : {};
		}
		cache[name] = cleanDoc;
		memory.tax_template_cache = cache;
		persist("tax_template_cache", memory.tax_template_cache);
	} catch (e) {
		console.error("Failed to cache tax template", e);
	}
}

export function getPrintTemplate() {
	try {
		return memory.print_template || "";
	} catch (e) {
		console.error("Failed to get print template", e);
		return "";
	}
}

export function setPrintTemplate(template) {
	try {
		memory.print_template = template || "";
		persist("print_template", memory.print_template);
	} catch (e) {
		console.error("Failed to set print template", e);
	}
}

export function getTermsAndConditions() {
	try {
		return memory.terms_and_conditions || "";
	} catch (e) {
		console.error("Failed to get terms and conditions", e);
		return "";
	}
}

export function setTermsAndConditions(terms) {
	try {
		memory.terms_and_conditions = terms || "";
		persist("terms_and_conditions", memory.terms_and_conditions);
	} catch (e) {
		console.error("Failed to set terms and conditions", e);
	}
}

export function getTranslationsCache(lang) {
	try {
		const cache = memory.translation_cache || {};
		return cache[lang] || null;
	} catch (e) {
		console.error("Failed to get cached translations", e);
		return null;
	}
}

export function saveTranslationsCache(lang, data) {
	try {
		const cache = memory.translation_cache || {};
		cache[lang] = data;
		memory.translation_cache = cache;
		persist("translation_cache", memory.translation_cache);
	} catch (e) {
		console.error("Failed to cache translations", e);
	}
}

export function setLastSyncTotals(totals) {
	memory.pos_last_sync_totals = totals;
	persist("pos_last_sync_totals", memory.pos_last_sync_totals);
}

export function getLastSyncTotals() {
	return memory.pos_last_sync_totals;
}

export function getTaxInclusiveSetting() {
	return !!memory.tax_inclusive;
}

export function setTaxInclusiveSetting(value) {
	memory.tax_inclusive = !!value;
	persist("tax_inclusive", memory.tax_inclusive);
}

export function isCacheReady() {
	return !!memory.cache_ready;
}

export function isManualOffline() {
	return memory.manual_offline || false;
}

export function setManualOffline(state) {
	memory.manual_offline = !!state;
	persist("manual_offline", memory.manual_offline);
}

export function toggleManualOffline() {
	setManualOffline(!memory.manual_offline);
}

export function queueHealthCheck(limit = MAX_QUEUE_ITEMS) {
	const inv = (memory.offline_invoices || []).length > limit;
	const cus = (memory.offline_customers || []).length > limit;
	const pay = (memory.offline_payments || []).length > limit;
	return inv || cus || pay;
}

export function purgeOldQueueEntries(limit = MAX_QUEUE_ITEMS) {
	if (Array.isArray(memory.offline_invoices) && memory.offline_invoices.length > limit) {
		memory.offline_invoices.splice(0, memory.offline_invoices.length - limit);
		persist("offline_invoices", memory.offline_invoices);
	}
	if (Array.isArray(memory.offline_customers) && memory.offline_customers.length > limit) {
		memory.offline_customers.splice(0, memory.offline_customers.length - limit);
		persist("offline_customers", memory.offline_customers);
	}
	if (Array.isArray(memory.offline_payments) && memory.offline_payments.length > limit) {
		memory.offline_payments.splice(0, memory.offline_payments.length - limit);
		persist("offline_payments", memory.offline_payments);
	}
}

export async function clearAllCache() {
	if (typeof localStorage !== "undefined") {
		Object.keys(localStorage).forEach((key) => {
			if (key.startsWith("posa_")) {
				localStorage.removeItem(key);
			}
		});
	}

	memory.offline_invoices = [];
	memory.offline_customers = [];
	memory.offline_payments = [];
	memory.pos_last_sync_totals = { pending: 0, synced: 0, drafted: 0 };
	memory.uom_cache = {};
	memory.offers_cache = [];
	memory.coupons_cache = {};
	memory.customer_balance_cache = {};
	memory.local_stock_cache = {};
	memory.stock_cache_ready = false;
	memory.customer_storage = [];
	memory.items_last_sync = null;
	memory.customers_last_sync = null;
	memory.pos_opening_storage = null;
	memory.opening_dialog_storage = null;
	memory.sales_persons_storage = [];
	memory.item_details_cache = {};
	memory.tax_template_cache = {};
	memory.item_groups_cache = [];
	memory.translation_cache = {};
	memory.pricing_rules_snapshot = [];
	memory.pricing_rules_context = null;
	memory.pricing_rules_last_sync = null;
	memory.pricing_rules_stale_at = null;
	memory.print_template = "";
	memory.terms_and_conditions = "";
	memory.cache_version = CACHE_VERSION;
	memory.tax_inclusive = false;
	memory.manual_offline = false;
	memory.cache_ready = false;

	_storedItems.length = 0;
	_storedCustomers.length = 0;

	await clearPriceListCache();

	persist("cache_version", CACHE_VERSION);
	persist("cache_ready", false);
}

// Faster cache clearing
export async function forceClearAllCache() {
	if (typeof localStorage !== "undefined") {
		Object.keys(localStorage).forEach((key) => {
			if (key.startsWith("posa_")) {
				localStorage.removeItem(key);
			}
		});
	}

	memory.offline_invoices = [];
	memory.offline_customers = [];
	memory.offline_payments = [];
	memory.pos_last_sync_totals = { pending: 0, synced: 0, drafted: 0 };
	memory.uom_cache = {};
	memory.offers_cache = [];
	memory.coupons_cache = {};
	memory.customer_balance_cache = {};
	memory.local_stock_cache = {};
	memory.stock_cache_ready = false;
	memory.customer_storage = [];
	memory.items_last_sync = null;
	memory.customers_last_sync = null;
	memory.pos_opening_storage = null;
	memory.opening_dialog_storage = null;
	memory.sales_persons_storage = [];
	memory.item_details_cache = {};
	memory.tax_template_cache = {};
	memory.item_groups_cache = [];
	memory.translation_cache = {};
	memory.pricing_rules_snapshot = [];
	memory.pricing_rules_context = null;
	memory.pricing_rules_last_sync = null;
	memory.pricing_rules_stale_at = null;
	memory.print_template = "";
	memory.terms_and_conditions = "";
	memory.cache_version = CACHE_VERSION;
	memory.tax_inclusive = false;
	memory.manual_offline = false;
	memory.cache_ready = false;

	if (typeof localStorage !== "undefined") {
		localStorage.setItem("posa_cache_version", String(CACHE_VERSION));
	}

	_storedItems.length = 0;
	_storedCustomers.length = 0;

	await clearPriceListCache();

	persist("cache_version", CACHE_VERSION);
	persist("cache_ready", false);
}

/**
 * Estimates the current cache usage size in bytes and percentage.
 * @returns {Promise<Object>} usage breakdown for localStorage/SQLite
 */
export async function getCacheUsageEstimate() {
	if (cacheUsageEstimatePromise) {
		return cacheUsageEstimatePromise;
	}

	cacheUsageEstimatePromise = (async () => {
		try {
			// In Electron mode, get stats from SQLite
			if (isElectron()) {
				const stats = await window.posAPI.getDbStats();
				return {
					total: 0,
					localStorage: 0,
					sqlite: stats,
					percentage: 0, // SQLite has no practical limit
				};
			}

			let localStorageSize = 0;
			if (typeof localStorage !== "undefined") {
				for (let i = 0; i < localStorage.length; i++) {
					const key = localStorage.key(i);
					if (key && key.startsWith("posa_")) {
						const value = localStorage.getItem(key) || "";
						localStorageSize += (key.length + value.length) * 2;
					}
				}
			}

			const maxSize = 5 * 1024 * 1024; // localStorage ~5MB limit
			const usagePercentage = maxSize
				? Math.min(100, Math.round((localStorageSize / maxSize) * 100))
				: 0;

			return {
				total: localStorageSize,
				localStorage: localStorageSize,
				percentage: usagePercentage,
			};
		} catch (e) {
			console.error("Failed to estimate cache usage", e);
			return {
				total: 0,
				localStorage: 0,
				percentage: 0,
			};
		} finally {
			cacheUsageEstimatePromise = null;
		}
	})();

	return cacheUsageEstimatePromise;
}
