#!/usr/bin/env python3
"""
fetch_hr.py — Easy 3D Print Dashboard
Читає HR-дані з Google Sheets, пише data/hr.json
Накопичує data/hr_vacancies_history.json (вакансії по місяцям)

Листи джерела: 1XQX5lXgHdumwANn2kSwyG-rSdYS4i0RnwtuL7aMfDK4
  - Співробітники      → загальна кількість
  - Стажери            → помісячна кількість
  - Відкриті вакансії  → поточні вакансії (+ зберігаємо в history)
  - Час закриття вакансій → довідник норм закриття
  - Плинність кадрів   → помісячна текучість
"""

import csv, io, json, os, re
from datetime import datetime
from pathlib import Path
import requests

HR_SHEET_ID = os.environ.get("HR_SHEET_ID", "1XQX5lXgHdumwANn2kSwyG-rSdYS4i0RnwtuL7aMfDK4")
API_KEY     = os.environ.get("GOOGLE_API_KEY", "")

HR_OUTPUT      = Path(__file__).parent / "data" / "hr.json"
VAC_HISTORY    = Path(__file__).parent / "data" / "hr_vacancies_history.json"

# ─── НАЗВИ ЛИСТІВ (повинні збігатися з реальними назвами в Sheets) ────────────
SHEET_EMPLOYEES   = "Співробітники"
SHEET_INTERNS     = "Стажери"
SHEET_VACANCIES   = "Відкриті вакансії"
SHEET_CLOSE_NORMS = "Час закриття вакансій"
SHEET_TURNOVER    = "Плинність кадрів"

UA_MONTHS = {
    "Січень": "01", "Лютий": "02", "Березень": "03", "Квітень": "04",
    "Травень": "05", "Червень": "06", "Липень": "07", "Серпень": "08",
    "Вересень": "09", "Жовтень": "10", "Листопад": "11", "Грудень": "12"
}


def get_sheet_list():
    url = (f"https://sheets.googleapis.com/v4/spreadsheets/{HR_SHEET_ID}"
           f"?fields=sheets.properties(sheetId,title)&key={API_KEY}")
    r = requests.get(url, timeout=15)
    r.raise_for_status()
    return {s["properties"]["title"]: str(s["properties"]["sheetId"])
            for s in r.json().get("sheets", [])}


def fetch_csv(gid):
    url = (f"https://docs.google.com/spreadsheets/d/{HR_SHEET_ID}"
           f"/export?format=csv&gid={gid}")
    r = requests.get(url, timeout=20)
    r.raise_for_status()
    content = r.content.decode("utf-8-sig")
    return list(csv.reader(io.StringIO(content)))


def cell(row, idx, default=""):
    return row[idx].strip() if idx < len(row) else default


# ─── 1. СПІВРОБІТНИКИ — кількість рядків у колонці A (мінус заголовок) ────────
def parse_employees(rows):
    count = 0
    for row in rows[1:]:  # пропустити заголовок "ПІП"
        val = cell(row, 0)
        if not val or val.lower() in ("", " "):
            break
        count += 1
    return count


# ─── 2. СТАЖЕРИ — помісячна кількість ─────────────────────────────────────────
def parse_interns(rows):
    """
    Логіка: рядок з назвою місяця (об'єднана комірка) — сегментатор.
    Усі непусті рядки А до слова 'Відсів' — стажери цього місяця.
    """
    result = []
    current_month = None
    current_count = 0

    for row in rows:
        val = cell(row, 0)
        if not val:
            continue

        # Перевіряємо чи це назва місяця
        matched_month = None
        for month_name in UA_MONTHS:
            if month_name.lower() in val.lower():
                matched_month = month_name
                break

        if matched_month:
            # Зберігаємо попередній місяць якщо є
            if current_month and current_count > 0:
                result.append({"month": current_month, "count": current_count})
            current_month = matched_month
            current_count = 0
            continue

        # Зупиняємося на 'Відсів'
        if "відсів" in val.lower():
            if current_month:
                result.append({"month": current_month, "count": current_count})
            current_month = None
            current_count = 0
            continue

        # Рахуємо як стажера
        if current_month and len(val) > 2:
            current_count += 1

    # Останній місяць
    if current_month and current_count > 0:
        result.append({"month": current_month, "count": current_count})

    return result


