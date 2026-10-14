#!/usr/bin/env python3
"""
fetch_shopfloor.py — Easy 3D Print Dashboard v6.0
Журнал причин браку + зміни персоналу (оператори / ІТО / ОТК) → data/shopfloor.json

Джерело: easy3dprint.pp.ua (той самий ключ X-API-Key, що й /api/capacity та /api/batches — секрет CAPACITY_API_KEY)
  GET /api/defects        — класифікований брак (QC / PROCESS): тип, к-сть, кг, локація, артикул, дата+зміна виготовлення
  GET /api/shift-workers  — зміни, години, виконання/брак змін, ремонти/ТО (TECH), перевірки ОТК (QC)

ПРИВАТНІСТЬ (вимога власника):
  • employeeId, посади та будь-які ідентифікатори людей НЕ зберігаються — лише агрегати
    (локація × зміна × категорія × день/місяць);
  • у групах, де менше MIN_GROUP людей, персональні лічильники (години, ремонти, перевірки ОТК)
    приховуються (null + hidden=true), щоб агрегат не дорівнював показнику однієї людини.
    У підсумки по компанії ці люди входять;
  • розподіл операторів за виконанням плану — лише кількість людей у діапазонах і лише якщо
    в групі ≥ MIN_DIST людей.

Правила інтерпретації з документації API:
  • null ≠ 0 (null — невідомо), сумуємо quantity, а не рядки; один документ може дати кілька рядків;
  • для виробничого аналізу браку — producedAt (дата+зміна виготовлення), не registeredAt;
  • coverage.ratio — покриття класифікацією, НЕ % браку;
  • % браку змін (кг до плану) і % браку партій (деталі) мають різні бази — не порівнювати напряму;
  • локація співробітника — поточна з табеля.

Інкрементально: щоразу перераховує поточний і попередній місяць; відсутні в файлі місяці
(з START) догружає автоматично — перший запуск = бекфіл з січня.
"""

import json, os, re, sys, time
from collections import defaultdict
from datetime import date, datetime, timedelta
from calendar import monthrange
from pathlib import Path

import requests

BASE = os.environ.get("SHOPFLOOR_API_BASE", "https://easy3dprint.pp.ua").rstrip("/")
API_KEY = os.environ.get("CAPACITY_API_KEY", "")
START = os.environ.get("SHOPFLOOR_START", "2026-01-01")
OUT = Path(__file__).parent / "data" / "shopfloor.json"
MIN_GROUP = 2          # мін. людей у групі для персональних лічильників
MIN_DIST = 3           # мін. людей для розподілу за виконанням
DIST_BUCKETS = [(None, 80, "<80%"), (80, 90, "80–90%"), (90, 100, "90–100%"), (100, 110, "100–110%"), (110, None, "≥110%")]
SESSION = requests.Session()


# ───────────────────────── HTTP ─────────────────────────
def get(path, params):
    url = BASE + path
    for attempt in range(6):
        r = SESSION.get(url, params=params, headers={"X-API-Key": API_KEY}, timeout=90)
        if r.status_code == 429:
            wait = int(r.headers.get("Retry-After", "10") or 10)
            print(f"[SF] 429 на {path} — чекаю {wait} с")
            time.sleep(min(wait, 120))
            continue
        if r.status_code == 401:
            raise SystemExit(f"::error::{path}: 401 — ключ CAPACITY_API_KEY не підходить для цього API (потрібен окремий ключ?)")
        if r.status_code >= 500 and attempt < 5:
            time.sleep(5 * (attempt + 1))
            continue
        if r.status_code != 200:
            raise RuntimeError(f"{path} {r.status_code}: {r.text[:300]}")
        return r.json()
    raise RuntimeError(f"{path}: вичерпано спроби (429/5xx)")


def num(v):
    if v is None:
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def loc_key(v):
    """Локація → короткий ключ '5'. Приймає число, '5', 'Локація 5', {'name': 'Локація 5'}."""
    if isinstance(v, dict):
        v = v.get("name") or v.get("number") or v.get("id")
    if v is None:
        return "?"
    s = str(v)
    m = re.search(r"\d+", s)
    return m.group(0) if m and len(m.group(0)) <= 4 else s[:24]


def shift_key(v):
    s = (v or "").upper()
    return "D" if s in ("FIRST", "DAY", "1") else "N" if s in ("SECOND", "NIGHT", "2") else "?"


def month_range(ym):
    y, m = int(ym[:4]), int(ym[5:7])
    a = date(y, m, 1)
    b = date(y, m, monthrange(y, m)[1])
    return a, min(b, date.today())


