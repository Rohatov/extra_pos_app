app_name = "suviner_pos"
app_title = "Suviner POS"
app_publisher = "Youssef Restom"
app_description = "Suviner POS"
app_icon = "octicon octicon-file-directory"
app_color = "grey"
app_email = "youssef@totrox.com"
app_license = "GPLv3"

# Includes in <head>
# ------------------

# include js, css files in header of desk.html
# Web POS frontend olib tashlangan — bu app faqat backend API sifatida
# ishlaydi (desktop POS klienti uchun). Hech qanday JS/CSS yuklanmaydi.
# app_include_css = "/assets/suviner_pos/css/suviner_pos.css"
# app_include_js = "/assets/suviner_pos/js/suviner_pos.js"

# include js, css files in header of web template
# web_include_css = "/assets/suviner_pos/css/suviner_pos.css"
# web_include_js = "/assets/suviner_pos/js/suviner_pos.js"

# include js, css files in header of web form
# webform_include_js = {"doctype": "public/js/doctype.js"}
# webform_include_css = {"doctype": "public/css/doctype.css"}

# include js in page
# page_js = {"page" : "public/js/file.js"}

# include js in doctype views
doctype_js = {
    "POS Profile": "suviner_pos/api/pos_profile.js",
    "Sales Invoice": "suviner_pos/api/invoice.js",
    "Company": "suviner_pos/api/company.js",
}
# doctype_list_js = {"doctype" : "public/js/doctype_list.js"}
# doctype_tree_js = {"doctype" : "public/js/doctype_tree.js"}
# doctype_calendar_js = {"doctype" : "public/js/doctype_calendar.js"}

# Home Pages
# ----------

# application home page (will override Website Settings)
# home_page = "login"

# website user home page (by Role)
# role_home_page = {
# 	"Role": "home_page"
# }

# Website user home page (by function)
# get_website_user_home_page = "suviner_pos.utils.get_home_page"

# Generators
# ----------

# automatically create page for each record of this doctype
# website_generators = ["Web Page"]

# Installation
# ------------

# before_install = "suviner_pos.install.before_install"
# after_install = "suviner_pos.install.after_install"
# before_uninstall = "suviner_pos.uninstall.before_uninstall"
after_uninstall = "suviner_pos.uninstall.after_uninstall"

# Desk Notifications
# ------------------
# See frappe.core.notifications.get_notification_config

# notification_config = "suviner_pos.notifications.get_notification_config"

# Permissions
# -----------
# Permissions evaluated in scripted ways

# permission_query_conditions = {
# 	"Event": "frappe.desk.doctype.event.event.get_permission_query_conditions",
# }
#
# has_permission = {
# 	"Event": "frappe.desk.doctype.event.event.has_permission",
# }

# Document Events
# ---------------
# Hook on document methods and events

doc_events = {
    "Sales Invoice": {
        "validate": "suviner_pos.suviner_pos.api.invoice.validate",
        "before_submit": "suviner_pos.suviner_pos.api.invoice.before_submit",
        "before_cancel": "suviner_pos.suviner_pos.api.invoice.before_cancel",
    },
    "POS Invoice": {
        "validate": "suviner_pos.suviner_pos.api.invoice.validate",
        "before_submit": "suviner_pos.suviner_pos.api.invoice.before_submit",
        "before_cancel": "suviner_pos.suviner_pos.api.invoice.before_cancel",
    },
    "Customer": {
        "validate": "suviner_pos.suviner_pos.api.customer.validate",
        "after_insert": "suviner_pos.suviner_pos.api.customer.after_insert",
    },
    # PIN bilan kirish: Applicable for Users jadvalidagi PIN 4 ta raqam bo'lsin
    "POS Profile": {
        "validate": "suviner_pos.suviner_pos.api.pin_auth.validate_pos_profile_pins",
    },
}

# Scheduled Tasks
# ---------------

# scheduler_events = {
# 	"all": [
# 		"suviner_pos.tasks.all"
# 	],
# 	"daily": [
# 		"suviner_pos.tasks.daily"
# 	],
# 	"hourly": [
# 		"suviner_pos.tasks.hourly"
# 	],
# 	"weekly": [
# 		"suviner_pos.tasks.weekly"
# 	]
# 	"monthly": [
# 		"suviner_pos.tasks.monthly"
# 	]
# }

# Testing
# -------

# before_tests = "suviner_pos.install.before_tests"

# Overriding Methods
# ------------------------------
#
# override_whitelisted_methods = {
# 	"frappe.desk.doctype.event.event.get_events": "suviner_pos.event.get_events"
# }
#
# each overriding function accepts a `data` argument;
# generated from the base implementation of the doctype dashboard,
# along with any modifications made in other Frappe apps
# override_doctype_dashboards = {
# 	"Task": "suviner_pos.task.get_dashboard_data"
# }

# Override standard DocTypes with custom classes
override_doctype_class = {
    "POS Invoice": "suviner_pos.suviner_pos.overrides.pos_invoice.CustomPOSInvoice",
    "POS Invoice Merge Log": "suviner_pos.suviner_pos.overrides.pos_invoice_merge_log.CustomPOSInvoiceMergeLog",
}

# exempt linked doctypes from being automatically cancelled
#
# auto_cancel_exempted_doctypes = ["Auto Repeat"]

