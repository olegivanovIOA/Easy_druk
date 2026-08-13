#!/usr/bin/env python3
"""
fetch_strategy.py — Easy 3D Print Dashboard v1.2
Читає всі листи-спринти з Google Sheets.
Нове: парсить start/deadline/owner/priority з листа "Проекти" (колонки E/F/D/C).
"""

import csv, io, json, os, re, time
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed
import requests

# НОВИЙ Sheet ID (оновлено серпень 2026)
SHEET_ID  = os.environ.get("GOOGLE_SHEET_ID", "1-BRONIOFVG4uES7iuDGIH7svebRzfbcCCNtddU2jo28")
API_KEY   = os.environ.get("GOOGLE_API_KEY", "")
OUTPUT    = Path(__file__).parent / "data" / "strategy.json"
SPRINT_RE = re.compile(r"^Спринт\s+(\d+)\s*\(([^)]+)\)", re.IGNORECASE)

# ID проекту: "1", "2", "7" або старий "1.0", "3.0"
PROJ_ID_RE = re.compile(r"^\d+(\.\d+)?$")

# Колонки листа "Проекти" (0-indexed після CSV export):
# A=0 №, B=1 Назва, C=2 Пріоритет, D=3 Відповідальний, E=4 Дата старту, F=5 Дедлайн
COL_ID       = 0
COL_NAME     = 1
COL_PRIORITY = 2
COL_OWNER    = 3
COL_START    = 4
COL_DEADLINE = 5
COL_TEAM     = 11


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
    return list(csv.reader(io.StringIO(r.content.decode("utf-8-sig"))))


def cell(row, idx, default=""):
    return row[idx].strip() if idx < len(row) else default


def normalize_pid(pid):
    """'1' → '1.0', '1.0' → '1.0'"""
    pid = pid.strip()
    return pid if "." in pid else f"{pid}.0"


def normalize_date(raw):
    """
    DD.MM.YYYY [час] або YYYY-MM-DD → YYYY-MM-DD
    Повертає '' якщо не розпарсити (наприклад 'Тиждень 3').
    """
    raw = (raw or "").strip()
    if not raw:
        return ""
    # ISO вже
    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})", raw)
    if m:
        return f"{m.group(1)}-{m.group(2)}-{m.group(3)}"
    # DD.MM.YYYY або DD.MM.YY (можливо з часом після)
    m = re.match(r"^(\d{1,2})\.(\d{1,2})\.(\d{2,4})", raw)
    if m:
        d, mo, y = m.groups()
        if len(y) == 2:
            y = "20" + y
        return f"{y}-{mo.zfill(2)}-{d.zfill(2)}"
    return ""


def build_projects_meta(rows):
    """Лист 'Проекти': перетворює вже завантажені рядки → {pid: {name, owner, priority, start, deadline, team}}
    Розділено з fetch_projects_meta, щоб сам HTTP-фетч можна було виконати
    паралельно з іншими листами, а розбір рядків (CPU, без мережі) — окремо."""
    meta = {}
    for row in rows[1:]:  # пропускаємо заголовок
        pid_raw = cell(row, COL_ID)
        if not pid_raw or not PROJ_ID_RE.match(pid_raw):
            continue
        pid = normalize_pid(pid_raw)
        meta[pid] = {
            "name":     cell(row, COL_NAME),
            "owner":    cell(row, COL_OWNER) or "Вакансія",
            "priority": cell(row, COL_PRIORITY) or "B",
            "start":    normalize_date(cell(row, COL_START)),
            "deadline": normalize_date(cell(row, COL_DEADLINE)),
            "team":     cell(row, COL_TEAM),
        }
        print(f"       Проект {pid}: {meta[pid]['owner']} | "
              f"start={meta[pid]['start']} deadline={meta[pid]['deadline']}")
    return meta


def fetch_projects_meta(gid):
    """Сумісність зі старим API (не паралельний виклик) — фетч + розбір одразу."""
    return build_projects_meta(fetch_csv(gid))


def _add_task(proj, task_text, owner, deadline, status):
    done = status.strip() == "Виконано"
    moved = status.strip() == "Перенесено"
    proj["tasks"].append({
        "task":     task_text.strip()[:200],
        "owner":    owner.split(",")[0].strip(),
        "deadline": deadline.strip()[:20],
        "status":   status.strip(),
        "done":     done,
        "moved":    moved,
    })
    proj["total"] += 1
    if done:
        proj["done"] += 1
    if moved:
        proj["moved"] = proj.get("moved", 0) + 1


def build_name_to_pid(projects_meta):
    """Мапа 'точна назва проекту' → pid, з листа 'Проекти'. Потрібна як fallback,
    коли в листі спринту колонка A (№ проекту) лишена порожньою для всіх рядків
    блоку — трапляється для деяких проектів (напр. 9.0/10.0/11.0/12.0), де
    хтось забув проставити номер при створенні рядків задач."""
    m = {}
    for pid, meta in projects_meta.items():
        name = (meta.get("name") or "").strip()
        if name:
            m[name] = pid
    return m