def months_between(a, b):
    out, y, m = [], a.year, a.month
    while (y, m) <= (b.year, b.month):
        out.append(f"{y:04d}-{m:02d}")
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    return out


# ───────────────────────── Брак ─────────────────────────
def fetch_defects(a, b):
    rows, cursor, coverage, seen, pages = [], None, None, set(), 0
    while True:
        p = {"from": a.isoformat(), "to": b.isoformat(), "limit": 2000}
        if cursor:
            p["cursor"] = cursor
        js = get("/api/defects", p)
        pages += 1
        if coverage is None:
            coverage = js.get("coverage")
        for d in js.get("defects") or []:
            key = (d.get("id"), (d.get("defectType") or {}).get("code"), tuple(d.get("batchNumbers") or []))
            if key in seen:      # захист від дублю на межі сторінок/вікон
                continue
            seen.add(key)
            rows.append(d)
        cursor = js.get("nextCursor")
        if not cursor:
            break
        time.sleep(0.4)
    return rows, coverage, pages


def agg_defects(rows):
    types, agg, prod, lag = {}, defaultdict(lambda: [0.0, 0.0, 0.0]), defaultdict(lambda: [0.0, 0.0]), defaultdict(float)
    for d in rows:
        t = d.get("defectType") or {}
        code = t.get("code") or "UNKNOWN"
        if t.get("name"):
            types[code] = t["name"]
        q = num(d.get("quantity")) or 0.0
        kg = num(d.get("estimatedWeightKg"))
        pa = d.get("producedAt") or {}
        day = (pa.get("date") or (d.get("registeredAt") or "")[:10])[:10]
        st = "Q" if (d.get("stage") or "").upper() == "QC" else "P" if (d.get("stage") or "").upper() == "PROCESS" else "?"
        k = (day, shift_key(pa.get("shift")), loc_key(d.get("location")), st, code)
        a = agg[k]
        a[0] += q
        if kg is not None:
            a[1] += kg
            a[2] += q
        pc = (d.get("productCode") or "—")
        pp = prod[(pc, code)]
        pp[0] += q
        if kg is not None:
            pp[1] += kg
        # затримка виявлення: registeredAt − producedAt (дні), зважено на кількість
        try:
            reg = datetime.fromisoformat((d.get("registeredAt") or "").replace("Z", "+00:00")).date()
            pr = date.fromisoformat(pa.get("date"))
            dd = (reg - pr).days
            b = "0" if dd <= 0 else "1" if dd == 1 else "2" if dd == 2 else "3–6" if dd <= 6 else "7+"
            lag[b] += q
        except Exception:
            pass
    rows_out = [[k[0], k[1], k[2], k[3], k[4], round(v[0], 2), round(v[1], 3) if v[2] else None, round(v[2], 2)]
                for k, v in sorted(agg.items())]
    # артикули: топ-80 за кількістю
    ptot = defaultdict(float)
    for (pc, _), v in prod.items():
        ptot[pc] += v[0]
    top = set(sorted(ptot, key=lambda x: -ptot[x])[:80])
    prod_out = [[pc, code, round(v[0], 2), round(v[1], 3)] for (pc, code), v in prod.items() if pc in top]
    return types, rows_out, sorted(prod_out, key=lambda x: -x[2]), {k: round(v, 2) for k, v in lag.items()}


# ───────────────────────── Персонал ─────────────────────────
def fetch_workers(a, b, group_by):
    out, cursor, cov = [], None, None
    while True:
        p = {"from": a.isoformat(), "to": b.isoformat(), "groupBy": group_by, "identity": "id"}
        if cursor:
            p["cursor"] = cursor
        js = get("/api/shift-workers", p)
        if cov is None:
            cov = js.get("coverage")
        out.extend(js.get("workers") or [])
        cursor = js.get("nextCursor")
        if not cursor:
            break
        time.sleep(0.4)
    return out, cov


class WAvg:
    """Зважене середнє, що ігнорує null."""
    def __init__(self):
        self.s = 0.0
        self.w = 0.0

    def add(self, v, w):
        v = num(v)
        w = num(w) or 0.0
        if v is None or w <= 0:
            return
        self.s += v * w
        self.w += w

    def get(self):
        return round(self.s / self.w, 2) if self.w else None


