#!/usr/bin/env python3
"""
build_mkt_report.py — зовнішній звіт «Маркетинг» для SEO-підрядників (v7.31).

Звіт = вкладка «Маркетинг» дашборда ОДИН-В-ОДИН: та сама розмітка, стилі й ті самі JS-модулі
(ROI кампаній, воронка, retention, канали, GA4, Google Ads, MQL→SQL, ТОП клієнтів), з тими самими даними
й сумами. v7.31: наші сайти (EASY / easy3dprint.com.ua, Ukr3d / ukr3dprint.com) і URL сторінок показуються
як є, так само ID акаунтів Google Ads і ресурсів GA4 — звіт закритий паролем, SEO-підрядникам потрібні реальні дані.
Як і раніше приховано: пошта, імена співробітників, назва DRUKAR, згадки про репозиторій/дашборд/CRM-вендора.
Клієнти в даних і так лише псевдоніми (#hex).

Безпека:
  • усе (розмітка, код, дані) — в одному зашифрованому пакеті: gzip → AES-256-GCM, ключ = PBKDF2-SHA256(пароль, 250 000);
    без пароля сторінка містить лише екран входу і шифротекст;
  • коментарі з коду прибираються (terser), після анонімізації пакет перевіряється на заборонені слова —
    знайдено хоч одне → збірка зупиняється й нічого не викладається;
  • noindex, robots.txt Disallow, X-Robots-Tag.

Секрет: SEO_REPORT_PASSWORD (мін. 10 символів). Локально: SEO_REPORT_PASSWORD=... python seo/build_mkt_report.py
"""

import base64, gzip, json, os, re, shutil, subprocess, sys, tempfile
from datetime import datetime, timezone
from pathlib import Path

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

ROOT = Path(__file__).resolve().parent.parent
SHELL = Path(__file__).resolve().parent / "mkt_shell.html"
OUT = Path(os.environ.get("SEO_OUT_DIR", ROOT / "dist"))
ITER = 250_000

# модулі вкладки «Маркетинг» — у тому ж порядку, що й в index.html
JS_FILES = ["js/freshness.js", "js/table_sort.js", "js/ads_loader.js", "js/mql_loader.js", "js/channels_loader.js",
            "js/ga4_loader.js", "js/mkt_split.js", "js/leadgen_loader.js",
            "js/global_period.js"]   # v7.37: один фільтр періоду (Рік / Місяць у шапці звіту), як на дашборді
DATA_FILES = ["ga4", "crm_deals", "crm_monthly_history", "clients", "marketing_rules", "meta_ads", "pnl", "ads", "mql_sql"]

# ── анонімізація: однаково для розмітки, коду й даних (щоб зіставлення назв у коді не зламались) ──
REPL = [
    (re.compile(r"[\w.-]*bitrix[\w.-]*\.(?:com|ua|eu)[\w./-]*", re.I), "crm (реферал)"),
    (re.compile(r"[\w.-]*phonet[\w.-]*\.(?:com|ua)[\w./-]*", re.I), "телефонія (реферал)"),
    (re.compile(r"[\w.+-]+@(?:gmail\.com|[\w-]*(?:easy|ukr3d|druk)[\w.-]*)", re.I), "пошта компанії"),
    # v7.31: назви й домени сайтів (EASY / Ukr3d, easy3dprint…, ukr3dprint…) і слаги «3d-druk-…» НЕ маскуються
    (re.compile(r"drukar\w*|\bдрукар\w*", re.I), "brand"),
    # v7.31: ID акаунтів Google Ads і ресурсів GA4 показуються як є (звіт під паролем)
    (re.compile(r"Bitrix\s*24|Bitrix", re.I), "CRM"),
    (re.compile(r"репозиторі\w*\s+дашборд\w*\s+публічн\w*", re.I), "звіт без назв"),
    (re.compile(r"дашборд\w*", re.I), "звіт"),
    (re.compile(r"репозиторі\w*", re.I), "налаштуваннях"),
    (re.compile(r"\b(?:Easy 3D Print )?Dashboard\b", re.I), "report"),
    (re.compile(r"GitHub(?:\s*Actions)?", re.I), "планувальник"),
    (re.compile(r"\b(?:Олег|Влад|Вадим)\w*"), "команда"),
]
# після анонімізації цих слів у пакеті бути не може (інакше збірка зупиняється)
FORBIDDEN = ("github", "easy_druk", "olegivanov", "dashboard", "дашборд", "bitrix",
             "drukar", "друкар", "репозитор")


def anon(s):
    for rx, to in REPL:
        s = rx.sub(to, s)
    return s


def anon_all(o):
    if isinstance(o, dict):
        return {anon(k) if isinstance(k, str) else k: anon_all(v) for k, v in o.items()}
    if isinstance(o, list):
        return [anon_all(v) for v in o]
    return anon(o) if isinstance(o, str) else o


