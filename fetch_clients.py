#!/usr/bin/env python3
"""
fetch_clients.py — Easy 3D Print Dashboard v6.4
Аналіз клієнтів з Bitrix24 (усі WON-угоди воронок продажів 24 ОПТ, 18/32 Роздріб за весь час) → data/clients.json

Метрики: LTV (середня/медіанна виручка на клієнта за весь час, тривалість життя, частота покупок, когорти),
RFM-сегменти, відтік клієнтів (B2B і всі) по місяцях + клієнти «під ризиком», концентрація,
галузі (якщо в картці компанії заповнене поле індустрії/сфери — визначається автоматично,
або явно через змінну CLIENT_INDUSTRY_FIELD, напр. INDUSTRY чи UF_CRM_…).

ПРИВАТНІСТЬ: ID/назви компаній і контактів використовуються лише в пам'яті для групування.
У JSON — тільки агрегати (кількості, частки, середні). Галузі з 1 клієнтом не показують
середній чек; скрипт перевіряє, що в файлі немає ID.
Клієнт = компанія угоди; якщо компанії немає — контакт; угоди без обох не враховуються (лічильник є).
Відтік: клієнт вважається втраченим, якщо після WON-угоди минуло CHURN_DAYS днів без нової WON.

v6.4: «перший дотик» (LTV реклами) — інкрементально. Кеш .cache/touch.json (GitHub Actions cache, не в git):
по кожній угоді — хеш клієнта (sha256 з сіллю), дата, UTM. Щоденно докачуються лише угоди, змінені після
попереднього запуску (filter[>DATE_MODIFY]); повне перевантаження — раз на TOUCH_FULL_DAYS днів (7),
якщо кешу немає, або TOUCH_FULL=1.
"""
import hashlib, json, os, re, statistics, sys, time
from urllib.parse import urlencode
from collections import defaultdict, Counter
from datetime import date, datetime, timedelta
from pathlib import Path

import requests

URL = os.environ.get("BITRIX_WEBHOOK_URL", "").rstrip("/") + "/"
OUT = Path(__file__).parent / "data" / "clients.json"
CATS = {24: "wholesale", 18: "retail", 32: "retail"}
CHURN_DAYS = int(os.environ.get("CHURN_DAYS", "180"))
RISK_FROM = int(os.environ.get("RISK_FROM_DAYS", "120"))
REACT_GAP = int(os.environ.get("REACT_GAP_DAYS", "180"))
KEY_ACCOUNT_MIN = float(os.environ.get("KEY_ACCOUNT_MIN", "1000000"))   # v7.7: «слон» — WON ≥ 1 млн за 12 міс   # v7.0: пауза, після якої угода = «повернення»
IND_FIELD = os.environ.get("CLIENT_INDUSTRY_FIELD", "").strip()
TOUCH_CACHE = Path(__file__).parent / ".cache" / "touch.json"
TOUCH_FULL_DAYS = int(os.environ.get("TOUCH_FULL_DAYS", "7"))
TOUCH_CATS = (0, 24, 18, 32)
KW = re.compile(r"індустр|индустр|галуз|отрасл|сфер[аиуе]|industry|вид діяльн|вид деятельн", re.I)
TODAY = date.today()
T0 = time.time()
el = lambda: f"[{time.time() - T0:.0f} с]"   # v7.6: тривалість етапів у лозі


def call(method, params=None):
    """Bitrix REST з повторами: ліміт запитів (503/QUERY_LIMIT_EXCEEDED), тимчасові 5xx (502/504) і мережеві збої."""
    last = None
    for a in range(8):
        try:
            r = requests.get(URL + method, params=params or {}, timeout=90)
        except requests.RequestException as e:
            last = e; time.sleep(float(os.environ.get("BX_RETRY_SLEEP", "1")) * (3 + 3 * a)); continue
        if r.status_code >= 500 or "QUERY_LIMIT_EXCEEDED" in r.text:
            last = f"HTTP {r.status_code}"; print(f"  ↻ {method}: {last}, повтор {a + 1}/8"); time.sleep(float(os.environ.get("BX_RETRY_SLEEP", "1")) * (3 + 3 * a)); continue
        r.raise_for_status()
        j = r.json()
        if "error" in j:
            raise RuntimeError(f"{method}: {j.get('error_description') or j['error']}")
        time.sleep(float(os.environ.get("BX_SLEEP", "0.35")))
        return j
    raise RuntimeError(f"{method}: не вдалося після 8 спроб ({last})")