def parse_sprint(rows, name_to_pid=None):
    """Парсить один лист спринту → {pid: {name, done, total, moved, tasks}}"""
    name_to_pid = name_to_pid or {}
    projects, current = {}, None
    for row in rows:
        row = [c.strip() for c in row]
        row += [""] * max(0, 10 - len(row))
        a, b, c, d = row[0], row[1], row[2], row[3]
        f = row[5]   # Дедлайн задачі
        h = row[7]   # Статус

        # Пропускаємо заголовки
        if b in ("Проекти (назва)", "Задача") or a == "№":
            continue
        if not a and not b and not c:
            continue

        is_proj_id = bool(PROJ_ID_RE.match(a))

        if is_proj_id:
            current = normalize_pid(a)
            if current not in projects:
                projects[current] = {
                    "name": b or a, "done": 0, "total": 0,
                    "moved": 0, "tasks": []
                }
            if c and len(c) > 2:
                _add_task(projects[current], c, d, f, h)
        elif not a and b:
            # № порожній, але назва проекту в колонці B відома з листа "Проекти" —
            # перемикаємо current за назвою, а не втрачаємо ці задачі.
            matched = name_to_pid.get(b.strip())
            if matched:
                current = matched
            if current and current not in projects:
                projects[current] = {
                    "name": b or current, "done": 0, "total": 0,
                    "moved": 0, "tasks": []
                }
            if current and c and len(c) > 2:
                _add_task(projects[current], c, d, f, h)
        elif current and c and len(c) > 2:
            _add_task(projects[current], c, d, f, h)

    return projects


