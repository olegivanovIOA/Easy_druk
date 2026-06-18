#!/usr/bin/env python3
"""
fetch_mql.py — Easy 3D Print Dashboard
Динамічно читає MQL→SQL аналітику з Google Sheets.
Файл містить лист "Analytics_GS" — при появі нових місяців (Квітень, Травень...)
очікується або новий лист з тим самим префіксом, або оновлення цього ж листа.
Скрипт читає ВСІ листи що матчаться під ANALYTICS_RE, тож масштабується автоматично.
"""

import csv, io, json, os, re
from pathlib import Path
from datetime import datetime
import requests

SHEET_ID = os.environ.get("MQL_SHEET_ID", "1qaM0Q0b6ZxopxIcs4PcLXnkS74UXz2NGWgB6XK8Ad_w")
API_KEY  = os.environ.get("GOOGLE_API_KEY", "")
OUTPUT   = Path(__file__).parent / "data" / "mql_sql.json"

ANALYTICS_RE = re.compile(r"^Analytics_GS", re.IGNORECASE)
LEADS_RE = re.compile(r"^NewLeads_(\w+)", re.IGNORECASE)

UA_MONTH_EN = {
    "january": "Січень", "february": "Лютий", "march": "Березень", "april": "Квітень",
    "may": "Травень", "june": "Червень", "july": "Липень", "august": "Серпень",
    "september": "Вересень", "october": "Жовтень", "november": "Листопад", "december": "Грудень",
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


def cell(row, idx, default=""):
    return row[idx].strip() if idx < len(row) else default


def to_num(s, default=0.0):
    if not s:
        return default
    s = str(s).replace("К грн", "000").replace("грн", "").replace("%", "").replace(",", ".").strip()
    s = re.sub(r"[^\d.\-]", "", s)
    try:
        return float(s) if s else default
    except ValueError:
        return default


def find_row(rows, *keywords, start=0):
    for i in range(start, len(rows)):
        c0 = cell(rows[i], 0).lower()
        if any(kw.lower() in c0 for kw in keywords):
            return i
    return -1


def parse_kpi(rows):
    idx = find_row(rows, "Всього лідів")
    if idx < 0 or idx + 1 >= len(rows):
        return {}
    values = rows[idx + 1]
    dup_raw = cell(values, 2)
    pct_m = re.search(r"\(([\d.,]+)%\)", dup_raw)
    rev_raw = cell(values, 5)
    check_raw = cell(values, 6)
    return {
        "total_leads":   int(to_num(cell(values, 0))),
        "clean_leads":   int(to_num(cell(values, 1))),
        "duplicates":    int(to_num(re.sub(r"\(.*\)", "", dup_raw))),
        "duplicates_pct": to_num(pct_m.group(1)) if pct_m else 0,
        "deals_closed":  int(to_num(cell(values, 3))),
        "conversion_pct": to_num(cell(values, 4)),
        "revenue_uah":   to_num(rev_raw) * (1000 if "К" in rev_raw else 1),
        "avg_check_uah": to_num(check_raw) * (1000 if "К" in check_raw else 1),
    }


def parse_mql_analysis(rows):
    idx = find_row(rows, "Всього MQL")
    if idx < 0 or idx + 1 >= len(rows):
        return {}
    values = rows[idx + 1]
    false_raw = cell(values, 1)
    pct_match = re.search(r"\(([\d.,]+)%\)", false_raw)
    nomql_raw = cell(values, 5)
    nomql_match = re.search(r"(\d+)", nomql_raw)
    nomql_pct_match = re.search(r"([\d.,]+)%", nomql_raw)
    return {
        "total_mql1":          int(to_num(cell(values, 0))),
        "false_mql1":          int(to_num(re.sub(r"\(.*\)", "", false_raw))),
        "false_mql1_pct":      to_num(pct_match.group(1)) if pct_match else 0,
        "real_mql1":           int(to_num(cell(values, 2))),
        "mql_to_sql_conv_pct": to_num(cell(values, 3)),
        "mql_half":            int(to_num(cell(values, 4))),
        "deals_without_mql":   int(nomql_match.group(1)) if nomql_match else 0,
        "deals_without_mql_pct": to_num(nomql_pct_match.group(1)) if nomql_pct_match else 0,
        "mql_coverage":        to_num(cell(values, 6)),
    }


def parse_funnel(rows):
    idx = find_row(rows, "Сегмент")
    if idx < 0:
        return []
    result = []
    for i in range(idx + 1, len(rows)):
        row = rows[i]
        seg = cell(row, 0)
        if not seg or seg.startswith(("📡", "🤝", "📢", "📥", "⚠")):
            break
        result.append({
            "segment": seg,
            "total": int(to_num(cell(row, 1))) if cell(row, 1) not in ("", "—") else None,
            "deals": int(to_num(cell(row, 2))) if cell(row, 2) not in ("", "—") else 0,
            "conv_pct": to_num(cell(row, 3)) if cell(row, 3) not in ("", "—%") else None,
            "revenue_uah": to_num(cell(row, 4)),
        })
    return result


def parse_channels(rows):
    idx = find_row(rows, "Канал (Source")
    if idx < 0:
        return []
    result = []
    for i in range(idx + 1, len(rows)):
        row = rows[i]
        ch = cell(row, 0)
        if not ch or ch.startswith(("🤝", "📢", "📥", "⚠")):
            break
        result.append({
            "channel": ch,
            "leads": int(to_num(cell(row, 1))),
            "deals": int(to_num(cell(row, 2))),
            "conv_pct": to_num(cell(row, 3)),
            "revenue_uah": to_num(cell(row, 4)),
            "mql1": int(to_num(cell(row, 5))),
            "noise_pct": to_num(cell(row, 6)),
            "label": cell(row, 7),
        })
    return result


def parse_campaigns(rows):
    idx = find_row(rows, "Ефективність кампаній")
    if idx < 0:
        return []
    header_idx = find_row(rows, "Кампанія", start=idx)
    if header_idx < 0:
        return []
    result = []
    for i in range(header_idx + 1, len(rows)):
        row = rows[i]
        camp = cell(row, 0)
        if not camp or camp.startswith(("📥", "👤", "⚠")):
            break
        result.append({
            "campaign": camp,
            "leads": int(to_num(cell(row, 1))),
            "deals": int(to_num(cell(row, 2))),
            "conv_pct": to_num(cell(row, 3)),
            "revenue_uah": to_num(cell(row, 4)),
            "avg_check": to_num(cell(row, 5)),
            "label": cell(row, 6),
        })
    return result


def parse_sources_and_managers(rows):
    idx = find_row(rows, "Ефективність джерел")
    if idx < 0:
        return [], []
    header_idx = find_row(rows, "Джерело", start=idx)
    if header_idx < 0:
        return [], []
    sources, managers = [], []
    for i in range(header_idx + 1, len(rows)):
        row = rows[i]
        src = cell(row, 0)
        if not src:
            break
        sources.append({
            "source": src,
            "leads": int(to_num(cell(row, 1))),
            "deals": int(to_num(cell(row, 2))),
            "conv_pct": to_num(cell(row, 3)) * (100 if to_num(cell(row, 3)) < 1 else 1),
            "revenue_uah": to_num(cell(row, 4)),
        })
        mgr = cell(row, 5)
        if mgr:
            managers.append({
                "manager": mgr,
                "leads": int(to_num(cell(row, 6))),
                "deals": int(to_num(cell(row, 7))),
                "conv_pct": to_num(cell(row, 8)),
                "revenue_uah": to_num(cell(row, 9)),
            })
    return sources, managers


def parse_critical_insight(rows):
    idx = find_row(rows, "КРИТИЧНО")
    if idx < 0:
        return ""
    text = cell(rows[idx], 0)
    return re.sub(r"^⚠\s*", "", text).strip()


def parse_month_sheet(gid, period_label):
    rows = fetch_csv(gid)
    return {
        "period": period_label,
        "kpi": parse_kpi(rows),
        "mql": parse_mql_analysis(rows),
        "funnel": parse_funnel(rows),
        "channels": parse_channels(rows),
        "campaigns": parse_campaigns(rows),
        "sources_managers": parse_sources_and_managers(rows),
        "critical_insight": parse_critical_insight(rows),
    }


def main():
    print(f"[MQL] Sheet ID: {SHEET_ID}")
    if not API_KEY:
        raise SystemExit("[ERROR] GOOGLE_API_KEY не встановлено")

    all_sheets = get_sheet_list()
    print(f"[MQL] Знайдено листів: {[s['title'] for s in all_sheets]}")

    analytics_sheets = [s for s in all_sheets if ANALYTICS_RE.match(s["title"])]
    leads_sheets = {LEADS_RE.match(s["title"]).group(1): s for s in all_sheets if LEADS_RE.match(s["title"])}

    print(f"[MQL] Листів аналітики: {len(analytics_sheets)}")
    print(f"[MQL] Листів лідів: {list(leads_sheets.keys())}")

    months_data = []
    for sheet in analytics_sheets:
        period_label = sheet["title"]
        if len(leads_sheets) == 1:
            raw = list(leads_sheets.keys())[0]
            m = re.match(r"([A-Za-z]+)(\d{4})", raw)
            if m:
                month_en, year = m.group(1).lower(), m.group(2)
                period_label = f"{UA_MONTH_EN.get(month_en, month_en)} {year}"

        print(f"[MQL] Обробка листа '{sheet['title']}' → період '{period_label}'")
        try:
            data = parse_month_sheet(sheet["gid"], period_label)
            months_data.append(data)
            print(f"       Лідів: {data['kpi'].get('total_leads')}, Угод: {data['kpi'].get('deals_closed')}")
        except Exception as e:
            print(f"[WARN] Лист '{sheet['title']}': {e}")

    if not months_data:
        raise SystemExit("[ERROR] Жодного листа аналітики не знайдено/розпарсено")

    latest = months_data[-1]

    output = {
        "fetched_at": datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
        "latest": latest,
        "months": months_data,
    }

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[OK] {OUTPUT} — {OUTPUT.stat().st_size} байт, {len(months_data)} місяців")


if __name__ == "__main__":
    main()
