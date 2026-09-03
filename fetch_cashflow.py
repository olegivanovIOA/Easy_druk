#!/usr/bin/env python3
"""
fetch_cashflow.py — Easy 3D Print Dashboard v4.4.1
Пошук рядків за текстовою міткою (стійко до зсуву структури листа).
UNFORMATTED_VALUE — уникаємо проблем з парсингом чисел/локалі.
"""

import json, os, time, base64
from pathlib import Path
from datetime import datetime
import requests

SHEET_ID = os.environ.get("CF_SHEET_ID", "12BUNnDcDz2e_HG5WI8Oh2Ack_ZDOg1I9FwxP7H8MqV8")
SA_JSON  = os.environ.get("GOOGLE_SERVICE_ACCOUNT_JSON", "")
OUTPUT   = Path(__file__).parent / "data" / "cashflow.json"

MONTHS_UA = ["Січень","Лютий","Березень","Квітень","Травень","Червень",
             "Липень","Серпень","Вересень","Жовтень","Листопад","Грудень"]

# Ключові слова для пошуку рядків (унікальний фрагмент тексту мітки, без емодзі/стрілок)
LABEL_KEYWORDS = {
    "balance_start": "ЗАЛИШОК НА ПОЧАТОК МІСЯЦЯ",
    "balance_end":   "ЗАЛИШОК НА КІНЕЦЬ МІСЯЦЯ",
    "revenue":       "РАЗОМ ДОХІД",
    "opt_b2b":       "Опт (B2B",
    "retail_b2c":    "Роздріб (B2C",
    "cogs":          "РАЗОМ СИРОВИНА",
    "salary":        "РАЗОМ ЗАРОБІТНА ПЛАТА",
    "electro":       "РАЗОМ ЕЛЕКТРОЕНЕРГІЯ",
    "rent":          "РАЗОМ ОРЕНДА ПРИМІЩЕННЯ",
    "logistics":     "РАЗОМ ЛОГІСТИКА",
    "taxes":         "РАЗОМ ПОДАТКИ",
    "admin":         "РАЗОМ АДМІНІСТРАТИВНІ",
    "marketing":     "РАЗОМ РЕКЛАМА",
    "capex":         "РАЗОМ КАПІТАЛЬНІ ВИТРАТИ",
    "op_cf":         "ОПЕРАЦІЙНИЙ ГРОШОВИЙ ПОТІК",
    "delta":         "Дельта місяця",
}
SCALAR_KEYS = {"balance_start","balance_end","revenue","opt_b2b","retail_b2c","op_cf","delta"}


def get_token():
    if not SA_JSON:
        raise SystemExit("[ERROR] GOOGLE_SERVICE_ACCOUNT_JSON не встановлено")
    sa = json.loads(SA_JSON)
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import padding

    now = int(time.time())
    hdr = base64.urlsafe_b64encode(json.dumps({"alg":"RS256","typ":"JWT"}).encode()).rstrip(b'=').decode()
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


def get_sheet_list(token):
    url = f"https://sheets.googleapis.com/v4/spreadsheets/{SHEET_ID}?fields=sheets.properties(sheetId,title)"
    r = requests.get(url, headers={"Authorization": f"Bearer {token}"}, timeout=15)
    r.raise_for_status()
    return {s["properties"]["title"]: str(s["properties"]["sheetId"])
            for s in r.json().get("sheets", [])}


def fetch_by_title(title, token, unformatted=True):
    import urllib.parse
    safe = urllib.parse.quote(f"'{title}'", safe="")
    render = "UNFORMATTED_VALUE" if unformatted else "FORMATTED_VALUE"
    url = (f"https://sheets.googleapis.com/v4/spreadsheets/{SHEET_ID}"
           f"/values/{safe}?valueRenderOption={render}")
    r = requests.get(url, headers={"Authorization": f"Bearer {token}"}, timeout=30)
    r.raise_for_status()
    rows = r.json().get("values", [])
    max_c = max((len(row) for row in rows), default=0)
    return [row + [None] * (max_c - len(row)) for row in rows]


def to_float(v):
    if v is None or v == "": return None
    if isinstance(v, (int, float)): return float(v)
    s = str(v).replace(" ","").replace("\xa0","").replace(",",".").replace("%","")
    try:    return float(s)
    except: return None


def find_row_by_label(rows, keyword):
    """Шукає рядок де колонка B (index 1) містить keyword (без урахування регістру)."""
    kw = keyword.lower()
    for i, row in enumerate(rows):
        label = row[1] if len(row) > 1 else None
        if label and kw in str(label).lower():
            return i
    return None


