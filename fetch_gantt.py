#!/usr/bin/env python3
"""
fetch_gantt.py — Easy 3D Print Dashboard v7.19
Плановий Гант машин (easy3dprint.pp.ua GET /api/gantt): скільки машин зайнято планом і скільки вільно
по локаціях, моделях принтерів, днях і змінах на горизонт ~3 міс. Замінює ручний експорт plan_week.json.

Вихід:
  data/gantt.json          — зріз плану (лише агрегати: без номерів замовлень, кодів/назв деталей, рахунків, ID)
  data/gantt_history.json  — щоденний знімок ключових метрик плану (завантаження 7/30 дн, глибина плану…)

Авторизація: заголовок X-API-Key з рівнем gantt:read. Секрет GANTT_API_KEY, якщо не заданий — CAPACITY_API_KEY.
Якщо ключ не має доступу (401) або API недоступне — попередні дані НЕ затираються, у gantt.json пишеться
status.ok=false з причиною (її видно на дашборді), job не падає.

Репозиторій публічний: у файли потрапляють тільки числа (машини, машино-зміни, кількість замовлень/деталей).
"""

import json, os, subprocess, sys, time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import requests

API_URL = os.environ.get("GANTT_API_URL", "https://easy3dprint.pp.ua/api/gantt")
API_KEY = os.environ.get("GANTT_API_KEY") or os.environ.get("CAPACITY_API_KEY", "")
HORIZON = int(os.environ.get("GANTT_HORIZON_DAYS", "90"))        # API: максимум 92 дні включно
FREE_PCT = 5                                                         # «вільне вікно» = вільно ≥5% робочого парку
ROOT = Path(__file__).parent
OUT = ROOT / "data" / "gantt.json"
HIST = ROOT / "data" / "gantt_history.json"
KYIV = ZoneInfo("Europe/Kyiv")


def now_iso():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def iso(d):            # DD.MM.YYYY → YYYY-MM-DD
    if not d:
        return None
    dd, mm, yy = d.split(".")
    return f"{yy}-{mm}-{dd}"


def mark(m):           # freeFrom / busyUntil → компактно
    if not m:
        return None
    out = {"d": iso(m.get("date")), "s": "D" if m.get("shift") == "FIRST" else "N"}
    if "beyondRange" in m:
        out["beyond"] = bool(m.get("beyondRange"))
    return out


# ── запит ──────────────────────────────────────────────────────────────────────────────────────────
def call_api(params):
    """GET з ретраями. Повертає (json|None, помилка|None)."""
    for attempt in range(4):
        try:
            r = requests.get(API_URL, headers={"X-API-Key": API_KEY, "Accept": "application/json"},
                             params=params, timeout=90)
        except requests.RequestException as e:
            if attempt < 3:
                time.sleep(10 * (attempt + 1)); continue
            return None, f"API недоступне: {e.__class__.__name__}"
        if r.status_code == 200:
            return r.json(), None
        if r.status_code == 401:
            return None, "ключ не має доступу до Ганта (потрібен рівень gantt:read) — додай секрет GANTT_API_KEY або розшир права ключа"
        if r.status_code == 429:
            time.sleep(int(r.headers.get("Retry-After", "60") or 60)); continue
        if r.status_code == 403 and "1010" in r.text:
            # Cloudflare блокує сигнатуру HTTP-клієнта (див. документацію) — той самий запит штатним curl
            return call_curl(params)
        if r.status_code >= 500 and attempt < 3:
            time.sleep(15 * (attempt + 1)); continue
        try:
            msg = r.json().get("error") or r.text[:200]
        except Exception:
            msg = r.text[:200]
        return None, f"HTTP {r.status_code}: {msg}"
    return None, "API не відповіло після кількох спроб"


def call_curl(params):
    from urllib.parse import urlencode
    url = API_URL + "?" + urlencode(params)
    try:
        p = subprocess.run(["curl", "-sS", "--max-time", "90", "-w", "\n%{http_code}", "-H", f"X-API-Key: {API_KEY}", url],
                           capture_output=True, text=True, timeout=120)
        body, _, code = p.stdout.rpartition("\n")
        if code.strip() == "200":
            return json.loads(body), None
        return None, f"HTTP {code.strip()} (curl)"
    except Exception as e:
        return None, f"curl: {e}"


# ── агрегація ──────────────────────────────────────────────────────────────────────────────────────
MKEYS = ("total", "maintenance", "reserved", "effective", "repair", "plannedMaintenance", "testerMachines")


def machines(m):
    m = m or {}
    out = {k: m.get(k) for k in MKEYS}
    out["src"] = m.get("maintenanceSource")
    return out


def add_machines(a, b):
    for k in MKEYS:
        if b.get(k) is None:
            continue
        a[k] = (a.get(k) or 0) + b[k]
    if b.get("src") and a.get("src") != b["src"]:
        a["src"] = b["src"] if not a.get("src") else "MIXED"
    return a


def shift_row(day):
    """[freeD, busyD, availD, freeN, busyN, availN] — null, якщо поле відсутнє."""
    f, s = day.get("first") or {}, day.get("second") or {}
    return [f.get("free"), f.get("busy"), 1 if f.get("available") else 0,
            s.get("free"), s.get("busy"), 1 if s.get("available") else 0]


