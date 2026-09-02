"""Valyuta kurslari — FAQAT bazadagi Currency Exchange yozuvlaridan.

Do'kon kursni har kuni emas, oyda 2-3 marta kiritadi. Shu sababli:

* kurs har doim Currency Exchange jadvalidagi ENG OXIRGI sanada kiritilgan
  yozuvdan olinadi (sana bo'yicha filtr yo'q — bugungi sanadan keyingi
  yozuv bo'lsa ham u "eng oxirgi" hisoblanadi);
* to'g'ri yo'nalish (masalan UZS -> USD) topilmasa, teskari yozuvdan
  (USD -> UZS) 1/kurs olinadi — bitta kursni yuritish kifoya;
* ERPNextning `get_exchange_rate` funksiyasi ISHLATILMAYDI — u yozuv
  topilmasa tashqi (internet) API dan bozor kursini olib keladi, bu esa
  kassir ko'rgan narx bilan qarz summasi o'rtasida farq keltirib chiqaradi.

Kurs topilmasa 0 qaytariladi — chaqiruvchi tomon aniq xato ko'rsatishi
kerak ("Currency Exchange yozuvi kiriting").
"""

import frappe
from frappe.utils import flt, nowdate


def _latest_currency_exchange_row(from_currency: str, to_currency: str):
    rows = frappe.get_all(
        "Currency Exchange",
        filters={"from_currency": from_currency, "to_currency": to_currency},
        fields=["exchange_rate", "date"],
        order_by="date desc, creation desc",
        limit=1,
    )
    return rows[0] if rows else None


def get_latest_rate(from_currency: str, to_currency: str, cache=None):
    """`from_currency` -> `to_currency` kursi va u kiritilgan sana.

    Qaytadi: (kurs, sana). Kurs topilmasa (0.0, None).
    Bir xil valyuta uchun (1.0, bugun).
    """
    from_currency = (from_currency or "").strip()
    to_currency = (to_currency or "").strip()
    if not from_currency or not to_currency or from_currency == to_currency:
        return 1.0, nowdate()

    key = (from_currency, to_currency)
    if cache is not None and key in cache:
        return cache[key]

    result = (0.0, None)
    direct = _latest_currency_exchange_row(from_currency, to_currency)
    if direct and flt(direct.exchange_rate) > 0:
        result = (flt(direct.exchange_rate), direct.date)
    else:
        reverse = _latest_currency_exchange_row(to_currency, from_currency)
        if reverse and flt(reverse.exchange_rate) > 0:
            result = (1.0 / flt(reverse.exchange_rate), reverse.date)

    if cache is not None:
        cache[key] = result
    return result


def get_latest_rate_or_throw(from_currency: str, to_currency: str, cache=None) -> float:
    """Kurs topilmasa foydalanuvchiga tushunarli xato bilan to'xtatadi."""
    rate, _date = get_latest_rate(from_currency, to_currency, cache=cache)
    if not rate:
        frappe.throw(
            frappe._(
                "Unable to find exchange rate for {0} to {1}. Please create a Currency Exchange record manually"
            ).format(from_currency, to_currency)
        )
    return rate
