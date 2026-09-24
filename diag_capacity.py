#!/usr/bin/env python3
"""
diag_capacity.py — одноразова діагностика (v4.5, 24.09.2026).
Питання: з 23.09 /api/capacity повертає 4 локації (4, 5, 6, 101) замість
5 (1, 2, 4, 5, 6). Дашборд нічого не фільтрує — показує рівно те, що віддає API.
Скрипт питає API з різними параметрами і друкує, які локації приходять,
щоб зрозуміти: це зміна на боці API/ERP (перейменування/архівація) чи
локації ховаються за параметрами (зміна, дата).
Нічого не записує в репозиторій.
"""
import os, json
from datetime import date, timedelta
import requests

KEY = os.environ.get("CAPACITY_API_KEY", "")
BASE = "https://easy3dprint.pp.ua"
H = {"X-API-Key": KEY}


def show(title, url, params):
    try:
        r = requests.get(url, headers=H, params=params, timeout=30)
        print(f"\n=== {title}  {url} {params} → HTTP {r.status_code}")
        if not r.ok:
            print(r.text[:500]); return
        j = r.json()
        locs = j.get("locations", [])
        print(f"date={j.get('date')} shift={j.get('shift')} range={j.get('range')} locations={len(locs)}")
        for l in locs:
            m = l.get("machines") or {}
            print(f"  - {l.get('location')!r:28} id={l.get('locationId', l.get('id'))} "
                  f"total={m.get('total')} util={m.get('utilizationPercent')} keys={sorted(l.keys())[:12]}")
        extra = {k: v for k, v in j.items() if k not in ("locations",)}
        print("  top-level:", json.dumps(extra, ensure_ascii=False)[:400])
    except Exception as e:
        print(f"\n=== {title}: помилка {e}")


if __name__ == "__main__":
    if not KEY:
        raise SystemExit("CAPACITY_API_KEY не задано")
    today = date.today()
    y = today - timedelta(days=1)
    cap = f"{BASE}/api/capacity"
    show("capacity DAY (як у дашборді)", cap, {"shift": "DAY"})
    show("capacity NIGHT", cap, {"shift": "NIGHT"})
    show("capacity без параметрів", cap, {})
    show("capacity DAY за 22.09 (коли ще були Лок.1/2)", cap, {"shift": "DAY", "date": "2026-09-22"})
    show("capacity includeInactive", cap, {"shift": "DAY", "includeInactive": "true"})
    show("lots вчора", f"{BASE}/api/batches/external/lots", {"from": y.isoformat(), "to": y.isoformat()})
    show("lots 20–22.09", f"{BASE}/api/batches/external/lots", {"from": "2026-09-20", "to": "2026-09-22"})
    for p in ("/api/locations", "/api/locations/external", "/api/capacity/locations"):
        show("список локацій?", BASE + p, {})