def main():
    print(f"[STRATEGY] Sheet ID: {SHEET_ID}")
    if not API_KEY:
        raise SystemExit("[ERROR] GOOGLE_API_KEY не встановлено")

    all_sheets = get_sheet_list()
    print(f"[STRATEGY] Знайдено листів: {len(all_sheets)}")

    # Збираємо листи спринтів
    sprint_sheets = []
    for s in all_sheets:
        m = SPRINT_RE.match(s["title"])
        if m:
            sprint_sheets.append({
                "num":   int(m.group(1)),
                "name":  s["title"],
                "dates": m.group(2).replace("-", "–"),
                "gid":   s["gid"],
            })
    sprint_sheets.sort(key=lambda x: x["num"])
    print(f"[STRATEGY] Спринти: {[s['num'] for s in sprint_sheets]}")

    if not sprint_sheets:
        raise SystemExit("[ERROR] Жодного листа-спринту не знайдено")

    # Читаємо метадані проектів (start/deadline/owner)
    projects_sheet = next((s for s in all_sheets if s["title"] == "Проекти"), None)
    if not projects_sheet:
        print("[WARN] Лист 'Проекти' не знайдено — start/deadline будуть порожніми")

    # ── Паралельний фетч усіх CSV (Проекти + кожен спринт) ──
    # Раніше це було послідовно: 1 запит на Проекти + N запитів на спринти,
    # кожен export?format=csv у Google займає 1–5с — при 7+ спринтах виходило
    # ~1 хв сумарно. Самі HTTP-запити незалежні один від одного (різні gid
    # того самого документа), тож якщо парсинг (CPU, без мережі) прибрати з
    # цього циклу, фетч можна розпаралелити — і час впирається лише в
    # найповільніший ОДИН запит, а не в суму всіх.
    fetch_jobs = list(sprint_sheets)
    if projects_sheet:
        fetch_jobs.append({"num": None, "gid": projects_sheet["gid"], "name": "Проекти"})

    raw_rows_by_gid = {}
    fetch_errors = {}
    with ThreadPoolExecutor(max_workers=min(len(fetch_jobs), 8) or 1) as pool:
        future_to_job = {pool.submit(fetch_csv, job["gid"]): job for job in fetch_jobs}
        for future in as_completed(future_to_job):
            job = future_to_job[future]
            try:
                raw_rows_by_gid[job["gid"]] = future.result()
            except Exception as e:
                fetch_errors[job["gid"]] = e
                print(f"[WARN] Фетч '{job['name']}' (gid={job['gid']}): {e}")

    # Метадані проектів — з уже завантажених рядків (без повторного мережевого виклику)
    projects_meta = {}
    if projects_sheet and projects_sheet["gid"] in raw_rows_by_gid:
        try:
            print(f"[STRATEGY] Читаю лист 'Проекти' (gid={projects_sheet['gid']})")
            projects_meta = build_projects_meta(raw_rows_by_gid[projects_sheet["gid"]])
            print(f"[STRATEGY] Знайдено {len(projects_meta)} проектів у листі Проекти")
        except Exception as e:
            print(f"[WARN] Розбір листа Проекти: {e}")

    # Парсимо всі спринти (CPU-only, дані вже в пам'яті — швидко, послідовно заради детермінованого порядку)
    result_sprints = []
    all_pids_seen = {}  # pid → {sprintNums: []}
    name_to_pid = build_name_to_pid(projects_meta)

    for sp in sprint_sheets:
        print(f"[STRATEGY] Спринт {sp['num']}: gid={sp['gid']}")
        if sp["gid"] not in raw_rows_by_gid:
            print(f"[WARN] Спринт {sp['num']}: немає даних (фетч не вдався)")
            continue
        try:
            rows = raw_rows_by_gid[sp["gid"]]
            projects = parse_sprint(rows, name_to_pid)
            print(f"           Проектів: {len(projects)}, "
                  f"задач: {sum(p['total'] for p in projects.values())}, "
                  f"виконано: {sum(p['done'] for p in projects.values())}")
            for pid, p in sorted(projects.items()):
                print(f"           {pid}: {p['done']}/{p['total']} — {p['name'][:40]}")
                if pid not in all_pids_seen:
                    all_pids_seen[pid] = {
                        "name":      p["name"],
                        "sprintNums": [],
                    }
                all_pids_seen[pid]["sprintNums"].append(sp["num"])
            result_sprints.append({
                "num":      sp["num"],
                "name":     sp["name"],
                "dates":    sp["dates"],
                "projects": projects,
            })
        except Exception as e:
            print(f"[WARN] Спринт {sp['num']}: {e}")

    # Формуємо фінальний словник проектів (merge meta + sprint info)
    final_projects = {}
    all_pids = set(list(all_pids_seen.keys()) + list(projects_meta.keys()))
    for pid in all_pids:
        sprint_info = all_pids_seen.get(pid, {})
        meta = projects_meta.get(pid, {})
        final_projects[pid] = {
            "name":       meta.get("name") or sprint_info.get("name", pid),
            "owner":      meta.get("owner", ""),
            "priority":   meta.get("priority", "B"),
            "start":      meta.get("start", ""),
            "deadline":   meta.get("deadline", ""),
            "team":       meta.get("team", ""),
            "sprintNums": sprint_info.get("sprintNums", []),
        }

    output = {
        "ts":       int(time.time() * 1000),
        "sprints":  result_sprints,
        "projects": final_projects,
    }

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")
    size = OUTPUT.stat().st_size
    print(f"[OK] {OUTPUT} — {size} байт, "
          f"{len(result_sprints)} спринтів, {len(final_projects)} проектів")

    # Знімок прогресу на сьогодні → історія для графіка на вкладці Стратегія
    try:
        snapshot = compute_progress_snapshot(result_sprints)
        current_sprint_num = max((sp["num"] for sp in result_sprints), default=None)
        upsert_progress_history(snapshot, current_sprint_num)
    except Exception as e:
        print(f"[WARN] Знімок прогресу не вдався: {e}")


# ── Прогрес у часі: щоденний знімок для графіка "Прогрес стратегії" ─────────
HISTORY_OUTPUT = Path(__file__).parent / "data" / "strategy_progress_history.json"

# Дзеркало 13 "офіційних" проектів з data/static.js — потрібне для CEO-style
# розрахунку (сумарний done/total по проекту, timescore-фолбек як у
# renderStrategy() в index.html). Тримати в синхроні при зміні static.js.
CEO_PROJECTS = [
    {"id": "1",  "start": "2026-04-22", "deadline": "2026-05-08"},
    {"id": "2",  "start": "2026-05-01", "deadline": "2026-12-31"},
    {"id": "3",  "start": "2026-04-22", "deadline": "2026-07-01"},
    {"id": "4",  "start": "2026-01-01", "deadline": "2026-12-31"},
    {"id": "5",  "start": "2026-04-06", "deadline": "2026-12-31"},
    {"id": "6",  "start": "2026-06-08", "deadline": "2026-11-27"},
    {"id": "7",  "start": "2026-04-20", "deadline": "2026-08-31"},
    {"id": "8",  "start": "2026-05-04", "deadline": "2026-12-31"},
    {"id": "9",  "start": "2026-04-20", "deadline": "2026-05-29"},
    {"id": "10", "start": "2026-05-01", "deadline": "2026-12-31"},
    {"id": "11", "start": "2026-05-01", "deadline": "2026-12-31"},
    {"id": "12", "start": "2026-05-01", "deadline": "2026-12-31"},
    {"id": "14", "start": "2026-05-01", "deadline": "2026-12-31"},
]

