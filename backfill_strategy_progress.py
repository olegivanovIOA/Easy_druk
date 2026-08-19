#!/usr/bin/env python3
"""
backfill_strategy_progress.py — Easy 3D Print Dashboard v1.0
Одноразовий (ручний) бекфіл data/strategy_progress_history.json — не по
календарних днях (так робить щогодинний fetch_strategy.py, і того дало лише
~7 точок з 13.08.2026, коли ми ввімкнули трекінг), а по КОЖНОМУ завершеному
СПРИНТУ, від Спринту 1 (квітень 2026 — перша реальна активність) до
поточного. Дає повноцінну картину "з початку року", а не останній тиждень.

Логіка: для кожного спринту N беремо кумулятивні дані спринтів 1..N (саме
так, як їх бачив би дашборд станом на кінець спринту N) і рахуємо
ceo_pct/goal_scoring_pct/raw_task_pct на ДАТУ ЗАВЕРШЕННЯ спринту N — не на
реальне сьогодні (інакше timescore-фолбек для проектів без задач вийде
завищеним для старих точок). Порожні/ще не почані спринти (немає жодної
задачі) пропускаються.

Запуск:
  - вручну через GitHub Actions → workflow "Backfill Strategy Progress History" (workflow_dispatch)
  - або локально: GOOGLE_API_KEY не потрібен — читає вже готовий data/strategy.json,
    в мережу не ходить: python backfill_strategy_progress.py
"""

import json
from datetime import date
from pathlib import Path

from fetch_strategy import (
    compute_progress_snapshot, upsert_progress_history, _parse_sprint_range,
    _current_sprint_num, HISTORY_OUTPUT,
)

STRATEGY_FILE = Path(__file__).parent / "data" / "strategy.json"


def main():
    if not STRATEGY_FILE.exists():
        raise SystemExit(f"[Backfill Strategy] {STRATEGY_FILE} не знайдено — спершу треба хоч раз "
                          f"запустити fetch_strategy.py (щогодинний job це вже робить)")

    raw = json.loads(STRATEGY_FILE.read_text(encoding="utf-8"))
    sprints = sorted(raw.get("sprints", []), key=lambda s: s["num"])
    print(f"[Backfill Strategy] Спринтів у strategy.json: {[s['num'] for s in sprints]}")

    today = date.today()
    written = 0
    for i, sp in enumerate(sprints):
        rng = _parse_sprint_range(sp.get("dates", ""))
        if not rng:
            print(f"[Backfill Strategy]   Спринт {sp['num']}: не вдалось розпарсити дати ({sp.get('dates')!r}) — пропуск")
            continue
        start, end = rng

        if end > today:
            # Спринт ще НЕ завершився (в т.ч. поточний, у якому ми зараз) —
            # для нього щогодинний fetch_strategy.py вже пише точну точку на
            # РЕАЛЬНЕ сьогодні; точка на дату кінця спринту тут була б
            # видумана (майбутня дата, дані яких ще фактично нема).
            print(f"[Backfill Strategy]   Спринт {sp['num']} ({sp.get('dates')}): ще не завершився — пропуск (це для щогодинного job'у)")
            continue

        has_any_task = any((p.get("total", 0) or 0) > 0 for p in (sp.get("projects") or {}).values())
        if not has_any_task:
            print(f"[Backfill Strategy]   Спринт {sp['num']} ({sp.get('dates')}): жодної задачі — ще не активний, пропуск")
            continue

        cumulative = sprints[: i + 1]
        snapshot = compute_progress_snapshot(cumulative, today=end)
        upsert_progress_history(snapshot, sp["num"], date_str=end.isoformat())
        written += 1

    print(f"[Backfill Strategy] ✓ Записано {written} точок (по одній на завершений спринт)")

    # ── Заразом виправляємо sprint_num у вже наявних записах (напр. 14-19.08,
    # які писав старий код з багом max()=завжди найбільший номер спринту в
    # таблиці, навіть якщо це порожня майбутня вкладка) — не займаючи самі
    # відсоткові значення, тільки цей один допоміжний ярлик. ──
    try:
        history = json.loads(HISTORY_OUTPUT.read_text(encoding="utf-8"))
    except Exception:
        history = None
    if history and history.get("days"):
        fixed = 0
        for d in history["days"]:
            try:
                ref = date.fromisoformat(d["date"])
            except Exception:
                continue
            correct = _current_sprint_num(sprints, ref)
            if correct is not None and d.get("sprint_num") != correct:
                d["sprint_num"] = correct
                fixed += 1
        if fixed:
            HISTORY_OUTPUT.write_text(json.dumps(history, ensure_ascii=False, indent=2), encoding="utf-8")
            print(f"[Backfill Strategy] ✓ Виправлено sprint_num у {fixed} існуючих записах")


if __name__ == "__main__":
    main()
