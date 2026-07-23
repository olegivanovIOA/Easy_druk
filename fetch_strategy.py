#!/usr/bin/env python3
"""
fetch_strategy.py — Easy 3D Print Dashboard
Читає всі листи-спринти з Google Sheets через Sheets API v4 + CSV export.
Також читає start/deadline проектів з листа "Проекти" для побудови Gantt.
"""

import csv, io, json, os, re, time
from pathlib import Path
import requests

SHEET_ID  = os.environ.get("GOOGLE_SHEET_ID", "1-BRONIOFVG4uES7iuDGIH7svebRzfbcCCNtddU2jo28")
API_KEY   = os.environ.get("GOOGLE_API_KEY", "")
OUTPUT    = Path(__file__).parent / "data" / "strategy.json"
SPRINT_RE = re.compile(r"^Спринт\s+(\d+)\s*\(([^)]+)\)", re.IGNORECASE)

# ID проекту тепер може бути "1", "2", "7" АБО старий формат "1.0", "3.0"
PROJ_ID_RE = re.compile(r"^\d+(\.\d+)?$")

# Колонки листа "Проекти" (0-indexed):
# A=0 ID, B=1 Назва, C=2 Пріоритет, D=3 Відповідальний,
# E=4 Дата старту, F=5 Дедлайн, H=7 Кінцевий результат, L=11 Команда
COL_ID, COL_NAME, COL_PRIO, COL_OWNER = 0, 1, 2, 3
COL_START, COL_DEADLINE = 4, 5
COL_TEAM = 11


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
    content = r.content.decode("utf-8-sig")
    return list(csv.reader(io.StringIO(content)))

def normalize_pid(pid):
    """Нормалізує ID проекту до формату X.0 для сумісності з усіма спринтами/листом Проекти."""
    pid = pid.strip()
    if "." in pid:
        return pid
    return f"{pid}.0"

def normalize_date(raw):
    """
    Приводить дату до формату YYYY-MM-DD.
    Підтримує: DD.MM.YYYY, DD.MM.YY, YYYY-MM-DD.
    Повертає '' якщо не вдалось розпарсити (напр. "Тиждень 3").
    """
    raw = (raw or "").strip()
    if not raw:
        return ""
    # Вже ISO
    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})", raw)
    if m:
        return f"{m.group(1)}-{m.group(2)}-{m.group(3)}"
    # DD.MM.YYYY або DD.MM.YY (можливо з часом після, напр. "01.05.2026 0:00:00")
    m = re.match(r"^(\d{1,2})\.(\d{1,2})\.(\d{2,4})", raw)
    if m:
        d, mo, y = m.groups()
        if len(y) == 2:
            y = "20" + y
        return f"{y}-{mo.zfill(2)}-{d.zfill(2)}"
    return ""  # формати типу "Тиждень 3" — не дата, ігноруємо

STATUS_DONE      = "Виконано"
STATUS_POSTPONED = "Перенесено"
STATUS_CANCELLED = "Відмінено"

def _add_task(proj, c, d, f, h):
    status = h.strip()
    done = status == STATUS_DONE
    proj["tasks"].append({
        "task": c.strip()[:200],
        "owner": d.split(",")[0].strip(),
        "deadline": f.strip()[:20],
        "status": status,
        "done": done,
    })
    proj["total"] += 1
    if done:
        proj["done"] += 1
    elif status == STATUS_POSTPONED:
        proj["postponed"] += 1
    elif status == STATUS_CANCELLED:
        proj["cancelled"] += 1

def fetch_projects_meta(gid):
    """Читає лист Проекти: ID → {name, owner, team, priority, start, deadline}"""
    rows = fetch_csv(gid)
    meta = {}
    for row in rows[1:]:
        row = row + [''] * max(0, 13 - len(row))
        pid_raw = row[COL_ID].strip()
        name    = row[COL_NAME].strip()
        prio    = row[COL_PRIO].strip()
        owner   = row[COL_OWNER].strip()
        team    = row[COL_TEAM].strip()
        start_raw = row[COL_START].strip() if len(row) > COL_START else ""
        deadline_raw = row[COL_DEADLINE].strip() if len(row) > COL_DEADLINE else ""

        if pid_raw and PROJ_ID_RE.match(pid_raw):
            pid = normalize_pid(pid_raw)
            meta[pid] = {
                'name':     name,
                'owner':    owner or 'Вакансія',
                'team':     team,
                'priority': prio or 'B',
                'start':    normalize_date(start_raw),
                'deadline': normalize_date(deadline_raw),
            }
    return meta


