#!/usr/bin/env python3
"""
backfill_capacity_history.py — Easy 3D Print Dashboard v1.0
Одноразовий (ручний) бекфіл data/capacity_history.json.

Тягне /api/capacity?from=...&to=...&shift=DAY&groupBy=day по всьому 2026
року шматками по 90 днів (ліміт API — 92 дні на діапазонний запит) і
записує util%/defect% по кожній локації за кожен день.

Запуск:
  - вручну через GitHub Actions → workflow "Backfill Capacity History" (workflow_dispatch)
  - або локально: CAPACITY_API_KEY=sk_... python backfill_capacity_history.py

Після першого прогону нові дні самі дописуються щогодини через fetch_capacity.py.
"""

import json, os, time
from datetime import date, datetime, timedelta
from pathlib import Path
import requests

from capacity_common import upsert_day

API_URL    = os.environ.get("CAPACITY_API_URL", "https://easy3dprint.pp.ua/api/capacity")
API_KEY    = os.environ.get("CAPACITY_API_KEY", "")
OUTPUT     = Path(__file__).parent / "data" / "capacity_history.json"
YEAR_START = date(2026, 1, 1)
CHUNK_DAYS = 90  # < 92-денний ліміт API на діапазонний запит


def daterange_chunks(start, end, chunk_days):
    cur = start
    while cur <= end:
        chunk_end = min(cur + timedelta(days=chunk_days - 1), end)
        yield cur, chunk_end
        cur = chunk_end + timedelta(days=1)


def main():
    if not API_KEY:
        raise ValueError("CAPACITY_API_KEY не встановлено")

    # Сьогодні оновлює fetch_capacity.py — бекфілимо лише минулі дні
    end = date.today() - timedelta(days=1)
    if end < YEAR_START:
        print("[Backfill] Нема що бекфілити ще (рік щойно почався)")
        return

    history = {"days": []}
    if OUTPUT.exists():
        try:
            history = json.loads(OUTPUT.read_text(encoding="utf-8"))
        except Exception:
            history = {"days": []}

    for chunk_start, chunk_end in daterange_chunks(YEAR_START, end, CHUNK_DAYS):
        print(f"[Backfill] Запит {chunk_start} → {chunk_end}")
        r = requests.get(
            API_URL,
            headers={"X-API-Key": API_KEY},
            params={
                "from": chunk_start.isoformat(),
                "to": chunk_end.isoformat(),
                "shift": "DAY",
                "groupBy": "day",
            },
            timeout=30,
        )
        r.raise_for_status()
        payload = r.json()

        per_day = payload.get("perDay", [])
        print(f"[Backfill]   ✓ отримано {len(per_day)} днів")
        for day in per_day:
            history = upsert_day(history, day.get("date"), day.get("locations", []))

        time.sleep(1)  # ввічливість до окремого ліміту 10/хв на діапазонні запити

    history["days"].sort(key=lambda d: d["date"])
    history["updated_at"] = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(history, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[Backfill] ✓ Записано {OUTPUT}, всього днів: {len(history['days'])}")


if __name__ == "__main__":
    main()
