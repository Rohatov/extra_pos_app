const path = require("path");
const { pathToFileURL } = require("url");
const { app, BrowserWindow, ipcMain, net, protocol, shell, Menu, Tray } = require("electron");
const posDb = require("./database.js");

// ---------------------------------------------------------------------------
// Custom protocol — allows ES module loading from local files
// Must be called before app.whenReady()
// ---------------------------------------------------------------------------
protocol.registerSchemesAsPrivileged([
	{
		scheme: "pos",
		privileges: {
			standard: true,
			secure: true,
			supportFetchAPI: true,
			corsEnabled: false,
			stream: true,
		},
	},
]);

const DEFAULT_PATH = "/app/posapp";

let store;
const storeReady = (async () => {
	const { default: Store } = await import("electron-store");
	store = new Store({
		name: "posawesome-desktop",
		defaults: {
			serverUrl: "",
			apiKey: "",
			apiSecret: "",
			posProfile: "",
			priceList: "",
		},
	});
})();

async function ensureStoreReady() {
	await storeReady;
	if (!store) {
		throw new Error("Failed to initialize settings store");
	}
}

let mainWindow;
let tray = null;
let syncInterval = null;

function ensureUrl(rawUrl) {
	if (!rawUrl || typeof rawUrl !== "string") {
		return "";
	}

	const trimmed = rawUrl.trim();
	if (!trimmed) {
		return "";
	}

	const tryParse = (value) => {
		try {
			const parsed = new URL(value);
			return parsed;
		} catch (error) {
			return null;
		}
	};

	let parsed = tryParse(trimmed);
	if (!parsed) {
		parsed = tryParse(`https://${trimmed}`);
	}

	if (!parsed) {
		return "";
	}

	parsed.hash = "";
	if (!parsed.protocol || parsed.protocol === ":") {
		parsed.protocol = "https:";
	}

	if (!parsed.hostname) {
		return "";
	}

	const trimmedPath = parsed.pathname?.replace(/\/+$/, "") || "";
	if (!trimmedPath || trimmedPath === "/") {
		parsed.pathname = DEFAULT_PATH;
	} else if (trimmedPath === "/app/posawesome" || trimmedPath.startsWith("/app/posawesome/")) {
		parsed.pathname = trimmedPath.replace("/app/posawesome", DEFAULT_PATH);
	}

	return parsed.toString().replace(/\/$/, "");
}

function getStoredUrl() {
	if (!store) {
		return "";
	}
	const raw = store.get("serverUrl", "");
	const normalized = ensureUrl(raw);
	if (!normalized) {
		return "";
	}
	return normalized;
}

function createWindow() {
	// Remove default browser menu bar for native desktop look
	Menu.setApplicationMenu(null);

	const winOpts = {
		width: 1400,
		height: 900,
		minWidth: 1024,
		minHeight: 768,
		show: false,
		backgroundColor: "#101828",
		webPreferences: {
			preload: path.join(__dirname, "preload.js"),
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: false,
			spellcheck: false,
		},
	};

	// Set window icon (uses .ico on Windows, .png elsewhere)
	const iconPath = getTrayIconPath();
	if (require("fs").existsSync(iconPath)) {
		winOpts.icon = iconPath;
	}

	mainWindow = new BrowserWindow(winOpts);

	mainWindow.webContents.setWindowOpenHandler(({ url }) => {
		shell.openExternal(url);
		return { action: "deny" };
	});

	mainWindow.webContents.on("did-fail-load", (_event, errorCode) => {
		if (errorCode === -3) {
			return;
		}
		loadOffline();
	});

	mainWindow.once("ready-to-show", () => {
		mainWindow.maximize();
		mainWindow.show();
	});

	// Minimize to tray on close (Windows/Linux) instead of quitting
	mainWindow.on("close", (event) => {
		if (!app.isQuitting && tray) {
			event.preventDefault();
			mainWindow.hide();
		}
	});

	const target = getStoredUrl();
	const apiKey = store ? store.get("apiKey", "") : "";
	const apiSecret = store ? store.get("apiSecret", "") : "";
	if (target && apiKey && apiSecret) {
		loadPos();
	} else {
		loadSetup();
	}
}

