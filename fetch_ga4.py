#!/usr/bin/env python3
"""
fetch_ga4.py — Easy 3D Print Dashboard v5.1
Google Analytics 4 (ресурс easy3dprint.com.ua, 378398411) → data/ga4.json

Що забираємо (тільки агрегати, жодних даних про конкретних відвідувачів):
  adsCost   — вартість / кліки / покази Google Ads по ДНЯХ і КАМПАНІЯХ
              (для прив'язаного до GA акаунта Ads; валюта ресурсу — грн).
              Закриває головну діру ROI-таблиці: точна вартість за будь-який період.
  traffic   — сеанси / користувачі / залучені сеанси / ключові події по днях
              × source × medium × campaign (для колонок «Сеанси» і «CR» у ROI).
  channels  — те саме по стандартних групах каналів GA (Organic, Paid Search…).
  events    — ключові події по днях × назва події (форми, дзвінки, месенджери…).
  landing / cities / devices — за останні 30 днів (топ-N).

Секрети (GitHub → Settings → Secrets → Actions):
  GA4_SA_KEY       — повний JSON ключа service account (ga4-dashboard@easydash-…)
  GA4_PROPERTY_ID  — 378398411
Service account має бути доданий у GA: Admin → Property access management → Viewer.

Без секретів скрипт нічого не пише і завершується з кодом 0 (джоба зелена) —
щоб workflow не червонів, поки доступ ще налаштовується.
"""

import json, os, sys, time
from datetime import date, datetime, timedelta
from pathlib import Path

import requests

OUTPUT = Path(__file__).parent / "data" / "ga4.json"
PROPERTY_ID = (os.environ.get("GA4_PROPERTY_ID") or "").strip()
SA_KEY = (os.environ.get("GA4_SA_KEY") or "").strip()
START = os.environ.get("GA4_START", "2026-01-01")
API = "https://analyticsdata.googleapis.com/v1beta/properties/{pid}:runReport"
SCOPE = "https://www.googleapis.com/auth/analytics.readonly"
PAGE = 100000


def session():
    from google.oauth2 import service_account
    from google.auth.transport.requests import AuthorizedSession
    info = json.loads(SA_KEY)
    creds = service_account.Credentials.from_service_account_info(info, scopes=[SCOPE])
    print(f"[GA4] Service account: {info.get('client_email')}")
    return AuthorizedSession(creds)


class GA4Error(Exception):
    pass


def run_report(s, dims, metrics, start, end, limit=PAGE, order_metric=None, filter_expr=None):
    """Повертає список dict {dim: value, metric: float}. Пагінація по offset."""
    out, offset = [], 0
    while True:
        body = {
            "dateRanges": [{"startDate": start, "endDate": end}],
            "dimensions": [{"name": d} for d in dims],
            "metrics": [{"name": m} for m in metrics],
            "limit": limit, "offset": offset,
            "keepEmptyRows": False,
        }
        if order_metric:
            body["orderBys"] = [{"metric": {"metricName": order_metric}, "desc": True}]
        if filter_expr:
            body["metricFilter"] = filter_expr
        r = s.post(API.format(pid=PROPERTY_ID), json=body, timeout=60)
        if r.status_code != 200:
            try:
                err = r.json().get("error", {})
            except Exception:
                err = {"message": r.text[:300]}
            raise GA4Error(f"{r.status_code} {err.get('status', '')}: {err.get('message', '')}")
        p = r.json()
        dh = [h["name"] for h in p.get("dimensionHeaders", [])]
        mh = [h["name"] for h in p.get("metricHeaders", [])]
        rows = p.get("rows", []) or []
        for row in rows:
            rec = {dh[i]: v.get("value", "") for i, v in enumerate(row.get("dimensionValues", []))}
            for i, v in enumerate(row.get("metricValues", [])):
                try:
                    rec[mh[i]] = float(v.get("value") or 0)
                except ValueError:
                    rec[mh[i]] = 0.0
            out.append(rec)
        total = int(p.get("rowCount", 0) or 0)
        offset += len(rows)
        if not rows or offset >= total or limit < PAGE:
            break
        time.sleep(0.3)
    return out


def try_report(s, variants, metrics, start, end, label, **kw):
    """variants — список наборів вимірів від найповнішого до мінімального.
    Деякі виміри можуть бути несумісні з метриками Ads — тоді пробуємо простіший."""
    last = None
    for dims in variants:
        try:
            rows = run_report(s, dims, metrics, start, end, **kw)
            print(f"[GA4] ✓ {label}: {len(rows)} рядків (виміри: {', '.join(dims)})")
            return rows, dims
        except GA4Error as e:
            last = e
            msg = str(e)
            if "PERMISSION_DENIED" in msg or msg.startswith("403"):
                raise
            print(f"[GA4] ⚠ {label} з вимірами {dims}: {msg}")
    print(f"[GA4] ✗ {label}: не вдалося ({last})")
    return [], None


def d8(v):
    """GA повертає дату як YYYYMMDD."""
    return f"{v[:4]}-{v[4:6]}-{v[6:8]}" if len(v) == 8 and v.isdigit() else v


def r2(x):
    return round(x, 2)