fixtures = [
    {
        "doctype": "Custom Field",
        "filters": [
            [
                "name",
                "in",
                (
                    "Address-posa_delivery_charges",
                    "Batch-posa_batch_price",
                    "Company-posa_auto_referral",
                    "Company-posa_column_break_22",
                    "Company-posa_customer_offer",
                    "Company-posa_primary_offer",
                    "Company-posa_referral_campaign",
                    "Company-posa_referral_section",
                    "Customer-posa_birthday",
                    "Customer-posa_discount",
                    "Customer-posa_referral_code",
                    "Customer-posa_referral_company",
                    "Customer-posa_referral_section",
                    "Item Barcode-posa_uom",
                    "POS Invoice Item-posa_delivery_date",
                    "POS Invoice Item-posa_is_offer",
                    "POS Invoice Item-posa_is_replace",
                    "POS Invoice Item-posa_notes",
                    "POS Invoice Item-posa_offer_applied",
                    "POS Invoice Item-posa_offers",
                    "POS Invoice Item-posa_row_id",
                    "POS Invoice-posa_additional_notes_section",
                    "POS Invoice-posa_authorization_code",
                    "POS Invoice-posa_column_break_111",
                    "POS Invoice-posa_coupons",
                    "POS Invoice-posa_delivery_charges",
                    "POS Invoice-posa_delivery_charges_rate",
                    "POS Invoice-posa_delivery_date",
                    "POS Invoice-posa_is_printed",
                    "POS Invoice-posa_notes",
                    "POS Invoice-posa_offers",
                    "POS Invoice-posa_pos_opening_shift",
                    "POS Invoice-posa_return_valid_upto",
                    "POS Profile-column_break_uolvm",
                    "POS Profile-create_pos_invoice_instead_of_sales_invoice",
                    "POS Profile-pos_awesome_payments",
                    "POS Profile-posa_allow_apply_offers",
                    "POS Profile-posa_allow_credit_sale",
                    "POS Profile-posa_allow_delete",
                    "POS Profile-posa_allow_duplicate_customer_names",
                    "POS Profile-posa_allow_free_batch_return",
                    "POS Profile-posa_allow_make_new_payments",
                    "POS Profile-posa_allow_mpesa_reconcile_payments",
                    "POS Profile-posa_allow_multi_currency",
                    "POS Profile-posa_allow_partial_payment",
                    "POS Profile-posa_allow_pos_discount",
                    "POS Profile-posa_allow_reconcile_payments",
                    "POS Profile-posa_allow_return_without_invoice",
                    "POS Profile-posa_allow_sales_order",
                    "POS Profile-posa_allow_submissions_in_background_job",
                    "POS Profile-posa_allow_user_to_edit_rate",
                    "POS Profile-posa_alternative_price_list",
                    "POS Profile-posa_apply_customer_discount",
                    "POS Profile-posa_auto_set_batch",
                    "POS Profile-posa_auto_set_delivery_charges",
                    "POS Profile-posa_block_sale_beyond_available_qty",
                    "POS Profile-posa_cash_mode_of_payment",
                    "POS Profile-posa_col_1",
                    "POS Profile-posa_display_items_in_stock",
                    "POS Profile-posa_force_reload_items",
                    "POS Profile-posa_hide_variants_items",
                    "POS Profile-posa_language",
                    "POS Profile-posa_max_discount_allowed",
                    "POS Profile-posa_pos_awesome_settings",
                    "POS Profile-posa_search_batch_no",
                    "POS Profile-posa_search_limit",
                    "POS Profile-posa_search_serial_no",
                    "POS Profile-posa_server_cache_duration",
                    "POS Profile-posa_show_template_items",
                    "POS Profile-posa_tax_inclusive",
                    "POS Profile-posa_ui_mode",
                    "POS Profile-posa_use_limit_search",
                    "POS Profile-posa_use_pos_awesome_payments",
                    "POS Profile-posa_use_server_cache",
                    "POS Profile User-posa_pin",
                    "POS Settings-posa_enable_return_validity",
                    "POS Settings-posa_return_validity_days",
                    "Sales Invoice Item-name_overridden",
                    "Sales Invoice Item-posa_delivery_date",
                    "Sales Invoice Item-posa_is_offer",
                    "Sales Invoice Item-posa_is_replace",
                    "Sales Invoice Item-posa_notes",
                    "Sales Invoice Item-posa_offer_applied",
                    "Sales Invoice Item-posa_offers",
                    "Sales Invoice Item-posa_row_id",
                    "Sales Invoice Reference-pos_invoice",
                    "Sales Invoice-posa_additional_notes_section",
                    "Sales Invoice-posa_authorization_code",
                    "Sales Invoice-posa_column_break_111",
                    "Sales Invoice-posa_coupons",
                    "Sales Invoice-posa_delivery_charges",
                    "Sales Invoice-posa_delivery_charges_rate",
                    "Sales Invoice-posa_delivery_date",
                    "Sales Invoice-posa_is_printed",
                    "Sales Invoice-posa_notes",
                    "Sales Invoice-posa_offers",
                    "Sales Invoice-posa_offline_id",
                    "Sales Invoice-posa_pos_opening_shift",
                    "Sales Invoice-posa_return_valid_upto",
                    "Sales Order Item-posa_notes",
                    "Sales Order Item-posa_row_id",
                    "Sales Order-posa_additional_notes_section",
                    "Sales Order-posa_coupons",
                    "Sales Order-posa_notes",
                    "Sales Order-posa_offers",
                    "Warehouse-posa_show_in_pos",
                ),
            ]
        ],
    },
    {
        "doctype": "Property Setter",
        "filters": [
            [
                "name",
                "in",
                (
                    "Sales Invoice-posa_pos_opening_shift-no_copy",
                    "POS Invoice-posa_pos_opening_shift-no_copy",
                    "Sales Invoice Reference-sales_invoice-reqd",
                    "Sales Invoice-update_outstanding_for_self-default",
                ),
            ]
        ],
    },
]
