# Copyright (c) 2021, Youssef Restom and contributors
# For license information, please see license.txt


import frappe
from frappe import _
from frappe.model.mapper import get_mapped_doc
from frappe.utils import add_days, cint, flt

from suviner_pos.suviner_pos.api.utilities import get_company_domain  # Updated import
from suviner_pos.suviner_pos.api.payments import get_suviner_pos_credit_redeem_remark
from suviner_pos.suviner_pos.doctype.delivery_charges.delivery_charges import (
    get_applicable_delivery_charges,
)
from suviner_pos.suviner_pos.doctype.pos_coupon.pos_coupon import update_coupon_code_count


def validate(doc, method):
    validate_shift(doc)
    set_patient(doc)
    auto_set_delivery_charges(doc)
    calc_delivery_charges(doc)
    apply_tax_inclusive(doc)
    set_default_discount_account(doc)
    # Eng oxirida — yuqoridagilar summalarni qayta hisoblashi mumkin
    write_off_base_rounding_difference(doc)


def write_off_base_rounding_difference(doc, method=None):
    """Multi-valyuta POS chekida kompaniya valyutasidagi tiyin farqini
    POS Profile write_off_limit doirasida avtomatik hisobdan chiqaradi.

    Muammo (2026-09-03, chek ACC-SINV-2026-01174): chek UZS, kompaniya USD,
    kurs ~0.000084. ERPNext soliqsiz chekda base_grand_total = har tovar
    base_amount'ining (alohida sentgacha yaxlitlangan) yig'indisi (41.74),
    base_paid_amount esa to'lovlar yig'indisidan yaxlitlanadi (41.73).
    Natija: chek UZS'da 100% to'langan bo'lsa ham outstanding = 0.01 USD,
    status "Partly Paid", mijozda har savdodan tiyin qarz yig'iladi.

    ERPNext write_off_limit bo'yicha avto write-off'ni faqat "consolidated"
    (POS Invoice -> Sales Invoice) cheklarga qo'llaydi; bizniki to'g'ridan-
    to'g'ri Sales Invoice. Shuning uchun shu yerda: chek O'Z valyutasida
    to'liq to'langan bo'lsa va qolgan farq limitdan oshmasa — farq
    write_off_account'ga yoziladi (GL: Debtors kredit, write-off debet).

    write_off_amount chek valyutasida saqlanadi; base_write_off_amount undan
    kurs bilan hisoblanadi (calculate_taxes_and_totals), shuning uchun
    chek valyutasidagi qiymat kerakli base farqdan teskari hisoblanadi.
    """
    if doc.doctype != "Sales Invoice" or not cint(doc.get("is_pos")) or cint(doc.get("is_return")):
        return
    if cint(doc.get("is_consolidated")) or not doc.get("pos_profile"):
        return
    if doc.get("party_account_currency") == doc.get("currency"):
        return  # farq faqat valyutalar har xil bo'lganda yuzaga keladi

    grand_total = flt(doc.get("rounded_total") or doc.get("grand_total"))
    if grand_total <= 0:
        return
    tolerance = 1.0 / (10 ** doc.precision("grand_total"))
    if flt(doc.get("paid_amount")) + tolerance < grand_total:
        return  # chek o'z valyutasida to'liq to'lanmagan — haqiqiy qarz, tegilmaydi

    outstanding = flt(doc.get("outstanding_amount"), doc.precision("outstanding_amount"))
    if not outstanding:
        return

    profile = frappe.get_cached_value(
        "POS Profile", doc.pos_profile,
        ["write_off_limit", "write_off_account", "write_off_cost_center"], as_dict=True,
    ) or {}
    limit = flt(profile.get("write_off_limit"))
    account = doc.get("write_off_account") or profile.get("write_off_account")
    if not limit or abs(outstanding) > limit or not account:
        return

    rate = flt(doc.get("conversion_rate")) or 1.0
    target_base = flt(doc.get("base_write_off_amount")) + outstanding
    doc.write_off_account = account
    doc.write_off_cost_center = doc.get("write_off_cost_center") or profile.get("write_off_cost_center")
    doc.write_off_amount = flt(target_base / rate, doc.precision("write_off_amount"))
    doc.calculate_taxes_and_totals()

    # Kurs juda kichik bo'lganda chek valyutasidagi yaxlitlash base'da
    # kerakli tiyinga tushmasligi mumkin — bir necha qadam tuzatiladi.
    step = 1.0 / (10 ** doc.precision("write_off_amount"))
    for _i in range(50):
        remaining = flt(doc.get("outstanding_amount"), doc.precision("outstanding_amount"))
        if not remaining:
            break
        doc.write_off_amount = flt(doc.write_off_amount + (step if remaining > 0 else -step), doc.precision("write_off_amount"))
        doc.calculate_taxes_and_totals()

    frappe.logger("suviner_pos").info(
        "Rounding write-off %s: outstanding %s %s -> write_off %s %s (base %s)",
        doc.name, outstanding, doc.get("party_account_currency"),
        doc.write_off_amount, doc.currency, doc.get("base_write_off_amount"),
    )