def call_batch(cmd):
    """Bitrix batch (до 50 підзапитів за один HTTP-запит), POST, з тими самими повторами. → (result, result_error)."""
    last = None
    for a in range(8):
        try:
            r = requests.post(URL + "batch", json={"halt": 0, "cmd": cmd}, timeout=180)
        except requests.RequestException as e:
            last = e; time.sleep(float(os.environ.get("BX_RETRY_SLEEP", "1")) * (3 + 3 * a)); continue
        if r.status_code >= 500 or "QUERY_LIMIT_EXCEEDED" in r.text:
            last = f"HTTP {r.status_code}"; print(f"  ↻ batch: {last}, повтор {a + 1}/8"); time.sleep(float(os.environ.get("BX_RETRY_SLEEP", "1")) * (3 + 3 * a)); continue
        r.raise_for_status()
        j = r.json()
        if "error" in j:
            raise RuntimeError(f"batch: {j.get('error_description') or j['error']}")
        res = j.get("result") or {}
        time.sleep(float(os.environ.get("BX_SLEEP", "0.35")))
        return res.get("result") or {}, res.get("result_error") or {}
    raise RuntimeError(f"batch: не вдалося після 8 спроб ({last})")


def list_all(method, params):
    """v7.6: швидке вивантаження списку — перша сторінка звичайним запитом (дає total), решта сторінок
    пачками по 50 через batch: ~2 500 записів за один HTTP-запит замість 50. Сортування ID ASC, дублікати відкидаються."""
    base = dict(params); base["order[ID]"] = "ASC"
    first = call(method, dict(base, start=0))
    rows = list(first.get("result") or [])
    total = int(first.get("total") or 0)
    starts = list(range(50, total, 50))
    for i in range(0, len(starts), 50):
        grp = starts[i:i + 50]
        cmd = {f"p{st}": method + "?" + urlencode(dict(base, start=st), doseq=True) for st in grp}
        res, err = call_batch(cmd)
        for st in grp:
            k = f"p{st}"
            if k in res and isinstance(res[k], list):
                rows += res[k]
            else:   # підзапит не вдався — добираємо окремо
                if err.get(k):
                    print(f"  ↻ {method} start={st}: {str(err.get(k))[:120]} — окремий запит")
                rows += call(method, dict(base, start=st)).get("result") or []
    seen, out = set(), []
    for r in rows:
        if r.get("ID") in seen:
            continue
        seen.add(r.get("ID")); out.append(r)
    return out


DEAL_IND = {}   # {code: (підпис, {id варіанта: назва})} — поля галузі/сфери в картці УГОДИ


def detect_deal_industry_fields():
    """Напр. «Сфера применения» (UF_CRM_…) — у вашому Bitrix галузь заповнюють саме в угоді."""
    fields = call("crm.deal.fields").get("result", {})
    for code, f in fields.items():
        lb = f.get("formLabel") or f.get("listLabel") or f.get("title") or ""
        if f.get("type") == "boolean" or code == "CATEGORY_ID":
            continue
        if (IND_FIELD and code == IND_FIELD) or (not IND_FIELD and KW.search(lb)):
            DEAL_IND[code] = (lb, {str(i.get("ID")): i.get("VALUE") for i in (f.get("items") or [])})
    print(f"[CL] поля галузі в угоді: {[(c, v[0]) for c, v in DEAL_IND.items()] or '—'}")


def won_deals(cat):
    """Усі WON-угоди воронки. v7.6: batch-пагінація (у ~50 разів менше HTTP-запитів до Bitrix)."""
    return list_all("crm.deal.list", {"filter[CATEGORY_ID]": cat, "filter[STAGE_SEMANTIC_ID]": "S",
                                      "select[]": ["ID", "COMPANY_ID", "CONTACT_ID", "OPPORTUNITY", "CLOSEDATE"] + list(DEAL_IND)})


