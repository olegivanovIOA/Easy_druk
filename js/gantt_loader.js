/**
 * gantt_loader.js — Easy 3D Print Dashboard v7.19
 * «План завантаження парку» (Виробництво) з планового Ганта машин: data/gantt.json + data/gantt_history.json
 * (fetch_gantt.py ← easy3dprint.pp.ua GET /api/gantt). Замінює ручний імпорт plan_week.json.
 *
 * Одиниці: машини в зміні; «машино-зміна» = 1 машина × 12 год. busy — ПЛАН, обрізаний парком, а не факт друку.
 * Недоступні сьогоднішні зміни (вже почались/минули) у завантаження й вільний ресурс не входять — як в API.
 */
window.GanttLoader = (() => {
  const $ = id => document.getElementById(id);
  const G = '#2A9D8F', A = '#457B9D', R = '#C0392B', Y = '#BA7517', GD = '#1F7A6E', GRID = '#f0f2ee';
  const LOC_C = { '1': G, '2': A, '3': '#8A6D3B', '4': R, '5': '#6aA5C2', '6': '#BA7517', '101': '#6B4E9B' };
  const PAL = ['#2A9D8F', '#C0392B', '#457B9D', '#BA7517', '#6B4E9B', '#6aA5C2', '#8A6D3B', '#3D8B37'];
  const H_LS = 'e3d_gantt_h', L_LS = 'e3d_gantt_loc';
  const fmt = v => v == null ? '—' : Math.round(v).toLocaleString('uk-UA');
  const pct = v => v == null ? '—' : v.toFixed(0) + '%';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
  const fD = d => d ? d.slice(8, 10) + '.' + d.slice(5, 7) : '—';
  const WD = ['нд', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
  const wd = d => WD[new Date(d + 'T12:00:00Z').getUTCDay()];
  let _g = null, _h = null, _H = lsGet(H_LS, 14), _L = lsGet(L_LS, '*'), _charts = {};

  function css() {
    if ($('gt-css')) return;
    const s = document.createElement('style'); s.id = 'gt-css';
    s.textContent = `
.gt-bar{display:flex;flex-wrap:wrap;gap:6px;align-items:center;padding:8px 10px 0}
.gt-bar .lbl{font-size:10px;color:var(--tl);margin-right:2px}
.gt-btn{font-size:11px;padding:2px 9px;border:1px solid var(--bd);border-radius:999px;background:transparent;color:var(--td);cursor:pointer;line-height:1.6}
.gt-btn.on{background:var(--tx);color:#fff;border-color:var(--tx)}
.gt-btn .sw{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:5px;vertical-align:0}
.gt-k{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;padding:10px}
@media(max-width:1100px){.gt-k{grid-template-columns:repeat(2,1fr)}}
@media(max-width:480px){.gt-k{grid-template-columns:1fr}}
.gt-k .t{border:1px solid var(--bd);border-radius:8px;padding:8px 10px;position:relative;overflow:hidden;background:#fff}
.gt-k .t:before{content:'';position:absolute;left:0;top:0;bottom:0;width:3px;background:var(--c,#2A9D8F)}
.gt-k .l{font-size:10px;font-weight:600;color:var(--tm)}
.gt-k .v{font-size:18px;font-weight:800;margin-top:2px;white-space:nowrap}
.gt-k .s{font-size:10px;color:var(--tl);margin-top:1px;line-height:1.35}
.gt-g2{display:grid;grid-template-columns:1fr 1fr;gap:10px;padding:0 10px 10px}
@media(max-width:900px){.gt-g2{grid-template-columns:1fr}}
.gt-c{border:1px solid var(--bd);border-radius:8px;padding:8px 8px 4px;background:#fff;min-width:0}
.gt-c .h{font-size:11px;font-weight:700;color:var(--td);margin:0 0 2px 2px}
.gt-c .n{font-size:10px;color:var(--tl);margin:0 0 4px 2px}
.gt-note{font-size:10.5px;color:var(--tl);padding:0 12px 10px;line-height:1.5}
.gt-warn{margin:8px 10px 0;padding:6px 10px;border-radius:8px;background:#fff3cd;color:#856404;font-size:11px;line-height:1.45}
.gt-err{margin:8px 10px 0;padding:6px 10px;border-radius:8px;background:#f8d7da;color:#721c24;font-size:11px;line-height:1.45}
.gt-hm-w{overflow-x:auto;padding:0 10px 10px}
.gt-hm{border-collapse:separate;border-spacing:2px;font-size:10px;min-width:100%}
.gt-hm th{font-weight:600;color:var(--tl);padding:2px 3px;white-space:nowrap;text-align:center}
.gt-hm th.rl,.gt-hm td.rl{text-align:left;white-space:nowrap;padding-right:8px;color:var(--td);font-weight:600;position:sticky;left:0;background:#fff}
.gt-hm td.rl.m{font-weight:500;color:var(--tl);padding-left:12px}
.gt-hm td.c{min-width:30px;text-align:center;border-radius:4px;padding:3px 2px;font-weight:700;cursor:default}
.gt-hm th.we{color:${R}}
.gt-t-w{overflow-x:auto;padding:0 10px 10px}
.gt-t{width:100%;border-collapse:collapse;font-size:11px}
.gt-t th{font-size:10px;font-weight:600;color:var(--tl);text-align:right;padding:5px 6px;border-bottom:1px solid var(--bd);white-space:nowrap}
.gt-t th:first-child,.gt-t td:first-child{text-align:left}
.gt-t td{padding:5px 6px;border-bottom:1px solid #f1f3ef;text-align:right;white-space:nowrap}
.gt-t tr.m td{color:var(--tm);font-size:10.5px}
.gt-t tr.m td:first-child{padding-left:16px}
.gt-t tr.tot td{font-weight:700;border-top:1.5px solid var(--bd)}
.gt-pill{display:inline-block;padding:0 6px;border-radius:999px;font-size:10px;font-weight:700}`;
    document.head.appendChild(s);
  }

  // ── розрахунки ────────────────────────────────────────────────────────────────────────────────────
  // r = [вільно Д, зайнято Д, Д доступна, вільно Н, зайнято Н, Н доступна]
  const SH = [[0, 1, 2, 'D'], [3, 4, 5, 'N']];
  function agg(rows, n, which) {           // which: 'D' | 'N' | undefined (обидві)
    let b = 0, f = 0, sh = 0;
    rows.slice(0, n).forEach(r => { if (!r) return; SH.forEach(([fi, bi, ai, s]) => {
      if (which && which !== s) return; if (!r[ai] || r[fi] == null || r[bi] == null) return;
      b += r[bi]; f += r[fi]; sh++; }); });
    return { busy: b, free: f, cap: b + f, load: b + f ? b / (b + f) * 100 : null, shifts: sh };
  }
  const dayLoad = r => { if (!r) return null; let b = 0, c = 0; SH.forEach(([fi, bi, ai]) => { if (r[ai] && r[fi] != null && r[bi] != null) { b += r[bi]; c += r[fi] + r[bi]; } }); return c ? b / c * 100 : null; };
  function freeWindow(rows, eff, dates, pctThr) {   // перша доступна зміна, де вільно ≥ pctThr% робочого парку
    const thr = Math.max(1, (eff || 0) * pctThr / 100);
    for (let i = 0; i < rows.length; i++) { const r = rows[i]; if (!r) continue;
      for (const [fi, , ai, s] of SH) if (r[ai] && (r[fi] || 0) >= thr) return { d: dates[i], s, i }; }
    return null;
  }
  function depth(rows, thr) {             // скільки днів поспіль від сьогодні план тримає завантаження ≥ thr%
    let n = 0; for (const r of rows) { const l = dayLoad(r); if (l == null) { if (n === 0) continue; break; } if (l >= thr) n++; else break; }
    return n;
  }
  const sumO = (o, n) => (o || []).slice(0, n).reduce((t, x) => { if (x) { t.parts += x[1] || 0; t.proc += x[2] || 0; t.pos += x[3] || 0; } return t; }, { parts: 0, proc: 0, pos: 0 });
  const loadCol = v => v == null ? 'var(--tl)' : v >= 95 ? R : v >= 80 ? Y : v >= 50 ? GD : A;
  const cellBg = v => { if (v == null) return '#f4f5f2';
    if (v >= 95) return `rgba(192,57,43,${.18 + (v - 95) / 5 * .5})`; if (v >= 80) return `rgba(186,117,23,${.18 + (v - 80) / 15 * .4})`;
    if (v >= 50) return `rgba(42,157,143,${.15 + (v - 50) / 30 * .4})`; return `rgba(69,123,157,${.08 + v / 50 * .2})`; };

  // ── дані ─────────────────────────────────────────────────────────────────────────────────────────
  async function load() {
    css();
    const box = $('gantt-root'); if (!box) return;
    try {
      const [g, h] = await Promise.all([
        fetch('data/gantt.json?t=' + Date.now()).then(r => r.ok ? r.json() : null).catch(() => null),
        fetch('data/gantt_history.json?t=' + Date.now()).then(r => r.ok ? r.json() : null).catch(() => null),
      ]);
      _g = g; _h = h;
      render();
    } catch (e) { console.warn('[Gantt]', e); box.innerHTML = `<div class="gt-err">Помилка відображення плану: ${esc(e.message)}</div>`; }
  }

  // моделі принтерів локації (кожна модель — окремий пул планування)
  const modelsOf = l => (_g.pools || []).filter(p => l.num != null ? String(p.num) === String(l.num) : p.name === l.name).reduce((a, p) => a.concat(p.models || []), []);

  function scope() {   // вибраний зріз: усі локації або одна
    const L = _L !== '*' && (_g.locations || []).find(l => l.key === _L);
    return L ? { name: L.name, d: L.d, o: L.o, m: L.machines, orders: L.orders } : { name: 'Усі локації', d: _g.total.d, o: _g.total.o, m: _g.total.machines, orders: _g.total.orders };
  }

  function render() {
    const box = $('gantt-root'), dot = $('planweek-live-dot'), st = $('planweek-status');
    const g = _g;
    if (!g || !g.dates || !g.dates.length) {
      const msg = g && g.status && !g.status.ok ? g.status.msg : 'дані з’являться після першого запуску job «update-gantt» (Actions → Update Dashboard Data)';
      box.innerHTML = `<div class="gt-err">План завантаження ще не отримано: ${esc(msg)}.</div>`;
      if (dot) dot.className = 'ld warn'; if (st) st.textContent = '';
      return;
    }
    const dates = g.dates, nAll = dates.length;
    const H = Math.min(_H === 'all' ? nAll : +_H, nAll);
    if (_L !== '*' && !(g.locations || []).some(l => l.key === _L)) _L = '*';
    const S = scope(), eff = (S.m || {}).effective;
    const A0 = agg(S.d, H), Ad = agg(S.d, H, 'D'), An = agg(S.d, H, 'N'), A7 = agg(S.d, 7), A30 = agg(S.d, 30);
    const fw = freeWindow(S.d, eff, dates, g.freePct || 5), dp = depth(S.d, 80);
    const O = sumO(S.o, H), ordH = S.orders && (S.orders[String(H)] != null ? S.orders[String(H)] : null);
    const m = S.m || {};

    // статус і свіжість
    const ok = !g.status || g.status.ok;
    if (dot) dot.className = 'ld ' + (ok ? 'ok' : 'warn');
    if (st) st.innerHTML = window.E3DFresh ? E3DFresh.html([{ ts: g.fetched_at, label: 'Гант' }]) : ('Оновлено: ' + (g.fetched_at || '—'));

    const bar = `<div class="gt-bar"><span class="lbl">Горизонт:</span>` +
      [7, 14, 30, 'all'].map(h => `<button class="gt-btn${String(_H) === String(h) ? ' on' : ''}" data-h="${h}">${h === 'all' ? 'весь (' + nAll + ' дн)' : h + ' дн'}</button>`).join('') +
      `<span class="lbl" style="margin-left:10px">Локація:</span><button class="gt-btn${_L === '*' ? ' on' : ''}" data-l="*">Усі</button>` +
      (g.locations || []).map((l, i) => `<button class="gt-btn${_L === l.key ? ' on' : ''}" data-l="${esc(l.key)}" title="${esc((l.models || []).join(', '))}"><span class="sw" style="background:${LOC_C[l.key] || PAL[i % PAL.length]}"></span>${esc(l.name)}</button>`).join('') + `</div>`;

    const warn = (!ok ? `<div class="gt-err">⚠ Останнє оновлення не вдалося (${esc(g.status.msg)}) — показано план станом на ${esc(fD((g.fetched_at || '').slice(0, 10)))}.</div>` : '') +
      ((g.warnings || []).length ? `<div class="gt-warn">⚠ Попередження API (дані неповні): ${g.warnings.map(esc).join(' · ')}</div>` : '');

    const tile = (c, l, v, s, title) => `<div class="t" style="--c:${c}"${title ? ` title="${esc(title)}"` : ''}><div class="l">${l}</div><div class="v" style="color:${c}">${v}</div><div class="s">${s}</div></div>`;
    const tiles = `<div class="gt-k">` +
      tile(loadCol(A0.load), `Планове завантаження · ${H} дн`, pct(A0.load), `7 дн ${pct(A7.load)} · 30 дн ${pct(A30.load)}`,
        'Зайняті планом машино-зміни ÷ робочий парк (без ремонту/ТО/резерву) за доступні зміни горизонту') +
      tile(A0.free ? GD : R, `Вільний ресурс · ${H} дн`, fmt(A0.free) + ' <span style="font-size:11px;font-weight:600">маш-змін</span>',
        `≈ ${fmt(A0.free * 12)} машино-год · у середньому ${fmt(A0.shifts ? A0.free / A0.shifts : 0)} машин/зміну`,
        'Сума вільних машин по доступних змінах (1 машино-зміна = 1 машина × 12 год). Це місткість під нові замовлення без витіснення плану') +
      tile(fw ? (fw.i <= 1 ? GD : fw.i <= 7 ? Y : R) : R, `Вільне вікно ≥${g.freePct || 5}% парку`, fw ? `${fD(fw.d)} <span style="font-size:11px;font-weight:600">${fw.s === 'D' ? 'день' : 'ніч'}</span>` : 'немає',
        fw ? (fw.i === 0 ? 'вже сьогодні' : `через ${fw.i} дн · ${wd(fw.d)}`) : `за ${nAll} дн горизонту парк зайнятий`,
        `Перша зміна, де вільно хоча б ${g.freePct || 5}% робочого парку (≥${fmt(Math.max(1, (eff || 0) * (g.freePct || 5) / 100))} машин) — найраніший старт великого замовлення`) +
      tile(dp >= 14 ? GD : dp >= 5 ? Y : R, 'Глибина плану ≥80%', dp + ' <span style="font-size:11px;font-weight:600">дн</span>',
        dp >= nAll ? 'на весь горизонт — запит обрізаний' : `з ${fD(dates[Math.min(dp, nAll - 1)])} завантаження нижче 80%`,
        'Скільки днів поспіль від сьогодні план тримає парк завантаженим ≥80% — «запас замовлень» у днях') +
      tile(A, 'Робочий парк', fmt(m.effective) + ` <span style="font-size:11px;font-weight:600">з ${fmt(m.total)}</span>`,
        `${m.total ? pct(m.effective / m.total * 100) : '—'} доступно · потужність ≈ ${fmt((m.effective || 0) * 24)} маш-год/добу · ремонт ${fmt(m.repair != null ? m.repair : m.maintenance)}${m.plannedMaintenance != null ? ' · ТО ' + fmt(m.plannedMaintenance) : ''}${m.reserved ? ' · резерв ' + fmt(m.reserved) : ''}`,
        `Парк за налаштуваннями планування мінус ремонт/ТО і резерв. Джерело ремонту: ${m.src || '—'}${m.src === 'SETTINGS' ? ' (число з налаштувань, не живі дані)' : m.src === 'MIXED' ? ' (частково з налаштувань)' : ''}`) +
      tile(An.load != null && Ad.load != null && An.load < Ad.load - 10 ? Y : G, 'День / ніч', `${pct(Ad.load)} <span style="font-size:11px;font-weight:600">/ ${pct(An.load)}</span>`,
        `вільно вдень ${fmt(Ad.free)} · вночі ${fmt(An.free)} маш-змін`, 'Планове завантаження денних (08:00) і нічних (20:00) змін за горизонт') +
      tile(A, `Замовлень у плані · ${H} дн`, ordH != null ? fmt(ordH) : '—', `${fmt(O.parts)} деталей${O.parts ? ' · з обробкою ' + pct(O.proc / O.parts * 100) : ''}`,
        'Унікальні замовлення і заплановані деталі в позиціях плану за горизонт (без номерів — лише кількість)') +
      tile(A, 'Тестувальник файлів', fmt(m.testerMachines) + ' <span style="font-size:11px;font-weight:600">машин</span>',
        `${eff && m.testerMachines != null ? pct(m.testerMachines / eff * 100) : '—'} робочого парку · денні зміни пн–сб`, 'Машини тестувальника файлів серед доступних — займають денні зміни пн–сб') +
      `</div>`;

    const charts = `<div class="gt-g2">
      <div class="gt-c"><div class="h">Зайнято / вільно по днях — ${esc(S.name)}</div><div class="n">машино-зміни на добу (день + ніч) · лінія — завантаження %</div><div style="height:230px"><canvas id="gt-ch-bf"></canvas></div></div>
      <div class="gt-c"><div class="h">Планове завантаження по локаціях, %</div><div class="n">по днях горизонту · клік у легенді — сховати</div><div style="height:230px"><canvas id="gt-ch-loc"></canvas></div></div>
    </div>`;

    // теплова карта: локації → моделі, перші min(H,21) днів
    const HM = Math.min(H, 21);
    const hmRows = [];
    (g.locations || []).filter(l => _L === '*' || l.key === _L).forEach(l => {
      hmRows.push({ lbl: l.name, rows: l.d, m: l.machines, main: true });
      const mods = modelsOf(l); if (mods.length > 1) mods.forEach(md => hmRows.push({ lbl: md.model || '—', rows: md.d, m: md.machines, main: false }));
    });
    const hm = `<div class="gt-c" style="margin:0 10px 10px"><div class="h">Теплова карта завантаження — ${HM} дн</div><div class="n">% зайнятих машин за добу (доступні зміни) · наведи на клітинку — день/ніч · <span style="color:${R}">≥95%</span> · <span style="color:${Y}">80–95%</span> · <span style="color:${GD}">50–80%</span> · <span style="color:${A}">&lt;50%</span></div>
      <div class="gt-hm-w" style="padding:0"><table class="gt-hm"><thead><tr><th class="rl"></th>${dates.slice(0, HM).map(d => { const w = wd(d); return `<th class="${w === 'нд' || w === 'сб' ? 'we' : ''}">${d.slice(8, 10)}<br>${w}</th>`; }).join('')}</tr></thead><tbody>` +
      hmRows.map(r => `<tr><td class="rl${r.main ? '' : ' m'}">${esc(r.lbl)}</td>${r.rows.slice(0, HM).map((x, i) => { const v = dayLoad(x);
        const tt = x ? `${fD(dates[i])} · день: ${x[2] ? 'зайнято ' + fmt(x[1]) + ', вільно ' + fmt(x[0]) : 'вже минула'} · ніч: ${x[5] ? 'зайнято ' + fmt(x[4]) + ', вільно ' + fmt(x[3]) : 'вже минула'}` : '';
        return `<td class="c" style="background:${cellBg(v)};color:${v != null && v >= 80 ? '#3b2a12' : 'var(--td)'}" title="${esc(tt)}">${v == null ? '·' : Math.round(v)}</td>`; }).join('')}</tr>`).join('') +
      `</tbody></table></div></div>`;

    // таблиця локацій / моделей
    const rowT = (lbl, d, o, mm, orders, cls) => {
      const a7 = agg(d, 7), a30 = agg(d, 30), aH = agg(d, H), f = freeWindow(d, (mm || {}).effective, dates, g.freePct || 5), dpth = depth(d, 80), oo = sumO(o, H);
      return `<tr class="${cls || ''}"><td>${lbl}</td><td>${fmt((mm || {}).total)}</td><td>${fmt((mm || {}).maintenance)}</td><td>${fmt((mm || {}).effective)}</td>
        <td style="color:${loadCol(a7.load)};font-weight:700">${pct(a7.load)}</td><td style="color:${loadCol(a30.load)}">${pct(a30.load)}</td>
        <td>${fmt(aH.free)}</td><td>${f ? fD(f.d) + ' ' + (f.s === 'D' ? 'д' : 'н') : '<span style="color:' + R + '">немає</span>'}</td><td>${dpth} дн</td>
        <td>${orders != null ? fmt(orders) : '—'}</td><td>${fmt(oo.parts)}</td></tr>`;
    };
    let tbody = '';
    (g.locations || []).forEach(l => {
      tbody += rowT(`<b>${esc(l.name)}</b>`, l.d, l.o, l.machines, l.orders ? l.orders[String(H)] : null);
      const mods = modelsOf(l);
      if (mods.length > 1) mods.forEach(md => { tbody += rowT(esc(md.model || '—'), md.d, md.o, md.machines, null, 'm'); });
    });
    tbody += rowT('Разом', g.total.d, g.total.o, g.total.machines, g.total.orders ? g.total.orders[String(H)] : null, 'tot');
    const table = `<div class="gt-c" style="margin:0 10px 10px"><div class="h">Локації та моделі принтерів</div><div class="n">завантаження 7 / 30 дн · вільний ресурс і замовлення — за вибраний горизонт ${H} дн</div><div class="gt-t-w" style="padding:0">
      <table class="gt-t"><thead><tr><th>Локація / модель</th><th title="Парк за налаштуваннями планування">Парк</th><th title="Ремонт + плановий ТО зараз">Ремонт/ТО</th><th title="Парк − ремонт/ТО − резерв">Робочий</th>
      <th>Завант. 7 дн</th><th>30 дн</th><th title="Вільні машино-зміни за горизонт">Вільно, маш-змін</th><th title="Перша зміна з вільними ≥${g.freePct || 5}% робочого парку">Вільне вікно</th><th title="Днів поспіль із завантаженням ≥80%">Глибина ≥80%</th><th>Замовлень</th><th>Деталей</th></tr></thead><tbody>${tbody}</tbody></table></div></div>`;

    // динаміка з історії знімків
    const hd = (_h && _h.days) || [];
    const hist = hd.length >= 2 ? `<div class="gt-c" style="margin:0 10px 10px"><div class="h">Як змінюється план — щоденні знімки</div><div class="n">завантаження наступних 7 днів (%) і «запас» до вільного вікна ≥${g.freePct || 5}% (дн) на дату знімка</div><div style="height:200px"><canvas id="gt-ch-hist"></canvas></div></div>`
      : `<div class="gt-note">📈 Динаміка плану (як змінюються завантаження і глибина від дня до дня) з’явиться, коли накопичиться ≥2 щоденні знімки (${hd.length} зараз).</div>`;

    const note = `<div class="gt-note">Джерело — плановий Гант машин (API планування, оновлення щогодини). Числа описують <b>план</b>, а не факт друку: busy — плановані машино-зміни, обрізані парком; сьогоднішні зміни, що вже почались, у розрахунок не входять. Зміни: день 08:00–20:00, ніч 20:00–08:00. ` +
      `План · ${fD(g.from)} – ${fD(g.to)} · знімок ${g.generatedAt ? new Date(g.generatedAt).toLocaleString('uk-UA', { timeZone: 'Europe/Kyiv', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'}.</div>`;

    box.innerHTML = warn + bar + tiles + charts + hm + table + hist + note;
    box.querySelectorAll('[data-h]').forEach(b => b.onclick = () => { _H = b.dataset.h === 'all' ? 'all' : +b.dataset.h; lsSet(H_LS, _H); render(); });
    box.querySelectorAll('[data-l]').forEach(b => b.onclick = () => { _L = b.dataset.l; lsSet(L_LS, _L); render(); });
    drawCharts(S, H);
  }

  function chart(id, cfg) {
    const c = $(id); if (!c) return;
    if (_charts[id]) { try { _charts[id].destroy(); } catch (e) {} }
    _charts[id] = new Chart(c, cfg);
  }

  function drawCharts(S, H) {
    const g = _g, dates = g.dates.slice(0, H), labels = dates.map(d => d.slice(8, 10) + '.' + d.slice(5, 7));
    const lg = { position: 'top', labels: { usePointStyle: true, padding: 8, font: { size: 10 } } };
    const busy = S.d.slice(0, H).map(r => r ? (r[2] ? r[1] || 0 : 0) + (r[5] ? r[4] || 0 : 0) : null);
    const free = S.d.slice(0, H).map(r => r ? (r[2] ? r[0] || 0 : 0) + (r[5] ? r[3] || 0 : 0) : null);
    chart('gt-ch-bf', { type: 'bar', data: { labels, datasets: [
      { label: 'Зайнято планом', data: busy, backgroundColor: 'rgba(192,57,43,.55)', borderRadius: 2, stack: 's', yAxisID: 'y' },
      { label: 'Вільно', data: free, backgroundColor: 'rgba(42,157,143,.55)', borderRadius: 2, stack: 's', yAxisID: 'y' },
      { label: 'Завантаження, %', type: 'line', data: S.d.slice(0, H).map(r => { const v = dayLoad(r); return v == null ? null : +v.toFixed(1); }), borderColor: '#1A2B3C', backgroundColor: '#1A2B3C', borderWidth: 1.5, pointRadius: H > 31 ? 0 : 2, tension: .25, yAxisID: 'y1' },
    ] }, options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
      plugins: { legend: lg, datalabels: { display: false }, tooltip: { callbacks: { label: c => c.dataset.yAxisID === 'y1' ? ` ${c.dataset.label}: ${c.raw}%` : ` ${c.dataset.label}: ${fmt(c.raw)} маш-змін` } } },
      scales: { x: { stacked: true, grid: { display: false }, ticks: { autoSkip: true, maxTicksLimit: 16, font: { size: 9 } } },
        y: { stacked: true, beginAtZero: true, grid: { color: GRID }, ticks: { callback: v => fmt(v) } },
        y1: { position: 'right', min: 0, max: 100, grid: { drawOnChartArea: false }, ticks: { callback: v => v + '%' } } } } });

    const ds = (g.locations || []).map((l, i) => { const c = LOC_C[l.key] || PAL[i % PAL.length];
      return { label: l.name, data: l.d.slice(0, H).map(r => { const v = dayLoad(r); return v == null ? null : +v.toFixed(1); }), borderColor: c, backgroundColor: c,
        borderWidth: _L === l.key ? 3 : 2, pointRadius: H > 31 ? 0 : 2, tension: .25, spanGaps: true, hidden: _L !== '*' && _L !== l.key }; });
    chart('gt-ch-loc', { type: 'line', data: { labels, datasets: ds }, options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
      plugins: { legend: lg, datalabels: { display: false }, tooltip: { callbacks: { label: c => ` ${c.dataset.label}: ${c.raw == null ? '—' : c.raw + '%'}` } } },
      scales: { x: { grid: { display: false }, ticks: { autoSkip: true, maxTicksLimit: 16, font: { size: 9 } } }, y: { min: 0, max: 100, grid: { color: GRID }, ticks: { callback: v => v + '%' } } } } });

    const hd = (_h && _h.days) || [];
    if (hd.length >= 2) {
      const pick = s => _L === '*' ? s.tot : (s.locs || {})[_L];
      chart('gt-ch-hist', { type: 'line', data: { labels: hd.map(s => s.date.slice(8, 10) + '.' + s.date.slice(5, 7)), datasets: [
        { label: 'Завантаження наступних 7 дн, %', data: hd.map(s => { const x = pick(s); return x ? x.load7 : null; }), borderColor: R, backgroundColor: R, tension: .25, pointRadius: 2, yAxisID: 'y', spanGaps: true },
        { label: 'Днів до вільного вікна', data: hd.map(s => { const x = pick(s); return x ? x.window : null; }), borderColor: A, backgroundColor: A, borderDash: [4, 3], tension: .25, pointRadius: 2, yAxisID: 'y1', spanGaps: true },
      ] }, options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, plugins: { legend: lg, datalabels: { display: false } },
        scales: { x: { grid: { display: false } }, y: { min: 0, max: 100, grid: { color: GRID }, ticks: { callback: v => v + '%' } }, y1: { position: 'right', beginAtZero: true, grid: { drawOnChartArea: false }, ticks: { callback: v => v + ' дн' } } } } });
    }
  }

  return { load };
})();
