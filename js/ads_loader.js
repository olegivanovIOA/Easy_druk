/**
 * ads_loader.js — Easy 3D Print Dashboard v2.0 (20.10.2026)
 * Блок «📣 Google Ads» на вкладці «Маркетинг».
 *
 * v2.0: Excel-скрипт Ads (Вадим, data/ads.json) більше не використовується — він перестав оновлюватись 10.10.2026
 * і писав вартість у тисячах, а «цінність конверсії» = 1 шт. Тепер усе з прямих джерел:
 *   - вартість / кліки / покази по днях і кампаніях — Google Analytics 4 (data/ga4.json → adsCost),
 *     обидва акаунти: EASY (ресурс easy3dprint.com.ua) і Ukr3d (ресурс ukr3dprint.com);
 *   - конверсії сайту — ключові події GA4 по кампаніях (data/ga4.json → traffic, google / cpc);
 *   - ліди, WON і виручка — Bitrix24 за utm_campaign (через LeadgenLoader.api.crmGoogle, з аліасами назв);
 *   - статус кампанії — власні прозорі правила по CRM (див. STATUS_RULES), а не «світлофор» скрипта.
 * Персональних даних немає — лише агрегати.
 */
window.AdsLoader = (() => {
  const G = '#2A9D8F', GD = '#1e7a6e', A = '#457B9D', R = '#C0392B', Y = '#C98A2B', GRID = '#f0f2ee';
  const ACC = { easy: { l: 'EASY', c: '#3D7EA6' }, ukr3d: { l: 'Ukr3d', c: '#8E6CC0' } };
  const LS = 'e3d_ads_v2';
  const NOCAMP = new Set(['', '(not set)', '(organic)', '(direct)', '(referral)', '(none)']);
  let _ga = null, _charts = {}, _st = { days: 30, acc: 'all' }, _loaded = null;

  const $ = id => document.getElementById(id);
  const fmt = n => n == null || !isFinite(n) ? '—' : Math.round(n).toLocaleString('uk-UA');
  const fmtK = n => n == null ? '—' : Math.abs(n) >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : Math.abs(n) >= 1e3 ? (n / 1e3).toFixed(0) + 'K' : String(Math.round(n));
  const iso = d => d.toISOString().slice(0, 10);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const accOf = a => /ukr/i.test(a || '') ? 'ukr3d' : 'easy';
  try { const v = JSON.parse(localStorage.getItem(LS) || 'null'); if (v) _st = Object.assign(_st, v); } catch (e) {}
  const save = () => { try { localStorage.setItem(LS, JSON.stringify(_st)); } catch (e) {} };

  // Статус кампанії за період (правила прозорі — показуються в підказці)
  const STATUS_RULES = 'GREEN — ROAS з CRM ≥ 100% (виручка покрила витрати). RED — витрати ≥ 2 000 ₴, а лідів у CRM з цією utm_campaign немає (кампанія не дає звернень або не передає UTM). YELLOW — решта: ліди є, але виручка поки менша за витрати (угоди можуть ще закритися).';
  function status(r) {
    if (!(r.cost > 0)) return null;      // без витрат (органіка, Google Business Profile, (not set)) — статус не ставимо
    if (r.cost > 0 && r.roas != null && r.roas >= 100) return 'GREEN';
    if (r.cost >= 2000 && !r.n) return 'RED';
    return 'YELLOW';
  }

  function load() {
    if (_loaded) return _loaded;
    _loaded = fetch('data/ga4.json?t=' + Date.now()).then(r => r.ok ? r.json() : null).catch(() => null).then(g => {
      _ga = g; initCtl(); render();
    });
    return _loaded;
  }
  window.addEventListener('leadgen:ready', () => { try { if (_ga) render(); } catch (e) { console.warn('[ADS]', e); } });

  function initCtl() {
    const sync = () => {
      document.querySelectorAll('#ads-days button').forEach(b => b.classList.toggle('on', +b.dataset.v === _st.days));
      document.querySelectorAll('#ads-acc button').forEach(b => b.classList.toggle('on', b.dataset.v === _st.acc));
    };
    document.querySelectorAll('#ads-days button').forEach(b => b.onclick = () => { _st.days = +b.dataset.v; save(); sync(); render(); });
    document.querySelectorAll('#ads-acc button').forEach(b => b.onclick = () => { _st.acc = b.dataset.v; save(); sync(); render(); });
    sync();
  }

  function range() {
    const max = (_ga && (_ga.fetched_at || '').slice(0, 10)) || iso(new Date());
    const to = new Date(max + 'T12:00:00Z'), from = new Date(to); from.setUTCDate(from.getUTCDate() - (_st.days - 1));
    return [iso(from), iso(to)];
  }

  function data() {
    const [from, to] = range(), accF = _st.acc;
    const ok = r => accF === 'all' || accOf(r.a) === accF;
    const ads = ((_ga && _ga.adsCost) || []).filter(r => r.d >= from && r.d <= to && ok(r));
    // назви кампаній — через ті самі аліаси, що й у таблиці ROI (старі назви → поточні), щоб CRM і витрати збігались
    const api0 = window.LeadgenLoader && LeadgenLoader.api, cof = api0 && api0.campOf ? api0.campOf : (x => x);
    // кампанії (вартість / кліки / покази) — ключ: акаунт + назва
    const camps = {};
    const C = (acc, name) => camps[acc + '|' + name] || (camps[acc + '|' + name] = { acc, name, cost: 0, clk: 0, imp: 0, ke: null, n: 0, w: 0, ws: 0 });
    ads.forEach(r => { const x = C(accOf(r.a), cof(r.c)); x.cost += r.cost || 0; x.clk += r.clk || 0; x.imp += r.imp || 0; });
    // ключові події GA4 (ресурс EASY) по кампаніях google / cpc — для однакових назв в обох акаунтах відносимо до EASY
    const keByName = {}, keByDay = {};
    ((_ga && _ga.traffic) || []).forEach(t => {
      if (t.d < from || t.d > to || NOCAMP.has(t.c) || !/google/i.test(t.s) || !/cpc|paid/i.test(t.m)) return;
      keByName[cof(t.c)] = (keByName[cof(t.c)] || 0) + (t.ke || 0); keByDay[t.d] = (keByDay[t.d] || 0) + (t.ke || 0);
    });
    // ключові події є лише з ресурсу GA4 EASY (сайт easy3dprint.com.ua) — для кампаній Ukr3d «—»
    Object.values(camps).forEach(x => { if (x.acc === 'easy') x.ke = keByName[x.name] || 0; });
    // CRM (Bitrix24) — ліди, WON, виручка за utm_campaign; назви кампаній уже з аліасами
    let crm = null;
    try { const api = window.LeadgenLoader && LeadgenLoader.api; if (api && api.crmGoogle) crm = api.crmGoogle(from, to); } catch (e) { crm = null; }
    if (crm) Object.values(crm.rows).forEach(c => {
      if (accF !== 'all' && c.acc !== accF) return;
      const x = camps[c.acc + '|' + c.name] || (c.n || c.w ? C(c.acc, c.name) : null); if (!x) return;
      x.n += c.n; x.w += c.w; x.ws += c.ws;
    });
    const rows = Object.values(camps).map(x => Object.assign(x, {
      ctr: x.imp ? x.clk / x.imp * 100 : null, cpc: x.clk ? x.cost / x.clk : null,
      cpl: x.n && x.cost ? x.cost / x.n : null, roas: x.cost ? x.ws / x.cost * 100 : null,
    }));
    rows.forEach(r => r.status = crm ? status(r) : undefined);
    // по днях
    const days = {};
    for (let d = new Date(from + 'T12:00:00Z'); iso(d) <= to; d.setUTCDate(d.getUTCDate() + 1)) days[iso(d)] = { cost: 0, clk: 0, imp: 0, ke: keByDay[iso(d)] || 0, n: 0, ws: 0 };
    ads.forEach(r => { const d = days[r.d]; if (d) { d.cost += r.cost || 0; d.clk += r.clk || 0; d.imp += r.imp || 0; } });
    if (crm) Object.entries(crm.byDay || {}).forEach(([d, v]) => { const x = days[d]; if (!x) return;
      ['easy', 'ukr3d'].forEach(a => { if (accF === 'all' || accF === a) { x.n += v[a].n; x.ws += v[a].ws; } }); });
    return { from, to, rows, days, crm: !!crm, accounts: [...new Set(((_ga && _ga.adsCost) || []).map(r => accOf(r.a)))] };
  }

  function render() {
    if (!_ga || !_ga.adsCost) {
      const s = $('ads-status'); if (s) s.innerHTML = '✗ Немає даних Google Analytics (data/ga4.json) — перевір job update-ga4.';
      return;
    }
    const D = data(), rows = D.rows.filter(r => r.cost > 0 || r.n);
    const S = f => rows.reduce((s, r) => s + (r[f] || 0), 0);
    const cost = S('cost'), clk = S('clk'), imp = S('imp'), n = S('n'), ws = S('ws');
    const paidN = rows.filter(r => r.cost > 0).reduce((s, r) => s + r.n, 0), paidWs = rows.filter(r => r.cost > 0).reduce((s, r) => s + r.ws, 0);
    const roas = cost ? paidWs / cost * 100 : null;
    const red = rows.filter(r => r.status === 'RED');
    const fD = d => d.split('-').reverse().join('.');
    const set = (id, v, col) => { const e = $(id); if (e) { e.innerHTML = v; e.style.color = col || ''; } };
    set('ads-cost-total', fmt(cost) + ' ₴');
    set('ads-clicks-total', fmt(clk) + `<span style="font-size:10px;font-weight:600;color:var(--tl)"> · CTR ${imp ? (clk / imp * 100).toFixed(2) : '—'}%</span>`);
    set('ads-cpc', clk ? fmt(cost / clk) + ' ₴' : '—');
    set('ads-conv-total', D.crm ? fmt(n) + `<span style="font-size:10px;font-weight:600;color:var(--tl)"> · CPL ${paidN ? fmt(cost / paidN) : '—'} ₴</span>` : '…', D.crm ? GD : null);
    set('ads-roas-avg', D.crm ? (roas != null ? roas.toFixed(0) + '%' : '—') + `<span style="font-size:10px;font-weight:600;color:var(--tl)"> · ${fmtK(ws)} ₴</span>` : '…',
      roas == null ? null : roas >= 300 ? GD : roas >= 100 ? A : R);
    set('ads-red-count', D.crm ? String(red.length) : '…', red.length ? R : GD);
    const per = $('ads-period-note');
    if (per) per.textContent = `${fD(D.from)} – ${fD(D.to)}` + (D.accounts.includes('ukr3d') ? '' : ' · Ukr3d: немає даних');
    const ts = $('ads-updated-at');
    if (ts) ts.innerHTML = window.E3DFresh ? E3DFresh.html([{ ts: _ga.fetched_at, label: 'GA4 / Google Ads' }]) : 'Оновлено: ' + (_ga.fetched_at || '—');
    const st = $('ads-status');
    if (st) st.innerHTML = `Джерела: вартість, кліки, покази — Google Ads через Google Analytics 4 (EASY — ресурс easy3dprint.com.ua, Ukr3d — ukr3dprint.com), точно в грн по днях; конверсії сайту — ключові події GA4; ліди, WON і виручка — Bitrix24 за utm_campaign (угоди, створені в періоді — свіжі ще закриватимуться, тому ROAS за останні дні росте). Excel-скрипт Ads більше не використовується (не оновлювався з 10.10.2026).`;
    renderAlert(red); renderRecs(rows, D); renderDaily(D); renderTable(rows, D); renderBudget(rows);
  }

  function renderAlert(red) {
    const el = $('ads-alert-red'), tx = $('ads-alert-red-text'); if (!el || !tx) return;
    if (!red.length) { el.style.display = 'none'; return; }
    el.style.display = '';
    tx.innerHTML = red.map(r => `<b>${esc(r.name)}</b> (${ACC[r.acc].l}, ${fmt(r.cost)} ₴, 0 лідів у CRM)`).join('; ') + ' — витрати без жодного ліда в CRM: перевір Final URL suffix з utm_campaign або зупини.';
  }

  function renderRecs(rows, D) {
    const el = $('ads-recommendations'); if (!el) return;
    if (!D.crm) { el.innerHTML = ''; return; }
    const recs = [];
    rows.filter(r => r.cost >= 1000 && r.roas >= 300).sort((a, b) => b.roas - a.roas).slice(0, 2)
      .forEach(r => recs.push({ t: 'g', i: '🚀', x: `<b>${esc(r.name)}</b> (${ACC[r.acc].l}) — ROAS ${r.roas.toFixed(0)}% за ${_st.days} дн. Кандидат на збільшення бюджету.` }));
    // RED-кампанії — окремим червоним алертом вище (ads-alert-red), тут не дублюємо
    const ds = Object.entries(D.days).sort(([a], [b]) => a.localeCompare(b)).map(([, v]) => v);
    if (ds.length >= 14) {
      const sum = (a, f) => a.reduce((s, d) => s + d[f], 0), l7 = ds.slice(-7), p7 = ds.slice(-14, -7);
      const ctr1 = sum(l7, 'imp') ? sum(l7, 'clk') / sum(l7, 'imp') * 100 : 0, ctr0 = sum(p7, 'imp') ? sum(p7, 'clk') / sum(p7, 'imp') * 100 : 0;
      const cpl1 = sum(l7, 'n') ? sum(l7, 'cost') / sum(l7, 'n') : null, cpl0 = sum(p7, 'n') ? sum(p7, 'cost') / sum(p7, 'n') : null;
      if (cpl1 && cpl0 && Math.abs(cpl1 / cpl0 - 1) > 0.25) recs.push({ t: cpl1 < cpl0 ? 'g' : 'a', i: cpl1 < cpl0 ? '📉' : '📈', x: `CPL останні 7 днів: <b>${fmt(cpl1)} ₴</b> проти ${fmt(cpl0)} ₴ тижнем раніше (${cpl1 < cpl0 ? '' : '+'}${((cpl1 / cpl0 - 1) * 100).toFixed(0)}%).` });
      if (ctr0 && Math.abs(ctr1 - ctr0) > 1) recs.push({ t: ctr1 > ctr0 ? 'g' : 'a', i: ctr1 > ctr0 ? '📈' : '📉', x: `CTR останні 7 днів: <b>${ctr1.toFixed(2)}%</b> (${ctr1 > ctr0 ? '+' : ''}${(ctr1 - ctr0).toFixed(2)} п.п. до попереднього тижня).` });
    }
    el.innerHTML = recs.map(r => `<div class="al al-${r.t}" style="margin-bottom:6px"><span class="ic">${r.i}</span><div style="font-size:12px">${r.x}</div></div>`).join('');
  }

  function chart(id, cfg) {
    const c = $(id); if (!c) return;
    if (_charts[id]) { try { _charts[id].destroy(); } catch (e) {} }
    _charts[id] = new Chart(c, cfg);
  }

  function renderDaily(D) {
    const keys = Object.keys(D.days).sort();
    let buckets = keys.map(k => [k]);
    const weekly = keys.length > 45;
    if (weekly) { buckets = []; for (let i = 0; i < keys.length; i += 7) buckets.push(keys.slice(i, i + 7)); }
    const agg = (b, f) => b.reduce((s, k) => s + D.days[k][f], 0);
    const labels = buckets.map(b => { const d = b[0].split('-'); return (weekly ? 'з ' : '') + d[2] + '.' + d[1]; });
    const ttl = $('ads-daily-title'); if (ttl) ttl.textContent = weekly ? 'По тижнях — кліки, ліди CRM, конверсії GA4' : 'По днях — кліки, ліди CRM, конверсії GA4';
    const ttl2 = $('ads-ctr-title'); if (ttl2) ttl2.textContent = weekly ? 'CTR% і CPC по тижнях' : 'CTR% і CPC по днях';
    const lg = { position: 'top', labels: { usePointStyle: true, padding: 10, font: { size: 10 } } };
    chart('ads-funnel-chart', { type: 'bar', data: { labels, datasets: [
      { label: 'Кліки', data: buckets.map(b => agg(b, 'clk')), backgroundColor: 'rgba(69,123,157,.18)', borderColor: A, borderWidth: 1.5, borderRadius: 4, yAxisID: 'y1' },
      { label: 'Ліди CRM (угоди з google UTM)', type: 'line', data: buckets.map(b => agg(b, 'n')), borderColor: G, backgroundColor: G, tension: .3, pointRadius: 2, yAxisID: 'y' },
      { label: 'Конверсії GA4 (ключові події)', type: 'line', data: buckets.map(b => Math.round(agg(b, 'ke'))), borderColor: Y, backgroundColor: Y, borderDash: [4, 3], tension: .3, pointRadius: 2, yAxisID: 'y' },
    ] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: lg, datalabels: { display: false } },
      scales: { x: { grid: { display: false } }, y: { position: 'left', beginAtZero: true, grid: { color: GRID }, title: { display: true, text: 'ліди / конверсії', font: { size: 9 } } },
        y1: { position: 'right', beginAtZero: true, grid: { drawOnChartArea: false }, title: { display: true, text: 'кліки', font: { size: 9 } } } } } });
    chart('ads-ctr-chart', { type: 'line', data: { labels, datasets: [
      { label: 'CTR %', data: buckets.map(b => { const i = agg(b, 'imp'); return i ? +(agg(b, 'clk') / i * 100).toFixed(2) : null; }), borderColor: A, backgroundColor: A, tension: .3, pointRadius: 2, yAxisID: 'y' },
      { label: 'CPC, ₴', data: buckets.map(b => { const c = agg(b, 'clk'); return c ? +(agg(b, 'cost') / c).toFixed(1) : null; }), borderColor: G, backgroundColor: G, tension: .3, pointRadius: 2, yAxisID: 'y1' },
    ] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: lg, datalabels: { display: false } },
      scales: { x: { grid: { display: false } }, y: { beginAtZero: true, grid: { color: GRID }, ticks: { callback: v => v + '%' } },
        y1: { position: 'right', beginAtZero: true, grid: { drawOnChartArea: false }, ticks: { callback: v => v + ' ₴' } } } } });
  }

  function renderTable(rows, D) {
    const el = $('ads-campaigns-table'); if (!el) return;
    const ttl = $('ads-camp-title'); if (ttl) ttl.textContent = `📢 Кампанії Google Ads — ${_st.days} днів`;
    if (!rows.length) { el.innerHTML = '<p style="color:var(--tl);font-size:12px;padding:12px">Немає кампаній з витратами за період</p>'; return; }
    rows = rows.slice().sort((a, b) => b.cost - a.cost);
    const LIGHT = { GREEN: ['#d4edda', '#0A3D20'], RED: ['#f8d7da', '#721c24'], YELLOW: ['#fff3cd', '#856404'] };
    const rc = v => v == null ? 'var(--tl)' : v >= 300 ? GD : v >= 100 ? A : R;
    const th = (t, tip, al) => `<th class="${al || 'r'}"${tip ? ` title="${esc(tip)}"` : ''}>${t}</th>`;
    el.innerHTML = `<div class="tw" style="max-height:520px;overflow:auto"><table class="tbl"><thead><tr>
      ${th('Акаунт', '', 'l')}${th('Кампанія', '', 'l')}${th('Витрати')}${th('Покази')}${th('Кліки')}${th('CTR')}${th('CPC')}
      ${th('Конв. GA4', 'Ключові події GA4 сайту easy3dprint.com.ua (форми, дзвінки, месенджери) із сеансів цієї кампанії. Для Ukr3d — «—»: події сайту ukr3dprint.com поки не завантажуються')}
      ${th('Лідів CRM', 'Угоди Bitrix24 з цією utm_campaign, створені в періоді')}${th('CPL', 'Витрати ÷ ліди CRM')}${th('WON', 'Успішні угоди з цих лідів')}${th('WON сума')}
      ${th('ROAS', 'WON-виручка ÷ витрати × 100%. Угоди останніх днів ще закриватимуться — ROAS за свіжий період росте')}
      ${th('Статус ⓘ', STATUS_RULES, 'c')}</tr></thead><tbody>` +
      rows.map(r => { const lc = LIGHT[r.status] || LIGHT.YELLOW; return `<tr>
        <td style="white-space:nowrap"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${ACC[r.acc].c};margin-right:5px"></span>${ACC[r.acc].l}</td>
        <td style="max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(r.name)}">${esc(r.name)}</td>
        <td class="r" style="font-weight:700">${fmt(r.cost)}</td><td class="r">${fmt(r.imp)}</td><td class="r">${fmt(r.clk)}</td>
        <td class="r">${r.ctr != null ? r.ctr.toFixed(2) + '%' : '—'}</td><td class="r">${r.cpc != null ? r.cpc.toFixed(1) : '—'}</td>
        <td class="r">${r.ke != null ? Math.round(r.ke) : '—'}</td>
        <td class="r">${D.crm ? r.n : '…'}</td><td class="r">${r.cpl != null ? fmt(r.cpl) : '—'}</td><td class="r">${D.crm ? r.w : '…'}</td><td class="r">${D.crm ? fmtK(r.ws) : '…'}</td>
        <td class="r" style="font-weight:700;color:${rc(r.roas)}">${D.crm && r.roas != null ? r.roas.toFixed(0) + '%' : '—'}</td>
        <td class="c">${r.status === undefined ? '…' : r.status ? `<span style="background:${lc[0]};color:${lc[1]};padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700" title="${esc(STATUS_RULES)}">${r.status}</span>` : '<span style="color:var(--tl)" title="Без витрат — статус не оцінюється">—</span>'}</td></tr>`; }).join('') +
      `</tbody></table></div>`;
  }

  function renderBudget(rows) {
    const top = rows.filter(r => r.cost > 0).sort((a, b) => b.cost - a.cost).slice(0, 10);
    if (!$('ads-budget-chart')) return;
    chart('ads-budget-chart', { type: 'bar', data: { labels: top.map(r => (r.name.length > 24 ? r.name.slice(0, 22) + '…' : r.name) + ' · ' + ACC[r.acc].l),
      datasets: [{ label: 'Витрати, ₴', data: top.map(r => Math.round(r.cost)), backgroundColor: top.map(r => ACC[r.acc].c), borderRadius: 4 }] },
      options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, datalabels: { display: false },
        tooltip: { callbacks: { label: c => fmt(c.parsed.x) + ' ₴' } } },
        scales: { x: { grid: { color: GRID }, ticks: { callback: v => fmtK(v) } }, y: { grid: { display: false }, ticks: { font: { size: 9 } } } } } });
  }

  // сумісність зі старими викликами
  return { load, render, applyFilters: render, setPeriod: () => render() };
})();
