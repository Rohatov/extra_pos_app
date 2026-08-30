import frappe
from frappe.custom.doctype.custom_field.custom_field import create_custom_field


def execute():
    """"Kam to'lov = chegirma" mexanizmi olib tashlandi.

    O'rniga aniq ruxsat maydoni keladi: posa_allow_pos_discount — savatdagi
    "Chegirma" tugmasi va Jami summani tahrirlash. Egasi eski flag orqali
    bergan ruxsatlar yangi maydonga ko'chiriladi, eski maydon o'chadi.
    """
    if not frappe.db.exists("Custom Field", "POS Profile-posa_allow_pos_discount"):
        create_custom_field(
            "POS Profile",
            {
                "fieldname": "posa_allow_pos_discount",
                "label": "Kassir chegirma bera oladi",
                "fieldtype": "Check",
                "default": "0",
                "insert_after": "posa_allow_user_to_edit_rate",
                "description": "Savatdagi Chegirma tugmasi va Jami summani tahrirlash ruxsati.",
            },
        )

    # Eski ruxsat qiymatini ko'chiramiz (ustun hali mavjud bo'lsa)
    if frappe.db.has_column("POS Profile", "posa_allow_user_to_edit_additional_discount"):
        frappe.db.sql(
            """
            UPDATE `tabPOS Profile`
            SET posa_allow_pos_discount = posa_allow_user_to_edit_additional_discount
            """
        )

    # Eski Custom Field o'chadi (fixtures'dan ham olib tashlangan)
    old = "POS Profile-posa_allow_user_to_edit_additional_discount"
    if frappe.db.exists("Custom Field", old):
        frappe.delete_doc("Custom Field", old, ignore_permissions=True, force=True)

    frappe.clear_cache(doctype="POS Profile")
    frappe.db.commit()
