#!/usr/bin/env python3
"""
fetch_crm_deals.py — Easy 3D Print Dashboard v1.0
Тягне УСПІШНІ (WON) угоди з Bitrix24 CRM за поточний місяць і рахує
виручку/середній чек/медіану по трьох продажних воронках, змаплених на
ОПТ/Роздріб.

Джерело: https://easy3dprint.bitrix24.eu (webhook, метод crm.deal.list).
Авторизація: BITRIX_WEBHOOK_URL — повний базовий URL вебхука
(https://портал.bitrix24.eu/rest/USER_ID/TOKEN/), окремий секрет,
не змішувати з CAPACITY_API_KEY (інша система).

Чому CLOSEDATE, а не MOVED_TIME: перевірено вручну на реальних WON-угодах
14.08.2026 — дата в CLOSEDATE щоразу збігається з датою в MOVED_TIME для
угод, що вже в стадії WON (Bitrix24 сам оновлює CLOSEDATE при переході в
успішну стадію). Для угод, що ще В РОБОТІ, CLOSEDATE — це плановий дедлайн,
не факт, тому фільтруємо СПОЧАТКУ по STAGE_ID=WON, і тільки тоді CLOSEDATE
з чистою совістю можна вважати датою фактичного закриття.

Воронки (crm.category.list, entityTypeId=2):
  24 "ОТДЕЛ ПРОДАЖ ПРОИЗВОДСТВО"  → ОПТ
  18 "ОТДЕЛ ПРОДАЖ ТОВАРКА"       → Роздріб
  32 "ОТДЕЛ ПРОДАЖ МАГАЗИН"       → Роздріб
  (мапінг підтверджено користувачем 14.08.2026; інші 6 воронок — внутрішні
  виробничі етапи, не продажні, не чіпаємо)

Обсяг: тільки в воронці 24 — 15 451 WON-угода за всю історію станом на
14.08.2026, тому тягнемо НЕ все, а тільки поточний місяць (filter по
CLOSEDATE), і накопичуємо через окремий backfill-скрипт для минулих
місяців (за аналогією з batches).
"""

import json, os, statistics, time
from datetime import date, datetime, timedelta
from calendar import monthrange
from pathlib import Path
import requests

WEBHOOK_URL = os.environ.get("BITRIX_WEBHOOK_URL", "").rstrip("/") + "/"
OUTPUT      = Path(__file__).parent / "data" / "crm_deals.json"

# category → (мітка, група ОПТ/Роздріб)
CATEGORIES = {
    24: ("ОТДЕЛ ПРОДАЖ ПРОИЗВОДСТВО", "wholesale"),
    18: ("ОТДЕЛ ПРОДАЖ ТОВАРКА", "retail"),
    32: ("ОТДЕЛ ПРОДАЖ МАГАЗИН", "retail"),
}

PAGE_SIZE = 50  # фіксовано стороною Bitrix24, не параметризується


def month_bounds(year, month, cap_to=None):
    last_day = monthrange(year, month)[1]
    start = date(year, month, 1)
    end = date(year, month, last_day)
    if cap_to and end > cap_to:
        end = cap_to
    return start, end


def fetch_won_deals(category_id, date_from, date_to):
    """Усі WON-угоди воронки за період — з пагінацією (50/сторінку)."""
    deals = []
    start = 0
    while True:
        params = {
            "filter[STAGE_ID]": f"C{category_id}:WON",
            "filter[>=CLOSEDATE]": date_from.isoformat(),
            "filter[<=CLOSEDATE]": date_to.isoformat(),
            "select[]": ["ID", "TITLE", "OPPORTUNITY", "CURRENCY_ID", "CLOSEDATE"],
            "order[CLOSEDATE]": "DESC",
            "start": start,
        }
        r = requests.get(WEBHOOK_URL + "crm.deal.list", params=params, timeout=30)
        r.raise_for_status()
        payload = r.json()
        if "error" in payload:
            raise RuntimeError(f"Bitrix24 error: {payload.get('error_description', payload['error'])}")
        batch = payload.get("result", [])
        deals.extend(batch)
        nxt = payload.get("next")
        if nxt is None or not batch:
            break
        start = nxt
        time.sleep(0.5)  # ввічливість до ліміту Bitrix24 (~2 запити/сек на вебхук)
    return deals


