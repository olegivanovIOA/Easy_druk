#!/usr/bin/env python3
"""
fetch_cashflow.py — Easy 3D Print Dashboard v4.4
SA авторизація через GOOGLE_SERVICE_ACCOUNT_JSON.
Читає через Sheets API v4 /values (не CSV export).
"""

import json, os, re, time, base64
from pathlib import Path
from datetime import datetime
import requests

SHEET_ID = os.environ.get("CF_SHEET_ID", "12BUNnDcDz2e_HG5WI8Oh2Ack_ZDOg1I9FwxP7H8MqV8")
SA_JSON  = os.environ.get("GOOGLE_SERVICE_ACCOUNT_JSON", "")
OUTPUT   = Path(__file__).parent / "data" / "cashflow.json"

MONTHS_UA = ["Січень","Лютий","Березень","Квітень","Травень","Червень",
             "Липень","Серпень","Вересень","Жовтень","Листопад","Грудень"]

# Рядки CF_2026 (0-based)
ROWS = {
    "balance_start": 3,  "balance_end": 4,
    "revenue": 19,       "opt_b2b": 20,    "retail_b2c": 21,
    "cogs": 44,          "salary": 53,      "production": 57,
    "electro": 61,       "communal": 65,    "rent": 77,
    "logistics": 85,     "taxes": 116,      "admin": 120,
    "marketing": 128,    "capex": 141,
    "op_cf": 134,        "inv_cf": 143,     "fin_cf": 154,
    "delta": 161,
}
SCALAR_ROWS = {"balance_start","balance_end","revenue","opt_b2b","retail_b2c",
               "op_cf","inv_cf","fin_cf","delta"}


# ── SA OAuth2 токен ────────────────────────────────────────────────────────
def get_token():
    if not SA_JSON:
        raise SystemExit("[ERROR] GOOGLE_SERVICE_ACCOUNT_JSON не встановлено")
    sa = json.loads(SA_JSON)

    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import padding

    now = int(time.time())
    hdr = base64.urlsafe_b64encode(
        json.dumps({"alg":"RS256","typ":"JWT"}).encode()).rstrip(b'=').decode()
    clm = base64.urlsafe_b64encode(json.dumps({
        "iss": sa["client_email"],
        "scope": "https://www.googleapis.com/auth/spreadsheets.readonly",
        "aud": "https://oauth2.googleapis.com/token",
        "exp": now+3600, "iat": now,
    }).encode()).rstrip(b'=').decode()
    key = serialization.load_pem_private_key(sa["private_key"].encode(), password=None)
    sig = base64.urlsafe_b64encode(
        key.sign(f"{hdr}.{clm}".encode(), padding.PKCS1v15(), hashes.SHA256())
    ).rstrip(b'=').decode()

    r = requests.post("https://oauth2.googleapis.com/token", timeout=15, data={
        "grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer",
        "assertion": f"{hdr}.{clm}.{sig}",
    })
    r.raise_for_status()
    return r.json()["access_token"]


# ── Sheets API: список листів {title → gid} ───────────────────────────────
def get_sheet_list(token):
    url = (f"https://sheets.googleapis.com/v4/spreadsheets/{SHEET_ID}"
           f"?fields=sheets.properties(sheetId,title)")
    r = requests.get(url, headers={"Authorization": f"Bearer {token}"}, timeout=15)
    r.raise_for_status()
    return {s["properties"]["title"]: str(s["properties"]["sheetId"])
            for s in r.json().get("sheets", [])}


# ── Читаємо лист за НАЗВОЮ (не за gid!) через /values ────────────────────
def fetch_by_title(title, token):
    import urllib.parse
    # Назва в одинарних лапках — обов'язково для листів з пробілами/спецсимволами
    safe = urllib.parse.quote(f"'{title}'", safe="")
    url = (f"https://sheets.googleapis.com/v4/spreadsheets/{SHEET_ID}"
           f"/values/{safe}?valueRenderOption=FORMATTED_VALUE")
    r = requests.get(url, headers={"Authorization": f"Bearer {token}"}, timeout=30)
    r.raise_for_status()
    rows = r.json().get("values", [])
    # Sheets API обрізає trailing порожні cells — вирівнюємо
    max_c = max((len(row) for row in rows), default=0)
    return [row + [""] * (max_c - len(row)) for row in rows]


# ── Хелпери ───────────────────────────────────────────────────────────────
def to_float(v):
    if v is None or v == "": return None
    s = str(v).replace(" ","").replace("\xa0","").replace(",",".").replace("%","")
    try:    return float(s)
    except: return None


def get_val(rows, row_key, mi):
    ri = ROWS.get(row_key)
    if ri is None or ri >= len(rows): return None
    row = rows[ri]
    ic = 2 + mi * 2
    ec = ic + 1
    if row_key in SCALAR_ROWS:
        v = to_float(row[ic]) if ic < len(row) else None
        if v is None: v = to_float(row[ec]) if ec < len(row) else None
        return v
    return to_float(row[ec]) if ec < len(row) else None