def agg_operator_days(workers):
    """groupBy=day → оператори по (дата, зміна, локація). Лише показники РЕЗУЛЬТАТУ ЗМІНИ
    (виконання/брак — однакові для всієї зміни) і к-сть людей. Години не зберігаємо."""
    g = defaultdict(lambda: {"n": 0, "c": WAvg(), "p": WAvg(), "d": WAvg(), "q": WAvg(), "m": 0, "v": 0})
    for w in workers:
        if (w.get("category") or "").upper() != "OPERATOR":
            continue
        k = (str(w.get("period") or "")[:10], shift_key(w.get("shift")), loc_key(w.get("location")))
        a = g[k]
        sh = w.get("shifts") or {}
        hrs = num(w.get("hours")) or 0
        a["n"] += 1
        a["c"].add(w.get("completionPercent"), hrs)
        a["p"].add(w.get("preQcCompletionPercent"), hrs)
        a["d"].add(w.get("defectPercent"), hrs)
        a["q"].add(w.get("qcCoveragePercent"), hrs)
        a["m"] += int(num(sh.get("matched")) or 0)
        a["v"] += int(num(sh.get("verified")) or 0)
    # [date, shift, loc, people, completion%, preQc%, defect%, qcCoverage%, matched, verified]
    return [[k[0], k[1], k[2], a["n"], a["c"].get(), a["p"].get(), a["d"].get(), a["q"].get(), a["m"], a["v"]]
            for k, a in sorted(g.items())]


def bucket(v):
    for lo, hi, lbl in DIST_BUCKETS:
        if (lo is None or v >= lo) and (hi is None or v < hi):
            return lbl
    return None


def agg_month(workers):
    """groupBy=month → (локація × категорія) + підсумок компанії по категорії."""
    def new():
        return {"people": 0, "hours": 0.0, "shifts": 0, "day": 0, "night": 0, "matched": 0, "verified": 0,
                "c": WAvg(), "p": WAvg(), "d": WAvg(), "q": WAvg(),
                "dist": defaultdict(int), "distN": 0,
                "mt": defaultdict(float), "mtSeen": False, "mtLoc": {}, "rv": defaultdict(float), "rvKg": False, "rvSeen": False,
                "rvFoundKnown": False}
    groups = defaultdict(new)
    for w in workers:
        cat = (w.get("category") or "?").upper()
        for key in ((loc_key(w.get("location")), cat), ("ALL", cat)):
            a = groups[key]
            sh = w.get("shifts") or {}
            hrs = num(w.get("hours")) or 0.0
            a["people"] += 1
            a["hours"] += hrs
            a["shifts"] += int(num(sh.get("total")) or 0)
            a["day"] += int(num(sh.get("day")) or 0)
            a["night"] += int(num(sh.get("night")) or 0)
            a["matched"] += int(num(sh.get("matched")) or 0)
            a["verified"] += int(num(sh.get("verified")) or 0)
            a["c"].add(w.get("completionPercent"), hrs)
            a["p"].add(w.get("preQcCompletionPercent"), hrs)
            a["d"].add(w.get("defectPercent"), hrs)
            a["q"].add(w.get("qcCoveragePercent"), hrs)
            cp = num(w.get("completionPercent"))
            if cat == "OPERATOR" and cp is not None:
                a["dist"][bucket(cp)] += 1
                a["distN"] += 1
            mt = w.get("maintenance")
            if isinstance(mt, dict):
                a["mtSeen"] = True
                for f in ("machinesDone", "repairsDone", "plannedDone", "notNeeded", "inWork"):
                    v = num(mt.get(f))
                    if v is not None:
                        a["mt"][f] += v
                for f in ("locationPlannedPercent", "locationUnplannedQueue", "locationRepeatWithin6h"):
                    v = num(mt.get(f))
                    if v is not None and key[0] != "ALL":
                        a["mtLoc"][f] = v   # рівень локації — однаковий для всіх техніків локації
            rv = w.get("review")
            if isinstance(rv, dict):
                a["rvSeen"] = True
                for f in ("batches", "finalizedBatches", "reviewedQty", "defectFoundQty"):
                    v = num(rv.get(f))
                    if v is not None:
                        a["rv"][f] += v
                for f in ("reviewedKg", "defectFoundKg"):
                    v = num(rv.get(f))
                    if v is not None:
                        a["rv"][f] += v
                        a["rvKg"] = True
                if num(rv.get("defectFoundQty")) is not None:
                    a["rvFoundKnown"] = True

    out = []
    # локаційні рівні показники ТО для підсумку компанії: середнє/сума по локаціях
    for (loc, cat), a in sorted(groups.items()):
        hide = loc != "ALL" and a["people"] < MIN_GROUP
        r = {"loc": loc, "cat": cat, "people": a["people"],
             "hours": None if hide else round(a["hours"], 1),
             "shifts": a["shifts"], "shiftsDay": a["day"], "shiftsNight": a["night"],
             "matched": a["matched"], "verified": a["verified"],
             "completion": a["c"].get(), "preQc": a["p"].get(), "defectPct": a["d"].get(), "qcCoverage": a["q"].get()}
        if hide:
            r["hidden"] = True
        if cat == "OPERATOR":
            r["dist"] = ({lbl: a["dist"].get(lbl, 0) for _, _, lbl in DIST_BUCKETS}
                         if a["distN"] >= MIN_DIST else None)
        if cat == "TECH":
            m = {k: (None if hide else round(v, 1)) for k, v in a["mt"].items()} if a["mtSeen"] else None
            r["maintenance"] = m
            r["locLevel"] = a["mtLoc"] or None
        if cat == "QC":
            if a["rvSeen"] and not hide:
                rv = {k: round(v, 2) for k, v in a["rv"].items()}
                if not a["rvKg"]:
                    rv["reviewedKg"] = rv["defectFoundKg"] = None
                if not a["rvFoundKnown"]:
                    rv["defectFoundQty"] = None
                rv["defectFoundPercent"] = (round(rv["defectFoundQty"] / rv["reviewedQty"] * 100, 2)
                                            if rv.get("defectFoundQty") is not None and rv.get("reviewedQty") else None)
                r["review"] = rv
            else:
                r["review"] = None
        out.append(r)
    return out


