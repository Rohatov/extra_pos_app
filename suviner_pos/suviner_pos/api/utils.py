from __future__ import annotations

import json
import logging
from functools import cache

import frappe

# Reusable ORM filter to exclude template items
HAS_VARIANTS_EXCLUSION = {"has_variants": 0}


logger = logging.getLogger(__name__)


def expand_item_groups(item_groups):
    """Expand any parent item groups to include their children.

    This function takes a list of item groups and expands any parent groups
    to include all their descendants, while keeping leaf groups as-is.
    """
    if not item_groups:
        return item_groups

    try:
        from erpnext.utilities.doctype.item_group.item_group import get_child_groups
    except Exception:
        get_child_groups = None

    expanded_groups = set()
    for group in item_groups:
        if not group:
            continue

        # Check if this is a parent group
        is_group = frappe.db.get_value("Item Group", group, "is_group")

        if is_group:
            # If it's a parent group, get all its children
            if get_child_groups:
                try:
                    descendants = get_child_groups(group) or []
                    expanded_groups.update(descendants)
                except Exception:
                    # Fallback to database method
                    descendants = frappe.db.get_descendants("Item Group", group) or []
                    expanded_groups.update(descendants)
            else:
                descendants = frappe.db.get_descendants("Item Group", group) or []
                expanded_groups.update(descendants)
        else:
            # If it's a leaf group, add it directly
            expanded_groups.add(group)

    return list(expanded_groups)


@frappe.whitelist()
def get_offline_data(company, price_list):
    """Return taxes and pricing rules for offline sync."""
    taxes = frappe.get_all(
        "Sales Taxes and Charges Template",
        filters={"company": company, "disabled": 0},
        fields=["name", "title", "is_default"]
    )
    
    # Get details for each tax template
    for t in taxes:
        t.taxes = frappe.get_doc("Sales Taxes and Charges Template", t.name).taxes
        
    from suviner_pos.suviner_pos.api.pricing_rules import get_active_pricing_rules
    pricing_rules = get_active_pricing_rules(company=company, price_list=price_list)
    
    return {
        "taxes": taxes,
        "pricing_rules": pricing_rules
    }

@frappe.whitelist()
def get_translations(lang):
    from frappe.translate import get_all_translations
    return get_all_translations(lang)

@frappe.whitelist()
def get_api_keys():
    """Return API key and secret for the current user, generating them if necessary."""
    user = frappe.get_doc("User", frappe.session.user)
    if not user.api_key:
        user.api_key = frappe.generate_hash(length=15)
        user.save(ignore_permissions=True)
    
    # Try to get existing secret, if not found, generate one
    api_secret = user.get_password("api_secret")
    if not api_secret:
        api_secret = frappe.generate_hash(length=15)
        user.api_secret = api_secret
        user.save(ignore_permissions=True)
    
    return {
        "api_key": user.api_key,
        "api_secret": api_secret
    }

@frappe.whitelist()
def get_active_pos_profile(user=None):
    """Return the active POS profile for the given user."""
    user = user or frappe.session.user
    profile = frappe.db.get_value("POS Profile User", {"user": user}, "parent")
    if not profile:
        profile = frappe.db.get_single_value("POS Settings", "pos_profile")
    if not profile:
        return None
    return frappe.get_doc("POS Profile", profile).as_dict()


@frappe.whitelist()
def get_default_warehouse(company=None):
    """Return the default warehouse for the given company."""
    company = company or frappe.defaults.get_default("company")
    if not company:
        return None
    warehouse = frappe.db.get_value("Company", company, "default_warehouse")
    if not warehouse:
        warehouse = frappe.db.get_single_value("Stock Settings", "default_warehouse")
    return warehouse


def fetch_sales_person_names():
    """Return the list of enabled sales persons allowed for the active POS profile."""

    logger.info("Fetching sales persons...")

    try:
        profile = get_active_pos_profile()
        allowed = []
        if profile:
            allowed = [
                d.get("sales_person") for d in profile.get("posa_sales_persons", []) if d.get("sales_person")
            ]

        filters = {"enabled": 1}
        if allowed:
            filters["name"] = ["in", allowed]

        sales_persons = frappe.get_list(
            "Sales Person",
            filters=filters,
            fields=["name", "sales_person_name"],
            limit_page_length=100000,
        )

        logger.info(
            "Found %s sales persons: %s",
            len(sales_persons),
            json.dumps(sales_persons),
        )

        return sales_persons
    except Exception as exc:
        logger.exception("Error fetching sales persons")
        frappe.log_error(
            f"Error fetching sales persons: {exc}",
            "POS Sales Person Error",
        )
        return []


@cache
def get_item_groups(pos_profile: str) -> list[str]:
    """Return all item groups for a POS profile, including descendants.

    The linked groups from the ``POS Item Group`` child table are
    expanded to include all of their descendants. Results are cached
    to avoid duplicate database calls within a process.


    """
    if not pos_profile or not frappe.db.exists("DocType", "POS Item Group"):
        return []

    groups = frappe.get_all(
        "POS Item Group",
        filters={"parent": pos_profile},
        pluck="item_group",
    )

    return expand_item_groups(groups)
