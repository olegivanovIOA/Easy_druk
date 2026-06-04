#!/usr/bin/env python3
"""
fetch_hr.py — Easy 3D Print Dashboard v1.1
Читає HR через Google Sheets API v4 + Service Account.
Не використовує CSV export (він не працює з корпоративними файлами).
"""

import json, os, time, base64
from datetime import datetime
from pathlib import Path
import requests

HR_SHEET_ID  = os.environ.get("HR_SHEET_ID", "130USLfSJhymjNihdE0cZiZHVtdXKVg6uuhNkuNDE1nA")
SA_JSON_STR  = os.environ.get("GOOGLE_SERVICE_ACCOUNT_JSON", "")
HR_OUTPUT    = Path(__file__).parent / "data" / "hr.json"
VAC_HISTORY  = Path(__file__).parent / "data" / "hr_vacancies_history.json"

SHEET_EMPLOYEES   = "Співробітники"
SHEET_INTERNS     = "Стажери"
SHEET_VACANCIES   = "Відкриті вакансії"
SHEET_CLOSE_NORMS = "Час закритття позицій"
SHEET_TURNOVER    = "Плинність кадрів"

UA_MONTHS = ["Січень","Лютий","Березень","Квітень","Травень","Червень",
             "Липень","Серпень","Вересень","Жовтень","Листопад","Грудень"]


def get_token():
    os.system("pip install cryptography --quiet --break-system-packages 2>/dev/null")
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import padding

    sa = json.loads(SA_JSON_STR)
    now = int(time.time())

    header  = base64.urlsafe_b64encode(json.dumps({"alg":"RS256","typ":"JWT"}).encode()).rstrip(b'=')
    payload = base64.urlsafe_b64encode(json.dumps({
        "iss": sa["client_email"],
        "scope": "https://www.googleapis.com/auth/spreadsheets.readonly",
        "aud": "https://oauth2.googleapis.com/token",
        "exp": now + 3600, "iat": now,
    }).encode()).rstrip(b'=')

    key = serialization.load_pem_private_key(sa["private_key"].encode(), password=None)
    sig = key.sign(header + b'.' + payload, padding.PKCS1v15(), hashes.SHA256())
    jwt = header + b'.' + payload + b'.' + base64.urlsafe_b64encode(sig).rstrip(b'=')

    r = requests.post("https://oauth2.googleapis.com/token", data={
        "grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer",
        "assertion": jwt.decode(),
    }, timeout=15)
    r.raise_for_status()
    return r.json()["access_token"]


def sheets_get(token, range_name):
    """Читає діапазон через Sheets API v4 — повертає list of rows."""
    url = (f"https://sheets.googleapis.com/v4/spreadsheets/{HR_SHEET_ID}"
           f"/values/{requests.utils.quote(range_name)}")
    r = requests.get(url, headers={"Authorization": f"Bearer {token}"}, timeout=20)
    r.raise_for_status()
    return r.json().get("values", [])


def get_sheet_names(token):
    url = (f"https://sheets.googleapis.com/v4/spreadsheets/{HR_SHEET_ID}"
           f"?fields=sheets.properties.title")
    r = requests.get(url, headers={"Authorization": f"Bearer {token}"}, timeout=15)
    r.raise_for_status()
    return [s["properties"]["title"] for s in r.json().get("sheets", [])]


def cell(row, idx, default=""):
    return str(row[idx]).strip() if idx < len(row) else default


# ── Парсери ───────────────────────────────────────────────────────────────────
def parse_employees(rows):
    count = 0
    for row in rows[1:]:
        val = cell(row, 0)
        if not val:
            break
        count += 1
    return count


