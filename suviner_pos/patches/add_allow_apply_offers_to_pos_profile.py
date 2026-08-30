import frappe
from frappe.custom.doctype.custom_field.custom_field import create_custom_field


def execute():
    if not frappe.db.exists("Custom Field", "POS Profile-posa_allow_apply_offers"):
        create_custom_field(
            "POS Profile",
            {
                "fieldname": "posa_allow_apply_offers",
                "label": "Allow Apply Offers",
                "fieldtype": "Check",
                "insert_after": "posa_allow_print_draft_invoices",
                "default": "1",
                "description": "If enabled, the Apply Offers button will be visible in the POS interface",
            },
        )
        frappe.db.commit()
