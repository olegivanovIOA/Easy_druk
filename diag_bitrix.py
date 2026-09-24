#!/usr/bin/env python3
"""
diag_bitrix.py — одноразова діагностика воронок Bitrix24 (v4.6, 24.09.2026).
Питання: що таке воронка 34 (у Looker видно стадії C34:NEW "НОВА угода (обробка…")
і чи можна додати її в продажі без подвійного рахунку з 24/18/32.
Друкує: усі воронки, стадії воронки 34, к-сть угод за вересень у кожній
воронці, і скільки клієнтів воронки 34 мають угоди того ж місяця в 24/18/32.
Нічого не записує в репозиторій, персональні дані не друкує (лише ID/кількості).
"""
import os, time
import requests

URL = os.environ.get("BITRIX_WEBHOOK_URL", "").rstrip("/") + "/"
FROM, TO = "2026-09-01", "2026-10-01"


def call(method, params=None):
    r = requests.get(URL + method, params=params or {}, timeout=30)
    r.raise_for_status()
    time.sleep(0.4)
    return r.json()


def all_deals(cat, select):
    out, start = [], 0
    while True:
        j = call("crm.deal.list", {"filter[CATEGORY_ID]": cat, "filter[>=DATE_CREATE]": FROM,
                                   "filter[<DATE_CREATE]": TO, "select[]": select, "start": start})
        out += j.get("result", [])
        if j.get("next") is None:
            return out
        start = j["next"]


cats = call("crm.category.list", {"entityTypeId": 2}).get("result", {}).get("categories", [])
print("=== Воронки угод ===")
for c in cats:
    print(f"  {c.get('id'):>4}  {c.get('name')}")

print("\n=== Стадії воронки 34 ===")
for s in call("crm.status.list", {"filter[ENTITY_ID]": "DEAL_STAGE_34"}).get("result", []):
    print(f"  {s['STATUS_ID']:<14} sem={s.get('SEMANTICS') or '-':<2} {s.get('NAME')}")

sel = ["ID", "STAGE_ID", "STAGE_SEMANTIC_ID", "OPPORTUNITY", "COMPANY_ID", "CONTACT_ID", "UTM_SOURCE", "SOURCE_ID"]
data = {}
print(f"\n=== Угоди, створені {FROM}…{TO} ===")
for cid in [0, 24, 18, 32, 34] + [int(c["id"]) for c in cats if int(c["id"]) not in (0, 24, 18, 32, 34)]:
    try:
        ds = all_deals(cid, sel)
    except Exception as e:
        print(f"  воронка {cid}: помилка {e}"); continue
    data[cid] = ds
    won = [d for d in ds if d.get("STAGE_SEMANTIC_ID") == "S"]
    print(f"  воронка {cid:>3}: {len(ds):>5} угод, WON {len(won):>4}, сума WON {sum(float(d.get('OPPORTUNITY') or 0) for d in won):>14,.0f}, "
          f"з UTM {sum(1 for d in ds if d.get('UTM_SOURCE'))}")


def ck(d):
    c = str(d.get("COMPANY_ID") or "0")
    if c != "0":
        return "co" + c
    p = str(d.get("CONTACT_ID") or "0")
    return "ct" + p if p != "0" else None


if 34 in data:
    sales = {ck(d) for c in (24, 18, 32) for d in data.get(c, []) if ck(d)}
    c34 = [ck(d) for d in data[34] if ck(d)]
    both = sum(1 for k in c34 if k in sales)
    print(f"\n=== Перетин клієнтів: воронка 34 vs 24/18/32 (вересень) ===")
    print(f"  клієнтів у 34: {len(set(c34))}, з них мають угоди того ж місяця в 24/18/32: {len({k for k in c34 if k in sales})}")
    print("  Якщо перетин великий — 34 схожа на копію/етап продажних угод (ризик подвійного рахунку виручки).")
    print("  Якщо малий — це окремий потік продажів, його можна додавати.")
