#!/usr/bin/env python3
"""
fetch_sales.py — Easy 3D Print Dashboard v1.2
Читає Google Sheets Планувальника і витягує:
- Роздріб/Опт план-факт по місяцях 2026 (правильні індекси колонок)
- Пайплайн оптових угод (статуси, суми)
- Якість лідів (цільові/спам/не завершили)
- Ефективність менеджерів (похідні метрики, без абсолютних ЗП)
"""

import csv, io, json, os, re
from pathlib import Path
from datetime import datetime
import requests

SHEET_ID = os.environ.get("SALES_SHEET_ID", "1M4daThbhYfnLjXTGEjLloFiwcYFumGgF-zt0ZgKQDw0")
API_KEY  = os.environ.get("GOOGLE_API_KEY", "")
OUTPUT   = Path(__file__).parent / "data" / "sales_planner.json"

PLANNING_SHEET  = "Планування на 2026 рік "
LEADS_SHEET     = "Аналіз лідів "
PIPELINE_SHEET  = "Оптові угоди."
MANAGERS_SHEET  = "ЗП менеджерів нова"

# Точні індекси колонок для місяців 2026 (Plan, Fact)
# Визначено з реального файлу — структура стабільна
MONTHS_2026 = [
    ("Січень",   23, 24),
    ("Лютий",    32, 33),
    ("Березень", 40, 41),
    ("Квітень",  48, 49),
    ("Травень",  57, 58),
    ("Червень",  65, 66),
    ("Липень",   73, 74),
    ("Серпень",  76, 77),
    ("Вересень", 79, 80),
    ("Жовтень",  82, 83),
    ("Листопад", 85, 86),
    ("Грудень",  88, 89),
]

# Статуси пайплайну — групуємо в стадії воронки
PIPELINE_STAGES = {
    "Угода успішна":       "won",
    "Угода в роботі":      "active",
    "Тест":                "test",
    "Іде розрахунок":      "calculation",
    "Чекаємо відповіль":   "waiting",
    "потрібно більше часу":"slow",
    "не актуально":        "lost",
    "не відповідає":       "lost",
}
PIPELINE_STAGE_LABELS = {
    "won":         "Угода успішна",
    "active":      "Угода в роботі",
    "test":        "Тест",
    "calculation": "Іде розрахунок",
    "waiting":     "Чекаємо відповідь",
    "slow":        "Потрібно більше часу",
    "lost":        "Не актуально / не відповідає",
}


def get_sheet_list():
    url = (f"https://sheets.googleapis.com/v4/spreadsheets/{SHEET_ID}"
           f"?fields=sheets.properties(sheetId,title)&key={API_KEY}")
    r = requests.get(url, timeout=15)
    r.raise_for_status()
    return [{"gid": str(s["properties"]["sheetId"]), "title": s["properties"]["title"]}
            for s in r.json().get("sheets", [])]


def fetch_csv(gid):
    url = f"https://docs.google.com/spreadsheets/d/{SHEET_ID}/export?format=csv&gid={gid}"
    r = requests.get(url, timeout=20)
    r.raise_for_status()
    return list(csv.reader(io.StringIO(r.content.decode("utf-8-sig"))))


def cell(row, idx):
    if idx >= len(row): return None
    v = row[idx].strip() if isinstance(row[idx], str) else row[idx]
    return None if v in (None, "", "nan") else v


def to_float(v):
    if v is None: return None
    s = str(v).replace(" ", "").replace("\xa0", "").replace(",", ".").replace("%", "")
    try:
        f = float(s)
        # якщо оригінал містив % і значення < 2 — вже частка (0.63), не множимо
        return f
    except ValueError:
        return None


def find_row(rows, *keywords):
    for i, row in enumerate(rows):
        c0 = (cell(row, 0) or "").lower()
        if any(kw.lower() in c0 for kw in keywords):
            return i
    return -1


# ── Парсинг Роздріб/Опт по фіксованих індексах колонок ───────────────────
def parse_by_month_index(rows, row_idx, months_map):
    """
    Читає значення за точними індексами колонок замість перебору по блоках.
    Набагато надійніше для складної структури файлу.
    """
    if row_idx < 0 or row_idx >= len(rows):
        return []
    row = rows[row_idx]
    result = []
    for month_name, plan_col, fact_col in months_map:
        plan = to_float(cell(row, plan_col))
        fact = to_float(cell(row, fact_col))
        # Санітарна перевірка: Роздріб 500K–5M, Опт 500K–200M
        if plan is not None and (plan < 100_000 or plan > 200_000_000):
            plan = None
        pct = round(fact / plan * 100, 1) if (plan and fact) else None
        # Якщо факт є але відсоток аномальний — не показуємо %
        if pct is not None and (pct > 500 or pct < 0):
            pct = None
        result.append({
            "month": month_name,
            "plan": plan,
            "fact": fact,
            "pct": pct,
        })
    # Відрізаємо хвіст без плану (майбутні місяці без планів)
    while result and result[-1]["plan"] is None and result[-1]["fact"] is None:
        result.pop()
    return result


