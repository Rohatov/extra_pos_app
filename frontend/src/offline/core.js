// --- In-memory + localStorage persistence --------------
// This module provides the same `persist`, `initPromise`, etc. API that all
// other offline/* modules depend on, but stores data only in memory and
// localStorage. The Adapter layer routes calls to either this store or
// Electron's IPC depending on the environment.

/**
 * Returns true when running inside Electron with the posAPI bridge available.
 * All adapter checks go through this single function — no env checks in .vue files.
 */
export function isElectron() {
	return typeof window !== "undefined" && !!window.posAPI;
}

// Stub db object — keeps the same shape callers expect so that imports of
// `db` don't fail.  All real storage goes through `persist` / `load`.
export const db = null;

const memoryStore = {};

const LARGE_KEYS = new Set(["items", "item_details_cache", "local_stock_cache"]);

export function persist(key, value) {
	memoryStore[key] = value;

	if (typeof localStorage !== "undefined" && !LARGE_KEYS.has(key)) {
		try {
			localStorage.setItem(`posa_${key}`, JSON.stringify(value));
		} catch (err) {
			console.error("Failed to persist", key, "to localStorage", err);
		}
	}
}

export function load(key, fallback = undefined) {
	if (key in memoryStore) {
		return memoryStore[key];
	}

	if (typeof localStorage !== "undefined") {
		const raw = localStorage.getItem(`posa_${key}`);
		if (raw !== null) {
			try {
				const parsed = JSON.parse(raw);
				memoryStore[key] = parsed;
				return parsed;
			} catch {
				// ignore parse errors
			}
		}
	}
	return fallback;
}

export function addToPersistQueue(key, value) {
	persist(key, value);
}

export function checkDbHealth() {
	return Promise.resolve(true);
}

export function initPersistWorker() {
	// no-op: worker removed
}

export function terminatePersistWorker() {
	// no-op
}

export const initPromise = Promise.resolve();
