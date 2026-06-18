#!/usr/bin/env python3
"""
fetch_sales.py — Easy 3D Print Dashboard
Читає лист "Планування на 2026 рік" з Google Sheets Планувальника
і витягує помісячні План/Факт дані по Роздробу та Опту.
"""

import csv, io, json, os, re
from pathlib import Path
from datetime import datetime
import requests

SHEET_ID = os.environ.get("SALES_SHEET_ID", "1M4daThbhYfnLjXTGEjLloFiwcYFumGgF-zt0ZgKQDw0")
API_KEY  = os.environ.get("GOOGLE_API_KEY", "")
OUTPUT   = Path(__file__).parent / "data" / "sales_planner.json"

PLANNING_SHEET_NAME = "Планування на 2026 рік "

MONTH_SEQUENCE = ["Січень", "Лютий", "Березень", "Квітень", "Травень", "Червень",
                   "Липень", "Серпень", "Вересень", "Жовтень", "Листопад", "Грудень"]


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
    if idx >= len(row):
        return None
    v = row[idx].strip() if isinstance(row[idx], str) else row[idx]
    if v in (None, "", "nan"):
        return None
    return v


def to_float(v):
    """Парсить число з рядка. Прибирає пробіли, %, заміняє кому на крапку."""
    if v is None:
        return None
    s = str(v).replace(" ", "").replace("\xa0", "").replace(",", ".")
    had_pct = "%" in s
    s = s.replace("%", "")
    try:
        f = float(s)
        # Якщо в оригіналі був символ % — повертаємо як частку (63% → 0.63)
        # ЩОБ уніфікувати з форматом без %, де 0.63 теж означає 63%
        return f / 100 if had_pct else f
    except ValueError:
        return None


def find_row(rows, *keywords):
    for i, row in enumerate(rows):
        c0 = (cell(row, 0) or "").lower()
        if any(kw.lower() in c0 for kw in keywords):
            return i
    return -1


def parse_simple_3col_row(rows, row_idx, max_months=12):
    if row_idx < 0 or row_idx >= len(rows):
        return []
    row = rows[row_idx]
    result = []
    idx = 2  # col0=назва, col1=порожня (роздільник), дані з col2
    month_i = 0

    while idx < len(row) and month_i < max_months:
        plan = to_float(cell(row, idx))
        fact = to_float(cell(row, idx + 1))
        pct_raw = cell(row, idx + 2)
        pct = None
        if pct_raw is not None:
            pv = to_float(pct_raw)
            if pv is not None:
                # pv тепер завжди частка (0.63 = 63%), якщо в клітинці був %
                # або вже частка, або вже відсоток (63) — нормалізуємо
                pct = round(pv * 100, 1) if pv <= 2 else round(pv, 1)

        if plan is None and fact is None:
            idx += 3
            month_i += 1
            continue

        if pct is not None and (pct > 500 or pct < -10):
            pct = None  # аномалія — приховуємо лише %, лишаємо план/факт

        if month_i < len(MONTH_SEQUENCE):
            result.append({
                "month": MONTH_SEQUENCE[month_i],
                "plan": plan,
                "fact": fact,
                "pct": pct,
            })
        idx += 3
        month_i += 1

    return result


def parse_wholesale_row(rows, row_idx, max_months=6):
    """
    max_months обмежено 6 (Січень-Червень) — структура файлу після цього
    містить тижневі залишки/підсумки які не парсяться як окремі місяці.
    """
    if row_idx < 0 or row_idx >= len(rows):
        return []
    row = rows[row_idx]
    result = []
    idx = 1
    month_i = 0

    while idx < len(row) and month_i < max_months:
        plan = to_float(cell(row, idx))
        fact = to_float(cell(row, idx + 1)) if plan is not None else None

        if plan is None:
            idx += 1
            continue

        if plan < 1_000_000 or plan > 100_000_000:
            idx += 1
            continue

        pct = None
        if plan and fact is not None:
            pct = round(fact / plan * 100, 1)
            if pct > 500 or pct < -10:
                pct = None

        if month_i < len(MONTH_SEQUENCE):
            result.append({
                "month": MONTH_SEQUENCE[month_i],
                "plan": plan,
                "fact": fact,
                "pct": pct,
            })
        month_i += 1
        idx += 9

    return result


