import frappe
from frappe.custom.doctype.custom_field.custom_field import create_custom_field


def execute():
    if not frappe.db.exists("Custom Field", "POS Profile-posa_ui_mode"):
        create_custom_field(
            "POS Profile",
            {
                "fieldname": "posa_ui_mode",
                "label": "POS UI Mode",
                "fieldtype": "Select",
                "options": "Sensor\nLaptop",
                "default": "Sensor",
                "insert_after": "posa_allow_apply_offers",
                "description": (
                    "Sensor: ekran klaviaturasi bilan (monoblok/planshet). "
                    "Laptop: ekran klaviaturasi o'chiq (fizik klaviatura va sichqoncha)."
                ),
            },
        )
        frappe.db.commit()
