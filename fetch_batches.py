#!/usr/bin/env python3
"""
fetch_batches.py — Easy 3D Print Dashboard v1.0
Читає ЛОТи/партії за ВЧОРАШНЮ виробничу добу через
easy3dprint.pp.ua /api/batches/external/lots і зберігає в
data/batches_lots.json для розділу "Виробництво — Партії (Batch)".

Беремо саме вчора (не сьогодні): дані ОТК за поточну добу ще
"попередні" (партії, які ОТК не завершив сортувати) — див.
qcCompleted/qcDefectWeightPercent у полях API. Вчорашня доба на
момент запуску (раз/год) вже фіналізована.

Додатково накопичує щоденний rollup по локаціях у
data/batches_history.json — для трендів браку/продуктивності
по локаціях (аналогічно capacity_history.json).

Джерело: https://easy3dprint.pp.ua/api-docs → GET /api/batches/external/lots
Авторизація: заголовок X-API-Key — той самий ключ, що й для /api/capacity
(секрет CAPACITY_API_KEY в GitHub Actions, новий секрет не потрібен).
"""

import json, os
from datetime import datetime, timedelta
from pathlib import Path

try:
    from zoneinfo import ZoneInfo
    KYIV = ZoneInfo("Europe/Kyiv")
except Exception:
    KYIV = None  # фолбек нижче на UTC, якщо zoneinfo/tzdata недоступні на раннері

import requests

API_URL      = os.environ.get("BATCHES_API_URL", "https://easy3dprint.pp.ua/api/batches/external/lots")
API_KEY      = os.environ.get("CAPACITY_API_KEY", "")  # той самий ключ, що й /api/capacity
OUTPUT       = Path(__file__).parent / "data" / "batches_lots.json"
HISTORY_FILE = Path(__file__).parent / "data" / "batches_history.json"


def kyiv_yesterday():
    now = datetime.now(KYIV) if KYIV else datetime.utcnow()
    return (now - timedelta(days=1)).strftime("%Y-%m-%d")


def location_key(loc_field):
    """Поле location у відповіді — вже просто номер ('1','2','4'...), але про всяк
    випадок дістаємо цифри, як і в capacity_common.location_key."""
    s = str(loc_field or "")
    digits = "".join(ch for ch in s if ch.isdigit())
    return digits or s


def rollup_location(loc):
    """Денний підсумок по одній локації з відповіді /lots — для history-файлу.
    Зважено по acceptedQty (а не проста середня по ЛОТах), щоб великі ЛОТи не
    важили стільки ж, скільки маленькі."""
    lots = loc.get("lots", []) or []
    accepted = sum(l.get("acceptedQty") or 0 for l in lots)
    defect = sum(l.get("defectQty") or 0 for l in lots)
    print_minutes = sum(l.get("totalPrintTimeMinutes") or 0 for l in lots)
    defect_pct = round(defect / accepted * 100, 2) if accepted else None

    # qcDefectWeightPercent буває null (нема калібрування ваги/ОТК не завершено) —
    # рахуємо тільки по ЛОТах де воно є, і ЗВАЖЕНО по acceptedQty (а не проста
    # середня!) — інакше маленький ЛОТ з високим % браку перекошує показник так
    # само, як і великий (на реальних даних 12.08 проста середня давала 45% при
    # тому, що зважений і поштучний % браку узгоджено давали ~9%).
    weighted_lots = [l for l in lots if l.get("qcDefectWeightPercent") is not None and (l.get("acceptedQty") or 0) > 0]
    weight_qty_sum = sum(l.get("acceptedQty") or 0 for l in weighted_lots)
    defect_weight_pct = (
        round(sum((l.get("qcDefectWeightPercent") or 0) * (l.get("acceptedQty") or 0) for l in weighted_lots) / weight_qty_sum, 2)
        if weight_qty_sum else None
    )

    return {
        "batches":  loc.get("totals", {}).get("batches", 0),
        "lots":     loc.get("totals", {}).get("lots", 0),
        "acceptedQty": accepted,
        "defectQty":   defect,
        "defectPercent": defect_pct,
        "defectWeightPercent": defect_weight_pct,
        "totalPrintTimeMinutes": print_minutes,
    }


def upsert_day(history, date_str, locations_payload):
    day_locs = {}
    for loc in locations_payload or []:
        key = location_key(loc.get("location"))
        day_locs[key] = {"name": f"Локація {key}", **rollup_location(loc)}

    days = history.setdefault("days", [])
    for d in days:
        if d.get("date") == date_str:
            d["locations"] = day_locs
            return history
    days.append({"date": date_str, "locations": day_locs})
    return history


def main():
    print(f"[Batches] Старт {datetime.utcnow().isoformat()}")

    if not API_KEY:
        raise ValueError("CAPACITY_API_KEY не встановлено (той самий ключ, що й для /api/capacity)")

    target_date = kyiv_yesterday()
    print(f"[Batches] Тягну добу (Київ, вчора): {target_date}")

    r = requests.get(
        API_URL,
        headers={"X-API-Key": API_KEY},
        params={"from": target_date, "to": target_date},
        timeout=30,
    )
    r.raise_for_status()
    payload = r.json()

    locations = payload.get("locations", [])
    totals = payload.get("totals", {})
    print(f"[Batches] ✓ Отримано {len(locations)} локацій, "
          f"{totals.get('batches', '?')} партій / {totals.get('lots', '?')} ЛОТів за {target_date}")

    result = {
        "fetched_at": datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
        "date": target_date,
        "range": payload.get("range"),
        "totals": totals,
        "locations": locations,
    }

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[Batches] ✓ Записано {OUTPUT}")

    # ── Накопичення history для трендів по локаціях ──
    history = {"days": []}
    if HISTORY_FILE.exists():
        try:
            history = json.loads(HISTORY_FILE.read_text(encoding="utf-8"))
        except Exception:
            history = {"days": []}

    history = upsert_day(history, target_date, locations)
    history["days"].sort(key=lambda d: d["date"])
    history["updated_at"] = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")

    HISTORY_FILE.write_text(json.dumps(history, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[Batches] ✓ Записано {HISTORY_FILE} (днів у історії: {len(history['days'])})")


if __name__ == "__main__":
    main()
