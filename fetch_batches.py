#!/usr/bin/env python3
"""
fetch_batches.py — Easy 3D Print Dashboard v1.0
Читає ЛОТи/партії за ВЧОРАШНЮ виробничу добу через
easy3dprint.pp.ua /api/batches/external/lots і зберігає в
data/batches_lots.json для розділу "Виробництво — Партії (Batch)".

Беремо саме вчора (не сьогодні): дані ОТК за поточну добу ще
"попередні" (партії, які ОТК не завершив сортувати) — див.
qcCompleted/qcDefectWeightPercent у полях API. Вчорашня доба на
момент запуску (раз/год) вже фіналізована.

Додатково накопичує щоденний rollup по локаціях у
data/batches_history.json — для трендів браку/продуктивності
по локаціях (аналогічно capacity_history.json).

Джерело: https://easy3dprint.pp.ua/api-docs → GET /api/batches/external/lots
Авторизація: заголовок X-API-Key — той самий ключ, що й для /api/capacity
(секрет CAPACITY_API_KEY в GitHub Actions, новий секрет не потрібен).
"""

import json, os
from datetime import datetime, timedelta
from pathlib import Path

try:
    from zoneinfo import ZoneInfo
    KYIV = ZoneInfo("Europe/Kyiv")
except Exception:
    KYIV = None  # фолбек нижче на UTC, якщо zoneinfo/tzdata недоступні на раннері

import requests

API_URL      = os.environ.get("BATCHES_API_URL", "https://easy3dprint.pp.ua/api/batches/external/lots")
API_KEY      = os.environ.get("CAPACITY_API_KEY", "")  # той самий ключ, що й /api/capacity
OUTPUT       = Path(__file__).parent / "data" / "batches_lots.json"
HISTORY_FILE = Path(__file__).parent / "data" / "batches_history.json"

# ── Ціни сировини (грн/кг, БЕЗ ПДВ) — надано користувачем 13.08.2026 ───────
# Джерело: прайс "Матеріал | Ціна за 1 грамм, грн, з ПДВ", перераховано ÷1.2.
# ВАЖЛИВО: API віддає material.type тільки як базовий тип ("PETG", "PLA",
# "ABS", "TPU") — без кольору/бренду.
# PETG/PLA: користувач підтвердив — 90% замовлень друкується в чорному
# кольорі → беремо саме варіант "Black" з прайсу, а не середнє по кольорах
# (PETG MF Green майже вдвічі дорожчий за Black і спотворював би собівартість
# для переважної більшості реального виробництва).
# ABS/TPU: у прайсі варіанти розбиті по БРЕНДУ (Creality/TIRAPLAST), а не по
# кольору — жодного явно "чорного" немає, тож для них лишається проста
# середня між брендами (наближення, ще не уточнено користувачем).
# "ABS Hyper Creality" (ціна 0 в прайсі — нема в наявності) виключено.
MATERIAL_PRICE_UAH_PER_KG = {
    "PETG": 330.0,    # PETG Black — домінує (90% замовлень), не середнє
    "PLA":  351.67,   # PLA Black — єдиний варіант у прайсі, вже чорний
    "ABS":  467.92,   # (ABS TIRAPLAST 279.17 + ABS Creality 656.67) / 2 — не по кольору, уточнити
    "TPU":  1016.67,  # TPU 90A (єдиний варіант у прайсі)
}


def kyiv_yesterday():
    now = datetime.now(KYIV) if KYIV else datetime.utcnow()
    return (now - timedelta(days=1)).strftime("%Y-%m-%d")


def location_key(loc_field):
    """Поле location у відповіді — вже просто номер ('1','2','4'...), але про всяк
    випадок дістаємо цифри, як і в capacity_common.location_key."""
    s = str(loc_field or "")
    digits = "".join(ch for ch in s if ch.isdigit())
    return digits or s


