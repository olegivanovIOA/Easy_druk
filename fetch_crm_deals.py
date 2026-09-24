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

# Категорія 0 "ЛИДЫ" — дефолтна воронка Bitrix24 (первинний скринінг:
# спам/дублі/недодзвони, ДО того як звернення взагалі стає угодою в 24/18/32).
# Знайдено 24.08.2026: основний обсяг відмов (сотні на місяць — "Не берет/не
# отвечает", "СПАМ/МУСОР", "ДУБЛЬ" тощо) осідав саме тут і повністю випадав
# з дашборду, бо цю категорію ніколи не запитували.
# НЕ рахуємо сюди виручку/WON — незрозуміло, чи угода, що пройшла скринінг,
# рахується вдруге, коли потрапляє в 24/18/32 (ризик задвоєння), тому ця
# категорія йде ОКРЕМОЮ групою "screening": тільки причини відмов, без
# виручки/середнього чека/тірів.
SCREENING_CATEGORIES = {
    0: ("ЛИДЫ (первинний скринінг)", "screening"),
}

# Категорія 0 (дефолтна) використовує ГОЛІ коди стадій без префіксу "C{id}:"
# (напр. просто "WON"/"LOSE"/"16", а не "C24:WON") — і поле стадій у
# crm.status.list називається "DEAL_STAGE", без числового суфіксу.
# Усі інші (24/18/32 тощо) — "C{category}:{code}" і "DEAL_STAGE_{category}".
def _stage_entity_id(category_id):
    return "DEAL_STAGE" if category_id == 0 else f"DEAL_STAGE_{category_id}"


def _stage_filter_value(category_id, code):
    return code if category_id == 0 else f"C{category_id}:{code}"


PAGE_SIZE = 50  # фіксовано стороною Bitrix24, не параметризується


def month_bounds(year, month, cap_to=None):
    last_day = monthrange(year, month)[1]
    start = date(year, month, 1)
    end = date(year, month, last_day)
    if cap_to and end > cap_to:
        end = cap_to
    return start, end