def parse_interns(rows):
    result, current_month, current_count = [], None, 0
    for row in rows:
        val = cell(row, 0)
        if not val:
            continue
        matched = next((m for m in UA_MONTHS if m.lower() in val.lower()), None)
        if matched:
            if current_month and current_count > 0:
                result.append({"month": current_month, "count": current_count})
            current_month, current_count = matched, 0
            continue
        if "відсів" in val.lower():
            if current_month:
                result.append({"month": current_month, "count": current_count})
            current_month, current_count = None, 0
            continue
        if current_month and len(val) > 2:
            current_count += 1
    if current_month and current_count > 0:
        result.append({"month": current_month, "count": current_count})
    return result


def parse_vacancies(rows):
    """
    Row 0: заголовки (Вакансія, Локація...)
    Row 1: назва місяця (Червень)
    Row 2+: вакансії
    Row з 'Кількість відкритих' — стоп
    """
    vacancies, current_month = [], None
    for row in rows:
        val = cell(row, 0).strip()
        if not val:
            continue
        # Заголовок таблиці
        if val.lower() in ("вакансія",):
            continue
        # Рядок з місяцем
        matched = next((m for m in UA_MONTHS if val == m), None)
        if matched:
            current_month = matched
            continue
        # Стоп-рядок
        if "кількість відкритих" in val.lower():
            break
        # Вакансія
        vacancies.append({
            "vacancy":  val,
            "location": cell(row, 1),
            "qty":      cell(row, 2),
            "reason":   cell(row, 3),
            "urgency":  cell(row, 4),
            "status":   cell(row, 5),
        })
    return {"month": current_month, "vacancies": vacancies}


def parse_closing_norms(rows):
    """
    Row 3: [Назва посади:, Днів]
    Row 4+: [Директор виробництва, 30]
    Дані в колонках B (idx 1) та C (idx 2) — але через merged cells
    іноді в A (idx 0) і B (idx 1)
    """
    norms = []
    header_found = False
    for row in rows:
        val0 = cell(row, 0).strip()
        val1 = cell(row, 1).strip()
        val2 = cell(row, 2).strip()
        
        if "назва посади" in val1.lower():
            header_found = True
            continue
        if not header_found:
            continue
        # Позиція в col B, дні в col C
        pos  = val1 if val1 else val0
        days = val2 if val2 else val1
        if not pos or pos.lower() in ("назва посади:", ""):
            continue
        try:
            norms.append({"position": pos, "days": int(days)})
        except ValueError:
            continue
    return norms


def parse_turnover(rows):
    """
    Структура (рядки 0-indexed):
    Row 2: місяці [Березень, Квітень, Травень, ...]  — кожен займає 2 колонки
    Row 9: [Текучість, %, 0.023, 0.031, 0.068, ...]  — значення через колонку
    Row 11: [Таргет, до 5%]
    """
    result = {"staff": [], "target_staff": None}
    months_row = None
    turnover_row = None
    target_val = None

    for row in rows:
        label = cell(row, 0).lower().strip()
        # Рядок з місяцями
        if any(m.lower() in " ".join(str(c) for c in row).lower() for m in UA_MONTHS):
            if months_row is None and any(m.lower() == str(cell(row, j)).lower()
                                          for j in range(len(row)) for m in UA_MONTHS):
                months_row = row
        # Рядок текучості
        if "текуч" in label and months_row is not None:
            turnover_row = row
        # Таргет
        if "таргет" in label and months_row is not None and target_val is None:
            target_val = cell(row, 1) or cell(row, 2)

    result["target_staff"] = target_val

    if months_row and turnover_row:
        # Місяці: кожен займає 2 колонки (початок/кінець)
        # Текучість: значення стоять у кожній другій колонці (0.023, 0.031...)
        month_cols = []
        for j, c in enumerate(months_row):
            for m in UA_MONTHS:
                if str(c).strip() == m:
                    month_cols.append((j, m))
                    break

        # Значення текучості — є стільки значень скільки місяців
        turnover_vals = []
        for c in turnover_row[1:]:
            v = str(c).strip()
            if v and v != "nan" and v not in ("", "0"):
                try:
                    f = float(v)
                    turnover_vals.append(f)
                except ValueError:
                    pass

        for i, (_, month) in enumerate(month_cols):
            if i < len(turnover_vals):
                pct = round(turnover_vals[i] * 100, 1)
                result["staff"].append({"month": month, "turnover_pct": str(pct)})

    return result


