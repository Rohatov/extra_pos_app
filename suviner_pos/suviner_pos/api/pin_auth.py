"""POS uchun PIN bilan kirish.

Model:
* PIN POS Profile -> "Applicable for Users" (POS Profile User) jadvalidagi
  `posa_pin` (Password) ustunida saqlanadi — userning Frappe paroliga
  ALOQASI YO'Q. Frappe Password maydonini `__Auth` jadvalida shifrlab
  saqlaydi, formada yulduzcha ko'rinadi.
* POS Desktop `pin_login(pos_profile, user, pin)` chaqiradi. PIN to'g'ri
  bo'lsa shu userning API kaliti (api_key/api_secret) qaytariladi — POS
  keyin hamma so'rovni kassir nomidan (`Authorization: token ...`) yuboradi,
  shuning uchun smena/chek mantiqi (`frappe.session.user`) o'zgarmaydi.
* API kalit yo'q bo'lsa bir marta yaratiladi va keyin QAYTA ISHLATILADI
  (Frappe'ning `generate_keys` har safar yangi secret yaratib, boshqa
  qurilmadagi sessiyani buzardi).

Xavfsizlik:
* Endpointlar login OLDIDAN chaqirilgani uchun `allow_guest`. Shu sababli
  bir user uchun ketma-ket xato PINlar cheklanadi: MAX_ATTEMPTS xatodan
  keyin LOCK_SECONDS qulf (Redis kesh — DB rollback'ga bog'liq emas).
* Qo'shimcha IP bo'yicha rate limit.
* PIN hech qachon javobda qaytarilmaydi va logga yozilmaydi.
* PIN qat'iy 4 ta raqam (POS Profile saqlanganda tekshiriladi).
"""

import hmac
import re

import frappe
from frappe import _
from frappe.rate_limiter import rate_limit
from frappe.utils import cint, now_datetime
from frappe.utils.password import get_decrypted_password, set_encrypted_password

PIN_RE = re.compile(r"^\d{4}$")
MAX_ATTEMPTS = 5
LOCK_SECONDS = 10 * 60


# ──────────────────────────────────────────────────────────────────────
#  POS Profile validate hook — PIN formati
# ──────────────────────────────────────────────────────────────────────
def validate_pos_profile_pins(doc, method=None):
    """POS Profile saqlanganda har bir qatordagi PIN 4 ta raqam ekanini
    tekshiradi. Saqlangan (yulduzcha ko'rinishdagi) qiymatlar tegilmaydi."""
    for row in doc.get("applicable_for_users") or []:
        pin = (row.get("posa_pin") or "").strip()
        if not pin or _is_dummy(pin):
            continue
        if not PIN_RE.match(pin):
            frappe.throw(
                _("Row #{0} ({1}): PIN must be exactly 4 digits").format(row.idx, row.user),
                title=_("Invalid PIN"),
            )


def _is_dummy(value: str) -> bool:
    return bool(value) and set(value) == {"*"}


# ──────────────────────────────────────────────────────────────────────
#  Yordamchilar
# ──────────────────────────────────────────────────────────────────────
def _profile_rows(pos_profile: str | None = None):
    """POS Profile User qatorlari. `pos_profile` berilmasa — barcha YOQILGAN
    profillardagi qatorlar (qurilma profilga bog'lanmaydi, kassir qaysi
    profilda bo'lsa o'sha bilan ishlaydi)."""
    pos_profile = (pos_profile or "").strip()
    if pos_profile:
        if not frappe.db.exists("POS Profile", pos_profile):
            frappe.throw(_("POS Profile {0} not found").format(pos_profile))
        if cint(frappe.db.get_value("POS Profile", pos_profile, "disabled")):
            frappe.throw(_("POS Profile {0} is disabled").format(pos_profile))
        profiles = [pos_profile]
    else:
        profiles = [p.name for p in frappe.get_all("POS Profile", filters={"disabled": 0}, fields=["name"])]
    if not profiles:
        return []
    return frappe.get_all(
        "POS Profile User",
        filters={"parent": ("in", profiles), "parenttype": "POS Profile"},
        fields=["name", "user", "default", "idx", "parent as pos_profile"],
        order_by="parent asc, idx asc",
    )


def _lock_key(user: str) -> str:
    return f"posa_pin_lock:{user}"


def _fail_key(user: str) -> str:
    return f"posa_pin_fail:{user}"


def _lock_remaining(user: str) -> int:
    """Qulf qolgan sekundlar (0 = qulf yo'q)."""
    cache = frappe.cache()
    if not cache.get_value(_lock_key(user)):
        return 0
    try:
        ttl = cint(cache.ttl(cache.make_key(_lock_key(user))))
    except Exception:
        ttl = LOCK_SECONDS
    return max(ttl, 1)


def _register_failure(user: str) -> int:
    """Xato urinishni qayd etadi; qolgan urinishlar sonini qaytaradi."""
    cache = frappe.cache()
    fails = cint(cache.get_value(_fail_key(user)) or 0) + 1
    cache.set_value(_fail_key(user), fails, expires_in_sec=LOCK_SECONDS)
    if fails >= MAX_ATTEMPTS:
        cache.set_value(_lock_key(user), now_datetime().isoformat(), expires_in_sec=LOCK_SECONDS)
        cache.delete_value(_fail_key(user))
        return 0
    return MAX_ATTEMPTS - fails