def fetch_won_deals(category_id, date_from, date_to):
    """Усі WON-угоди воронки за період — з пагінацією (50/сторінку).
    DATE_CREATE додано 25.08.2026 для #7 (швидкість закриття) — рахуємо
    CLOSEDATE-DATE_CREATE ТІЛЬКИ для WON (де CLOSEDATE уже перевірено
    надійний), не для LOSE/скринінгу (там дата ще проблемна, див. 25.08.2026
    знахідку з totalReviewed)."""
    deals = []
    start = 0
    while True:
        params = {
            "filter[STAGE_ID]": _stage_filter_value(category_id, "WON"),
            "filter[>=CLOSEDATE]": date_from.isoformat(),
            "filter[<=CLOSEDATE]": date_to.isoformat(),
            "select[]": ["ID", "TITLE", "OPPORTUNITY", "CURRENCY_ID", "CLOSEDATE", "DATE_CREATE", "SOURCE_ID", "UTM_SOURCE"],
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


def _parse_bitrix_datetime(s):
    """'2026-08-13T03:00:00+03:00' -> datetime, або None якщо не парситься."""
    if not s:
        return None
    try:
        return datetime.fromisoformat(s)
    except (ValueError, TypeError):
        return None


def rollup_time_to_close(deals):
    """#7 — днів від створення угоди до WON. ТІЛЬКИ для угод, де ОБИДВІ дати
    парсяться і DATE_CREATE <= CLOSEDATE (захист від сміттєвих значень —
    якщо раптом навпаки, це явно не реальний час закриття, пропускаємо, а
    не рахуємо як від'ємне число днів)."""
    days_list = []
    for d in deals:
        created = _parse_bitrix_datetime(d.get("DATE_CREATE"))
        closed = _parse_bitrix_datetime(d.get("CLOSEDATE"))
        if not created or not closed or closed < created:
            continue
        days_list.append((closed - created).days)
    if not days_list:
        return {"avgDays": None, "medianDays": None, "sampleSize": 0}
    return {
        "avgDays": round(sum(days_list) / len(days_list), 1),
        "medianDays": round(statistics.median(days_list), 1),
        "sampleSize": len(days_list),
    }


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
    Динамічно, не хардкодимо — стадії можуть змінюватись у Bitrix24.
    Категорія 0 (дефолтна) — поле називається просто "DEAL_STAGE", без
    суфікса; усі інші — "DEAL_STAGE_{id}"."""
    r = requests.get(
        WEBHOOK_URL + "crm.status.list",
        params={"filter[ENTITY_ID]": _stage_entity_id(category_id)},
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


# Дрібніші бакети — для повноцінної гістограми розподілу сум угод (не тільки
# 3 грубих тіри вище). Межі емпіричні, під типовий розподіл цієї компанії
# (переважна більшість угод — дрібні кастомні замовлення, тому нижні бакети
# густіші за верхні).
HISTOGRAM_BUCKETS = [
    ("b1", "<1К", 0, 1_000),
    ("b2", "1К–2К", 1_000, 2_000),
    ("b3", "2К–5К", 2_000, 5_000),
    ("b4", "5К–10К", 5_000, 10_000),
    ("b5", "10К–25К", 10_000, 25_000),
    ("b6", "25К–50К", 25_000, 50_000),
    ("b7", "50К–100К", 50_000, 100_000),
    ("b8", "100К–300К", 100_000, 300_000),
    ("b9", ">300К", 300_000, float("inf")),
]


def rollup_histogram(amounts):
    """К-сть угод по дев'яти дрібніших бакетах суми — для #9 (гістограма
    розподілу), на відміну від грубих 3 тірів вище. Той самий принцип:
    рахуємо ТІЛЬКИ по сумі угоди, без клієнтських ID."""
    buckets = {b[0]: {"label": b[1], "deals": 0} for b in HISTOGRAM_BUCKETS}
    for a in amounts:
        for key, label, lo, hi in HISTOGRAM_BUCKETS:
            if lo <= a < hi:
                buckets[key]["deals"] += 1
                break
        else:
            buckets[HISTOGRAM_BUCKETS[-1][0]]["deals"] += 1
    return [{"bucket": k, **v} for k, v in buckets.items()]


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
            "select[]": ["ID", "STAGE_ID", "SOURCE_ID", "UTM_SOURCE"],  # SOURCE/UTM — v4.5, канали залучення
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


# ── v4.5: Канали залучення (SOURCE_ID / UTM_SOURCE) ────────────────────────
# Тільки агрегати по каналу — жодних контактів/компаній (та сама умова
# "без персональних даних", що й для тірів).
JUNK_MARKERS = ("спам", "мусор", "дубл", "ошибк", "помилк")


def fetch_source_names():
    """STATUS_ID → назва джерела (crm.status.list, ENTITY_ID=SOURCE). Помилка → {}."""
    try:
        r = requests.get(WEBHOOK_URL + "crm.status.list", params={"filter[ENTITY_ID]": "SOURCE"}, timeout=30)
        r.raise_for_status()
        payload = r.json()
        return {s["STATUS_ID"]: s.get("NAME") or s["STATUS_ID"] for s in payload.get("result", [])}
    except Exception as e:
        print(f"[CRM] ⚠ Довідник джерел недоступний: {e}")
        return {}


def rollup_sources(all_by_cat, stages_by_cat, won_by_cat, source_names):
    """Воронка по каналу за місяць (угоди, закриті в місяці — той самий фільтр
    CLOSEDATE, що й у причинах відмов):
      reviewed  — усі закриті угоди каналу (воронки 0+24+18+32)
      won       — WON у 24/18/32 (WON категорії 0 = пройшов скринінг і
                  переїхав у продажну воронку — НЕ рахуємо як продаж)
      lost      — провальні стадії (SEMANTICS=F) у всіх 4 воронках
      junk      — з них спам/мусор/дублі/помилки (сміттєвий трафік каналу)
      revenue   — сума WON (UAH) з 24/18/32, окремо ОПТ/Роздріб
      winRate   — won / (won + lost), % — "з закритих звернень скільки стали продажем"
      junkShare — junk / reviewed, %
    """
    out = {}

    def row(src_id):
        key = src_id or "—"
        if key not in out:
            out[key] = {"source": key, "name": source_names.get(src_id, src_id) if src_id else "Не вказано",
                        "reviewed": 0, "won": 0, "lost": 0, "junk": 0,
                        "wonWholesale": 0, "wonRetail": 0,
                        "revenue": 0.0, "revenueWholesale": 0.0, "revenueRetail": 0.0}
        return out[key]

    for cat_key, deals in all_by_cat.items():
        cat_id = int(cat_key)
        stage_list = stages_by_cat.get(cat_key, [])
        sem = {s["STATUS_ID"]: s.get("SEMANTICS") for s in stage_list}
        names = {s["STATUS_ID"]: (s.get("NAME") or "").lower() for s in stage_list}
        for d in deals:
            r = row(d.get("SOURCE_ID"))
            r["reviewed"] += 1
            st = d.get("STAGE_ID")
            if sem.get(st) == "F":
                r["lost"] += 1
                if any(m in names.get(st, "") for m in JUNK_MARKERS):
                    r["junk"] += 1
            elif sem.get(st) == "S" and cat_id != 0:
                r["won"] += 1

    for cat_key, deals in won_by_cat.items():
        group = CATEGORIES.get(int(cat_key), ("", ""))[1]
        for d in deals:
            if d.get("CURRENCY_ID") != "UAH":
                continue
            try:
                amt = float(d.get("OPPORTUNITY") or 0)
            except (TypeError, ValueError):
                continue
            r = row(d.get("SOURCE_ID"))
            r["revenue"] += amt
            if group == "wholesale":
                r["revenueWholesale"] += amt
                r["wonWholesale"] += 1
            elif group == "retail":
                r["revenueRetail"] += amt
                r["wonRetail"] += 1

    rows = []
    for r in out.values():
        closed = r["won"] + r["lost"]
        r["winRate"] = round(r["won"] / closed * 100, 1) if closed else None
        r["junkShare"] = round(r["junk"] / r["reviewed"] * 100, 1) if r["reviewed"] else None
        n_won_uah = r["wonWholesale"] + r["wonRetail"]
        r["avgCheck"] = round(r["revenue"] / n_won_uah, 2) if n_won_uah else None
        for k in ("revenue", "revenueWholesale", "revenueRetail"):
            r[k] = round(r[k], 2)
        rows.append(r)
    rows.sort(key=lambda x: (-x["revenue"], -x["reviewed"]))
    return rows


def rollup_utm(all_by_cat, won_by_cat, top_n=15):
    """Те саме, але по UTM_SOURCE (якщо заповнюється) — топ-N за к-стю звернень."""
    agg = {}
    for deals in all_by_cat.values():
        for d in deals:
            u = (d.get("UTM_SOURCE") or "").strip()
            if not u:
                continue
            a = agg.setdefault(u, {"utm": u, "reviewed": 0, "won": 0, "revenue": 0.0})
            a["reviewed"] += 1
    for deals in won_by_cat.values():
        for d in deals:
            u = (d.get("UTM_SOURCE") or "").strip()
            if not u or d.get("CURRENCY_ID") != "UAH":
                continue
            a = agg.setdefault(u, {"utm": u, "reviewed": 0, "won": 0, "revenue": 0.0})
            a["won"] += 1
            try:
                a["revenue"] += float(d.get("OPPORTUNITY") or 0)
            except (TypeError, ValueError):
                pass
    rows = sorted(agg.values(), key=lambda x: -x["reviewed"])[:top_n]
    for r in rows:
        r["revenue"] = round(r["revenue"], 2)
    return rows


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
        time_to_close = rollup_time_to_close(deals)
        by_category[str(cat_id)] = {"label": label, "group": group, **rolled, "timeToClose": time_to_close, "_deals": deals}
        print(f"[CRM]   ✓ {rolled['deals']} угод, {round(rolled['revenue']):,} грн, "
              f"сер.чек {rolled['avgCheck']}, медіана {rolled['medianCheck']}, "
              f"час закриття (сер./медіана) {time_to_close['avgDays']}/{time_to_close['medianDays']} дн.".replace(",", " "))
        time.sleep(0.5)

    # Групуємо по ОПТ/Роздріб — медіана рахується по ОБ'ЄДНАНИХ сирих сумах
    # групи (не по медіанах воронок), інакше з двома воронками в Роздрібі
    # вийде статистично некоректна "медіана медіан". Те саме для часу
    # закриття (#7) — рахуємо по ОБ'ЄДНАНОМУ списку угод групи.
    def merge_group(group_name):
        cats = [c for c in by_category.values() if c["group"] == group_name]
        all_amounts = [a for c in cats for a in c["_amounts"]]
        all_deals_raw = [d for c in cats for d in c["_deals"]]
        all_deals = len(all_amounts)
        all_revenue = sum(all_amounts)
        avg = round(all_revenue / all_deals, 2) if all_deals else None
        median = round(statistics.median(all_amounts), 2) if all_deals else None
        tiers = rollup_tiers(all_amounts)
        histogram = rollup_histogram(all_amounts)
        time_to_close = rollup_time_to_close(all_deals_raw)
        return {"deals": all_deals, "revenue": round(all_revenue, 2), "avgCheck": avg, "medianCheck": median, "tiers": tiers, "histogram": histogram, "timeToClose": time_to_close}

    # ── Причини відмов — окремий прохід по ВСІХ угодах місяця (не тільки
    # WON), бо треба бачити й LOSE/APOLOGY-стадії. Може зайняти помітно
    # більше запитів, ніж WON-угоди, оскільки провалених/у роботі угод
    # зазвичай більше, ніж успішних. Включає й категорію 0 "ЛИДЫ"
    # (первинний скринінг) — саме там основний обсяг відмов, вона НЕ бере
    # участі в розрахунку виручки/тірів вище. ──
    loss_reasons_by_cat = {}
    _all_by_cat, _stages_by_cat = {}, {}
    for cat_id, (label, group) in {**CATEGORIES, **SCREENING_CATEGORIES}.items():
        print(f"[CRM] Причини відмов, воронка {cat_id} ({label})…")
        stage_list = fetch_stage_list(cat_id)
        time.sleep(0.3)
        all_deals = fetch_all_deals_for_month(cat_id, month_start, month_end)
        _all_by_cat[str(cat_id)] = all_deals
        _stages_by_cat[str(cat_id)] = stage_list
        reasons = rollup_loss_reasons(all_deals, stage_list)
        total_lost = sum(r["count"] for r in reasons)
        # totalReviewed = усі угоди воронки за місяць (WON+LOSE+у роботі) —
        # знаменник для конверсії (#6) і потоку звернень (#13). Раніше
        # рахувалось (len(all_deals)) тільки для консольного логу, тепер
        # зберігаємо в JSON.
        loss_reasons_by_cat[str(cat_id)] = {
            "label": label, "group": group, "reasons": reasons,
            "totalLost": total_lost, "totalReviewed": len(all_deals),
        }
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

    def merge_reasons_all():
        """Причини відмов з УСІХ воронок разом (24+18+32+0) — безпечно
        сумувати, на відміну від виручки: відхилений лід за визначенням
        ніколи не став угодою деінде, подвійного рахунку тут немає (на
        відміну від WON у категорії 0, яку свідомо НЕ додаємо до виручки —
        підтверджено користувачем 24.08.2026: WON-угоди категорії 0
        переїжджають у 24/18/32 для виконання, тому рахувати виручку звідти
        було б задвоєнням)."""
        merged = {}
        for c in loss_reasons_by_cat.values():
            for r in c["reasons"]:
                merged[r["reason"]] = merged.get(r["reason"], 0) + r["count"]
        out = [{"reason": r, "count": c} for r, c in merged.items()]
        out.sort(key=lambda x: -x["count"])
        return out

    def sum_total_reviewed(group_name=None):
        """Сума totalReviewed — знаменник для конверсії (#6) і потоку
        звернень (#13). group_name=None -> по всіх 4 воронках разом."""
        cats = loss_reasons_by_cat.values() if group_name is None else \
            (c for c in loss_reasons_by_cat.values() if c["group"] == group_name)
        return sum(c.get("totalReviewed", 0) for c in cats)

    # ── v4.5: канали залучення ──
    try:
        source_names = fetch_source_names()
        won_by_cat = {k: v["_deals"] for k, v in by_category.items()}
        by_source = rollup_sources(_all_by_cat, _stages_by_cat, won_by_cat, source_names)
        by_utm = rollup_utm(_all_by_cat, won_by_cat)
        print(f"[CRM] ✓ Канали: {len(by_source)} джерел, UTM: {len(by_utm)}")
    except Exception as e:
        print(f"[CRM] ⚠ Канали не пораховано: {e}")
        by_source, by_utm = [], []

    return {
        "fetched_at": datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
        "month": month_key,
        "bySource": by_source,
        "byUtm": by_utm,
        "from": month_start.isoformat(),
        "to": month_end.isoformat(),
        "complete": complete,
        "wholesale": merge_group("wholesale"),
        "retail": merge_group("retail"),
        "byCategory": {k: {kk: vv for kk, vv in v.items() if kk not in ("_amounts", "_deals")} for k, v in by_category.items()},
        "lossReasonsWholesale": merge_reasons("wholesale"),
        "lossReasonsRetail": merge_reasons("retail"),
        "lossReasonsScreening": merge_reasons("screening"),
        "lossReasonsTotal": merge_reasons_all(),
        "lossReasonsByCategory": loss_reasons_by_cat,
        "totalReviewed": {
            "wholesale": sum_total_reviewed("wholesale"),
            "retail": sum_total_reviewed("retail"),
            "screening": sum_total_reviewed("screening"),
            "all": sum_total_reviewed(),
        },
    }


HISTORY = Path(__file__).parent / "data" / "crm_monthly_history.json"


def update_monthly_history(current, today):
    """v4.5 (24.09.2026): раніше crm_monthly_history.json наповнювався ТІЛЬКИ
    ручним бекфілом (останній — 25.08), тому всі тренди Bitrix закінчувались
    на неповному серпні, а вересня не було взагалі. Тепер щогодини:
      1) поточний місяць (вже порахований) → upsert в історію;
      2) будь-який МИНУЛИЙ місяць з complete=false (напр. серпень, знятий
         25.08) → перераховуємо за повний місяць один раз і фіксуємо."""
    history = {"months": []}
    if HISTORY.exists():
        try:
            history = json.loads(HISTORY.read_text(encoding="utf-8"))
        except Exception:
            history = {"months": []}
    months = {m["month"]: m for m in history.get("months", [])}
    months[current["month"]] = current

    for key, m in sorted(months.items()):
        if key == current["month"] or m.get("complete") is not False:
            continue
        y, mo = int(key[:4]), int(key[5:7])
        start, end = month_bounds(y, mo)  # повний місяць
        if end >= today:
            continue
        print(f"[CRM] Дофіналізую неповний місяць в історії: {key} ({start} → {end})")
        try:
            months[key] = process_month(start, end, key, True)
        except Exception as e:
            print(f"[CRM] ⚠ Не вдалось дофіналізувати {key}: {e}")

    history["months"] = sorted(months.values(), key=lambda m: m["month"])
    history["updated_at"] = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
    HISTORY.write_text(json.dumps(history, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[CRM] ✓ Історія: {[m['month'] for m in history['months']]}")


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

    update_monthly_history(result, today)
    print(f"[CRM] ОПТ: deals={result['wholesale']['deals']} avg={result['wholesale']['avgCheck']} median={result['wholesale']['medianCheck']}")
    print(f"[CRM] Роздріб: deals={result['retail']['deals']} avg={result['retail']['avgCheck']} median={result['retail']['medianCheck']}")


if __name__ == "__main__":
    main()