def batch_material_cost(batch):
    """Вартість сировини для однієї партії (грн) = вага_деталі_кг × к-сть × ціна/кг.
    None, якщо тип матеріалу невідомий (нема в MATERIAL_PRICE_UAH_PER_KG) або
    відсутня калібрована вага (unitWeightG) — щоб не підміняти прочерк нулем."""
    mat_type = (batch.get("material") or {}).get("type")
    price = MATERIAL_PRICE_UAH_PER_KG.get(mat_type)
    weight_g = batch.get("unitWeightG")
    qty = batch.get("acceptedQty")
    if price is None or not weight_g or not qty:
        return None
    return (weight_g / 1000) * qty * price


def material_cost_for_location(loc):
    """Сумарна вартість сировини по локації + покриття (яка частка прийнятих
    ОТК одиниць реально має відому ціну — партії з невідомим типом матеріалу
    чи без каліброваної ваги випадають з суми, а не рахуються як 0)."""
    cost = 0.0
    covered_qty = 0
    total_qty = 0
    for pm in loc.get("printerModels", []) or []:
        for b in pm.get("batches", []) or []:
            qty = b.get("acceptedQty") or 0
            total_qty += qty
            c = batch_material_cost(b)
            if c is not None:
                cost += c
                covered_qty += qty
    coverage_pct = round(covered_qty / total_qty * 100, 1) if total_qty else None
    return {"materialCostUAH": round(cost, 2) if total_qty else None,
            "materialCostCoveragePercent": coverage_pct}


def rollup_location(loc):
    """Денний підсумок по одній локації з відповіді /lots — для history-файлу.
    Зважено по acceptedQty (а не проста середня по ЛОТах), щоб великі ЛОТи не
    важили стільки ж, скільки маленькі."""
    lots = loc.get("lots", []) or []
    accepted = sum(l.get("acceptedQty") or 0 for l in lots)
    defect = sum(l.get("defectQty") or 0 for l in lots)
    print_minutes = sum(l.get("totalPrintTimeMinutes") or 0 for l in lots)
    defect_pct = round(defect / accepted * 100, 2) if accepted else None

    # qcDefectWeightPercent буває null (нема калібрування ваги/ОТК не завершено) —
    # рахуємо тільки по ЛОТах де воно є, і ЗВАЖЕНО по acceptedQty (а не проста
    # середня!) — інакше маленький ЛОТ з високим % браку перекошує показник так
    # само, як і великий (на реальних даних 12.08 проста середня давала 45% при
    # тому, що зважений і поштучний % браку узгоджено давали ~9%).
    weighted_lots = [l for l in lots if l.get("qcDefectWeightPercent") is not None and (l.get("acceptedQty") or 0) > 0]
    weight_qty_sum = sum(l.get("acceptedQty") or 0 for l in weighted_lots)
    defect_weight_pct = (
        round(sum((l.get("qcDefectWeightPercent") or 0) * (l.get("acceptedQty") or 0) for l in weighted_lots) / weight_qty_sum, 2)
        if weight_qty_sum else None
    )

    return {
        "batches":  loc.get("totals", {}).get("batches", 0),
        "lots":     loc.get("totals", {}).get("lots", 0),
        "acceptedQty": accepted,
        "defectQty":   defect,
        "defectPercent": defect_pct,
        "defectWeightPercent": defect_weight_pct,
        "totalPrintTimeMinutes": print_minutes,
        **material_cost_for_location(loc),
    }


def rollup_company(locations_payload):
    """Компанійський підсумок — та сама логіка, що й rollup_location, але по всіх
    локаціях разом. Рахуємо тут (Python), а не в JS на клієнті, щоб зважена
    математика (весь урок з defectWeightPercent — див. коментар у
    rollup_location) не дублювалась і не розходилась між сервером і браузером."""
    all_lots = []
    all_printer_models = []
    for loc in locations_payload or []:
        all_lots.extend(loc.get("lots", []) or [])
        all_printer_models.extend(loc.get("printerModels", []) or [])
    fake_loc = {
        "totals": {
            "batches": sum(l.get("batchCount") or 0 for l in all_lots),
            "lots": len(all_lots),
        },
        "lots": all_lots,
        "printerModels": all_printer_models,  # потрібно для material_cost_for_location
    }
    return rollup_location(fake_loc)