def rollup_deals(deals):
    """Виручка/середній чек/медіана — тільки UAH-угоди рахуємо в сумі;
    угоди в іншій валюті рахуємо окремо, а не конвертуємо на око.
    Повертає й сирий список сум (amounts) — потрібен, щоб рахувати СПРАВЖНЮ
    медіану по об'єднаній групі (ОПТ/Роздріб), а не "медіану медіан" по
    кожній воронці окремо (це різні, і часом дуже різні, числа)."""
    uah_amounts = []
    other_currency_count = 0
    for d in deals:
        if d.get("CURRENCY_ID") != "UAH":
            other_currency_count += 1
            continue
        try:
            uah_amounts.append(float(d.get("OPPORTUNITY") or 0))
        except (TypeError, ValueError):
            continue

    revenue = sum(uah_amounts)
    count = len(uah_amounts)
    avg_check = round(revenue / count, 2) if count else None
    median_check = round(statistics.median(uah_amounts), 2) if count else None

    top5 = sorted(
        [d for d in deals if d.get("CURRENCY_ID") == "UAH"],
        key=lambda d: -(float(d.get("OPPORTUNITY") or 0))
    )[:5]
    top5_out = [{"id": d.get("ID"), "title": d.get("TITLE"), "amount": float(d.get("OPPORTUNITY") or 0)} for d in top5]

    return {
        "deals": count,
        "revenue": round(revenue, 2),
        "avgCheck": avg_check,
        "medianCheck": median_check,
        "otherCurrencyDealsSkipped": other_currency_count,
        "top5": top5_out,
        "_amounts": uah_amounts,  # службове поле, видаляється перед записом у файл
    }


def main():
    if not WEBHOOK_URL or WEBHOOK_URL == "/":
        raise ValueError("BITRIX_WEBHOOK_URL не встановлено")

    today = date.today()
    month_start, month_end = month_bounds(today.year, today.month, cap_to=today)
    month_key = f"{today.year:04d}-{today.month:02d}"
    print(f"[CRM] Місяць {month_key}: {month_start} → {month_end}")

    by_category = {}
    for cat_id, (label, group) in CATEGORIES.items():
        print(f"[CRM] Воронка {cat_id} ({label})…")
        deals = fetch_won_deals(cat_id, month_start, month_end)
        rolled = rollup_deals(deals)
        by_category[str(cat_id)] = {"label": label, "group": group, **rolled}
        print(f"[CRM]   ✓ {rolled['deals']} угод, {round(rolled['revenue']):,} грн, "
              f"сер.чек {rolled['avgCheck']}, медіана {rolled['medianCheck']}".replace(",", " "))
        time.sleep(0.5)

    # Групуємо по ОПТ/Роздріб — медіана рахується по ОБ'ЄДНАНИХ сирих сумах
    # групи (не по медіанах воронок), інакше з двома воронками в Роздрібі
    # вийде статистично некоректна "медіана медіан".
    def merge_group(group_name):
        cats = [c for c in by_category.values() if c["group"] == group_name]
        all_amounts = [a for c in cats for a in c["_amounts"]]
        all_deals = len(all_amounts)
        all_revenue = sum(all_amounts)
        avg = round(all_revenue / all_deals, 2) if all_deals else None
        median = round(statistics.median(all_amounts), 2) if all_deals else None
        return {"deals": all_deals, "revenue": round(all_revenue, 2), "avgCheck": avg, "medianCheck": median}

    result = {
        "fetched_at": datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
        "month": month_key,
        "from": month_start.isoformat(),
        "to": month_end.isoformat(),
        "complete": month_end == date(today.year, today.month, monthrange(today.year, today.month)[1]),
        "wholesale": merge_group("wholesale"),
        "retail": merge_group("retail"),
        "byCategory": {k: {kk: vv for kk, vv in v.items() if kk != "_amounts"} for k, v in by_category.items()},
    }

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[CRM] ✓ Записано {OUTPUT}")
    print(f"[CRM] ОПТ: deals={result['wholesale']['deals']} avg={result['wholesale']['avgCheck']} median={result['wholesale']['medianCheck']}")
    print(f"[CRM] Роздріб: deals={result['retail']['deals']} avg={result['retail']['avgCheck']} median={result['retail']['medianCheck']}")


if __name__ == "__main__":
    main()
