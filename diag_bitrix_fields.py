#!/usr/bin/env python3
"""
diag_bitrix_fields.py — одноразова діагностика Bitrix24 (v6.2, 14.10.2026) для метрик
«Аналіз клієнтів» і «Продажі»: чи можна рахувати по індустріях, по типу продукту, LTV/RFM/churn.

Друкує ЛИШЕ кількості, назви полів і довідникові значення (назви індустрій, товарів) —
жодних назв компаній, контактів, телефонів чи ID клієнтів. Нічого не записує в репозиторій.
"""
import os, re, time
from collections import Counter, defaultdict
import requests

URL = os.environ.get("BITRIX_WEBHOOK_URL", "").rstrip("/") + "/"
SALES = (24, 18, 32)
KW = re.compile(r"індустр|индустр|галуз|отрасл|сфер|industry|напрям|направл|сегмент|вид діяльн|вид деятельн", re.I)


def call(method, params=None):
    for a in range(5):
        r = requests.get(URL + method, params=params or {}, timeout=60)
        if r.status_code == 503 or "QUERY_LIMIT_EXCEEDED" in r.text:
            time.sleep(2 + a * 2)
            continue
        r.raise_for_status()
        time.sleep(0.4)
        return r.json()
    raise RuntimeError(method + ": rate limit")


def all_list(method, params):
    out, start = [], 0
    while True:
        p = dict(params, start=start)
        j = call(method, p)
        out += j.get("result", []) or []
        if j.get("next") is None:
            return out
        start = j["next"]


def label(f):
    return f.get("formLabel") or f.get("listLabel") or f.get("title") or ""


def candidates(entity):
    fields = call(f"crm.{entity}.fields").get("result", {})
    out = []
    for code, f in fields.items():
        lb = label(f)
        if code in ("INDUSTRY",) or KW.search(lb) or KW.search(code):
            items = f.get("items") or []
            out.append((code, lb, f.get("type"), len(items), {str(i.get("ID")): i.get("VALUE") for i in items}))
    print(f"\n=== Поля crm.{entity}, схожі на «індустрію/сферу» ===")
    for code, lb, tp, n, _ in out:
        print(f"  {code:<28} «{lb}»  тип={tp}" + (f", варіантів у списку: {n}" if n else ""))
    if not out:
        print("  (не знайдено)")
    return out


def filled(v):
    return v not in (None, "", [], "0", 0, False)


print("=== 1. Довідник INDUSTRY (crm.status.list) ===")
ind = {s["STATUS_ID"]: s["NAME"] for s in call("crm.status.list", {"filter[ENTITY_ID]": "INDUSTRY"}).get("result", [])}
print("  " + (", ".join(f"{k}={v}" for k, v in ind.items()) if ind else "(порожній)"))

comp_f = candidates("company")
deal_f = candidates("deal")

print("\n=== 2. WON-угоди 2026 у воронках продажів 24/18/32 ===")
won = []
for cat in SALES:
    ds = all_list("crm.deal.list", {"filter[CATEGORY_ID]": cat, "filter[STAGE_SEMANTIC_ID]": "S",
                                    "filter[>=CLOSEDATE]": "2026-01-01",
                                    "select[]": ["ID", "COMPANY_ID", "CONTACT_ID", "OPPORTUNITY"] + [c[0] for c in deal_f]})
    print(f"  воронка {cat}: {len(ds)} WON")
    won += ds
rev = sum(float(d.get("OPPORTUNITY") or 0) for d in won)
with_co = [d for d in won if filled(d.get("COMPANY_ID"))]
print(f"  разом {len(won)} угод; з прив'язаною компанією: {len(with_co)} ({len(with_co) / max(1, len(won)) * 100:.0f}%), "
      f"частка виручки з компанією: {sum(float(d.get('OPPORTUNITY') or 0) for d in with_co) / max(1, rev) * 100:.0f}%")