# ─── 3. ВІДКРИТІ ВАКАНСІЇ — поточний стан ─────────────────────────────────────
def parse_vacancies(rows):
    """
    Структура: Вакансія | Локація | Кількість | Причина | Терміновість | Статус
    Перший рядок — заголовки. Потім рядок з назвою місяця (merged).
    Далі — вакансії.
    """
    vacancies = []
    current_month = None

    for row in rows:
        if not any(cell(row, i) for i in range(6)):
            continue

        val = cell(row, 0)

        # Назва місяця
        matched_month = None
        for month_name in UA_MONTHS:
            if month_name.lower() in val.lower() and len(val) < 20:
                matched_month = month_name
                break

        if matched_month:
            current_month = matched_month
            continue

        # Заголовок
        if val.lower() in ("вакансія", ""):
            continue

        name = val
        location = cell(row, 1)
        qty = cell(row, 2)
        reason = cell(row, 3)
        urgency = cell(row, 4)
        status = cell(row, 5)

        if name and name.lower() != "вакансія":
            vacancies.append({
                "vacancy": name,
                "location": location,
                "qty": qty,
                "reason": reason,
                "urgency": urgency,
                "status": status,
            })

    return {"month": current_month, "vacancies": vacancies}


# ─── 4. НОРМИ ЗАКРИТТЯ ВАКАНСІЙ — довідник ────────────────────────────────────
def parse_closing_norms(rows):
    norms = []
    for row in rows:
        position = cell(row, 1)
        days = cell(row, 2)
        if not position or not days:
            continue
        try:
            int(days)
        except ValueError:
            continue
        norms.append({"position": position, "days": int(days)})
    return norms


# ─── 5. ПЛИННІСТЬ КАДРІВ — помісячна таблиця ──────────────────────────────────
def parse_turnover(rows):
    """
    Структура (з скріна):
    Рядок 3: заголовки місяців (Березень, Квітень, ...)
    Рядки 4-5: Факт на початок / Факт на кінець
    Рядок 6: Середня кількість
    Рядок 8: Кількість звільнених
    Рядок 10: Текучість %
    Рядок 12: Таргет
    """
    result = {"staff": [], "interns": [], "target_staff": None, "target_interns": None}

    # Знаходимо рядки з даними
    months_row = []
    data = {}

    for i, row in enumerate(rows):
        label = cell(row, 0).lower()

        # Рядок місяців — шукаємо рядок де є назви місяців
        if not months_row:
            for j, c in enumerate(row):
                for m in UA_MONTHS:
                    if m.lower() in c.lower():
                        months_row = row
                        break

        if "середня кількість" in label and "стажер" not in label:
            data["avg_staff"] = row
        if "кількість звільнених" in label:
            data["fired"] = row
        if "текучість" in label and "стажер" not in label and "%" in cell(row, 0):
            data["turnover_pct"] = row
        if "таргет" in label and "стажер" not in label:
            t = next((cell(row, j) for j in range(1, 5) if cell(row, j)), None)
            if t:
                result["target_staff"] = t
        if "текучість" in label and "стажер" in label:
            data["intern_turnover"] = row
        if "таргет" in label and "стажер" in label:
            t = next((cell(row, j) for j in range(1, 5) if cell(row, j)), None)
            if t:
                result["target_interns"] = t

    # Парсимо місяці та значення
    if months_row and "turnover_pct" in data:
        parsed_months = []
        parsed_vals = []
        turnover_row = data["turnover_pct"]
        for j, c in enumerate(months_row):
            for m in UA_MONTHS:
                if m.lower() in c.lower():
                    val = cell(turnover_row, j) if j < len(turnover_row) else ""
                    if val:
                        parsed_months.append(m)
                        parsed_vals.append(val.replace("%", "").replace(",", ".").strip())
                    break

        result["staff"] = [
            {"month": m, "turnover_pct": v}
            for m, v in zip(parsed_months, parsed_vals)
        ]

    return result


