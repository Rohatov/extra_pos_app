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
* PIN barcha POS Profillar bo'yicha QATOR uchun noyob: ikki qatorda (ikki xil
  userda ham, bir userning ikki do'konida ham) bir xil PIN bo'lishi mumkin
  emas. Shu sababli faqat PIN (`pin_login_by_pin`) userni ham, do'konni ham
  bir ma'noli aniqlaydi. PIN `__Auth` da shifrlangani uchun DB `unique`
  constraint qo'yib bo'lmaydi — tekshiruv POS Profile saqlanganda.
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
    """POS Profile saqlanganda har bir qatordagi PIN 4 ta raqam ekanini va
    userlar orasida noyobligini tekshiradi. Format tekshiruvi saqlangan
    (yulduzcha ko'rinishdagi) qiymatlarga tegmaydi."""
    # Yangi POS Profile nomi qo'lda kiritilganda (Prompt + `__newname`) Frappe
    # `insert()` bola qatorlarga nom bermaydi (`set_name_in_children` faqat
    # yangilashda chaqiriladi). Password maydoni (`posa_pin`) esa nomni
    # `_validate` da, `db_insert` dan OLDIN kerak qiladi — nom bo'lmasa
    # "Column 'name' cannot be null". Shu sababli nomlarni shu yerda beramiz.
    doc.set_name_in_children()

    for row in doc.get("applicable_for_users") or []:
        pin = (row.get("posa_pin") or "").strip()
        if not pin or _is_dummy(pin):
            continue
        if not PIN_RE.match(pin):
            frappe.throw(
                _("Row #{0} ({1}): PIN must be exactly 4 digits").format(row.idx, row.user),
                title=_("Invalid PIN"),
            )

    _validate_unique_pins(doc)


def _is_dummy(value: str) -> bool:
    return bool(value) and set(value) == {"*"}


def _stored_pin(row_name: str | None) -> str:
    if not row_name:
        return ""
    value = get_decrypted_password("POS Profile User", row_name, "posa_pin", raise_exception=False)
    return str(value).strip() if value else ""


def _effective_pin(row) -> str:
    """Qatorning amaldagi PINi: formada yangi kiritilgan bo'lsa shu, aks holda
    (yulduzcha ko'rinishida) `__Auth` dagi saqlangani."""
    pin = (row.get("posa_pin") or "").strip()
    if pin and not _is_dummy(pin):
        return pin
    return _stored_pin(row.get("name"))


def _validate_unique_pins(doc):
    """Bir PIN ikki qatorda takrorlanmasin (barcha POS Profillar bo'yicha) —
    faqat PIN bo'yicha kirishda user va do'kon aniq bo'lishi uchun.

    Boshqa profildagi userning ismi xabarda ko'rsatilmaydi — aks holda PINlarni
    tanlab ko'rib, kimning PINi ekanini bilib olish mumkin bo'lardi.
    """
    first_row = {}
    for row in doc.get("applicable_for_users") or []:
        pin = _effective_pin(row)
        if not pin:
            continue
        prev = first_row.setdefault(pin, row)
        if prev is not row:
            frappe.throw(
                _("Row #{0} ({1}) and row #{2} ({3}) have the same PIN. PIN must be unique").format(
                    prev.idx, prev.user, row.idx, row.user
                ),
                title=_("Duplicate PIN"),
            )
    if not first_row:
        return

    filters = {"parenttype": "POS Profile"}
    if doc.name:
        filters["parent"] = ("!=", doc.name)
    for other in frappe.get_all("POS Profile User", filters=filters, fields=["name", "user"]):
        row = first_row.get(_stored_pin(other.name))
        if row:
            frappe.throw(
                _("Row #{0} ({1}): this PIN is already used in another row or POS Profile. PIN must be unique").format(
                    row.idx, row.user
                ),
                title=_("Duplicate PIN"),
            )


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


def _register_failure(user: str, max_attempts: int = MAX_ATTEMPTS) -> int:
    """Xato urinishni qayd etadi; qolgan urinishlar sonini qaytaradi."""
    cache = frappe.cache()
    fails = cint(cache.get_value(_fail_key(user)) or 0) + 1
    cache.set_value(_fail_key(user), fails, expires_in_sec=LOCK_SECONDS)
    if fails >= max_attempts:
        cache.set_value(_lock_key(user), now_datetime().isoformat(), expires_in_sec=LOCK_SECONDS)
        cache.delete_value(_fail_key(user))
        return 0
    return max_attempts - fails


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
def get_pin_login_profiles():
    """Login ekranida do'kon (POS Profile) tanlash uchun ro'yxat.

    Faqat YOQILGAN va "Applicable for Users" da kamida bitta YOQILGAN user
    bo'lgan profillar qaytariladi — bo'sh profilga kirib bo'lmaydi, uni
    ko'rsatishning ma'nosi yo'q. PIN yoki boshqa maxfiy ma'lumot yo'q.
    """
    profiles = frappe.get_all(
        "POS Profile",
        filters={"disabled": 0},
        fields=["name", "company", "currency", "warehouse"],
        order_by="name",
    )
    if not profiles:
        return []

    rows = frappe.get_all(
        "POS Profile User",
        filters={"parent": ("in", [p.name for p in profiles]), "parenttype": "POS Profile"},
        fields=["user", "parent as pos_profile"],
    )
    enabled_users = set()
    if rows:
        enabled_users = {
            d.name
            for d in frappe.get_all(
                "User",
                filters={"name": ("in", list({r.user for r in rows})), "enabled": 1},
                fields=["name"],
            )
        }
    counts = {}
    for r in rows:
        if r.user in enabled_users:
            counts[r.pos_profile] = counts.get(r.pos_profile, 0) + 1

    return [
        {
            "name": p.name,
            "company": p.company,
            "currency": p.currency,
            "warehouse": p.warehouse,
            "user_count": counts.get(p.name, 0),
        }
        for p in profiles
        if counts.get(p.name)
    ]


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
    return _login_payload(user, matched.pos_profile)


