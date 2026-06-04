#!/usr/bin/env python3
"""
fetch_ads.py — Easy 3D Print Dashboard
Читає Google Sheets «Ads Data Marketing Info» (заповнюється Ads Script Вадима),
пише data/ads.json для дашборду.

Sheets ID: 1kut60dEk3RdxTVbX1y7QLOjbzIMk-HavVyhVLERn1wo
Листи: funnel, analytics, geo, campaigns
"""

import csv, io, json, os, requests
from datetime import datetime, timedelta
from pathlib import Path

ADS_SHEET_ID = os.environ.get("ADS_SHEET_ID", "1kut60dEk3RdxTVbX1y7QLOjbzIMk-HavVyhVLERn1wo")
API_KEY      = os.environ.get("GOOGLE_API_KEY", "")
OUTPUT       = Path(__file__).parent / "data" / "ads.json"

EXCEL_EPOCH = datetime(1899, 12, 30)

def excel_date(serial):
    """Конвертує Excel serial date у рядок YYYY-MM-DD."""
    try:
        return (EXCEL_EPOCH + timedelta(days=float(serial))).strftime("%Y-%m-%d")
    except Exception:
        return str(serial)

def get_sheet_list():
    url = (f"https://sheets.googleapis.com/v4/spreadsheets/{ADS_SHEET_ID}"
           f"?fields=sheets.properties(sheetId,title)&key={API_KEY}")
    r = requests.get(url, timeout=15)
    r.raise_for_status()
    return {s["properties"]["title"]: str(s["properties"]["sheetId"])
            for s in r.json().get("sheets", [])}

def fetch_csv(gid):
    url = (f"https://docs.google.com/spreadsheets/d/{ADS_SHEET_ID}"
           f"/export?format=csv&gid={gid}")
    r = requests.get(url, timeout=20)
    r.raise_for_status()
    return list(csv.reader(io.StringIO(r.content.decode("utf-8-sig"))))

def cell(row, idx, default=""):
    v = row[idx].strip() if idx < len(row) else default
    return v

def to_float(v, default=0.0):
    try:
        return float(v) if v not in ("", "N/A", "—") else default
    except Exception:
        return default

def parse_funnel(rows):
    """date, impressions, clicks, leads, ctr_pct, cvr_pct"""
    result = []
    for row in rows[1:]:
        if not any(cell(row, i) for i in range(6)):
            continue
        date_raw = cell(row, 0)
        # Excel serial → дата
        date_str = excel_date(date_raw) if date_raw.replace(".", "").isdigit() else date_raw
        result.append({
            "date":        date_str,
            "impressions": int(to_float(cell(row, 1))),
            "clicks":      int(to_float(cell(row, 2))),
            "leads":       round(to_float(cell(row, 3)), 1),
            "ctr_pct":     round(to_float(cell(row, 4)), 2),
            "cvr_pct":     round(to_float(cell(row, 5)), 2),
        })
    return sorted(result, key=lambda x: x["date"])

