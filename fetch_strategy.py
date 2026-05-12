#!/usr/bin/env python3
"""
fetch_strategy.py — Easy 3D Print Dashboard
Читає всі листи-спринти з Google Sheets через Sheets API v4 (API key),
парсить задачі по проектах, пише data/strategy.json.
Запускається GitHub Actions раз на годину.
"""

import csv, io, json, os, re, time
from pathlib import Path
import requests

# ── Конфіг ───────────────────────────────────────────────────────────────────
SHEET_ID  = os.environ.get("GOOGLE_SHEET_ID", "1GD3tyFOC7-0tSjAIR1uaS9H2nbVUwrUFGAbfgBJMV2A")
API_KEY   = os.environ.get("GOOGLE_API_KEY", "")
OUTPUT    = Path(__file__).parent / "data" / "strategy.json"
SPRINT_RE = re.compile(r"^Спринт\s+(\d+)\s*\(([^)]+)\)", re.IGNORECASE)

# ── Отримати список всіх листів через Sheets API ──────────────────────────────
def get_sheet_list():
    url = (
        f"https://sheets.googleapis.com/v4/spreadsheets/{SHEET_ID}"
        f"?fields=sheets.properties(sheetId,title)&key={API_KEY}"
    )
    r = requests.get(url, timeout=15)
    r.raise_for_status()
    data = r.json()
    return [
        {"gid": str(s["properties"]["sheetId"]), "title": s["properties"]["title"]}
        for s in data.get("sheets", [])
    ]

# ── Завантажити CSV одного листа ──────────────────────────────────────────────
def fetch_csv(gid):
    url = (
        f"https://docs.google.com/spreadsheets/d/{SHEET_ID}"
        f"/export?format=csv&gid={gid}"
    )
    r = requests.get(url, timeout=20)
    r.raise_for_status()
    return list(csv.reader(io.StringIO(r.text)))

# ── Парсинг одного листа спринту ──────────────────────────────────────────────
def parse_sprint(rows):
    projects, current = {}, None
    for row in rows:
        row += [""] * max(0, 9 - len(row))
        a, b, c = row[0].strip(), row[1].strip(), row[2].strip()
        d, f, h = row[3].strip(), row[5].strip(), row[7].strip()

        if b in ("Проекти (назва)", "Задача") or a == "№":
            continue

        if re.match(r"^\d+\.\d+$", a):
            current = a
            if current not in projects:
                projects[current] = {"name": b or a, "done": 0, "total": 0, "tasks": []}
            if c and len(c) > 2:   # рядок є і заголовком і першою задачею
                _add_task(projects[current], c, d, f, h)
        elif current and c and len(c) > 2:
            _add_task(projects[current], c, d, f, h)
    return projects

def _add_task(proj, c, d, f, h):
    done = h == "Виконано"
    proj["tasks"].append({
        "task": c[:200], "owner": d.split(",")[0].strip(),
        "deadline": f[:20], "status": h, "done": done,
    })
    proj["total"] += 1
    if done:
        proj["done"] += 1

# ── Головна функція ───────────────────────────────────────────────────────────
def main():
    print(f"[INFO] Sheet ID: {SHEET_ID}")

    if not API_KEY:
        raise SystemExit("[ERROR] GOOGLE_API_KEY не встановлено")

    # Отримати список листів через API
    all_sheets = get_sheet_list()
    print(f"[INFO] Знайдено листів: {len(all_sheets)}")

    # Відфільтрувати спринти
    sprint_sheets = []
    for s in all_sheets:
        m = SPRINT_RE.match(s["title"])
        if m:
            sprint_sheets.append({
                "num": int(m.group(1)),
                "name": s["title"],
                "dates": m.group(2).replace("-", "–"),
                "gid": s["gid"],
            })
    sprint_sheets.sort(key=lambda x: x["num"])
    print(f"[INFO] Спринтів знайдено: {len(sprint_sheets)}: {[s['num'] for s in sprint_sheets]}")

    if not sprint_sheets:
        raise SystemExit("[ERROR] Жодного листа-спринту не знайдено")

    # Парсити кожен спринт
    result_sprints, projects_meta = [], {}
    for sp in sprint_sheets:
        print(f"[INFO] Спринт {sp['num']}: {sp['name']} (gid={sp['gid']})")
        try:
            rows     = fetch_csv(sp["gid"])
            projects = parse_sprint(rows)
            for pid, p in projects.items():
                print(f"       {pid}: {p['done']}/{p['total']}")
                if pid not in projects_meta:
                    projects_meta[pid] = {"name": p["name"], "sprintNums": []}
                projects_meta[pid]["sprintNums"].append(sp["num"])
            result_sprints.append({
                "num": sp["num"], "name": sp["name"],
                "dates": sp["dates"], "projects": projects,
            })
        except Exception as e:
            print(f"[WARN] Спринт {sp['num']}: {e}")

    output = {"ts": int(time.time() * 1000), "sprints": result_sprints, "projects": projects_meta}
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[OK] {OUTPUT} — {OUTPUT.stat().st_size} байт, {len(result_sprints)} спринтів")

if __name__ == "__main__":
    main()
