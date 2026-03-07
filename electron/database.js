/**
 * database.js — SQLite offline-first data layer for POS Awesome Desktop.
 *
 * Uses better-sqlite3 (synchronous) for all local CRUD and
 * Electron's net module for sync with the remote ERPNext server.
 */

const path = require("path");
const fs = require("fs");
const { app, net } = require("electron");

let Database;
try {
	Database = require("better-sqlite3");
} catch (err) {
	console.error("[database] better-sqlite3 not found. Run: npm install better-sqlite3");
	Database = null;
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------
let db = null;

function getDbPath() {
	return path.join(app.getPath("userData"), "pos_local.db");
}

function open() {
	if (db) return db;
	if (!Database) {
		throw new Error("better-sqlite3 is not installed");
	}
	const dbPath = getDbPath();
	db = new Database(dbPath);
	db.pragma("journal_mode = WAL");
	db.pragma("foreign_keys = ON");
	db.pragma("busy_timeout = 5000");
	createTables();
	migrateSchema();
	console.log("[database] Opened", dbPath);
	return db;
}

function close() {
	if (db) {
		db.close();
		db = null;
		console.log("[database] Closed");
	}
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

function getImagesDir() {
	const dir = path.join(app.getPath("userData"), "images");
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir, { recursive: true });
	}
	return dir;
}

function createTables() {
	db.exec(`
		CREATE TABLE IF NOT EXISTS items (
			item_code    TEXT PRIMARY KEY,
			item_name    TEXT NOT NULL DEFAULT '',
			item_group   TEXT DEFAULT '',
			description  TEXT DEFAULT '',
			image        TEXT DEFAULT '',
			local_image_path TEXT DEFAULT '',
			stock_uom    TEXT DEFAULT 'Nos',
			has_batch_no  INTEGER DEFAULT 0,
			has_serial_no INTEGER DEFAULT 0,
			is_stock_item INTEGER DEFAULT 1,
			rate         REAL DEFAULT 0,
			price_list_rate REAL DEFAULT 0,
			actual_qty   REAL DEFAULT 0,
			barcode      TEXT DEFAULT '',
			extra        TEXT DEFAULT '{}',
			updated_at   TEXT DEFAULT (datetime('now'))
		);

		CREATE TABLE IF NOT EXISTS customers (
			name            TEXT PRIMARY KEY,
			customer_name   TEXT NOT NULL DEFAULT '',
			customer_group  TEXT DEFAULT '',
			territory       TEXT DEFAULT '',
			mobile_no       TEXT DEFAULT '',
			email_id        TEXT DEFAULT '',
			tax_id          TEXT DEFAULT '',
			extra           TEXT DEFAULT '{}',
			updated_at      TEXT DEFAULT (datetime('now'))
		);

		CREATE TABLE IF NOT EXISTS invoices (
			id             INTEGER PRIMARY KEY AUTOINCREMENT,
			local_name     TEXT UNIQUE NOT NULL,
			server_name    TEXT DEFAULT '',
			customer       TEXT NOT NULL,
			customer_name  TEXT DEFAULT '',
			grand_total    REAL DEFAULT 0,
			net_total      REAL DEFAULT 0,
			total_qty      REAL DEFAULT 0,
			posting_date   TEXT,
			posting_time   TEXT,
			status         TEXT DEFAULT 'pending',
			sync_error     TEXT DEFAULT '',
			invoice_data   TEXT NOT NULL DEFAULT '{}',
			created_at     TEXT DEFAULT (datetime('now')),
			synced_at      TEXT
		);

		CREATE TABLE IF NOT EXISTS payments (
			id              INTEGER PRIMARY KEY AUTOINCREMENT,
			invoice_id      INTEGER NOT NULL,
			mode_of_payment TEXT NOT NULL DEFAULT '',
			amount          REAL DEFAULT 0,
			extra           TEXT DEFAULT '{}',
			FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
		);

		CREATE TABLE IF NOT EXISTS settings (
			key   TEXT PRIMARY KEY,
			value TEXT
		);

		CREATE TABLE IF NOT EXISTS sync_log (
			id         INTEGER PRIMARY KEY AUTOINCREMENT,
			type       TEXT NOT NULL,
			status     TEXT NOT NULL,
			message    TEXT DEFAULT '',
			created_at TEXT DEFAULT (datetime('now'))
		);

		CREATE INDEX IF NOT EXISTS idx_items_group   ON items(item_group);
		CREATE INDEX IF NOT EXISTS idx_items_name    ON items(item_name);
		CREATE INDEX IF NOT EXISTS idx_items_barcode ON items(barcode);
		CREATE INDEX IF NOT EXISTS idx_cust_name     ON customers(customer_name);
		CREATE INDEX IF NOT EXISTS idx_cust_mobile   ON customers(mobile_no);
		CREATE INDEX IF NOT EXISTS idx_inv_status    ON invoices(status);
		CREATE INDEX IF NOT EXISTS idx_inv_date      ON invoices(posting_date);
	`);
}