function loadSetup() {
	const setupPath = path.join(__dirname, "renderer", "setup.html");
	mainWindow.loadFile(setupPath);
}

function loadOffline() {
	const offlinePath = path.join(__dirname, "renderer", "offline.html");
	mainWindow.loadFile(offlinePath);
}

function loadPos() {
	mainWindow.loadURL("pos://app/renderer/pos.html");
}

function loadServer(serverUrl) {
	if (!store) {
		return;
	}
	const normalized = ensureUrl(serverUrl);
	if (!normalized) {
		loadSetup();
		return;
	}

	store.set("serverUrl", normalized);
	// Always load the standalone POS interface — API calls go through IPC
	loadPos();
}

async function probeServer() {
	await ensureStoreReady();
	const url = getStoredUrl();
	if (!url) {
		return { reachable: false, message: "No server URL configured" };
	}

	return new Promise((resolve) => {
		const request = net.request({ method: "HEAD", url });
		request.on("response", (response) => {
			resolve({ reachable: true, status: response.statusCode, url });
		});
		request.on("error", (error) => {
			resolve({ reachable: false, message: error.message });
		});
		request.end();
	});
}

async function validateConnection() {
	await ensureStoreReady();
	const serverUrl = store.get("serverUrl", "");
	const apiKey = store.get("apiKey", "");
	const apiSecret = store.get("apiSecret", "");
	const configuredProfile = store.get("posProfile", "");
	const configuredPriceList = store.get("priceList", "");

	if (!serverUrl) {
		return { ok: false, message: "Server URL kiritilmagan" };
	}

	if (!apiKey || !apiSecret) {
		return { ok: false, message: "API Key va API Secret kiriting" };
	}

	const probe = await probeServer();
	if (!probe?.reachable) {
		return {
			ok: false,
			offline: true,
			message: probe?.message || "Server bilan aloqa yo'q",
		};
	}

	try {
		const userResult = await posDb.erpRequest(serverUrl, apiKey, apiSecret, {
			method: "GET",
			endpoint: "/api/method/frappe.auth.get_logged_user",
		});
		const user = userResult?.message || "";
		if (!user) {
			return { ok: false, message: "Login muvaffaqiyatsiz" };
		}

		let profile = null;
		try {
			const profileResult = await posDb.erpRequest(serverUrl, apiKey, apiSecret, {
				method: "POST",
				endpoint: "/api/method/posawesome.posawesome.api.utils.get_active_pos_profile",
				body: { user },
			});
			if (profileResult?.message) {
				profile = profileResult.message;
				store.set("posProfile", profile.name || configuredProfile || "");
				if (profile.selling_price_list) {
					store.set("priceList", profile.selling_price_list);
				}
				posDb.setSetting("pos_profile_full", JSON.stringify(profile));
			}
		} catch (_) {
			// fall back to configured profile below
		}

		if (!profile && !configuredProfile) {
			return { ok: false, message: "POS Profile topilmadi yoki ruxsat yo'q" };
		}

		return {
			ok: true,
			message: "Connection confirmed",
			user,
			posProfile: profile?.name || configuredProfile || "",
			priceList: profile?.selling_price_list || configuredPriceList || "",
		};
	} catch (error) {
		return { ok: false, message: error.message || "Connection validation failed" };
	}
}

app.on("window-all-closed", () => {
	if (process.platform !== "darwin") {
		app.quit();
	}
});

app.whenReady().then(async () => {
	await ensureStoreReady();
	app.setAppUserModelId("com.posawesome.desktop");

	// Register custom protocol handler for local file serving
	// This allows ES module imports to work from local files
	const electronDir = path.normalize(__dirname);
	protocol.handle("pos", (request) => {
		const url = new URL(request.url);
		const filePath = path.normalize(
			path.join(electronDir, decodeURIComponent(url.pathname)),
		);

		// Prevent path traversal outside the electron directory
		if (!filePath.startsWith(electronDir)) {
			return new Response("Forbidden", { status: 403 });
		}

		return net.fetch(pathToFileURL(filePath).href);
	});

	// Open the SQLite database
	posDb.open();

	createWindow();
	createTray();
	startBackgroundSync();

	app.on("activate", () => {
		if (BrowserWindow.getAllWindows().length === 0) {
			createWindow();
		}
	});
});