def sum_rows(a, b):
    if a is None:
        return list(b)
    out = []
    for i, (x, y) in enumerate(zip(a, b)):
        if i in (2, 5):
            out.append(1 if (x or y) else 0)
        else:
            out.append(None if x is None and y is None else (x or 0) + (y or 0))
    return out


def build(payload):
    dates = []
    pools, locs = [], {}
    tot_rows, tot_mach = {}, {}
    orders_day = {}          # (ключ локації | '*') → дата → множина замовлень (лише в пам'яті, у файл — кількість)
    parts_day = {}           # (ключ локації | '*') → дата → [деталей, з обробкою, позицій]

    def acc_orders(key, date, num, parts, proc):
        orders_day.setdefault(key, {}).setdefault(date, set())
        if num:
            orders_day[key][date].add(num)
        p = parts_day.setdefault(key, {}).setdefault(date, [0, 0, 0])
        p[0] += parts; p[1] += parts if proc else 0; p[2] += 1

    for L in payload.get("locations") or []:
        loc = L.get("location") or {}
        num = loc.get("number")
        lkey = str(num) if num is not None else (loc.get("name") or "?")
        pool = {"name": loc.get("name"), "num": num, "machines": machines(L.get("machines")),
                "freeFrom": mark(L.get("freeFrom")), "busyUntil": mark(L.get("busyUntil")), "models": []}
        prow = {}
        for d in L.get("days") or []:
            di = iso(d.get("date")); prow[di] = shift_row(d)
            if di not in dates:
                dates.append(di)
        pool["_rows"] = prow
        for M in L.get("printerModels") or []:
            mrow, mord = {}, {}
            for d in M.get("days") or []:
                di = iso(d.get("date")); mrow[di] = shift_row(d)
                seen, parts, proc, npos = set(), 0, 0, 0
                for sh in ("first", "second"):
                    for p in (d.get(sh) or {}).get("positions") or []:
                        o = (p.get("orderNumber") or "").strip()
                        if o:
                            seen.add(o)
                        pp = int(p.get("plannedParts") or 0)
                        parts += pp; npos += 1
                        if p.get("requiresProcessing"):
                            proc += pp
                        acc_orders(lkey, di, o, pp, p.get("requiresProcessing"))
                        acc_orders("*", di, o, pp, p.get("requiresProcessing"))
                mord[di] = [len(seen), parts, proc, npos]
            pool["models"].append({"model": M.get("printerModel"), "machines": machines(M.get("machines")),
                                   "freeFrom": mark(M.get("freeFrom")), "busyUntil": mark(M.get("busyUntil")),
                                   "_rows": mrow, "_ord": mord})
        pools.append(pool)
        # локація (кілька пулів з тим самим номером зводимо: модель — окремий пул)
        lo = locs.setdefault(lkey, {"name": f"Локація {num}" if num is not None else loc.get("name"), "num": num,
                                    "machines": {}, "_rows": {}, "pools": 0, "models": []})
        lo["pools"] += 1
        add_machines(lo["machines"], pool["machines"])
        for m in pool["models"]:
            lo["models"].append(m["model"])
        for di, r in prow.items():
            lo["_rows"][di] = sum_rows(lo["_rows"].get(di), r)
            tot_rows[di] = sum_rows(tot_rows.get(di), r)
        add_machines(tot_mach, pool["machines"])

    dates.sort()

    def rows(rmap):
        return [rmap.get(d) for d in dates]

    def ords(key):
        od, pd = orders_day.get(key, {}), parts_day.get(key, {})
        return [[len(od.get(d, ())), *(pd.get(d) or [0, 0, 0])] for d in dates]

    def uniq(key, n):        # унікальні замовлення за перші n днів горизонту
        od = orders_day.get(key, {})
        s = set()
        for d in dates[:n]:
            s |= od.get(d, set())
        return len(s)

    out_pools = []
    for p in pools:
        out_pools.append({"name": p["name"], "num": p["num"], "machines": p["machines"],
                          "freeFrom": p["freeFrom"], "busyUntil": p["busyUntil"], "d": rows(p["_rows"]),
                          "models": [{"model": m["model"], "machines": m["machines"], "freeFrom": m["freeFrom"],
                                      "busyUntil": m["busyUntil"], "d": rows(m["_rows"]),
                                      "o": [m["_ord"].get(d) for d in dates]} for m in p["models"]]})
    out_locs = []
    for k, lo in sorted(locs.items(), key=lambda kv: (kv[1]["num"] is None, kv[1]["num"] or 0, kv[0])):
        out_locs.append({"key": k, "name": lo["name"], "num": lo["num"], "pools": lo["pools"], "models": sorted(set(filter(None, lo["models"]))),
                         "machines": lo["machines"], "d": rows(lo["_rows"]), "o": ords(k),
                         "orders": {str(n): uniq(k, n) for n in (7, 14, 30, len(dates))}})
    return dates, out_pools, out_locs, {"machines": tot_mach, "d": rows(tot_rows), "o": ords("*"),
                                        "orders": {str(n): uniq("*", n) for n in (7, 14, 30, len(dates))}}