def main():
    print(f"[SALES] Sheet ID: {SHEET_ID}")
    if not API_KEY:
        raise SystemExit("[ERROR] GOOGLE_API_KEY не встановлено")

    all_sheets = get_sheet_list()
    print(f"[SALES] Знайдено листів: {[s['title'] for s in all_sheets]}")

    planning_sheet = next((s for s in all_sheets if s["title"].strip() == PLANNING_SHEET_NAME.strip()), None)
    if not planning_sheet:
        planning_sheet = next((s for s in all_sheets if "Планування на 2026" in s["title"]), None)

    if not planning_sheet:
        raise SystemExit(f"[ERROR] Лист '{PLANNING_SHEET_NAME}' не знайдено")

    print(f"[SALES] Читаю лист '{planning_sheet['title']}' (gid={planning_sheet['gid']})")
    rows = fetch_csv(planning_sheet["gid"])

    retail_idx = find_row(rows, "Виручка загальна (роздріб)")
    wholesale_idx = find_row(rows, "по FDM (ОПТ)")
    check_idx = find_row(rows, "Cр. чек продажу", "Ср. чек продажу")
    leads_idx = find_row(rows, "К-сть лідів")
    deals_idx = find_row(rows, "Успішні угоди")

    print(f"[SALES] Рядки: роздріб={retail_idx}, опт={wholesale_idx}, чек={check_idx}, ліди={leads_idx}, угоди={deals_idx}")

    # Дебаг: показуємо сирі значення першого блоку (3 колонки) роздробу для діагностики
    if retail_idx >= 0:
        raw_row = rows[retail_idx]
        print(f"[SALES] DEBUG retail row[0:8]: {raw_row[0:8]}")

    retail_monthly = parse_simple_3col_row(rows, retail_idx) if retail_idx >= 0 else []
    wholesale_monthly = parse_wholesale_row(rows, wholesale_idx) if wholesale_idx >= 0 else []
    check_monthly = parse_simple_3col_row(rows, check_idx) if check_idx >= 0 else []
    leads_monthly = parse_simple_3col_row(rows, leads_idx) if leads_idx >= 0 else []
    deals_monthly = parse_simple_3col_row(rows, deals_idx) if deals_idx >= 0 else []

    print(f"[SALES] Роздріб: {len(retail_monthly)} місяців")
    for m in retail_monthly:
        print(f"         {m}")
    print(f"[SALES] Опт: {len(wholesale_monthly)} місяців")
    for m in wholesale_monthly:
        print(f"         {m}")
    print(f"[SALES] Сер.чек: {len(check_monthly)} місяців")
    for m in check_monthly:
        print(f"         {m}")

    def ytd(monthly):
        plan_sum = sum(m["plan"] for m in monthly if m["plan"])
        fact_sum = sum(m["fact"] for m in monthly if m["fact"])
        pct = round(fact_sum / plan_sum * 100, 1) if plan_sum else 0
        return plan_sum, fact_sum, pct

    retail_plan, retail_fact, retail_pct = ytd(retail_monthly)
    wh_plan, wh_fact, wh_pct = ytd(wholesale_monthly)

    leads_conv = []
    for i, lm in enumerate(leads_monthly):
        deals_fact = deals_monthly[i]["fact"] if i < len(deals_monthly) else None
        leads_fact = lm["fact"]
        conv_pct = round(deals_fact / leads_fact * 100, 1) if (deals_fact and leads_fact) else None
        leads_conv.append({"month": lm["month"], "leads": leads_fact, "conv_pct": conv_pct})

    avg_check_monthly = [{"month": m["month"], "fact": m["fact"]} for m in check_monthly]

    output = {
        "fetched_at": datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
        "retail": {
            "monthly": retail_monthly,
            "ytd_plan": retail_plan,
            "ytd_fact": retail_fact,
            "ytd_pct": retail_pct,
        },
        "wholesale": {
            "monthly": wholesale_monthly,
            "ytd_plan": wh_plan,
            "ytd_fact": wh_fact,
            "ytd_pct": wh_pct,
        },
        "avg_check": {"target": 4500, "monthly": avg_check_monthly},
        "leads_conversion": {"target_leads": 2000, "target_conv_pct": 15, "monthly": leads_conv},
        "note": "Дані з листа 'Планування на 2026 рік' Google Sheets Планувальника",
    }

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[OK] {OUTPUT} — {OUTPUT.stat().st_size} байт")


if __name__ == "__main__":
    main()