ipcMain.handle("get-server-url", async () => {
	await ensureStoreReady();
	return store.get("serverUrl", "");
});

ipcMain.handle("normalize-server-url", (_event, value) => ensureUrl(value));

ipcMain.handle("set-server-url", async (_event, value) => {
	await ensureStoreReady();
	const normalized = ensureUrl(value);
	if (!normalized) {
		throw new Error("Please provide a valid server URL (e.g. https://example.com)");
	}
	loadServer(normalized);
	return normalized;
});

ipcMain.handle("retry-load", async () => {
	await ensureStoreReady();
	const url = getStoredUrl();
	if (!url) {
		loadSetup();
		return { launched: false };
	}
	loadServer(url);
	return { launched: true, url };
});

ipcMain.handle("open-settings", () => {
	loadSetup();
	return { opened: true };
});

ipcMain.handle("probe-server", async () => probeServer());

ipcMain.handle("validate-connection", async () => validateConnection());

ipcMain.handle("reset-server", async () => {
	await ensureStoreReady();
	store.delete("serverUrl");
	loadSetup();
});

// ---------------------------------------------------------------------------
// Config (electron-store) IPC handlers
// ---------------------------------------------------------------------------

ipcMain.handle("get-config", async () => {
	await ensureStoreReady();
	return {
		serverUrl: store.get("serverUrl", ""),
		apiKey: store.get("apiKey", ""),
		apiSecret: store.get("apiSecret", ""),
		posProfile: store.get("posProfile", ""),
		priceList: store.get("priceList", ""),
	};
});

ipcMain.handle("save-config", async (_event, config) => {
	await ensureStoreReady();
	if (config.serverUrl !== undefined) store.set("serverUrl", ensureUrl(config.serverUrl));
	if (config.apiKey !== undefined) store.set("apiKey", config.apiKey);
	if (config.apiSecret !== undefined) store.set("apiSecret", config.apiSecret);
	if (config.posProfile !== undefined) store.set("posProfile", config.posProfile);
	if (config.priceList !== undefined) store.set("priceList", config.priceList);
	return { saved: true };
});

ipcMain.handle("get-app-version", () => {
	return app.getVersion();
});

// ---------------------------------------------------------------------------
// Items (SQLite) IPC handlers
// ---------------------------------------------------------------------------

ipcMain.handle("get-items", (_event, opts) => {
	return posDb.getItems(opts || {});
});

ipcMain.handle("get-item-by-code", (_event, itemCode) => {
	return posDb.getItemByCode(itemCode);
});

ipcMain.handle("get-item-by-barcode", (_event, barcode) => {
	return posDb.getItemByBarcode(barcode);
});

ipcMain.handle("get-items-count", () => {
	return posDb.getItemsCount();
});

ipcMain.handle("get-item-image-path", (_event, itemCode) => {
	return posDb.getItemImagePath(itemCode);
});

ipcMain.handle("save-items-bulk", (_event, items) => {
	return posDb.upsertItems(items);
});

ipcMain.handle("clear-all-items", () => {
	return posDb.clearAllItems();
});

// ---------------------------------------------------------------------------
// Customers (SQLite) IPC handlers
// ---------------------------------------------------------------------------

ipcMain.handle("get-customers", (_event, opts) => {
	return posDb.getCustomers(opts || {});
});

ipcMain.handle("get-customers-count", () => {
	return posDb.getCustomersCount();
});

ipcMain.handle("save-customers", (_event, customers) => {
	return posDb.upsertCustomers(customers);
});

ipcMain.handle("clear-all-customers", () => {
	return posDb.clearAllCustomers();
});

// ---------------------------------------------------------------------------
// Invoices (offline queue) IPC handlers
// ---------------------------------------------------------------------------

ipcMain.handle("save-invoice", (_event, payload) => {
	return posDb.saveInvoice(payload);
});

