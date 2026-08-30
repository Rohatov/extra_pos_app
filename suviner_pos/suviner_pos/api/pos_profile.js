// Copyright (c) 20201 Youssef Restom and contributors
// For license information, please see license.txt

frappe.ui.form.on("POS Profile", {
	setup: function (frm) {
		frm.set_query("posa_cash_mode_of_payment", function (doc) {
			return {
				filters: { type: "Cash" },
			};
		});
		// posa_language maydoni olib tashlangan (desktop POS o'z tiliga ega) —
		// unga tegishli kod ham olib tashlandi.
	},
});
