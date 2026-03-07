async function delay(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function clearLocalStorage(keys = []) {
	if (typeof localStorage === "undefined") return;
	try {
		if (keys.length) {
			keys.forEach((k) => localStorage.removeItem(k));
		} else {
			Object.keys(localStorage).forEach((key) => localStorage.removeItem(key));
		}
		console.log("[ClearAllCaches] localStorage cleared", keys.length ? keys : "all");
	} catch (e) {
		console.error("[ClearAllCaches] Failed to clear localStorage", e);
		throw e;
	}
}

export async function clearSessionStorage(keys = []) {
	if (typeof sessionStorage === "undefined") return;
	try {
		if (keys.length) {
			keys.forEach((k) => sessionStorage.removeItem(k));
		} else {
			sessionStorage.clear();
		}
		console.log("[ClearAllCaches] sessionStorage cleared", keys.length ? keys : "all");
	} catch (e) {
		console.error("[ClearAllCaches] Failed to clear sessionStorage", e);
		throw e;
	}
}

export async function clearAllCaches(
	options = {
		confirmBeforeClear: true,
		onSuccess: () => {},
		onError: () => {},
		specificKeys: [],
		skipStorage: [],
	},
) {
	const opts = Object.assign(
		{
			confirmBeforeClear: true,
			onSuccess: () => {},
			onError: () => {},
			specificKeys: [],
			skipStorage: [],
		},
		options || {},
	);

	try {
		if (opts.confirmBeforeClear && typeof window !== "undefined") {
			const confirmMsg = "Are you sure you want to clear application cache?";
			if (!window.confirm(confirmMsg)) {
				return;
			}
		}

		const tasks = [];
		if (!opts.skipStorage.includes("localStorage")) {
			tasks.push(clearLocalStorage(opts.specificKeys));
		}
		if (!opts.skipStorage.includes("sessionStorage")) {
			tasks.push(clearSessionStorage(opts.specificKeys));
		}

		await Promise.all(tasks);
		opts.onSuccess();
	} catch (e) {
		opts.onError(e);
	}
}

// Attach default UI and keyboard integrations when running in browser
if (typeof window !== "undefined") {
	document.addEventListener("keydown", (e) => {
		if (e.ctrlKey && e.shiftKey && e.code === "KeyR") {
			e.preventDefault();
			clearAllCaches().catch(() => {});
		}
	});

	document.addEventListener("DOMContentLoaded", () => {
		const btn = document.getElementById("clear-cache-btn");
		if (btn) {
			btn.addEventListener("click", () => clearAllCaches().catch(() => {}));
		}
	});
}