ipcMain.handle("get-pending-invoices", () => {
	return posDb.getPendingInvoices();
});

ipcMain.handle("get-pending-count", () => {
	return posDb.getPendingCount();
});

ipcMain.handle("get-all-invoices", (_event, opts) => {
	return posDb.getAllInvoices(opts || {});
});

ipcMain.handle("delete-invoice", (_event, id) => {
	posDb.deleteInvoice(id);
	return { deleted: true };
});

// ---------------------------------------------------------------------------
// Stock IPC handlers
// ---------------------------------------------------------------------------

ipcMain.handle("get-local-stock", (_event, itemCode) => {
	return posDb.getLocalStock(itemCode);
});

// ---------------------------------------------------------------------------
// Sync IPC handlers
// ---------------------------------------------------------------------------

ipcMain.handle("sync-now", async () => {
	return runSync();
});

ipcMain.handle("get-sync-logs", (_event, limit) => {
	return posDb.getRecentSyncLogs(limit || 50);
});

// ---------------------------------------------------------------------------
// Settings (key-value SQLite) IPC handlers
// ---------------------------------------------------------------------------

ipcMain.handle("get-setting", (_event, key) => {
	return posDb.getSetting(key);
});

ipcMain.handle("set-setting", (_event, key, value) => {
	posDb.setSetting(key, value);
	return { saved: true };
});

// ---------------------------------------------------------------------------
// Database stats IPC handlers
// ---------------------------------------------------------------------------

ipcMain.handle("get-db-stats", () => {
	return {
		dbPath: posDb.getDbPath(),
		itemsCount: posDb.getItemsCount(),
		customersCount: posDb.getCustomersCount(),
		pendingInvoices: posDb.getPendingCount(),
	};
});

ipcMain.handle("get-images-dir", () => {
	return posDb.getImagesDir();
});

// ---------------------------------------------------------------------------
// Frappe API proxy — routes frappe.call() from renderer to ERPNext via HTTP
// ---------------------------------------------------------------------------

ipcMain.handle("frappe-call", async (_event, method, args) => {
	await ensureStoreReady();
	const serverUrl = store.get("serverUrl", "");
	const apiKey = store.get("apiKey", "");
	const apiSecret = store.get("apiSecret", "");

	if (!serverUrl) {
		throw new Error("No server URL configured. Please set up the server connection.");
	}
	if (!apiKey || !apiSecret) {
		throw new Error("API credentials not configured. Please set API Key and Secret in settings.");
	}

	// Map frappe.call method names to REST endpoints
	// frappe.call({ method: "some.dotted.path", args: {...} })
	// → POST /api/method/some.dotted.path  body: {...args}
	const endpoint = `/api/method/${method}`;

	const result = await posDb.erpRequest(serverUrl, apiKey, apiSecret, {
		method: "POST",
		endpoint,
		body: args || {},
	});

	return result;
});

// ---------------------------------------------------------------------------
// Boot config — populates frappe.session, frappe.boot in the renderer
// ---------------------------------------------------------------------------

