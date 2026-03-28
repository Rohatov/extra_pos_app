(function () {
	function loadScript(src) {
		return new Promise((resolve, reject) => {
			const existing = document.querySelector(`script[src="${src}"]`);
			if (existing) {
				if (existing.dataset.loaded === "true") {
					resolve();
					return;
				}
				existing.addEventListener("load", () => resolve(), { once: true });
				existing.addEventListener("error", () => reject(new Error(`Failed to load ${src}`)), {
					once: true,
				});
				return;
			}

			const script = document.createElement("script");
			script.src = src;
			script.async = false;
			script.addEventListener(
				"load",
				() => {
					script.dataset.loaded = "true";
					resolve();
				},
				{ once: true }
			);
			script.addEventListener("error", () => reject(new Error(`Failed to load ${src}`)), {
				once: true,
			});
			document.head.appendChild(script);
		});
	}

	function createPyQtBridge() {
		return new Promise((resolve, reject) => {
			if (typeof qt === "undefined" || typeof QWebChannel === "undefined") {
				reject(new Error("Qt bridge is not available"));
				return;
			}

			new QWebChannel(qt.webChannelTransport, (channel) => {
				const bridge = channel.objects.pybridge;
				if (!bridge) {
					reject(new Error("PyQt bridge object is missing"));
					return;
				}

				const invoke = (method, ...args) =>
					new Promise((resolveCall, rejectCall) => {
						try {
							if (typeof bridge[method] !== "function") {
								rejectCall(new Error(`Bridge method ${method} not found`));
								return;
							}
							bridge[method](...args, (result) => {
								if (result && typeof result === "object" && result.__error__) {
									rejectCall(new Error(result.__error__));
									return;
								}
								resolveCall(result);
							});
						} catch (error) {
							rejectCall(error);
						}
					});

				const syncCallbacks = [];
				if (bridge.syncCompleted && bridge.syncCompleted.connect) {
					bridge.syncCompleted.connect((payload) => {
						let parsed = payload;
						try {
							parsed = JSON.parse(payload);
						} catch (_) {
							/* keep raw payload */
						}
						syncCallbacks.forEach((callback) => {
							try {
								callback(parsed);
							} catch (error) {
								console.error("[PyQt] sync callback failed", error);
							}
						});
					});
				}

				window.electronAPI = {
					getServerUrl: () => invoke("getServerUrl"),
					normalizeServerUrl: (value) => invoke("normalizeServerUrl", value),
					setServerUrl: (value) => invoke("setServerUrl", value),
					retryLoad: () => invoke("retryLoad"),
					openSettings: () => invoke("openSettings"),
					probeServer: () => invoke("probeServer"),
					validateConnection: () => invoke("validateConnection"),
					resetServer: () => invoke("resetServer"),
					getConfig: () => invoke("getConfig"),
					saveConfig: (config) => invoke("saveConfig", config || {}),
					getAppVersion: () => invoke("getAppVersion"),
					checkForUpdates: () => invoke("checkForUpdates"),
				};

				window.posAPI = {
					getItems: (opts) => invoke("getItems", opts || {}),
					getItemByCode: (code) => invoke("getItemByCode", code || ""),
					getItemByBarcode: (barcode) => invoke("getItemByBarcode", barcode || ""),
					getItemsCount: () => invoke("getItemsCount"),
					getItemImagePath: (itemCode) => invoke("getItemImagePath", itemCode || ""),
					saveItemsBulk: (items) => invoke("saveItemsBulk", items || []),
					clearAllItems: () => invoke("clearAllItems"),
					getCustomers: (opts) => invoke("getCustomers", opts || {}),
					getCustomersCount: () => invoke("getCustomersCount"),
					saveCustomers: (customers) => invoke("saveCustomers", customers || []),
					clearAllCustomers: () => invoke("clearAllCustomers"),
					saveInvoice: (invoice) => invoke("saveInvoice", invoice || {}),
					getPendingInvoices: () => invoke("getPendingInvoices"),
					getPendingCount: () => invoke("getPendingCount"),
					getAllInvoices: (opts) => invoke("getAllInvoices", opts || {}),
					deleteInvoice: (id) => invoke("deleteInvoice", id || 0),
					getLocalStock: (itemCode) => invoke("getLocalStock", itemCode || ""),
					getSetting: (key) => invoke("getSetting", key || ""),
					setSetting: (key, value) => invoke("setSetting", key || "", value),
					syncNow: () => invoke("syncNow"),
					getSyncLogs: (limit) => invoke("getSyncLogs", limit || 50),
					onSyncCompleted: (callback) => {
						if (typeof callback === "function") {
							syncCallbacks.push(callback);
						}
					},
					getDbStats: () => invoke("getDbStats"),
					getImagesDir: () => invoke("getImagesDir"),
					frappeCall: (method, args) => invoke("frappeCall", method || "", args || {}),
					getBootConfig: () => invoke("getBootConfig"),
					loadPosPage: () => invoke("loadPosPage"),
					getConfig: () => invoke("getConfig"),
					saveConfig: (config) => invoke("saveConfig", config || {}),
					notifyOnline: () => invoke("notifyOnline"),
				};

				resolve();
			});
		});
	}

	async function ensureDesktopBridge() {
		if (window.posAPI && window.electronAPI) {
			return;
		}

		if (typeof qt === "undefined") {
			return;
		}

		if (typeof QWebChannel === "undefined") {
			await loadScript("qrc:///qtwebchannel/qwebchannel.js");
		}

		await createPyQtBridge();
	}

	window._desktopBridgeReady = Promise.resolve().then(ensureDesktopBridge);
	window._pyqtBridgeReady = window._desktopBridgeReady;
})();