def set_default_discount_account(doc):
    """Chegirmali qatorlarga kompaniya standart chegirma hisobini to'ldiradi.

    ERPNext make_discount_gl_entries faqat item.discount_account bo'lganda
    chegirmani alohida hisobga (gross daromad + chegirma debeti) yozadi, lekin
    discount_account'ni Item/Item Group/Brand default'laridan qidiradi —
    Company.default_discount_account'ga o'zi tushmaydi. Har bir tovarga default
    kiritib chiqmaslik uchun shu yerda to'ldiramiz.
    """
    if not frappe.db.get_single_value("Selling Settings", "enable_discount_accounting"):
        return
    default_account = None
    for item in doc.get("items", []):
        if not flt(item.get("discount_amount")) or item.get("discount_account"):
            continue
        if default_account is None:
            default_account = (
                frappe.get_cached_value("Company", doc.company, "default_discount_account") or ""
            )
        if default_account:
            item.discount_account = default_account


def before_submit(doc, method):
    add_loyalty_point(doc)
    create_sales_order(doc)
    update_coupon(doc, "used")


def before_cancel(doc, method):
    update_coupon(doc, "cancelled")


def on_cancel(doc, method):
    cancel_suviner_pos_credit_journal_entries(doc)


def cancel_suviner_pos_credit_journal_entries(doc):
    remark = get_suviner_pos_credit_redeem_remark(doc.name)
    linked_journal_entries = frappe.get_all(
        "Journal Entry",
        filters={"docstatus": 1, "user_remark": remark},
        pluck="name",
    )

    for journal_entry in linked_journal_entries:
        je_doc = frappe.get_doc("Journal Entry", journal_entry)

        if je_doc.docstatus != 1:
            continue

        has_reference = any(
            d.reference_type == doc.doctype and d.reference_name == doc.name for d in je_doc.accounts
        )

        if not has_reference:
            continue

        try:
            je_doc.cancel()
        except Exception:
            frappe.log_error(
                frappe.get_traceback(),
                "Suviner POS Credit Journal Cancellation Error",
            )
            frappe.throw(
                _(
                    "Unable to cancel Journal Entry {0} linked to this invoice. Please cancel it manually and try again."
                ).format(journal_entry)
            )


def add_loyalty_point(invoice_doc):
    for offer in getattr(invoice_doc, "posa_offers", []):
        if offer.offer == "Loyalty Point":
            original_offer = frappe.get_doc("POS Offer", offer.offer_name)
            if original_offer.loyalty_points > 0:
                loyalty_program = frappe.get_value("Customer", invoice_doc.customer, "loyalty_program")
                if not loyalty_program:
                    loyalty_program = original_offer.loyalty_program
                doc = frappe.get_doc(
                    {
                        "doctype": "Loyalty Point Entry",
                        "loyalty_program": loyalty_program,
                        "loyalty_program_tier": original_offer.name,
                        "customer": invoice_doc.customer,
                        "invoice_type": "Sales Invoice",
                        "invoice": invoice_doc.name,
                        "loyalty_points": original_offer.loyalty_points,
                        "expiry_date": add_days(invoice_doc.posting_date, 10000),
                        "posting_date": invoice_doc.posting_date,
                        "company": invoice_doc.company,
                    }
                )
                doc.insert(ignore_permissions=True)


