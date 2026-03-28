const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
	getServerUrl: () => ipcRenderer.invoke("get-server-url"),
	normalizeServerUrl: (value) => ipcRenderer.invoke("normalize-server-url", value),
	setServerUrl: (value) => ipcRenderer.invoke("set-server-url", value),
	retryLoad: () => ipcRenderer.invoke("retry-load"),
	openSettings: () => ipcRenderer.invoke("open-settings"),
	probeServer: () => ipcRenderer.invoke("probe-server"),
	validateConnection: () => ipcRenderer.invoke("validate-connection"),
	resetServer: () => ipcRenderer.invoke("reset-server"),
	getConfig: () => ipcRenderer.invoke("get-config"),
	saveConfig: (config) => ipcRenderer.invoke("save-config", config),
	getAppVersion: () => ipcRenderer.invoke("get-app-version"),
	checkForUpdates: () => ipcRenderer.invoke("check-for-updates"),
});

contextBridge.exposeInMainWorld("posAPI", {
	// Items
	getItems: (opts) => ipcRenderer.invoke("get-items", opts),
	getItemByCode: (code) => ipcRenderer.invoke("get-item-by-code", code),
	getItemByBarcode: (barcode) => ipcRenderer.invoke("get-item-by-barcode", barcode),
	getItemsCount: () => ipcRenderer.invoke("get-items-count"),
	getItemImagePath: (itemCode) => ipcRenderer.invoke("get-item-image-path", itemCode),
	saveItemsBulk: (items) => ipcRenderer.invoke("save-items-bulk", items),
	clearAllItems: () => ipcRenderer.invoke("clear-all-items"),

	// Customers
	getCustomers: (opts) => ipcRenderer.invoke("get-customers", opts),
	getCustomersCount: () => ipcRenderer.invoke("get-customers-count"),
	saveCustomers: (customers) => ipcRenderer.invoke("save-customers", customers),
	clearAllCustomers: () => ipcRenderer.invoke("clear-all-customers"),

	// Invoices
	saveInvoice: (invoice) => ipcRenderer.invoke("save-invoice", invoice),
	getPendingInvoices: () => ipcRenderer.invoke("get-pending-invoices"),
	getPendingCount: () => ipcRenderer.invoke("get-pending-count"),
	getAllInvoices: (opts) => ipcRenderer.invoke("get-all-invoices", opts),
	deleteInvoice: (id) => ipcRenderer.invoke("delete-invoice", id),

	// Stock
	getLocalStock: (itemCode) => ipcRenderer.invoke("get-local-stock", itemCode),

	// Settings
	getSetting: (key) => ipcRenderer.invoke("get-setting", key),
	setSetting: (key, value) => ipcRenderer.invoke("set-setting", key, value),

	// Sync
	syncNow: () => ipcRenderer.invoke("sync-now"),
	getSyncLogs: (limit) => ipcRenderer.invoke("get-sync-logs", limit),
	onSyncCompleted: (callback) => {
		ipcRenderer.on("sync-completed", (_event, result) => callback(result));
	},

	// Stats
	getDbStats: () => ipcRenderer.invoke("get-db-stats"),
	getImagesDir: () => ipcRenderer.invoke("get-images-dir"),

	// Frappe API proxy — routes frappe.call() through IPC → main → HTTP
	frappeCall: (method, args) => ipcRenderer.invoke("frappe-call", method, args),

	// Boot config — loaded at startup to populate frappe.session, frappe.boot
	getBootConfig: () => ipcRenderer.invoke("get-boot-config"),

	// Load POS page in main window
	loadPosPage: () => ipcRenderer.invoke("load-pos-page"),

	// Notify main process that network is back online (triggers immediate sync)
	notifyOnline: () => ipcRenderer.send("network-online"),
});