def _clear_failures(user: str):
    cache = frappe.cache()
    cache.delete_value(_fail_key(user))
    cache.delete_value(_lock_key(user))


def _get_or_create_api_keys(user: str) -> tuple[str, str]:
    """Userning API kalitini qaytaradi; yo'q bo'lsa yaratadi.

    Mavjud secret QAYTA ISHLATILADI — bitta kassir ikki qurilmada ham
    ishlay olishi uchun. User hujjatini to'liq save() qilmaymiz (User.validate
    / on_update og'ir va xabarnoma yuboradi); to'g'ridan-to'g'ri yozamiz.
    """
    api_key = frappe.db.get_value("User", user, "api_key")
    api_secret = get_decrypted_password("User", user, "api_secret", raise_exception=False)
    changed = False
    if not api_key:
        api_key = frappe.generate_hash(length=15)
        frappe.db.set_value("User", user, "api_key", api_key, update_modified=False)
        changed = True
    if not api_secret:
        api_secret = frappe.generate_hash(length=15)
        set_encrypted_password("User", user, api_secret, "api_secret")
        frappe.db.set_value("User", user, "api_secret", "*" * len(api_secret), update_modified=False)
        changed = True
    if changed:
        frappe.clear_cache(user=user)
    return api_key, api_secret


# ──────────────────────────────────────────────────────────────────────
#  Whitelisted endpointlar
# ──────────────────────────────────────────────────────────────────────
@frappe.whitelist(allow_guest=True)
@rate_limit(limit=120, seconds=60)
def get_pin_login_users(pos_profile: str | None = None):
    """Applicable for Users dagi yoqilgan userlar ro'yxati.

    `pos_profile` berilmasa barcha yoqilgan profillar; bir user bir nechta
    profilda bo'lsa bitta qator (PIN qo'yilgan profil afzal). Faqat login
    ekraniga kerak maydonlar: user id, ism, rasm, PIN bor-yo'qligi, default,
    profil nomi.
    """
    rows = _profile_rows(pos_profile)
    if not rows:
        return []
    users = list({r.user for r in rows})
    details = {
        d.name: d
        for d in frappe.get_all(
            "User",
            filters={"name": ("in", users), "enabled": 1},
            fields=["name", "full_name", "user_image"],
        )
    }
    merged = {}
    for r in rows:
        d = details.get(r.user)
        if not d:
            continue
        has_pin = bool(get_decrypted_password("POS Profile User", r.name, "posa_pin", raise_exception=False))
        entry = merged.get(r.user)
        if entry is None or (has_pin and not entry["has_pin"]):
            merged[r.user] = {
                "user": r.user,
                "full_name": d.full_name or r.user,
                "user_image": d.user_image,
                "has_pin": int(has_pin),
                "default": cint(r.default),
                "pos_profile": r.pos_profile,
            }
        elif entry is not None and cint(r.default) and not entry["default"]:
            entry["default"] = 1
    return list(merged.values())


@frappe.whitelist(allow_guest=True, methods=["POST"])
@rate_limit(key="user", limit=30, seconds=60)
def pin_login(user: str, pin: str, pos_profile: str | None = None):
    """PINni tekshiradi; to'g'ri bo'lsa userning API kalitini qaytaradi.

    `pos_profile` berilmasa user kiritilgan barcha yoqilgan profillar
    tekshiriladi — PIN qaysi profil qatoriga mos kelsa o'sha profil
    qaytariladi (bir user bir nechta do'konda turli PIN bilan bo'lishi mumkin).

    Xato PIN: {ok: 0, remaining_attempts: n} yoki qulf: {ok: 0, locked: 1,
    lock_seconds: s}. Muvaffaqiyat: {ok: 1, user, full_name, api_key,
    api_secret, pos_profile}.
    """
    user = (user or "").strip()
    pin = (pin or "").strip()
    if not user:
        frappe.throw(_("User is required"))
    if not PIN_RE.match(pin):
        frappe.throw(_("PIN must be exactly 4 digits"))

    rows = [r for r in _profile_rows(pos_profile) if r.user == user]
    if not rows:
        frappe.throw(_("User {0} is not in any enabled POS Profile (Applicable for Users)").format(user))
    if not cint(frappe.db.get_value("User", user, "enabled")):
        frappe.throw(_("User {0} is disabled").format(user))

    remaining_lock = _lock_remaining(user)
    if remaining_lock:
        return {"ok": 0, "locked": 1, "lock_seconds": remaining_lock}

    stored = []
    for r in rows:
        value = get_decrypted_password("POS Profile User", r.name, "posa_pin", raise_exception=False)
        if value:
            stored.append((r, str(value).strip()))
    if not stored:
        frappe.throw(_("PIN is not set for user {0} (POS Profile -> Applicable for Users)").format(user))

    matched = None
    for r, value in stored:
        if hmac.compare_digest(value, pin):
            matched = r
            break
    if matched is None:
        remaining = _register_failure(user)
        if remaining <= 0:
            return {"ok": 0, "locked": 1, "lock_seconds": LOCK_SECONDS}
        return {"ok": 0, "remaining_attempts": remaining}

    _clear_failures(user)
    api_key, api_secret = _get_or_create_api_keys(user)
    full_name = frappe.db.get_value("User", user, "full_name") or user
    frappe.db.commit()
    return {
        "ok": 1,
        "user": user,
        "full_name": full_name,
        "api_key": api_key,
        "api_secret": api_secret,
        "pos_profile": matched.pos_profile,
    }