def create_sales_order(doc):
    if (
        getattr(doc, "posa_pos_opening_shift", None)
        and doc.pos_profile
        and doc.is_pos
        and getattr(doc, "posa_delivery_date", None)
        and not doc.update_stock
        and frappe.get_value("POS Profile", doc.pos_profile, "posa_allow_sales_order")
    ):
        sales_order_doc = make_sales_order(doc.name)
        if sales_order_doc:
            sales_order_doc.posa_notes = getattr(doc, "posa_notes", None)
            sales_order_doc.flags.ignore_permissions = True
            sales_order_doc.flags.ignore_account_permission = True
            sales_order_doc.save()
            sales_order_doc.submit()
            url = frappe.utils.get_url_to_form(sales_order_doc.doctype, sales_order_doc.name)
            msgprint = f"Sales Order Created at <a href='{url}'>{sales_order_doc.name}</a>"
            frappe.msgprint(_(msgprint), title="Sales Order Created", indicator="green", alert=True)
            i = 0
            for item in sales_order_doc.items:
                doc.items[i].sales_order = sales_order_doc.name
                doc.items[i].so_detail = item.name
                i += 1


def make_sales_order(source_name, target_doc=None, ignore_permissions=True):
    def set_missing_values(source, target):
        target.ignore_pricing_rule = 1
        target.flags.ignore_permissions = ignore_permissions
        target.run_method("set_missing_values")
        target.run_method("calculate_taxes_and_totals")

    def update_item(obj, target, source_parent):
        target.stock_qty = flt(obj.qty) * flt(obj.conversion_factor)
        target.delivery_date = getattr(obj, "posa_delivery_date", None) or getattr(
            source_parent, "posa_delivery_date", None
        )

    doclist = get_mapped_doc(
        "Sales Invoice",
        source_name,
        {
            "Sales Invoice": {
                "doctype": "Sales Order",
            },
            "Sales Invoice Item": {
                "doctype": "Sales Order Item",
                "field_map": {
                    "cost_center": "cost_center",
                    "Warehouse": "warehouse",
                    "delivery_date": "posa_delivery_date",
                    "posa_notes": "posa_notes",
                },
                "postprocess": update_item,
            },
            "Sales Taxes and Charges": {
                "doctype": "Sales Taxes and Charges",
                "add_if_empty": True,
            },
            "Sales Team": {"doctype": "Sales Team", "add_if_empty": True},
            "Payment Schedule": {"doctype": "Payment Schedule", "add_if_empty": True},
        },
        target_doc,
        set_missing_values,
        ignore_permissions=ignore_permissions,
    )

    return doclist


def update_coupon(doc, transaction_type):
    for coupon in getattr(doc, "posa_coupons", []):
        if not coupon.applied:
            continue
        update_coupon_code_count(coupon.coupon, transaction_type)


def set_patient(doc):
    domain = get_company_domain(doc.company)
    if domain != "Healthcare":
        return
    patient_list = frappe.get_all("Patient", filters={"customer": doc.customer}, page_length=1)
    if len(patient_list) > 0:
        doc.patient = patient_list[0].name


