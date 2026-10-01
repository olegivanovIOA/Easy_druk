#!/usr/bin/env python3
"""
fetch_pnl.py — Easy 3D Print Dashboard v4.10
P&L Easy (перше наближення) → data/pnl.json.

Джерело: Google Sheet "PnL_Easy", лист "P&L 2026" (будує Apps Script PnL_Easy.gs v1.1
з CashFlow Easy → CF_2026). Рядки шукаються за текстом мітки в колонці B, місяці —
за рядком 2 (як у fetch_cashflow.py), неповні місяці — за позначкою "⚠ неповні".

ПУБЛІЧНИЙ формат (як cashflow.json з v4.7): репозиторій відкритий, тому сюди НЕ пишемо
жодних сум у гривнях — лише статус P&L по місяцях і ВІДНОСНІ показники (% від доходу,
частки). Суми лишаються тільки в Google Sheets.
"""

import json, os, re, urllib.parse
from pathlib import Path
from datetime import datetime
import requests

from fetch_cashflow import get_token, month_of, is_incomplete_label, to_float, MONTHS_UA

PNL_SHEET_ID = os.environ.get("PNL_SHEET_ID", "1W4C-Ifqr41_QaLoBD_agLY3hazYbySP6Qjx_DXqxYfc")
PNL_TAB      = os.environ.get("PNL_TAB", "P&L 2026")
OUTPUT       = Path(__file__).parent / "data" / "pnl.json"

# key → унікальний фрагмент мітки в колонці B (без урахування регістру).
# "exact" — мітка має починатись саме з цього тексту (щоб "Доходи" не зловило "Інші доходи").
ROWS = {
    "revenue":       ("Доходи", "exact"),
    "rev_tov":       ("Дохід від продажу ТОВ", None),
    "rev_fop":       ("Дохід від продажу ФОП", None),
    "cogs":          ("Собівартість (матеріали", None),
    "cogs_drukar":   ("Філамент від ТОВ", None),
    "cogs_raw":      ("Сировина та матеріали інших", None),
    "cogs_outsrc":   ("Аутсорс-виробництво", "exact"),
    "gross":         ("Валовий прибуток", None),
    "opex":          ("ОПЕРАЦІЙНІ ВИТРАТИ", None),
    "personnel":     ("Персонал (ЗП", None),
    "production":    ("Виробничі витрати", "exact"),
    "electricity":   ("Електроенергія", "exact"),
    "utilities":     ("Комунальні", "exact"),
    "rent":          ("Оренда приміщення", "exact"),
    "amort":         ("Капітальні витрати (Амортизація)", None),
    "commadmin":     ("Комерційні та адміністративні", None),
    "logistics":     ("Логістика", "exact"),
    "marketing":     ("Маркетинг", "exact"),
    "admin":         ("Адміністративні витрати", "exact"),
    "unclassified":  ("потребує уточнення категорії", None),
    "ebit":          ("Операційний прибуток (EBIT)", None),
    "interest_in":   ("Інші доходи: відсотки", None),
    "fin_costs":     ("Фінансові витрати", None),
    "fop_single":    ("Податок_ФОП (5%)", None),
    "fop_mil":       ("Податок_ФОП ВЗ", None),
    "fop_esv":       ("ЄСВ ФОП", "exact"),
    "vat_paid":      ("ПДВ _ТОВ", None),
    "profit_tax":    ("Податок на прибуток (прогноз)", None),
    "net":           ("Чистий прибуток", "exact"),
    "net_after_vat": ("Чистий прибуток після сплаченого ПДВ", None),
    "dividends":     ("Дивіденди", "exact"),
    "ebitda":        ("EBITDA", None),
    "capex_cash":    ("Капітальні витрати (оплата", None),
    "recon_exp":     ("Різниця витрат", None),
    "recon_inc":     ("Різниця доходу", None),
}


