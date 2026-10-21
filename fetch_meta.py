#!/usr/bin/env python3
"""
fetch_meta.py — v7.0: витрати Facebook / Instagram (Meta Marketing API) → data/meta_ads.json

Що бере: /act_{id}/insights, level=campaign, по днях — spend, impressions, clicks, leads (заявки lead-форм / пікселя),
повідомлення (почато розмов у Direct/Messenger), назва акаунта і валюта. Якщо валюта акаунта не UAH — перерахунок
у гривні за курсом НБУ на дату витрати.

Секрети GitHub (Settings → Secrets → Actions):
  META_ACCESS_TOKEN    — токен системного користувача Business Manager з правом ads_read на рекламні акаунти
  META_AD_ACCOUNT_IDS  — (необов'язково) ID рекламних акаунтів через кому (з «act_» або без). v7.7: якщо не задано —
                         беруться всі акаунти, доступні токену (/me/adaccounts), з активними або колишніми витратами
Необов'язково (env): META_API_VERSION (v23.0), META_SINCE (2026-01-01), META_REFRESH_DAYS (35 — скільки днів
перезавантажувати щоразу: Meta доуточнює конверсії заднім числом).

Без секретів — тихо виходить з кодом 0 (job зелений, файл не створюється).
Персональних даних немає — тільки агрегати по кампаніях.
"""

import json, os, sys, time
from datetime import date, datetime, timedelta
from pathlib import Path

import requests

OUT = Path(os.environ.get("META_OUT", Path(__file__).resolve().parent / "data" / "meta_ads.json"))
TOKEN = os.environ.get("META_ACCESS_TOKEN", "").strip()
ACCS = [a.strip() for a in os.environ.get("META_AD_ACCOUNT_IDS", "").replace(";", ",").split(",") if a.strip()]
VER = os.environ.get("META_API_VERSION", "v23.0").strip() or "v23.0"
BASE = os.environ.get("META_API_BASE", "https://graph.facebook.com").rstrip("/")
NBU = os.environ.get("NBU_API_BASE", "https://bank.gov.ua").rstrip("/")
SINCE = date.fromisoformat(os.environ.get("META_SINCE", "2026-01-01"))
REFRESH = int(os.environ.get("META_REFRESH_DAYS", "35"))
TODAY = date.today()

LEAD_TYPES = ("lead", "onsite_conversion.lead_grouped", "offsite_conversion.fb_pixel_lead", "leadgen_grouped")
MSG_TYPES = ("onsite_conversion.messaging_conversation_started_7d",)


def get(url, params=None, tries=6):
    for i in range(tries):
        try:
            r = requests.get(url, params=params, timeout=60)
        except requests.RequestException as e:
            if i == tries - 1:
                raise
            print(f"[META] мережа: {e} — повтор")
            time.sleep(3 * (i + 1))
            continue
        if r.status_code == 200:
            return r.json()
        try:
            err = r.json().get("error", {})
        except Exception:
            err = {"message": r.text[:200]}
        code = err.get("code")
        # 4/17/32/613 — ліміти запитів; 1/2 — тимчасові помилки; 5xx — сервер
        if r.status_code >= 500 or code in (1, 2, 4, 17, 32, 613, 80000, 80004):
            time.sleep(min(60, 5 * (i + 1)))
            continue
        msg = err.get("message", "")
        if TOKEN:
            msg = msg.replace(TOKEN, "***")
        raise RuntimeError(f"HTTP {r.status_code}, code {code}: {msg}")
    raise RuntimeError("вичерпано спроби")


def act(a):
    return a if a.startswith("act_") else "act_" + a


def month_chunks(a, b):
    cur = a
    while cur <= b:
        nxt = (cur.replace(day=1) + timedelta(days=32)).replace(day=1)
        yield cur, min(b, nxt - timedelta(days=1))
        cur = nxt


def insights(acc, a, b):
    url = f"{BASE}/{VER}/{act(acc)}/insights"
    params = {"access_token": TOKEN, "level": "campaign", "time_increment": 1, "limit": 500,
              "time_range": json.dumps({"since": a.isoformat(), "until": b.isoformat()}),
              "fields": "campaign_id,campaign_name,account_id,account_name,account_currency,spend,impressions,clicks,actions"}
    out = []
    j = get(url, params)
    while True:
        out += j.get("data") or []
        nxt = (j.get("paging") or {}).get("next")
        if not nxt:
            return out
        j = get(nxt)


_rates = {}


def uah_rate(cur, d):
    """Курс НБУ валюти cur на дату d (грн за 1 одиницю); кешується по місяцях одним запитом на діапазон."""
    cur = cur.upper()
    if cur == "UAH":
        return 1.0
    key = (cur, d.isoformat())
    if key not in _rates:
        a = d.replace(day=1)
        b = min(TODAY, (a + timedelta(days=32)).replace(day=1) - timedelta(days=1))
        try:
            j = get(f"{NBU}/NBU_Exchange/exchange_site", {"start": a.strftime("%Y%m%d"), "end": b.strftime("%Y%m%d"),
                                                          "valcode": cur.lower(), "sort": "exchangedate",
                                                          "order": "asc", "json": ""})
            for r in j or []:
                dd = datetime.strptime(r["exchangedate"], "%d.%m.%Y").date()
                _rates[(cur, dd.isoformat())] = float(r["rate"]) / float(r.get("units") or 1)
        except Exception as e:
            print(f"[META] ⚠ курс НБУ {cur} за {a:%Y-%m}: {e}")
        if key not in _rates:      # вихідні / немає в діапазоні — найближчий попередній курс
            prev = sorted(k for k in _rates if k[0] == cur and k[1] <= d.isoformat())
            nxt = sorted(k for k in _rates if k[0] == cur and k[1] > d.isoformat())
            if prev:
                _rates[key] = _rates[prev[-1]]
            elif nxt:              # початок місяця у вихідні — перший курс місяця
                _rates[key] = _rates[nxt[0]]
            else:
                j = get(f"{NBU}/NBUStatService/v1/statdirectory/exchange",
                        {"valcode": cur, "date": d.strftime("%Y%m%d"), "json": ""})
                _rates[key] = float(j[0]["rate"])
    return _rates[key]