def auto_set_delivery_charges(doc):
    if not doc.pos_profile:
        return
    if not frappe.get_cached_value("POS Profile", doc.pos_profile, "posa_auto_set_delivery_charges"):
        return

    delivery_charges = get_applicable_delivery_charges(
        doc.company,
        doc.pos_profile,
        doc.customer,
        doc.shipping_address_name,
        doc.posa_delivery_charges,
        restrict=True,
    )

    if doc.posa_delivery_charges:
        if doc.posa_delivery_charges_rate:
            return
        else:
            if len(delivery_charges) > 0:
                doc.posa_delivery_charges_rate = delivery_charges[0].rate
    else:
        if len(delivery_charges) > 0:
            doc.posa_delivery_charges = delivery_charges[0].name
            doc.posa_delivery_charges_rate = delivery_charges[0].rate
        else:
            doc.posa_delivery_charges = None
            doc.posa_delivery_charges_rate = None


def calc_delivery_charges(doc):
    if not doc.pos_profile:
        return

    old_doc = None
    calculate_taxes_and_totals = False
    if not doc.is_new():
        old_doc = doc.get_doc_before_save()
        if not doc.posa_delivery_charges and not old_doc.posa_delivery_charges:
            return
    else:
        if not doc.posa_delivery_charges:
            return
    if not doc.posa_delivery_charges:
        doc.posa_delivery_charges_rate = 0

    charges_doc = None
    if doc.posa_delivery_charges:
        charges_doc = frappe.get_cached_doc("Delivery Charges", doc.posa_delivery_charges)
        doc.posa_delivery_charges_rate = charges_doc.default_rate
        charges_profile = next((i for i in charges_doc.profiles if i.pos_profile == doc.pos_profile), None)
        if charges_profile:
            doc.posa_delivery_charges_rate = charges_profile.rate
        conversion_rate = doc.conversion_rate or 1
        doc.posa_delivery_charges_rate = flt(
            doc.posa_delivery_charges_rate / conversion_rate,
            doc.precision("posa_delivery_charges_rate"),
        )

    if old_doc and old_doc.posa_delivery_charges:
        old_charges = next(
            (
                i
                for i in doc.taxes
                if i.charge_type == "Actual" and i.description == old_doc.posa_delivery_charges
            ),
            None,
        )
        if old_charges:
            doc.taxes.remove(old_charges)
            calculate_taxes_and_totals = True

    if doc.posa_delivery_charges:
        doc.append(
            "taxes",
            {
                "charge_type": "Actual",
                "description": doc.posa_delivery_charges,
                "tax_amount": doc.posa_delivery_charges_rate,
                "cost_center": charges_doc.cost_center,
                "account_head": charges_doc.shipping_account,
            },
        )
        calculate_taxes_and_totals = True

    if calculate_taxes_and_totals:
        doc.calculate_taxes_and_totals()


def apply_tax_inclusive(doc):
    """Mark taxes as inclusive based on POS Profile setting."""
    if not doc.pos_profile:
        return
    try:
        tax_inclusive = frappe.get_cached_value("POS Profile", doc.pos_profile, "posa_tax_inclusive")
    except Exception:
        tax_inclusive = 0

    has_changes = False
    for tax in doc.get("taxes", []):
        if tax.charge_type == "Actual":
            if tax.included_in_print_rate:
                tax.included_in_print_rate = 0
                has_changes = True
        continue
        if tax_inclusive and not tax.included_in_print_rate:
            tax.included_in_print_rate = 1
            has_changes = True
        elif not tax_inclusive and tax.included_in_print_rate:
            tax.included_in_print_rate = 0
            has_changes = True
    if has_changes:
        doc.calculate_taxes_and_totals()


def validate_shift(doc):
    if doc.posa_pos_opening_shift and doc.pos_profile and doc.is_pos:
        # check if shift is open
        shift = frappe.get_cached_doc("POS Opening Shift", doc.posa_pos_opening_shift)
        if shift.status != "Open":
            frappe.throw(_("POS Shift {0} is not open").format(shift.name))
        # check if shift is for the same profile
        if shift.pos_profile != doc.pos_profile:
            frappe.throw(_("POS Opening Shift {0} is not for the same POS Profile").format(shift.name))
        # check if shift is for the same company
        if shift.company != doc.company:
            frappe.throw(_("POS Opening Shift {0} is not for the same company").format(shift.name))