function migrateSchema() {
	// Add local_image_path column if missing (upgrade from older schema)
	try {
		const cols = db.prepare("PRAGMA table_info(items)").all();
		const hasLocalImage = cols.some((c) => c.name === "local_image_path");
		if (!hasLocalImage) {
			db.exec("ALTER TABLE items ADD COLUMN local_image_path TEXT DEFAULT ''");
			console.log("[database] Migration: added local_image_path column");
		}
	} catch (err) {
		console.warn("[database] Migration check failed:", err.message);
	}
}

// ---------------------------------------------------------------------------
// Settings helpers
// ---------------------------------------------------------------------------

function getSetting(key) {
	const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key);
	return row ? row.value : null;
}

function setSetting(key, value) {
	db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(
		key,
		typeof value === "string" ? value : JSON.stringify(value),
	);
}

// ---------------------------------------------------------------------------
// ITEMS CRUD
// ---------------------------------------------------------------------------

const upsertItemStmt = () =>
	db.prepare(`
	INSERT INTO items (item_code, item_name, item_group, description, image, local_image_path,
		stock_uom, has_batch_no, has_serial_no, is_stock_item,
		rate, price_list_rate, actual_qty, barcode, extra, updated_at)
	VALUES (@item_code, @item_name, @item_group, @description, @image, @local_image_path,
		@stock_uom, @has_batch_no, @has_serial_no, @is_stock_item,
		@rate, @price_list_rate, @actual_qty, @barcode, @extra, datetime('now'))
	ON CONFLICT(item_code) DO UPDATE SET
		item_name=excluded.item_name, item_group=excluded.item_group,
		description=excluded.description, image=excluded.image,
		local_image_path=CASE WHEN excluded.local_image_path != '' THEN excluded.local_image_path ELSE items.local_image_path END,
		stock_uom=excluded.stock_uom, has_batch_no=excluded.has_batch_no,
		has_serial_no=excluded.has_serial_no, is_stock_item=excluded.is_stock_item,
		rate=excluded.rate, price_list_rate=excluded.price_list_rate,
		actual_qty=excluded.actual_qty, barcode=excluded.barcode,
		extra=excluded.extra, updated_at=datetime('now')
`);

function upsertItems(items) {
	if (!items || !items.length) return 0;
	const stmt = upsertItemStmt();
	const run = db.transaction((rows) => {
		let count = 0;
		for (const raw of rows) {
			const barcodes = Array.isArray(raw.item_barcode)
				? raw.item_barcode.map((b) => b.barcode).filter(Boolean)
				: raw.barcode
					? [String(raw.barcode)]
					: [];
			stmt.run({
				item_code: raw.item_code || "",
				item_name: raw.item_name || "",
				item_group: raw.item_group || "",
				description: raw.description || "",
				image: raw.image || "",
				local_image_path: raw.local_image_path || "",
				stock_uom: raw.stock_uom || "Nos",
				has_batch_no: raw.has_batch_no ? 1 : 0,
				has_serial_no: raw.has_serial_no ? 1 : 0,
				is_stock_item: raw.is_stock_item !== undefined ? (raw.is_stock_item ? 1 : 0) : 1,
				rate: raw.rate || 0,
				price_list_rate: raw.price_list_rate || raw.rate || 0,
				actual_qty: raw.actual_qty || 0,
				barcode: barcodes.join(","),
				extra: JSON.stringify(raw),
			});
			count++;
		}
		return count;
	});
	return run(items);
}

