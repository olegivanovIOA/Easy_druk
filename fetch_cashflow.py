#!/usr/bin/env python3
"""
fetch_cashflow.py — Easy 3D Print Dashboard v4.4
Читає CF_2026 з Google Sheets через Service Account (не API key).
403 fix: CF таблиця закрита — треба SA авторизація.
"""

import csv, io, json, os, re
from pathlib import Path
from datetime import datetime
import requests

SHEET_ID = os.environ.get("CF_SHEET_ID", "12BUNnDcDz2e_HG5WI8Oh2Ack_ZDOg1I9FwxP7H8MqV8")
SA_JSON  = os.environ.get("GOOGLE_SERVICE_ACCOUNT_JSON", "")
OUTPUT   = Path(__file__).parent / "data" / "cashflow.json"

CF_SHEET      = "CF_2026"
CLIENTS_SHEET = "_Клієнти_Місячно"
TOP2_SHEET    = "_Клієнти_Топ2"

MONTHS_UA = ["Січень","Лютий","Березень","Квітень","Травень","Червень","Липень",
             "Серпень","Вересень","Жовтень","Листопад","Грудень"]

ROWS = {
    "balance_start": 3,  "balance_end": 4,
    "revenue": 19,       "opt_b2b": 20,
    "retail_b2c": 21,    "top2_conc": 23,
    "cogs": 44,          "salary": 53,
    "production": 57,    "electro": 61,
    "communal": 65,      "rent": 77,
    "capex": 141,        "logistics": 85,
    "taxes": 116,        "admin": 120,
    "marketing": 128,    "op_cf": 134,
    "inv_cf": 143,       "fin_cf": 154,
    "delta": 161,
}

def get_token():
    """OAuth2 токен через Service Account."""
    import json as _json, time, base64, hashlib, hmac
    if not SA_JSON:
        raise SystemExit("[ERROR] GOOGLE_SERVICE_ACCOUNT_JSON не встановлено")
    sa = _json.loads(SA_JSON)

    # JWT
    import urllib.parse
    header = base64.urlsafe_b64encode(
        _json.dumps({"alg":"RS256","typ":"JWT"}).encode()).rstrip(b'=').decode()
    now = int(time.time())
    claim = base64.urlsafe_b64encode(_json.dumps({
        "iss": sa["client_email"],
        "scope": "https://www.googleapis.com/auth/spreadsheets.readonly",
        "aud": "https://oauth2.googleapis.com/token",
        "exp": now + 3600, "iat": now
    }).encode()).rstrip(b'=').decode()

    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import padding
    from cryptography.hazmat.backends import default_backend

    key = serialization.load_pem_private_key(
        sa["private_key"].encode(), password=None, backend=default_backend())
    sig_input = f"{header}.{claim}".encode()
    sig = base64.urlsafe_b64encode(
        key.sign(sig_input, padding.PKCS1v15(), hashes.SHA256())).rstrip(b'=').decode()

    jwt = f"{header}.{claim}.{sig}"
    r = requests.post("https://oauth2.googleapis.com/token", data={
        "grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer",
        "assertion": jwt
    }, timeout=15)
    r.raise_for_status()
    return r.json()["access_token"]


def get_sheet_list(token):
    url = (f"https://sheets.googleapis.com/v4/spreadsheets/{SHEET_ID}"
           f"?fields=sheets.properties(sheetId,title)")
    r = requests.get(url, headers={"Authorization": f"Bearer {token}"}, timeout=15)
    r.raise_for_status()
    return {s["properties"]["title"]: str(s["properties"]["sheetId"])
            for s in r.json().get("sheets", [])}


def fetch_csv(gid, token):
    url = (f"https://docs.google.com/spreadsheets/d/{SHEET_ID}"
           f"/export?format=csv&gid={gid}")
    r = requests.get(url, headers={"Authorization": f"Bearer {token}"}, timeout=20)
    r.raise_for_status()
    return list(csv.reader(io.StringIO(r.content.decode("utf-8-sig"))))