for code, lb, tp, n, items in deal_f:
    f = [d for d in won if filled(d.get(code))]
    frev = sum(float(d.get("OPPORTUNITY") or 0) for d in f)
    print(f"  поле УГОДИ {code} «{lb}»: заповнено в {len(f)} з {len(won)} ({len(f) / max(1, len(won)) * 100:.0f}%), "
          f"{frev / max(1, rev) * 100:.0f}% виручки")
    vals = Counter()
    for d in f:
        v = d.get(code)
        for x in (v if isinstance(v, list) else [v]):
            vals[items.get(str(x), ind.get(str(x), str(x)))] += 1
    for v, c in vals.most_common(15):
        print(f"      {str(v)[:50]:<50} {c}")

print("\n=== 3. Заповненість полів КОМПАНІЙ (тих, що мають WON-угоди 2026) ===")
ids = sorted({str(d["COMPANY_ID"]) for d in with_co})
rev_by_co = defaultdict(float)
for d in with_co:
    rev_by_co[str(d["COMPANY_ID"])] += float(d.get("OPPORTUNITY") or 0)
print(f"  компаній: {len(ids)}")
sel = ["ID"] + [c[0] for c in comp_f]
comps = []
for i in range(0, len(ids), 50):
    comps += all_list("crm.company.list", {"filter[ID][]": ids[i:i + 50], "select[]": sel})
for code, lb, tp, n, items in comp_f:
    f = [c for c in comps if filled(c.get(code))]
    frev = sum(rev_by_co[str(c["ID"])] for c in f)
    print(f"  поле КОМПАНІЇ {code} «{lb}»: заповнено в {len(f)} з {len(comps)} ({len(f) / max(1, len(comps)) * 100:.0f}%), "
          f"{frev / max(1, rev) * 100:.0f}% виручки 2026")
    vals, vrev = Counter(), defaultdict(float)
    for c in f:
        v = c.get(code)
        for x in (v if isinstance(v, list) else [v]):
            nm = items.get(str(x), ind.get(str(x), str(x)))
            vals[nm] += 1
            vrev[nm] += rev_by_co[str(c["ID"])]
    for v, cnt in vals.most_common(20):
        print(f"      {str(v)[:50]:<50} {cnt:>4} комп.  {vrev[v] / max(1, rev) * 100:5.1f}% виручки")

print("\n=== 4. Товарні позиції у WON-угодах 2026 (вибірка до 300 угод) ===")
sample = won[-300:]
with_rows, names = 0, Counter()
for i in range(0, len(sample), 50):
    cmd = {f"d{d['ID']}": f"crm.deal.productrows.get?id={d['ID']}" for d in sample[i:i + 50]}
    res = call("batch", {**{f"cmd[{k}]": v for k, v in cmd.items()}, "halt": 0}).get("result", {}).get("result", {})
    for k, rows in (res or {}).items():
        if rows:
            with_rows += 1
            for r in rows:
                names[(r.get("PRODUCT_NAME") or "?")[:60]] += 1
print(f"  угод з товарними позиціями: {with_rows} з {len(sample)} ({with_rows / max(1, len(sample)) * 100:.0f}%)")
print(f"  різних товарів: {len(names)}; топ-15 назв:")
for n, c in names.most_common(15):
    print(f"      {n:<60} {c}")

print("\n=== 5. Глибина історії для LTV / RFM / churn ===")
for cat in SALES:
    j = call("crm.deal.list", {"filter[CATEGORY_ID]": cat, "filter[STAGE_SEMANTIC_ID]": "S",
                               "order[CLOSEDATE]": "ASC", "select[]": ["ID", "CLOSEDATE"], "start": -1})
    first = (j.get("result") or [{}])[0].get("CLOSEDATE", "")[:10]
    tot = call("crm.deal.list", {"filter[CATEGORY_ID]": cat, "filter[STAGE_SEMANTIC_ID]": "S", "select[]": ["ID"]}).get("total")
    print(f"  воронка {cat}: перша WON-угода {first or '—'}, усього WON за весь час: {tot}")
print("\nГотово. Персональних даних не виведено.")
