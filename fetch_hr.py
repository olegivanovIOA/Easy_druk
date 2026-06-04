#!/usr/bin/env python3
"""
fetch_hr.py — Easy 3D Print Dashboard
Читає HR-дані через Google Service Account (без публічного доступу).
Пише data/hr.json + накопичує data/hr_vacancies_history.json

Service Account: easy3d-dashboard@ts-alpha.iam.gserviceaccount.com
HR Sheet ID: 130USLfSJhymjNihdE0cZiZHVtdXKVg6uuhNkuNDE1nA
"""

import csv, io, json, os, re
from datetime import datetime
from pathlib import Path

import requests

HR_SHEET_ID = os.environ.get("HR_SHEET_ID", "130USLfSJhymjNihdE0cZiZHVtdXKVg6uuhNkuNDE1nA")
SA_JSON_STR  = os.environ.get("GOOGLE_SERVICE_ACCOUNT_JSON", "")

HR_OUTPUT   = Path(__file__).parent / "data" / "hr.json"
VAC_HISTORY = Path(__file__).parent / "data" / "hr_vacancies_history.json"

# ── Назви листів (точні, з пробілами) ────────────────────────────────────────
SHEET_EMPLOYEES   = "Співробітники"
SHEET_INTERNS     = "Стажери"
SHEET_VACANCIES   = "Відкриті вакансії"
SHEET_CLOSE_NORMS = "Час закриття вакансій"
SHEET_TURNOVER    = "Плинність кадрів "   # пробіл наприкінці

UA_MONTHS = {
    "Січень":"01","Лютий":"02","Березень":"03","Квітень":"04",
    "Травень":"05","Червень":"06","Липень":"07","Серпень":"08",
    "Вересень":"09","Жовтень":"10","Листопад":"11","Грудень":"12"
}

# ── Service Account Auth ──────────────────────────────────────────────────────
def get_access_token():
    """Отримує OAuth2 access token через Service Account JWT."""
    import time, base64, hashlib, hmac
    from urllib.parse import urlencode

    if not SA_JSON_STR:
        raise ValueError("GOOGLE_SERVICE_ACCOUNT_JSON secret не встановлено")

    sa = json.loads(SA_JSON_STR)

    # Будуємо JWT
    now = int(time.time())
    header = base64.urlsafe_b64encode(json.dumps({"alg":"RS256","typ":"JWT"}).encode()).rstrip(b'=')
    payload = base64.urlsafe_b64encode(json.dumps({
        "iss": sa["client_email"],
        "scope": "https://www.googleapis.com/auth/spreadsheets.readonly",
        "aud": "https://oauth2.googleapis.com/token",
        "exp": now + 3600,
        "iat": now,
    }).encode()).rstrip(b'=')

    # Підписуємо RSA-SHA256
    try:
        from cryptography.hazmat.primitives import hashes, serialization
        from cryptography.hazmat.primitives.asymmetric import padding
        from cryptography.hazmat.backends import default_backend

        private_key = serialization.load_pem_private_key(
            sa["private_key"].encode(), password=None, backend=default_backend()
        )
        signing_input = header + b'.' + payload
        signature = private_key.sign(signing_input, padding.PKCS1v15(), hashes.SHA256())
        signed_jwt = signing_input + b'.' + base64.urlsafe_b64encode(signature).rstrip(b'=')
    except ImportError:
        # Fallback: використовуємо subprocess з openssl
        import subprocess, tempfile
        key_file = tempfile.NamedTemporaryFile(delete=False, suffix='.pem', mode='w')
        key_file.write(sa["private_key"])
        key_file.close()

        signing_input = header + b'.' + payload
        result = subprocess.run(
            ['openssl', 'dgst', '-sha256', '-sign', key_file.name],
            input=signing_input, capture_output=True
        )
        os.unlink(key_file.name)
        signature = result.stdout
        signed_jwt = signing_input + b'.' + base64.urlsafe_b64encode(signature).rstrip(b'=')

    # Обмінюємо JWT на access token
    r = requests.post("https://oauth2.googleapis.com/token", data={
        "grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer",
        "assertion": signed_jwt.decode(),
    }, timeout=15)
    r.raise_for_status()
    return r.json()["access_token"]


def get_sheet_list(token):
    url = f"https://sheets.googleapis.com/v4/spreadsheets/{HR_SHEET_ID}?fields=sheets.properties(sheetId,title)"
    r = requests.get(url, headers={"Authorization": f"Bearer {token}"}, timeout=15)
    r.raise_for_status()
    return {s["properties"]["title"]: str(s["properties"]["sheetId"])
            for s in r.json().get("sheets", [])}


def fetch_csv(gid, token):
    url = f"https://docs.google.com/spreadsheets/d/{HR_SHEET_ID}/export?format=csv&gid={gid}"
    r = requests.get(url, headers={"Authorization": f"Bearer {token}"}, timeout=20)
    r.raise_for_status()
    return list(csv.reader(io.StringIO(r.content.decode("utf-8-sig"))))


def cell(row, idx, default=""):
    return row[idx].strip() if idx < len(row) else default


# ── Парсери (без змін від попередньої версії) ─────────────────────────────────
def parse_employees(rows):
    count = 0
    for row in rows[1:]:
        val = cell(row, 0)
        if not val or val.lower().strip() in ("", " "):
            break
        count += 1
    return count


