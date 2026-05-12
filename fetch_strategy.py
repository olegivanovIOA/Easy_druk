#!/usr/bin/env python3
"""
fetch_strategy.py
Читає всі листи-спринти з Google Sheets (публічний CSV),
парсить задачі по проектах, пише data/strategy.json.

Запускається GitHub Actions раз на годину.
Також можна запустити локально: python scripts/fetch_strategy.py
"""

import csv
import io
import json
import os
import re
import time
from pathlib import Path

import requests

# ─── Конфіг ──────────────────────────────────────────────────────────────────
# SHEET_ID береться з env-змінної (GitHub Secret: GOOGLE_SHEET_ID)
# Локальний запуск: export GOOGLE_SHEET_ID=1GD3tyFOC7-0tSjAIR1uaS9H2nbVUwrUFGAbfgBJMV2A
SHEET_ID = os.environ.get(
    "GOOGLE_SHEET_ID",
    "1GD3tyFOC7-0tSjAIR1uaS9H2nbVUwrUFGAbfgBJMV2A"  # fallback для тесту
)

OUTPUT_PATH = Path(__file__).parent / "data" / "strategy.json"

# Регулярка для назв листів: "Спринт 1 (20.04-11.05)"
SPRINT_RE = re.compile(r"^Спринт\s+(\d+)\s*\(([^)]+)\)", re.IGNORECASE)

# ─── Список листів таблиці (API без авторизації) ──────────────────────────────
def get_sheet_list(sheet_id: str) -> list[dict]:
    """
    Отримати список листів через публічний API sheets metadata.
    Повертає [{"gid": "...", "title": "..."}, ...]
    """
    url = f"https://docs.google.com/spreadsheets/d/{sheet_id}/edit"
    # Використовуємо публічний JSON feed
    feed_url = (
        f"https://spreadsheets.google.com/feeds/worksheets/"
        f"{sheet_id}/public/basic?alt=json"
    )
    try:
        r = requests.get(feed_url, timeout=15)
        r.raise_for_status()
        data = r.json()
        sheets = []
        for entry in data.get("feed", {}).get("entry", []):
            title = entry.get("title", {}).get("$t", "")
            # gid живе в id URL: .../worksheets/SHEET_ID/public/basic/od6  → треба числовий gid
            # Отримаємо через export URL probe нижче
            link = entry.get("id", {}).get("$t", "")
            sheet_id_part = link.split("/")[-1]  # "od6" або "gid_number"
            sheets.append({"title": title, "key": sheet_id_part})
        return sheets
    except Exception as e:
        print(f"[WARN] Feed API failed ({e}), trying HTML scrape for GIDs")
        return []


def get_gids_from_html(sheet_id: str) -> list[dict]:
    """
    Fallback: парсить HTML сторінки таблиці щоб знайти gid кожного листа.
    Повертає [{"gid": "123456", "title": "Спринт 1 (20.04-11.05)"}, ...]
    """
    url = f"https://docs.google.com/spreadsheets/d/{sheet_id}/edit"
    r = requests.get(url, timeout=20)
    # GID і назви листів є в JavaScript всередині HTML
    # Шукаємо патерн: ["SheetName",null,GID
    pattern = re.compile(r'\["([^"]+)",null,(\d+),')
    found = pattern.findall(r.text)
    seen = set()
    result = []
    for title, gid in found:
        if gid not in seen:
            seen.add(gid)
            result.append({"gid": gid, "title": title})
    return result


# ─── Завантаження CSV одного листа ───────────────────────────────────────────
def fetch_csv(sheet_id: str, gid: str) -> list[list[str]]:
    url = (
        f"https://docs.google.com/spreadsheets/d/{sheet_id}"
        f"/export?format=csv&gid={gid}"
    )
    r = requests.get(url, timeout=20)
    r.raise_for_status()
    reader = csv.reader(io.StringIO(r.text))
    return list(reader)