def to_float(v):
    if v is None: return None
    s = str(v).replace(" ","").replace("\xa0","").replace(",",".").replace("%","")
    try: return float(s)
    except: return None


def month_cols(mi):
    base = 2 + mi * 2
    return base, base + 1


def get_row_val(rows, row_key, mi):
    """Отримує значення з рядка CF для місяця mi."""
    ri = ROWS.get(row_key)
    if ri is None or ri >= len(rows): return None
    row = rows[ri]
    ic, ec = month_cols(mi)

    # Рядки де значення в одній з двох колонок
    scalar_rows = {"balance_start","balance_end","revenue","opt_b2b","retail_b2c",
                   "op_cf","inv_cf","fin_cf","delta"}
    if row_key in scalar_rows:
        v = to_float(row[ic]) if ic < len(row) else None
        if v is None: v = to_float(row[ec]) if ec < len(row) else None
        return v
    # Витрати — завжди в колонці витрат
    return to_float(row[ec]) if ec < len(row) else None


# ── Визначаємо чи місяць "повний" ────────────────────────────────────────────
def is_month_complete(month_name, revenue, balance_end):
    """
    Місяць вважається неповним якщо:
    - Поточний місяць (вересень 2026) → Серпень+ неповні
    - Або дуже мало клієнтів (< 20) при великій виручці (ознака часткових даних)
    """
    today = datetime.utcnow()
    cur_year, cur_month = today.year, today.month
    # Знаходимо індекс місяця
    try:
        mi = MONTHS_UA.index(month_name)  # 0-based
    except ValueError:
        return True
    # Місяць вважається повним якщо він < поточного місяця (у 2026)
    month_num = mi + 1  # 1-based
    if cur_year == 2026:
        return month_num < cur_month
    return True


def parse_cf(rows, n_months):
    months = []
    for mi in range(n_months):
        ic, _ = month_cols(mi)
        month_name = rows[1][ic].strip() if ic < len(rows[1]) else f"М{mi+1}"

        def g(key): return get_row_val(rows, key, mi)

        rev    = g("revenue")
        opt    = g("opt_b2b")
        retail = g("retail_b2c")
        cogs   = g("cogs")
        salary = g("salary")
        elec   = g("electro")
        rent   = g("rent")
        logi   = g("logistics")
        taxes  = g("taxes")
        adm    = g("admin")
        mkt    = g("marketing")
        capex  = g("capex")
        op_cf  = g("op_cf")
        delta  = g("delta")
        bal_s  = g("balance_start")
        bal_e  = g("balance_end")

        total_opex = sum(x for x in [cogs,salary,elec,rent,logi,adm,mkt] if x)
        gross_profit = (rev-(cogs or 0)-(salary or 0)-(elec or 0)) if rev else None
        ebitda = (rev - total_opex) if rev and total_opex else None

        def pct(a, b):
            return round(a/b*100, 1) if a and b else None

        complete = is_month_complete(month_name, rev, bal_e)

        months.append({
            "month":      month_name,
            "month_idx":  mi + 1,
            "complete":   complete,   # ← новий прапор
            # Доходи
            "revenue":    rev,
            "opt_b2b":    opt,
            "retail_b2c": retail,
            # Витрати (без дивідендів — не виводимо)
            "cogs":       cogs,
            "salary":     salary,
            "electro":    elec,
            "rent":       rent,
            "logistics":  logi,
            "taxes":      taxes,
            "admin":      adm,
            "marketing":  mkt,
            "capex":      capex,
            # CF
            "op_cf":      op_cf,
            "delta":      delta,
            "balance_start": bal_s,
            "balance_end":   bal_e,
            # Вичислювані
            "gross_profit":     round(gross_profit) if gross_profit else None,
            "gross_margin_pct": pct(gross_profit, rev),
            "ebitda":           round(ebitda) if ebitda else None,
            "ebitda_pct":       pct(ebitda, rev),
            "cogs_pct":         pct(cogs, rev),
            "salary_pct":       pct(salary, rev),
            "marketing_pct":    pct(mkt, rev),
            "capex_pct":        pct(capex, rev),
            "electro_pct":      pct(elec, rev),
            "total_opex":       round(total_opex) if total_opex else None,
            "opex_pct":         pct(total_opex, rev),
        })
    return months