function getItems({ search = "", item_group = "", limit = 200, offset = 0 } = {}) {
	let sql = "SELECT * FROM items WHERE 1=1";
	const params = {};

	if (item_group && item_group !== "ALL") {
		sql += " AND item_group = @item_group";
		params.item_group = item_group;
	}
	if (search) {
		sql += " AND (item_name LIKE @search OR item_code LIKE @search OR barcode LIKE @search)";
		params.search = `%${search}%`;
	}
	sql += " ORDER BY item_name ASC LIMIT @limit OFFSET @offset";
	params.limit = limit;
	params.offset = offset;

	const rows = db.prepare(sql).all(params);
	return rows.map(hydrateItem);
}

function getItemByCode(itemCode) {
	const row = db.prepare("SELECT * FROM items WHERE item_code = ?").get(itemCode);
	return row ? hydrateItem(row) : null;
}

function getItemByBarcode(barcode) {
	const row = db
		.prepare("SELECT * FROM items WHERE barcode LIKE ? LIMIT 1")
		.get(`%${barcode}%`);
	return row ? hydrateItem(row) : null;
}

function getItemsCount() {
	const row = db.prepare("SELECT COUNT(*) as cnt FROM items").get();
	return row ? row.cnt : 0;
}

function hydrateItem(row) {
	let extra = {};
	try {
		extra = JSON.parse(row.extra || "{}");
	} catch (_) {
		/* ignore */
	}
	return {
		...extra,
		item_code: row.item_code,
		item_name: row.item_name,
		item_group: row.item_group,
		description: row.description,
		image: row.image,
		local_image_path: row.local_image_path || "",
		stock_uom: row.stock_uom,
		has_batch_no: row.has_batch_no,
		has_serial_no: row.has_serial_no,
		is_stock_item: row.is_stock_item,
		rate: row.rate,
		price_list_rate: row.price_list_rate,
		actual_qty: row.actual_qty,
	};
}

// ---------------------------------------------------------------------------
// CUSTOMERS CRUD
// ---------------------------------------------------------------------------

function upsertCustomers(customers) {
	if (!customers || !customers.length) return 0;
	const stmt = db.prepare(`
		INSERT INTO customers (name, customer_name, customer_group, territory,
			mobile_no, email_id, tax_id, extra, updated_at)
		VALUES (@name, @customer_name, @customer_group, @territory,
			@mobile_no, @email_id, @tax_id, @extra, datetime('now'))
		ON CONFLICT(name) DO UPDATE SET
			customer_name=excluded.customer_name, customer_group=excluded.customer_group,
			territory=excluded.territory, mobile_no=excluded.mobile_no,
			email_id=excluded.email_id, tax_id=excluded.tax_id,
			extra=excluded.extra, updated_at=datetime('now')
	`);
	const run = db.transaction((rows) => {
		let count = 0;
		for (const c of rows) {
			stmt.run({
				name: c.name || c.customer_name || "",
				customer_name: c.customer_name || c.name || "",
				customer_group: c.customer_group || "",
				territory: c.territory || "",
				mobile_no: c.mobile_no || "",
				email_id: c.email_id || "",
				tax_id: c.tax_id || "",
				extra: JSON.stringify(c),
			});
			count++;
		}
		return count;
	});
	return run(customers);
}