# ───────────────────────── main ─────────────────────────
def build_month(ym):
    a, b = month_range(ym)
    t0 = time.time()
    rows, cov, pages = fetch_defects(a, b)
    types, drows, prods, lag = agg_defects(rows)
    print(f"[SF] {ym} брак: {len(rows)} записів ({pages} стор.) → {len(drows)} агрегатів; покриття {cov}")
    wd, cov_d = fetch_workers(a, b, "day")
    wm, cov_m = fetch_workers(a, b, "month")
    cats = defaultdict(int)
    for w in wm:
        cats[(w.get("category") or "?").upper()] += 1
    print(f"[SF] {ym} персонал: {len(wd)} рядків day, {len(wm)} рядків month {dict(cats)} · {time.time() - t0:.0f} с")
    return types, {
        "month": ym, "from": a.isoformat(), "to": b.isoformat(),
        "complete": b == date(a.year, a.month, monthrange(a.year, a.month)[1]) and b < date.today(),
        "defects": {"coverage": cov, "rows": drows, "products": prods, "lag": lag},
        "operatorDays": agg_operator_days(wd),
        "staff": agg_month(wm),
        "staffCoverage": cov_m or cov_d,
    }


def main():
    if not API_KEY:
        print("::error::CAPACITY_API_KEY не встановлено")
        return 1
    data = {"months": {}, "types": {}}
    if OUT.exists():
        try:
            data = json.loads(OUT.read_text(encoding="utf-8"))
        except Exception:
            pass
    data.setdefault("months", {})
    data.setdefault("types", {})
    today = date.today()
    allm = months_between(date.fromisoformat(START), today)
    cur = allm[-1]
    prev = allm[-2] if len(allm) > 1 else None
    todo = [m for m in allm if m not in data["months"] or m in (cur, prev) or not data["months"][m].get("complete")]
    if os.environ.get("FORCE", "").strip() in ("1", "true", "yes"):
        todo = allm
    print(f"[SF] Місяці до оновлення: {todo}")
    ok = 0
    for ym in todo:
        try:
            types, m = build_month(ym)
            data["types"].update(types)
            data["months"][ym] = m
            ok += 1
        except SystemExit:
            raise
        except Exception as e:
            print(f"[SF] ⚠ {ym}: {e}")
        time.sleep(1)
    if not ok:
        print("::error::Жоден місяць не оновлено")
        return 1
    data["fetched_at"] = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
    data["from"] = START
    data["privacy"] = (f"лише агрегати без ID співробітників; персональні лічильники приховано в групах < {MIN_GROUP} людей; "
                       f"розподіл — від {MIN_DIST} людей")
    data["months"] = dict(sorted(data["months"].items()))
    # фінальна перевірка: жодних ідентифікаторів людей у файлі
    blob = json.dumps(data, ensure_ascii=False)
    if "employeeId" in blob or "example-" in blob:
        print("::error::У файлі знайдено ідентифікатор співробітника — запис скасовано")
        return 1
    OUT.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"[SF] ✓ {OUT} ({OUT.stat().st_size // 1024} КБ), місяців: {len(data['months'])}, типів браку: {len(data['types'])}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