# ── Парсинг якості лідів з листа "Аналіз лідів" ─────────────────────────
def parse_leads_quality(rows):
    """
    Агрегує щоденні дані лідів по місяцях.
    Колонки: [date, total, target_pct, spam_pct, no_contact_pct]
    """
    monthly = {}
    for row in rows[1:]:  # пропускаємо заголовок
        date_raw = cell(row, 0)
        if not date_raw or "Total" in str(date_raw): continue
        try:
            dt = datetime.strptime(str(date_raw)[:10], "%Y-%m-%d")
        except:
            continue
        total = to_float(cell(row, 1)) or 0
        target_pct  = to_float(cell(row, 2))  # частка цільових (0-1)
        spam_pct    = to_float(cell(row, 3))
        no_cont_pct = to_float(cell(row, 4))

        key = f"{dt.year}-{dt.month:02d}"
        if key not in monthly:
            monthly[key] = {"year": dt.year, "month": dt.month, "total": 0,
                            "target_sum": 0, "spam_sum": 0, "no_cont_sum": 0, "days": 0}
        m = monthly[key]
        m["total"]      += total
        m["target_sum"] += (target_pct or 0) * total
        m["spam_sum"]   += (spam_pct or 0)   * total
        m["no_cont_sum"]+= (no_cont_pct or 0)* total
        m["days"]       += 1

    UA_MONTHS = ["","Січень","Лютий","Березень","Квітень","Травень","Червень",
                 "Липень","Серпень","Вересень","Жовтень","Листопад","Грудень"]

    result = []
    for key in sorted(monthly.keys()):
        m = monthly[key]
        t = max(m["total"], 1)
        result.append({
            "month_key": key,
            "month_name": UA_MONTHS[m["month"]],
            "year": m["year"],
            "total_leads": round(m["total"]),
            "target_pct":  round(m["target_sum"] / t * 100, 1),
            "spam_pct":    round(m["spam_sum"]   / t * 100, 1),
            "no_cont_pct": round(m["no_cont_sum"]/ t * 100, 1),
        })
    return result


# ── Парсинг пайплайну оптових угод ───────────────────────────────────────
def parse_pipeline(rows):
    """
    Читає лист "Оптові угоди." і агрегує по стадіях воронки.
    Повертає: по стадіях (count, sum) + список активних угод.
    """
    stages_agg = {}
    active_deals = []

    for row in rows[1:]:  # пропускаємо заголовок
        deal_id  = cell(row, 0)
        client   = cell(row, 1) or ""
        weight   = to_float(cell(row, 2))
        price_g  = to_float(cell(row, 3))
        total_raw = cell(row, 4)
        manager  = (cell(row, 5) or "").strip()
        status   = (cell(row, 6) or "").strip()
        comment  = (cell(row, 7) or "")[:80]
        deadline = cell(row, 9) or ""

        if not deal_id and not status: continue

        # Очищаємо суму
        total = 0
        if total_raw:
            cleaned = str(total_raw).replace(" ","").replace(",",".").replace("'","")
            try: total = float(cleaned)
            except: total = 0

        # Знаходимо стадію
        stage = "other"
        for kw, st in PIPELINE_STAGES.items():
            if kw.lower() in status.lower():
                stage = st
                break

        if stage not in stages_agg:
            stages_agg[stage] = {"count": 0, "sum": 0.0}
        stages_agg[stage]["count"] += 1
        stages_agg[stage]["sum"]   += total

        # Активні угоди (не програні)
        if stage not in ("lost",) and total > 0:
            active_deals.append({
                "id": deal_id,
                "client": client[:40],
                "total": total,
                "stage": stage,
                "stage_label": PIPELINE_STAGE_LABELS.get(stage, stage),
                "manager": manager,
                "deadline": str(deadline)[:10],
            })

    # Формуємо зведення по стадіях
    stages_summary = []
    for stage_key in ["won","active","test","calculation","waiting","slow","lost","other"]:
        if stage_key in stages_agg:
            d = stages_agg[stage_key]
            stages_summary.append({
                "stage": stage_key,
                "label": PIPELINE_STAGE_LABELS.get(stage_key, stage_key),
                "count": d["count"],
                "sum":   round(d["sum"]),
            })

    total_pipeline = sum(s["sum"] for s in stages_summary if s["stage"] not in ("lost",))
    won_sum = stages_agg.get("won", {}).get("sum", 0)
    win_rate = round(won_sum / total_pipeline * 100, 1) if total_pipeline > 0 else 0

    return {
        "stages": stages_summary,
        "total_active_sum": round(total_pipeline),
        "won_sum": round(won_sum),
        "win_rate_pct": win_rate,
        "active_deals": sorted(active_deals, key=lambda x: -x["total"])[:15],
    }


