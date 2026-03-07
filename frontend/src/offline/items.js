import { memory } from "./cache.js";
import { persist, isElectron } from "./core.js";

export function saveItemUOMs(itemCode, uoms) {
	try {
		const cache = memory.uom_cache;
		// Clone to avoid persisting reactive objects
		let cleanUoms;
		try {
			cleanUoms = JSON.parse(JSON.stringify(uoms));
		} catch (err) {
			console.error("Failed to serialize UOMs", err);
			cleanUoms = [];
		}
		cache[itemCode] = cleanUoms;
		memory.uom_cache = cache;
		persist("uom_cache", memory.uom_cache);
	} catch (e) {
		console.error("Failed to cache UOMs", e);
	}
}

export function getItemUOMs(itemCode) {
	try {
		const cache = memory.uom_cache || {};
		return cache[itemCode] || [];
	} catch {
		return [];
	}
}

export function saveOffers(offers) {
	try {
		memory.offers_cache = offers;
		persist("offers_cache", memory.offers_cache);
	} catch (e) {
		console.error("Failed to cache offers", e);
	}
}

export function getCachedOffers() {
	try {
		return memory.offers_cache || [];
	} catch {
		return [];
	}
}

// Price list names cache for offline dropdown
export function savePriceListNames(names) {
	try {
		memory.price_list_names = names;
		persist("price_list_names", names);
	} catch (e) {
		console.error("Failed to cache price list names", e);
	}
}

export function getCachedPriceListNames() {
	try {
		return memory.price_list_names || [];
	} catch {
		return [];
	}
}

// In-memory price list cache
const _priceListCache = {};

// Price list rate storage using in-memory cache
export async function savePriceListItems(priceList, items) {
	try {
		if (!priceList) return;
		const cache = _priceListCache[priceList] || {};
		items.forEach((it) => {
			const price = it.price_list_rate ?? it.rate ?? 0;
			cache[it.item_code] = {
				price_list: priceList,
				item_code: it.item_code,
				rate: price,
				price_list_rate: price,
				timestamp: Date.now(),
			};
		});
		_priceListCache[priceList] = cache;
	} catch (e) {
		console.error("Failed to save price list items", e);
	}
}

export async function getCachedPriceListItems(priceList, ttl = 24 * 60 * 60 * 1000) {
	try {
		if (!priceList) return null;
		const cache = _priceListCache[priceList];
		if (!cache) return null;
		const now = Date.now();
		const valid = Object.values(cache).filter((p) => now - p.timestamp < ttl);
		if (!valid.length) return null;
		return valid;
	} catch (e) {
		console.error("Failed to get cached price list items", e);
		return null;
	}
}

export async function clearPriceListCache(priceList = null) {
	try {
		if (priceList) {
			delete _priceListCache[priceList];
		} else {
			Object.keys(_priceListCache).forEach((k) => delete _priceListCache[k]);
		}
	} catch (e) {
		console.error("Failed to clear price list cache", e);
	}
}

// Item details caching functions
export function saveItemDetailsCache(profileName, priceList, items) {
	try {
		const cache = memory.item_details_cache || {};
		const profileCache = cache[profileName] || {};
		const priceCache = profileCache[priceList] || {};

		let cleanItems;
		try {
			// Store only fields required for offline usage
			cleanItems = items.map((it) => ({
				item_code: it.item_code,
				actual_qty: it.actual_qty,
				has_batch_no: it.has_batch_no,
				has_serial_no: it.has_serial_no,
				item_uoms: it.item_uoms,
				batch_no_data: it.batch_no_data,
				serial_no_data: it.serial_no_data,
				rate: it.rate,
				price_list_rate: it.price_list_rate,
				currency: it.currency,
			}));
			cleanItems = JSON.parse(JSON.stringify(cleanItems));
		} catch (err) {
			console.error("Failed to serialize item details", err);
			cleanItems = [];
		}

		cleanItems.forEach((item) => {
			priceCache[item.item_code] = {
				data: item,
				timestamp: Date.now(),
			};
		});
		profileCache[priceList] = priceCache;
		cache[profileName] = profileCache;
		memory.item_details_cache = cache;
		persist("item_details_cache", memory.item_details_cache);
	} catch (e) {
		console.error("Failed to cache item details", e);
	}
}

