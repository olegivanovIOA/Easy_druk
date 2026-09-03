#!/usr/bin/env python3
"""
fetch_cashflow.py — Easy 3D Print Dashboard
Читає CF_2026 з Google Sheets і генерує data/cashflow.json
з усіма вичислюваними метриками для вкладки Фінанси.
"""

import csv, io, json, os, re
from pathlib import Path
from datetime import datetime
import requests

SHEET_ID = os.environ.get("CF_SHEET_ID", "12BUNnDcDz2e_HG5WI8Oh2Ack_ZDOg1I9FwxP7H8MqV8")
API_KEY  = os.environ.get("GOOGLE_API_KEY", "")
OUTPUT   = Path(__file__).parent / "data" / "cashflow.json"

CF_SHEET      = "CF_2026"
CLIENTS_SHEET = "_Клієнти_Місячно"
TOP2_SHEET    = "_Клієнти_Топ2"

MONTHS_UA = ["Січень","Лютий","Березень","Квітень","Травень","Червень","Липень",
             "Серпень","Вересень","Жовтень","Листопад","Грудень"]

# Індекси рядків у CF_2026 (0-based)
ROWS = {
    "balance_start": 3,
    "balance_end":   4,
    "revenue":       19,
    "opt_b2b":       20,
    "retail_b2c":    21,
    "top2_conc":     23,
    "cogs":          44,
    "salary":        53,
    "production":    57,
    "electro":       61,
    "communal":      65,
    "rent":          77,
    "capex":         141,
    "logistics":     85,
    "taxes":         116,
    "admin":         120,
    "marketing":     128,
    "op_cf":         134,
    "inv_cf":        143,
    "dividends":     148,
    "fin_cf":        154,
    "net_in":        160,
    "delta":         161,
}

# Колонки: пари (прихід, витрати) для кожного місяця
# Місяць 1=Січень → cols 2,3 | Місяць 2=Лютий → cols 4,5 ...
def month_cols(month_idx):  # 0-based
    base = 2 + month_idx * 2
    return base, base + 1


def get_sheet_list():
    url = (f"https://sheets.googleapis.com/v4/spreadsheets/{SHEET_ID}"
           f"?fields=sheets.properties(sheetId,title)&key={API_KEY}")
    r = requests.get(url, timeout=15)
    r.raise_for_status()
    return {s["properties"]["title"]: str(s["properties"]["sheetId"])
            for s in r.json().get("sheets", [])}


def fetch_csv(gid):
    url = (f"https://docs.google.com/spreadsheets/d/{SHEET_ID}"
           f"/export?format=csv&gid={gid}")
    r = requests.get(url, timeout=20)
    r.raise_for_status()
    return list(csv.reader(io.StringIO(r.content.decode("utf-8-sig"))))


def to_float(v):
    if v is None: return None
    s = str(v).replace(" ", "").replace("\xa0", "").replace(",", ".").replace("%","")
    try: return float(s)
    except: return None


def cell(rows, row_idx, col_idx):
    if row_idx >= len(rows): return None
    row = rows[row_idx]
    if col_idx >= len(row): return None
    return to_float(row[col_idx])


def parse_cf(rows, n_months):
    """Парсить CF_2026 → список місяців з усіма метриками."""
    months = []
    for mi in range(n_months):
        ic, ec = month_cols(mi)
        # Назва місяця з рядка 1
        month_name = rows[1][ic] if ic < len(rows[1]) else f"М{mi+1}"

        def get(row_key, col="exp"):
            ri = ROWS.get(row_key)
            if ri is None: return None
            c = ic if col == "inc" else ec
            # Для рядків де значення в одній колонці (delta)
            if row_key in ("balance_start","balance_end","revenue","opt_b2b",
                           "retail_b2c","op_cf","inv_cf","fin_cf","delta"):
                # Шукаємо непорожнє значення в обох колонках
                v = cell(rows, ri, ic)
                if v is None: v = cell(rows, ri, ec)
                return v
            return cell(rows, ri, c)

        rev    = get("revenue")
        opt    = get("opt_b2b")
        retail = get("retail_b2c")
        cogs   = get("cogs")
        salary = get("salary")
        prod   = get("production")
        elec   = get("electro")
        comm   = get("communal")
        rent   = get("rent")
        logi   = get("logistics")
        taxes  = get("taxes")
        adm    = get("admin")
        mkt    = get("marketing")
        capex  = get("capex")
        divid  = get("dividends")
        op_cf  = get("op_cf")
        delta  = get("delta")
        bal_s  = get("balance_start")
        bal_e  = get("balance_end")

        # Вичислювані метрики
        def safe_div(a, b, mult=1):
            return round(a / b * mult, 2) if b and a is not None else None

        total_opex = sum(x for x in [cogs, salary, elec, rent, logi, adm, mkt] if x)
        gross_profit = (rev - (cogs or 0) - (salary or 0) - (elec or 0)) if rev else None
        ebitda = (rev - total_opex) if rev else None

        months.append({
            "month": month_name,
            "month_idx": mi + 1,
            # Доходи
            "revenue":    rev,
            "opt_b2b":    opt,
            "retail_b2c": retail,
            # Витрати
            "cogs":       cogs,
            "salary":     salary,
            "electro":    elec,
            "rent":       rent,
            "logistics":  logi,
            "taxes":      taxes,
            "admin":      adm,
            "marketing":  mkt,
            "capex":      capex,
            "dividends":  divid,
            # CF
            "op_cf":      op_cf,
            "delta":      delta,
            "balance_start": bal_s,
            "balance_end":   bal_e,
            # Вичислювані (calc → yes)
            "gross_profit":      round(gross_profit) if gross_profit else None,
            "gross_margin_pct":  safe_div(gross_profit, rev, 100),
            "ebitda":            round(ebitda) if ebitda else None,
            "ebitda_pct":        safe_div(ebitda, rev, 100),
            "cogs_pct":          safe_div(cogs, rev, 100),
            "salary_pct":        safe_div(salary, rev, 100),
            "marketing_pct":     safe_div(mkt, rev, 100),
            "capex_pct":         safe_div(capex, rev, 100),
            "electro_pct":       safe_div(elec, rev, 100),
            "total_opex":        round(total_opex) if total_opex else None,
            "opex_pct":          safe_div(total_opex, rev, 100),
        })
    return months