def all_deals_touch(cat, since=None):
    """v6.3: угоди воронки (будь-яка стадія) — лише поля для «першого дотику». v6.4: since → тільки змінені після."""
    p = {"filter[CATEGORY_ID]": cat, "select[]": ["ID", "COMPANY_ID", "CONTACT_ID", "DATE_CREATE", "UTM_SOURCE", "UTM_CAMPAIGN", "SOURCE_ID"]}
    if since:
        p["filter[>DATE_MODIFY]"] = since
    return list_all("crm.deal.list", p)   # v7.6: batch-пагінація


def hkey(key):
    """Незворотний ідентифікатор клієнта для кешу: sha256(сіль + c123/p456), сіль — секретний URL вебхука."""
    return hashlib.sha256((URL + "|" + key).encode()).hexdigest()[:16]


_TOUCH = None


def touch_deals():
    """{deal_id: [hkey, 'YYYY-MM-DD', utm_source, utm_campaign, SOURCE_ID]} — з кешу + докачка змін."""
    global _TOUCH
    if _TOUCH is not None:          # v7.0: один запит на запуск (перший дотик + повернення)
        return _TOUCH
    started = datetime.utcnow()
    cache = None
    try:
        cache = json.loads(TOUCH_CACHE.read_text(encoding="utf-8"))
        if cache.get("v") != 1:
            cache = None
    except Exception:
        cache = None
    full = (cache is None or os.environ.get("TOUCH_FULL") == "1"
            or (TODAY - date.fromisoformat(cache.get("full", "2000-01-01"))).days >= TOUCH_FULL_DAYS)
    deals = {} if full else cache["deals"]
    # запас 3 год на розбіжність годинників/часових поясів Bitrix
    since = None if full else (datetime.fromisoformat(cache["ts"]) - timedelta(hours=3)).strftime("%Y-%m-%dT%H:%M:%S+00:00")
    print(f"[CL] перший дотик: {'ПОВНЕ завантаження' if full else f'інкремент з {since} (у кеші {len(deals)} угод)'}")
    n = 0
    for cat in TOUCH_CATS:
        ds = all_deals_touch(cat, since)
        n += len(ds)
        print(f"[CL] {el()} перший дотик: воронка {cat} — {len(ds)} угод")
        for d in ds:
            co, ct = d.get("COMPANY_ID"), d.get("CONTACT_ID")
            key = ("c" + str(co)) if filled(co) else ("p" + str(ct)) if filled(ct) else None
            dt = d10(d.get("DATE_CREATE"))
            if not key or not dt:
                deals.pop(str(d["ID"]), None)
                continue
            us = (d.get("UTM_SOURCE") or "").strip()
            deals[str(d["ID"])] = [hkey(key), dt.isoformat(), us, (d.get("UTM_CAMPAIGN") or "").strip(),
                                   "" if us else (d.get("SOURCE_ID") or "")]
    try:
        TOUCH_CACHE.parent.mkdir(exist_ok=True)
        TOUCH_CACHE.write_text(json.dumps({"v": 1, "ts": started.isoformat(timespec="seconds"),
                                           "full": TODAY.isoformat() if full else cache["full"], "deals": deals},
                                          separators=(",", ":")), encoding="utf-8")
    except Exception as e:
        print(f"[CL] ⚠ кеш першого дотику не записано: {e}")
    print(f"[CL] перший дотик: отримано {n} угод, у кеші {len(deals)}")
    _TOUCH = deals
    return deals


def d10(s):
    try:
        return date.fromisoformat((s or "")[:10])
    except ValueError:
        return None


def num(v):
    try:
        return float(v or 0)
    except (TypeError, ValueError):
        return 0.0


def filled(v):
    return v not in (None, "", [], "0", 0, False)