def _login_payload(user: str, pos_profile: str) -> dict:
    """Muvaffaqiyatli kirish javobi: userning API kaliti (yo'q bo'lsa yaratiladi)."""
    api_key, api_secret = _get_or_create_api_keys(user)
    full_name = frappe.db.get_value("User", user, "full_name") or user
    frappe.db.commit()
    return {
        "ok": 1,
        "user": user,
        "full_name": full_name,
        "api_key": api_key,
        "api_secret": api_secret,
        "pos_profile": pos_profile,
    }


# Faqat-PIN kirishda user oldindan noma'lum, shuning uchun xato urinishlar
# userga emas, so'rov yuborgan IP'ga va (X-Forwarded-For soxtalashtirilsa ham
# butun serverga) hisoblanadi. Qulf kaliti `@` bilan boshlanadi — Frappe user
# nomi bilan to'qnashmaydi.
GLOBAL_SCOPE = "@any"
GLOBAL_MAX_ATTEMPTS = 30


@frappe.whitelist(allow_guest=True, methods=["POST"])
@rate_limit(limit=30, seconds=60)
def pin_login_by_pin(pin: str, pos_profile: str | None = None):
    """Faqat PIN bo'yicha kirish — user ham, do'kon ham PINdan aniqlanadi.

    PIN barcha (yoki `pos_profile` berilsa — shu) YOQILGAN profillardagi
    "Applicable for Users" qatorlari bilan solishtiriladi; mos kelgan
    qatorning useri va profili uchun `pin_login` bilan bir xil javob
    qaytariladi (`pos_profile` maydoni — aniqlangan do'kon).

    PIN qatorlar orasida noyob (POS Profile saqlanganda tekshiriladi), lekin
    eski ma'lumotda takror bo'lsa (ikki user yoki bir userning ikki do'koni) —
    tasodifiy userga/do'konga kirilmaydi, xato beriladi.

    Xato PIN: {ok: 0, remaining_attempts: n}; qulf (IP yoki umumiy):
    {ok: 0, locked: 1, lock_seconds: s}.
    """
    pin = (pin or "").strip()
    if not PIN_RE.match(pin):
        frappe.throw(_("PIN must be exactly 4 digits"))

    ip_scope = f"@ip:{frappe.local.request_ip or ''}"
    for scope in (ip_scope, GLOBAL_SCOPE):
        remaining_lock = _lock_remaining(scope)
        if remaining_lock:
            return {"ok": 0, "locked": 1, "lock_seconds": remaining_lock}

    rows = _profile_rows(pos_profile)
    enabled = set()
    if rows:
        enabled = {
            d.name
            for d in frappe.get_all(
                "User",
                filters={"name": ("in", list({r.user for r in rows})), "enabled": 1},
                fields=["name"],
            )
        }
    # Barcha qatorlar oxirigacha solishtiriladi (erta to'xtamaydi) — javob
    # vaqti PIN nechanchi qatorga mos kelganini ko'rsatib qo'ymasin.
    matches = []
    for r in rows:
        if r.user not in enabled:
            continue
        value = get_decrypted_password("POS Profile User", r.name, "posa_pin", raise_exception=False)
        if value and hmac.compare_digest(str(value).strip(), pin):
            matches.append(r)

    if not matches:
        _register_failure(GLOBAL_SCOPE, GLOBAL_MAX_ATTEMPTS)
        remaining = _register_failure(ip_scope)
        if remaining <= 0:
            return {"ok": 0, "locked": 1, "lock_seconds": LOCK_SECONDS}
        return {"ok": 0, "remaining_attempts": remaining}

    if len({(r.user, r.pos_profile) for r in matches}) > 1:
        _register_failure(GLOBAL_SCOPE, GLOBAL_MAX_ATTEMPTS)
        _register_failure(ip_scope)
        frappe.throw(
            _("This PIN is used in more than one place (user or POS Profile). Ask the administrator to give every POS Profile user a unique PIN"),
            title=_("Duplicate PIN"),
        )

    _clear_failures(ip_scope)
    return _login_payload(matches[0].user, matches[0].pos_profile)