ipcMain.handle("get-boot-config", async () => {
	await ensureStoreReady();
	const serverUrl = store.get("serverUrl", "");
	const apiKey = store.get("apiKey", "");
	const apiSecret = store.get("apiSecret", "");
	const posProfile = store.get("posProfile", "");

	const config = {
		serverUrl: serverUrl ? serverUrl.replace(/\/app\/posapp.*$/, "") : "",
		user: "",
		user_fullname: "",
		pos_profile: null,
		sysdefaults: {},
		lang: "en",
		use_western_numerals: true,
		website_settings: {},
		translations: {},
	};

	// If we have credentials, fetch user info and boot data from server
	if (serverUrl && apiKey && apiSecret) {
		try {
			const baseUrl = serverUrl.replace(/\/app\/posapp.*$/, "");

			// Get logged-in user info
			const userResult = await posDb.erpRequest(baseUrl, apiKey, apiSecret, {
				method: "GET",
				endpoint: "/api/method/frappe.auth.get_logged_user",
			});
			config.user = userResult.message || apiKey.split(":")[0] || "Administrator";

			// Get user fullname
			try {
				const fullnameResult = await posDb.erpRequest(baseUrl, apiKey, apiSecret, {
					method: "GET",
					endpoint: `/api/resource/User/${encodeURIComponent(config.user)}?fields=["full_name"]`,
				});
				config.user_fullname = fullnameResult.data?.full_name || config.user;
			} catch (_) {
				config.user_fullname = config.user;
			}

			// Get system defaults
			try {
				const defaults = await posDb.erpRequest(baseUrl, apiKey, apiSecret, {
					method: "GET",
					endpoint: "/api/resource/System Settings?fields=[\"country\",\"language\",\"date_format\",\"time_format\",\"number_format\",\"currency\"]",
				});
				const d = defaults.data || {};
				config.sysdefaults = {
					company: d.company || "",
					country: d.country || "",
					currency: d.currency || "",
				};
				config.lang = d.language || "en";
			} catch (_) {
				// Use defaults
			}

			// Get user defaults (Customer Group, Territory, etc.)
			try {
				const udResult = await posDb.erpRequest(baseUrl, apiKey, apiSecret, {
					method: "POST",
					endpoint: "/api/method/frappe.client.get_user_settings",
					body: { doctype: "Customer" },
				});
				// Also fetch defaults from the Defaults doctype
				const defResult = await posDb.erpRequest(baseUrl, apiKey, apiSecret, {
					method: "GET",
					endpoint: `/api/resource/User Permission?filters=[["user","=","${encodeURIComponent(config.user)}"]]&fields=["allow","for_value"]&limit_page_length=100`,
				});
				config.user_defaults = {};
				if (defResult.data && Array.isArray(defResult.data)) {
					for (const d of defResult.data) {
						config.user_defaults[d.allow] = d.for_value;
					}
				}
			} catch (_) {
				config.user_defaults = {};
			}

			// Resolve the POS profile
			if (posProfile) {
				// Check if we have a full cached profile in SQLite settings
				const cachedProfile = posDb.getSetting("pos_profile_full");
				if (cachedProfile) {
					try {
						const parsed = JSON.parse(cachedProfile);
						if (parsed.name === posProfile || parsed.name === posProfile.replace(/^"|"$/g, "")) {
							config.pos_profile = parsed;
						}
					} catch (_) {}
				}
				if (!config.pos_profile) {
					config.pos_profile = typeof posProfile === "string" && posProfile.startsWith("{")
						? JSON.parse(posProfile)
						: { name: posProfile };
				}
			}

			// Try to get full POS profile from server (to update cache)
			try {
				const profileResult = await posDb.erpRequest(baseUrl, apiKey, apiSecret, {
					method: "POST",
					endpoint: "/api/method/posawesome.posawesome.api.utils.get_active_pos_profile",
					body: { user: config.user },
				});
				if (profileResult.message) {
					config.pos_profile = profileResult.message;
					store.set("posProfile", config.pos_profile.name || "");
					// Cache the full profile for offline use
					posDb.setSetting("pos_profile_full", JSON.stringify(profileResult.message));
				}
			} catch (_) {
				// Offline — use cached profile from above
			}

			// Get website settings (logo etc.)
			try {
				const wsResult = await posDb.erpRequest(baseUrl, apiKey, apiSecret, {
					method: "GET",
					endpoint: "/api/resource/Website Settings?fields=[\"app_logo\",\"banner_image\",\"app_name\"]",
				});
				config.website_settings = wsResult.data || {};
			} catch (_) {
				// Non-critical
			}

			// Get translations for current language
			if (config.lang && config.lang !== "en") {
				try {
					const trResult = await posDb.erpRequest(baseUrl, apiKey, apiSecret, {
						method: "POST",
						endpoint: "/api/method/frappe.translate.get_all_translations",
						body: { language: config.lang },
					});
					config.translations = trResult.message || {};
				} catch (_) {
					// Non-critical
				}
			}
		} catch (err) {
			console.error("[boot] Failed to load boot config from server:", err.message);
			// Offline fallback: load cached boot config from SQLite
			const cachedBoot = posDb.getSetting("boot_config_cache");
			if (cachedBoot) {
				try {
					const cached = JSON.parse(cachedBoot);
					config.user = cached.user || "";
					config.user_fullname = cached.user_fullname || "";
					config.pos_profile = cached.pos_profile || config.pos_profile;
					config.sysdefaults = cached.sysdefaults || {};
					config.lang = cached.lang || "en";
					config.user_defaults = cached.user_defaults || {};
					config.website_settings = cached.website_settings || {};
					config.translations = cached.translations || {};
					console.log("[boot] Loaded cached boot config for offline use");
				} catch (_) {
					console.warn("[boot] Failed to parse cached boot config");
				}
			}
		}
	}

	// Cache the boot config for offline use (only if we got user data from server)
	if (config.user) {
		try {
			posDb.setSetting("boot_config_cache", JSON.stringify(config));
		} catch (_) {}
	}

	return config;
});