def rollup_by_printer_model(locations_payload):
    """% браку по моделі принтера — агреговано по batches[] всередині
    printerModels[] кожної локації (є в /api/batches/external/lots)."""
    agg = {}
    for loc in locations_payload or []:
        for pm in loc.get("printerModels", []) or []:
            model = pm.get("printerModel") or "Невідома"
            a = agg.setdefault(model, {"batches": 0, "acceptedQty": 0, "defectQty": 0})
            for b in pm.get("batches", []) or []:
                a["batches"] += 1
                a["acceptedQty"] += b.get("acceptedQty") or 0
                a["defectQty"] += b.get("defectQty") or 0
    out = []
    for model, a in agg.items():
        pct = round(a["defectQty"] / a["acceptedQty"] * 100, 2) if a["acceptedQty"] else None
        out.append({"printerModel": model, **a, "defectPercent": pct})
    out.sort(key=lambda x: -x["acceptedQty"])
    return out


def rollup_by_product(locations_payload, top_n=20):
    """% браку і вартість браку по типу деталі (baseProductCode) — агреговано
    по batches[] всередині printerModels[] (не lots[]!), бо тільки на рівні
    партії є material.type/unitWeightG — потрібні для вартості браку.
    Обмежено top_n по обсягу (acceptedQty)."""
    agg = {}
    for loc in locations_payload or []:
        for pm in loc.get("printerModels", []) or []:
            for b in pm.get("batches", []) or []:
                code = (b.get("product") or {}).get("baseCode") or "?"
                a = agg.setdefault(code, {"batches": 0, "acceptedQty": 0, "defectQty": 0, "defectCostUAH": 0.0})
                a["batches"] += 1
                accepted = b.get("acceptedQty") or 0
                defect = b.get("defectQty") or 0
                a["acceptedQty"] += accepted
                a["defectQty"] += defect
                if defect:
                    mat_type = (b.get("material") or {}).get("type")
                    price = MATERIAL_PRICE_UAH_PER_KG.get(mat_type)
                    weight_g = b.get("unitWeightG")
                    if price is not None and weight_g:
                        a["defectCostUAH"] += (weight_g / 1000) * defect * price
    out = []
    for code, a in agg.items():
        pct = round(a["defectQty"] / a["acceptedQty"] * 100, 2) if a["acceptedQty"] else None
        out.append({
            "baseProductCode": code,
            "batches": a["batches"], "acceptedQty": a["acceptedQty"], "defectQty": a["defectQty"],
            "defectPercent": pct,
            "defectCostUAH": round(a["defectCostUAH"], 2),  # тільки вартість сировини браку — без маш-часу (той рахується вживу на дашборді за редагованою ставкою)
        })
    out.sort(key=lambda x: -x["acceptedQty"])
    return out[:top_n]


def rollup_defect_cost_ranking(by_product, top_n=10):
    """Найдорожчий брак у грошах (не в %) — top_n деталей за defectCostUAH.
    Береться з уже порахованого rollup_by_product, а не рахується заново."""
    ranked = [p for p in by_product if p.get("defectCostUAH")]
    ranked.sort(key=lambda x: -x["defectCostUAH"])
    return ranked[:top_n]


def rollup_planned_vs_estimated(locations_payload, top_n=10):
    """План vs факт по кількості машин у ЛОТі (plannedMachines.planned vs
    .estimated) — документація API стверджує "estimated = planned", але на
    реальних даних вони часто різні (напр. 123 vs 147.6) — ці розбіжності й
    показуємо, а не сліпо довіряємо документації."""
    lot_deviations = []
    total_planned = total_estimated = 0.0
    covered = 0
    for loc in locations_payload or []:
        loc_key = location_key(loc.get("location"))
        for lot in loc.get("lots", []) or []:
            pm = lot.get("plannedMachines") or {}
            planned, estimated = pm.get("planned"), pm.get("estimated")
            if planned is None or estimated is None:
                continue
            covered += 1
            total_planned += planned
            total_estimated += estimated
            if planned:
                dev_pct = round((estimated - planned) / planned * 100, 1)
                lot_deviations.append({
                    "location": loc_key, "baseProductCode": lot.get("baseProductCode"),
                    "planned": planned, "estimated": estimated, "deviationPercent": dev_pct,
                })
    lot_deviations.sort(key=lambda x: -abs(x["deviationPercent"]))
    company_dev_pct = round((total_estimated - total_planned) / total_planned * 100, 1) if total_planned else None
    return {
        "totalPlanned": round(total_planned, 1), "totalEstimated": round(total_estimated, 1),
        "deviationPercent": company_dev_pct, "lotsCovered": covered,
        "topDeviations": lot_deviations[:top_n],
    }