# Дзеркало GOALS_STATIC з js/strategy_scoring.js (5 цілей, ваги, проект→ціль).
# Тримати в синхроні при зміні strategy_scoring.js.
GOAL_WEIGHTS = {"Ц1": 25, "Ц2": 25, "Ц3": 20, "Ц4": 15, "Ц5": 15}
GOAL_PROJECTS = {
    "Ц1": ["1", "3", "12"],
    "Ц2": ["8", "9", "10", "11", "16"],
    "Ц3": ["7", "14", "13"],
    "Ц4": ["2"],
    "Ц5": ["4", "5", "6", "15"],
}


def _agg_done_total(result_sprints):
    """{pid: {done,total}} — сумарно по всіх спринтах, pid нормалізовано без '.0'."""
    agg = {}
    for sp in result_sprints:
        for pid_raw, p in (sp.get("projects") or {}).items():
            pid = pid_raw[:-2] if pid_raw.endswith(".0") else pid_raw
            a = agg.setdefault(pid, {"done": 0, "total": 0})
            a["done"] += p.get("done", 0)
            a["total"] += p.get("total", 0)
    return agg


def compute_progress_snapshot(result_sprints):
    """Повертає {ceo_pct, goal_scoring_pct, raw_task_pct, done, total, goals:[...]}
    — ті самі формули, що й на CEO-вкладці та у віджеті 'Скорінг цілей 2026'."""
    import datetime
    agg = _agg_done_total(result_sprints)
    today = datetime.date.today()

    # ── CEO-style: рівне середнє по 13 проектах, real done/total або
    # timescore-фолбек якщо задач ще не заведено ──
    ceo_scores = []
    for p in CEO_PROJECTS:
        a = agg.get(p["id"])
        real = round(a["done"] / a["total"] * 100) if a and a["total"] > 0 else None
        try:
            dl = datetime.date.fromisoformat(p["deadline"])
            st = datetime.date.fromisoformat(p["start"])
            total_days = max(1, (dl - st).days)
            elapsed = max(0, (today - st).days)
            timescore = min(100, round(elapsed / total_days * 100))
        except Exception:
            timescore = 0
        ceo_scores.append(real if real is not None else timescore)
    ceo_pct = round(sum(ceo_scores) / len(ceo_scores), 1) if ceo_scores else None

    # ── Скорінг цілей 2026: зважене по цілях середнє projPct, проекти без
    # жодної задачі (total=0 у всіх спринтах) виключені з середнього ──
    goals_out = []
    weighted_sum = 0.0
    for gid, pids in GOAL_PROJECTS.items():
        proj_pcts = []
        for pid in pids:
            a = agg.get(pid)
            if a and a["total"] > 0:
                proj_pcts.append(a["done"] / a["total"] * 100)
        goal_pct = round(sum(proj_pcts) / len(proj_pcts), 1) if proj_pcts else 0.0
        w = GOAL_WEIGHTS.get(gid, 0)
        weighted_sum += goal_pct * w / 100
        goals_out.append({"id": gid, "pct": goal_pct, "weight": w})
    goal_scoring_pct = round(weighted_sum, 1)

    # ── Сирий підсумок — без жодних вагових коефіцієнтів (те, що показано як N/M задач) ──
    done_total = sum(a["done"] for a in agg.values())
    total_total = sum(a["total"] for a in agg.values())
    raw_task_pct = round(done_total / total_total * 100, 1) if total_total else None

    return {
        "ceo_pct": ceo_pct,
        "goal_scoring_pct": goal_scoring_pct,
        "goals": goals_out,
        "raw_task_pct": raw_task_pct,
        "done": done_total,
        "total": total_total,
    }


def upsert_progress_history(snapshot, sprint_num):
    """Один запис на календарну дату (як capacity_history.json) — перезаписує
    сьогоднішній запис при повторному запуску (щогодини), не плодить дублі."""
    import datetime
    today_str = datetime.date.today().isoformat()
    try:
        history = json.loads(HISTORY_OUTPUT.read_text(encoding="utf-8")) if HISTORY_OUTPUT.exists() else {}
    except Exception:
        history = {}
    days = history.setdefault("days", [])
    entry = {"date": today_str, "sprint_num": sprint_num, **snapshot}
    for d in days:
        if d.get("date") == today_str:
            d.clear()
            d.update(entry)
            break
    else:
        days.append(entry)
    history["updated_at"] = int(time.time() * 1000)
    HISTORY_OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    HISTORY_OUTPUT.write_text(json.dumps(history, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[OK] {HISTORY_OUTPUT} — {len(days)} днів історії, сьогодні: "
          f"CEO={snapshot['ceo_pct']}% · Скорінг цілей={snapshot['goal_scoring_pct']}% · "
          f"raw={snapshot['raw_task_pct']}% ({snapshot['done']}/{snapshot['total']})")


if __name__ == "__main__":
    main()
