import { createVuetify } from "vuetify";
import { createApp } from "vue";
import VueDatePicker from "@vuepic/vue-datepicker";
import "@vuepic/vue-datepicker/dist/main.css";
import "../../../posawesome/public/css/rtl.css";
import "../style.css";
import "./styles/theme.css";
import eventBus from "./bus";
import themePlugin from "./plugins/theme.js";
import { pinia } from "./stores/index.js";
import * as components from "vuetify/components";
import * as directives from "vuetify/directives";
import Home from "./Home.vue";
import { attachProfilerHelpers, initLongTaskObserver, isPerfEnabled } from "./utils/perf.js";

attachProfilerHelpers();

// Suppress frappe's default connection lost/online notifications
// POS Awesome has its own status indicator in the navbar
function suppressFrappeConnectionAlerts() {
	if (typeof window !== "undefined") {
		// Store original handlers to prevent frappe's alerts
		const originalShowAlert = frappe.show_alert;
		frappe.show_alert = function (opts, seconds, actions) {
			// Check if this is a connection-related message
			const message = typeof opts === "string" ? opts : opts?.message || "";
			const indicator = typeof opts === "object" ? opts?.indicator : null;

			// Skip connection lost/online notifications - POS has its own indicator
			if (
				message.toLowerCase().includes("connection lost") ||
				message.toLowerCase().includes("connected to internet") ||
				message.toLowerCase().includes("not connected")
			) {
				// Silently ignore - POS navbar shows connection status
				return;
			}
			// Allow other alerts to pass through
			return originalShowAlert.call(this, opts, seconds, actions);
		};

		// Also suppress the window online/offline events that frappe listens to
		// by removing frappe's handlers and adding our own that do nothing
		$(window).off("online.frappe offline.frappe");
	}
}

// Call immediately
suppressFrappeConnectionAlerts();

// Ensure frappe is available
if (typeof frappe === "undefined") {
	console.error("Frappe is not defined");
} else {
	frappe.provide("frappe.PosApp");
}

frappe.PosApp.posapp = class {
	constructor({ parent }) {
		this.$parent = $(document);
		this.page = parent?.page || parent;
		this.make_body();
	}
	make_body() {
		this.$el = this.$parent.find(".main-section");
		const vuetify = createVuetify({
			components,
			directives,
			locale: {
				rtl: frappe.utils.is_rtl(),
			},
			theme: {
				defaultTheme: "light",
				themes: {
					light: {
						colors: {
							background: "#FFFFFF",
							primary: "#0097A7",
							secondary: "#00BCD4",
							accent: "#FF6B35",
							success: "#66BB6A",
							info: "#2196F3",
							warning: "#FF9800",
							error: "#E86674",
							orange: "#E65100",
							golden: "#A68C59",
							badge: "#F5528C",
							customPrimary: "#085294",
						},
					},
					dark: {
						dark: true,
						colors: {
							background: "#121212",
							surface: "#1E1E1E",
							primary: "#00D4FF",
							primaryVariant: "#00A0CC",
							secondary: "#03DAC6",
							accent: "#FF6B35",
							success: "#66BB6A",
							info: "#2196F3",
							warning: "#FF9800",
							error: "#CF6679",
							orange: "#FF6F00",
							golden: "#A68C59",
							badge: "#F5528C",
							customPrimary: "#4FC3F7",
							onBackground: "#FFFFFF",
							onSurface: "#FFFFFF",
							divider: "#373737",
						},
					},
				},
			},
		});
		const app = createApp(Home);
		app.component("VueDatePicker", VueDatePicker);
		app.use(pinia);
		app.use(eventBus);
		app.use(vuetify);
		app.use(themePlugin, { vuetify });
		app.mount(this.$el[0]);

		// Global listener for background submission errors
		frappe.realtime.on("pos_invoice_submit_error", (data) => {
			if (data.user === frappe.session.user) {
				const message = data.error || __("Unknown error during background submission");
				const invoice = data.invoice || "";
				frappe.msgprint({
					title: __("Invoice Submission Failed"),
					message: __("Background processing failed for Invoice {0}: {1}", [invoice, message]),
					indicator: "red",
				});
				// Also emit to local event bus if needed for UI updates
				eventBus.emit("show_message", {
					title: __("Background Submission Failed"),
					text: message,
					color: "error",
					timeout: 8000,
				});
			}
		});

		if (isPerfEnabled()) {
			initLongTaskObserver("posapp");
		}
	}
	setup_header() {}
};