# ─── НАКОПИЧЕННЯ ІСТОРІЇ ВАКАНСІЙ ─────────────────────────────────────────────
def update_vacancies_history(current):
    """Дописує поточний місяць до history-файлу якщо ще не записаний."""
    history = []

    if VAC_HISTORY.exists():
        try:
            history = json.loads(VAC_HISTORY.read_text(encoding="utf-8"))
        except Exception:
            history = []

    month = current.get("month")
    if not month:
        return history

    # Перевіряємо чи вже є запис за цей місяць
    existing_months = {e.get("month") for e in history}
    if month not in existing_months:
        history.append({
            "month": month,
            "fetched_at": datetime.utcnow().strftime("%Y-%m-%d"),
            "vacancies": current.get("vacancies", []),
            "total": len(current.get("vacancies", [])),
        })
        print(f"[HR] Додано новий місяць до history: {month}")
    else:
        # Оновлюємо поточний місяць (дані могли змінитись)
        for entry in history:
            if entry.get("month") == month:
                entry["vacancies"] = current.get("vacancies", [])
                entry["total"] = len(current.get("vacancies", []))
                entry["fetched_at"] = datetime.utcnow().strftime("%Y-%m-%d")
        print(f"[HR] Оновлено поточний місяць: {month}")

    VAC_HISTORY.write_text(json.dumps(history, ensure_ascii=False, indent=2), encoding="utf-8")
    return history


# ─── MAIN ─────────────────────────────────────────────────────────────────────
def main():
    print(f"[HR] Старт {datetime.utcnow().isoformat()}")

    sheets = get_sheet_list()
    print(f"[HR] Знайдено листів: {list(sheets.keys())}")

    result = {
        "fetched_at": datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
        "employees_count": 0,
        "interns_by_month": [],
        "vacancies_current": {},
        "vacancies_history": [],
        "closing_norms": [],
        "turnover": {},
    }

    # 1. Співробітники
    if SHEET_EMPLOYEES in sheets:
        rows = fetch_csv(sheets[SHEET_EMPLOYEES])
        result["employees_count"] = parse_employees(rows)
        print(f"[HR] Співробітників: {result['employees_count']}")
    else:
        print(f"[HR] ⚠ Лист '{SHEET_EMPLOYEES}' не знайдено")

    # 2. Стажери
    if SHEET_INTERNS in sheets:
        rows = fetch_csv(sheets[SHEET_INTERNS])
        result["interns_by_month"] = parse_interns(rows)
        print(f"[HR] Стажери по місяцях: {result['interns_by_month']}")
    else:
        print(f"[HR] ⚠ Лист '{SHEET_INTERNS}' не знайдено")

    # 3. Відкриті вакансії + накопичення history
    if SHEET_VACANCIES in sheets:
        rows = fetch_csv(sheets[SHEET_VACANCIES])
        current_vac = parse_vacancies(rows)
        result["vacancies_current"] = current_vac
        result["vacancies_history"] = update_vacancies_history(current_vac)
        print(f"[HR] Вакансій поточних: {len(current_vac.get('vacancies', []))}")
    else:
        print(f"[HR] ⚠ Лист '{SHEET_VACANCIES}' не знайдено")

    # 4. Норми закриття
    if SHEET_CLOSE_NORMS in sheets:
        rows = fetch_csv(sheets[SHEET_CLOSE_NORMS])
        result["closing_norms"] = parse_closing_norms(rows)
        print(f"[HR] Норм закриття: {len(result['closing_norms'])}")
    else:
        print(f"[HR] ⚠ Лист '{SHEET_CLOSE_NORMS}' не знайдено")

    # 5. Плинність кадрів
    if SHEET_TURNOVER in sheets:
        rows = fetch_csv(sheets[SHEET_TURNOVER])
        result["turnover"] = parse_turnover(rows)
        print(f"[HR] Плинність: {result['turnover']}")
    else:
        print(f"[HR] ⚠ Лист '{SHEET_TURNOVER}' не знайдено")

    # Запис hr.json
    HR_OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    HR_OUTPUT.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[HR] ✓ Записано {HR_OUTPUT}")


if __name__ == "__main__":
    main()
