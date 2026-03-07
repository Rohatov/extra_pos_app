/**
 * frappe-shim.js — Drop-in replacement for the frappe global object.
 *
 * This shim is loaded BEFORE the Vue application in the standalone
 * Electron build. It provides the same API surface that the POS
 * frontend expects (`frappe.call`, `frappe.session`, `frappe.utils`, etc.)
 * but routes everything through Electron IPC → main process → HTTP.
 *
 * No web server is needed — the app loads from local files.
 */

(function () {
	"use strict";

	// ── helpers ──────────────────────────────────────────────────────
	function noop() {}

	function nowDate() {
		const d = new Date();
		const pad = (v) => String(v).padStart(2, "0");
		return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
	}

	function nowDatetime() {
		return new Date().toISOString().replace("T", " ").slice(0, 19);
	}

	function cint(v) {
		const n = parseInt(v, 10);
		return isNaN(n) ? 0 : n;
	}

	function cstr(v) {
		return v == null ? "" : String(v);
	}

	function stripHtml(html) {
		if (!html) return "";
		const div = document.createElement("div");
		div.innerHTML = html;
		return div.textContent || div.innerText || "";
	}

	function escapeHtml(str) {
		if (!str) return "";
		return String(str)
			.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;")
			.replace(/"/g, "&quot;")
			.replace(/'/g, "&#039;");
	}

	function isRtl() {
		// Stored in boot config or detected from language
		const lang = window._frappe_boot?.lang || "en";
		return ["ar", "he", "fa", "ur"].includes(lang);
	}

	// ── Audio ────────────────────────────────────────────────────────
	const soundMap = {
		submit: "/assets/frappe/sounds/submit.mp3",
		cancel: "/assets/frappe/sounds/cancel.mp3",
		error: "/assets/frappe/sounds/error.mp3",
		click: "/assets/frappe/sounds/click.mp3",
		delete: "/assets/frappe/sounds/delete.mp3",
	};

	function playSound(name) {
		try {
			// Use a simple beep for Electron standalone
			const ctx = new (window.AudioContext || window.webkitAudioContext)();
			const osc = ctx.createOscillator();
			const gain = ctx.createGain();
			osc.connect(gain);
			gain.connect(ctx.destination);
			gain.gain.value = 0.1;

			if (name === "error") {
				osc.frequency.value = 300;
			} else if (name === "submit") {
				osc.frequency.value = 800;
			} else {
				osc.frequency.value = 600;
			}

			osc.start();
			osc.stop(ctx.currentTime + 0.15);
		} catch (_) {
			// Silently ignore audio errors
		}
	}

	// ── Translation ──────────────────────────────────────────────────
	// Translation dictionary loaded at boot from server or local cache
	let _translations = {};

	function __(msg, replace, context) {
		if (!msg) return "";
		let translated = _translations[msg] || msg;

		// Handle {0}, {1} style replacements
		if (replace && Array.isArray(replace)) {
			replace.forEach((val, idx) => {
				translated = translated.replace(new RegExp(`\\{${idx}\\}`, "g"), cstr(val));
			});
		}
		return translated;
	}

	// ── Event Bus for frappe.realtime ────────────────────────────────
	const _realtimeHandlers = {};

	const realtime = {
		on(event, fn) {
			if (!_realtimeHandlers[event]) _realtimeHandlers[event] = [];
			_realtimeHandlers[event].push(fn);
		},
		off(event, fn) {
			if (!_realtimeHandlers[event]) return;
			_realtimeHandlers[event] = _realtimeHandlers[event].filter((f) => f !== fn);
		},
		emit(event, data) {
			(_realtimeHandlers[event] || []).forEach((fn) => fn(data));
		},
		publish(event, data) {
			this.emit(event, data);
		},
		socket: {
			readyState: 1, // OPEN — pretend connected
			connected: true,
		},
	};

	// ── frappe.call — the heart of the shim ──────────────────────────
	//
	// Routes through Electron IPC: renderer → preload → main → HTTP to ERPNext
	//
	async function frappeCall(opts) {
		if (typeof opts === "string") {
			opts = { method: opts };
		}

		const { method, args, callback, error: errorCb, async: isAsync = true, freeze } = opts;

		try {
			const result = await window.posAPI.frappeCall(method, args || {});

			// frappe.call returns { message: ... } — backend response is in result
			const response = result;

			if (callback) callback(response);
			return response;
		} catch (err) {
			console.error(`[frappe.call] ${method} failed:`, err.message);
			if (errorCb) {
				errorCb(err);
			} else {
				// Show error to user
				frappe.show_alert({
					message: err.message || "Server request failed",
					indicator: "red",
				});
			}
			throw err;
		}
	}

	// ── frappe.xcall — promisified frappe.call ───────────────────────
	function frappeXcall(method, args) {
		return frappeCall({ method, args });
	}

	// ── frappe.db — document database operations ─────────────────────
	const db = {
		async get_value(doctype, filters, fieldname) {
			const r = await frappeCall({
				method: "frappe.client.get_value",
				args: { doctype, filters, fieldname },
			});
			return r;
		},

		async get_doc(doctype, name) {
			const r = await window.posAPI.frappeCall(
				"frappe.client.get",
				{ doctype, name },
			);
			return r.message || r;
		},

		async get_list(doctype, opts = {}) {
			const r = await frappeCall({
				method: "frappe.client.get_list",
				args: { doctype, ...opts },
			});
			return r.message || [];
		},

		async set_value(doctype, name, fieldname, value) {
			const r = await frappeCall({
				method: "frappe.client.set_value",
				args: { doctype, name, fieldname, value },
			});
			return r;
		},
	};

	// ── frappe.ui.Dialog — real DOM dialog for Electron ──────────────
	class SimpleDialog {
		constructor(opts = {}) {
			this.title = opts.title || "";
			this.fields = opts.fields || [];
			this.primary_action_label = opts.primary_action_label || "OK";
			this.primary_action = opts.primary_action || noop;
			this.secondary_action = opts.secondary_action || null;
			this._values = {};
			this.onhide = null;

			// Build actual DOM
			this._backdrop = document.createElement("div");
			this._backdrop.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:9998;display:none;";

			const wrap = document.createElement("div");
			wrap.style.cssText = "position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:#fff;border-radius:8px;min-width:360px;max-width:90vw;max-height:80vh;overflow:auto;z-index:9999;display:none;padding:24px;box-shadow:0 8px 32px rgba(0,0,0,0.3);color:#333;";
			wrap.innerHTML = `<h3 style="margin:0 0 16px 0;font-size:18px;">${escapeHtml(this.title)}</h3><div class="dialog-body"></div><div class="dialog-actions" style="margin-top:16px;text-align:right;"><button class="btn-primary" style="padding:8px 20px;background:#0097A7;color:#fff;border:none;border-radius:4px;cursor:pointer;">${escapeHtml(this.primary_action_label)}</button></div>`;

			// Render fields
			const body = wrap.querySelector(".dialog-body");
			for (const field of this.fields) {
				if (field.fieldtype === "HTML") {
					const div = document.createElement("div");
					div.innerHTML = field.options || "";
					body.appendChild(div);
				} else if (field.fieldtype === "Select") {
					const label = document.createElement("label");
					label.textContent = field.label || field.fieldname;
					label.style.cssText = "display:block;margin-bottom:4px;font-weight:600;";
					const select = document.createElement("select");
					select.style.cssText = "width:100%;padding:8px;border:1px solid #ccc;border-radius:4px;margin-bottom:12px;";
					const options = typeof field.options === "string" ? field.options.split("\n") : (field.options || []);
					for (const opt of options) {
						const o = document.createElement("option");
						o.value = opt;
						o.textContent = opt;
						select.appendChild(o);
					}
					select.addEventListener("change", () => { this._values[field.fieldname] = select.value; });
					if (options.length) this._values[field.fieldname] = options[0];
					body.appendChild(label);
					body.appendChild(select);
				} else {
					const label = document.createElement("label");
					label.textContent = field.label || field.fieldname;
					label.style.cssText = "display:block;margin-bottom:4px;font-weight:600;";
					const input = document.createElement("input");
					input.type = "text";
					input.style.cssText = "width:100%;padding:8px;border:1px solid #ccc;border-radius:4px;margin-bottom:12px;box-sizing:border-box;";
					input.addEventListener("input", () => { this._values[field.fieldname] = input.value; });
					body.appendChild(label);
					body.appendChild(input);
				}
			}

			// Primary action button
			const btn = wrap.querySelector(".btn-primary");
			btn.addEventListener("click", () => {
				if (this.primary_action) this.primary_action(this._values);
			});

			// Backdrop click closes
			this._backdrop.addEventListener("click", () => this.hide());

			this._wrapper = wrap;
			document.body.appendChild(this._backdrop);
			document.body.appendChild(wrap);

			// jQuery-like $wrapper for code that does dialog.$wrapper.find(...)
			const self = this;
			this.$wrapper = {
				0: wrap,
				length: 1,
				find(selector) {
					const els = wrap.querySelectorAll(selector);
					const arr = Array.from(els);
					arr.on = function (evt, handler) {
						arr.forEach((el) => el.addEventListener(evt, handler));
						return arr;
					};
					arr.off = function (evt, handler) {
						arr.forEach((el) => el.removeEventListener(evt, handler));
						return arr;
					};
					arr.text = function () { return arr.map((e) => e.textContent).join(""); };
					return arr;
				},
				on(evt, handler) { wrap.addEventListener(evt, handler); return self.$wrapper; },
				off(evt, handler) { wrap.removeEventListener(evt, handler); return self.$wrapper; },
			};
		}

		show() {
			this._backdrop.style.display = "block";
			this._wrapper.style.display = "block";
			return this;
		}

		hide() {
			this._backdrop.style.display = "none";
			this._wrapper.style.display = "none";
			if (typeof this.onhide === "function") this.onhide();
			return this;
		}

		get_value(key) { return this._values[key]; }
		get_values() { return this._values; }
		set_value(key, val) { this._values[key] = val; return this; }
		set_values(vals) { Object.assign(this._values, vals); return this; }
	}

	const ui = {
		Dialog: SimpleDialog,
		set_theme: noop,
	};

	// ── frappe.show_alert ────────────────────────────────────────────
	function showAlert(opts, seconds, actions) {
		const message = typeof opts === "string" ? opts : opts?.message || "";
		const indicator = typeof opts === "object" ? opts?.indicator : null;
		console.log(`[alert${indicator ? `:${indicator}` : ""}] ${message}`);

		// Dispatch custom event so Vue components can pick it up
		window.dispatchEvent(
			new CustomEvent("frappe-alert", {
				detail: { message, indicator, seconds, actions },
			}),
		);
	}

	// ── frappe.msgprint ──────────────────────────────────────────────
	function msgprint(opts) {
		if (typeof opts === "string") opts = { message: opts };
		const msg = opts.message || "";
		const title = opts.title || "";
		const indicator = opts.indicator || "";

		console.log(`[msgprint${indicator ? `:${indicator}` : ""}] ${title ? title + ": " : ""}${msg}`);

		window.dispatchEvent(
			new CustomEvent("frappe-msgprint", {
				detail: { message: msg, title, indicator },
			}),
		);
	}

	// ── frappe.throw ─────────────────────────────────────────────────
	function frappeThrow(msg) {
		msgprint({ message: msg, indicator: "red" });
		throw new Error(msg);
	}

	// ── frappe.provide ───────────────────────────────────────────────
	function provide(path) {
		const parts = path.split(".");
		let obj = window;
		for (const part of parts) {
			if (!obj[part]) obj[part] = {};
			obj = obj[part];
		}
		return obj;
	}

	// ── URL helpers ──────────────────────────────────────────────────
	const urllib = {
		get_base_url() {
			return window._frappe_boot?.serverUrl || "";
		},
	};

	// ── frappe.set_route ─────────────────────────────────────────────
	function setRoute() {
		// In standalone Electron, route changes are no-ops
		// The app is a single-page POS interface
	}

	// ── Router stub ──────────────────────────────────────────────────
	const router = {
		current_route: ["app", "posapp"],
		slug: noop,
	};

	// ── Build the frappe global ──────────────────────────────────────
	const frappe = {
		call: frappeCall,
		xcall: frappeXcall,
		db,
		ui,
		realtime,
		urllib,
		router,

		show_alert: showAlert,
		msgprint,
		throw: frappeThrow,
		provide,
		set_route: setRoute,

		// Populated at boot
		session: {
			user: "",
			user_fullname: "",
			sid: "",
		},

		boot: {
			pos_profile: null,
			sysdefaults: {},
			lang: "en",
			use_western_numerals: true,
			website_settings: {},
		},

		datetime: {
			nowdate: nowDate,
			now_date: nowDate,
			now_datetime: nowDatetime,
			get_today: nowDate,
			str_to_obj(dateStr) {
				return new Date(dateStr);
			},
		},

		utils: {
			play_sound: playSound,
			is_rtl: isRtl,
			strip_html: stripHtml,
			escape_html: escapeHtml,
			cint,
			cstr,
			get_url(path) {
				const base = window._frappe_boot?.serverUrl || "";
				return base ? `${base}${path}` : path;
			},
		},

		// frappe.defaults — reads from boot.sysdefaults / user defaults
		defaults: {
			_user_defaults: {},
			get_default(key) {
				const sd = frappe.boot?.sysdefaults || {};
				if (key in sd) return sd[key];
				return this._user_defaults[key] || null;
			},
			get_user_default(key) {
				return this._user_defaults[key] || null;
			},
			get_global_default(key) {
				const sd = frappe.boot?.sysdefaults || {};
				return sd[key] || null;
			},
		},

		flags: {},

		// frappe.confirm stub
		confirm(message, onyes, onno) {
			if (window.confirm(message)) {
				if (onyes) onyes();
			} else {
				if (onno) onno();
			}
		},

		// frappe.format_currency
		format_currency(value, currency, precision) {
			const p = precision != null ? precision : 2;
			const num = parseFloat(value) || 0;
			return num.toFixed(p);
		},

		_: __,

		// POS Awesome namespace
		PosApp: {},
	};

	// ── Boot: Load config from Electron store at startup ─────────────
	async function boot() {
		try {
			const config = await window.posAPI.getBootConfig();
			if (config) {
				if (config.user) {
					frappe.session.user = config.user;
					frappe.session.user_fullname = config.user_fullname || config.user;
					frappe.session.sid = config.sid || "";
				}
				if (config.pos_profile) {
					frappe.boot.pos_profile = config.pos_profile;
				}
				if (config.sysdefaults) {
					frappe.boot.sysdefaults = config.sysdefaults;
				}
				if (config.lang) {
					frappe.boot.lang = config.lang;
				}
				if (config.use_western_numerals !== undefined) {
					frappe.boot.use_western_numerals = config.use_western_numerals;
				}
				if (config.website_settings) {
					frappe.boot.website_settings = config.website_settings;
				}
				if (config.serverUrl) {
					window._frappe_boot = window._frappe_boot || {};
					window._frappe_boot.serverUrl = config.serverUrl;
				}
				if (config.translations) {
					_translations = config.translations;
				}
				if (config.user_defaults) {
					frappe.defaults._user_defaults = config.user_defaults;
				}
			}
		} catch (err) {
			console.error("[frappe-shim] Boot config load failed:", err.message);
		}
	}

	// ── Expose globally ──────────────────────────────────────────────
	window.frappe = frappe;
	window.__ = __;
	window.cint = cint;
	window.cstr = cstr;

	// jQuery stub — some code uses $() and $(window)
	if (typeof window.$ === "undefined") {
		const jqStub = function (selector) {
			if (selector === window || selector === document) {
				return {
					off: noop,
					on: noop,
					find: (s) => jqStub(s),
					ready: (fn) => {
						if (document.readyState !== "loading") fn();
						else document.addEventListener("DOMContentLoaded", fn);
					},
				};
			}
			if (typeof selector === "function") {
				if (document.readyState !== "loading") selector();
				else document.addEventListener("DOMContentLoaded", selector);
				return;
			}
			const el = typeof selector === "string" ? document.querySelector(selector) : selector;
			return {
				0: el,
				length: el ? 1 : 0,
				find: (s) => jqStub(el?.querySelector(s)),
				off: () => jqStub(el),
				on: () => jqStub(el),
				text: () => el?.textContent || "",
			};
		};
		window.$ = jqStub;
		window.jQuery = jqStub;
	}

	// Boot and then signal ready
	window._frappeShimReady = boot().then(() => {
		console.log("[frappe-shim] Ready — user:", frappe.session.user);
		window.dispatchEvent(new Event("frappe-shim-ready"));
	});
})();
