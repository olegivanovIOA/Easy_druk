#!/usr/bin/env python3
"""
build_seo_page.py — окремий звіт для зовнішніх SEO-підрядників.

Бере data/ga4.json і збирає ОДИН самодостатній HTML (dist/index.html):
  • лише дані Google Analytics 4 + витрати Google Ads (без Bitrix24: угод, виручки, ROAS);
  • дані зашифровані всередині сторінки: gzip → AES-256-GCM, ключ = PBKDF2-SHA256(пароль, 250 000 ітерацій);
    без пароля у вихідному коді лише шифротекст;
  • жодних посилань/згадок про репозиторій чи дашборд; noindex, robots.txt Disallow.

Секрет: SEO_REPORT_PASSWORD (мін. 10 символів).
Запуск локально:  SEO_REPORT_PASSWORD=... python seo/build_seo_page.py
"""

import base64, gzip, json, os, re, sys
from collections import defaultdict
from datetime import datetime
from pathlib import Path

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

ROOT = Path(__file__).resolve().parent.parent
SRC = Path(os.environ.get("SEO_SRC", ROOT / "data" / "ga4.json"))
TPL = Path(__file__).resolve().parent / "template.html"
OUT = Path(os.environ.get("SEO_OUT_DIR", ROOT / "dist"))
ITER = 250_000
# v6.3: назву компанії/сайту на сторінці не показуємо — посилання може потрапити будь-кому.
# Усі рядки даних проходять через anon(): бренд у джерелах/кампаніях замінюється нейтральним словом.
BRAND_RE = re.compile(r"easy\s*3\s*d\s*print|easy3d|easy_3d|ізі\s*3д|ukr3dprint|druk\w*|друкар\w*", re.I)
SERVICE_RE = [(re.compile(r"[\w.-]*bitrix[\w.-]*", re.I), "crm (реферал)"),
              (re.compile(r"[\w.-]*phonet[\w.-]*", re.I), "телефонія (реферал)")]
FORBIDDEN = ("github", "easy_druk", "olegivanov", "dashboard", "дашборд", "bitrix", "easy3d", "easy 3d", "drukar", "друкар")


def anon(v):
    if not isinstance(v, str):
        return v
    for rx, rep in SERVICE_RE:
        v = rx.sub(rep, v)
    return BRAND_RE.sub("brand", v)


def anon_all(o):
    if isinstance(o, dict):
        return {k: anon_all(v) for k, v in o.items()}
    if isinstance(o, list):
        return [anon_all(v) for v in o]
    return anon(o)


# Людські назви ключових подій (лише всередині зашифрованих даних)
EVENT_LABELS = {
    "PhonetTrackingCall": "Дзвінок (трекінг дзвінків)", "Phonet_Call requested": "Запит дзвінка",
    "Phonet_Off hours call requested": "Запит дзвінка в неробочий час", "all_forms": "Форми на сайті (усі)",
    "phone_b2b": "Телефон B2B", "Ringostat_calls": "Дзвінки (Ringostat)", "crm-form": "CRM-форма",
    "Callback_calls": "Callback-дзвінки", "Answered_Calls": "Прийняті дзвінки", "purchase": "Покупка",
    "generate_lead": "Заявка", "form_submit": "Відправка форми",
}


def r1(x):
    return round(x, 1)