# ───────────── галузі ─────────────
def industry_map(company_ids, rev_by_co):
    """Повертає (назва поля, підпис, {company_id: [галузі]}) для найкраще заповненого поля."""
    fields = call("crm.company.fields").get("result", {})
    ind_dict = {s["STATUS_ID"]: s["NAME"] for s in call("crm.status.list", {"filter[ENTITY_ID]": "INDUSTRY"}).get("result", [])}
    cands = {}
    for code, f in fields.items():
        lb = f.get("formLabel") or f.get("listLabel") or f.get("title") or ""
        if (IND_FIELD and code == IND_FIELD) or (not IND_FIELD and (code == "INDUSTRY" or KW.search(lb))):
            cands[code] = (lb, {str(i.get("ID")): i.get("VALUE") for i in (f.get("items") or [])})
    if not cands:
        return None, None, {}, {}
    ids = sorted(company_ids)
    comps = {}
    for i in range(0, len(ids), 50):
        j = call("crm.company.list", {"filter[ID][]": ids[i:i + 50], "select[]": ["ID"] + list(cands), "start": -1})
        for c in j.get("result") or []:
            comps[str(c["ID"])] = c
    total = sum(rev_by_co.values()) or 1
    cover = {code: sum(rev_by_co.get(cid, 0) for cid, c in comps.items() if filled(c.get(code))) / total for code in cands}
    for code, cv in cover.items():
        print(f"[CL] поле {code} «{cands[code][0]}»: заповнено для {cv * 100:.0f}% виручки (12 міс.)")
    best = max(cover, key=cover.get)
    if cover[best] <= 0:
        return best, cands[best][0], {}, cover
    lb, items = cands[best]
    out = {}
    for cid, c in comps.items():
        v = c.get(best)
        if not filled(v):
            continue
        vals = v if isinstance(v, list) else [v]
        out[cid] = [items.get(str(x)) or ind_dict.get(str(x)) or str(x) for x in vals]
    return best, lb, out, cover


# ───────────── RFM ─────────────
def r_score(days):
    return 5 if days <= 30 else 4 if days <= 90 else 3 if days <= 180 else 2 if days <= 365 else 1


def f_score(n):
    return 1 if n <= 1 else 2 if n == 2 else 3 if n <= 4 else 4 if n <= 9 else 5


def segment(r, f):
    if r >= 4 and f >= 4: return "Чемпіони"
    if r >= 3 and f >= 4: return "Лояльні"
    if r >= 4 and f >= 2: return "Потенційно лояльні"
    if r >= 4 and f == 1: return "Нові"
    if r == 3: return "Потребують уваги"
    if r <= 2 and f >= 4: return "Не можна втратити"
    if r <= 2 and f >= 2: return "Під ризиком"
    if r == 2: return "Сплячі"
    return "Втрачені"


SEG_ORDER = ["Чемпіони", "Лояльні", "Потенційно лояльні", "Нові", "Потребують уваги", "Не можна втратити", "Під ризиком", "Сплячі", "Втрачені"]