def get_val(rows, row_idx, mi, key):
    if row_idx is None or row_idx >= len(rows): return None
    row = rows[row_idx]
    ic = 2 + mi * 2
    ec = ic + 1
    if key in SCALAR_KEYS:
        v = to_float(row[ic]) if ic < len(row) else None
        if v is None: v = to_float(row[ec]) if ec < len(row) else None
        return v
    return to_float(row[ec]) if ec < len(row) else None


def parse_cf(rows, n_months):
    # Знаходимо всі рядки за мітками ОДИН РАЗ
    row_idx = {key: find_row_by_label(rows, kw) for key, kw in LABEL_KEYWORDS.items()}
    print("[CF] Знайдені рядки:")
    for k, v in row_idx.items():
        print(f"     {k:15} → row {v}" + ("  ⚠ НЕ ЗНАЙДЕНО" if v is None else ""))

    today = datetime.utcnow()
    result = []
    for mi in range(n_months):
        ic = 2 + mi * 2
        month_name = str(rows[1][ic]).strip() if len(rows) > 1 and ic < len(rows[1]) and rows[1][ic] else f"М{mi+1}"

        vals = {key: get_val(rows, ri, mi, key) for key, ri in row_idx.items()}
        rev = vals["revenue"]; opt = vals["opt_b2b"]; retail = vals["retail_b2c"]
        cogs = vals["cogs"]; salary = vals["salary"]; elec = vals["electro"]
        rent = vals["rent"]; logi = vals["logistics"]; adm = vals["admin"]
        mkt = vals["marketing"]; capex = vals["capex"]; taxes = vals["taxes"]
        op_cf = vals["op_cf"]; delta = vals["delta"]
        bal_s = vals["balance_start"]; bal_e = vals["balance_end"]

        opex = sum(x for x in [cogs,salary,elec,rent,logi,adm,mkt] if x)
        gp   = (rev - (cogs or 0) - (salary or 0) - (elec or 0)) if rev else None
        ebit = (rev - opex) if rev and opex else None

        def pct(a, b): return round(a/b*100, 1) if a and b else None

        try:    mi_ua = MONTHS_UA.index(month_name)
        except: mi_ua = mi
        complete = (mi_ua + 1) < today.month if today.year == 2026 else True

        result.append({
            "month": month_name, "month_idx": mi+1, "complete": complete,
            "revenue": rev, "opt_b2b": opt, "retail_b2c": retail,
            "cogs": cogs, "salary": salary, "electro": elec, "rent": rent,
            "logistics": logi, "admin": adm, "marketing": mkt, "capex": capex,
            "taxes": taxes,
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
            "logistics_pct":     pct(logi, rev),
            "taxes_pct":         pct(taxes, rev),
            "cash_conversion_pct": pct(delta, rev),
        })
    return result


def parse_clients(rows_top2, months):
    top2_map = {}; cli_map = {}
    for row in rows_top2[1:]:
        if not row or not row[0]: continue
        key = str(row[0]).strip()
        top2_map[key] = to_float(row[1]) if len(row) > 1 else None
        c = to_float(row[2]) if len(row) > 2 else None
        cli_map[key] = int(c) if c else None
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
        "logistics": s("logistics"),
        "tax_effective_pct": round(s("taxes")/rev*100,1) if s("taxes") and rev else None,
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

    rows = fetch_by_title("CF_2026", token, unformatted=True)
    print(f"[CF] CF_2026: {len(rows)} рядків, {len(rows[0]) if rows else 0} колонок")

    months_row = rows[1] if len(rows) > 1 else []
    n_months = sum(1 for v in months_row if v and str(v).strip() in MONTHS_UA)
    print(f"[CF] Місяців: {n_months}")

    months = parse_cf(rows, n_months)

    if "_Клієнти_Топ2" in sheets:
        try:
            top2_rows = fetch_by_title("_Клієнти_Топ2", token, unformatted=True)
            months = parse_clients(top2_rows, months)
            print("[CF] Клієнти OK")
        except Exception as e:
            print(f"[WARN] Клієнти: {e}")

    ytd = calc_ytd(months)
    done = [m for m in months if m.get("complete")]
    last = done[-1] if done else {}

    out = {
        "fetched_at":   datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
        "months":       months,
        "ytd":          ytd,
        "last_balance": last.get("balance_end"),
        "last_month":   last.get("month", ""),
    }

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    sz = OUTPUT.stat().st_size
    rev_ytd = ytd.get("revenue") or 0
    ebit_ytd = ytd.get("ebitda") or 0
    print(f"[OK] {OUTPUT} — {sz:,} bytes | {len(done)}/{n_months} повних місяців")
    print(f"     YTD виручка: {rev_ytd/1e6:.1f}M | EBITDA: {ebit_ytd/1e6:.1f}M ({ytd.get('ebitda_pct') or '—'}%)")


if __name__ == "__main__":
    main()