def build_payload(ga):
    to = (ga.get("fetched_at") or ga.get("to") or "")[:10] or ga["to"]

    # канали GA по днях: [d, group, ses, usr, new, eng, ke]
    ch = [[r["d"], r["g"], r["ses"], r["usr"], r["new"], r["eng"], r1(r["ke"])] for r in ga.get("channels", [])]

    # source / medium по днях (без назв кампаній — для SEO не потрібні): [d, source, medium, ses, eng, ke]
    sm = defaultdict(lambda: [0, 0, 0.0])
    ads_ses = defaultdict(lambda: [0, 0.0])
    for t in ga.get("traffic", []):
        a = sm[(t["d"], t["s"], t["m"])]
        a[0] += t["ses"]; a[1] += t["eng"]; a[2] += t["ke"]
        if t["s"] == "google" and t["m"] == "cpc" and t["c"] not in ("", "(not set)"):
            b = ads_ses[(t["d"], t["c"])]
            b[0] += t["ses"]; b[1] += t["ke"]
    sm_rows = [[d, s, m, v[0], v[1], r1(v[2])] for (d, s, m), v in sorted(sm.items())]

    # Google Ads по днях × кампаніях: [d, campaign, cost, clicks, impressions] — без назви акаунта
    ads = defaultdict(lambda: [0.0, 0, 0])
    for r in ga.get("adsCost", []):
        if r.get("site"):          # v7.1: вартість інших сайтів (Ukr3d) у SEO-звіт не потрапляє
            continue
        a = ads[(r["d"], r["c"])]
        a[0] += r["cost"]; a[1] += r["clk"]; a[2] += r["imp"]
    ads_rows = [[d, c, round(v[0], 2), v[1], v[2]] for (d, c), v in sorted(ads.items())]
    ads_ses_rows = [[d, c, v[0], r1(v[1])] for (d, c), v in sorted(ads_ses.items())]

    ev = [[r["d"], r["e"], r1(r["n"])] for r in ga.get("events", [])]
    # події з групою каналу: [d, group, event, n] (є з v6.3 fetch_ga4; якщо ще немає — сторінка бере ev)
    evc = [[r["d"], r["g"], r["e"], r1(r["n"])] for r in ga.get("eventsCh", [])]
    # зрізи за 30 днів з групою каналу: [key, group, ses, eng, ke]
    bc_src = ga.get("byChannel") or {}
    bc = {k: [[r["k"], r["g"], r["ses"], r["eng"], r1(r["ke"])] for r in bc_src.get(k, [])]
          for k in ("landing", "cities", "devices")}
    bc["from"], bc["to"] = bc_src.get("from"), bc_src.get("to")

    return anon_all({
        "generated": datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
        "from": ga.get("from"), "to": to,
        "ch": ch, "sm": sm_rows, "ads": ads_rows, "adsSes": ads_ses_rows, "ev": ev, "evc": evc, "bc": bc,
        "l30": ga.get("last30") or {},
        "seo": ga.get("seo") or {},
        "evLabels": EVENT_LABELS,
    })


def encrypt(obj, password):
    raw = gzip.compress(json.dumps(obj, ensure_ascii=False, separators=(",", ":")).encode("utf-8"), 9)
    salt, iv = os.urandom(16), os.urandom(12)
    key = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=ITER).derive(password.encode("utf-8"))
    ct = AESGCM(key).encrypt(iv, raw, None)  # ct || tag — формат, який очікує WebCrypto
    b = lambda x: base64.b64encode(x).decode("ascii")
    return {"s": b(salt), "i": b(iv), "c": b(ct), "n": ITER}, len(raw)


def main():
    pw = os.environ.get("SEO_REPORT_PASSWORD", "")
    if len(pw) < 10:
        print("::error::SEO_REPORT_PASSWORD не заданий або коротший за 10 символів")
        return 1
    if not SRC.exists():
        print(f"::error::Немає {SRC} — спершу має відпрацювати update-ga4")
        return 1
    ga = json.loads(SRC.read_text(encoding="utf-8"))
    payload = build_payload(ga)
    plain = json.dumps(payload, ensure_ascii=False).lower()
    for bad in FORBIDDEN:
        if bad in plain:
            print(f"::error::У даних звіту лишилось слово «{bad}» — додай його в anon() і перезапусти")
            return 1
    enc, gz_len = encrypt(payload, pw)

    tpl = TPL.read_text(encoding="utf-8")
    assert "/*__PAYLOAD__*/null" in tpl
    html = tpl.replace("/*__PAYLOAD__*/null", json.dumps(enc, separators=(",", ":")))
    # Захист від випадкових «слідів»: у готовій сторінці не має бути згадок про репо/дашборд
    low = html.lower()
    for bad in FORBIDDEN:
        if bad in low:
            print(f"::error::У сторінці знайдено заборонене слово «{bad}» — збірку зупинено")
            return 1

    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "index.html").write_text(html, encoding="utf-8")
    (OUT / "robots.txt").write_text("User-agent: *\nDisallow: /\n", encoding="utf-8")
    (OUT / "_headers").write_text(
        "/*\n  X-Robots-Tag: noindex, nofollow, noarchive\n  Referrer-Policy: no-referrer\n"
        "  X-Frame-Options: DENY\n  Cache-Control: no-cache\n", encoding="utf-8")
    print(f"[SEO] ✓ {OUT/'index.html'}: {len(html)//1024} КБ (дані: {len(payload['ch'])} рядків каналів, "
          f"{len(payload['ads'])} рядків Ads, gzip {gz_len//1024} КБ), період {payload['from']} → {payload['to']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