def update_vacancies_history(current):
    history = []
    if VAC_HISTORY.exists():
        try:
            history = json.loads(VAC_HISTORY.read_text(encoding="utf-8"))
        except Exception:
            history = []
    month = current.get("month")
    if not month:
        return history
    today = datetime.utcnow().strftime("%Y-%m-%d")
    existing = {e.get("month") for e in history}
    if month not in existing:
        history.append({"month": month, "fetched_at": today,
                        "vacancies": current.get("vacancies", []),
                        "total": len(current.get("vacancies", []))})
        print(f"[HR] Новий місяць вакансій: {month}")
    else:
        for e in history:
            if e.get("month") == month:
                e.update({"vacancies": current.get("vacancies", []),
                           "total": len(current.get("vacancies", [])),
                           "fetched_at": today})
    VAC_HISTORY.write_text(json.dumps(history, ensure_ascii=False, indent=2), encoding="utf-8")
    return history


def main():
    print(f"[HR] Старт {datetime.utcnow().isoformat()}")

    if not SA_JSON_STR:
        raise ValueError("GOOGLE_SERVICE_ACCOUNT_JSON не встановлено")

    token = get_token()
    print("[HR] ✓ Token отримано")

    sheet_names = get_sheet_names(token)
    print(f"[HR] Листів: {sheet_names}")
    print(f"[HR] Шукаємо: {[SHEET_EMPLOYEES, SHEET_INTERNS, SHEET_VACANCIES, SHEET_CLOSE_NORMS, SHEET_TURNOVER]}")
    for s in [SHEET_INTERNS, SHEET_VACANCIES, SHEET_CLOSE_NORMS, SHEET_TURNOVER]:
        print(f"[HR] '{s}' in sheets: {s in sheet_names}")

    result = {
        "fetched_at": datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
        "employees_count": 0,
        "interns_by_month": [],
        "vacancies_current": {},
        "vacancies_history": [],
        "closing_norms": [],
        "turnover": {},
    }

    # Дебаг: виводимо перші рядки листа Плинність
    if SHEET_TURNOVER in sheet_names:
        debug_rows = sheets_get(token, f"{SHEET_TURNOVER}!A1:Z15")
        print(f"[HR] Плинність debug (перші 12 рядків):")
        for i, r in enumerate(debug_rows[:12]):
            print(f"  Row {i}: {r}")

    PARSERS = [
        (SHEET_EMPLOYEES,   "A:N",  parse_employees,    "employees_count"),
        (SHEET_INTERNS,     "A:A",  parse_interns,      "interns_by_month"),
        (SHEET_VACANCIES,   "A:F",  parse_vacancies,    "vacancies_current"),
        (SHEET_CLOSE_NORMS, "A:C",  parse_closing_norms,"closing_norms"),
        (SHEET_TURNOVER,    "A:Z",  parse_turnover,     "turnover"),
    ]

    for sheet_name, range_col, parser, key in PARSERS:
        if sheet_name not in sheet_names:
            print(f"[HR] ⚠ '{sheet_name}' не знайдено")
            continue
        rows = sheets_get(token, f"{sheet_name}!{range_col}")
        result[key] = parser(rows)
        val = result[key]
        print(f"[HR] ✓ {sheet_name}: {val if isinstance(val, int) else 'ok'}")

    if result["vacancies_current"]:
        result["vacancies_history"] = update_vacancies_history(result["vacancies_current"])

    HR_OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    HR_OUTPUT.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[HR] ✓ Записано {HR_OUTPUT}")


if __name__ == "__main__":
    main()