def fetch_values(token):
    safe = urllib.parse.quote(f"'{PNL_TAB}'", safe="")
    url = (f"https://sheets.googleapis.com/v4/spreadsheets/{PNL_SHEET_ID}"
           f"/values/{safe}?valueRenderOption=UNFORMATTED_VALUE")
    r = requests.get(url, headers={"Authorization": f"Bearer {token}"}, timeout=30)
    r.raise_for_status()
    rows = r.json().get("values", [])
    w = max((len(x) for x in rows), default=0)
    return [x + [None] * (w - len(x)) for x in rows]


def find_rows(rows):
    """Перший рядок, мітка якого відповідає ключу (порядок рядків у P&L фіксований)."""
    found = {}
    for key, (kw, mode) in ROWS.items():
        k = kw.lower()
        for i, row in enumerate(rows[2:], start=2):
            lbl = str(row[1] or "").strip().lower()
            if (lbl.startswith(k) if mode == "exact" else k in lbl):
                found[key] = i
                break
    return found


def pct(a, b, nd=1):
    return round(a / b * 100, nd) if a is not None and b else None


def build(rows):
    hdr = rows[1]
    months = []
    for c, v in enumerate(hdr):
        mu = month_of(v)
        if mu:
            months.append({"month": mu, "col": c, "incomplete": is_incomplete_label(v)})
    idx = find_rows(rows)
    missing = [k for k in ROWS if k not in idx]
    print(f"[PNL] Місяців: {len(months)} · рядків знайдено {len(idx)}/{len(ROWS)}"
          + (f" · ⚠ не знайдено: {missing}" if missing else ""))

    def val(key, col):
        i = idx.get(key)
        return (to_float(rows[i][col]) or 0.0) if i is not None and col < len(rows[i]) else None

    today = datetime.utcnow()
    out_months, sums = [], {}
    for m in months:
        v = {k: val(k, m["col"]) for k in ROWS}
        mi = MONTHS_UA.index(m["month"]) + 1
        calendar_done = mi < today.month if today.year == 2026 else True
        complete = calendar_done and not m["incomplete"]
        rev = v["revenue"]
        cogs = v["cogs"] or 0
        taxes_after_ebit = sum(v[k] or 0 for k in ("fop_single", "fop_mil", "fop_esv", "profit_tax"))
        recon_ok = (v["recon_exp"] is not None and abs(v["recon_exp"]) < 1 and
                    v["recon_inc"] is not None and abs(v["recon_inc"]) < 1)
        out_months.append({
            "month": m["month"], "month_idx": mi, "complete": complete,
            "gross_margin_pct": pct(v["gross"], rev),
            "ebitda_pct":       pct(v["ebitda"], rev),
            "ebit_pct":         pct(v["ebit"], rev),
            "net_pct":          pct(v["net"], rev),
            "net_after_vat_pct": pct(v["net_after_vat"], rev),
            "cogs_pct":         pct(v["cogs"], rev),
            "opex_pct":         pct(v["opex"], rev),
            "personnel_pct":    pct(v["personnel"], rev),
            "production_pct":   pct(v["production"], rev),
            "commadmin_pct":    pct(v["commadmin"], rev),
            "marketing_pct":    pct(v["marketing"], rev),
            "electricity_pct":  pct(v["electricity"], rev),
            "rent_pct":         pct(v["rent"], rev),
            "amort_pct":        pct(v["amort"], rev),
            "tax_burden_pct":   pct(taxes_after_ebit, rev),
            "vat_paid_pct":     pct(v["vat_paid"], rev),
            "capex_cash_pct":   pct(v["capex_cash"], rev),
            "fop_rev_share_pct": pct(v["rev_fop"], rev),
            "drukar_share_of_cogs_pct": pct(v["cogs_drukar"], cogs),
            "unclassified_share_of_opex_pct": pct(v["unclassified"], v["opex"]),
            "recon_ok": recon_ok,
        })
        if not complete:
            # неповний місяць: відсотки від неповного доходу — шум (напр. −474%), не публікуємо
            for k in list(out_months[-1]):
                if k.endswith("_pct"):
                    out_months[-1][k] = None
        if complete:
            for k, x in v.items():
                sums[k] = sums.get(k, 0.0) + (x or 0.0)

    done = [m for m in out_months if m["complete"]]
    rev = sums.get("revenue")
    ytd = {}
    if done and rev:
        tx = sum(sums.get(k, 0) for k in ("fop_single", "fop_mil", "fop_esv", "profit_tax"))
        ytd = {
            "months_count": len(done),
            "period": f"{done[0]['month']}–{done[-1]['month']}",
            "gross_margin_pct":  pct(sums["gross"], rev),
            "ebitda_pct":        pct(sums["ebitda"], rev),
            "ebit_pct":          pct(sums["ebit"], rev),
            "net_pct":           pct(sums["net"], rev),
            "net_after_vat_pct": pct(sums["net_after_vat"], rev),
            "cogs_pct":          pct(sums["cogs"], rev),
            "opex_pct":          pct(sums["opex"], rev),
            "personnel_pct":     pct(sums["personnel"], rev),
            "production_pct":    pct(sums["production"], rev),
            "commadmin_pct":     pct(sums["commadmin"], rev),
            "marketing_pct":     pct(sums["marketing"], rev),
            "tax_burden_pct":    pct(tx, rev),
            "vat_paid_pct":      pct(sums["vat_paid"], rev),
            "capex_cash_pct":    pct(sums["capex_cash"], rev),
            "amort_pct":         pct(sums["amort"], rev),
            "fop_rev_share_pct": pct(sums["rev_fop"], rev),
            "drukar_share_of_cogs_pct": pct(sums["cogs_drukar"], sums["cogs"]),
            "unclassified_share_of_opex_pct": pct(sums["unclassified"], sums["opex"]),
            "dividend_payout_pct": pct(sums["dividends"], sums["net"]) if sums.get("net", 0) > 0 else None,
            "profitable_months": sum(1 for m in done if (m["net_pct"] or 0) > 0),
            "recon_ok_all": all(m["recon_ok"] for m in out_months),
        }
    return out_months, ytd, missing


