#!/usr/bin/env python3
"""
build_org_structure.py — Easy 3D Print Dashboard
Конвертує org_structure.xlsx (лист «Структура») → data/org_structure.json
для вкладки HR → блок «Оргструктура» (js/org_loader.js).

Запуск локально:
    pip install openpyxl
    python build_org_structure.py org_structure.xlsx
(за замовчуванням шукає org_structure.xlsx поруч зі скриптом)

Колонки листа: A ID | B Назва | C Батько ID | D Тип | E Кількість осіб | F Статус | G Коментар
Дані починаються з 5-го рядка (рядок 4 — заголовки).

ВАЖЛИВО: дашборд публічний — колонка «Коментар» у JSON НЕ потрапляє,
щоб туди випадково не потрапили імена/прізвища. Публікуються лише посади,
типи, кількість і статус.
"""
import json
import sys
from datetime import date
from pathlib import Path

import openpyxl

SRC = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).with_name("org_structure.xlsx")
OUT = Path(__file__).with_name("data") / "org_structure.json"
TYPES = {"executive", "department", "division", "role"}


def main():
    wb = openpyxl.load_workbook(SRC, data_only=True)
    ws = wb["Структура"]
    nodes, seen = [], set()
    for row in ws.iter_rows(min_row=5, values_only=True):
        nid, name, parent, typ, cnt, status, comment = (list(row) + [None] * 7)[:7]
        if not nid or not name:
            continue
        nid = str(nid).strip()
        if nid in seen:
            sys.exit(f"ПОМИЛКА: ID «{nid}» повторюється — кожен ID має бути унікальним")
        seen.add(nid)
        typ = (str(typ).strip() if typ else "role")
        if typ not in TYPES:
            sys.exit(f"ПОМИЛКА: невідомий тип «{typ}» у рядку {nid}")
        try:
            cnt = int(float(cnt)) if cnt not in (None, "") else None
        except ValueError:
            cnt = None
        nodes.append({
            "id": nid,
            "name": str(name).strip(),
            "parent": str(parent).strip() if parent else None,
            "type": typ,
            "count": cnt,
            "status": str(status).strip() if status else "Активний",
        })
    ids = {n["id"] for n in nodes}
    bad = [n["id"] for n in nodes if n["parent"] and n["parent"] not in ids]
    if bad:
        sys.exit(f"ПОМИЛКА: батьківський ID не знайдено для: {', '.join(bad)}")
    OUT.write_text(json.dumps({"updated": date.today().isoformat(), "nodes": nodes},
                              ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"OK: {len(nodes)} елементів → {OUT}")


if __name__ == "__main__":
    main()