export async function getCachedItemDetails(profileName, priceList, itemCodes, ttl = 15 * 60 * 1000) {
	try {
		const cache = memory.item_details_cache || {};
		const priceCache = cache[profileName]?.[priceList] || {};
		const now = Date.now();
		const cached = [];
		const missing = [];
		itemCodes.forEach((code) => {
			const entry = priceCache[code];
			if (entry && now - entry.timestamp < ttl) {
				cached.push(entry.data);
			} else {
				missing.push(code);
			}
		});

		return { cached, missing };
	} catch (e) {
		console.error("Failed to get cached item details", e);
		return { cached: [], missing: itemCodes };
	}
}

export function clearItemDetailsCache() {
	try {
		memory.item_details_cache = {};
		persist("item_details_cache", memory.item_details_cache);
	} catch (e) {
		console.error("Failed to clear item details cache", e);
	}
}

// In-memory stored items (used by web mode; Electron adapter bypasses)
import { getStoredItems as _getFromCache, saveItems as _saveToCache } from "./cache.js";

// Persistent item storage helpers
export async function saveItemsBulk(items) {
	if (isElectron()) {
		// In Electron mode, items come from background sync — no-op for writes
		return;
	}
	try {
		let cleanItems;
		try {
			cleanItems = JSON.parse(JSON.stringify(items));
		} catch (err) {
			console.error("Failed to serialize items", err);
			cleanItems = [];
		}
		cleanItems = cleanItems.map((it) => ({
			...it,
			barcodes: Array.isArray(it.item_barcode)
				? it.item_barcode.map((b) => b.barcode).filter(Boolean)
				: it.item_barcode
					? [String(it.item_barcode)]
					: [],
			name_keywords: it.item_name ? it.item_name.toLowerCase().split(/\s+/).filter(Boolean) : [],
			serials: Array.isArray(it.serial_no_data)
				? it.serial_no_data.map((s) => s.serial_no).filter(Boolean)
				: [],
			batches: Array.isArray(it.batch_no_data)
				? it.batch_no_data.map((b) => b.batch_no).filter(Boolean)
				: [],
		}));
		await _saveToCache(cleanItems);
	} catch (e) {
		console.error("Failed to save items", e);
	}
}

export async function getAllStoredItems() {
	if (isElectron()) {
		return window.posAPI.getItems({ limit: 50000 });
	}
	try {
		return await _getFromCache();
	} catch (e) {
		console.error("Failed to read stored items", e);
		return [];
	}
}

export async function searchStoredItems({ search = "", itemGroup = "", limit = 100, offset = 0 } = {}) {
	if (isElectron()) {
		return window.posAPI.getItems({
			search,
			item_group: itemGroup && itemGroup.toLowerCase() !== "all" ? itemGroup : "",
			limit,
			offset,
		});
	}
	try {
		const allItems = await _getFromCache();
		const normalizedSearch = String(search || "")
			.toLowerCase()
			.trim();
		const words = Array.from(new Set(normalizedSearch.split(/\s+/).filter(Boolean)));

		const matchesAllWords = (item) => {
			if (!words.length) return true;
			const searchable = [];
			const pushValue = (value) => {
				if (value == null) return;
				const text = String(value).trim().toLowerCase();
				if (text) searchable.push(text);
			};
			pushValue(item.item_code);
			pushValue(item.item_name);
			pushValue(item.name);
			pushValue(item.description);
			pushValue(item.barcode);
			pushValue(item.brand);
			pushValue(item.item_group);
			if (Array.isArray(item.item_barcode)) {
				item.item_barcode.forEach((b) => pushValue(b && b.barcode));
			} else {
				pushValue(item.item_barcode);
			}
			if (Array.isArray(item.barcodes)) item.barcodes.forEach(pushValue);
			if (Array.isArray(item.name_keywords)) item.name_keywords.forEach(pushValue);
			if (Array.isArray(item.serial_no_data))
				item.serial_no_data.forEach((s) => pushValue(s && s.serial_no));
			if (Array.isArray(item.serials)) item.serials.forEach(pushValue);
			if (Array.isArray(item.batch_no_data))
				item.batch_no_data.forEach((b) => pushValue(b && b.batch_no));
			if (Array.isArray(item.batches)) item.batches.forEach(pushValue);
			return words.every((word) => searchable.some((field) => field.includes(word)));
		};

		let results = allItems;

		if (itemGroup && itemGroup.toLowerCase() !== "all") {
			const group = itemGroup.toLowerCase();
			results = results.filter((it) => it.item_group && it.item_group.toLowerCase() === group);
		}

		if (words.length) {
			results = results.filter(matchesAllWords);
		}

		return results.slice(offset, offset + limit);
	} catch (e) {
		console.error("Failed to query stored items", e);
		return [];
	}
}

export async function clearStoredItems() {
	const { clearStoredItems: clear } = await import("./cache.js");
	await clear();
}
