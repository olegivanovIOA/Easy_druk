/**
 * mkt_split.js — Easy 3D Print Dashboard v7.0 · вкладка «Маркетинг»
 *   1) Витрати на рекламу по акаунтах: EASY / Ukr3d (Google Ads через GA4) / Meta (Facebook + Instagram)
 *   2) Ліди «від маркетингу» / «не від маркетингу» / «не визначено» — за редагованими правилами data/marketing_rules.json
 *      (можна перевизначити клас джерела прямо на сторінці → скопіювати JSON і закомітити)
 *   3) Facebook + Instagram: ліди, WON, виручка, витрати, CPL, ROAS
 *   4) Retention силами маркетингу: клієнти, що повернулись після паузи, і через який канал
 * Період таблиць = період таблиці ROI; графіки — по місяцях за всю історію.
 * Дані — тільки агрегати (без ID і назв клієнтів).
 */
window.MktSplit = (() => {
  const G = '#2A9D8F', GD = '#1e7a6e', WH = '#3D7EA6', RT = '#C98A2B', R = '#C0392B', GRY = '#9aa3ad', GRID = '#f0f2ee';
  // v7.4: кольори акаунтів однакові з кнопками фільтрів (EASY — синій, Ukr3d — фіолетовий, Meta — малиновий)
  const UKR = '#8E6CC0', META = '#D6457A', FB = '#4267B2', IG = '#C13584';
  const OV_LS = 'e3d_mkt_rules_override_v1', SP_LS = 'e3d_mkt_spend_acc_v1', SPL_LS = 'e3d_mkt_split_metric_v1';
  const CLS = ['mkt', 'non', 'unk'];
  const CLS_C = { mkt: G, non: RT, unk: GRY };
  let LBL = { mkt: 'Від маркетингу', non: 'Не від маркетингу', unk: 'Не визначено' };
  let _rules = [], _def = 'unk', _raw = null, _ov = {}, _api = null, _from = null, _to = null;
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
  const p0 = v => v == null || !isFinite(v) ? '—' : v.toFixed(0) + '%';

  // ── правила ──
  const DRAFT = { default: 'unk', rules: [
    { class: 'non', src: 'существующ|існуюч|повторн|холодн|исходящ|рекоменд|тендер|дилер|olx|rozetka' },
    { class: 'mkt', ch: ['google', 'facebook', 'instagram', 'meta', 'youtube', 'tiktok', 'linkedin'], utm: '.+' },
    { class: 'mkt', src: 'реклам|коментар|facebook|instagram|виставк|expo|рассылк|розсилк' },
  ] };
  function setRules(j) {
    _raw = j && Array.isArray(j.rules) ? j : DRAFT;
    _def = CLS.includes(_raw.default) ? _raw.default : 'unk';
    if (_raw.classes) LBL = Object.assign({}, LBL, _raw.classes);
    _rules = _raw.rules.map(r => {
      const re = v => { try { return v ? new RegExp(v, 'i') : null; } catch (e) { console.warn('[MktRules] regex', v); return /$^/; } };
      return { cls: CLS.includes(r.class) ? r.class : 'unk', ch: Array.isArray(r.ch) ? new Set(r.ch.map(x => String(x).toLowerCase())) : null,
        utm: re(r.utm), camp: re(r.camp), src: re(r.src), noUtm: !!r.noUtm, why: r.why || '' };
    });
    _ov = lsGet(OV_LS, {}) || {};
  }
  // ключ джерела для ручного перевизначення: UTM-джерело або назва «Джерела» угоди
  const srcKey = (us, sname) => (us || '').trim() ? 'utm:' + us.trim().toLowerCase() : 'src:' + (sname || '').trim();
  function match(us, uc, sname, ch) {
    us = (us || '').trim(); const l = (ch || '').toLowerCase();
    for (let i = 0; i < _rules.length; i++) {
      const r = _rules[i];
      if (r.noUtm && us) continue;
      if (r.ch && !r.ch.has(l)) continue;
      if (r.utm && !r.utm.test(us)) continue;
      if (r.camp && !r.camp.test(uc || '')) continue;
      if (r.src && !r.src.test(us ? '' : (sname || ''))) continue;
      return { cls: r.cls, i, why: r.why };
    }
    return { cls: _def, i: -1, why: 'за замовчуванням' };
  }
  // v7.7: правила за КЛІЄНТОМ мають пріоритет над джерелом (Влад / Олег, 21.10.2026):
  //   t='k' — клієнт-«слон» (WON ≥ 1 млн ₴ за 12 міс, напр. клієнт №1) → завжди «не маркетинг», хоч би як менеджер позначив джерело;
  //   t='r' — повторна угода (прапорець Bitrix «Повторна угода»): без рекламної UTM → «не маркетинг»,
  //           з UTM-міткою → за правилами джерел (клієнт повернувся через рекламу — заслуга маркетингу);
  //   ''    — перша угода клієнта → за правилами джерел.
  function clientRule(t, us) {
    const c = (_raw && _raw.clients) || {};
    if (t === 'k') return { cls: CLS.includes(c.key) ? c.key : 'non', why: 'ключовий клієнт («слон», WON ≥ 1 млн ₴ за 12 міс) — не заслуга маркетингу' };
    if (t === 'r' && !(us || '').trim()) return { cls: CLS.includes(c.repeatNoUtm) ? c.repeatNoUtm : 'non', why: 'повторна угода без рекламної UTM-мітки' };
    return null;
  }
  function classify(us, uc, sname, ch, t) {
    if (!_rules.length) setRules(null);
    const cr = clientRule(t, us); if (cr) return cr.cls;
    const o = _ov[srcKey(us, sname)];
    return CLS.includes(o) ? o : match(us, uc, sname, ch).cls;
  }

  // ── дані ──
  const ym = d => d.slice(0, 7);
  function monthList(api) {
    const t = api.today(), ms = api.monthsWithCohort().map(m => m.month);
    const a = ms[0] || t.slice(0, 7), out = [];
    for (let [y, m] = a.split('-').map(Number); `${y}-${String(m).padStart(2, '0')}` <= t.slice(0, 7); m === 12 ? (y++, m = 1) : m++) out.push(`${y}-${String(m).padStart(2, '0')}`);
    return out;
  }
  const empty = () => ({ n: 0, w: 0, ws: 0 });

  function render(api, from, to) {
    _api = api; _from = from; _to = to;
    if (!$('mkt-split-root')) return;
    const all = api.bitrixRows('2000-01-01', api.today());
    const months = monthList(api);
    const fD = d => d.split('-').reverse().join('.');
    const per = from === to ? fD(from) : `${fD(from)} – ${fD(to)}`;
    document.querySelectorAll('.ms-per').forEach(e => e.textContent = per);
    try { renderSpend(api, months, from, to, all); } catch (e) { console.warn('[MktSplit spend]', e); }
    try { renderSplit(api, all, months, from, to); } catch (e) { console.warn('[MktSplit split]', e); }
    try { renderMeta(api, all, months, from, to); } catch (e) { console.warn('[MktSplit meta]', e); }
    try { renderReact(api, all, months, from, to); } catch (e) { console.warn('[MktSplit react]', e); }
    try { renderTop(api, all, from, to); } catch (e) { console.warn('[MktSplit top]', e); }
  }

  const tile = (l, v, sub, col, tip) => `<div class="roi-k" title="${esc(tip || '')}"><div class="l">${l}</div><div class="v"${col ? ` style="color:${col}"` : ''}>${v}</div><div class="s">${sub || ''}</div></div>`;
  const legendOpts = { position: 'top', labels: { usePointStyle: true, padding: 8, font: { size: 9 }, filter: i => i.text !== 'Σ' } };
  // v7.2: числа на стовпцях (chartjs-plugin-datalabels локально): сегменти — якщо помітні (≥ 7% висоти осі), зверху — сума стека
  const DLP = () => window.ChartDataLabels ? [window.ChartDataLabels] : [];
  const segDL = f => ({
    display: ctx => { const ds = ctx.dataset, v = ds.data[ctx.dataIndex]; if (!v || ds.type === 'line') return false;
      const ax = ctx.chart.scales[ds.yAxisID || 'y']; return ax && ax.max ? v / ax.max >= 0.07 : true; },
    color: '#fff', font: { size: 9, weight: '700' }, anchor: 'center', align: 'center', clamp: true, formatter: v => f(v) });
  const totalDS = (data, f, yAxisID) => ({ label: 'Σ', type: 'line', data, showLine: false, pointRadius: 0, pointHitRadius: 0, yAxisID: yAxisID || 'y',
    datalabels: { display: ctx => !!ctx.dataset.data[ctx.dataIndex], align: 'top', anchor: 'end', offset: 1, color: '#2b3a2e', font: { size: 9, weight: '800' }, formatter: v => f(v) } });
  const noSigma = { filter: i => i.dataset.label !== 'Σ' };
  const nfmt = v => Math.round(v).toLocaleString('uk-UA');
  // співвідношення a : b у зручному вигляді (18 : 1, 1 : 4.5)
  const ratio = (a, b) => !a && !b ? '—' : !b ? `${nfmt(a)} : 0` : !a ? `0 : ${nfmt(b)}` : a >= b ? `${(a / b).toFixed(a / b >= 10 ? 0 : 1)} : 1` : `1 : ${(b / a).toFixed(b / a >= 10 ? 0 : 1)}`;

  // ── 1. Витрати по акаунтах ──
  function renderSpend(api, months, from, to, all) {
    const el = $('ms-spend-kpi'); if (!el) return;
    const fmt = api.fmt, acc = lsGet(SP_LS, 'all');
    const g = api.googleDaily('2000-01-01', api.today()), mt = api.metaDaily('2000-01-01', api.today());
    const grp = r => /ukr/i.test(r.acc || '') ? 'ukr3d' : 'easy';
    const byM = {}; months.forEach(m => byM[m] = { easy: 0, ukr3d: 0, meta: 0 });
    g.forEach(r => { const m = byM[ym(r.d)]; if (m) m[grp(r)] += r.cost; });
    mt.forEach(r => { const m = byM[ym(r.d)]; if (m) m.meta += r.cost; });
    const P = { easy: 0, ukr3d: 0, meta: 0 };
    g.filter(r => r.d >= from && r.d <= to).forEach(r => P[grp(r)] += r.cost);
    mt.filter(r => r.d >= from && r.d <= to).forEach(r => P.meta += r.cost);
    const tot = P.easy + P.ukr3d + P.meta;
    const gaAcc = [...new Set(g.map(r => r.acc))].filter(Boolean);
    const ukrSt = ((api.ga && api.ga.extraProperties) || []).find(x => x.tag === 'ukr3d');
    const hasUkr = g.some(r => grp(r) === 'ukr3d'), hasMeta = !!(api.meta && api.meta.rows);
    const sh = v => tot ? ` · ${(v / tot * 100).toFixed(0)}% від усіх` : '';
    el.innerHTML =
      tile('EASY · Google Ads', fmt(P.easy) + ' ₴', 'акаунт ' + (gaAcc.filter(a => !/ukr/i.test(a)).join(', ') || 'EASY') + sh(P.easy), WH) +
      tile('Ukr3d · Google Ads', hasUkr ? fmt(P.ukr3d) + ' ₴' : 'немає даних', hasUkr ? 'ресурс GA4 ukr3dprint.com' + sh(P.ukr3d) : (ukrSt && ukrSt.err ? 'GA4 ukr3dprint.com: ' + ukrSt.err : 'вартість Ukr3d ще не надходить'), hasUkr ? UKR : 'var(--tl)',
        'Вартість Ukr3d береться з ресурсу GA4 ukr3dprint.com (353447917), до якого прив\'язаний Ads-акаунт Ukr3d') +
      tile('Meta · Facebook + Instagram', hasMeta ? fmt(P.meta) + ' ₴' : 'не підключено', hasMeta ? 'Meta Ads API' + sh(P.meta) : 'потрібен токен з ads_read', hasMeta ? META : 'var(--tl)') +
      tile('Разом на рекламу', fmt(tot) + ' ₴', 'за період таблиці ROI', GD);
    const note = $('ms-spend-note');
    if (note) note.innerHTML = (!hasUkr ? (ukrSt && ukrSt.err
        ? `⚠ <b>Ukr3d</b>: ресурс GA4 ukr3dprint.com (353447917) — ${esc(ukrSt.err)}. Додай service account дашборду в GA → Admin → Property access management цього ресурсу з роллю «Viewer»; витрати з'являться після наступного запуску update-ga4. `
        : ukrSt && ukrSt.ok ? `⚠ <b>Ukr3d</b>: доступ до ресурсу GA4 ukr3dprint.com є, але вартості Ads там немає — перевір у ньому Admin → Product links → Google Ads links (має бути прив'язаний Ads-акаунт Ukr3d). `
        : `⚠ <b>Ukr3d</b>: витрати підтягнуться з ресурсу GA4 ukr3dprint.com (353447917) після оновлення update-ga4 (v7.1) — потрібен доступ «Viewer» для service account дашборду. `) : '') +
      (!hasMeta ? `Meta: додай секрети <code>META_ACCESS_TOKEN</code> і <code>META_AD_ACCOUNT_IDS</code> — job <b>update-meta</b> підтягне витрати по днях.` : '');
    // v7.2: стан джерел витрат + угоди Google за період, яким не знайшлося вартості (і чому)
    const st = $('ms-cost-status');
    if (st && all) {
      const last = arr => arr.length ? arr.reduce((m, r) => r.d > m ? r.d : m, '') : null;
      const fD = d => d ? d.split('-').reverse().join('.') : '—';
      const gE = g.filter(r => grp(r) === 'easy'), gU = g.filter(r => grp(r) === 'ukr3d');
      const ok = (b, t) => `<span style="color:${b ? GD : R};font-weight:700">${b ? '✓' : '✗'}</span> ${t}`;
      const costNames = new Set(g.filter(r => r.d >= from && r.d <= to).map(r => r.camp)), everNames = new Set(g.map(r => r.camp)), sn = all.srcNames, miss = {};
      all.rows.forEach(r => {
        if (!r.d || r.d < from || r.d > to || api.channelOf(r.us, r.s, sn).ch !== 'google') return;
        const nm = api.campOf((r.uc || '').trim()); if (nm && costNames.has(nm)) return;
        const x = miss[nm] || (miss[nm] = { nm, n: 0, ws: 0 }); x.n += r.n; x.ws += r.ws;
      });
      const why = nm => !nm || nm === '(not set)' ? 'кампанія не передала utm_campaign (часто Performance Max / автотеги) — вартість не прив\'язати'
        : /^\d+$/.test(nm) ? 'в utm_campaign записано ID кампанії, а не назву — потрібна заміна шаблону UTM'
        : /^gmb/i.test(nm) ? 'Google Business Profile (карти) — безкоштовний канал, вартості немає'
        : everNames.has(nm) ? 'у цьому періоді кампанія не мала витрат (зупинена; лід прийшов пізніше за кліком) — вартість є в інших місяцях'
        : 'стара / перейменована назва кампанії — потрібен відповідник поточній кампанії в Ads (аліас)';
      const ms = Object.values(miss).sort((a, b) => b.ws - a.ws || b.n - a.n);
      const mN = ms.reduce((s, x) => s + x.n, 0), mW = ms.reduce((s, x) => s + x.ws, 0);
      st.innerHTML = `<div style="display:grid;gap:3px">
        <div>${ok(gE.length, `<b>Google Ads EASY</b> (856-547-8539) → GA4 easy3dprint.com.ua — дані до ${fD(last(gE))}`)}</div>
        <div>${ok(gU.length, `<b>Google Ads Ukr3d</b> (265-403-5891) → GA4 ukr3dprint.com — ${gU.length ? 'дані до ' + fD(last(gU)) : esc((ukrSt && (ukrSt.err || ukrSt.note)) || 'ще не надходять')}`)}</div>
        <div>${(() => { const ms = api.meta && api.meta.status, bad = ms && ms.ok === false;
          return ok(hasMeta && !bad, `<b>Meta (Facebook + Instagram)</b> — ${hasMeta ? 'Meta Ads API (Ukr3DPrint2, Easy3DPrint), дані до ' + fD(last(mt)) : 'не підключено: потрібен токен з ads_read (секрет META_ACCESS_TOKEN)'}` +
            (bad ? ` · <b style="color:${R}">⚠ ${esc(ms.msg)}</b> (з ${fD((ms.at || '').slice(0, 10))}) — показані останні отримані дані` : '')); })()}</div>
        <div style="color:var(--tl)">Без вартості за природою: дзвінки, пошта, сайт, форми, існуючі клієнти, холодні продажі, рекомендації, органіка — це не реклама, «—» у колонці «Вартість» для них нормальне.</div>
        ${ms.length ? `<div style="margin-top:4px"><b>Угоди з utm_source=google за період без вартості:</b> ${mN} угод, ${fmt(mW)} ₴ WON — вони не потрапляють у ROAS/ROMI:</div>
        <table class="roi-ddt" style="max-width:900px"><thead><tr><th>utm_campaign</th><th class="r">Угод</th><th class="r">WON сума</th><th>Чому немає вартості</th></tr></thead><tbody>` +
          ms.slice(0, 15).map(x => `<tr><td>${esc(x.nm || '(порожньо)')}</td><td class="r">${x.n}</td><td class="r">${fmt(x.ws)}</td><td>${why(x.nm)}</td></tr>`).join('') + `</tbody></table>` : `<div>${ok(true, 'усі угоди з utm_source=google за період мають вартість кампанії')}</div>`}
      </div>`;
    }
    document.querySelectorAll('#ms-spend-acc button').forEach(b => {
      b.classList.toggle('on', b.dataset.v === acc);
      b.onclick = () => { lsSet(SP_LS, b.dataset.v); renderSpend(api, months, from, to, all); };
    });
    const show = k => acc === 'all' || acc === k;
    const ds = [['easy', 'EASY (Google)', WH], ['ukr3d', 'Ukr3d (Google)', UKR], ['meta', 'Meta (FB+IG)', META]]
      .filter(([k]) => show(k)).map(([k, l, c]) => ({ label: l, data: months.map(m => Math.round(byM[m][k])), backgroundColor: c, borderRadius: 3, stack: 's' }));
    ds.push(totalDS(months.map(m => Math.round(ds.reduce((s, d) => s + (d.data[months.indexOf(m)] || 0), 0))), v => fmt(v)));
    const cur = api.today().slice(0, 7);
    api.chart('ms-spend-chart', { type: 'bar', plugins: DLP(), data: { labels: months.map(m => m + (m === cur ? '*' : '')), datasets: ds },
      options: { responsive: true, maintainAspectRatio: false, layout: { padding: { top: 14 } }, plugins: { legend: legendOpts, datalabels: segDL(v => fmt(v)),
        tooltip: Object.assign({ callbacks: { label: c => `${c.dataset.label}: ${fmt(c.parsed.y)} ₴` } }, noSigma) },
        scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, beginAtZero: true, grid: { color: GRID }, ticks: { callback: v => fmt(v) } } } } });
  }

  // ── 2. Маркетинг / не маркетинг ──
  function renderSplit(api, all, months, from, to) {
    const el = $('ms-split-kpi'); if (!el) return;
    const fmt = api.fmt, sn = all.srcNames;
    const byM = {}; months.forEach(m => byM[m] = { mkt: empty(), non: empty(), unk: empty() });
    const nonCh = {}, srcP = {}, P = { mkt: empty(), non: empty(), unk: empty() }, K = empty(), RU = empty(), RN = empty();
    let typed = false;
    all.rows.forEach(r => {
      const name = sn[r.s] || r.s || '', ch = api.channelOf(r.us, r.s, sn).ch, c = classify(r.us, r.uc, name, ch, r.t);
      if (r.t) typed = true;
      const m = byM[ym(r.d || '')]; if (m) { m[c].n += r.n; m[c].w += r.w; m[c].ws += r.ws; }
      if (c === 'non' && r.d) { const k = ch; (nonCh[k] || (nonCh[k] = {}))[ym(r.d)] = ((nonCh[k] || {})[ym(r.d)] || 0) + r.n; }
      if (r.d && r.d >= from && r.d <= to) {
        P[c].n += r.n; P[c].w += r.w; P[c].ws += r.ws;
        const g = r.t === 'k' ? K : r.t === 'r' ? ((r.us || '').trim() ? RU : RN) : null;
        if (g) { g.n += r.n; g.w += r.w; g.ws += r.ws; }
        const ckey = srcKey(r.us, name), t = r.t === 'k' ? 'k' : (r.t === 'r' && !(r.us || '').trim()) ? 'r' : '';
        const key = ckey + '|' + t;
        const x = srcP[key] || (srcP[key] = { key, ckey, t, lbl: ((r.us || '').trim() ? 'UTM: ' + r.us.trim().toLowerCase() : (name || 'не вказано')) +
          (t === 'k' ? ' · «слон»' : t === 'r' ? ' · повторна' : ''), ch, n: 0, w: 0, ws: 0, us: r.us, uc: r.uc, name });
        x.n += r.n; x.w += r.w; x.ws += r.ws;
      }
    });
    const N = P.mkt.n + P.non.n + P.unk.n, WS = P.mkt.ws + P.non.ws + P.unk.ws;
    el.innerHTML = CLS.map(c => tile(LBL[c], P[c].n.toLocaleString('uk-UA') + ' лідів',
      `${N ? (P[c].n / N * 100).toFixed(0) : 0}% лідів · WON ${P[c].w} · ${fmt(P[c].ws)} ₴ (${WS ? (P[c].ws / WS * 100).toFixed(0) : 0}% виручки)`, CLS_C[c],
      c === 'unk' ? 'Джерела, щодо яких ще немає рішення (дзвінки, сайт, пошта, форми…) — Влад визначає умови' : '')).join('') +
      tile('Конверсія в WON', CLS.map(c => p0(P[c].n ? P[c].w / P[c].n * 100 : null)).join(' / '), 'маркетинг / не маркетинг / не визначено') +
      tile('Маркетинг : не маркетинг', ratio(P.mkt.n, P.non.n) + ' <span style="font-size:11px;font-weight:600">лідів</span>',
        `WON ${ratio(P.mkt.w, P.non.w)} · виручка ${ratio(P.mkt.ws, P.non.ws)}<br>виручка на 1 лід: ${fmt(P.mkt.n ? P.mkt.ws / P.mkt.n : 0)} ₴ vs ${fmt(P.non.n ? P.non.ws / P.non.n : 0)} ₴` +
        (P.mkt.ws && P.non.n && P.mkt.n ? ` → 1 лід не-маркетингу ≈ <b>${nfmt((P.non.ws / P.non.n) / (P.mkt.ws / P.mkt.n))}</b> лідів маркетингу` : ''), GD,
        'Скільки маркетингових лідів / WON / виручки припадає на одиницю не-маркетингових. «Не визначено» не враховано.') +
      (typed ? tile('Ключові клієнти («слони»)', K.n.toLocaleString('uk-UA') + ' лідів',
        `WON ${K.w} · ${fmt(K.ws)} ₴ (${WS ? (K.ws / WS * 100).toFixed(0) : 0}% виручки) — завжди «не маркетинг»`, RT,
        'Клієнти з WON-виручкою ≥ 1 млн ₴ за 12 місяців (у т.ч. клієнт №1) + ручний список. Їхні угоди не зараховуються маркетингу, незалежно від «Джерела» в Bitrix') +
      tile('Повторні угоди', (RN.n + RU.n).toLocaleString('uk-UA'),
        `без UTM → не маркетинг: ${RN.n} · з рекламною UTM → за джерелом: ${RU.n} (WON ${RU.w}, ${fmt(RU.ws)} ₴)`, null,
        'Прапорець Bitrix «Повторна угода» (IS_RETURN_CUSTOMER). Повторна угода з UTM-міткою реклами = клієнт повернувся через рекламу — заслуга маркетингу')
      : `<div class="roi-kw" style="color:var(--td);background:var(--s2);border-color:var(--bd)">ℹ Розподіл «слони / повторні / перші угоди» з'явиться після оновлення update-crm (v7.7); для місяців до жовтня — після одного запуску «Backfill CRM Monthly History».</div>`);
    const status = $('ms-split-status');
    if (status) status.innerHTML = `${esc((_raw && _raw.status) || '')}${_raw && _raw.updated ? ' · оновлено ' + esc(_raw.updated) : ''}${Object.keys(_ov).length ? ` · <b style="color:${RT}">${Object.keys(_ov).length} джерел перевизначено вручну у цьому браузері</b>` : ''}`;

    const metric = lsGet(SPL_LS, 'n');
    document.querySelectorAll('#ms-split-metric button').forEach(b => {
      b.classList.toggle('on', b.dataset.v === metric);
      b.onclick = () => { lsSet(SPL_LS, b.dataset.v); renderSplit(api, all, months, from, to); };
    });
    const cur = api.today().slice(0, 7), labels = months.map(m => m + (m === cur ? '*' : ''));
    const val = (m, c) => metric === 'ws' ? Math.round(byM[m][c].ws) : byM[m][c][metric];
    api.chart('ms-split-chart', { type: 'bar', plugins: DLP(), data: { labels, datasets: CLS.map(c => ({ label: LBL[c], data: months.map(m => val(m, c)), backgroundColor: CLS_C[c], borderRadius: 3, stack: 's', yAxisID: 'y' }))
      .concat([{ label: '% від маркетингу', type: 'line', yAxisID: 'y1', borderColor: GD, backgroundColor: GD, pointRadius: 2, tension: .3, borderDash: [4, 3],
        data: months.map(m => { const t = CLS.reduce((s, c) => s + val(m, c), 0); return t ? +(val(m, 'mkt') / t * 100).toFixed(1) : null; }) },
        totalDS(months.map(m => CLS.reduce((s, c) => s + val(m, c), 0)), v => metric === 'ws' ? fmt(v) : nfmt(v))]) },
      options: { responsive: true, maintainAspectRatio: false, layout: { padding: { top: 14 } }, plugins: { legend: legendOpts, datalabels: segDL(v => metric === 'ws' ? fmt(v) : nfmt(v)),
        tooltip: Object.assign({ callbacks: { label: c => c.dataset.yAxisID === 'y1' ? `${c.dataset.label}: ${c.parsed.y}%` : `${c.dataset.label}: ${metric === 'ws' ? fmt(c.parsed.y) + ' ₴' : c.parsed.y}`,
          footer: it => { const i = it[0] && it[0].dataIndex, m = months[i]; return m ? `маркетинг : не маркетинг = ${ratio(val(m, 'mkt'), val(m, 'non'))}` : ''; } } }, noSigma) },
        scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, beginAtZero: true, grid: { color: GRID }, ticks: { callback: v => metric === 'ws' ? fmt(v) : v.toLocaleString('uk-UA') } },
          y1: { position: 'right', beginAtZero: true, max: 100, grid: { drawOnChartArea: false }, ticks: { callback: v => v + '%' } } } } });
    // графік лідів «не від маркетингу» по каналах (пункт зустрічі)
    const top = Object.entries(nonCh).map(([k, v]) => [k, Object.values(v).reduce((a, b) => a + b, 0)]).sort((a, b) => b[1] - a[1]);
    // v7.2: контрастні кольори (раніше відтінки однієї гами зливались)
    const PAL = ['#E67E22', '#8E44AD', '#C0392B', '#2471A3', '#27AE60', '#7F8C8D'];
    const keys = top.slice(0, 5).map(x => x[0]);
    const ds2 = keys.map((k, i) => ({ label: k, data: months.map(m => nonCh[k][m] || 0), backgroundColor: PAL[i], borderRadius: 3, stack: 's' }));
    if (top.length > 5) ds2.push({ label: 'інші', data: months.map(m => top.slice(5).reduce((s, [k]) => s + (nonCh[k][m] || 0), 0)), backgroundColor: PAL[5], borderRadius: 3, stack: 's' });
    ds2.push(totalDS(months.map((m, i) => ds2.reduce((s, d) => s + (d.data[i] || 0), 0)), nfmt));
    api.chart('ms-non-chart', { type: 'bar', plugins: DLP(), data: { labels, datasets: ds2 },
      options: { responsive: true, maintainAspectRatio: false, layout: { padding: { top: 14 } }, plugins: { legend: legendOpts, datalabels: segDL(nfmt), tooltip: noSigma },
        scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, beginAtZero: true, grid: { color: GRID } } } } });

    // таблиця джерел за період з класом і правилом (редагування — локально, експорт у JSON)
    const tb = $('ms-src-table'); if (!tb) return;
    const arr = Object.values(srcP).sort((a, b) => b.n - a.n);
    tb.innerHTML = arr.length ? arr.map(x => {
      const cr = clientRule(x.t, x.us);
      if (cr) return `<tr><td><span class="roi-cls" style="background:${CLS_C[cr.cls]}"></span>${esc(x.lbl)}</td><td style="color:var(--tl)">${esc(x.ch)}</td>
        <td class="r">${x.n}</td><td class="r">${x.w}</td><td class="r">${fmt(x.ws)}</td><td>${LBL[cr.cls]}</td><td style="color:var(--tl);font-size:10px">${esc(cr.why)}</td></tr>`;
      const m = match(x.us, x.uc, x.name, x.ch), o = _ov[x.ckey], c = CLS.includes(o) ? o : m.cls;
      return `<tr><td><span class="roi-cls" style="background:${CLS_C[c]}"></span>${esc(x.lbl)}</td><td style="color:var(--tl)">${esc(x.ch)}</td>
        <td class="r">${x.n}</td><td class="r">${x.w}</td><td class="r">${fmt(x.ws)}</td>
        <td><select class="ms-sel" data-key="${esc(x.key)}">${CLS.map(k => `<option value="${k}"${k === c ? ' selected' : ''}>${LBL[k]}</option>`).join('')}</select>${o ? ' <span class="ms-ov" title="Перевизначено вручну в цьому браузері">✎</span>' : ''}</td>
        <td style="color:var(--tl);font-size:10px">${o ? `вручну (за правилом: ${esc(LBL[m.cls])})` : esc(m.i >= 0 ? `#${m.i + 1}: ${m.why}` : m.why)}</td></tr>`;
    }).join('') : `<tr><td colspan="7" style="color:var(--tl);font-weight:400">Немає угод за період</td></tr>`;
    tb.onchange = ev => {
      const s = ev.target.closest('.ms-sel'); if (!s) return;
      const x = srcP[s.dataset.key], base = match(x.us, x.uc, x.name, x.ch).cls;
      if (s.value === base) delete _ov[x.ckey]; else _ov[x.ckey] = s.value;
      lsSet(OV_LS, _ov); api.rerender();
    };
    const ex = $('ms-rules-export');
    if (ex) ex.onclick = ev => { ev.preventDefault(); exportRules(); };
    const rs = $('ms-rules-reset');
    if (rs) { rs.style.display = Object.keys(_ov).length ? '' : 'none'; rs.onclick = ev => { ev.preventDefault(); _ov = {}; lsSet(OV_LS, _ov); api.rerender(); }; }
  }

  // ручні зміни → точні правила на початку списку → JSON для data/marketing_rules.json
  function exportRules() {
    const reEsc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const extra = Object.entries(_ov).map(([k, c]) => k.startsWith('utm:')
      ? { class: c, utm: '^' + reEsc(k.slice(4)) + '$', why: 'вручну на дашборді' }
      : { class: c, noUtm: true, src: '^' + reEsc(k.slice(4)) + '$', why: 'вручну на дашборді' });
    const base = JSON.parse(JSON.stringify(_raw || DRAFT));
    base.rules = extra.concat((base.rules || []).filter(r => !extra.some(e => JSON.stringify(e) === JSON.stringify(r))));
    base.updated = new Date().toISOString().slice(0, 10);
    const txt = JSON.stringify(base, null, 2);
    const out = $('ms-rules-json');
    if (out) { out.value = txt; out.style.display = ''; out.select(); }
    try { navigator.clipboard && navigator.clipboard.writeText(txt).catch(() => {}); } catch (e) {}
    const st = $('ms-rules-msg');
    if (st) st.textContent = 'JSON скопійовано — встав у data/marketing_rules.json у репозиторії (✏️ Edit → Commit). Після оновлення сторінки правила застосуються для всіх.';
  }

  // ── 3. Facebook + Instagram ──
  function renderMeta(api, all, months, from, to) {
    const el = $('ms-meta-kpi'); if (!el) return;
    const fmt = api.fmt, sn = all.srcNames;
    const sub = (ch, us) => ch === 'instagram' ? 'instagram' : ch === 'facebook' ? 'facebook' : (/^\d+$/.test((us || '').trim()) ? 'meta' : null);
    const byM = {}; months.forEach(m => byM[m] = { facebook: 0, instagram: 0, meta: 0, w: 0, ws: 0, cost: 0 });
    const P = { n: 0, w: 0, ws: 0, cost: 0, lead: 0, fb: 0, ig: 0 }, rows = {};
    all.rows.forEach(r => {
      if (r.t === 'k') return;   // v7.11: угоди «слонів» (клієнт №1 тощо) — не результат реклами FB/IG
      const c = api.channelOf(r.us, r.s, sn), k = sub(c.ch, r.us); if (!k) return;
      const m = byM[ym(r.d || '')]; if (m) { m[k] += r.n; m.w += r.w; m.ws += r.ws; }
      if (r.d >= from && r.d <= to) {
        P.n += r.n; P.w += r.w; P.ws += r.ws; if (k === 'instagram') P.ig += r.n; else P.fb += r.n;
        const nm = (r.uc || '').trim(), key = c.ch + '|' + c.acc + '|' + nm;
        const x = rows[key] || (rows[key] = { ch: c.ch, acc: c.acc, name: nm, n: 0, w: 0, ws: 0, cost: null, lead: 0 });
        x.n += r.n; x.w += r.w; x.ws += r.ws;
      }
    });
    const md = api.metaDaily('2000-01-01', api.today()), hasMeta = !!(api.meta && api.meta.rows);
    md.forEach(r => { const m = byM[ym(r.d)]; if (m) m.cost += r.cost; });
    const byName = {}; Object.values(rows).forEach(x => { if (x.name) byName[x.name.toLowerCase()] = x; });
    md.filter(r => r.d >= from && r.d <= to).forEach(r => {
      P.cost += r.cost; P.lead += r.lead + r.msg;
      const x = byName[(r.camp || '').toLowerCase()] || byName[String(r.cid)] ||
        (rows['meta|' + r.acc + '|' + r.camp] || (rows['meta|' + r.acc + '|' + r.camp] = { ch: 'meta', acc: r.acc, name: r.camp, n: 0, w: 0, ws: 0, cost: null, lead: 0 }));
      x.cost = (x.cost || 0) + r.cost; x.lead += r.lead + r.msg;
    });
    el.innerHTML =
      tile('Ліди FB + IG у CRM', P.n.toLocaleString('uk-UA'), `Facebook ${P.fb} · Instagram ${P.ig}`, FB) +
      tile('WON', String(P.w), `конверсія ${p0(P.n ? P.w / P.n * 100 : null)}`) +
      tile('WON-виручка', fmt(P.ws) + ' ₴', 'угоди, створені в періоді', GD) +
      tile('Витрати Meta', hasMeta ? fmt(P.cost) + ' ₴' : 'не підключено', hasMeta ? `заявок за даними Meta: ${fmt(P.lead)}` : 'потрібен токен Meta API', hasMeta ? META : 'var(--tl)') +
      tile('CPL / ROAS', hasMeta && P.cost ? `${P.n ? fmt(P.cost / P.n) : '—'} ₴ / ${p0(P.ws / P.cost * 100)}` : '—', 'витрати ÷ ліди CRM / виручка ÷ витрати');
    const cur = api.today().slice(0, 7);
    const ds = [['facebook', 'Facebook', FB], ['instagram', 'Instagram', IG], ['meta', 'Meta (UTM = ID)', '#7F9CD6']]
      .map(([k, l, c]) => ({ label: l, data: months.map(m => byM[m][k]), backgroundColor: c, borderRadius: 3, stack: 's', yAxisID: 'y' }))
      .concat([{ label: 'WON-виручка, ₴', type: 'line', yAxisID: 'y1', data: months.map(m => Math.round(byM[m].ws)), borderColor: GD, backgroundColor: GD, pointRadius: 2, tension: .3 }]);
    if (hasMeta) ds.push({ label: 'Витрати Meta, ₴', type: 'line', yAxisID: 'y1', data: months.map(m => Math.round(byM[m].cost)), borderColor: R, backgroundColor: R, pointRadius: 2, tension: .3, borderDash: [4, 3] });
    api.chart('ms-meta-chart', { type: 'bar', plugins: DLP(), data: { labels: months.map(m => m + (m === cur ? '*' : '')), datasets: ds },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: legendOpts, datalabels: segDL(nfmt) },
        scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, beginAtZero: true, grid: { color: GRID }, title: { display: true, text: 'ліди', font: { size: 9 } } },
          y1: { position: 'right', beginAtZero: true, grid: { drawOnChartArea: false }, ticks: { callback: v => fmt(v) } } } } });
    const tb = $('ms-meta-table'); if (!tb) return;
    const arr = Object.values(rows).sort((a, b) => (b.ws - a.ws) || (b.n - a.n));
    tb.innerHTML = arr.length ? arr.slice(0, 40).map(x => `<tr><td><span class="roi-ch">${esc(x.ch)}</span>${x.acc ? `<span class="roi-acc"> / ${esc(x.acc)}</span>` : ''}</td>
      <td style="font-weight:500">${x.name ? esc(x.name) : '<span style="color:var(--tl)">без UTM</span>'}</td>
      <td class="r">${x.cost != null ? fmt(x.cost) : '—'}</td><td class="r">${x.lead || (x.cost != null ? 0 : '—')}</td><td class="r">${x.n}</td><td class="r">${x.cost && x.n ? fmt(x.cost / x.n) : '—'}</td>
      <td class="r">${x.w}</td><td class="r" style="font-weight:700">${fmt(x.ws)}</td><td class="r">${x.cost ? p0(x.ws / x.cost * 100) : '—'}</td></tr>`).join('')
      : `<tr><td colspan="9" style="color:var(--tl);font-weight:400">Немає лідів з Facebook / Instagram за період</td></tr>`;
  }

  // ── 4. Retention силами маркетингу ──
  function renderReact(api, all, months, from, to) {
    const el = $('ms-react-kpi'); if (!el) return;
    const fmt = api.fmt, sn = all.srcNames, cl = api.clients || {};
    const rx = cl.reactivation && cl.reactivation.rows, acq = cl.acquisition && cl.acquisition.rows;
    if (!rx) {
      el.innerHTML = `<div class="roi-kw" style="color:var(--td);background:var(--s2);border-color:var(--bd)">ℹ Блок з'явиться після нічного запуску <b>update-clients</b> з v7.0 (рахує повернення клієнтів після паузи ≥ 180 днів і канал угоди повернення).</div>`;
      const c = $('ms-react-chart'); if (c) c.parentElement.style.display = 'none';
      return;
    }
    const c0 = $('ms-react-chart'); if (c0) c0.parentElement.style.display = '';
    const kind = (r) => classify(r.us, r.uc, sn[r.s] || r.s || '', api.channelOf(r.us, r.s, sn).ch, r.k ? 'k' : '');
    const byM = {}; months.forEach(m => byM[m] = { rm: 0, rn: 0, ru: 0, nm: 0, revM: 0 });
    const mA = from.slice(0, 7), mB = to.slice(0, 7);
    const P = { r: { mkt: { n: 0, p: 0, rev: 0 }, non: { n: 0, p: 0, rev: 0 }, unk: { n: 0, p: 0, rev: 0 } }, newM: 0, newMp: 0, newMrev: 0, newAll: 0 };
    rx.forEach(r => {
      const c = kind(r), m = byM[r.m];
      if (m) { m[c === 'mkt' ? 'rm' : c === 'non' ? 'rn' : 'ru'] += r.n; if (c === 'mkt') m.revM += r.rev; }
      if (r.m >= mA && r.m <= mB) { const x = P.r[c]; x.n += r.n; x.p += r.p; x.rev += r.rev; }
    });
    (acq || []).forEach(r => {
      const c = kind(r), m = byM[r.m];
      if (m && c === 'mkt') m.nm += r.n;
      if (r.m >= mA && r.m <= mB) { P.newAll += r.n; if (c === 'mkt') { P.newM += r.n; P.newMp += r.p; P.newMrev += r.rev; } }
    });
    const RN = P.r.mkt.n + P.r.non.n + P.r.unk.n, gap = cl.reactivation.gapDays || 180;
    el.innerHTML =
      tile('Повернулись після паузи', RN.toLocaleString('uk-UA'), `≥ ${gap} днів без угод · місяці ${mA === mB ? mA : mA + '–' + mB}`) +
      tile('…з них через маркетинг', P.r.mkt.n.toLocaleString('uk-UA'), `${p0(RN ? P.r.mkt.n / RN * 100 : null)} повернень · купили ${P.r.mkt.p}`, G,
        'Угода повернення прийшла з рекламного / маркетингового джерела (за правилами класифікації)') +
      tile('Виручка повернень від маркетингу', fmt(P.r.mkt.rev) + ' ₴', `WON за 365 днів після повернення · усі повернення: ${fmt(P.r.mkt.rev + P.r.non.rev + P.r.unk.rev)} ₴`, GD) +
      tile('Повернення: не маркетинг / не визначено', `${P.r.non.n} / ${P.r.unk.n}`, `виручка ${fmt(P.r.non.rev)} / ${fmt(P.r.unk.rev)} ₴`, RT) +
      tile('Нові клієнти від маркетингу', P.newM.toLocaleString('uk-UA'), `${p0(P.newAll ? P.newM / P.newAll * 100 : null)} нових клієнтів · купили ${P.newMp} · LTV-виручка ${fmt(P.newMrev)} ₴`, WH);
    const cur = api.today().slice(0, 7);
    api.chart('ms-react-chart', { type: 'bar', plugins: DLP(), data: { labels: months.map(m => m + (m === cur ? '*' : '')), datasets: [
      { label: 'Повернулись через маркетинг', data: months.map(m => byM[m].rm), backgroundColor: G, borderRadius: 3, stack: 's', yAxisID: 'y' },
      { label: 'Повернулись: не маркетинг', data: months.map(m => byM[m].rn), backgroundColor: RT, borderRadius: 3, stack: 's', yAxisID: 'y' },
      { label: 'Повернулись: не визначено', data: months.map(m => byM[m].ru), backgroundColor: GRY, borderRadius: 3, stack: 's', yAxisID: 'y' },
      { label: 'Нові клієнти від маркетингу', type: 'line', data: months.map(m => byM[m].nm), borderColor: WH, backgroundColor: WH, pointRadius: 2, tension: .3, yAxisID: 'y' },
      { label: 'Виручка повернень від маркетингу, ₴', type: 'line', data: months.map(m => Math.round(byM[m].revM)), borderColor: GD, backgroundColor: GD, borderDash: [4, 3], pointRadius: 2, tension: .3, yAxisID: 'y1' },
    ] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: legendOpts, datalabels: segDL(nfmt) },
      scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, beginAtZero: true, grid: { color: GRID }, title: { display: true, text: 'клієнтів', font: { size: 9 } } },
        y1: { position: 'right', beginAtZero: true, grid: { drawOnChartArea: false }, ticks: { callback: v => fmt(v) } } } } });
  }

  // ── 5. v7.12: ТОП клієнтів, залучених або повернутих маркетингом (без назв — псевдоніми) ──
  const TOP_LS = 'e3d_mkt_top_v1';
  function renderTop(api, all, from, to) {
    const tb = $('ms-top-table'), kp = $('ms-top-kpi'); if (!tb) return;
    const tc = api.clients && api.clients.topClients;
    if (!tc || !tc.rows) {
      tb.innerHTML = `<tr><td colspan="11" style="color:var(--tl);font-weight:400">Таблиця з'явиться після нічного запуску <b>update-clients</b> з v7.12.</td></tr>`;
      if (kp) kp.innerHTML = ''; return;
    }
    const st = Object.assign({ per: 'all', more: false }, lsGet(TOP_LS, {}));
    document.querySelectorAll('#ms-top-per button').forEach(b => { b.classList.toggle('on', b.dataset.v === st.per);
      b.onclick = () => { lsSet(TOP_LS, Object.assign(st, { per: b.dataset.v })); renderTop(api, all, from, to); }; });
    const sn = all.srcNames, fmt = api.fmt, mA = from.slice(0, 7), mB = to.slice(0, 7);
    const inPer = m => st.per === 'all' || (m >= mA && m <= mB);
    const cl = (e, t) => classify(e.us, e.uc, sn[e.s] || e.s || '', api.channelOf(e.us, e.s, sn).ch, t);
    const chan = e => { const c = api.channelOf(e.us, e.s, sn); return { ch: c.ch, acc: c.acc, camp: (e.uc || '').trim() }; };
    const rows = [];
    tc.rows.forEach(r => {
      const acq = cl(r.ft, '') === 'mkt' && inPer(r.ft.m);
      const ret = (r.ra || []).filter(e => cl(e, 'r') === 'mkt' && inPer(e.m));
      if (!acq && !ret.length) return;
      const ev = acq ? r.ft : ret[ret.length - 1];
      rows.push(Object.assign({}, r, { acq, ret: ret.length, how: acq && ret.length ? 'залучено + повернуто' : acq ? 'залучено' : 'повернуто',
        when: ev.m, src: chan(ev), attr: acq ? r.rev : ret.reduce((s, e) => s + e.rev, 0) }));
    });
    rows.sort((a, b) => b.attr - a.attr);
    const tot = rows.reduce((s, r) => s + r.attr, 0), top10 = rows.slice(0, 10).reduce((s, r) => s + r.attr, 0);
    if (kp) kp.innerHTML =
      tile('Клієнтів від маркетингу', rows.length.toLocaleString('uk-UA'), `залучено ${rows.filter(r => r.acq).length} · повернуто ${rows.filter(r => r.ret).length}`, G) +
      tile('Їхня виручка', fmt(tot) + ' ₴', 'залучені — уся WON-виручка; повернуті — 365 днів після повернення', GD) +
      tile('Частка ТОП-10', p0(tot ? top10 / tot * 100 : null), 'концентрація виручки від маркетингу') +
      tile('Середня виручка на клієнта', rows.length ? fmt(tot / rows.length) + ' ₴' : '—', 'атрибутована маркетингу');
    const show = st.more ? rows : rows.slice(0, 30);
    tb.innerHTML = show.length ? show.map((r, i) => `<tr>
        <td class="r" style="color:var(--tl)">${i + 1}</td><td style="font-family:monospace">${esc(r.id)}</td>
        <td><span class="roi-cls" style="background:${r.acq ? G : WH}"></span>${r.how}</td>
        <td><span class="roi-ch">${esc(r.src.ch)}</span>${r.src.acc ? `<span class="roi-acc"> / ${esc(r.src.acc)}</span>` : ''}${r.src.camp ? `<div style="font-size:10px;color:var(--tl)">${esc(r.src.camp)}</div>` : ''}</td>
        <td>${r.when}</td><td>${esc(r.ind || '—')}</td><td>${r.g === 'w' ? 'ОПТ' : 'Роздріб'}</td>
        <td class="r">${r.w}</td><td class="r" style="font-weight:700">${fmt(r.attr)}</td><td class="r">${fmt(r.rev12)}</td><td>${r.lw}</td></tr>`).join('') +
      (rows.length > 30 ? `<tr><td colspan="11" style="text-align:center"><a href="#" id="ms-top-more">${st.more ? 'показати ТОП-30' : `показати всіх (${rows.length})`}</a></td></tr>` : '')
      : `<tr><td colspan="11" style="color:var(--tl);font-weight:400">Немає клієнтів від маркетингу за обраний період</td></tr>`;
    const mo = $('ms-top-more'); if (mo) mo.onclick = ev => { ev.preventDefault(); lsSet(TOP_LS, Object.assign(st, { more: !st.more })); renderTop(api, all, from, to); };
  }

  return { setRules, classify, render };
})();
