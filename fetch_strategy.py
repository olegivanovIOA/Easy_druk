#!/usr/bin/env python3
"""
fetch_strategy.py — Easy 3D Print Dashboard
Читає всі листи-спринти з Google Sheets через Sheets API v4 + CSV export.
"""

import csv, io, json, os, re, time
from pathlib import Path
import requests

SHEET_ID  = os.environ.get("GOOGLE_SHEET_ID", "1GD3tyFOC7-0tSjAIR1uaS9H2nbVUwrUFGAbfgBJMV2A")
API_KEY   = os.environ.get("GOOGLE_API_KEY", "")
OUTPUT    = Path(__file__).parent / "data" / "strategy.json"
SPRINT_RE = re.compile(r"^Спринт\s+(\d+)\s*\(([^)]+)\)", re.IGNORECASE)

def get_sheet_list():
    url = (f"https://sheets.googleapis.com/v4/spreadsheets/{SHEET_ID}"
           f"?fields=sheets.properties(sheetId,title)&key={API_KEY}")
    r = requests.get(url, timeout=15)
    r.raise_for_status()
    return [{"gid": str(s["properties"]["sheetId"]), "title": s["properties"]["title"]}
            for s in r.json().get("sheets", [])]

def fetch_csv(gid):
    url = (f"https://docs.google.com/spreadsheets/d/{SHEET_ID}"
           f"/export?format=csv&gid={gid}")
    r = requests.get(url, timeout=20)
    r.raise_for_status()
    # Явно декодуємо як UTF-8 — фікс кирилиці
    content = r.content.decode("utf-8-sig")
    return list(csv.reader(io.StringIO(content)))

def _add_task(proj, c, d, f, h):
    done = h.strip() == "Виконано"
    proj["tasks"].append({
        "task": c.strip()[:200],
        "owner": d.split(",")[0].strip(),
        "deadline": f.strip()[:20],
        "status": h.strip(),
        "done": done,
    })
    proj["total"] += 1
    if done:
        proj["done"] += 1

def fetch_projects_meta(gid):
    """Читає лист Проекти: ID → {name, owner, team, goal}"""
    rows = fetch_csv(gid)
    meta = {}
    for row in rows[1:]:  # пропустити заголовок
        row = row + [''] * max(0, 13 - len(row))
        pid   = row[0].strip()
        name  = row[1].strip()
        owner = row[3].strip()
        team  = row[11].strip()  # колонка L
        if pid and re.match(r'^\d+\.\d+$', pid):
            meta[pid] = {
                'name':  name,
                'owner': owner or 'Вакансія',
                'team':  team,
            }
    return meta


def parse_sprint(rows):
    projects, current = {}, None
    for row in rows:
        row = [c.strip() for c in row]
        row += [""] * max(0, 9 - len(row))
        a, b, c, d = row[0], row[1], row[2], row[3]
        f, h = row[5], row[7]

        # Пропустити рядки заголовків
        if b in ("Проекти (назва)", "Задача") or a == "№":
            continue
        # Порожні рядки
        if not a and not b and not c:
            continue

        is_proj_id = bool(re.match(r"^\d+\.\d+$", a))

        if is_proj_id:
            current = a
            if current not in projects:
                projects[current] = {"name": b or a, "done": 0, "total": 0, "tasks": []}
            # Рядок є і заголовком і першою задачею (Спринт 1)
            if c and len(c) > 2:
                _add_task(projects[current], c, d, f, h)
        elif current and c and len(c) > 2:
            _add_task(projects[current], c, d, f, h)

    return projects

def main():
    print(f"[INFO] Sheet ID: {SHEET_ID}")
    if not API_KEY:
        raise SystemExit("[ERROR] GOOGLE_API_KEY не встановлено")

    all_sheets = get_sheet_list()
    print(f"[INFO] Знайдено листів: {len(all_sheets)}")

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
    print(f"[INFO] Спринтів: {[s['num'] for s in sprint_sheets]}")

    if not sprint_sheets:
        raise SystemExit("[ERROR] Жодного листа-спринту не знайдено")

    # Завантажити мета по проектах з листа "Проекти" (gid=0)
    projects_owner_map = {}
    projects_sheet = next((s for s in all_sheets if s['title'] == 'Проекти'), None)
    if projects_sheet:
        print(f"[INFO] Читаю лист Проекти (gid={projects_sheet['gid']})")
        try:
            projects_owner_map = fetch_projects_meta(projects_sheet['gid'])
            print(f"       Знайдено {len(projects_owner_map)} проектів")
            for pid, p in sorted(projects_owner_map.items()):
                print(f"       {pid}: {p['owner']} — {p['name'][:40]}")
        except Exception as e:
            print(f"[WARN] Лист Проекти: {e}")

    result_sprints, projects_meta = [], {}
    for sp in sprint_sheets:
        print(f"[INFO] Спринт {sp['num']}: gid={sp['gid']}")
        try:
            rows     = fetch_csv(sp["gid"])
            projects = parse_sprint(rows)
            for pid, p in sorted(projects.items()):
                print(f"       {pid}: {p['done']}/{p['total']} задач")
                if pid not in projects_meta:
                    pm = projects_owner_map.get(pid, {})
                    projects_meta[pid] = {
                        "name":  pm.get("name") or p["name"],
                        "owner": pm.get("owner", ""),
                        "team":  pm.get("team", ""),
                        "sprintNums": []
                    }
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
    size = OUTPUT.stat().st_size
    print(f"[OK] {OUTPUT} — {size} байт, {len(result_sprints)} спринтів")

if __name__ == "__main__":
    main()