def act_sum(actions, types):
    s = 0.0
    for x in actions or []:
        if x.get("action_type") in types:
            try:
                s += float(x.get("value") or 0)
            except ValueError:
                pass
    return s


def discover_accounts():
    """v7.7: усі рекламні акаунти, доступні токену. Повертає список ID без «act_»."""
    out = []
    j = get(f"{BASE}/{VER}/me/adaccounts", {"access_token": TOKEN, "limit": 100,
                                             "fields": "account_id,name,currency,account_status,amount_spent"})
    while True:
        for a in j.get("data") or []:
            st = a.get("account_status")
            print(f"[META] акаунт {a.get('account_id')} «{a.get('name')}», {a.get('currency')}, статус {st}, "
                  f"витрачено за весь час {a.get('amount_spent')}")
            # 1 = активний, 2 = вимкнений, 3 = неоплата, 101 = закритий — беремо всі, крім закритих без витрат
            if st != 101 or float(a.get("amount_spent") or 0) > 0:
                out.append(str(a.get("account_id")))
        nxt = (j.get("paging") or {}).get("next")
        if not nxt:
            return out
        j = get(nxt)


def main():
    global ACCS
    if not TOKEN:
        print("[META] META_ACCESS_TOKEN не задано — пропускаю (job зелений).")
        return 0
    if not ACCS:
        try:
            ACCS = discover_accounts()
        except Exception as e:
            print(f"::error::Meta: токен не працює або немає права ads_read — {e}")
            return 1
        if not ACCS:
            print("::warning::Meta: токену не доступний жоден рекламний акаунт — перевір, що системному користувачу/"
                  "користувачу токена надано доступ до рекламних акаунтів у Business Manager")
            return 0
    old = {}
    try:
        old = json.loads(OUT.read_text(encoding="utf-8"))
    except Exception:
        pass
    keep_before = TODAY - timedelta(days=REFRESH)
    rows = [r for r in (old.get("rows") or []) if r["d"] < keep_before.isoformat()
            and r.get("aid") in {act(a).replace("act_", "") for a in ACCS}]
    have_from = {r["aid"] for r in rows}
    accounts, errors = [], []
    for acc in ACCS:
        aid = act(acc).replace("act_", "")
        start = keep_before if aid in have_from else SINCE
        n0 = len(rows)
        name, curr = None, None
        try:
            for a, b in month_chunks(start, TODAY):
                for x in insights(acc, a, b):
                    name, curr = x.get("account_name") or name, (x.get("account_currency") or curr or "UAH")
                    d = date.fromisoformat(x["date_start"])
                    spend = float(x.get("spend") or 0)
                    rate = uah_rate(curr, d)
                    rows.append({"d": d.isoformat(), "aid": aid, "a": name or aid, "cid": str(x.get("campaign_id") or ""),
                                 "c": (x.get("campaign_name") or "").strip(), "cur": curr,
                                 "spend": round(spend * rate, 2), "spendCur": round(spend, 2),
                                 "imp": int(float(x.get("impressions") or 0)), "clk": int(float(x.get("clicks") or 0)),
                                 "lead": round(act_sum(x.get("actions"), LEAD_TYPES)),
                                 "msg": round(act_sum(x.get("actions"), MSG_TYPES))})
                time.sleep(0.5)
            accounts.append({"id": aid, "name": name or aid, "currency": curr or "?"})
            print(f"[META] ✓ {name or aid}: +{len(rows) - n0} рядків з {start}")
        except Exception as e:
            errors.append(f"{aid}: {e}")
            print(f"::warning::Meta акаунт {aid}: {e}")
            # лишаємо старі дані цього акаунта, щоб не обнулити графік через тимчасову помилку
            rows += [r for r in (old.get("rows") or []) if r.get("aid") == aid and r["d"] >= keep_before.isoformat()]
    if not accounts and not rows:
        print("::error::Meta API: жоден акаунт не завантажено — " + "; ".join(errors))
        return 1
    rows.sort(key=lambda r: (r["d"], r["a"], r["c"]))
    out = {"fetched_at": datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
           "from": rows[0]["d"] if rows else None, "to": TODAY.isoformat(), "apiVersion": VER,
           "accounts": accounts or old.get("accounts") or [], "errors": errors,
           "fields": "d=дата, a=акаунт, cid/c=ID і назва кампанії, spend=витрати в грн (НБУ), spendCur=у валюті акаунта, "
                     "imp=покази, clk=кліки, lead=заявки (lead-форми/піксель), msg=почато розмов",
           "rows": rows}
    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    tot = sum(r["spend"] for r in rows)
    print(f"[META] ✓ {OUT}: {len(rows)} рядків, {len(accounts)} акаунтів, витрати {tot:,.0f} грн за {out['from']} → {out['to']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