# ── метрики для історії ────────────────────────────────────────────────────────────────────────────
def load_pct(rows, n):
    b = e = 0
    for r in rows[:n]:
        if not r:
            continue
        for fi, bi, ai in ((0, 1, 2), (3, 4, 5)):
            if r[ai] and r[fi] is not None and r[bi] is not None:
                b += r[bi]; e += r[fi] + r[bi]
    return round(b / e * 100, 1) if e else None


def free_window(rows, dates, eff):
    """Перша доступна зміна, де вільно ≥ FREE_PCT% робочого парку → (дата, 'D'|'N', днів від сьогодні)."""
    thr = max(1, (eff or 0) * FREE_PCT / 100)
    for i, r in enumerate(rows):
        if not r:
            continue
        for fi, ai, s in ((0, 2, "D"), (3, 5, "N")):
            if r[ai] and (r[fi] or 0) >= thr:
                return {"d": dates[i], "s": s, "days": i}
    return None


def snapshot(dates, locs, tot):
    def one(x):
        eff = (x["machines"] or {}).get("effective")
        fw = free_window(x["d"], dates, eff)
        return {"eff": eff, "total": (x["machines"] or {}).get("total"), "maint": (x["machines"] or {}).get("maintenance"),
                "load7": load_pct(x["d"], 7), "load30": load_pct(x["d"], 30),
                "free7": sum(((r[0] or 0) if r and r[2] else 0) + ((r[3] or 0) if r and r[5] else 0) for r in x["d"][:7]),
                "window": fw["days"] if fw else None, "orders7": x["orders"]["7"]}
    return {"tot": one(tot), "locs": {l["key"]: one(l) for l in locs}}


def main():
    print(f"[Gantt] Старт {now_iso()}")
    prev = None
    if OUT.exists():
        try:
            prev = json.loads(OUT.read_text(encoding="utf-8"))
        except Exception:
            prev = None

    def soft_fail(msg):
        print(f"[Gantt] ⚠ {msg}")
        base = prev or {"locations": [], "pools": [], "dates": []}
        base["status"] = {"ok": False, "at": now_iso(), "msg": msg}
        OUT.parent.mkdir(parents=True, exist_ok=True)
        OUT.write_text(json.dumps(base, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        sys.exit(0)

    if not API_KEY:
        soft_fail("ключ API не задано (секрет GANTT_API_KEY або CAPACITY_API_KEY)")

    today = datetime.now(KYIV).date()
    params = {"from": today.strftime("%d.%m.%Y"), "to": (today + timedelta(days=HORIZON)).strftime("%d.%m.%Y"),
              "mode": "both", "detail": "positions"}
    payload, err = call_api(params)
    if err and "gantt:read" not in err:
        # позиції плану на ~90 днів — найважчий запит; без них числа парку/зайнятості ті самі, лише без к-сті замовлень
        print(f"[Gantt] ⚠ {err} — повтор без detail=positions")
        params.pop("detail", None)
        payload, err = call_api(params)
    if err:
        soft_fail(err)

    dates, pools, locs, tot = build(payload)
    q = payload.get("query") or {}
    res = {
        "fetched_at": now_iso(),
        "status": {"ok": True, "at": now_iso(), "msg": None},
        "schemaVersion": payload.get("schemaVersion"),
        "generatedAt": payload.get("generatedAt"),
        "today": iso(payload.get("today")),
        "todayShift": payload.get("todayShift"),
        "from": iso(q.get("from")), "to": iso(q.get("to")),
        "warnings": payload.get("warnings") or [],
        "freePct": FREE_PCT,
        "fields": "d[i] = [вільно день, зайнято день, день доступна(1/0), вільно ніч, зайнято ніч, ніч доступна] у машинах; "
                  "o[i] = [замовлень, деталей, деталей з обробкою, позицій плану] за добу; machines — парк (total/maintenance/"
                  "reserved/effective/repair/plannedMaintenance/testerMachines, src = джерело ремонту)",
        "dates": dates,
        "total": tot,
        "locations": locs,
        "pools": pools,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(res, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"[Gantt] ✓ {len(locs)} локацій, {len(pools)} пулів, {len(dates)} днів ({res['from']} – {res['to']}); "
          f"попереджень: {len(res['warnings'])}; {OUT.stat().st_size // 1024} КБ")

    # ── історія: один знімок на добу (останній за день перезаписує) ──
    hist = {"days": []}
    if HIST.exists():
        try:
            hist = json.loads(HIST.read_text(encoding="utf-8"))
        except Exception:
            hist = {"days": []}
    snap = snapshot(dates, locs, tot)
    snap["date"] = res["today"] or today.isoformat()
    hist["days"] = [d for d in hist.get("days", []) if d.get("date") != snap["date"]] + [snap]
    hist["days"].sort(key=lambda d: d["date"])
    hist["updated_at"] = now_iso()
    HIST.write_text(json.dumps(hist, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"[Gantt] ✓ історія: {len(hist['days'])} днів")


if __name__ == "__main__":
    main()
