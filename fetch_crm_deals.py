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


def fetch_stage_list(category_id):
    """Стадії воронки з семантикою (S=успіх, F=провал, process=у роботі).
    Динамічно, не хардкодимо — стадії можуть змінюватись у Bitrix24."""
    r = requests.get(
        WEBHOOK_URL + "crm.status.list",
        params={"filter[ENTITY_ID]": f"DEAL_STAGE_{category_id}"},
        timeout=30,
    )
    r.raise_for_status()
    payload = r.json()
    if "error" in payload:
        raise RuntimeError(f"Bitrix24 error: {payload.get('error_description', payload['error'])}")
    return payload.get("result", [])


# ── Тіри за сумою угоди (грн) — узгоджено з користувачем 14.08.2026 ────────
# НЕ прив'язано до конкретного клієнта/контакту (жодних персональних даних
# не тягнемо) — це чиста класифікація КОЖНОЇ окремої угоди за розміром.
TIERS = [
    ("small", "Дрібні (<10К)", 0, 10_000),
    ("medium", "Середні (10К–100К)", 10_000, 100_000),
    ("mega", "Мега-опт (>100К)", 100_000, float("inf")),
]


def classify_tier(amount):
    for key, label, lo, hi in TIERS:
        if lo <= amount < hi:
            return key, label
    return TIERS[-1][0], TIERS[-1][1]


def rollup_tiers(amounts):
    """К-сть і сумарна виручка по трьох тірах — amounts це просто список
    сум угод (UAH), без жодного зв'язку з тим, ЧИЯ це угода."""
    buckets = {t[0]: {"label": t[1], "deals": 0, "revenue": 0.0} for t in TIERS}
    for a in amounts:
        key, _ = classify_tier(a)
        buckets[key]["deals"] += 1
        buckets[key]["revenue"] += a
    return [{"tier": k, **v, "revenue": round(v["revenue"], 2)} for k, v in buckets.items()]


def fetch_all_deals_for_month(category_id, date_from, date_to):
    """Усі угоди воронки за період — БЕЗ фільтра по стадії (потрібно бачити
    і WON, і LOSE, і всі варіанти "не склалось"). Легкий select — тільки
    ID/STAGE_ID/CLOSEDATE, без суми (тут гроші не рахуємо, тільки причини).

    Припущення: CLOSEDATE так само надійний для LOSE-стадій, як і для WON
    (перевірено емпірично тільки для WON — див. коментар на початку файлу).
    Якщо колись з'ясується, що для LOSE це не так, деякі відмови можуть
    приписатись не тому місяцю — не критично для першої версії аналітики."""
    deals = []
    start = 0
    while True:
        params = {
            "filter[CATEGORY_ID]": category_id,
            "filter[>=CLOSEDATE]": date_from.isoformat(),
            "filter[<=CLOSEDATE]": date_to.isoformat(),
            "select[]": ["ID", "STAGE_ID"],
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
        time.sleep(0.5)
    return deals


def rollup_loss_reasons(deals, stage_list):
    """Групує угоди по причині відмови — назва стадії з ВЕРХНЬОРІВНЕВИМ
    SEMANTICS='F' (провал). ВАЖЛИВО: не EXTRA.SEMANTICS! Той приймає кілька
    різних значень для програних угод ('failure' лише для самої стадії
    LOSE, а змістовні причини на кшталт 'НЕ актуально'/'НЕ відповідає'
    мають EXTRA.SEMANTICS='apology') — фільтр по EXTRA.SEMANTICS=='failure'
    ловив би тільки ДОРОГО і губив половину реальних причин відмови."""
    failure_stages = {s["STATUS_ID"]: s["NAME"] for s in stage_list if s.get("SEMANTICS") == "F"}
    counts = {}
    for d in deals:
        stage_id = d.get("STAGE_ID")
        if stage_id in failure_stages:
            reason = failure_stages[stage_id]
            counts[reason] = counts.get(reason, 0) + 1
    out = [{"reason": r, "count": c} for r, c in counts.items()]
    out.sort(key=lambda x: -x["count"])
    return out


def process_month(month_start, month_end, month_key, complete):
    """Все, що рахується для ОДНОГО місяця (WON-угоди + причини відмов) —
    винесено з main() окремою функцією, щоб backfill-скрипт для минулих
    місяців міг перевикористати ту саму логіку, а не дублювати її."""
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
        tiers = rollup_tiers(all_amounts)
        return {"deals": all_deals, "revenue": round(all_revenue, 2), "avgCheck": avg, "medianCheck": median, "tiers": tiers}

    # ── Причини відмов — окремий прохід по ВСІХ угодах місяця (не тільки
    # WON), бо треба бачити й LOSE/APOLOGY-стадії. Може зайняти помітно
    # більше запитів, ніж WON-угоди, оскільки провалених/у роботі угод
    # зазвичай більше, ніж успішних. ──
    loss_reasons_by_cat = {}
    for cat_id, (label, group) in CATEGORIES.items():
        print(f"[CRM] Причини відмов, воронка {cat_id} ({label})…")
        stage_list = fetch_stage_list(cat_id)
        time.sleep(0.3)
        all_deals = fetch_all_deals_for_month(cat_id, month_start, month_end)
        reasons = rollup_loss_reasons(all_deals, stage_list)
        total_lost = sum(r["count"] for r in reasons)
        loss_reasons_by_cat[str(cat_id)] = {"label": label, "group": group, "reasons": reasons, "totalLost": total_lost}
        print(f"[CRM]   ✓ {len(all_deals)} угод переглянуто, {total_lost} відмов, {len(reasons)} причин")
        time.sleep(0.3)

    def merge_reasons(group_name):
        cats = [c for c in loss_reasons_by_cat.values() if c["group"] == group_name]
        merged = {}
        for c in cats:
            for r in c["reasons"]:
                merged[r["reason"]] = merged.get(r["reason"], 0) + r["count"]
        out = [{"reason": r, "count": c} for r, c in merged.items()]
        out.sort(key=lambda x: -x["count"])
        return out

    return {
        "fetched_at": datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
        "month": month_key,
        "from": month_start.isoformat(),
        "to": month_end.isoformat(),
        "complete": complete,
        "wholesale": merge_group("wholesale"),
        "retail": merge_group("retail"),
        "byCategory": {k: {kk: vv for kk, vv in v.items() if kk != "_amounts"} for k, v in by_category.items()},
        "lossReasonsWholesale": merge_reasons("wholesale"),
        "lossReasonsRetail": merge_reasons("retail"),
        "lossReasonsByCategory": loss_reasons_by_cat,
    }


def main():
    if not WEBHOOK_URL or WEBHOOK_URL == "/":
        raise ValueError("BITRIX_WEBHOOK_URL не встановлено")

    today = date.today()
    month_start, month_end = month_bounds(today.year, today.month, cap_to=today)
    month_key = f"{today.year:04d}-{today.month:02d}"
    complete = month_end == date(today.year, today.month, monthrange(today.year, today.month)[1])
    print(f"[CRM] Місяць {month_key}: {month_start} → {month_end}")

    result = process_month(month_start, month_end, month_key, complete)

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[CRM] ✓ Записано {OUTPUT}")
    print(f"[CRM] ОПТ: deals={result['wholesale']['deals']} avg={result['wholesale']['avgCheck']} median={result['wholesale']['medianCheck']}")
    print(f"[CRM] Роздріб: deals={result['retail']['deals']} avg={result['retail']['avgCheck']} median={result['retail']['medianCheck']}")


if __name__ == "__main__":
    main()
