#!/usr/bin/env python3
"""
backfill_crm_monthly.py — Easy 3D Print Dashboard v1.0
Одноразовий (ручний) бекфіл data/crm_monthly_history.json — та сама логіка,
що й fetch_crm_deals.py (process_month), але прогнана по кожному місяцю
2026 року, а не тільки по поточному.

Обсяг/швидкість: на місяць — 3 воронки × (WON-запит з пагінацією + запит
причин відмов з пагінацією + запит списку стадій) = довше, ніж
backfill_batches_monthly.py. Для великих воронок (24 — тисячі угод/міс)
це може зайняти кілька хвилин на місяць. Тому для WON-угод сумарно за
місяць вистачає, а от прохід по ВСІХ угодах (для причин відмов) —
найважча частина.

Запуск:
  - вручну через GitHub Actions → workflow "Backfill CRM Monthly History" (workflow_dispatch)
  - або локально: BITRIX_WEBHOOK_URL=https://... python backfill_crm_monthly.py
"""

import json
from datetime import date, datetime, timedelta
from calendar import monthrange
from pathlib import Path

from fetch_crm_deals import month_bounds, process_month, WEBHOOK_URL

OUTPUT = Path(__file__).parent / "data" / "crm_monthly_history.json"
YEAR_START = date(2026, 1, 1)


def main():
    if not WEBHOOK_URL or WEBHOOK_URL == "/":
        raise ValueError("BITRIX_WEBHOOK_URL не встановлено")

    yesterday = date.today() - timedelta(days=1)
    if yesterday < YEAR_START:
        print("[Backfill CRM] Нема що бекфілити ще (рік щойно почався)")
        return

    history = {"months": []}
    if OUTPUT.exists():
        try:
            history = json.loads(OUTPUT.read_text(encoding="utf-8"))
        except Exception:
            history = {"months": []}
    months_out = {m["month"]: m for m in history.get("months", [])}

    today = date.today()
    cur_year, cur_month = YEAR_START.year, YEAR_START.month
    while date(cur_year, cur_month, 1) <= today:
        month_start, month_end = month_bounds(cur_year, cur_month, cap_to=today)
        month_key = f"{cur_year:04d}-{cur_month:02d}"
        complete = month_end == date(cur_year, cur_month, monthrange(cur_year, cur_month)[1])
        print(f"[Backfill CRM] ══ Місяць {month_key}: {month_start} → {month_end} ══")
        try:
            result = process_month(month_start, month_end, month_key, complete)
            months_out[month_key] = result
            print(f"[Backfill CRM] ✓ {month_key}: ОПТ {result['wholesale']['deals']} угод, "
                  f"Роздріб {result['retail']['deals']} угод")
        except Exception as e:
            print(f"[Backfill CRM] ✗ Помилка за {month_key}: {e}")

        if cur_month == 12:
            cur_year, cur_month = cur_year + 1, 1
        else:
            cur_month += 1

    history["months"] = sorted(months_out.values(), key=lambda m: m["month"])
    history["updated_at"] = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(history, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[Backfill CRM] ✓ Записано {OUTPUT}, всього місяців: {len(history['months'])}")


if __name__ == "__main__":
    main()