# ── Ефективність менеджерів (похідні метрики, без абсолютних ЗП) ─────────
def parse_manager_efficiency(zp_rows, pipeline):
    """
    З листа ЗП беремо тільки відносні метрики:
    - Кількість тижнів активності
    - Частка угод менеджера від загального пайплайну
    - Умовний індекс навантаженості (не ЗП!)
    З пайплайну рахуємо суму угод по менеджеру.
    """
    if not zp_rows or len(zp_rows) < 2:
        return []

    # Заголовок: [Місяць, Тиждень, Шанюк, Климчук, Беднарський, Приходько]
    header = [str(v).strip() for v in zp_rows[0] if str(v).strip() not in ('nan','')]
    managers = header[2:]  # перші 2 — Місяць і Тиждень

    # Рахуємо кількість тижнів і суму умовних балів активності
    activity = {m: {"weeks": 0, "active_weeks": 0} for m in managers}
    for row in zp_rows[1:]:
        vals = [str(v).strip() for v in row]
        for i, m in enumerate(managers):
            col = i + 2
            if col < len(vals) and vals[col] not in ('nan','','0'):
                try:
                    v = float(vals[col].replace(' ',''))
                    if v > 0:
                        activity[m]["weeks"]       += 1
                        activity[m]["active_weeks"] += 1
                except: pass

    # Угоди менеджерів з пайплайну
    manager_deals = {}
    for deal in pipeline.get("active_deals", []):
        mgr = deal["manager"]
        if mgr not in manager_deals:
            manager_deals[mgr] = {"count": 0, "sum": 0}
        manager_deals[mgr]["count"] += 1
        manager_deals[mgr]["sum"]   += deal["total"]

    total_pipeline_sum = sum(d["sum"] for d in manager_deals.values()) or 1

    result = []
    for m in managers:
        # Шукаємо менеджера в пайплайні (часткове співпадіння по прізвищу)
        mgr_key = None
        m_last = m.split()[-1].lower() if m else ""
        for k in manager_deals:
            if m_last and m_last in k.lower():
                mgr_key = k
                break

        deals_sum = manager_deals.get(mgr_key, {}).get("sum", 0) if mgr_key else 0
        deals_cnt = manager_deals.get(mgr_key, {}).get("count", 0) if mgr_key else 0
        pipeline_share_pct = round(deals_sum / total_pipeline_sum * 100, 1)
        active_w = activity[m]["active_weeks"]

        # Індекс навантаженості: угоди на активний тиждень (відносний, не ЗП)
        deals_per_week = round(deals_cnt / max(active_w, 1), 2)

        result.append({
            "manager": m,
            "active_weeks": active_w,
            "deals_count": deals_cnt,
            "deals_sum": round(deals_sum),
            "pipeline_share_pct": pipeline_share_pct,
            "deals_per_week": deals_per_week,
        })

    return sorted(result, key=lambda x: -x["deals_sum"])