function getCustomers({ search = "", limit = 100, offset = 0 } = {}) {
	let sql = "SELECT * FROM customers WHERE 1=1";
	const params = {};
	if (search) {
		sql +=
			" AND (customer_name LIKE @search OR name LIKE @search OR mobile_no LIKE @search OR email_id LIKE @search)";
		params.search = `%${search}%`;
	}
	sql += " ORDER BY customer_name ASC LIMIT @limit OFFSET @offset";
	params.limit = limit;
	params.offset = offset;

	const rows = db.prepare(sql).all(params);
	return rows.map((r) => {
		let extra = {};
		try {
			extra = JSON.parse(r.extra || "{}");
		} catch (_) {
			/* ignore */
		}
		return { ...extra, ...r };
	});
}

function getCustomersCount() {
	const row = db.prepare("SELECT COUNT(*) as cnt FROM customers").get();
	return row ? row.cnt : 0;
}

// ---------------------------------------------------------------------------
// INVOICES (offline queue)
// ---------------------------------------------------------------------------

function saveInvoice(invoicePayload) {
	if (!invoicePayload || !invoicePayload.items || !invoicePayload.items.length) {
		throw new Error("Cart is empty. Add items before saving.");
	}

	const now = new Date();
	const pad = (v) => String(v).padStart(2, "0");
	const localName = `offline-${now.getTime()}-${Math.random().toString(36).slice(2, 8)}`;
	const postingDate =
		invoicePayload.posting_date ||
		`${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
	const postingTime =
		invoicePayload.posting_time ||
		`${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

	const result = db
		.prepare(
			`INSERT INTO invoices (local_name, customer, customer_name, grand_total,
			net_total, total_qty, posting_date, posting_time, status, invoice_data)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
		)
		.run(
			localName,
			invoicePayload.customer || "",
			invoicePayload.customer_name || "",
			invoicePayload.grand_total || 0,
			invoicePayload.net_total || 0,
			invoicePayload.total_qty || 0,
			postingDate,
			postingTime,
			JSON.stringify(invoicePayload),
		);

	const invoiceId = result.lastInsertRowid;

	// Save payments
	if (invoicePayload.payments && invoicePayload.payments.length) {
		const payStmt = db.prepare(
			`INSERT INTO payments (invoice_id, mode_of_payment, amount, extra) VALUES (?, ?, ?, ?)`,
		);
		for (const p of invoicePayload.payments) {
			payStmt.run(invoiceId, p.mode_of_payment || "", p.amount || 0, JSON.stringify(p));
		}
	}

	// Reduce local stock
	deductLocalStock(invoicePayload.items);

	logSync("save_invoice", "success", `Saved offline: ${localName}`);
	return { id: invoiceId, local_name: localName };
}

function getPendingInvoices() {
	return db.prepare("SELECT * FROM invoices WHERE status = 'pending' ORDER BY created_at ASC").all();
}

function getPendingCount() {
	const row = db.prepare("SELECT COUNT(*) as cnt FROM invoices WHERE status = 'pending'").get();
	return row ? row.cnt : 0;
}

function markInvoiceSynced(id, serverName) {
	db.prepare("UPDATE invoices SET status = 'synced', server_name = ?, synced_at = datetime('now') WHERE id = ?").run(
		serverName || "",
		id,
	);
}

function markInvoiceFailed(id, error) {
	db.prepare("UPDATE invoices SET status = 'failed', sync_error = ? WHERE id = ?").run(
		String(error || "Unknown error").slice(0, 2000),
		id,
	);
}

function getAllInvoices({ status = "", limit = 100, offset = 0 } = {}) {
	let sql = "SELECT * FROM invoices WHERE 1=1";
	const params = {};
	if (status) {
		sql += " AND status = @status";
		params.status = status;
	}
	sql += " ORDER BY created_at DESC LIMIT @limit OFFSET @offset";
	params.limit = limit;
	params.offset = offset;
	return db.prepare(sql).all(params);
}

function deleteInvoice(id) {
	db.prepare("DELETE FROM invoices WHERE id = ?").run(id);
}

// ---------------------------------------------------------------------------
// Stock tracking
// ---------------------------------------------------------------------------

function deductLocalStock(items) {
	const stmt = db.prepare("UPDATE items SET actual_qty = MAX(0, actual_qty - ?) WHERE item_code = ?");
	db.transaction(() => {
		for (const item of items) {
			const qty = Math.abs(item.qty || 0);
			if (qty > 0) {
				stmt.run(qty, item.item_code);
			}
		}
	})();
}

function getLocalStock(itemCode) {
	const row = db.prepare("SELECT actual_qty FROM items WHERE item_code = ?").get(itemCode);
	return row ? row.actual_qty : 0;
}

// ---------------------------------------------------------------------------
// Sync log
// ---------------------------------------------------------------------------

function logSync(type, status, message) {
	db.prepare("INSERT INTO sync_log (type, status, message) VALUES (?, ?, ?)").run(
		type,
		status,
		(message || "").slice(0, 4000),
	);
	// Keep only last 500 entries
	db.prepare("DELETE FROM sync_log WHERE id NOT IN (SELECT id FROM sync_log ORDER BY id DESC LIMIT 500)").run();
}

function getRecentSyncLogs(limit = 50) {
	return db.prepare("SELECT * FROM sync_log ORDER BY id DESC LIMIT ?").all(limit);
}

// ---------------------------------------------------------------------------
// ERPNext HTTP helper
// ---------------------------------------------------------------------------

/**
 * Make an authenticated request to the ERPNext server.
 * Uses Electron's `net` module (respects proxy / session).
 */
function erpRequest(serverUrl, apiKey, apiSecret, { method = "GET", endpoint = "", body = null } = {}) {
	return new Promise((resolve, reject) => {
		const base = serverUrl.replace(/\/+$/, "");
		const url = `${base}${endpoint}`;

		const options = { method, url };
		const request = net.request(options);

		request.setHeader("Authorization", `token ${apiKey}:${apiSecret}`);
		request.setHeader("Content-Type", "application/json");
		request.setHeader("Accept", "application/json");

		let responseData = "";

		request.on("response", (response) => {
			response.on("data", (chunk) => {
				responseData += chunk.toString();
			});
			response.on("end", () => {
				try {
					const parsed = JSON.parse(responseData);
					if (response.statusCode >= 200 && response.statusCode < 300) {
						resolve(parsed);
					} else {
						const errMsg = parsed.exc || parsed._server_messages || parsed.message || responseData;
						reject(new Error(`HTTP ${response.statusCode}: ${errMsg}`));
					}
				} catch (_) {
					if (response.statusCode >= 200 && response.statusCode < 300) {
						resolve(responseData);
					} else {
						reject(new Error(`HTTP ${response.statusCode}: ${responseData.slice(0, 500)}`));
					}
				}
			});
		});

		request.on("error", (err) => reject(err));

		if (body && method !== "GET") {
			request.write(JSON.stringify(body));
		}
		request.end();
	});
}

// ---------------------------------------------------------------------------
// SYNC: Pull items from ERPNext → SQLite
// ---------------------------------------------------------------------------

async function pullItems(serverUrl, apiKey, apiSecret, posProfile, priceList) {
	const result = await erpRequest(serverUrl, apiKey, apiSecret, {
		method: "POST",
		endpoint: "/api/method/posawesome.posawesome.api.items.get_items",
		body: {
			pos_profile: typeof posProfile === "string" ? posProfile : JSON.stringify(posProfile),
			price_list: priceList || "",
			item_group: "",
			search_value: "",
			include_image: 1,
		},
	});

	const items = result.message || [];
	if (items.length) {
		const count = upsertItems(items);
		logSync("pull_items", "success", `Synced ${count} items from server`);
		return count;
	}
	logSync("pull_items", "success", "No items returned from server");
	return 0;
}

// ---------------------------------------------------------------------------
// SYNC: Pull customers from ERPNext → SQLite
// ---------------------------------------------------------------------------

async function pullCustomers(serverUrl, apiKey, apiSecret) {
	const result = await erpRequest(serverUrl, apiKey, apiSecret, {
		method: "GET",
		endpoint:
			"/api/resource/Customer?fields=[\"name\",\"customer_name\",\"customer_group\",\"territory\",\"mobile_no\",\"email_id\",\"tax_id\"]&limit_page_length=0&filters=[[\"disabled\",\"=\",0]]",
	});

	const customers = result.data || [];
	if (customers.length) {
		const count = upsertCustomers(customers);
		logSync("pull_customers", "success", `Synced ${count} customers from server`);
		return count;
	}
	logSync("pull_customers", "success", "No customers returned from server");
	return 0;
}

// ---------------------------------------------------------------------------
// SYNC: Push pending invoices SQLite → ERPNext
// ---------------------------------------------------------------------------

async function pushInvoices(serverUrl, apiKey, apiSecret) {
	const pending = getPendingInvoices();
	if (!pending.length) return { pending: 0, synced: 0, failed: 0 };

	let synced = 0;
	let failed = 0;

	for (const row of pending) {
		let invoiceData;
		try {
			invoiceData = JSON.parse(row.invoice_data);
		} catch (_) {
			markInvoiceFailed(row.id, "Invalid JSON in invoice_data");
			failed++;
			continue;
		}

		// Remove offline name so backend creates a new document
		if (invoiceData.name && String(invoiceData.name).startsWith("offline")) {
			delete invoiceData.name;
		}
		if (invoiceData.items) {
			invoiceData.items = invoiceData.items.map((item) => {
				const clean = { ...item };
				if (clean.name && String(clean.name).startsWith("offline")) {
					delete clean.name;
				}
				return clean;
			});
		}

		invoiceData.posting_date = row.posting_date || invoiceData.posting_date;
		invoiceData.posting_time = row.posting_time || invoiceData.posting_time;
		invoiceData.set_posting_time = 1;

		try {
			const res = await erpRequest(serverUrl, apiKey, apiSecret, {
				method: "POST",
				endpoint: "/api/method/posawesome.posawesome.api.invoices.submit_invoice",
				body: {
					invoice: JSON.stringify(invoiceData),
					data: JSON.stringify({}),
				},
			});

			const serverName = res.message?.name || res.message || "";
			markInvoiceSynced(row.id, String(serverName));
			synced++;
		} catch (err) {
			console.error(`[sync] Failed to push invoice ${row.local_name}:`, err.message);
			markInvoiceFailed(row.id, err.message);
			failed++;
		}
	}

	const msg = `Push complete: ${synced} synced, ${failed} failed out of ${pending.length}`;
	logSync("push_invoices", failed ? "partial" : "success", msg);
	return { pending: pending.length, synced, failed };
}

// ---------------------------------------------------------------------------
// Image downloading for offline use
// ---------------------------------------------------------------------------

/**
 * Download a single image from the server and save it locally.
 * Returns the local file path or empty string on failure.
 */
function downloadImage(serverUrl, apiKey, apiSecret, remoteImagePath) {
	return new Promise((resolve) => {
		if (!remoteImagePath) {
			resolve("");
			return;
		}

		const base = serverUrl.replace(/\/+$/, "");
		// Handle both absolute URLs and relative paths
		const imageUrl = remoteImagePath.startsWith("http")
			? remoteImagePath
			: `${base}${remoteImagePath.startsWith("/") ? "" : "/"}${remoteImagePath}`;

		// Create a safe filename from the path (Windows-compatible)
		const ext = path.extname(remoteImagePath) || ".jpg";
		const WINDOWS_RESERVED = /^(CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9])$/i;
		let safeName = remoteImagePath
			.replace(/[^a-zA-Z0-9._-]/g, "_")
			.replace(/_+/g, "_")
			.slice(-100);
		if (WINDOWS_RESERVED.test(safeName.replace(/\.[^.]*$/, ""))) {
			safeName = `_${safeName}`;
		}
		const localPath = path.join(getImagesDir(), `${safeName}${safeName.endsWith(ext) ? "" : ext}`);

		// Skip if already downloaded
		if (fs.existsSync(localPath)) {
			resolve(localPath);
			return;
		}

		try {
			const request = net.request(imageUrl);
			request.setHeader("Authorization", `token ${apiKey}:${apiSecret}`);

			const chunks = [];
			request.on("response", (response) => {
				if (response.statusCode < 200 || response.statusCode >= 300) {
					resolve("");
					return;
				}
				response.on("data", (chunk) => chunks.push(chunk));
				response.on("end", () => {
					try {
						const buffer = Buffer.concat(chunks);
						if (buffer.length > 0) {
							fs.writeFileSync(localPath, buffer);
							resolve(localPath);
						} else {
							resolve("");
						}
					} catch (err) {
						console.warn("[images] Failed to save image:", err.message);
						resolve("");
					}
				});
			});

			request.on("error", (err) => {
				console.warn("[images] Failed to download image:", err.message);
				resolve("");
			});

			request.end();
		} catch (err) {
			console.warn("[images] Request error:", err.message);
			resolve("");
		}
	});
}

/**
 * Download images for all items that have a remote image but no local copy.
 * Runs after item sync to populate local_image_path.
 */
async function downloadItemImages(serverUrl, apiKey, apiSecret) {
	const rows = db
		.prepare("SELECT item_code, image FROM items WHERE image != '' AND (local_image_path IS NULL OR local_image_path = '')")
		.all();

	if (!rows.length) return 0;

	const updateStmt = db.prepare("UPDATE items SET local_image_path = ? WHERE item_code = ?");
	let downloaded = 0;

	for (const row of rows) {
		const localPath = await downloadImage(serverUrl, apiKey, apiSecret, row.image);
		if (localPath) {
			updateStmt.run(localPath, row.item_code);
			downloaded++;
		}
	}

	if (downloaded > 0) {
		logSync("download_images", "success", `Downloaded ${downloaded} images`);
	}
	return downloaded;
}

/**
 * Get the local file path for an item's image. Returns empty string if not available.
 */
function getItemImagePath(itemCode) {
	const row = db.prepare("SELECT local_image_path FROM items WHERE item_code = ?").get(itemCode);
	return row ? row.local_image_path || "" : "";
}

// ---------------------------------------------------------------------------
// Full SYNC orchestrator
// ---------------------------------------------------------------------------

async function fullSync(serverUrl, apiKey, apiSecret, posProfile, priceList) {
	const results = { items: 0, customers: 0, images: 0, invoices: { synced: 0, failed: 0 } };

	try {
		results.invoices = await pushInvoices(serverUrl, apiKey, apiSecret);
	} catch (err) {
		console.error("[sync] Push invoices error:", err.message);
		logSync("push_invoices", "error", err.message);
	}

	try {
		results.items = await pullItems(serverUrl, apiKey, apiSecret, posProfile, priceList);
	} catch (err) {
		console.error("[sync] Pull items error:", err.message);
		logSync("pull_items", "error", err.message);
	}

	try {
		results.customers = await pullCustomers(serverUrl, apiKey, apiSecret);
	} catch (err) {
		console.error("[sync] Pull customers error:", err.message);
		logSync("pull_customers", "error", err.message);
	}

	// Download images after items are synced
	try {
		results.images = await downloadItemImages(serverUrl, apiKey, apiSecret);
	} catch (err) {
		console.error("[sync] Download images error:", err.message);
		logSync("download_images", "error", err.message);
	}

	return results;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
	open,
	close,
	getDbPath,
	getImagesDir,
	// Settings
	getSetting,
	setSetting,
	// Items
	upsertItems,
	getItems,
	getItemByCode,
	getItemByBarcode,
	getItemsCount,
	// Images
	downloadImage,
	downloadItemImages,
	getItemImagePath,
	// Customers
	upsertCustomers,
	getCustomers,
	getCustomersCount,
	// Invoices
	saveInvoice,
	getPendingInvoices,
	getPendingCount,
	markInvoiceSynced,
	markInvoiceFailed,
	getAllInvoices,
	deleteInvoice,
	// Stock
	deductLocalStock,
	getLocalStock,
	// Sync log
	logSync,
	getRecentSyncLogs,
	// Sync with ERPNext
	erpRequest,
	pullItems,
	pullCustomers,
	pushInvoices,
	fullSync,
};
