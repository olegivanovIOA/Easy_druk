#!/usr/bin/env python3
"""
merge_crm_history.py — v7.41: злиття результату «Backfill CRM Monthly History» зі свіжою версією в репозиторії.

Навіщо: backfill рахує 30–60 хв, а «Update Dashboard Data» за цей час кілька разів комітить той самий
data/crm_monthly_history.json (щоденний перерахунок останніх місяців). Звичайний git rebase на JSON дає
конфлікт — і весь результат backfill губився (так було 25.11.2026).

Правило злиття по кожному місяцю (база — свіжа версія з репозиторію):
  • місяця немає в репозиторії                → беремо з backfill;
  • когорта: беремо backfill, якщо в нього новіша версія розбивки кампаній (campaignDailyV)
    або в репозиторії когорти немає; інакше лишаємо свіжу (її щойно перерахував Update data);
  • списки WON-угод (dealLists): беремо backfill, якщо в нього є дата створення, а в репозиторії — ні;
  • решта полів місяця: доповнюємо з backfill лише те, чого в репозиторії немає.

Використання: python merge_crm_history.py <backfill.json> <repo.json>   (результат пишеться в <repo.json>)
"""
import json
import sys


def _dl_has_created(dl):
    if not dl:
        return False
    for g in dl.values():
        for lst in (g or {}).values():
            if lst:
                return "created" in lst[0]
    return False


def merge(ours, theirs):
    out = dict(theirs)
    t_months = {m.get("month"): m for m in theirs.get("months", [])}
    taken = []
    for om in ours.get("months", []):
        k = om.get("month")
        tm = t_months.get(k)
        if tm is None:
            t_months[k] = om
            taken.append(f"{k}: весь місяць")
            continue
        m = dict(tm)
        oc, tc = om.get("cohort"), tm.get("cohort")
        if oc and (not tc or (oc.get("campaignDailyV") or 0) > (tc.get("campaignDailyV") or 0)):
            m["cohort"] = oc
            taken.append(f"{k}: когорта (v{oc.get('campaignDailyV')})")
        if _dl_has_created(om.get("dealLists")) and not _dl_has_created(tm.get("dealLists")):
            m["dealLists"] = om["dealLists"]
            taken.append(f"{k}: списки WON-угод")
        for f, v in om.items():
            if f not in m or m[f] is None:
                m[f] = v
        t_months[k] = m
    out["months"] = [t_months[k] for k in sorted(t_months)]
    return out, taken


def main():
    ours_p, repo_p = sys.argv[1], sys.argv[2]
    with open(ours_p, encoding="utf-8") as f:
        ours = json.load(f)
    with open(repo_p, encoding="utf-8") as f:
        theirs = json.load(f)
    out, taken = merge(ours, theirs)
    with open(repo_p, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
    print(f"[merge] з backfill взято: {len(taken)}")
    for t in taken:
        print("   ", t)


if __name__ == "__main__":
    main()
