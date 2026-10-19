/**
 * leadgen_loader.js — Easy 3D Print Dashboard v7.0 (ROI кампаній + ROMI + LTV реклами; v7.0: фільтр акаунтів
 *   EASY / Ukr3d / Meta, «маркетинг / не маркетинг», витрати Meta, деталізація рядка по днях/місяцях)
 * Вкладка «Маркетинг» → «Лідогенерація, ROI кампаній та retention».
 *
 * Замінює ручний Looker Studio-звіт тими самими показниками, але з живих даних:
 *   - crm_deals.json / crm_monthly_history.json → cohort (угоди, СТВОРЕНІ в місяці):
 *       воронка кваліфікації, UTM-кампанії (нові угоди, очікувана і фактична сума),
 *       retention (клієнти, що повернулись / повторні покупці), завислі великі угоди
 *   - ads.json → вартість/кліки по кампаніях Google Ads (акаунт EASY, скрипт Вадима)
 * Персональних даних немає — тільки агрегати.
 */
window.LeadgenLoader = (() => {
  const G = '#2A9D8F', GD = '#1e7a6e', WH = '#3D7EA6', RT = '#C98A2B', R = '#C0392B', GRID = '#f0f2ee';
  let _cur = null, _hist = null, _ads = null, _charts = {};

  const fmt = n => n == null ? '—' : Math.abs(n) >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : Math.abs(n) >= 1e3 ? (n / 1e3).toFixed(0) + 'K' : String(Math.round(n));
  const pct = (a, b) => (b ? (a / b * 100) : null);
  const p1 = v => v == null ? '—' : v.toFixed(1) + '%';
  const $ = id => document.getElementById(id);

  function chart(id, cfg) {
    const c = $(id); if (!c) return;
    if (_charts[id]) { try { _charts[id].destroy(); } catch (e) {} }
    _charts[id] = new Chart(c, cfg);
  }

  async function load() {
    const root = $('mkt-leadgen-root'); if (!root) return;
    try {
      [_cur, _hist, _ads] = await Promise.all([
        fetch('data/crm_deals.json?t=' + Date.now()).then(r => r.ok ? r.json() : null),
        fetch('data/crm_monthly_history.json?t=' + Date.now()).then(r => r.ok ? r.json() : null).catch(() => null),
        fetch('data/ads.json?t=' + Date.now()).then(r => r.ok ? r.json() : null).catch(() => null),
        fetch('data/ads_campaigns_daily.json?t=' + Date.now()).then(r => r.ok ? r.json() : null).catch(() => null),
        fetch('data/ga4.json?t=' + Date.now()).then(r => r.ok ? r.json() : null).catch(() => null),
        fetch('data/clients.json?t=' + Date.now()).then(r => r.ok ? r.json() : null).catch(() => null),
        fetch('data/pnl.json?t=' + Date.now()).then(r => r.ok ? r.json() : null).catch(() => null),
        fetch('data/meta_ads.json?t=' + Date.now()).then(r => r.ok ? r.json() : null).catch(() => null),
        fetch('data/marketing_rules.json?t=' + Date.now()).then(r => r.ok ? r.json() : null).catch(() => null),
      ]).then(([a, b, c, d, g, cl, pl, mt, ru]) => {
        _adsDaily = d; _ga = g; _cl = cl; _pnl = pl; _meta = mt;
        if (window.MktSplit) MktSplit.setRules(ru);
        return [a, b, c];
      });
    } catch (e) { console.warn('[Leadgen]', e); }
    const months = monthsWithCohort();
    const ts = $('mkt-leadgen-updated');
    if (ts && window.E3DFresh) ts.innerHTML = E3DFresh.html([{ ts: _cur && _cur.fetched_at, label: 'Bitrix24' }, { ts: _ads && _ads.fetched_at, label: 'Google Ads' }]);
    if (!months.length) {
      root.innerHTML = `<div class="al al-b" style="font-size:11px"><div>ℹ Блок з'явиться після наступного запуску <b>update-crm</b> (v4.6 рахує угоди, створені в місяці: воронку, UTM-кампанії, retention).
        Для історії з січня — один раз запусти <b>Backfill CRM Monthly History</b>.</div></div>`;
      return;
    }
    const sel = $('mkt-leadgen-period');
    if (sel) {
      sel.innerHTML = months.slice().reverse().map(m => `<option value="${m.month}">${m.month}${m.complete === false ? ' (триває)' : ''}</option>`).join('');
      sel.onchange = render;
    }
    // ROI-таблиця має власний період і не залежить від графіків нижче
    try { initRoi(); renderRoi(); } catch (e) { console.warn('[Leadgen ROI]', e); }
    render();
  }

  function monthsWithCohort() {
    const map = {};
    ((_hist && _hist.months) || []).forEach(m => { if (m.cohort) map[m.month] = m; });
    if (_cur && _cur.cohort) map[_cur.month] = _cur;
    return Object.values(map).sort((a, b) => a.month.localeCompare(b.month));
  }

  function render() {
    const months = monthsWithCohort();
    const sel = $('mkt-leadgen-period');
    const key = sel ? sel.value : months[months.length - 1].month;
    const idx = months.findIndex(m => m.month === key);
    const m = months[idx], prev = idx > 0 ? months[idx - 1] : null;
    renderFunnel(m.cohort, prev && prev.cohort, m);
    renderRetention(m.cohort, prev && prev.cohort);
    renderStale(m.cohort);
    renderTrend(months);
  }

  function delta(cur, prev) {
    if (cur == null || prev == null || !prev) return '';
    const d = (cur - prev) / prev * 100;
    return `<span style="font-size:9px;color:${d >= 0 ? GD : R};margin-left:4px">${d >= 0 ? '▲' : '▼'}${Math.abs(d).toFixed(0)}%</span>`;
  }

  // ── 1. Воронка кваліфікації лідів ──
  function renderFunnel(c, pc, m) {
    const el = $('mkt-leadgen-funnel'); if (!el) return;
    const f = c.funnel, pf = pc && pc.funnel;
    const steps = [
      ['Усі звернення', 'all', 'усі угоди 4 воронок, створені в місяці'],
      ['Без дублів і тестів', 'clean', c.definitions && c.definitions.clean],
      ['Кваліфіковані', 'qualified', c.definitions && c.definitions.qualified],
      ['В роботі + успішні', 'activeOrWon', 'не відмовлені'],
      ['Успішні (WON)', 'won', c.definitions && c.definitions.won],
    ];
    el.innerHTML = `<div style="display:grid;grid-template-columns:repeat(5,1fr);gap:8px">` + steps.map(([lbl, k, tip], i) => {
      const v = f[k], prevStep = i ? f[steps[i - 1][1]] : null;
      const conv = i ? pct(v, prevStep) : null;
      const w = f.all ? Math.max(8, v / f.all * 100) : 0;
      return `<div class="krow" style="flex-direction:column;align-items:flex-start;gap:4px;padding:10px 12px" title="${tip || ''}">
        <div class="krow-lbl" style="white-space:normal">${lbl}</div>
        <div style="font-size:20px;font-weight:800;color:var(--tx)">${v.toLocaleString('uk-UA')}${delta(v, pf && pf[k])}</div>
        <div style="height:5px;width:100%;background:var(--bd);border-radius:3px"><div style="height:5px;width:${w}%;background:${i === 4 ? G : WH};border-radius:3px"></div></div>
        <div style="font-size:10px;color:var(--tl)">${i ? 'з попер. кроку: <b>' + p1(conv) + '</b>' : m.month + (m.complete === false ? ' · триває' : '')}</div>
      </div>`;
    }).join('') + `</div>
      <div style="font-size:10px;color:var(--tl);margin-top:6px">Очікувана сума (в роботі + успішні): <b>${fmt(f.expectedSumActiveWon)} грн</b> · фактична (WON): <b>${fmt(f.wonSum)} грн</b> · наскрізна конверсія звернення→WON: <b>${p1(pct(f.won, f.all))}</b>${delta(pct(f.won, f.all), pf && pct(pf.won, pf.all))}</div>`;
  }

  // ── 2. Retention ──
  function renderRetention(c, pc) {
    const el = $('mkt-leadgen-retention'); if (!el) return;
    const r = c.retention, pr = pc && pc.retention;
    const retShareDeals = pct(r.returning.deals, r.returning.deals + r.new.deals);
    const repeatShareRev = pct(r.repeatPurchase.wonSum, c.funnel.wonSum);
    const tile = (lbl, val, sub, tip, color) => `<div class="krow" style="flex-direction:column;align-items:flex-start;gap:3px;padding:10px 12px" title="${tip}">
      <div class="krow-lbl" style="white-space:normal">${lbl}</div><div style="font-size:18px;font-weight:800;color:${color || 'var(--tx)'}">${val}</div><div style="font-size:10px;color:var(--tl)">${sub}</div></div>`;
    el.innerHTML = `<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px">` +
      tile('Звернення від клієнтів, що повернулись', p1(retShareDeals), `${r.returning.deals} з ${r.returning.deals + r.new.deals} угод`, c.definitions.returning) +
      tile('Частка WON-виручки від повторних покупців', p1(repeatShareRev), `${fmt(r.repeatPurchase.wonSum)} з ${fmt(c.funnel.wonSum)} грн`, c.definitions.repeatPurchase, GD) +
      tile('Win-rate: повернулись vs нові', `${p1(r.returning.winRate)} / ${p1(r.new.winRate)}`, 'WON / (WON + відмови)', 'Серед закритих угод місяця') +
      tile('Угоди без прив\'язки до клієнта', String(r.noClientLinked), 'без компанії/контакту в Bitrix — не рахуються в retention', 'Такі угоди не можна віднести ні до нових, ні до тих, що повернулись', r.noClientLinked > 50 ? RT : null) +
      `</div>`;
  }

  // ── 3. ROI кампаній: Google Ads (вартість) × Bitrix (угоди/виручка за UTM) ──
  // v5.0: власний період (день / кілька днів / місяць / рік), колонка «Канал»
  // (google / facebook / instagram / …, після «/» — акаунт), сортування колонок,
  // підсумковий рядок і розгорнуте пояснення формул (CPL/CAC/ROAS).
  const ROI_LS = 'e3d_roi_period_v1', ROI_SORT_LS = 'e3d_roi_sort_v1', ROI_F_LS = 'e3d_roi_filter_v1';
  let _roiF = { ch: [], paid: false, q: '', acc: 'all', cls: 'all' };
  let _roi = null, _roiSort = { k: 'wonSum', dir: -1 }, _adsDaily = null, _ga = null, _cl = null, _pnl = null, _mgn = null, _meta = null;
  const _roiOpen = new Set();   // v7.0: розгорнуті рядки (деталізація)
  // v6.3: маржа для ROMI — за замовчуванням валова маржа з P&L (з початку року), можна змінити в полі над таблицею
  const MGN_LS = 'e3d_roi_margin_v1';
  // v6.4: старі назви utm_campaign / кампаній → поточна назва кампанії в Google Ads (від маркетолога, 17.10.2026).
  // [нова назва, акаунт або null]. Для ukr3d акаунт окремий — щоб клієнти не змішувались із витратами EASY
  // на кампанію з тією ж назвою (вартість ukr3d у GA4 поки не приходить).
  const CAMP_ALIAS = {
    '3D_print_Kharkiv_new': ['search_3d_print_Kharkiv', null],
    '3D_print_Kyiv_General': ['search_3d_print_Kyiv', null],
    'B2B_convers': ['search_3d_print_Main', null],
    'Pmax_old_new': ['performance_max', null],
    'DSA_UA_UA_NEW': ['search_dynamic_Main', null],
    'Remarketing_b2b': ['remarketing_b2b', null],
    'Brand_UA_new': ['search_brand_Main', null],
    'Search_new_ukr': ['search_3d_print_Main', 'ukr3d'],
    'Brand_ukr': ['search_brand_Main', 'ukr3d'],
    'Search_miltech': ['search_miltech_Main', 'ukr3d'],
  };
  // v7.1: будь-яка назва акаунта Ukr3d (ukr3dprint.com, ukr3d…) → 'ukr3d', як в аліасах кампаній
  const accNorm = a => /ukr/i.test(a || '') ? 'ukr3d' : (a || 'GA');
  const campOf = uc => CAMP_ALIAS[uc] ? CAMP_ALIAS[uc][0] : uc;
  // канал/акаунт/назва для рядка Bitrix (UTM): google-кампанії — з урахуванням аліасів і акаунта з GA4
  const bxKey = (c, uc, ads) => {
    const al = CAMP_ALIAS[uc], name = al ? al[0] : (uc || '');
    if (c.ch === 'google' && name) {
      if (al && al[1]) c.acc = al[1];
      else if (ads.known.has(name)) c.acc = (ads.accOf || {})[name] || 'EASY';
    }
    return name;
  };
  const defMargin = () => { const y = _pnl && _pnl.ytd && _pnl.ytd.gross_margin_pct; return y ? +y : 30; };
  const marginPct = () => { if (_mgn == null) { const v = lsGet(MGN_LS, null); _mgn = v != null && isFinite(v) && v > 0 ? +v : defMargin(); } return _mgn; };

  const iso = d => d.toISOString().slice(0, 10);
  const today = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return iso(d); };
  const addDays = (s, n) => { const d = new Date(s + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
  const lastDay = ym => { const [y, m] = ym.split('-').map(Number); return iso(new Date(Date.UTC(y, m, 0))); };
  const lsGet = (k, def) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : def; } catch (e) { return def; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };

  function roiRange() {
    const r = _roi, t = today();
    let a, b;
    if (r.mode === 'day') [a, b] = [r.day, r.day];
    else if (r.mode === 'range') [a, b] = r.from <= r.to ? [r.from, r.to] : [r.to, r.from];
    else if (r.mode === 'month') [a, b] = [r.month + '-01', lastDay(r.month)];
    else [a, b] = [r.year + '-01-01', r.year + '-12-31'];
    return [a, b > t && a <= t ? t : b];   // поточний місяць/рік — до сьогодні
  }

  // Канал: utm_source → google / facebook / instagram / meta…; без UTM — поле «Джерело».
  function channelOf(us, sid, srcNames) {
    const u = (us || '').trim(), l = u.toLowerCase();
    if (u) {
      if (/google|adwords|gads|youtube/.test(l)) return { ch: l.includes('youtube') ? 'youtube' : 'google', acc: '' };
      if (/^(fb|facebook)$|facebook\.com|^meta$/.test(l)) return { ch: 'facebook', acc: '' };
      if (/^(ig|insta|instagram)$|instagram\.com/.test(l)) return { ch: 'instagram', acc: '' };
      if (/^\d{8,}$/.test(l)) return { ch: 'meta', acc: u };            // ID рекламного акаунта/кампанії Meta
      if (/tiktok/.test(l)) return { ch: 'tiktok', acc: '' };
      if (/telegram|^t\.me|^tg$/.test(l)) return { ch: 'telegram', acc: '' };
      if (/linkedin|lnkd/.test(l)) return { ch: 'linkedin', acc: '' };
      if (/chatgpt|openai/.test(l)) return { ch: 'chatgpt', acc: '' };
      if (/bing/.test(l)) return { ch: 'bing', acc: '' };
      if (/prom\.ua|olx|rozetka/.test(l)) return { ch: 'маркетплейс', acc: u };
      if (l === '(not set)' || l === 'test') return { ch: l, acc: '' };
      return { ch: 'реферал', acc: u };
    }
    const name = (srcNames[sid] || sid || '').trim(), n = name.toLowerCase();
    const rest = (re) => name.replace(re, '').trim();
    if (!name) return { ch: 'не вказано', acc: '' };
    if (n.includes('instagram')) return { ch: 'instagram', acc: rest(/instagram/i) };
    if (n.includes('facebook')) return { ch: 'facebook', acc: rest(/facebook/i) };
    if (/звон|call|дзвін/.test(n)) return { ch: 'дзвінок', acc: '' };
    const em = name.match(/[\w.+-]+@[\w.-]+/);
    if (/почт|e-?mail|пошт/.test(n) || em) return { ch: 'email', acc: em ? em[0] : '' };
    if (/сайт|web|site/.test(n) && !/форм/.test(n)) return { ch: 'сайт', acc: rest(/сайт|веб-сайт/ig) };
    if (/форм|webform|онлайн/.test(n)) return { ch: 'форма', acc: name };
    if (/рекоменд/.test(n)) return { ch: 'рекомендація', acc: '' };
    if (/повтор|существ|існуюч|partner/.test(n)) return { ch: 'існуючий клієнт', acc: '' };
    if (/холод/.test(n)) return { ch: 'холодний продаж', acc: '' };
    return { ch: 'інше', acc: name };
  }

  // Bitrix-частина за період: щоденні рядки (byCampaignDaily), або місячна
  // розбивка, якщо місяць повністю в періоді і щоденної ще немає (до бекфілу).
  function bitrixRows(from, to) {
    const months = monthsWithCohort(), srcNames = {}, out = [], gaps = [];
    months.forEach(m => (m.cohort.bySource || []).forEach(s => { if (s.key && s.key !== '—') srcNames[s.key] = s.name; }));
    months.forEach(m => {
      const mFrom = m.month + '-01', mTo = lastDay(m.month);
      if (mTo < from || mFrom > to) return;
      const daily = m.cohort.byCampaignDaily;
      if (daily) {
        daily.forEach(r => { if (r.d >= from && r.d <= to) out.push({ d: r.d, us: r.us, uc: r.uc, s: r.s, n: r.n, e: r.e, w: r.w, ws: r.ws }); });
      } else if (mFrom >= from && mTo <= to) {
        (m.cohort.byCampaign || []).forEach(c => {
          const [us, uc] = c.key.split(' / ');
          out.push({ d: mFrom, us: us === '—' ? '' : us, uc: uc === '—' ? '' : uc, s: '', n: c.deals, e: c.expectedSum, w: c.won, ws: c.wonSum });
        });
      } else gaps.push(m.month);
    });
    return { rows: out, srcNames, gaps };
  }

  // Вартість Google Ads за період → {campaign: {cost, clicks}}, + прапорці точності.
  function adsCost(from, to) {
    const all = (_ads && _ads.analytics && _ads.analytics.all) || [];
    const known = new Set(all.map(c => c.campaign));
    // 0) v5.1: Google Analytics 4 — вартість Ads по днях і кампаніях (точно, у грн)
    const gaCost = (_ga && _ga.adsCost) || [];
    if (gaCost.length) {
      const gMin = _ga.from || gaCost[0].d, gMax = (_ga.fetched_at || '').slice(0, 10) || gaCost[gaCost.length - 1].d;
      const map = {}, accOf = {};
      // v7.1: ключ — акаунт + кампанія (у EASY і Ukr3d є кампанії з однаковими назвами); accOf — для Bitrix-рядків без аліаса,
      // при збігу назв перевага акаунту EASY
      gaCost.forEach(r => { const c = campOf(r.c), a = accNorm(r.a); if (!accOf[c] || /ukr/i.test(accOf[c])) accOf[c] = a; known.add(c); });
      gaCost.filter(r => r.d >= from && r.d <= to).forEach(r => {
        const c = campOf(r.c), ac = accNorm(r.a), k = ac + '|' + c, a = map[k] || (map[k] = { cost: 0, clicks: 0, camp: c, acc: ac }); a.cost += r.cost || 0; a.clicks += r.clk || 0;
      });
      return { map, known, accOf, mode: 'ga', scale: 1, partial: from < gMin || to > gMax, dMin: gMin, dMax: gMax,
               cFrom: from < gMin ? gMin : from, cTo: to > gMax ? gMax : to };
    }
    // 1) точні щоденні дані по кампаніях (лист «campaigns» → data/ads_campaigns_daily.json)
    const daily = (_adsDaily && _adsDaily.rows) || [];
    if (daily.length) {
      const dMin = daily[0].date, dMax = daily[daily.length - 1].date;
      const inR = daily.filter(r => r.date >= from && r.date <= to);
      const clk = inR.reduce((s, r) => s + (r.clicks || 0), 0), cst = inR.reduce((s, r) => s + (r.cost_uah || 0), 0);
      const scale = (clk > 200 && cst / clk < 0.5) ? 1000 : 1;
      const map = {};
      inR.forEach(r => { const c = campOf(r.campaign), a = map[c] || (map[c] = { cost: 0, clicks: 0, camp: c, acc: 'EASY' }); a.cost += (r.cost_uah || 0) * scale; a.clicks += r.clicks || 0; known.add(c); });
      return { map, known, mode: 'daily', scale, partial: from < dMin || to > dMax, dMin, dMax, cFrom: from < dMin ? dMin : from, cTo: to > dMax ? dMax : to };
    }
    // 2) наближення: 30-денна вартість кампанії × частка кліків періоду (денна воронка)
    const fun = (_ads && _ads.funnel) || [];
    if (!all.length || !fun.length) return { map: {}, known, mode: 'none' };
    const fMin = fun[0].date, fMax = fun[fun.length - 1].date;
    if (to < fMin || from > fMax) return { map: {}, known, mode: 'out', fMin, fMax };
    const clicksAll = fun.reduce((s, d) => s + (d.clicks || 0), 0);
    const clicksR = fun.filter(d => d.date >= from && d.date <= to).reduce((s, d) => s + (d.clicks || 0), 0);
    const ratio = clicksAll ? clicksR / clicksAll : 0;
    const sum = (_ads.analytics && _ads.analytics.summary) || {};
    const tc = sum.total_clicks || all.reduce((s, c) => s + (c.clicks || 0), 0);
    const tcost = sum.total_cost_uah || all.reduce((s, c) => s + (c.cost_uah || 0), 0);
    const scale = (tc > 500 && tcost / tc < 0.5) ? 1000 : 1;
    const map = {};
    all.filter(c => (c.cost_uah || 0) > 0 || (c.clicks || 0) > 0)
      .forEach(c => { const k = campOf(c.campaign), a = map[k] || (map[k] = { cost: 0, clicks: 0, camp: k, acc: 'EASY' }); a.cost += (c.cost_uah || 0) * scale * ratio; a.clicks += Math.round((c.clicks || 0) * ratio); });
    return { map, known, mode: 'approx', scale, partial: from < fMin || to > fMax, fMin, fMax, cFrom: from < fMin ? fMin : from, cTo: to > fMax ? fMax : to };
  }

  // ── v7.0: щоденні витрати (для деталізації рядка і графіка «Витрати по акаунтах») ──
  // Google: [{d, camp, acc, cost, clk}] — з GA4 (точно) або листа «campaigns»; Meta: з data/meta_ads.json.
  function googleDaily(from, to) {
    const ga = (_ga && _ga.adsCost) || [];
    if (ga.length) return ga.filter(r => r.d >= from && r.d <= to).map(r => ({ d: r.d, camp: campOf(r.c), acc: accNorm(r.a), cost: r.cost || 0, clk: r.clk || 0 }));
    const daily = (_adsDaily && _adsDaily.rows) || [];
    if (!daily.length) return [];
    const all = daily.filter(r => r.date >= from && r.date <= to);
    const clk = all.reduce((s, r) => s + (r.clicks || 0), 0), cst = all.reduce((s, r) => s + (r.cost_uah || 0), 0);
    const scale = (clk > 200 && cst / clk < 0.5) ? 1000 : 1;
    return all.map(r => ({ d: r.date, camp: campOf(r.campaign), acc: 'EASY', cost: (r.cost_uah || 0) * scale, clk: r.clicks || 0 }));
  }
  function metaDaily(from, to) {
    return ((_meta && _meta.rows) || []).filter(r => r.d >= from && r.d <= to)
      .map(r => ({ d: r.d, camp: r.c, cid: r.cid, acc: r.a, cost: r.spend || 0, clk: r.clk || 0, lead: r.lead || 0, msg: r.msg || 0 }));
  }
  // група акаунта: EASY / Ukr3d (Google) · Meta (Facebook + Instagram) · без реклами
  const META_CH = new Set(['facebook', 'instagram', 'meta']);
  const accGroup = (ch, acc) => ch === 'google' ? (/ukr/i.test(acc || '') ? 'ukr3d' : 'easy') : META_CH.has(ch) ? 'meta' : 'none';
  const ACC_LBL = { all: 'Усі', easy: 'EASY', ukr3d: 'Ukr3d', meta: 'Meta (FB+IG)', none: 'Без реклами' };
  const CLS_LBL = { all: 'Усі', mkt: 'Маркетинг', non: 'Не маркетинг', unk: 'Не визначено' };
  const cls = (us, uc, sname, ch) => window.MktSplit ? MktSplit.classify(us, uc, sname, ch) : 'unk';

  function initRoi() {
    const t = today();
    _roi = Object.assign({ mode: 'month', day: addDays(t, -1), from: addDays(t, -6), to: t, month: t.slice(0, 7), year: t.slice(0, 4) }, lsGet(ROI_LS, {}));
    _roiSort = lsGet(ROI_SORT_LS, _roiSort);
    const ys = $('roi-year');
    if (ys) {
      const years = new Set([t.slice(0, 4)]);
      monthsWithCohort().forEach(m => years.add(m.month.slice(0, 4)));
      ys.innerHTML = [...years].sort().reverse().map(y => `<option>${y}</option>`).join('');
      if (![...years].includes(_roi.year)) _roi.year = t.slice(0, 4);
    }
    const set = (id, v) => { const e = $(id); if (e) { e.value = v; e.max = id === 'roi-month' ? t.slice(0, 7) : (id === 'roi-year' ? '' : t); } };
    set('roi-day', _roi.day); set('roi-from', _roi.from); set('roi-to', _roi.to); set('roi-month', _roi.month); set('roi-year', _roi.year);
    const upd = () => { lsSet(ROI_LS, _roi); syncRoiCtl(); renderRoi(); };
    document.querySelectorAll('#roi-mode button').forEach(b => b.onclick = () => { _roi.mode = b.dataset.m; upd(); });
    [['roi-day', 'day'], ['roi-from', 'from'], ['roi-to', 'to'], ['roi-month', 'month'], ['roi-year', 'year']].forEach(([id, k]) => {
      const e = $(id); if (e) e.onchange = () => { if (e.value) { _roi[k] = e.value; upd(); } };
    });
    document.querySelectorAll('.roi-in[data-for="range"] a[data-q]').forEach(a => a.onclick = ev => {
      ev.preventDefault(); _roi.to = t; _roi.from = addDays(t, -(+a.dataset.q - 1));
      $('roi-from').value = _roi.from; $('roi-to').value = _roi.to; upd();
    });
    document.querySelectorAll('.roi-tbl th[data-k]').forEach(th => th.onclick = ev => {
      if (ev.target.classList.contains('roi-i')) return;
      const k = th.dataset.k;
      _roiSort = _roiSort.k === k ? { k, dir: -_roiSort.dir } : { k, dir: (k === 'ch' || k === 'name') ? 1 : -1 };
      lsSet(ROI_SORT_LS, _roiSort); renderRoi();
    });
    // v5.2: фільтр — канали (мультивибір), «лише з витратами», пошук
    const fl = lsGet(ROI_F_LS, null);
    if (fl && typeof fl === 'object') _roiF = { ch: Array.isArray(fl.ch) ? fl.ch : [], paid: !!fl.paid, q: fl.q || '',
      acc: ACC_LBL[fl.acc] ? fl.acc : 'all', cls: CLS_LBL[fl.cls] ? fl.cls : 'all' };
    const fUpd = () => { lsSet(ROI_F_LS, _roiF); syncSeg(); renderRoi(); };
    // v7.0: акаунт (EASY / Ukr3d / Meta) і клас ліда (маркетинг / ні)
    const syncSeg = () => {
      document.querySelectorAll('#roi-acc button').forEach(b => b.classList.toggle('on', b.dataset.v === _roiF.acc));
      document.querySelectorAll('#roi-cls button').forEach(b => b.classList.toggle('on', b.dataset.v === _roiF.cls));
    };
    document.querySelectorAll('#roi-acc button').forEach(b => b.onclick = () => { _roiF.acc = b.dataset.v; fUpd(); });
    document.querySelectorAll('#roi-cls button').forEach(b => b.onclick = () => { _roiF.cls = b.dataset.v; fUpd(); });
    syncSeg();
    // v7.0: клік по рядку — деталізація по днях / місяцях
    const tbd = $('mkt-leadgen-roi-table');
    if (tbd) tbd.onclick = ev => {
      const tr = ev.target.closest('tr[data-rk]'); if (!tr || ev.target.closest('a')) return;
      const k = tr.dataset.rk; _roiOpen.has(k) ? _roiOpen.delete(k) : _roiOpen.add(k); renderRoi();
    };
    const pc = $('roi-paid'); if (pc) { pc.checked = _roiF.paid; pc.onchange = () => { _roiF.paid = pc.checked; fUpd(); }; }
    const q = $('roi-q');
    if (q) { q.value = _roiF.q; let t; q.oninput = () => { clearTimeout(t); t = setTimeout(() => { _roiF.q = q.value.trim(); fUpd(); }, 200); }; }
    const rs = $('roi-reset');
    if (rs) rs.onclick = ev => { ev.preventDefault(); _roiF = { ch: [], paid: false, q: '', acc: 'all', cls: 'all' }; if (pc) pc.checked = false; if (q) q.value = ''; fUpd(); };
    const chips = $('roi-chips');
    if (chips) chips.onclick = ev => {
      const b = ev.target.closest('.roi-chip'); if (!b) return;
      const c = b.dataset.ch;
      if (c === '*') _roiF.ch = [];
      else if (ev.altKey || ev.metaKey || ev.ctrlKey) _roiF.ch = [c];          // Alt/Cmd/Ctrl+клік — тільки цей канал
      else _roiF.ch = _roiF.ch.includes(c) ? _roiF.ch.filter(x => x !== c) : _roiF.ch.concat(c);
      fUpd();
    };
    const ri = $('roi-roas-i');
    if (ri) ri.onclick = ev => { ev.stopPropagation(); const d = $('roi-info'); if (d) { d.open = !d.open; if (d.open) d.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } };
    syncRoiCtl();
  }

  function syncRoiCtl() {
    document.querySelectorAll('#roi-mode button').forEach(b => b.classList.toggle('on', b.dataset.m === _roi.mode));
    document.querySelectorAll('.roi-in').forEach(e => e.classList.toggle('on', e.dataset.for === _roi.mode));
  }

  function renderRoi() {
    const el = $('mkt-leadgen-roi'); if (!el || !_roi) return;
    const [from, to] = roiRange();
    const bx = bitrixRows(from, to), ads = adsCost(from, to);
    const rows = {};
    const row = (ch, acc, name) => {
      const k = ch + '|' + acc + '|' + name;
      return rows[k] || (rows[k] = { k, ch, acc, name, deals: 0, exp: 0, won: 0, wonSum: 0, cost: null, clicks: null, cd: 0, cw: 0, cws: 0,
        cl: { mkt: 0, non: 0, unk: 0 }, b: {} });
    };
    // v7.0: деталізація — по днях для періоду до 45 днів, інакше по місяцях
    const span = (new Date(to) - new Date(from)) / 864e5 + 1, byDay = span <= 45;
    const bk = d => byDay ? d : d.slice(0, 7);
    const B = (x, d) => x.b[bk(d)] || (x.b[bk(d)] = { n: 0, w: 0, ws: 0, cost: 0, ses: 0 });
    const accOf = ads.accOf || {};
    const keyOf = r => { const c = channelOf(r.us, r.s, bx.srcNames); const n = bxKey(c, r.uc, ads); const x = row(c.ch, c.acc, n); x._c = c; return x; };
    bx.rows.forEach(r => {
      const x = keyOf(r); x.deals += r.n; x.exp += r.e; x.won += r.w; x.wonSum += r.ws;
      x.cl[cls(r.us, r.uc, bx.srcNames[r.s] || r.s, x.ch)] += r.n;
      if (r.d) { const b = B(x, r.d); b.n += r.n; b.w += r.w; b.ws += r.ws; }
    });
    // CPL/CAC/ROAS рахуємо лише за дні, де є вартість Ads — інакше річні угоди
    // ділились би на 30-денну вартість і ROAS виходив би завищеним.
    const partial = ads.partial && ads.cFrom && ads.cFrom <= ads.cTo;
    const cbx = partial ? bitrixRows(ads.cFrom, ads.cTo) : bx;
    const cmpOk = !(partial && cbx.gaps.length);
    cbx.rows.forEach(r => { const x = keyOf(r); x.cd += r.n; x.cw += r.w; x.cws += r.ws; });
    Object.values(ads.map).forEach(a => {
      if (!(a.cost > 0 || a.clicks > 0)) return;
      const x = row('google', a.acc || 'EASY', a.camp);
      x.cost = (x.cost || 0) + a.cost; x.clicks = (x.clicks || 0) + a.clicks;
    });
    googleDaily(from, to).forEach(r => { const x = rows['google|' + (r.acc || 'EASY') + '|' + r.camp]; if (x) B(x, r.d).cost += r.cost; });
    // v7.0: витрати Meta (Facebook + Instagram) — до рядка Bitrix з тією ж назвою або ID кампанії в utm_campaign,
    // інакше окремий рядок «meta / акаунт»
    const md = metaDaily(from, to), metaOk = !!(_meta && _meta.rows);
    if (md.length) {
      const fb = Object.values(rows).filter(r => META_CH.has(r.ch) && r.name);
      const byName = {}; fb.forEach(r => { const l = r.name.toLowerCase(); if (!byName[l] || r.deals > byName[l].deals) byName[l] = r; });
      md.forEach(m => {
        const x = byName[(m.camp || '').toLowerCase()] || byName[String(m.cid)] || row('meta', m.acc || 'Meta', m.camp || m.cid);
        x.cost = (x.cost || 0) + m.cost; x.clicks = (x.clicks || 0) + m.clk; x.metaLead = (x.metaLead || 0) + m.lead + m.msg;
        B(x, m.d).cost += m.cost;
      });
    }
    // v5.1: сеанси з GA4 (source → канал, utm_campaign) — для колонок «Сеанси» і «CR»
    const sesMap = {}, sesB = {}, NOCAMP = new Set(['', '(not set)', '(organic)', '(direct)', '(referral)', '(none)']);
    if (_ga && _ga.traffic) _ga.traffic.forEach(t => {
      if (t.d < from || t.d > to || NOCAMP.has(t.c)) return;
      const k = channelOf(t.s, '', {}).ch + '|' + campOf(t.c); sesMap[k] = (sesMap[k] || 0) + t.ses;
      (sesB[k] || (sesB[k] = {}))[bk(t.d)] = ((sesB[k] || {})[bk(t.d)] || 0) + t.ses;
    });
    const gaOk = !!(_ga && _ga.traffic);
    // v7.1: сеанси GA4 не знають акаунта — якщо однакова назва кампанії є і в EASY, і в Ukr3d, рядку Ukr3d сеанси не приписуємо
    const easyNames = new Set(Object.values(rows).filter(r => r.ch === 'google' && !/ukr/i.test(r.acc)).map(r => r.name));
    Object.values(rows).forEach(r => {
      r.ses = gaOk && r.name && !NOCAMP.has(r.name) && !(r.ch === 'google' && /ukr/i.test(r.acc) && easyNames.has(r.name)) ? (sesMap[r.ch + '|' + r.name] || 0) : null; r.cr = r.ses ? r.deals / r.ses * 100 : null;
      if (r.ses) Object.entries(sesB[r.ch + '|' + r.name] || {}).forEach(([b, v]) => { (r.b[b] || (r.b[b] = { n: 0, w: 0, ws: 0, cost: 0, ses: 0 })).ses += v; });
      // клас рядка — за більшістю угод; рядок лише з витратами = реклама → маркетинг
      const c = r.cl; r.cls = (c.mkt + c.non + c.unk) ? Object.keys(c).sort((a, b) => c[b] - c[a])[0] : 'mkt';
      r.ag = accGroup(r.ch, r.acc);
    });
    const siteDeals = bx.rows.reduce((s, r) => { const c = channelOf(r.us, r.s, bx.srcNames).ch; return s + ((r.us || r.uc || c === 'сайт' || c === 'форма') ? r.n : 0); }, 0);
    const arr = Object.values(rows).filter(r => r.deals || r.cost).map(r => Object.assign(r, {
      cpl: cmpOk && r.cost && r.cd ? r.cost / r.cd : null,
      cac: cmpOk && r.cost && r.cw ? r.cost / r.cw : null,
      roas: cmpOk && r.cost ? r.cws / r.cost * 100 : null,
      romiR: cmpOk && r.cost ? (r.cws - r.cost) / r.cost * 100 : null,
      romiM: cmpOk && r.cost ? (r.cws * marginPct() / 100 - r.cost) / r.cost * 100 : null,
    }));
    // ── v5.2: фільтр по каналах / витратах / пошуку ──
    const allRows = arr.length;
    const chStat = {};
    arr.forEach(r => { const c = chStat[r.ch] || (chStat[r.ch] = { ch: r.ch, rows: 0, deals: 0, cost: 0 }); c.rows++; c.deals += r.deals; c.cost += r.cost || 0; });
    _roiF.ch.forEach(c => { if (!chStat[c]) chStat[c] = { ch: c, rows: 0, deals: 0, cost: 0 }; });
    const sel = new Set(_roiF.ch), ql = (_roiF.q || '').toLowerCase();
    const aF = _roiF.acc || 'all', cF = _roiF.cls || 'all';
    const fArr = arr.filter(r => (!sel.size || sel.has(r.ch)) && (!_roiF.paid || r.cost) && (aF === 'all' || r.ag === aF) && (cF === 'all' || r.cls === cF)
      && (!ql || (r.ch + ' ' + r.acc + ' ' + r.name).toLowerCase().includes(ql)));
    arr.length = 0; fArr.forEach(r => arr.push(r));
    const chipsEl = $('roi-chips');
    if (chipsEl) {
      const list = Object.values(chStat).sort((a, b) => (b.cost - a.cost) || (b.deals - a.deals) || a.ch.localeCompare(b.ch, 'uk'));
      chipsEl.innerHTML = `<button type="button" class="roi-chip all${sel.size ? '' : ' on'}" data-ch="*">Усі<span class="n">${allRows}</span></button>` +
        list.map(c => `<button type="button" class="roi-chip${sel.has(c.ch) ? ' on' : ''}" data-ch="${c.ch.replace(/"/g, '&quot;')}" title="${c.rows} рядків · ${c.deals} нових угод${c.cost ? ' · витрати ' + fmt(c.cost) + ' грн' : ''}. Клік — додати/прибрати; Alt/Cmd+клік — тільки цей канал">${c.ch}<span class="n">${c.deals}</span></button>`).join('');
    }
    const filtered = sel.size || _roiF.paid || ql || aF !== 'all' || cF !== 'all';
    const rsEl = $('roi-reset'); if (rsEl) rsEl.style.display = filtered ? '' : 'none';

    const { k, dir } = _roiSort;
    const val = r => k === 'ch' ? (r.ch + ' ' + r.acc).toLowerCase() : k === 'name' ? (r.name || '￿').toLowerCase() : r[k];
    arr.sort((a, b) => {
      const va = val(a), vb = val(b);
      if (va == null && vb == null) return b.wonSum - a.wonSum;
      if (va == null) return 1; if (vb == null) return -1;   // порожні — завжди внизу
      const c = typeof va === 'string' ? va.localeCompare(vb, 'uk') : va - vb;
      return c * dir || (b.wonSum - a.wonSum);
    });
    document.querySelectorAll('.roi-tbl th[data-k]').forEach(th => {
      const old = th.querySelector('.arr'); if (old) old.remove();
      if (th.dataset.k === k) th.insertAdjacentHTML('beforeend', `<span class="arr">${dir > 0 ? '▲' : '▼'}</span>`);
    });

    // Примітка: період + звідки вартість і наскільки точна
    const note = $('mkt-leadgen-roi-note');
    const fmtD = d => d.split('-').reverse().join('.');
    const per = from === to ? fmtD(from) : `${fmtD(from)} – ${fmtD(to)}`;
    let costNote;
    if (ads.mode === 'ga') costNote = `Вартість — Google Ads через <b>Google Analytics</b>, точно по днях (${(() => { const a = [...new Set(Object.values(ads.accOf || {}))].filter(x => x !== 'GA'); return a.length ? 'акаунт ' + a.join(', ') : 'акаунт Ads, прив\'язаний до GA'; })()})${ads.partial ? `; ⚠ є за ${fmtD(ads.dMin)} – ${fmtD(ads.dMax)}` : ''}. Сеанси — GA4.`;
    else if (ads.mode === 'daily') costNote = `Вартість — Google Ads (акаунт EASY) по днях${ads.scale !== 1 ? ' (⚠ скрипт пише в тисячах — ×1000)' : ''}${ads.partial ? `; ⚠ щоденні дані є лише за ${fmtD(ads.dMin)} – ${fmtD(ads.dMax)}` : ''}.`;
    else if (ads.mode === 'approx') costNote = `Вартість — Google Ads (акаунт EASY), <b>≈ наближено</b>: 30-денна вартість кампанії × частка кліків періоду${ads.scale !== 1 ? '; скрипт пише в тисячах — ×1000' : ''}${ads.partial ? `; ⚠ дані Ads є лише за ${fmtD(ads.fMin)} – ${fmtD(ads.fMax)}, решта періоду без вартості` : ''}. Точно по днях — коли скрипт Ads заповнюватиме лист «campaigns».`;
    else if (ads.mode === 'out') costNote = `Вартості Google Ads за цей період немає (є лише ${fmtD(ads.fMin)} – ${fmtD(ads.fMax)}) — показана тільки Bitrix-частина.`;
    else costNote = 'Вартості Google Ads немає — показана тільки Bitrix-частина.';
    if (partial) costNote += cmpOk ? ` <b>CPL / CAC / ROAS — лише за ${fmtD(ads.cFrom)} – ${fmtD(ads.cTo)}</b> (дні з вартістю), щоб угоди й витрати були за той самий період.`
      : ` CPL / CAC / ROAS не показані: за дні з вартістю ще немає розбивки угод по днях.`;
    if (note) note.innerHTML = `<b>${per}</b> · Угоди/виручка — Bitrix24, створені в періоді. ${costNote} ${metaOk ? `Витрати Facebook/Instagram — Meta Ads API${md.length ? '' : ' (за період витрат немає)'}.` : 'Витрат Facebook/Instagram поки немає (Meta API не підключено).'} Клік по рядку — деталізація ${byDay ? 'по днях' : 'по місяцях'}.` +
      (bx.gaps.length ? ` <span style="color:${R}">⚠ Для ${bx.gaps.join(', ')} ще немає розбивки по днях — запусти один раз «Backfill CRM Monthly History».</span>` : '');

    const tb = $('mkt-leadgen-roi-table'); if (!tb) return;
    const rc = v => v == null ? 'var(--tl)' : v >= 300 ? GD : v >= 100 ? WH : R;
    const mc = v => v == null ? 'var(--tl)' : v >= 0 ? GD : R;
    const romiTxt = v => v == null ? '—' : (v > 0 ? '+' : '') + v.toFixed(0) + '%';
    const td = (v, bold, color) => `<td class="r"${bold || color ? ` style="${bold ? 'font-weight:700;' : ''}${color ? 'color:' + color : ''}"` : ''}>${v}</td>`;
    const CLS_C = { mkt: G, non: RT, unk: '#9aa3ad' };
    const drill = r => {
      const ks = Object.keys(r.b).sort(); if (!ks.length) return '';
      const mx = Math.max(...ks.map(b => r.b[b].n), 1);
      return `<tr class="roi-dd"><td colspan="14"><table class="roi-ddt"><thead><tr><th>${byDay ? 'День' : 'Місяць'}</th><th class="r">Вартість</th><th class="r">Сеанси</th><th class="r">Нових угод</th><th></th><th class="r">CPL</th><th class="r">WON</th><th class="r">WON сума</th><th class="r">ROAS</th></tr></thead><tbody>` +
        ks.map(b => { const v = r.b[b]; return `<tr><td>${byDay ? b.slice(8) + '.' + b.slice(5, 7) : b}</td><td class="r">${v.cost ? fmt(v.cost) : '—'}</td><td class="r">${v.ses ? fmt(v.ses) : '—'}</td><td class="r">${v.n}</td>
          <td style="width:90px"><div style="height:6px;border-radius:3px;background:${WH};width:${Math.max(2, v.n / mx * 100)}%"></div></td>
          <td class="r">${v.cost && v.n ? fmt(v.cost / v.n) : '—'}</td><td class="r">${v.w}</td><td class="r">${fmt(v.ws)}</td><td class="r">${v.cost ? (v.ws / v.cost * 100).toFixed(0) + '%' : '—'}</td></tr>`; }).join('') +
        `</tbody></table></td></tr>`;
    };
    tb.innerHTML = arr.length ? arr.map(r => `<tr data-rk="${r.k.replace(/"/g, '&quot;')}" class="roi-row${_roiOpen.has(r.k) ? ' open' : ''}" title="Клік — деталізація ${byDay ? 'по днях' : 'по місяцях'}">
        <td><span class="roi-cls" style="background:${CLS_C[r.cls]}" title="${CLS_LBL[r.cls]} (правила data/marketing_rules.json)"></span><span class="roi-ch">${r.ch}</span>${r.acc ? `<span class="roi-acc"> / ${r.acc}</span>` : ''}</td>
        <td style="font-weight:500">${r.name || '<span style="color:var(--tl)">без UTM</span>'}${r.cost && !r.deals && (r.ses || 0) >= 30 ? ` <span class="roi-nu" title="На рекламу витрачено ${fmt(r.cost)} грн і є ${fmt(r.ses)} сеансів, але жодна угода в Bitrix24 не має utm_campaign=${r.name}. Найімовірніше, кампанія не передає UTM-мітки (немає Final URL suffix) — ROAS тут занижений до 0%, реальні угоди потрапляють у «без UTM».">⚠ UTM не доходить у CRM</span>` : ''}</td>
        ${td(r.cost != null ? fmt(r.cost) : '—')}${td(r.ses != null ? fmt(r.ses) : '—')}${td(r.deals)}${td(r.cr != null ? r.cr.toFixed(1) + '%' : '—')}${td(r.cpl != null ? fmt(r.cpl) : '—')}${td(fmt(r.exp))}
        ${td(r.won)}${td(fmt(r.wonSum), true)}${td(r.cac != null ? fmt(r.cac) : '—')}
        ${r.cost && !r.deals && (r.ses || 0) >= 30 ? '<td class="r" style="color:var(--tl)" title="Не рахується: угоди цієї кампанії не мають UTM у Bitrix24">н/д</td>'.repeat(3)
          : td(r.roas != null ? r.roas.toFixed(0) + '%' : '—', true, rc(r.roas)) + td(romiTxt(r.romiR), true, mc(r.romiR)) + td(romiTxt(r.romiM), true, mc(r.romiM))}</tr>${_roiOpen.has(r.k) ? drill(r) : ''}`).join('')
      : `<tr><td colspan="14" style="color:var(--tl);font-weight:400">${filtered ? 'Немає рядків за обраним фільтром' : 'Немає угод за ' + per}</td></tr>`;

    // Разом: угоди/суми — усі рядки; CPL/CAC/ROAS — лише рядки з вартістю (платний трафік)
    const tf = $('mkt-leadgen-roi-total');
    if (tf) {
      const S = (a, f) => a.reduce((s, r) => s + (r[f] || 0), 0);
      const paid = arr.filter(r => r.cost);
      const cost = S(paid, 'cost'), pd = cmpOk ? S(paid, 'cd') : 0, pw = cmpOk ? S(paid, 'cw') : 0, pws = S(paid, 'cws');
      const roas = cmpOk && cost ? pws / cost * 100 : null;
      const romiR = cmpOk && cost ? (pws - cost) / cost * 100 : null;
      const romiM = cmpOk && cost ? (pws * marginPct() / 100 - cost) / cost * 100 : null;
      tf.innerHTML = arr.length ? `<tr><td>${filtered ? 'Разом (фільтр)' : 'Разом'}</td><td style="font-weight:500;color:var(--tl)">${filtered ? arr.length + ' з ' + allRows : arr.length} рядків</td>
        ${td(cost ? fmt(cost) : '—')}${td(gaOk ? fmt(S(arr.filter(r => r.ses), 'ses')) : '—')}${td(S(arr, 'deals'))}<td class="r" title="Лише рядки з сеансами GA">${(() => { const w = arr.filter(r => r.ses); const sS = S(w, 'ses'); return sS ? (S(w, 'deals') / sS * 100).toFixed(1) + '%' : '—'; })()}</td>
        <td class="r" title="Лише платні рядки (з вартістю)">${cost && pd ? fmt(cost / pd) : '—'}</td>${td(fmt(S(arr, 'exp')))}
        ${td(S(arr, 'won'))}${td(fmt(S(arr, 'wonSum')))}
        <td class="r" title="Лише платні рядки (з вартістю)">${cost && pw ? fmt(cost / pw) : '—'}</td>
        <td class="r" style="color:${rc(roas)}" title="WON сума платних рядків ÷ вартість">${roas != null ? roas.toFixed(0) + '%' : '—'}</td>
        <td class="r" style="color:${mc(romiR)}" title="(WON сума − вартість) ÷ вартість, лише платні рядки">${romiTxt(romiR)}</td>
        <td class="r" style="color:${mc(romiM)}" title="(WON сума × маржа − вартість) ÷ вартість, лише платні рядки">${romiTxt(romiM)}</td></tr>` : '';
      // v6.3: що спотворює ROMI — витрати без угод з UTM і виручка кампаній без даних про витрати
      const noUtm = paid.filter(r => !r.deals && (r.ses || 0) >= 30), noCost = arr.filter(r => !r.cost && r.ch === 'google' && r.name && r.wonSum);
      renderRomiKpi({ cost, pws, roas, romiR, romiM, paidRows: paid.length, filtered, cmpOk,
        noUtmCost: S(noUtm, 'cost'), noUtmN: noUtm.length, noCostRev: S(noCost, 'wonSum'), noCostN: noCost.length });
    }
    try { renderLtvAds(from, to, sel, ql); } catch (e) { console.warn('[LTV ads]', e); }
    if (window.GA4View) { try { GA4View.render(_ga, from, to, { siteDeals }); } catch (e) { console.warn('[GA4View]', e); } }
    if (window.MktSplit) { try { MktSplit.render(api, from, to); } catch (e) { console.warn('[MktSplit]', e); } }
  }

  // ── 3a. v6.3: плитки ROMI над таблицею (платні рядки поточного фільтра) ──
  function renderRomiKpi(k) {
    const el = $('mkt-roi-kpi'); if (!el) return;
    const m = marginPct(), src = _pnl && _pnl.ytd && _pnl.ytd.gross_margin_pct ? `валова маржа P&L ${_pnl.ytd.period || 'з початку року'}: ${_pnl.ytd.gross_margin_pct}%` : 'P&L недоступний';
    const c = v => v == null ? 'var(--tl)' : v >= 0 ? GD : R;
    const sg = v => v == null ? '—' : (v > 0 ? '+' : '') + v.toFixed(0) + '%';
    const tile = (l, v, sub, col, tip) => `<div class="roi-k" title="${tip || ''}"><div class="l">${l}</div><div class="v"${col ? ` style="color:${col}"` : ''}>${v}</div><div class="s">${sub || ''}</div></div>`;
    el.innerHTML =
      tile('Витрати на рекламу', k.cost ? fmt(k.cost) + ' ₴' : '—', `${k.paidRows} платних рядків${k.filtered ? ' (фільтр)' : ''}`) +
      tile('WON-виручка з реклами', fmt(k.pws) + ' ₴', 'угоди платних рядків, створені в періоді') +
      tile('ROAS', k.roas != null ? k.roas.toFixed(0) + '%' : '—', 'виручка ÷ витрати', null, 'WON сума ÷ вартість × 100%') +
      tile('ROMI по виручці', sg(k.romiR), '(виручка − витрати) ÷ витрати', c(k.romiR), 'Скільки виручки понад вкладене дає кожна гривня реклами') +
      tile('ROMI по марже', sg(k.romiM), `(виручка × ${m}% − витрати) ÷ витрати`, c(k.romiM), 'Окупність реклами з урахуванням маржі: > 0% — реклама окупилась по валовому прибутку') +
      `<div class="roi-k roi-km"><div class="l">Маржа для ROMI</div><div class="v"><input type="number" id="roi-mgn" min="1" max="100" step="0.1" value="${m}">%</div>
        <div class="s">${src}${Math.abs(m - defMargin()) > 0.05 ? ` · <a href="#" id="roi-mgn-reset">скинути</a>` : ''}</div></div>` +
      ((k.noUtmCost || k.noCostRev) ? `<div class="roi-kw">⚠ ROMI поки неточний:${k.noUtmCost ? ` <b>${fmt(k.noUtmCost)} ₴</b> витрат — ${k.noUtmN} кампаній без угод з UTM у Bitrix24 (виручка цих кампаній не видна, ROMI занижений);` : ''}${k.noCostRev ? ` <b>${fmt(k.noCostRev)} ₴</b> WON-виручки — ${k.noCostN} кампаній Google без даних про витрати (акаунт не прив'язаний до GA4, у ROMI не враховано).` : ''}</div>` : '');
    const inp = $('roi-mgn');
    if (inp) inp.onchange = () => { const v = parseFloat(String(inp.value).replace(',', '.')); if (v > 0 && v <= 100) { _mgn = v; lsSet(MGN_LS, v); renderRoi(); } };
    const rs = $('roi-mgn-reset');
    if (rs) rs.onclick = ev => { ev.preventDefault(); _mgn = defMargin(); try { localStorage.removeItem(MGN_LS); } catch (e) {} renderRoi(); };
  }

  // ── 3b. v6.3: LTV рекламного трафіку ──
  // Клієнт отримує канал і кампанію своєї ПЕРШОЇ угоди (fetch_clients.py → acquisition). LTV — уся його WON-виручка
  // за весь час, у т.ч. повторні угоди без UTM. Період — місяці першої угоди, що перетинаються з періодом ROI.
  function renderLtvAds(from, to, sel, ql) {
    const tb = $('mkt-ltv-ads'), note = $('mkt-ltv-ads-note'), tf = $('mkt-ltv-ads-total'); if (!tb) return;
    const acq = _cl && _cl.acquisition && _cl.acquisition.rows;
    if (!acq) {
      tb.innerHTML = `<tr><td colspan="11" style="color:var(--tl);font-weight:400">Блок з'явиться після запуску <b>update-clients</b> з v6.3 (перший дотик клієнта рахується раз на добу).</td></tr>`;
      if (tf) tf.innerHTML = ''; if (note) note.textContent = ''; return;
    }
    const mA = from.slice(0, 7), mB = to.slice(0, 7), t = today();
    const cFrom = mA + '-01', cTo = lastDay(mB) > t ? t : lastDay(mB);
    const ads = adsCost(cFrom, cTo), accOf = ads.accOf || {};
    const srcNames = {}; monthsWithCohort().forEach(m => (m.cohort.bySource || []).forEach(s => { if (s.key && s.key !== '—') srcNames[s.key] = s.name; }));
    const rows = {};
    const row = (ch, acc, name) => { const k = ch + '|' + acc + '|' + name; return rows[k] || (rows[k] = { ch, acc, name, n: 0, p: 0, rev: 0, w: 0, cost: null }); };
    acq.filter(r => r.m >= mA && r.m <= mB).forEach(r => {
      const c = channelOf(r.us, r.s, srcNames);
      const nm = bxKey(c, r.uc, ads), x = row(c.ch, c.acc, nm); x.n += r.n; x.p += r.p; x.rev += r.rev; x.w += r.w;
    });
    Object.values(ads.map || {}).forEach(a => { if (a.cost > 0) { const x = row('google', a.acc || 'EASY', a.camp); x.cost = (x.cost || 0) + a.cost; } });
    const m = marginPct() / 100;
    let arr = Object.values(rows).filter(r => (r.n || r.cost) && (!sel.size || sel.has(r.ch)) && (!_roiF.paid || r.cost)
      && (!ql || (r.ch + ' ' + r.acc + ' ' + r.name).toLowerCase().includes(ql)))
      .map(r => Object.assign(r, { conv: r.n ? r.p / r.n * 100 : null, ltv: r.p ? r.rev / r.p : null,
        cac: r.cost && r.p ? r.cost / r.p : null, ratio: r.cost && r.p ? (r.rev / r.p) / (r.cost / r.p) : null,
        romi: r.cost ? (r.rev * m - r.cost) / r.cost * 100 : null }));
    arr.sort((a, b) => (b.rev - a.rev) || ((b.cost || 0) - (a.cost || 0)));
    const fD = d => d.split('-').reverse().join('.');
    if (note) note.innerHTML = `Клієнти, чия <b>перша угода</b> створена в ${mA === mB ? mA : mA + ' – ' + mB} (місяці, що перетинають період ROI) · канал і кампанія — з першої угоди · LTV — уся їхня WON-виручка до сьогодні, з повторними · вартість — Google Ads за ${fD(cFrom)} – ${fD(cTo)} · маржа ${marginPct()}%. Клієнт = компанія угоди або контакт.`;
    const lc = v => v == null ? 'var(--tl)' : v >= 3 ? GD : v >= 1 ? WH : R;
    const mc = v => v == null ? 'var(--tl)' : v >= 0 ? GD : R;
    const td = (v, bold, color) => `<td class="r"${bold || color ? ` style="${bold ? 'font-weight:700;' : ''}${color ? 'color:' + color : ''}"` : ''}>${v}</td>`;
    const sg = v => v == null ? '—' : (v > 0 ? '+' : '') + v.toFixed(0) + '%';
    tb.innerHTML = arr.length ? arr.slice(0, 60).map(r => `<tr>
        <td><span class="roi-ch">${r.ch}</span>${r.acc ? `<span class="roi-acc"> / ${r.acc}</span>` : ''}</td>
        <td style="font-weight:500">${r.name || '<span style="color:var(--tl)">без UTM</span>'}</td>
        ${td(r.n)}${td(r.p)}${td(r.conv != null ? r.conv.toFixed(0) + '%' : '—')}${td(fmt(r.rev), true)}${td(r.ltv != null ? fmt(r.ltv) : '—', true)}
        ${td(r.cost != null ? fmt(r.cost) : '—')}${td(r.cac != null ? fmt(r.cac) : '—')}
        ${td(r.ratio != null ? r.ratio.toFixed(1) : '—', true, lc(r.ratio))}${td(sg(r.romi), true, mc(r.romi))}</tr>`).join('')
      : `<tr><td colspan="11" style="color:var(--tl);font-weight:400">Немає нових клієнтів за обраний період / фільтр</td></tr>`;
    if (tf) {
      const S = (a, f) => a.reduce((s, r) => s + (r[f] || 0), 0);
      const paid = arr.filter(r => r.cost), pc = S(paid, 'cost'), pp = S(paid, 'p'), pr = S(paid, 'rev');
      tf.innerHTML = arr.length ? `<tr><td>Разом</td><td style="font-weight:500;color:var(--tl)">${arr.length} рядків${arr.length > 60 ? ' (показано 60)' : ''}</td>
        ${td(S(arr, 'n'))}${td(S(arr, 'p'))}${td(S(arr, 'n') ? (S(arr, 'p') / S(arr, 'n') * 100).toFixed(0) + '%' : '—')}${td(fmt(S(arr, 'rev')))}${td(S(arr, 'p') ? fmt(S(arr, 'rev') / S(arr, 'p')) : '—')}
        ${td(pc ? fmt(pc) : '—')}<td class="r" title="Лише платні рядки">${pc && pp ? fmt(pc / pp) : '—'}</td>
        <td class="r" style="color:${lc(pc && pp ? (pr / pp) / (pc / pp) : null)}" title="Лише платні рядки">${pc && pp ? ((pr / pp) / (pc / pp)).toFixed(1) : '—'}</td>
        <td class="r" style="color:${mc(pc ? (pr * m - pc) / pc * 100 : null)}" title="Лише платні рядки">${pc ? sg((pr * m - pc) / pc * 100) : '—'}</td></tr>` : '';
    }
  }

  // ── 4. Завислі великі угоди ──
  function renderStale(c) {
    const el = $('mkt-leadgen-stale'); if (!el) return;
    const s = c.staleBigDeals || [];
    if (!s.length) { el.style.display = 'none'; return; }
    const total = s.reduce((a, d) => a + d.amount, 0);
    el.style.display = '';
    el.innerHTML = `<div>⚠ <b>Завислі великі угоди</b> (відкриті > 90 днів, сума ≥ 1M): ${s.length} на <b>${fmt(total)} грн</b> — вони роздувають «очікувану суму» пайплайну.
      ${s.slice(0, 5).map(d => `#${d.id} · ${fmt(d.amount)} грн · ${d.stage} · з ${d.created}`).join('; ')}. Варто закрити або актуалізувати в Bitrix24.</div>`;
  }

  // ── 5. Тренд: звернення / кваліфіковані / WON + частка повторних ──
  function renderTrend(months) {
    const wrap = $('mkt-leadgen-trend-wrap'); if (!wrap) return;
    if (months.length < 2) { wrap.style.display = 'none'; return; }
    wrap.style.display = '';
    const labels = months.map(m => m.month + (m.complete === false ? '*' : ''));
    chart('mkt-leadgen-trend', {
      type: 'bar',
      data: { labels, datasets: [
        { label: 'Звернення', data: months.map(m => m.cohort.funnel.all), backgroundColor: 'rgba(100,116,139,.25)', borderRadius: 4, yAxisID: 'y' },
        { label: 'Кваліфіковані', data: months.map(m => m.cohort.funnel.qualified), backgroundColor: 'rgba(61,126,166,.55)', borderRadius: 4, yAxisID: 'y' },
        { label: 'WON', data: months.map(m => m.cohort.funnel.won), backgroundColor: 'rgba(42,157,143,.85)', borderRadius: 4, yAxisID: 'y' },
        { label: '% WON-виручки від повторних', type: 'line', yAxisID: 'y1', borderColor: RT, backgroundColor: RT, tension: .3, pointRadius: 3,
          data: months.map(m => { const c = m.cohort; return c.funnel.wonSum ? +(c.retention.repeatPurchase.wonSum / c.funnel.wonSum * 100).toFixed(1) : null; }) },
      ] },
      options: { responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'top', labels: { usePointStyle: true, padding: 8, font: { size: 9 } } }, datalabels: { display: false } },
        scales: { x: { grid: { display: false } }, y: { beginAtZero: true, grid: { color: GRID } },
          y1: { position: 'right', beginAtZero: true, max: 100, grid: { drawOnChartArea: false }, ticks: { callback: v => v + '%' } } } }
    });
  }

  // v7.0: спільні функції для js/mkt_split.js (витрати по акаунтах, маркетинг / не маркетинг, Meta, повернення клієнтів)
  const api = {
    channelOf, bitrixRows, monthsWithCohort, googleDaily, metaDaily, accGroup, campOf, lastDay, today, fmt, chart,
    get ga() { return _ga; }, get meta() { return _meta; }, get clients() { return _cl; }, get adsAccOf() { return adsCost('1900-01-01', '1900-01-01').accOf || {}; },
    rerender: () => { try { renderRoi(); } catch (e) { console.warn(e); } },
  };
  return { load, api };
})();