def parse_clients(rows_m, rows_top2, months_data):
    """Парсить клієнтські дані → концентрація топ-2, кількість клієнтів."""
    # _Клієнти_Топ2
    top2_by_month = {}
    clients_by_month = {}
    for row in rows_top2[1:]:
        if not row or not row[0]: continue
        month_key = str(row[0]).strip()
        top2 = to_float(row[1]) if len(row) > 1 else None
        clients = to_float(row[2]) if len(row) > 2 else None
        if month_key:
            top2_by_month[month_key] = top2
            clients_by_month[month_key] = int(clients) if clients else None

    # Матчимо до місяців
    month_keys = [f"2026-{str(m['month_idx']).zfill(2)}" for m in months_data]
    for i, m in enumerate(months_data):
        key = month_keys[i]
        m["top2_sum"] = top2_by_month.get(key)
        m["clients_count"] = clients_by_month.get(key)
        if m["revenue"] and m["top2_sum"]:
            m["top2_concentration_pct"] = round(m["top2_sum"] / m["revenue"] * 100, 1)
        else:
            m["top2_concentration_pct"] = None

    return months_data


def calc_ytd(months):
    """YTD підсумки."""
    def s(key):
        vals = [m[key] for m in months if m.get(key) is not None]
        return sum(vals) if vals else None

    rev_ytd  = s("revenue")
    opex_ytd = s("total_opex")
    ebitda_ytd = (rev_ytd - opex_ytd) if rev_ytd and opex_ytd else None

    return {
        "revenue":     rev_ytd,
        "opt_b2b":     s("opt_b2b"),
        "retail_b2c":  s("retail_b2c"),
        "ebitda":      ebitda_ytd,
        "ebitda_pct":  round(ebitda_ytd / rev_ytd * 100, 1) if ebitda_ytd and rev_ytd else None,
        "cogs":        s("cogs"),
        "salary":      s("salary"),
        "marketing":   s("marketing"),
        "capex":       s("capex"),
        "dividends":   s("dividends"),
        "net_delta":   s("delta"),
        "taxes":       s("taxes"),
    }


def calc_runway(months):
    """Runway в місяцях."""
    last = months[-1]
    balance = last.get("balance_end")
    recent = [m.get("total_opex") for m in months[-3:] if m.get("total_opex")]
    avg_burn = sum(recent) / len(recent) if recent else None
    if balance and avg_burn and avg_burn > 0:
        return round(balance / avg_burn, 1)
    return None


def main():
    print(f"[CF] Sheet ID: {SHEET_ID}")
    if not API_KEY:
        raise SystemExit("[ERROR] GOOGLE_API_KEY не встановлено")

    sheets = get_sheet_list()
    print(f"[CF] Листи: {list(sheets.keys())}")

    # CF_2026
    cf_gid = sheets.get(CF_SHEET)
    if not cf_gid:
        raise SystemExit(f"[ERROR] Лист '{CF_SHEET}' не знайдено")

    rows = fetch_csv(cf_gid)
    print(f"[CF] CF_2026: {len(rows)} рядків")

    # Визначаємо кількість місяців з заголовку
    months_row = rows[1] if len(rows) > 1 else []
    n_months = sum(1 for v in months_row
                   if v.strip() in MONTHS_UA)
    print(f"[CF] Місяців: {n_months}")

    months_data = parse_cf(rows, n_months)

    # Клієнти
    try:
        top2_rows = fetch_csv(sheets[TOP2_SHEET])
        cli_rows  = fetch_csv(sheets[CLIENTS_SHEET])
        months_data = parse_clients(cli_rows, top2_rows, months_data)
        print("[CF] Клієнтські дані завантажено")
    except Exception as e:
        print(f"[WARN] Клієнти: {e}")

    ytd = calc_ytd(months_data)
    runway = calc_runway(months_data)

    output = {
        "fetched_at": datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
        "months":     months_data,
        "ytd":        ytd,
        "runway_months": runway,
        "last_balance":  months_data[-1].get("balance_end") if months_data else None,
    }

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[OK] {OUTPUT} — {OUTPUT.stat().st_size:,} байт, {n_months} місяців")

    # Підсумок
    print("\n=== YTD ПІДСУМОК ===")
    for k, v in ytd.items():
        if v: print(f"  {k}: {v:,.1f}" if isinstance(v, float) else f"  {k}: {v:,}")
    print(f"  runway: {runway} місяців")


if __name__ == "__main__":
    main()