def main():
    print(f"[SALES] Sheet ID: {SHEET_ID}")
    if not API_KEY:
        raise SystemExit("[ERROR] GOOGLE_API_KEY не встановлено")

    all_sheets = get_sheet_list()
    print(f"[SALES] Листи: {[s['title'] for s in all_sheets]}")

    def get_sheet(name):
        sheet = next((s for s in all_sheets if s["title"].strip() == name.strip()), None)
        if not sheet:
            sheet = next((s for s in all_sheets if name.strip()[:15] in s["title"]), None)
        return sheet

    # ── Планування (Роздріб/Опт) ─────────────────────────────────────────
    planning = get_sheet(PLANNING_SHEET)
    retail_monthly, wholesale_monthly = [], []
    check_monthly, leads_conv = [], []

    if planning:
        rows = fetch_csv(planning["gid"])
        retail_idx    = find_row(rows, "Виручка загальна (роздріб)")
        wholesale_idx = find_row(rows, "по FDM (ОПТ)")
        check_idx     = find_row(rows, "Cр. чек продажу", "Ср. чек продажу")
        leads_idx     = find_row(rows, "К-сть лідів")
        deals_idx     = find_row(rows, "Успішні угоди")

        retail_monthly    = parse_by_month_index(rows, retail_idx,    MONTHS_2026) if retail_idx    >= 0 else []
        wholesale_monthly = parse_by_month_index(rows, wholesale_idx, MONTHS_2026) if wholesale_idx >= 0 else []
        check_monthly     = parse_by_month_index(rows, check_idx,     MONTHS_2026) if check_idx     >= 0 else []

        leads_data  = parse_by_month_index(rows, leads_idx,  MONTHS_2026) if leads_idx  >= 0 else []
        deals_data  = parse_by_month_index(rows, deals_idx,  MONTHS_2026) if deals_idx  >= 0 else []
        for i, lm in enumerate(leads_data):
            df = deals_data[i]["fact"] if i < len(deals_data) else None
            lf = lm["fact"]
            conv = round(df / lf * 100, 1) if (df and lf) else None
            leads_conv.append({"month": lm["month"], "leads": lf, "conv_pct": conv})

        print(f"[SALES] Роздріб: {len([m for m in retail_monthly if m['fact']])} міс з фактом")
        print(f"[SALES] Опт: {len([m for m in wholesale_monthly if m['fact']])} міс з фактом")
    else:
        print("[WARN] Лист планування не знайдено")

    # ── Якість лідів ─────────────────────────────────────────────────────
    leads_sheet = get_sheet(LEADS_SHEET)
    leads_quality = []
    if leads_sheet:
        rows = fetch_csv(leads_sheet["gid"])
        leads_quality = parse_leads_quality(rows)
        print(f"[SALES] Якість лідів: {len(leads_quality)} місяців")

    # ── Пайплайн оптових угод ────────────────────────────────────────────
    pipeline_sheet = get_sheet(PIPELINE_SHEET)
    pipeline = {"stages": [], "total_active_sum": 0, "won_sum": 0, "win_rate_pct": 0, "active_deals": []}
    if pipeline_sheet:
        rows = fetch_csv(pipeline_sheet["gid"])
        pipeline = parse_pipeline(rows)
        print(f"[SALES] Пайплайн: {len(pipeline['active_deals'])} активних угод, {pipeline['total_active_sum']:,} грн")

    # ── Ефективність менеджерів ───────────────────────────────────────────
    mgr_sheet = get_sheet(MANAGERS_SHEET)
    manager_efficiency = []
    if mgr_sheet:
        rows = fetch_csv(mgr_sheet["gid"])
        manager_efficiency = parse_manager_efficiency(rows, pipeline)
        print(f"[SALES] Менеджери: {len(manager_efficiency)} осіб")

    # ── YTD зведення ─────────────────────────────────────────────────────
    def ytd(monthly):
        plan_s = sum(m["plan"] for m in monthly if m["plan"])
        fact_s = sum(m["fact"] for m in monthly if m["fact"])
        pct    = round(fact_s / plan_s * 100, 1) if plan_s else 0
        return plan_s, fact_s, pct

    rp, rf, rp_pct = ytd(retail_monthly)
    wp, wf, wp_pct = ytd(wholesale_monthly)

    output = {
        "fetched_at": datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
        "retail": {
            "monthly": retail_monthly,
            "ytd_plan": rp, "ytd_fact": rf, "ytd_pct": rp_pct,
        },
        "wholesale": {
            "monthly": wholesale_monthly,
            "ytd_plan": wp, "ytd_fact": wf, "ytd_pct": wp_pct,
        },
        "avg_check": {
            "target": 4500,
            "monthly": [{"month": m["month"], "fact": m["fact"]} for m in check_monthly],
        },
        "leads_conversion": {
            "target_leads": 2000, "target_conv_pct": 15,
            "monthly": leads_conv,
        },
        "leads_quality":        leads_quality,
        "pipeline":             pipeline,
        "manager_efficiency":   manager_efficiency,
    }

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[OK] {OUTPUT} — {OUTPUT.stat().st_size} байт")


if __name__ == "__main__":
    main()