def strip_comments(code, name):
    """Прибирає коментарі через terser (без стиснення й перейменувань — поведінка коду не змінюється)."""
    npx = shutil.which("npx")
    if not npx:
        raise RuntimeError("немає npx (Node.js) — потрібен для terser")
    with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False, encoding="utf-8") as f:
        f.write(code); src = f.name
    try:
        p = subprocess.run([npx, "--yes", "terser@5.31.6", src, "--comments", "false"],
                           capture_output=True, text=True, timeout=300)
        if p.returncode != 0 or not p.stdout.strip():
            raise RuntimeError(f"terser {name}: {p.stderr[:300]}")
        return p.stdout
    finally:
        os.unlink(src)


def marketing_panel(index_html):
    css = re.search(r"<style>(.*?)</style>", index_html, re.S).group(1)
    a = index_html.index('<div class="panel" id="panel-crm">')
    b = index_html.index('<div class="panel" id="panel-fin">')
    html = index_html[a:b].replace('<div class="panel" id="panel-crm">', '<div class="panel active" id="panel-crm">', 1)
    # шапка з фільтрами року/місяця дашборда тут не потрібна — у блоків свої перемикачі періоду
    css += "\n.panel{padding:14px 18px 48px}\n"
    return css, html


INIT = r"""
Chart.defaults.font.family='Inter'; Chart.defaults.font.size=10;
Chart.defaults.color='#6b836a'; Chart.defaults.borderColor='#e6e9e3';
(function(){ try{ if(window.AdsLoader) AdsLoader.load(); }catch(e){console.warn(e);}
  try{ if(window.MqlLoader) MqlLoader.load(); }catch(e){console.warn(e);}
  try{ if(window.ChannelsLoader) ChannelsLoader.load(); }catch(e){console.warn(e);}
  try{ if(window.LeadgenLoader) LeadgenLoader.load(); }catch(e){console.warn(e);} })();
"""


def encrypt(obj, password):
    raw = gzip.compress(json.dumps(obj, ensure_ascii=False, separators=(",", ":")).encode("utf-8"), 9)
    salt, iv = os.urandom(16), os.urandom(12)
    key = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=ITER).derive(password.encode("utf-8"))
    ct = AESGCM(key).encrypt(iv, raw, None)
    b = lambda x: base64.b64encode(x).decode("ascii")
    return {"s": b(salt), "i": b(iv), "c": b(ct), "n": ITER}, len(raw)


def main():
    pw = os.environ.get("SEO_REPORT_PASSWORD", "")
    if len(pw) < 10:
        print("::error::SEO_REPORT_PASSWORD не заданий або коротший за 10 символів")
        return 1
    index_html = (ROOT / "index.html").read_text(encoding="utf-8")
    css, html = marketing_panel(index_html)
    js = []
    for f in JS_FILES:
        js.append(anon(strip_comments((ROOT / f).read_text(encoding="utf-8"), f)))
    js.append(INIT)
    files, missing = {}, []
    for n in DATA_FILES:
        p = ROOT / "data" / f"{n}.json"
        if p.exists():
            files[f"data/{n}.json"] = anon_all(json.loads(p.read_text(encoding="utf-8")))
        else:
            missing.append(n)
    payload = {"generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
               "css": anon(css), "html": anon(html), "js": js, "files": files}

    plain = json.dumps(payload, ensure_ascii=False).lower()
    bad = [w for w in FORBIDDEN if w in plain]
    if bad:
        for w in bad:
            i = plain.index(w)
            print(f"::error::У звіті лишилось «{w}»: …{plain[max(0, i - 80):i + 60]}…")
        return 1

    enc, gz = encrypt(payload, pw)
    shell = SHELL.read_text(encoding="utf-8")
    assert "/*__PAYLOAD__*/null" in shell
    page = shell.replace("/*__PAYLOAD__*/null", json.dumps(enc, separators=(",", ":")))
    low = page.lower()
    for w in FORBIDDEN:
        if w in low:
            print(f"::error::У сторінці знайдено заборонене слово «{w}» — збірку зупинено")
            return 1

    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "index.html").write_text(page, encoding="utf-8")
    (OUT / "robots.txt").write_text("User-agent: *\nDisallow: /\n", encoding="utf-8")
    (OUT / "_headers").write_text(
        "/*\n  X-Robots-Tag: noindex, nofollow, noarchive\n  Referrer-Policy: no-referrer\n"
        "  X-Frame-Options: DENY\n  Cache-Control: no-cache\n", encoding="utf-8")
    print(f"[SEO] ✓ {OUT / 'index.html'}: {len(page) // 1024} КБ (gzip-пакет {gz // 1024} КБ), "
          f"модулів {len(JS_FILES)}, файлів даних {len(files)}{' (немає: ' + ', '.join(missing) + ')' if missing else ''}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