def parse_clients(rows_top2, months_data):
    top2_map = {}
    cli_map  = {}
    for row in rows_top2[1:]:
        if not row or not row[0]: continue
        key = str(row[0]).strip()
        top2 = to_float(row[1]) if len(row)>1 else None
        cnt  = to_float(row[2]) if len(row)>2 else None
        top2_map[key] = top2
        cli_map[key]  = int(cnt) if cnt else None

    for m in months_data:
        key = f"2026-{str(m['month_idx']).zfill(2)}"
        m["top2_sum"]      = top2_map.get(key)
        m["clients_count"] = cli_map.get(key)
        if m["revenue"] and m["top2_sum"]:
            m["top2_concentration_pct"] = round(m["top2_sum"]/m["revenue"]*100, 1)
        else:
            m["top2_concentration_pct"] = None
    return months_data


def calc_ytd(months):
    # YTD тільки по ПОВНИХ місяцях
    complete = [m for m in months if m.get("complete")]
    def s(key):
        return sum(m[key] for m in complete if m.get(key)) or None
    rev = s("revenue")
    opex = s("total_opex")
    ebitda = (rev - opex) if rev and opex else None
    return {
        "revenue":    rev,
        "opt_b2b":    s("opt_b2b"),
        "retail_b2c": s("retail_b2c"),
        "ebitda":     ebitda,
        "ebitda_pct": round(ebitda/rev*100,1) if ebitda and rev else None,
        "cogs":       s("cogs"),
        "salary":     s("salary"),
        "marketing":  s("marketing"),
        "capex":      s("capex"),
        "net_delta":  s("delta"),
        "taxes":      s("taxes"),
        "months_count": len(complete),
    }


def main():
    print(f"[CF] Sheet ID: {SHEET_ID}")
    token = get_token()
    print("[CF] Token OK")

    sheets = get_sheet_list(token)
    print(f"[CF] Листи: {list(sheets.keys())}")

    cf_gid = sheets.get(CF_SHEET)
    if not cf_gid:
        raise SystemExit(f"[ERROR] Лист '{CF_SHEET}' не знайдено")

    rows = fetch_csv(cf_gid, token)
    print(f"[CF] CF_2026: {len(rows)} рядків")

    months_row = rows[1] if len(rows)>1 else []
    n_months = sum(1 for v in months_row if str(v).strip() in MONTHS_UA)
    print(f"[CF] Місяців: {n_months}")

    months_data = parse_cf(rows, n_months)

    # Клієнти
    try:
        top2_rows = fetch_csv(sheets[TOP2_SHEET], token)
        months_data = parse_clients(top2_rows, months_data)
        print("[CF] Клієнти OK")
    except Exception as e:
        print(f"[WARN] Клієнти: {e}")

    # Визначаємо last_balance з останнього ПОВНОГО місяця
    complete = [m for m in months_data if m.get("complete")]
    last_complete = complete[-1] if complete else months_data[-1] if months_data else {}

    output = {
        "fetched_at":    datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
        "months":        months_data,
        "ytd":           calc_ytd(months_data),
        "last_balance":  last_complete.get("balance_end"),
        "last_month":    last_complete.get("month",""),
    }

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")
    sz = OUTPUT.stat().st_size
    print(f"[OK] {OUTPUT} — {sz:,} байт")
    complete_cnt = sum(1 for m in months_data if m.get("complete"))
    print(f"     Повних місяців: {complete_cnt}/{n_months}")


if __name__ == "__main__":
    main()