def main():
    if not PROPERTY_ID or not SA_KEY:
        print("[GA4] ⏭ GA4_PROPERTY_ID / GA4_SA_KEY не задані — пропускаю (налаштуй секрети в GitHub)")
        return 0
    try:
        json.loads(SA_KEY)
    except Exception:
        print("::error::GA4_SA_KEY — не валідний JSON. Встав увесь вміст файлу ключа, від { до }.")
        return 1

    s = session()
    today = date.today().isoformat()
    d30 = (date.today() - timedelta(days=29)).isoformat()
    res = {"fetched_at": datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
           "property": PROPERTY_ID, "from": START, "to": today, "currency": "UAH"}

    try:
        # ── 1. Вартість Google Ads по днях × кампаніях ──
        rows, dims = try_report(
            s,
            [["date", "sessionGoogleAdsCampaignName", "sessionGoogleAdsAccountName"],
             ["date", "sessionGoogleAdsCampaignName"],
             ["date", "sessionCampaignName"]],
            ["advertiserAdCost", "advertiserAdClicks", "advertiserAdImpressions"], START, today, "Вартість Ads")
        camp_dim = dims[1] if dims else None
        acc_dim = dims[2] if dims and len(dims) > 2 else None
        res["adsCost"] = [
            {"d": d8(r["date"]), "c": r.get(camp_dim, ""), "a": r.get(acc_dim, "") if acc_dim else "",
             "cost": r2(r["advertiserAdCost"]), "clk": int(r["advertiserAdClicks"]), "imp": int(r["advertiserAdImpressions"])}
            for r in rows
            if r.get(camp_dim) not in ("", "(not set)") and (r["advertiserAdCost"] or r["advertiserAdClicks"])]
        res["adsCost"].sort(key=lambda x: (x["d"], x["c"]))
    except GA4Error as e:
        if "PERMISSION_DENIED" in str(e) or str(e).startswith("403"):
            print(f"::error::GA4: немає доступу до ресурсу {PROPERTY_ID}. Додай service account у GA → "
                  f"Admin → Property access management з роллю Viewer і перевір, що Google Analytics Data API "
                  f"увімкнено в проєкті Google Cloud. ({e})")
            return 1
        raise

    # ── 2. Трафік по днях × source × medium × campaign ──
    key_metric = "keyEvents"
    rows, dims = try_report(s, [["date", "sessionSource", "sessionMedium", "sessionCampaignName"]],
                            ["sessions", "totalUsers", "engagedSessions", "keyEvents"], START, today, "Трафік")
    if not dims:  # дуже старі ресурси без keyEvents у API
        key_metric = "conversions"
        rows, dims = try_report(s, [["date", "sessionSource", "sessionMedium", "sessionCampaignName"]],
                                ["sessions", "totalUsers", "engagedSessions", "conversions"], START, today, "Трафік (conversions)")
    res["traffic"] = [
        {"d": d8(r["date"]), "s": r["sessionSource"], "m": r["sessionMedium"], "c": r["sessionCampaignName"],
         "ses": int(r["sessions"]), "usr": int(r["totalUsers"]), "eng": int(r["engagedSessions"]), "ke": r2(r[key_metric])}
        for r in rows if r.get("sessions")]
    res["traffic"].sort(key=lambda x: (x["d"], -x["ses"]))

    # ── 3. Групи каналів GA по днях ──
    rows, _ = try_report(s, [["date", "sessionDefaultChannelGroup"]],
                         ["sessions", "totalUsers", "newUsers", "engagedSessions", key_metric], START, today, "Канали GA")
    res["channels"] = sorted(
        [{"d": d8(r["date"]), "g": r["sessionDefaultChannelGroup"], "ses": int(r["sessions"]), "usr": int(r["totalUsers"]),
          "new": int(r["newUsers"]), "eng": int(r["engagedSessions"]), "ke": r2(r[key_metric])} for r in rows],
        key=lambda x: (x["d"], -x["ses"]))

    # ── 4. Ключові події по днях × назва події ──
    rows, _ = try_report(s, [["date", "eventName"]], [key_metric], START, today, "Ключові події")
    res["events"] = sorted([{"d": d8(r["date"]), "e": r["eventName"], "n": r2(r[key_metric])} for r in rows if r[key_metric] > 0],
                           key=lambda x: (x["d"], x["e"]))

    # ── 5. Зрізи за 30 днів (топ-N) ──
    def top(dim, label, n):
        rows, _ = try_report(s, [[dim]], ["sessions", "engagedSessions", key_metric], d30, today, label,
                             limit=n, order_metric="sessions")
        return [{"k": r[dim], "ses": int(r["sessions"]), "eng": int(r["engagedSessions"]), "ke": r2(r[key_metric])} for r in rows]

    res["last30"] = {"from": d30, "to": today,
                     "landing": top("landingPage", "Посадкові сторінки", 30),
                     "cities": top("city", "Міста", 25),
                     "devices": top("deviceCategory", "Пристрої", 5)}

    tot_cost = sum(r["cost"] for r in res["adsCost"])
    tot_ses = sum(r["ses"] for r in res["traffic"])
    print(f"[GA4] Разом з {START}: вартість Ads {tot_cost:,.0f} грн, сеансів {tot_ses:,}, "
          f"ключових подій {sum(r['n'] for r in res['events']):,.0f}")
    if not res["adsCost"]:
        print("[GA4] ℹ Вартості Ads немає: перевір, що акаунт Ads прив'язаний до GA (Admin → Product links → Google Ads links).")

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(res, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"[GA4] ✓ Записано {OUTPUT} ({OUTPUT.stat().st_size // 1024} КБ)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