def rollup_pending_qc(locations_payload):
    """ЛОТи, надруковані, але ще без жодної прийнятої ОТК одиниці
    (acceptedQty=0 при batchCount>0) — операційна черга сортування."""
    pending = []
    for loc in locations_payload or []:
        loc_key = location_key(loc.get("location"))
        for lot in loc.get("lots", []) or []:
            if (lot.get("acceptedQty") or 0) == 0 and (lot.get("batchCount") or 0) > 0:
                pending.append({
                    "location": loc_key, "baseProductCode": lot.get("baseProductCode"),
                    "batchCount": lot.get("batchCount"),
                    "totalPrintTimeMinutes": lot.get("totalPrintTimeMinutes"),
                    "shift": lot.get("shift"),
                })
    by_location = {}
    for p in pending:
        by_location[p["location"]] = by_location.get(p["location"], 0) + 1
    return {"count": len(pending), "byLocation": by_location, "lots": pending[:30]}


def rollup_worst_best_lots(locations_payload, min_qty=50, top_n=10):
    """ТОП проблемних і ТОП чистих ЛОТів — з фільтром по мінімальному обсягу
    (min_qty), щоб крихітний ЛОТ на 3 деталі з 1 браком (33%) не забивав
    рейтинг поряд із реальними проблемними тисячниками."""
    all_lots = []
    for loc in locations_payload or []:
        loc_key = location_key(loc.get("location"))
        for lot in loc.get("lots", []) or []:
            if (lot.get("acceptedQty") or 0) < min_qty or lot.get("defectPercent") is None:
                continue
            all_lots.append({
                "location": loc_key,
                "lotKey": lot.get("lotKey"),
                "baseProductCode": lot.get("baseProductCode"),
                "printerModels": lot.get("printerModels"),
                "shift": lot.get("shift"),
                "acceptedQty": lot.get("acceptedQty"),
                "defectQty": lot.get("defectQty"),
                "defectPercent": lot.get("defectPercent"),
            })
    # Сортуємо за спаданням % браку й ділимо навпіл — worst і best НІКОЛИ не
    # перетинаються (раніше при малому пулі — напр. 3 ЛОТи вчора — top_n=10
    # черпав з того самого пулу для обох списків, і "0.0% брак" потрапляв у
    # "найпроблемніші" разом з тим самим ЛОТом одночасно в обох таблицях).
    sorted_desc = sorted(all_lots, key=lambda x: -x["defectPercent"])
    n = len(sorted_desc)
    split = (n + 1) // 2  # worst отримує "верхню" половину (округлення вгору)
    worst = sorted_desc[:split][:top_n]
    best = list(reversed(sorted_desc[split:]))[:top_n]
    return {"worst": worst, "best": best, "minQty": min_qty, "poolSize": n}


def rollup_by_shift(locations_payload):
    """% браку по зміні (FIRST/SECOND) — агреговано по всіх локаціях. Може
    виявити систематичну проблему конкретної зміни (напр. нічної)."""
    agg = {}
    for loc in locations_payload or []:
        for lot in loc.get("lots", []) or []:
            shift = lot.get("shift") or "?"
            a = agg.setdefault(shift, {"lots": 0, "acceptedQty": 0, "defectQty": 0})
            a["lots"] += 1
            a["acceptedQty"] += lot.get("acceptedQty") or 0
            a["defectQty"] += lot.get("defectQty") or 0
    out = []
    for shift, a in agg.items():
        pct = round(a["defectQty"] / a["acceptedQty"] * 100, 2) if a["acceptedQty"] else None
        out.append({"shift": shift, **a, "defectPercent": pct})
    return out