def parse_interns(rows):
    result = []
    current_month = None
    current_count = 0
    for row in rows:
        val = cell(row, 0)
        if not val:
            continue
        matched_month = next((m for m in UA_MONTHS if m.lower() in val.lower()), None)
        if matched_month:
            if current_month and current_count > 0:
                result.append({"month": current_month, "count": current_count})
            current_month = matched_month
            current_count = 0
            continue
        if "відсів" in val.lower():
            if current_month:
                result.append({"month": current_month, "count": current_count})
            current_month = None
            current_count = 0
            continue
        if current_month and len(val) > 2:
            current_count += 1
    if current_month and current_count > 0:
        result.append({"month": current_month, "count": current_count})
    return result


def parse_vacancies(rows):
    vacancies = []
    current_month = None
    for row in rows:
        if not any(cell(row, i) for i in range(6)):
            continue
        val = cell(row, 0)
        matched_month = next((m for m in UA_MONTHS if m.lower() in val.lower() and len(val) < 20), None)
        if matched_month:
            current_month = matched_month
            continue
        if val.lower() in ("вакансія", ""):
            continue
        name = val
        if name and name.lower() != "вакансія":
            vacancies.append({
                "vacancy":  name,
                "location": cell(row, 1),
                "qty":      cell(row, 2),
                "reason":   cell(row, 3),
                "urgency":  cell(row, 4),
                "status":   cell(row, 5),
            })
    return {"month": current_month, "vacancies": vacancies}


def parse_closing_norms(rows):
    norms = []
    for row in rows:
        position = cell(row, 1)
        days = cell(row, 2)
        if not position or not days:
            continue
        try:
            norms.append({"position": position, "days": int(days)})
        except ValueError:
            continue
    return norms


def parse_turnover(rows):
    result = {"staff": [], "target_staff": None}
    months_row = []
    turnover_row = None
    target_val = None

    for row in rows:
        label = cell(row, 0).lower()
        if not months_row:
            for c in row:
                if any(m.lower() in c.lower() for m in UA_MONTHS):
                    months_row = row
                    break
        if "текучість" in label and "%" in cell(row, 0):
            turnover_row = row
        if "таргет" in label:
            t = next((cell(row, j) for j in range(1, 10) if cell(row, j)), None)
            if t:
                target_val = t

    result["target_staff"] = target_val

    if months_row and turnover_row:
        for j, c in enumerate(months_row):
            for m in UA_MONTHS:
                if m.lower() in c.lower():
                    val = cell(turnover_row, j) if j < len(turnover_row) else ""
                    if val:
                        result["staff"].append({
                            "month": m,
                            "turnover_pct": val.replace("%","").replace(",",".").strip()
                        })
                    break
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

    existing = {e.get("month") for e in history}
    today = datetime.utcnow().strftime("%Y-%m-%d")

    if month not in existing:
        history.append({
            "month": month,
            "fetched_at": today,
            "vacancies": current.get("vacancies", []),
            "total": len(current.get("vacancies", [])),
        })
        print(f"[HR] Новий місяць: {month}")
    else:
        for entry in history:
            if entry.get("month") == month:
                entry["vacancies"] = current.get("vacancies", [])
                entry["total"] = len(current.get("vacancies", []))
                entry["fetched_at"] = today

    VAC_HISTORY.write_text(json.dumps(history, ensure_ascii=False, indent=2), encoding="utf-8")
    return history


# ── MAIN ─────────────────────────────────────────────────────────────────────
def main():
    print(f"[HR] Старт {datetime.utcnow().isoformat()}")

    # Встановлюємо залежність якщо потрібно
    os.system("pip install cryptography --quiet --break-system-packages")

    token = get_access_token()
    print("[HR] ✓ Access token отримано")

    sheets = get_sheet_list(token)
    print(f"[HR] Листів: {list(sheets.keys())}")

    result = {
        "fetched_at": datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
        "employees_count": 0,
        "interns_by_month": [],
        "vacancies_current": {},
        "vacancies_history": [],
        "closing_norms": [],
        "turnover": {},
    }

    for sheet_name, parser, key in [
        (SHEET_EMPLOYEES,   parse_employees,    "employees_count"),
        (SHEET_INTERNS,     parse_interns,      "interns_by_month"),
        (SHEET_VACANCIES,   parse_vacancies,    "vacancies_current"),
        (SHEET_CLOSE_NORMS, parse_closing_norms,"closing_norms"),
        (SHEET_TURNOVER,    parse_turnover,     "turnover"),
    ]:
        if sheet_name in sheets:
            rows = fetch_csv(sheets[sheet_name], token)
            result[key] = parser(rows)
            print(f"[HR] ✓ {sheet_name}: {result[key] if isinstance(result[key], int) else 'ok'}")
        else:
            print(f"[HR] ⚠ '{sheet_name}' не знайдено")

    # Накопичення history вакансій
    if result["vacancies_current"]:
        result["vacancies_history"] = update_vacancies_history(result["vacancies_current"])

    HR_OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    HR_OUTPUT.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[HR] ✓ Записано {HR_OUTPUT}")


if __name__ == "__main__":
    main()