# ── Парсинг місяців ────────────────────────────────────────────────────────
def parse_cf(rows, n_months):
    today = datetime.utcnow()
    result = []
    for mi in range(n_months):
        ic = 2 + mi * 2
        month_name = rows[1][ic].strip() if len(rows) > 1 and ic < len(rows[1]) else f"М{mi+1}"

        g = lambda key: get_val(rows, key, mi)
        rev = g("revenue"); opt = g("opt_b2b"); retail = g("retail_b2c")
        cogs = g("cogs"); salary = g("salary"); elec = g("electro")
        rent = g("rent"); logi = g("logistics")
        adm = g("admin"); mkt = g("marketing"); capex = g("capex")
        op_cf = g("op_cf"); delta = g("delta")
        bal_s = g("balance_start"); bal_e = g("balance_end")

        opex = sum(x for x in [cogs,salary,elec,rent,logi,adm,mkt] if x)
        gp   = (rev - (cogs or 0) - (salary or 0) - (elec or 0)) if rev else None
        ebit = (rev - opex) if rev and opex else None

        def pct(a, b): return round(a/b*100, 1) if a and b else None

        # Місяць вважається повним якщо він < поточного місяця (вересень = 9)
        try:    mi_ua = MONTHS_UA.index(month_name)
        except: mi_ua = mi
        complete = (mi_ua + 1) < today.month if today.year == 2026 else True

        result.append({
            "month": month_name, "month_idx": mi+1, "complete": complete,
            "revenue": rev, "opt_b2b": opt, "retail_b2c": retail,
            "cogs": cogs, "salary": salary, "electro": elec, "rent": rent,
            "logistics": logi, "admin": adm, "marketing": mkt, "capex": capex,
            "op_cf": op_cf, "delta": delta,
            "balance_start": bal_s, "balance_end": bal_e,
            "total_opex":        round(opex) if opex else None,
            "gross_profit":      round(gp)   if gp   else None,
            "gross_margin_pct":  pct(gp, rev),
            "ebitda":            round(ebit) if ebit else None,
            "ebitda_pct":        pct(ebit, rev),
            "cogs_pct":          pct(cogs, rev),
            "salary_pct":        pct(salary, rev),
            "marketing_pct":     pct(mkt, rev),
            "capex_pct":         pct(capex, rev),
        })
    return result


def parse_clients(rows_top2, months):
    top2_map = {}; cli_map = {}
    for row in rows_top2[1:]:
        if not row or not row[0]: continue
        key = str(row[0]).strip()
        top2_map[key] = to_float(row[1]) if len(row) > 1 else None
        cli_map[key]  = int(float(row[2])) if len(row) > 2 and to_float(row[2]) else None
    for m in months:
        key = f"2026-{str(m['month_idx']).zfill(2)}"
        m["top2_sum"]      = top2_map.get(key)
        m["clients_count"] = cli_map.get(key)
        top2 = m["top2_sum"]; rev = m["revenue"]
        m["top2_concentration_pct"] = round(top2/rev*100, 1) if top2 and rev else None
    return months


def calc_ytd(months):
    done = [m for m in months if m.get("complete")]
    def s(k): return sum(m[k] for m in done if m.get(k)) or None
    rev = s("revenue"); opex = s("total_opex")
    ebit = (rev - opex) if rev and opex else None
    return {
        "revenue": rev, "opt_b2b": s("opt_b2b"), "retail_b2c": s("retail_b2c"),
        "ebitda": ebit, "ebitda_pct": round(ebit/rev*100,1) if ebit and rev else None,
        "cogs": s("cogs"), "salary": s("salary"), "marketing": s("marketing"),
        "capex": s("capex"), "net_delta": s("delta"), "taxes": s("taxes"),
        "months_count": len(done),
    }


def main():
    print(f"[CF] Sheet ID: {SHEET_ID}")
    token = get_token()
    print("[CF] Token OK")

    sheets = get_sheet_list(token)
    print(f"[CF] Листи ({len(sheets)}): {list(sheets.keys())}")

    if "CF_2026" not in sheets:
        raise SystemExit("[ERROR] Лист 'CF_2026' не знайдено")

    # Читаємо за НАЗВОЮ — не за gid
    rows = fetch_by_title("CF_2026", token)
    print(f"[CF] CF_2026: {len(rows)} рядків, {len(rows[0]) if rows else 0} колонок")

    # Кількість місяців з рядка заголовків
    months_row = rows[1] if len(rows) > 1 else []
    n_months = sum(1 for v in months_row if str(v).strip() in MONTHS_UA)
    print(f"[CF] Місяців: {n_months}")

    months = parse_cf(rows, n_months)

    # Клієнти
    if "_Клієнти_Топ2" in sheets:
        try:
            top2_rows = fetch_by_title("_Клієнти_Топ2", token)
            months = parse_clients(top2_rows, months)
            print("[CF] Клієнти OK")
        except Exception as e:
            print(f"[WARN] Клієнти: {e}")

    ytd = calc_ytd(months)
    complete = [m for m in months if m.get("complete")]
    last = complete[-1] if complete else {}

    out = {
        "fetched_at":  datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
        "months":      months,
        "ytd":         ytd,
        "last_balance": last.get("balance_end"),
        "last_month":   last.get("month", ""),
    }

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    sz = OUTPUT.stat().st_size
    print(f"[OK] {OUTPUT} — {sz:,} bytes | {len(complete)}/{n_months} повних місяців")
    print(f"     YTD виручка: {ytd.get('revenue',0)/1e6:.1f}M | EBITDA: {ytd.get('ebitda',0)/1e6:.1f}M ({ytd.get('ebitda_pct')}%)")


if __name__ == "__main__":
    main()
