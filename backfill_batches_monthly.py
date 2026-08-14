#!/usr/bin/env python3
"""
backfill_batches_monthly.py — Easy 3D Print Dashboard v1.0
Одноразовий (ручний) бекфіл data/batches_monthly_history.json —
помісячні агрегати з /api/batches/external/lots за весь 2026 рік.

Чому по місяцях, а не по днях: у API жорсткий ліміт "максимум 31 день" на
один запит from/to (див. api-docs), і він рахує АГРЕГАТ за весь діапазон
в одній відповіді — НЕМАЄ параметра groupBy=day, як у /api/capacity. Тобто
щоденний бекфіл за рік коштував би ~250+ окремих запитів; місячний — рівно
1 запит на місяць (календарний місяць завжди ≤31 дня, влазить у ліміт без
нарізки на шматки), і саме про це й просив користувач ("дивитись по місяцям").

Якщо згодом знадобиться щоденна деталізація за минулі місяці — це окремий,
значно важчий скрипт (день-в-день, з паузами під ліміт 60 запитів/хв).

Запуск:
  - вручну через GitHub Actions → workflow "Backfill Batches Monthly History" (workflow_dispatch)
  - або локально: CAPACITY_API_KEY=sk_... python backfill_batches_monthly.py

Після першого прогону поточний (незавершений) місяць можна перезапускати
повторно вручну, щоб освіжити — щогодинний fetch_batches.py його не чіпає
(той пише лише вчорашній ДЕНЬ у окремі файли).
"""

import json, os, time
from datetime import date, datetime
from pathlib import Path
from calendar import monthrange
import requests

from fetch_batches import (
    rollup_company, rollup_by_printer_model, rollup_by_product,
    rollup_defect_cost_ranking, rollup_by_shift,
)

API_URL    = os.environ.get("BATCHES_API_URL", "https://easy3dprint.pp.ua/api/batches/external/lots")
API_KEY    = os.environ.get("CAPACITY_API_KEY", "")  # той самий ключ, що й для /api/capacity
OUTPUT     = Path(__file__).parent / "data" / "batches_monthly_history.json"
YEAR_START = date(2026, 1, 1)


def month_bounds(year, month, cap_to=None):
    """Перший і останній день календарного місяця, обрізаний по cap_to
    (щоб не запитувати майбутнє чи ще не завершену вчора добу)."""
    last_day = monthrange(year, month)[1]
    start = date(year, month, 1)
    end = date(year, month, last_day)
    if cap_to and end > cap_to:
        end = cap_to
    return start, end


def month_key(d):
    return f"{d.year:04d}-{d.month:02d}"


def fetch_month(start, end):
    r = requests.get(
        API_URL,
        headers={"X-API-Key": API_KEY},
        params={"from": start.isoformat(), "to": end.isoformat()},
        timeout=60,
    )
    r.raise_for_status()
    return r.json()


def rollup_month(payload):
    locations = payload.get("locations", [])
    by_product = rollup_by_product(locations)
    return {
        "totals": payload.get("totals"),
        "company": rollup_company(locations),
        "byPrinterModel": rollup_by_printer_model(locations),
        "byProduct": by_product[:10],  # тільки топ-10 по обсягу — за рік деталей забагато, щоб тримати все
        "defectCostRanking": rollup_defect_cost_ranking(by_product)[:10],
        "byShift": rollup_by_shift(locations),
    }


def main():
    if not API_KEY:
        raise ValueError("CAPACITY_API_KEY не встановлено (той самий ключ, що й для /api/capacity)")

    # Учора вже покриває fetch_batches.py щогодини — бекфілимо по місяцях
    # включно з поточним (частковим) місяцем до вчора.
    from datetime import timedelta
    yesterday = date.today() - timedelta(days=1)

    if yesterday < YEAR_START:
        print("[Backfill] Нема що бекфілити ще (рік щойно почався)")
        return

    history = {"months": []}
    if OUTPUT.exists():
        try:
            history = json.loads(OUTPUT.read_text(encoding="utf-8"))
        except Exception:
            history = {"months": []}

    months_out = {m["month"]: m for m in history.get("months", [])}

    cur_year, cur_month = YEAR_START.year, YEAR_START.month
    while date(cur_year, cur_month, 1) <= yesterday:
        start, end = month_bounds(cur_year, cur_month, cap_to=yesterday)
        key = month_key(start)
        print(f"[Backfill] Місяць {key}: {start} → {end}")
        try:
            payload = fetch_month(start, end)
            rolled = rollup_month(payload)
            complete = (end == date(cur_year, cur_month, monthrange(cur_year, cur_month)[1]))
            months_out[key] = {
                "month": key, "from": start.isoformat(), "to": end.isoformat(),
                "complete": complete,  # False = поточний місяць, дані ще не за весь місяць
                **rolled,
            }
            c = rolled["company"]
            print(f"[Backfill]   ✓ {c.get('batches','?')} партій / {c.get('lots','?')} ЛОТів, "
                  f"брак {c.get('defectPercent','?')}%, повний місяць: {complete}")
        except Exception as e:
            print(f"[Backfill]   ✗ Помилка за {key}: {e}")

        time.sleep(1.5)  # ввічливість до ліміту 60 запитів/хв на IP

        if cur_month == 12:
            cur_year, cur_month = cur_year + 1, 1
        else:
            cur_month += 1

    history["months"] = sorted(months_out.values(), key=lambda m: m["month"])
    history["updated_at"] = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(history, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[Backfill] ✓ Записано {OUTPUT}, всього місяців: {len(history['months'])}")


if __name__ == "__main__":
    main()