// ---------------------------------------------------------------------------
// Load POS page — switch from setup to POS interface
// ---------------------------------------------------------------------------

ipcMain.handle("load-pos-page", () => {
	mainWindow.loadURL("pos://app/renderer/pos.html");
	return { loaded: true };
});

// ---------------------------------------------------------------------------
// Background Sync
// ---------------------------------------------------------------------------

async function runSync() {
	await ensureStoreReady();
	const serverUrl = store.get("serverUrl", "");
	const apiKey = store.get("apiKey", "");
	const apiSecret = store.get("apiSecret", "");
	const posProfile = store.get("posProfile", "");
	const priceList = store.get("priceList", "");

	if (!serverUrl || !apiKey || !apiSecret) {
		return { error: "Missing server credentials" };
	}

	try {
		const result = await posDb.fullSync(serverUrl, apiKey, apiSecret, posProfile, priceList);
		if (mainWindow && !mainWindow.isDestroyed()) {
			mainWindow.webContents.send("sync-completed", result);
		}
		return result;
	} catch (err) {
		console.error("[sync] Full sync failed:", err.message);
		return { error: err.message };
	}
}

function startBackgroundSync() {
	// First sync after 5 seconds
	setTimeout(() => {
		runSync().catch((err) => console.error("[sync] Initial sync error:", err.message));
	}, 5000);

	// Then every 60 seconds
	syncInterval = setInterval(() => {
		runSync().catch((err) => console.error("[sync] Periodic sync error:", err.message));
	}, 60000);
}

// Event-driven sync: renderer notifies us when network comes back online
ipcMain.on("network-online", () => {
	console.log("[sync] Network came back online — triggering immediate sync");
	runSync().catch((err) => console.error("[sync] Reconnect sync error:", err.message));
});

// ---------------------------------------------------------------------------
// Tray
// ---------------------------------------------------------------------------

function getTrayIconPath() {
	const ext = process.platform === "win32" ? "ico" : "png";
	return path.join(__dirname, "icons", `icon.${ext}`);
}

function createTray() {
	const iconPath = getTrayIconPath();
	try {
		tray = new Tray(iconPath);
	} catch (_) {
		// No icon available, skip tray
		return;
	}

	const contextMenu = Menu.buildFromTemplate([
		{
			label: "Open POS",
			click: () => {
				if (mainWindow) {
					mainWindow.show();
					mainWindow.focus();
				}
			},
		},
		{
			label: "Settings",
			click: () => {
				if (mainWindow) {
					loadSetup();
					mainWindow.show();
					mainWindow.focus();
				}
			},
		},
		{
			label: "Sync Now",
			click: () => {
				runSync().catch((err) => console.error("[tray] Sync error:", err.message));
			},
		},
		{ type: "separator" },
		{
			label: "Quit",
			click: () => {
				app.quit();
			},
		},
	]);

	tray.setToolTip("POS Awesome");
	tray.setContextMenu(contextMenu);
	tray.on("click", () => {
		if (mainWindow) {
			mainWindow.show();
			mainWindow.focus();
		}
	});
}

// Cleanup on quit
app.on("before-quit", () => {
	app.isQuitting = true;
	if (syncInterval) {
		clearInterval(syncInterval);
		syncInterval = null;
	}
	posDb.close();
});