def main():
    print(f"[PNL] Sheet: {PNL_SHEET_ID} · лист '{PNL_TAB}'")
    token = get_token()
    rows = fetch_values(token)
    if len(rows) < 3:
        raise SystemExit("[ERROR] Лист P&L порожній")
    months, ytd, missing = build(rows)
    stamp = next((str(r[1]) for r in rows if r[1] and str(r[1]).startswith("• Оновлено")), "")
    m = re.search(r"(\d{2}\.\d{2}\.\d{4}),?\s*(\d{2}:\d{2})", stamp)
    out = {
        "fetched_at": datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
        "pnl_built_at": f"{m.group(1)} {m.group(2)}" if m else None,
        "year": 2026,
        "public": True,
        "version": "P&L v1.1 — перше наближення (з CF, касовий метод для собівартості)",
        "method": {
            "vat": "ПДВ довідково, не віднімається (як у P&L Друкаря)",
            "profit_tax": "18% × частка ТОВ, наростаючим підсумком з початку року",
            "amortization": "капвитрати CF ÷ 36 міс. (вентиляція 60), з наступного місяця",
            "cogs": "оплати сировини/філаменту за місяць, не фактичне списання",
        },
        "report": {"title": "P&L", "source": "PnL_Easy → " + PNL_TAB,
                   "months": [{"month": mu, "status": next(
                       ("complete" if x["complete"] else "incomplete" for x in months if x["month"] == mu), "none")}
                       for mu in MONTHS_UA]},
        "missing_rows": missing,
        "months": months,
        "ytd": ytd,
    }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[OK] {OUTPUT} — {OUTPUT.stat().st_size:,} bytes · YTD {ytd.get('period')} · "
          f"EBITDA {ytd.get('ebitda_pct')}% · Чистий {ytd.get('net_pct')}% · звірка {ytd.get('recon_ok_all')}")


if __name__ == "__main__":
    main()
