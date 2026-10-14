#!/usr/bin/env python3
"""
fetch_clients.py — Easy 3D Print Dashboard v6.2
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
"""
import json, os, re, statistics, sys, time
from collections import defaultdict, Counter
from datetime import date, datetime, timedelta
from pathlib import Path

import requests

URL = os.environ.get("BITRIX_WEBHOOK_URL", "").rstrip("/") + "/"
OUT = Path(__file__).parent / "data" / "clients.json"
CATS = {24: "wholesale", 18: "retail", 32: "retail"}
CHURN_DAYS = int(os.environ.get("CHURN_DAYS", "180"))
RISK_FROM = int(os.environ.get("RISK_FROM_DAYS", "120"))
IND_FIELD = os.environ.get("CLIENT_INDUSTRY_FIELD", "").strip()
KW = re.compile(r"індустр|индустр|галуз|отрасл|сфер[аиуе]|industry|вид діяльн|вид деятельн", re.I)
TODAY = date.today()


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
    """Усі WON-угоди воронки — швидка пагінація через filter[>ID] + start=-1."""
    out, last = [], 0
    while True:
        j = call("crm.deal.list", {"filter[CATEGORY_ID]": cat, "filter[STAGE_SEMANTIC_ID]": "S", "filter[>ID]": last,
                                   "order[ID]": "ASC", "start": -1,
                                   "select[]": ["ID", "COMPANY_ID", "CONTACT_ID", "OPPORTUNITY", "CLOSEDATE"] + list(DEAL_IND)})
        rows = j.get("result") or []
        out += rows
        if len(rows) < 50:
            return out
        last = rows[-1]["ID"]


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
        print(f"[CL] воронка {cat}: {len(ds)} WON за весь час")
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
        agg = defaultdict(lambda: {"clients": set(), "deals": 0, "rev": 0.0})
        for d in d12:
            inds = fn(d) or ["Не вказано"]
            for ind in inds:
                a = agg[ind]
                a["clients"].add(d["k"])
                a["deals"] += 1
                a["rev"] += d["amt"] / len(inds)
        rows = []
        for ind, a in agg.items():
            n = len(a["clients"])
            rows.append({"industry": ind, "clients": n, "deals": a["deals"], "revenueShare12m": round(a["rev"] / tot12 * 100, 1),
                         "avgCheck12m": round(a["rev"] / a["deals"]) if a["deals"] and n >= 2 else None})
        industries = {"field": field, "fieldLabel": flabel, "source": src, "coverageRevenue12mPct": round(cov * 100, 1),
                      "rows": sorted(rows, key=lambda r: -r["revenueShare12m"])}

    out = {"fetched_at": datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"), "asOf": TODAY.isoformat(),
           "firstDeal": first_all.isoformat(), "dealsUsed": len(deals), "dealsSkipped": skipped, "clients": len(cl),
           "params": {"churnDays": CHURN_DAYS, "riskFromDays": RISK_FROM},
           "ltv": ltv_out, "cohorts": cohorts, "rfm": rfm, "rfmGrid": grid, "churn": churn, "industries": industries,
           "privacy": "лише агрегати; ID/назви клієнтів не зберігаються"}
    blob = json.dumps(out, ensure_ascii=False)
    if re.search(r'"(c|p)\d{2,}"', blob):
        print("::error::У файлі знайдено ID клієнта — запис скасовано")
        return 1
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    a = ltv_out["all"]
    print(f"[CL] ✓ {OUT}: клієнтів {len(cl)}, LTV сер. {a['avgRevenuePerClient']:,} / мед. {a['medianRevenuePerClient']:,} грн, "
          f"відтік B2B за рік {churn['wholesale']['annualChurnPct']}%, під ризиком {churn['all']['atRisk']['clients']}, "
          f"галузі: {industries and industries['field']} ({industries and industries['coverageRevenue12mPct']}% виручки)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