def parse_sprint(rows):
    projects, current = {}, None
    for row in rows:
        row = [c.strip() for c in row]
        row += [""] * max(0, 9 - len(row))
        a, b, c, d = row[0], row[1], row[2], row[3]
        f, h = row[5], row[7]

        if b in ("Проекти (назва)", "Задача") or a == "№":
            continue
        if not a and not b and not c:
            continue

        is_proj_id = bool(PROJ_ID_RE.match(a))

        if is_proj_id:
            current = normalize_pid(a)
            if current not in projects:
                projects[current] = {"name": b or a, "done": 0, "total": 0,
                                      "postponed": 0, "cancelled": 0, "tasks": []}
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

    projects_owner_map = {}
    projects_sheet = next((s for s in all_sheets if s['title'] == 'Проекти'), None)
    if projects_sheet:
        print(f"[INFO] Читаю лист Проекти (gid={projects_sheet['gid']})")
        try:
            projects_owner_map = fetch_projects_meta(projects_sheet['gid'])
            print(f"       Знайдено {len(projects_owner_map)} проектів")
            for pid, p in sorted(projects_owner_map.items()):
                print(f"       {pid}: {p['owner']} | старт={p['start']} дедлайн={p['deadline']} — {p['name'][:40]}")
        except Exception as e:
            print(f"[WARN] Лист Проекти: {e}")

    result_sprints, projects_meta = [], {}
    for sp in sprint_sheets:
        print(f"[INFO] Спринт {sp['num']}: gid={sp['gid']}")
        try:
            rows     = fetch_csv(sp["gid"])
            projects = parse_sprint(rows)
            print(f"       Розпарсено проектів: {len(projects)}")
            for pid, p in sorted(projects.items()):
                print(f"       {pid}: {p['done']}/{p['total']} задач — {p['name'][:40]}")
                if projects_owner_map and pid not in projects_owner_map:
                    print(f"       [WARN] ID {pid} відсутній у листі 'Проекти' — можлива "
                          f"помилка ID у листі '{sp['name']}' (перевір назву: '{p['name'][:40]}')")
                if pid not in projects_meta:
                    pm = projects_owner_map.get(pid, {})
                    projects_meta[pid] = {
                        "name":     pm.get("name") or p["name"],
                        "owner":    pm.get("owner", ""),
                        "team":     pm.get("team", ""),
                        "priority": pm.get("priority", "B"),
                        "start":    pm.get("start", ""),
                        "deadline": pm.get("deadline", ""),
                        "sprintNums": []
                    }
                projects_meta[pid]["sprintNums"].append(sp["num"])
            result_sprints.append({
                "num": sp["num"], "name": sp["name"],
                "dates": sp["dates"], "projects": projects,
            })
        except Exception as e:
            print(f"[WARN] Спринт {sp['num']}: {e}")

    # Проекти що є в листі "Проекти" але не з'явились в жодному спринті —
    # додаємо їх теж, щоб Gantt і "не в фокусі" бачили повну картину
    for pid, pm in projects_owner_map.items():
        if pid not in projects_meta:
            projects_meta[pid] = {
                "name":     pm.get("name", pid),
                "owner":    pm.get("owner", "Вакансія"),
                "team":     pm.get("team", ""),
                "priority": pm.get("priority", "B"),
                "start":    pm.get("start", ""),
                "deadline": pm.get("deadline", ""),
                "sprintNums": []
            }

    output = {"ts": int(time.time() * 1000), "sprints": result_sprints, "projects": projects_meta}
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")
    size = OUTPUT.stat().st_size
    print(f"[OK] {OUTPUT} — {size} байт, {len(result_sprints)} спринтів, {len(projects_meta)} проектів")

if __name__ == "__main__":
    main()