def upsert_day(history, date_str, locations_payload):
    day_locs = {}
    for loc in locations_payload or []:
        key = location_key(loc.get("location"))
        day_locs[key] = {"name": f"Локація {key}", **rollup_location(loc)}

    day_company = rollup_company(locations_payload)

    # #3 (25.08.2026) — легкий масив окремих ЛОТів (тільки розмір+% браку,
    # без усіх деталей з batches_lots.json) для кореляції "розмір лоту ↔
    # % браку" (scatter-plot), яку неможливо порахувати на самому лише
    # "вчора" (2-3 лоти на локацію — замало для статистики). Накопичується
    # день у день, дає повноцінну вибірку за кілька тижнів/місяців.
    day_lots = []
    for loc in locations_payload or []:
        key = location_key(loc.get("location"))
        for lot in loc.get("lots") or []:
            if lot.get("defectPercent") is None or not lot.get("acceptedQty"):
                continue  # ще не закрита партія (немає фінальних ОТК-даних) — пропускаємо
            day_lots.append({
                "location": key,
                "acceptedQty": lot.get("acceptedQty"),
                "batchCount": lot.get("batchCount"),
                "defectPercent": lot.get("defectPercent"),
                "printerModels": lot.get("printerModels"),
            })

    days = history.setdefault("days", [])
    for d in days:
        if d.get("date") == date_str:
            d["locations"] = day_locs
            d["company"] = day_company
            d["lots"] = day_lots
            return history
    days.append({"date": date_str, "locations": day_locs, "company": day_company, "lots": day_lots})
    return history


def main():
    print(f"[Batches] Старт {datetime.utcnow().isoformat()}")

    if not API_KEY:
        raise ValueError("CAPACITY_API_KEY не встановлено (той самий ключ, що й для /api/capacity)")

    target_date = kyiv_yesterday()
    print(f"[Batches] Тягну добу (Київ, вчора): {target_date}")

    r = requests.get(
        API_URL,
        headers={"X-API-Key": API_KEY},
        params={"from": target_date, "to": target_date},
        timeout=30,
    )
    r.raise_for_status()
    payload = r.json()

    locations = payload.get("locations", [])
    totals = payload.get("totals", {})
    print(f"[Batches] ✓ Отримано {len(locations)} локацій, "
          f"{totals.get('batches', '?')} партій / {totals.get('lots', '?')} ЛОТів за {target_date}")

    by_product = rollup_by_product(locations)

    # Розбивка по кожній локації окремо — для фільтра "Локація" на вкладці
    # Якість (панель "Брак по моделі/деталі"). Ті самі функції, що й для
    # компанії, просто викликані на списку з ОДНІЄЮ локацією.
    by_location = {}
    for loc in locations:
        loc_key = location_key(loc.get("location"))
        loc_product = rollup_by_product([loc])
        by_location[loc_key] = {
            "byPrinterModel": rollup_by_printer_model([loc]),
            "byProduct": loc_product,
            "defectCostRanking": rollup_defect_cost_ranking(loc_product),
        }

    result = {
        "fetched_at": datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
        "date": target_date,
        "range": payload.get("range"),
        "totals": totals,
        "company": rollup_company(locations),
        "byPrinterModel": rollup_by_printer_model(locations),
        "byProduct": by_product,
        "defectCostRanking": rollup_defect_cost_ranking(by_product),
        "byLocation": by_location,
        "byShift": rollup_by_shift(locations),
        "worstBestLots": rollup_worst_best_lots(locations),
        "plannedVsEstimated": rollup_planned_vs_estimated(locations),
        "pendingQC": rollup_pending_qc(locations),
        "locations": locations,
    }

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[Batches] ✓ Записано {OUTPUT}")

    # ── Накопичення history для трендів по локаціях ──
    history = {"days": []}
    if HISTORY_FILE.exists():
        try:
            history = json.loads(HISTORY_FILE.read_text(encoding="utf-8"))
        except Exception:
            history = {"days": []}

    history = upsert_day(history, target_date, locations)
    history["days"].sort(key=lambda d: d["date"])
    history["updated_at"] = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")

    HISTORY_FILE.write_text(json.dumps(history, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[Batches] ✓ Записано {HISTORY_FILE} (днів у історії: {len(history['days'])})")


if __name__ == "__main__":
    main()