# ─── Парсинг одного листа спринту ────────────────────────────────────────────
def parse_sprint(rows: list[list[str]]) -> dict:
    """
    Повертає {proj_id: {name, done, total, tasks:[{task,owner,deadline,status,done}]}}
    Увага: у деяких спринтах рядок з proj_id (напр. "1.0") ТАКОЖ містить першу задачу
    в col_c — обидва випадки обробляємо коректно.
    """
    projects = {}
    current_proj = None

    for row in rows:
        row = row + [""] * max(0, 9 - len(row))
        col_a = row[0].strip()
        col_b = row[1].strip()
        col_c = row[2].strip()
        col_d = row[3].strip()
        col_f = row[5].strip()
        col_h = row[7].strip()

        # Пропустити заголовки таблиці
        if col_b in ("Проекти (назва)", "Задача") or col_a == "№":
            continue

        is_proj_id = bool(re.match(r"^\d+\.\d+$", col_a))

        if is_proj_id:
            # Реєструємо проект
            pid = col_a
            if pid not in projects:
                projects[pid] = {"name": col_b or pid, "done": 0, "total": 0, "tasks": []}
            current_proj = pid
            # Якщо col_c НЕ пустий — це одночасно і заголовок і перша задача (Спринт 1)
            if col_c and len(col_c) > 2:
                is_done = col_h == "Виконано"
                projects[pid]["tasks"].append({
                    "task":     col_c[:200],
                    "owner":    col_d.split(",")[0].strip(),
                    "deadline": col_f[:20],
                    "status":   col_h,
                    "done":     is_done,
                })
                projects[pid]["total"] += 1
                if is_done:
                    projects[pid]["done"] += 1
        elif current_proj and col_c and len(col_c) > 2:
            is_done = col_h == "Виконано"
            projects[current_proj]["tasks"].append({
                "task":     col_c[:200],
                "owner":    col_d.split(",")[0].strip(),
                "deadline": col_f[:20],
                "status":   col_h,
                "done":     is_done,
            })
            projects[current_proj]["total"] += 1
            if is_done:
                projects[current_proj]["done"] += 1

    return projects


# ─── Головна функція ─────────────────────────────────────────────────────────
def main():
    print(f"[INFO] Sheet ID: {SHEET_ID}")

    # Отримати список листів
    sheets = get_gids_from_html(SHEET_ID)
    print(f"[INFO] Знайдено листів: {len(sheets)}")

    # Відфільтрувати тільки спринти
    sprint_sheets = []
    for s in sheets:
        m = SPRINT_RE.match(s["title"])
        if m:
            sprint_num = int(m.group(1))
            dates = m.group(2).replace("-", "–")
            sprint_sheets.append({
                "num":   sprint_num,
                "name":  s["title"],
                "dates": dates,
                "gid":   s["gid"],
            })

    sprint_sheets.sort(key=lambda x: x["num"])
    print(f"[INFO] Спринтів знайдено: {len(sprint_sheets)}: "
          f"{[s['num'] for s in sprint_sheets]}")

    if not sprint_sheets:
        print("[ERROR] Жодного листа-спринту не знайдено. Перевір доступ до таблиці.")
        raise SystemExit(1)

    # Завантажити і розпарсити кожен спринт
    result_sprints = []
    all_project_ids = set()

    for sp in sprint_sheets:
        print(f"[INFO] Завантажую Спринт {sp['num']}: {sp['name']} (gid={sp['gid']})")
        try:
            rows = fetch_csv(SHEET_ID, sp["gid"])
            projects = parse_sprint(rows)
            all_project_ids.update(projects.keys())

            # Лог по проектах
            for pid, p in projects.items():
                print(f"       Проект {pid}: {p['done']}/{p['total']} задач виконано")

            result_sprints.append({
                "num":      sp["num"],
                "name":     sp["name"],
                "dates":    sp["dates"],
                "projects": projects,
            })
        except Exception as e:
            print(f"[WARN] Спринт {sp['num']} — помилка: {e}")

    # Мета по проектах (зведена)
    projects_meta = {}
    for sp in result_sprints:
        for pid, p in sp["projects"].items():
            if pid not in projects_meta:
                projects_meta[pid] = {"name": p["name"], "sprintNums": []}
            if sp["num"] not in projects_meta[pid]["sprintNums"]:
                projects_meta[pid]["sprintNums"].append(sp["num"])

    output = {
        "ts":       int(time.time() * 1000),
        "sprints":  result_sprints,
        "projects": projects_meta,
    }

    # Записати JSON
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(
        json.dumps(output, ensure_ascii=False, indent=2),
        encoding="utf-8"
    )
    print(f"[OK] Записано: {OUTPUT_PATH}")
    print(f"     Спринтів: {len(result_sprints)}, Проектів: {len(projects_meta)}")
    size = OUTPUT_PATH.stat().st_size
    print(f"     Розмір: {size} байт ({size//1024} KB)")


if __name__ == "__main__":
    main()
