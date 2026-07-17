#!/usr/bin/env python3
"""
fetch_capacity.py — Easy 3D Print Dashboard v1.1
Читає зріз потужностей локацій через easy3dprint.pp.ua /api/capacity
і зберігає в data/capacity.json для табу "Локації".

Додатково (v1.1): дописує сьогоднішній день у data/capacity_history.json
(util% і defect% по кожній локації) — накопичувальна серія для графіків
"Динаміка по локаціях — 2026". Історія за минулі дні наповнюється окремим
одноразовим скриптом backfill_capacity_history.py.

Джерело: https://easy3dprint.pp.ua/api-docs → GET /api/capacity
Авторизація: заголовок X-API-Key (секрет CAPACITY_API_KEY в GitHub Actions).
"""

import json, os
from datetime import datetime
from pathlib import Path
import requests

from capacity_common import upsert_day

API_URL      = os.environ.get("CAPACITY_API_URL", "https://easy3dprint.pp.ua/api/capacity")
API_KEY      = os.environ.get("CAPACITY_API_KEY", "")
OUTPUT       = Path(__file__).parent / "data" / "capacity.json"
HISTORY_FILE = Path(__file__).parent / "data" / "capacity_history.json"

# Зріз за поточну добу (обидві зміни), по всіх локаціях, накопичено (groupBy=total, деф.)
PARAMS = {"shift": "DAY"}


def main():
    print(f"[Capacity] Старт {datetime.utcnow().isoformat()}")

    if not API_KEY:
        raise ValueError("CAPACITY_API_KEY не встановлено")

    r = requests.get(
        API_URL,
        headers={"X-API-Key": API_KEY},
        params=PARAMS,
        timeout=20,
    )
    r.raise_for_status()
    payload = r.json()

    locations = payload.get("locations", [])
    print(f"[Capacity] ✓ Отримано {len(locations)} локацій, date={payload.get('date')}")

    result = {
        "fetched_at": datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
        "date": payload.get("date"),
        "shift": payload.get("shift"),
        "locations": locations,
        "totals": payload.get("totals", {}),
    }

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[Capacity] ✓ Записано {OUTPUT}")

    # ── Накопичення історії дня для графіків ──
    history = {"days": []}
    if HISTORY_FILE.exists():
        try:
            history = json.loads(HISTORY_FILE.read_text(encoding="utf-8"))
        except Exception:
            history = {"days": []}

    history = upsert_day(history, payload.get("date"), locations)
    history["days"].sort(key=lambda d: d["date"])
    history["updated_at"] = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")

    HISTORY_FILE.write_text(json.dumps(history, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[Capacity] ✓ Записано {HISTORY_FILE} (днів у історії: {len(history['days'])})")


if __name__ == "__main__":
    main()