def parse_analytics(rows):
    """Повертає список активних кампаній та зведення."""
    campaigns = []
    for row in rows[1:]:
        if not cell(row, 0):
            continue
        name   = cell(row, 0)
        status = cell(row, 1)
        cost   = to_float(cell(row, 2))
        conv   = to_float(cell(row, 3))
        cpl    = cell(row, 4)   # може бути "N/A"
        cval   = to_float(cell(row, 5))
        roas   = cell(row, 6)   # може бути "N/A"
        clicks = int(to_float(cell(row, 7)))
        imp    = int(to_float(cell(row, 8)))
        ctr    = round(to_float(cell(row, 9)), 2)
        light  = cell(row, 10) if len(row) > 10 else "YELLOW"

        campaigns.append({
            "campaign":    name,
            "status":      status,
            "cost_uah":    round(cost, 2),
            "conversions": round(conv, 2),
            "cpl":         cpl,
            "conv_value":  round(cval, 2),
            "roas":        roas,
            "clicks":      clicks,
            "impressions": imp,
            "ctr_pct":     ctr,
            "traffic_light": light,
        })

    # Зведення: тільки активні (enabled) з витратами
    active = [c for c in campaigns if c["status"] == "enabled" and c["cost_uah"] > 0]
    green  = [c for c in active if c["traffic_light"] == "GREEN"]
    red    = [c for c in active if c["traffic_light"] == "RED"]

    total_cost  = sum(c["cost_uah"] for c in active)
    total_conv  = sum(c["conversions"] for c in active)
    total_clicks= sum(c["clicks"] for c in active)
    total_imp   = sum(c["impressions"] for c in active)
    avg_roas    = round(sum(c["conv_value"] for c in active) / total_cost, 2) if total_cost > 0 else 0

    return {
        "all": campaigns,
        "active": active,
        "summary": {
            "total_cost_uah":   round(total_cost, 2),
            "total_conversions": round(total_conv, 1),
            "total_clicks":     total_clicks,
            "total_impressions":total_imp,
            "avg_roas":         avg_roas,
            "active_count":     len(active),
            "green_count":      len(green),
            "red_count":        len(red),
        },
        "green": green,
        "red":   red,
    }

def parse_campaigns(rows):
    """Щоденні метрики по кампаніях (накопичувальний лист)."""
    result = []
    for row in rows[1:]:
        if not cell(row, 0):
            continue
        date_raw = cell(row, 0)
        date_str = excel_date(date_raw) if date_raw.replace("-","").replace(".","").isdigit() and "." in date_raw == False else date_raw
        result.append({
            "date":        date_str,
            "campaign":    cell(row, 1),
            "status":      cell(row, 2),
            "impressions": int(to_float(cell(row, 3))),
            "clicks":      int(to_float(cell(row, 4))),
            "cost_uah":    round(to_float(cell(row, 5)), 2),
            "conversions": round(to_float(cell(row, 6)), 1),
            "conv_value":  round(to_float(cell(row, 7)), 2),
            "cpc":         round(to_float(cell(row, 8)), 2),
            "ctr_pct":     round(to_float(cell(row, 9)), 2),
        })
    return result

def parse_geo(rows):
    """Клики та конверсії по регіонах."""
    result = []
    for row in rows[1:]:
        region = cell(row, 0)
        if not region:
            continue
        result.append({
            "region":      region,
            "clicks":      int(to_float(cell(row, 1))),
            "cost_uah":    round(to_float(cell(row, 2)), 2),
            "conversions": round(to_float(cell(row, 3)), 1),
            "cpl":         cell(row, 4),
        })
    return sorted(result, key=lambda x: x["clicks"], reverse=True)

def main():
    print(f"[ADS] Старт {datetime.utcnow().isoformat()}")

    sheets = get_sheet_list()
    print(f"[ADS] Листів: {list(sheets.keys())}")

    result = {
        "fetched_at": datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
        "funnel":     [],
        "analytics":  {},
        "campaigns":  [],
        "geo":        [],
    }

    if "funnel" in sheets:
        rows = fetch_csv(sheets["funnel"])
        result["funnel"] = parse_funnel(rows)
        print(f"[ADS] Воронка: {len(result['funnel'])} днів")

    if "analytics" in sheets:
        rows = fetch_csv(sheets["analytics"])
        result["analytics"] = parse_analytics(rows)
        s = result["analytics"]["summary"]
        print(f"[ADS] Аналітика: {s['active_count']} активних, {s['green_count']} GREEN, {s['red_count']} RED")

    if "campaigns" in sheets:
        rows = fetch_csv(sheets["campaigns"])
        result["campaigns"] = parse_campaigns(rows)
        print(f"[ADS] Кампанії (щоденні): {len(result['campaigns'])} рядків")

    if "geo" in sheets:
        rows = fetch_csv(sheets["geo"])
        result["geo"] = parse_geo(rows)
        print(f"[ADS] Гео: {len(result['geo'])} регіонів")

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[ADS] ✓ Записано {OUTPUT}")

if __name__ == "__main__":
    main()
