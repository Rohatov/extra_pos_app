const path = require("path");
const { app, BrowserWindow, ipcMain, net, shell, Menu, Tray } = require("electron");
const posDb = require("./database.js");

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
	if (target) {
		loadServer(target);
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
	mainWindow.loadURL(normalized);
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

app.on("window-all-closed", () => {
	if (process.platform !== "darwin") {
		app.quit();
	}
});

app.whenReady().then(async () => {
	await ensureStoreReady();
	app.setAppUserModelId("com.posawesome.desktop");

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

// ---------------------------------------------------------------------------
// Customers (SQLite) IPC handlers
// ---------------------------------------------------------------------------

ipcMain.handle("get-customers", (_event, opts) => {
	return posDb.getCustomers(opts || {});
});

ipcMain.handle("get-customers-count", () => {
	return posDb.getCustomersCount();
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