def main():
    if URL == "/":
        print("::error::BITRIX_WEBHOOK_URL не встановлено")
        return 1
    try:
        detect_deal_industry_fields()
    except Exception as e:
        print(f"[CL] ⚠ поля угоди: {e}")
    deals, skipped = [], 0
    for cat, grp in CATS.items():
        ds = won_deals(cat)
        print(f"[CL] {el()} воронка {cat}: {len(ds)} WON за весь час")
        for d in ds:
            dt = d10(d.get("CLOSEDATE"))
            if not dt or dt > TODAY + timedelta(days=1):
                skipped += 1
                continue
            co, ct = d.get("COMPANY_ID"), d.get("CONTACT_ID")
            key = ("c" + str(co)) if filled(co) else ("p" + str(ct)) if filled(ct) else None
            if not key:
                skipped += 1
                continue
            deals.append({"k": key, "grp": grp, "dt": dt, "amt": num(d.get("OPPORTUNITY")),
                          "ind": {c: d.get(c) for c in DEAL_IND if filled(d.get(c))}})
    print(f"[CL] угод у розрахунку: {len(deals)}, пропущено (без клієнта/дати): {skipped}")
    if not deals:
        print("::error::Немає WON-угод")
        return 1

    cl = defaultdict(lambda: {"dates": [], "rev": 0.0, "grp": Counter(), "rev12": 0.0, "n24": 0, "rev24": 0.0})
    y12, y24 = TODAY - timedelta(days=365), TODAY - timedelta(days=730)
    for d in deals:
        c = cl[d["k"]]
        c["dates"].append(d["dt"])
        c["rev"] += d["amt"]
        c["grp"][d["grp"]] += d["amt"] or 1
        if d["dt"] > y12:
            c["rev12"] += d["amt"]
        if d["dt"] > y24:
            c["n24"] += 1
            c["rev24"] += d["amt"]
    for c in cl.values():
        c["dates"].sort()
        c["group"] = c["grp"].most_common(1)[0][0]
    first_all = min(d["dt"] for d in deals)

    # ── LTV ──
    def ltv(sel):
        cs = [c for c in cl.values() if sel(c)]
        if not cs:
            return None
        revs = [c["rev"] for c in cs]
        life = [max(1, (c["dates"][-1] - c["dates"][0]).days / 30.44) for c in cs]
        repeat = [c for c in cs if len(c["dates"]) > 1]
        act = [c for c in cs if c["dates"][-1] > y12]
        n12 = sum(sum(1 for x in c["dates"] if x > y12) for c in act)
        r12 = sum(c["rev12"] for c in act)
        churned = [c for c in cs if (TODAY - c["dates"][-1]).days > CHURN_DAYS]
        life_churned = [max(1, (c["dates"][-1] - c["dates"][0]).days / 30.44) for c in churned]
        avg_check12 = r12 / n12 if n12 else None
        freq12 = n12 / len(act) if act else None
        life_years = (statistics.mean(life_churned) / 12) if life_churned else None
        return {
            "clients": len(cs), "activeClients12m": len(act),
            "avgRevenuePerClient": round(statistics.mean(revs)), "medianRevenuePerClient": round(statistics.median(revs)),
            "repeatShare": round(len(repeat) / len(cs) * 100, 1),
            "avgDealsPerClient": round(statistics.mean(len(c["dates"]) for c in cs), 2),
            "avgLifespanMonths": round(statistics.mean(life), 1),
            "avgLifespanChurnedMonths": round(statistics.mean(life_churned), 1) if life_churned else None,
            "avgCheck12m": round(avg_check12) if avg_check12 else None,
            "purchasesPerYear": round(freq12, 2) if freq12 else None,
            # класична формула: сер. чек × покупок/рік × тривалість життя (роки, за клієнтами, що вже пішли)
            "ltvFormula": round(avg_check12 * freq12 * life_years) if avg_check12 and freq12 and life_years else None,
            "top10Share12m": top_share([c["rev12"] for c in act], 0.10),
        }

    def top_share(vals, q):
        vals = sorted((v for v in vals if v > 0), reverse=True)
        if not vals:
            return None
        k = max(1, int(round(len(vals) * q)))
        return round(sum(vals[:k]) / sum(vals) * 100, 1)

    ltv_out = {"all": ltv(lambda c: True), "wholesale": ltv(lambda c: c["group"] == "wholesale"),
               "retail": ltv(lambda c: c["group"] == "retail")}

    # когорти: середня накопичена виручка на клієнта по роках від першої покупки
    coh = defaultdict(lambda: defaultdict(float))
    coh_n = Counter()
    for c in cl.values():
        y0 = c["dates"][0].year
        coh_n[y0] += 1
    for d in deals:
        c = cl[d["k"]]
        coh[c["dates"][0].year][d["dt"].year - c["dates"][0].year] += d["amt"]
    cohorts = []
    for y0 in sorted(coh):
        acc, row = 0.0, []
        for k in range(0, TODAY.year - y0 + 1):
            acc += coh[y0].get(k, 0.0)
            row.append(round(acc / coh_n[y0]))
        cohorts.append({"year": y0, "clients": coh_n[y0], "cumRevenuePerClient": row})

    # ── RFM (клієнти з WON за 24 міс.) ──
    seg = defaultdict(lambda: {"clients": 0, "rev24": 0.0, "rec": []})
    grid = [[0] * 5 for _ in range(5)]
    tot24 = sum(c["rev24"] for c in cl.values()) or 1
    for c in cl.values():
        if c["n24"] == 0:
            continue
        days = (TODAY - c["dates"][-1]).days
        r, f = r_score(days), f_score(c["n24"])
        s = seg[segment(r, f)]
        s["clients"] += 1
        s["rev24"] += c["rev24"]
        s["rec"].append(days)
        grid[5 - r][f - 1] += 1
    rfm = [{"segment": k, "clients": seg[k]["clients"], "revenueShare24m": round(seg[k]["rev24"] / tot24 * 100, 1),
            "medianDaysSinceLast": int(statistics.median(seg[k]["rec"])) if seg[k]["rec"] else None}
           for k in SEG_ORDER if seg[k]["clients"]]

    # ── Відтік по місяцях ──
    def churn_series(sel):
        events, react = Counter(), Counter()
        cs = [c for c in cl.values() if sel(c)]
        for c in cs:
            ds = c["dates"]
            for a, b in zip(ds, ds[1:] + [None]):
                ev = a + timedelta(days=CHURN_DAYS)
                if (b is None or b > ev) and ev <= TODAY:
                    events[ev.strftime("%Y-%m")] += 1
                    if b is not None:
                        react[b.strftime("%Y-%m")] += 1
        out = []
        start = max(date(first_all.year + 1, 1, 1), date(2025, 1, 1))
        m = start
        while m <= TODAY:
            key = m.strftime("%Y-%m")
            base = sum(1 for c in cs if any(m - timedelta(days=365) <= x < m for x in c["dates"]))
            out.append({"month": key, "base": base, "churned": events.get(key, 0), "reactivated": react.get(key, 0),
                        "rate": round(events.get(key, 0) / base * 100, 2) if base else None,
                        "complete": (m.year, m.month) < (TODAY.year, TODAY.month)})
            m = date(m.year + (m.month == 12), m.month % 12 + 1, 1)
        risk = [c for c in cs if RISK_FROM <= (TODAY - c["dates"][-1]).days <= CHURN_DAYS]
        r12 = sum(c["rev12"] for c in cs) or 1
        last12 = [x for x in out if x["complete"]][-12:]
        return {"series": out,
                "annualChurnPct": round(sum(x["churned"] for x in last12) / (statistics.mean(x["base"] for x in last12) or 1) * 100, 1) if last12 else None,
                "atRisk": {"clients": len(risk), "revenueShare12m": round(sum(c["rev12"] for c in risk) / r12 * 100, 1)}}

    churn = {"all": churn_series(lambda c: True), "wholesale": churn_series(lambda c: c["group"] == "wholesale")}

    # ── Галузі: поле угоди (напр. «Сфера применения») або компанії — беремо найкраще заповнене ──
    industries = None
    tot12 = sum(c["rev12"] for c in cl.values()) or 1
    d12 = [d for d in deals if d["dt"] > y12]
    best = None   # (покриття, тип, код, підпис, функція: угода → [галузі] або None)
    for code, (lb, items) in DEAL_IND.items():
        cov = sum(d["amt"] for d in d12 if code in d["ind"]) / tot12
        print(f"[CL] поле угоди {code} «{lb}»: заповнено для {cov * 100:.0f}% виручки (12 міс.)")
        def fn(d, code=code, items=items):
            v = d["ind"].get(code)
            if v is None:
                return None
            return [items.get(str(x)) or str(x) for x in (v if isinstance(v, list) else [v])]
        if cov > 0 and (best is None or cov > best[0]):
            best = (cov, "deal", code, lb, fn)
    co_rev12 = defaultdict(float)
    for k, c in cl.items():
        if k.startswith("c") and c["rev12"] > 0:
            co_rev12[k[1:]] = c["rev12"]
    try:
        cfield, clabel, imap, ccover = industry_map(set(co_rev12), co_rev12)
        if cfield and imap and (best is None or (ccover.get(cfield) or 0) > best[0]):
            best = (ccover.get(cfield) or 0, "company", cfield, clabel,
                    lambda d: imap.get(d["k"][1:]) if d["k"].startswith("c") else None)
    except Exception as e:
        print(f"[CL] ⚠ галузі компаній: {e}")
    if best:
        cov, src, field, flabel, fn = best
        def ind_rows(sel):
            agg = defaultdict(lambda: {"clients": set(), "deals": 0, "rev": 0.0})
            ds = [d for d in d12 if sel(d)]
            tot = sum(d["amt"] for d in ds) or 1
            for d in ds:
                inds = fn(d) or ["Не вказано"]
                for ind in inds:
                    a = agg[ind]
                    a["clients"].add(d["k"])
                    a["deals"] += 1
                    a["rev"] += d["amt"] / len(inds)
            rows = []
            for ind, a in agg.items():
                n = len(a["clients"])
                rows.append({"industry": ind, "clients": n, "deals": a["deals"], "revenueShare12m": round(a["rev"] / tot * 100, 1),
                             "avgCheck12m": round(a["rev"] / a["deals"]) if a["deals"] and n >= 2 else None})
            return sorted(rows, key=lambda r: -r["revenueShare12m"])
        industries = {"field": field, "fieldLabel": flabel, "source": src, "coverageRevenue12mPct": round(cov * 100, 1),
                      "rows": ind_rows(lambda d: True),
                      "byGroup": {"wholesale": ind_rows(lambda d: d["grp"] == "wholesale"),
                                  "retail": ind_rows(lambda d: d["grp"] == "retail")}}

    # ── v6.3: LTV рекламного трафіку — клієнт отримує канал/кампанію своєї ПЕРШОЇ угоди (воронки 0/24/18/32,
    #    будь-яка стадія); у його LTV — уся WON-виручка за весь час, у т.ч. повторні угоди без UTM.
    #    Агрегат по (місяць першої угоди × utm_source × utm_campaign × SOURCE_ID), без ID клієнтів.
    acquisition = None
    try:
        first = {}
        for hk, ds, us, uc, src in touch_deals().values():
            dt = date.fromisoformat(ds)
            cur = first.get(hk)
            # раніша угода перемагає; у той самий день — та, що з UTM
            if cur is None or dt < cur[0] or (dt == cur[0] and us and not cur[1]):
                first[hk] = (dt, us, uc, src)
        clh = {hkey(k): c for k, c in cl.items()}
        acq = defaultdict(lambda: {"n": 0, "p": 0, "rev": 0.0, "w": 0, "rev12": 0.0})
        for key, (dt, us, uc, src) in first.items():
            c0 = clh.get(key)
            kk = 1 if c0 and c0["rev12"] >= KEY_ACCOUNT_MIN else 0     # v7.7: клієнт-«слон»
            a = acq[(dt.strftime("%Y-%m"), us.lower(), uc, src, kk)]
            a["n"] += 1
            c = clh.get(key)
            if c and c["rev"] > 0:
                a["p"] += 1
                a["rev"] += c["rev"]
                a["w"] += len(c["dates"])
                a["rev12"] += c["rev12"]
        acquisition = {
            "note": "клієнт = компанія угоди або контакт; канал — з першої угоди у воронках 0/24/18/32; "
                    "LTV — уся WON-виручка клієнта за весь час",
            "fields": "m=місяць першої угоди, us/uc=utm_source/utm_campaign, s=SOURCE_ID (якщо без UTM), "
                      "n=нових клієнтів, p=з них купили (WON), rev=їхня WON-виручка за весь час, w=WON-угод, rev12=виручка за 12 міс",
            "rows": sorted([dict({"m": k[0], "us": k[1], "uc": k[2], "s": k[3], "n": v["n"], "p": v["p"],
                                  "rev": round(v["rev"]), "w": v["w"], "rev12": round(v["rev12"])}, **({"k": 1} if k[4] else {}))
                            for k, v in acq.items()], key=lambda r: (r["m"], r["us"], r["uc"]))}
        withU = sum(1 for v in first.values() if v[1])
        print(f"[CL] перший дотик: {len(first)} клієнтів, з UTM у першій угоді — {withU}")
    except Exception as e:
        print(f"[CL] ⚠ перший дотик (LTV реклами) не пораховано: {e}")

    # ── v7.0: повернення клієнтів після паузи (retention силами маркетингу) ──
    #    Подія «повернення» = нова угода (воронки 0/24/18/32, будь-яка стадія) клієнта, який УЖЕ купував (WON раніше),
    #    і в якого перед цим ≥ REACT_GAP днів не було ні угод, ні покупок. Канал повернення — UTM/джерело цієї угоди
    #    (класифікацію «маркетинг / ні» робить дашборд за data/marketing_rules.json). Виручка повернення — WON клієнта
    #    за 365 днів від дати повернення. Агрегат без ID: (місяць × utm_source × utm_campaign × SOURCE_ID).
    reactivation = None
    try:
        touches = defaultdict(list)
        for hk, ds, us, uc, src in touch_deals().values():
            touches[hk].append((date.fromisoformat(ds), us, uc, src))
        wons = defaultdict(list)
        for d in deals:
            wons[hkey(d["k"])].append((d["dt"], d["amt"]))
        rx = defaultdict(lambda: {"n": 0, "p": 0, "rev": 0.0, "w": 0})
        clh2 = {hkey(k): c for k, c in cl.items()}
        n_ev = 0
        for hk, ts in touches.items():
            wl = sorted(wons.get(hk, []))
            if not wl:
                continue
            ts.sort(key=lambda t: (t[0], not t[1]))   # у той самий день перша — угода з UTM
            last_act = None
            for dt, us, uc, src in ts:
                prior_won = [w for w in wl if w[0] < dt]
                if prior_won:
                    last = max([w[0] for w in prior_won] + ([last_act] if last_act else []))
                    if (dt - last).days >= REACT_GAP:
                        win = [w for w in wl if dt <= w[0] < dt + timedelta(days=365)]
                        c0 = clh2.get(hk)
                        a = rx[(dt.strftime("%Y-%m"), us.lower(), uc, src, 1 if c0 and c0["rev12"] >= KEY_ACCOUNT_MIN else 0)]
                        a["n"] += 1
                        n_ev += 1
                        if win:
                            a["p"] += 1
                            a["w"] += len(win)
                            a["rev"] += sum(w[1] for w in win)
                last_act = dt if last_act is None or dt > last_act else last_act
        reactivation = {
            "gapDays": REACT_GAP,
            "note": f"повернення = нова угода клієнта, що вже купував, після ≥{REACT_GAP} днів без угод і покупок; "
                    "виручка — WON клієнта за 365 днів від повернення",
            "fields": "m=місяць повернення, us/uc=utm_source/utm_campaign угоди повернення, s=SOURCE_ID, n=повернень, "
                      "p=з них купили, w=WON-угод, rev=WON-виручка за 365 днів",
            "rows": sorted([dict({"m": k[0], "us": k[1], "uc": k[2], "s": k[3], "n": v["n"], "p": v["p"], "w": v["w"],
                                  "rev": round(v["rev"])}, **({"k": 1} if k[4] else {})) for k, v in rx.items()],
                           key=lambda r: (r["m"], r["us"], r["uc"]))}
        print(f"[CL] повернення після паузы ≥{REACT_GAP} дн: {n_ev} подій")
    except Exception as e:
        print(f"[CL] ⚠ повернення клієнтів не пораховано: {e}")

    out = {"fetched_at": datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"), "asOf": TODAY.isoformat(),
           "firstDeal": first_all.isoformat(), "dealsUsed": len(deals), "dealsSkipped": skipped, "clients": len(cl),
           "params": {"churnDays": CHURN_DAYS, "riskFromDays": RISK_FROM},
           "ltv": ltv_out, "cohorts": cohorts, "rfm": rfm, "rfmGrid": grid, "churn": churn, "industries": industries,
           "acquisition": acquisition, "reactivation": reactivation,
           "privacy": "лише агрегати; ID/назви клієнтів не зберігаються"}
    blob = json.dumps(out, ensure_ascii=False)
    if re.search(r'"(c|p)\d{2,}"', blob):
        print("::error::У файлі знайдено ID клієнта — запис скасовано")
        return 1
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    a = ltv_out["all"]
    print(f"[CL] {el()} ✓ {OUT}: клієнтів {len(cl)}, LTV сер. {a['avgRevenuePerClient']:,} / мед. {a['medianRevenuePerClient']:,} грн, "
          f"відтік B2B за рік {churn['wholesale']['annualChurnPct']}%, під ризиком {churn['all']['atRisk']['clients']}, "
          f"галузі: {industries and industries['field']} ({industries and industries['coverageRevenue12mPct']}% виручки)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
