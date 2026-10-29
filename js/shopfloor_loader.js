/**
 * shopfloor_loader.js — Easy 3D Print Dashboard v6.0
 * Дані виробничого цеху з easy3dprint.pp.ua (/api/defects, /api/shift-workers) → data/shopfloor.json
 *
 * Блоки (додаються В КІНЕЦЬ вкладок, існуючі блоки не змінюються):
 *   Якість       — 🧩 Причини браку (Парето, локації, зміни, артикули, тренд, затримка виявлення)
 *                  🔍 ОТК — продуктивність перевірки
 *   Виробництво  — 👷 Зміни операторів і виконання плану (+ виробіток на операторо-зміну)
 *   Локації      — 🔧 Техобслуговування і ремонти (+ ремонтів на 100 принтерів, ≈MTBF)
 *   HR           — 🕒 Фактична робота за табелем
 * Лише агрегати, без ID співробітників (див. fetch_shopfloor.py).
 */
window.Shopfloor = (() => {
  const G = '#2A9D8F', GD = '#1e7a6e', WH = '#3D7EA6', RT = '#C98A2B', R = '#C0392B', GRID = '#f0f2ee';
  const PAL = ['#2A9D8F', '#3D7EA6', '#C98A2B', '#8E6CB5', '#C0392B', '#5F8D4E', '#D4A373', '#6C8EAD', '#B5838D', '#9AA5A0'];
  const $ = id => document.getElementById(id);
  const fmt = n => n == null || !isFinite(n) ? '—' : Math.abs(n) >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : Math.round(n).toLocaleString('uk-UA');
  const f1 = n => n == null || !isFinite(n) ? '—' : n.toLocaleString('uk-UA', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
  const p1 = v => v == null || !isFinite(v) ? '—' : v.toFixed(1) + '%';
  const pct = (a, b) => b ? a / b * 100 : null;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const LS_PRICE = 'e3d_sf_price_v1';
  const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
  const CAT = { OPERATOR: 'Оператори', TECH: 'ІТО (техніки)', QC: 'ОТК' };

  let D = null, CAP = null, BH = null, BMH = null, HR = null, CH = null, _loading = null;
  const charts = {}, done = {};
  function chart(id, cfg) {
    const c = $(id); if (!c || typeof Chart === 'undefined') return;
    if (charts[id]) { try { charts[id].destroy(); } catch (e) {} }
    cfg.options = cfg.options || {};
    cfg.options.plugins = Object.assign({ datalabels: { display: false } }, cfg.options.plugins || {});
    charts[id] = new Chart(c, cfg);
  }

  function load() {
    if (_loading) return _loading;
    const j = u => fetch(u + '?t=' + Date.now()).then(r => r.ok ? r.json() : null).catch(() => null);
    _loading = Promise.all([j('data/shopfloor.json'), j('data/capacity.json'), j('data/batches_history.json'), j('data/batches_monthly_history.json'), j('data/hr.json'), j('data/capacity_history.json')])
      .then(([a, b, c, d, e, f]) => { D = a; CAP = b; BH = c; BMH = d; HR = e; CH = f; });
    return _loading;
  }

  // ── спільне: періоди, локації, контейнери ──
  const months = () => D ? Object.keys(D.months).sort() : [];
  function periodOptions(withMulti) {
    const ms = months().slice().reverse();
    const lbl = m => m + (D.months[m].complete === false ? ' (триває)' : '');
    return (withMulti ? `<option value="ytd">З початку року</option><option value="l3">Останні 3 міс.</option>` : '') + ms.map(m => `<option value="${m}">${lbl(m)}</option>`).join('');
  }
  function periodMonths(v) {
    const ms = months();
    if (v === 'ytd') return ms.filter(m => m.slice(0, 4) === ms[ms.length - 1].slice(0, 4));
    if (v === 'l3') return ms.slice(-3);
    return ms.includes(v) ? [v] : ms.slice(-1);
  }
  function locList() {
    const s = new Set();
    months().forEach(m => {
      (D.months[m].defects.rows || []).forEach(r => s.add(r[2]));
      (D.months[m].staff || []).forEach(r => { if (r.loc !== 'ALL') s.add(r.loc); });
    });
    return [...s].filter(x => x !== '?').sort((a, b) => (+a || 9e9) - (+b || 9e9) || a.localeCompare(b));
  }
  const locName = l => /^\d+$/.test(l) ? 'Локація ' + l : l;
  const sel = (id, opts, val) => `<select id="${id}" style="font-size:11px;padding:3px 6px;border:1px solid var(--bd);border-radius:6px">${opts}</select>`;
  function header(icon, title, tip, controls) {
    return `<div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-top:22px">
      <div class="sec" style="margin:0">${icon} ${title} <span style="font-size:10px;font-weight:500;text-transform:none;letter-spacing:normal;color:var(--tl);cursor:help" title="${esc(tip)}">ⓘ</span></div>
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:11px">${controls}<span class="sf-upd"></span></div></div>`;
  }
  function mount(panelId, wid, html) {
    if ($(wid)) return $(wid);
    const p = $(panelId); if (!p) return null;
    p.insertAdjacentHTML('beforeend', `<div id="${wid}" class="sf-block">${html}</div>`);
    return $(wid);
  }
  function stamp(root) {
    root.querySelectorAll('.sf-upd').forEach(e => { e.innerHTML = window.E3DFresh && D ? E3DFresh.html(D.fetched_at, 'easy3dprint API') : ''; });
  }
  const tile = (lbl, val, sub, tip, color) => `<div class="krow" style="flex-direction:column;align-items:flex-start;gap:3px;padding:10px 12px" title="${esc(tip || '')}">
    <div class="krow-lbl" style="white-space:normal;padding-left:0">${lbl}</div><div style="font-size:18px;font-weight:800;color:${color || 'var(--tx)'}">${val}</div><div style="font-size:10px;color:var(--tl)">${sub || ''}</div></div>`;
  const tiles = arr => `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin-bottom:12px">${arr.join('')}</div>`;
  const tbl = (head, body, foot) => `<div class="tw"><table class="tbl"><thead><tr>${head}</tr></thead><tbody>${body || '<tr><td colspan="20" style="color:var(--tl);font-weight:400">Немає даних</td></tr>'}</tbody>${foot ? `<tfoot>${foot}</tfoot>` : ''}</table></div>`;
  const th = (t, r, tip) => `<th${r ? ' style="text-align:right"' : ''}${tip ? ` title="${esc(tip)}"` : ''}>${t}</th>`;
  const td = (v, b, c) => `<td style="text-align:right${b ? ';font-weight:700' : ''}${c ? ';color:' + c : ''}">${v}</td>`;
  const noData = (root, msg) => { root.innerHTML = `<div class="al al-b" style="font-size:11px"><div>ℹ ${msg}</div></div>`; };
  const HIDDEN = '<span style="color:var(--tl)" title="У групі менше 2 людей — персональні показники приховано">прих.</span>';

  // ═══════════════ 1. ЯКІСТЬ: причини браку ═══════════════
  function renderDefects() {
    const root = mount('panel-qual', 'w-sf-defects', header('🧩', 'Причини браку — журнал ОТК і обробки',
      'Класифікований брак з /api/defects: стадії ОТК (QC) і обробка (PROCESS). Причин браку стадії ДРУКУ тут немає. Брак прив\'язано до дати і зміни ВИГОТОВЛЕННЯ. «Покриття» — частка браку, для якої вказано причину (не % браку). ≈₴ = кг × ціна матеріалу (редагується).',
      `${sel('sf-d-per', '')} ${sel('sf-d-loc', '')}
       <span class="roi-seg" id="sf-d-meas" style="display:inline-flex;border:1px solid var(--bd);border-radius:7px;overflow:hidden"></span>
       <label title="Ціна матеріалу для оцінки вартості браку, ₴/кг (PETG black за замовчуванням — як у блоці собівартості)">₴/кг <input id="sf-d-price" type="number" min="1" step="1" style="width:56px;font-size:11px;padding:2px 4px;border:1px solid var(--bd);border-radius:6px"></label>`)
      + `<div id="sf-d-body" style="margin-top:8px"></div>`);
    if (!root) return;
    stamp(root);
    const body = $('sf-d-body');
    if (!D || !months().length) return noData(body, 'Дані з’являться після першого запуску <b>update-shopfloor</b> (перший запуск підтягне історію з січня).');
    const per = $('sf-d-per'), loc = $('sf-d-loc'), meas = $('sf-d-meas'), price = $('sf-d-price');
    if (!per.options.length) {
      per.innerHTML = periodOptions(true); per.value = 'ytd';
      loc.innerHTML = `<option value="">Усі локації</option>` + locList().map(l => `<option value="${l}">${locName(l)}</option>`).join('');
      meas.innerHTML = [['q', 'шт'], ['kg', 'кг'], ['uah', '≈₴']].map(([k, t]) => `<button type="button" data-m="${k}" style="font-size:11px;padding:3px 9px;border:0;border-right:1px solid var(--bd);background:transparent;cursor:pointer">${t}</button>`).join('');
      meas.dataset.m = 'q';
      price.value = lsGet(LS_PRICE, 330);
      per.onchange = loc.onchange = () => drawDefects();
      price.onchange = () => { lsSet(LS_PRICE, +price.value || 330); drawDefects(); };
      meas.querySelectorAll('button').forEach(b => b.onclick = () => { meas.dataset.m = b.dataset.m; drawDefects(); });
    }
    drawDefects();
  }

  function defectRows(ms, loc) {
    const out = [];
    ms.forEach(m => (D.months[m].defects.rows || []).forEach(r => { if (!loc || r[2] === loc) out.push(r); }));
    return out;  // [date, shift, loc, stage, code, qty, kg|null, kgQty]
  }

  function drawDefects() {
    const per = $('sf-d-per').value, loc = $('sf-d-loc').value, M = $('sf-d-meas').dataset.m, price = +$('sf-d-price').value || 330;
    $('sf-d-meas').querySelectorAll('button').forEach(b => { b.style.background = b.dataset.m === M ? 'var(--s2)' : 'transparent'; b.style.fontWeight = b.dataset.m === M ? '700' : '400'; });
    const ms = periodMonths(per), rows = defectRows(ms, loc), T = D.types || {};
    const name = c => T[c] || c;
    const qty = rows.reduce((s, r) => s + r[5], 0);
    const kgKnownQty = rows.reduce((s, r) => s + (r[7] || 0), 0), kg = rows.reduce((s, r) => s + (r[6] || 0), 0);
    // оцінка кг для рядків без ваги — за середньою вагою деталі тих самих типів
    const kgPerPc = kgKnownQty ? kg / kgKnownQty : null;
    const val = (q, k, kq) => M === 'q' ? q : (k + (kgPerPc != null ? (q - kq) * kgPerPc : 0)) * (M === 'uah' ? price : 1);
    const unit = M === 'q' ? 'шт' : M === 'kg' ? 'кг' : '₴';
    let cl = 0, tot = 0; ms.forEach(m => { const c = D.months[m].defects.coverage || {}; cl += +c.classifiedQty || 0; tot += +c.totalDefectQty || 0; });
    const qcQ = rows.filter(r => r[3] === 'Q').reduce((s, r) => s + r[5], 0);
    const nightQ = rows.filter(r => r[1] === 'N').reduce((s, r) => s + r[5], 0), dayQ = rows.filter(r => r[1] === 'D').reduce((s, r) => s + r[5], 0);
    const lag = {}; ms.forEach(m => Object.entries(D.months[m].defects.lag || {}).forEach(([k, v]) => lag[k] = (lag[k] || 0) + v));
    const lagTot = Object.values(lag).reduce((s, v) => s + v, 0);

    // по типах
    const byT = {};
    rows.forEach(r => { const a = byT[r[4]] || (byT[r[4]] = { c: r[4], q: 0, k: 0, kq: 0, d: 0, n: 0, qc: 0 }); a.q += r[5]; a.k += r[6] || 0; a.kq += r[7] || 0; if (r[1] === 'D') a.d += r[5]; if (r[1] === 'N') a.n += r[5]; if (r[3] === 'Q') a.qc += r[5]; });
    const types = Object.values(byT).map(a => Object.assign(a, { v: val(a.q, a.k, a.kq) })).sort((a, b) => b.v - a.v);
    const totV = types.reduce((s, a) => s + a.v, 0);
    let cum = 0; types.forEach(a => { cum += a.v; a.cum = pct(cum, totV); a.sh = pct(a.v, totV); });

    const body = $('sf-d-body');
    body.innerHTML = tiles([
      tile('Класифікований брак', fmt(qty) + ' шт', `${f1(kg + (kgPerPc != null ? (qty - kgKnownQty) * kgPerPc : 0))} кг · ≈${fmt((kg + (kgPerPc != null ? (qty - kgKnownQty) * kgPerPc : 0)) * price)} ₴`, 'Сума quantity по журналу за період (кг для записів без ваги оцінено за середньою вагою)', R),
      tile('Покриття класифікацією', p1(pct(cl, tot)), `${fmt(cl)} з ${fmt(tot)} шт мають причину` + (loc ? ' · по всіх локаціях' : ''), 'Частка браку ОТК, для якої вказано причину. Це НЕ відсоток браку.', pct(cl, tot) != null && pct(cl, tot) < 90 ? RT : null),
      tile('Топ-причина', types[0] ? esc(name(types[0].c)) : '—', types[0] ? `${p1(types[0].sh)} браку (${unit})` : '', '', null),
      tile('Топ-3 причини разом', types.length ? p1(types[2] ? types[2].cum : types[types.length - 1].cum) : '—', 'частка від усього браку', 'Якщо 3 причини дають > 60% — фокус на них дасть найбільший ефект'),
      tile('Знайдено на ОТК', p1(pct(qcQ, qty)), `решта — на обробці (${p1(pct(qty - qcQ, qty))})`, 'QC — вихідний контроль; PROCESS — постобробка'),
      tile('Нічна зміна', p1(pct(nightQ, dayQ + nightQ)), `браку виготовлено вночі · ${fmt(nightQ)} шт`, 'За зміною ВИГОТОВЛЕННЯ (producedAt.shift)', pct(nightQ, dayQ + nightQ) > 55 ? R : null),
      tile('Виявлено ≤1 дня', p1(pct((lag['0'] || 0) + (lag['1'] || 0), lagTot)), `≥7 днів: ${p1(pct(lag['7+'] || 0, lagTot))}`, 'Скільки часу минає від виготовлення до реєстрації браку'),
    ]) + `
      <div class="card" style="margin-bottom:12px"><div class="ct" style="margin-bottom:8px">Парето причин браку <span style="font-weight:500;color:var(--tl);font-size:10px">(${unit}; лінія — накопичена частка)</span></div>
        <div class="cw" style="height:260px"><canvas id="sf-d-pareto"></canvas></div></div>
      <div class="g2" style="margin-bottom:12px">
        <div class="card"><div class="ct" style="margin-bottom:8px">Причини: кількість, вага, вартість</div><div style="max-height:360px;overflow:auto">${tbl(
          th('Причина') + th('шт', 1) + th('кг', 1) + th('≈₴', 1) + th('Частка', 1, 'у вибраній одиниці') + th('Накоп.', 1) + th('День / ніч', 1, 'шт за зміною виготовлення') + th('На ОТК', 1, '% знайдено на ОТК (решта — на обробці)'),
          types.map(a => `<tr><td>${esc(name(a.c))}</td>${td(fmt(a.q))}${td(f1(a.k + (kgPerPc != null ? (a.q - a.kq) * kgPerPc : 0)))}${td(fmt((a.k + (kgPerPc != null ? (a.q - a.kq) * kgPerPc : 0)) * price))}${td(p1(a.sh), 1)}${td(p1(a.cum))}${td(fmt(a.d) + ' / ' + fmt(a.n))}${td(p1(pct(a.qc, a.q)))}</tr>`).join(''))}</div></div>
        <div class="card"><div class="ct" style="margin-bottom:8px">День vs ніч: структура браку <span style="font-weight:500;color:var(--tl);font-size:10px">(% браку зміни)</span></div><div class="cw" style="height:330px"><canvas id="sf-d-dn"></canvas></div></div>
      </div>
      <div class="card" style="margin-bottom:12px"><div class="ct" style="margin-bottom:8px">Причини × локації <span style="font-weight:500;color:var(--tl);font-size:10px">(частка причини в браку локації, ${unit}; чим темніше — тим більша)</span></div><div id="sf-d-heat"></div></div>
      <div class="g2" style="margin-bottom:12px">
        <div class="card"><div class="ct" style="margin-bottom:8px">Проблемні артикули <span style="font-weight:500;color:var(--tl);font-size:10px">(топ-15 за браком, шт)</span></div><div id="sf-d-prod" style="max-height:360px;overflow:auto"></div></div>
        <div class="card"><div class="ct" style="margin-bottom:8px">Затримка виявлення браку <span style="font-weight:500;color:var(--tl);font-size:10px">(днів від виготовлення до реєстрації, шт)</span></div><div class="cw" style="height:200px"><canvas id="sf-d-lag"></canvas></div></div>
      </div>
      <div class="card" style="margin-bottom:12px"><div class="ct" style="margin-bottom:8px">Тренд причин по місяцях <span style="font-weight:500;color:var(--tl);font-size:10px">(${unit}, топ-6 причин року${loc ? ', ' + locName(loc) : ''}; * — місяць триває)</span></div><div class="cw" style="height:240px"><canvas id="sf-d-trend"></canvas></div></div>`;

    // Парето
    const top = types.slice(0, 12), rest = types.slice(12);
    const pl = top.map(a => name(a.c)), pv = top.map(a => a.v);
    if (rest.length) { pl.push('Інші (' + rest.length + ')'); pv.push(rest.reduce((s, a) => s + a.v, 0)); }
    let cc = 0; const pc = pv.map(v => +((cc += v) / (totV || 1) * 100).toFixed(1));
    chart('sf-d-pareto', { data: { labels: pl, datasets: [
      { type: 'bar', label: unit, data: pv.map(v => +v.toFixed(1)), backgroundColor: pl.map((_, i) => i < 3 ? R : 'rgba(192,57,43,.35)'), borderRadius: 3, yAxisID: 'y' },
      { type: 'line', label: 'Накопичено, %', data: pc, borderColor: WH, backgroundColor: WH, pointRadius: 3, tension: .2, yAxisID: 'y1' }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } },
        scales: { x: { grid: { display: false }, ticks: { font: { size: 9 }, maxRotation: 40, autoSkip: false } }, y: { beginAtZero: true, grid: { color: GRID } },
          y1: { position: 'right', min: 0, max: 100, grid: { drawOnChartArea: false }, ticks: { callback: v => v + '%' } } } } });

    // День / ніч — частка кожної причини в браку зміни (топ-8)
    const t8 = types.slice(0, 8);
    chart('sf-d-dn', { type: 'bar', data: { labels: t8.map(a => name(a.c)), datasets: [
      { label: 'День', data: t8.map(a => +(pct(a.d, dayQ) || 0).toFixed(1)), backgroundColor: RT, borderRadius: 3 },
      { label: 'Ніч', data: t8.map(a => +(pct(a.n, nightQ) || 0).toFixed(1)), backgroundColor: '#3B4A6B', borderRadius: 3 }] },
      options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'top', labels: { boxWidth: 10, font: { size: 10 } } } },
        scales: { x: { grid: { color: GRID }, ticks: { callback: v => v + '%' } }, y: { grid: { display: false }, ticks: { font: { size: 9 } } } } } });

    // Теплова карта причини × локації (по всіх локаціях, без фільтра локації)
    const all = defectRows(ms, ''), locs = [...new Set(all.map(r => r[2]))].sort((a, b) => (+a || 9e9) - (+b || 9e9));
    const cell = {}, lt = {};
    all.forEach(r => { const v = val(r[5], r[6] || 0, r[7] || 0); cell[r[4] + '|' + r[2]] = (cell[r[4] + '|' + r[2]] || 0) + v; lt[r[2]] = (lt[r[2]] || 0) + v; });
    const tt = {}; all.forEach(r => tt[r[4]] = (tt[r[4]] || 0) + val(r[5], r[6] || 0, r[7] || 0));
    const hT = Object.keys(tt).sort((a, b) => tt[b] - tt[a]).slice(0, 10);
    $('sf-d-heat').innerHTML = tbl(th('Причина') + locs.map(l => th(locName(l), 1)).join(''),
      hT.map(c => `<tr><td>${esc(name(c))}</td>${locs.map(l => { const s = pct(cell[c + '|' + l] || 0, lt[l]); const a = Math.min(.85, (s || 0) / 45); return `<td style="text-align:right;background:rgba(192,57,43,${a.toFixed(2)});color:${a > .45 ? '#fff' : 'inherit'}">${s ? s.toFixed(0) + '%' : '·'}</td>`; }).join('')}</tr>`).join(''),
      `<tr><td>Брак локації, ${unit}</td>${locs.map(l => td(M === 'q' ? fmt(lt[l]) : fmt(lt[l]), 1)).join('')}</tr>`);

    // Артикули
    const pr = {};
    ms.forEach(m => (D.months[m].defects.products || []).forEach(([pcode, c, q, k]) => { const a = pr[pcode] || (pr[pcode] = { p: pcode, q: 0, k: 0, by: {} }); a.q += q; a.k += k; a.by[c] = (a.by[c] || 0) + q; }));
    const pa = Object.values(pr).sort((a, b) => b.q - a.q).slice(0, 15);
    $('sf-d-prod').innerHTML = tbl(th('Артикул') + th('шт', 1) + th('кг', 1) + th('Головна причина') + th('Частка', 1),
      pa.map(a => { const [c, q] = Object.entries(a.by).sort((x, y) => y[1] - x[1])[0]; return `<tr><td>${esc(a.p)}</td>${td(fmt(a.q))}${td(f1(a.k))}<td style="font-weight:500">${esc(name(c))}</td>${td(p1(pct(q, a.q)))}</tr>`; }).join(''))
      + (loc ? '<div style="font-size:10px;color:var(--tl);margin-top:4px">Артикули — по всіх локаціях (журнал не дає розбивку артикул × локація в агрегатах).</div>' : '');

    // Затримка
    const LB = ['0', '1', '2', '3–6', '7+'];
    chart('sf-d-lag', { type: 'bar', data: { labels: ['той самий день', '1 день', '2 дні', '3–6 днів', '7+ днів'], datasets: [{ data: LB.map(k => Math.round(lag[k] || 0)), backgroundColor: [G, G, WH, RT, R], borderRadius: 3 }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { grid: { display: false } }, y: { beginAtZero: true, grid: { color: GRID } } } } });

    // Тренд (увесь рік)
    const ym = months(), yr = defectRows(ym, loc), yt = {};
    yr.forEach(r => yt[r[4]] = (yt[r[4]] || 0) + val(r[5], r[6] || 0, r[7] || 0));
    const t6 = Object.keys(yt).sort((a, b) => yt[b] - yt[a]).slice(0, 6);
    const per_m = m => defectRows([m], loc);
    const ds = t6.map((c, i) => ({ label: name(c), data: ym.map(m => +per_m(m).filter(r => r[4] === c).reduce((s, r) => s + val(r[5], r[6] || 0, r[7] || 0), 0).toFixed(1)), backgroundColor: PAL[i], borderRadius: 2, stack: 's' }));
    ds.push({ label: 'Інші', data: ym.map(m => +per_m(m).filter(r => !t6.includes(r[4])).reduce((s, r) => s + val(r[5], r[6] || 0, r[7] || 0), 0).toFixed(1)), backgroundColor: '#C9CFCB', borderRadius: 2, stack: 's' });
    chart('sf-d-trend', { type: 'bar', data: { labels: ym.map(m => m + (D.months[m].complete === false ? '*' : '')), datasets: ds },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'top', labels: { boxWidth: 10, font: { size: 9 } } } },
        scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, beginAtZero: true, grid: { color: GRID } } } } });
  }

  // ═══════════════ 2. ЯКІСТЬ: ОТК — продуктивність ═══════════════
  function renderQC() {
    const root = mount('panel-qual', 'w-sf-qc', header('🔍', 'ОТК — продуктивність перевірки',
      'Перевірки ОТК з /api/shift-workers (category=QC), за датою події ОТК. Виявлений брак = % браку серед ПЕРЕВІРЕНИХ деталей (інша база, ніж «брак змін»). Персональні показники груп з 1 людини приховано.',
      sel('sf-q-per', '')) + `<div id="sf-q-body" style="margin-top:8px"></div>`);
    if (!root) return; stamp(root);
    const body = $('sf-q-body');
    if (!D || !months().length) return noData(body, 'Дані з’являться після першого запуску <b>update-shopfloor</b>.');
    const per = $('sf-q-per');
    if (!per.options.length) { per.innerHTML = periodOptions(false); per.onchange = drawQC; }
    drawQC();
  }
  function staffRows(m, cat) { return ((D.months[m] || {}).staff || []).filter(r => r.cat === cat); }
  function drawQC() {
    const m = $('sf-q-per').value, rows = staffRows(m, 'QC');
    const line = (r, lbl) => {
      const rv = r.review, h = r.hours;
      if (r.hidden || !rv) return `<tr><td>${lbl}</td>${td(r.people)}${td(HIDDEN)}${td('—')}${td('—')}${td('—')}${td('—')}${td('—')}${td('—')}${td('—')}</tr>`;
      return `<tr><td>${lbl}</td>${td(r.people)}${td(fmt(h))}${td(fmt(rv.finalizedBatches))}${td(fmt(rv.reviewedQty))}${td(f1(rv.reviewedKg))}${td(h ? fmt(rv.reviewedQty / h) : '—', 1)}${td(h && rv.reviewedKg != null ? f1(rv.reviewedKg / h) : '—')}${td(p1(rv.defectFoundPercent), 1, rv.defectFoundPercent > 7.5 ? R : null)}${td(rv.reviewedKg ? f1(h / (rv.reviewedKg / 1000)) : '—')}</tr>`;
    };
    const locRows = rows.filter(r => r.loc !== 'ALL').sort((a, b) => (+a.loc || 9e9) - (+b.loc || 9e9)), all = rows.find(r => r.loc === 'ALL');
    const ms = months(), tr = ms.map(x => staffRows(x, 'QC').find(r => r.loc === 'ALL')).map(r => r && r.review && r.hours ? r : null);
    $('sf-q-body').innerHTML = `<div class="g2" style="margin-bottom:12px"><div class="card"><div class="ct" style="margin-bottom:8px">По локаціях · ${m}</div>${tbl(
      th('Локація') + th('Людей', 1) + th('Годин', 1) + th('Партій', 1, 'фіналізовано') + th('Перевірено шт', 1) + th('кг', 1) + th('шт/год', 1) + th('кг/год', 1) + th('Знайдено браку', 1, '% від перевірених деталей') + th('Год/тонну', 1, 'годин ОТК на 1 тонну перевіреної продукції'),
      locRows.map(r => line(r, locName(r.loc))).join(''), all ? line(all, 'Разом') : '')}</div>
      <div class="card"><div class="ct" style="margin-bottom:8px">Динаміка: перевірено за годину і знайдений брак</div><div class="cw" style="height:230px"><canvas id="sf-q-trend"></canvas></div></div></div>`;
    chart('sf-q-trend', { data: { labels: ms.map(x => x + (D.months[x].complete === false ? '*' : '')), datasets: [
      { type: 'bar', label: 'шт / год', data: tr.map(r => r ? Math.round(r.review.reviewedQty / r.hours) : null), backgroundColor: 'rgba(61,126,166,.55)', borderRadius: 3, yAxisID: 'y' },
      { type: 'line', label: 'знайдено браку, %', data: tr.map(r => r ? r.review.defectFoundPercent : null), borderColor: R, backgroundColor: R, pointRadius: 3, tension: .3, yAxisID: 'y1' }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'top', labels: { boxWidth: 10, font: { size: 9 } } } },
        scales: { x: { grid: { display: false } }, y: { beginAtZero: true, grid: { color: GRID } }, y1: { position: 'right', beginAtZero: true, grid: { drawOnChartArea: false }, ticks: { callback: v => v + '%' } } } } });
  }

  // ═══════════════ 3. ВИРОБНИЦТВО: зміни операторів ═══════════════
  function renderShifts() {
    const root = mount('panel-prod', 'w-sf-shifts', header('👷', 'Зміни операторів і виконання плану',
      'З /api/shift-workers (category=OPERATOR). Виконання і брак — РЕЗУЛЬТАТ ЗМІНИ (не особистий показник), тільки зміни з покриттям ОТК ≥95%, зважено за годинами. Брак змін = кг браку до плану в кг (інша база, ніж % браку партій). Виробіток — з даних партій (з 12.08.2026).',
      `${sel('sf-s-per', '')} ${sel('sf-s-loc', '')}`) + `<div id="sf-s-body" style="margin-top:8px"></div>`);
    if (!root) return; stamp(root);
    const body = $('sf-s-body');
    if (!D || !months().length) return noData(body, 'Дані з’являться після першого запуску <b>update-shopfloor</b>.');
    const per = $('sf-s-per'), loc = $('sf-s-loc');
    if (!per.options.length) {
      per.innerHTML = periodOptions(true); per.value = months().slice(-1)[0];
      loc.innerHTML = `<option value="">Усі локації</option>` + locList().map(l => `<option value="${l}">${locName(l)}</option>`).join('');
      per.onchange = loc.onchange = drawShifts;
    }
    drawShifts();
  }
  function opDays(ms, loc) {
    const out = [];
    ms.forEach(m => (D.months[m].operatorDays || []).forEach(r => { if (!loc || r[2] === loc) out.push(r); }));
    return out;  // [date, shift, loc, people, compl, preQc, defect, qcCov, matched, verified]
  }
  function aggOp(rows) {
    const a = { people: 0, inst: 0, cw: 0, cn: 0, pw: 0, pn: 0, dw: 0, dn: 0, m: 0, v: 0 };
    rows.forEach(r => { a.people += r[3]; a.inst++; if (r[4] != null) { a.cw += r[4] * r[3]; a.cn += r[3]; } if (r[5] != null) { a.pw += r[5] * r[3]; a.pn += r[3]; } if (r[6] != null) { a.dw += r[6] * r[3]; a.dn += r[3]; } a.m += r[8]; a.v += r[9]; });
    a.c = a.cn ? a.cw / a.cn : null; a.p = a.pn ? a.pw / a.pn : null; a.d = a.dn ? a.dw / a.dn : null;
    return a;
  }
  function drawShifts() {
    const per = $('sf-s-per').value, loc = $('sf-s-loc').value, ms = periodMonths(per);
    const rows = opDays(ms, loc), A = aggOp(rows), Dd = aggOp(rows.filter(r => r[1] === 'D')), Nn = aggOp(rows.filter(r => r[1] === 'N'));
    // розподіл за виконанням — останній місяць періоду
    const lm = ms[ms.length - 1], sr = staffRows(lm, 'OPERATOR').find(r => r.loc === (loc || 'ALL'));
    const dist = sr && sr.dist, distN = dist ? Object.values(dist).reduce((s, v) => s + v, 0) : 0;
    const over100 = dist ? (dist['100–110%'] || 0) + (dist['≥110%'] || 0) : null;
    // Виробіток: деталі та друк-години з партій / операторо-зміни (по днях і локаціях, де є обидва джерела)
    const prodRows = productivity(ms, loc);
    const body = $('sf-s-body');
    body.innerHTML = tiles([
      tile('Операторо-змін', fmt(A.people), `день ${fmt(Dd.people)} · ніч ${fmt(Nn.people)}`, 'Сума виходів операторів на зміну'),
      tile('Операторів на зміну', A.inst ? f1(A.people / A.inst) : '—', `${fmt(A.inst)} змін (локація × дата × зміна)`),
      tile('Виконання після ОТК', p1(A.c), `день ${p1(Dd.c)} · ніч ${p1(Nn.c)}`, 'completionPercent, зважено', A.c != null && A.c < 95 ? R : GD),
      tile('Виконання до ОТК', p1(A.p), A.p != null && A.c != null ? `різниця ${(A.p - A.c).toFixed(1)} п.п.` : '', 'preQcCompletionPercent — інша база, тому різниця орієнтовна («втрати на ОТК»)'),
      tile('Брак змін', p1(A.d), `день ${p1(Dd.d)} · ніч ${p1(Nn.d)}`, 'кг браку до плану змін у кг', Nn.d != null && Dd.d != null && Nn.d > Dd.d * 1.2 ? R : null),
      tile('Змін з ОТК ≥95%', p1(pct(A.v, A.m)), `${fmt(A.v)} з ${fmt(A.m)} — лише вони в % виконання`),
      tile('Операторів з виконанням ≥100%', dist ? p1(pct(over100, distN)) : '—', dist ? `${over100} з ${distN} · ${lm}` : 'менше 3 операторів у групі', 'Розподіл без імен; рахується від 3 операторів'),
    ]) + `<div class="g2" style="margin-bottom:12px">
        <div class="card"><div class="ct" style="margin-bottom:8px">По локаціях: день / ніч</div><div id="sf-s-loc-t"></div></div>
        <div class="card"><div class="ct" style="margin-bottom:8px">Розподіл операторів за виконанням плану <span style="font-weight:500;color:var(--tl);font-size:10px">(${lm}, к-сть людей, без імен)</span></div><div class="cw" style="height:220px"><canvas id="sf-s-dist"></canvas></div></div>
      </div>
      <div class="card" style="margin-bottom:12px"><div class="ct" style="margin-bottom:8px">Динаміка: виконання і брак змін, день vs ніч <span style="font-weight:500;color:var(--tl);font-size:10px">(${loc ? locName(loc) : 'усі локації'}; * — місяць триває)</span></div><div class="cw" style="height:240px"><canvas id="sf-s-trend"></canvas></div></div>
      <div class="card" style="margin-bottom:12px"><div class="ct" style="margin-bottom:4px">Виробіток на операторо-зміну</div>
        <div style="font-size:10px;color:var(--tl);margin-bottom:8px">Прийняті деталі та години друку з даних партій ÷ операторо-зміни того ж дня і локації. Дані партій по локаціях є з 12.08.2026; дні без обох джерел не враховуються.</div><div id="sf-s-prod"></div></div>`;

    const locs = loc ? [loc] : [...new Set(rows.map(r => r[2]))].sort((a, b) => (+a || 9e9) - (+b || 9e9));
    $('sf-s-loc-t').innerHTML = tbl(th('Локація') + th('Опер.-змін Д/Н', 1) + th('Виконання Д', 1) + th('Виконання Н', 1) + th('Брак Д', 1) + th('Брак Н', 1) + th('Операторів', 1, 'у табелі за останній місяць періоду'),
      locs.map(l => { const r = rows.filter(x => x[2] === l), d = aggOp(r.filter(x => x[1] === 'D')), n = aggOp(r.filter(x => x[1] === 'N')); const st = staffRows(lm, 'OPERATOR').find(x => x.loc === l);
        return `<tr><td>${locName(l)}</td>${td(fmt(d.people) + ' / ' + fmt(n.people))}${td(p1(d.c), 1, d.c != null && d.c < 95 ? R : null)}${td(p1(n.c), 1, n.c != null && n.c < 95 ? R : null)}${td(p1(d.d))}${td(p1(n.d), 0, n.d != null && d.d != null && n.d > d.d * 1.2 ? R : null)}${td(st ? st.people : '—')}</tr>`; }).join(''));

    const LBL = ['<80%', '80–90%', '90–100%', '100–110%', '≥110%'];
    chart('sf-s-dist', { type: 'bar', data: { labels: LBL, datasets: [{ data: LBL.map(k => dist ? dist[k] || 0 : 0), backgroundColor: [R, RT, WH, G, GD], borderRadius: 3 }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { grid: { display: false } }, y: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: GRID } } } } });

    const ym = months(), mm = ym.map(m => { const r = opDays([m], loc); return { d: aggOp(r.filter(x => x[1] === 'D')), n: aggOp(r.filter(x => x[1] === 'N')) }; });
    chart('sf-s-trend', { type: 'line', data: { labels: ym.map(m => m + (D.months[m].complete === false ? '*' : '')), datasets: [
      { label: 'Виконання — день', data: mm.map(x => x.d.c && +x.d.c.toFixed(1)), borderColor: RT, backgroundColor: RT, tension: .3, pointRadius: 3, yAxisID: 'y' },
      { label: 'Виконання — ніч', data: mm.map(x => x.n.c && +x.n.c.toFixed(1)), borderColor: '#3B4A6B', backgroundColor: '#3B4A6B', tension: .3, pointRadius: 3, yAxisID: 'y' },
      { label: 'Брак — день', data: mm.map(x => x.d.d && +x.d.d.toFixed(2)), borderColor: RT, borderDash: [4, 3], pointRadius: 2, tension: .3, yAxisID: 'y1' },
      { label: 'Брак — ніч', data: mm.map(x => x.n.d && +x.n.d.toFixed(2)), borderColor: '#3B4A6B', borderDash: [4, 3], pointRadius: 2, tension: .3, yAxisID: 'y1' }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'top', labels: { boxWidth: 10, font: { size: 9 } } } },
        scales: { x: { grid: { display: false } }, y: { title: { display: true, text: 'виконання, %', font: { size: 9 } }, grid: { color: GRID } },
          y1: { position: 'right', beginAtZero: true, title: { display: true, text: 'брак, %', font: { size: 9 } }, grid: { drawOnChartArea: false } } } } });

    $('sf-s-prod').innerHTML = prodRows.length ? tbl(th('Локація') + th('Днів', 1) + th('Опер.-змін', 1) + th('Деталей', 1) + th('Друк-годин', 1) + th('Деталей / опер.-зміну', 1) + th('Друк-год / опер.-зміну', 1),
      prodRows.map(r => `<tr${r.total ? ' style="background:var(--s2)"' : ''}><td>${r.total ? '<b>Разом</b>' : locName(r.loc)}</td>${td(r.days)}${td(fmt(r.os))}${td(fmt(r.parts))}${td(fmt(r.ph))}${td(fmt(r.parts / r.os), 1)}${td(f1(r.ph / r.os), 1)}</tr>`).join(''))
      : '<div style="font-size:11px;color:var(--tl)">Немає днів, де є і дані партій по локаціях, і зміни операторів (дані партій — з 12.08.2026).</div>';
  }
  function productivity(ms, loc) {
    const days = (BH && BH.days) || [], set = new Set(ms), os = {};
    opDays(ms, loc).forEach(r => { const k = r[0] + '|' + r[2]; os[k] = (os[k] || 0) + r[3]; });
    const by = {};
    days.forEach(d => { if (!set.has((d.date || '').slice(0, 7))) return;
      Object.entries(d.locations || {}).forEach(([l, v]) => { if (loc && l !== loc) return; const o = os[d.date + '|' + l]; if (!o) return;
        const a = by[l] || (by[l] = { loc: l, days: 0, os: 0, parts: 0, ph: 0 }); a.days++; a.os += o; a.parts += v.acceptedQty || 0; a.ph += (v.totalPrintTimeMinutes || 0) / 60; }); });
    const out = Object.values(by).sort((a, b) => (+a.loc || 9e9) - (+b.loc || 9e9));
    if (out.length > 1) out.push(out.reduce((t, r) => ({ total: 1, days: Math.max(t.days, r.days), os: t.os + r.os, parts: t.parts + r.parts, ph: t.ph + r.ph }), { total: 1, days: 0, os: 0, parts: 0, ph: 0 }));
    return out;
  }

  // ═══════════════ 4. ЛОКАЦІЇ: ТО і ремонти ═══════════════
  function renderTech() {
    const root = mount('panel-loc', 'w-sf-tech', header('🔧', 'Техобслуговування і ремонти (ІТО)',
      'З /api/shift-workers (category=TECH). Ремонти/ТО — лічильники техніків, сумовані по локації (у локаціях з 1 техніком приховано). Виконання планового ТО, черга і повторні звернення — показники всієї локації; черга — поточний стан, не історія. ≈MTBF = години друку партій ÷ непланові ремонти (дані партій по локаціях — з 12.08.2026). Тривалості ремонту (MTTR) в API немає.',
      sel('sf-t-per', '')) + `<div id="sf-t-body" style="margin-top:8px"></div>`);
    if (!root) return; stamp(root);
    const body = $('sf-t-body');
    if (!D || !months().length) return noData(body, 'Дані з’являться після першого запуску <b>update-shopfloor</b>.');
    const per = $('sf-t-per');
    if (!per.options.length) { per.innerHTML = periodOptions(false); per.onchange = drawTech; }
    drawTech();
  }
  function printHours(m) {
    const out = {}; let cnt = 0;
    ((BH && BH.days) || []).forEach(d => { if ((d.date || '').slice(0, 7) !== m) return; cnt++;
      Object.entries(d.locations || {}).forEach(([l, v]) => out[l] = (out[l] || 0) + (v.totalPrintTimeMinutes || 0) / 60); });
    const bm = ((BMH && BMH.months) || []).find(x => x.month === m);
    out.ALL = bm && bm.company && bm.company.totalPrintTimeMinutes ? bm.company.totalPrintTimeMinutes / 60 : (cnt ? Object.values(out).reduce((s, v) => s + v, 0) : null);
    out._days = cnt;
    return out;
  }
  function printers() {
    const out = {}; let t = 0;
    ((CAP && CAP.locations) || []).forEach(l => { const k = (String(l.location || '').match(/\d+/) || [l.location])[0]; out[k] = l.machines && l.machines.total; t += (l.machines && l.machines.total) || 0; });
    out.ALL = t || null; return out;
  }
  function drawTech() {
    const m = $('sf-t-per').value, rows = staffRows(m, 'TECH'), PH = printHours(m), PR = printers(), isCur = D.months[m].complete === false;
    const line = (r, lbl) => {
      const mt = r.maintenance || {}, L = r.locLevel || {}, hid = r.hidden, rep = hid ? null : mt.repairsDone, pl = hid ? null : mt.plannedDone, pr = PR[r.loc];
      const ph = r.loc === 'ALL' ? PH.ALL : (PH._days ? PH[r.loc] : null);
      const v = x => hid ? HIDDEN : fmt(x);
      return `<tr${r.loc === 'ALL' ? ' style="background:var(--s2)"' : ''}><td>${lbl}</td>${td(r.people)}${td(fmt(r.shifts))}${td(v(rep), 1)}${td(v(pl))}${td(v(mt.notNeeded))}${td(v(mt.machinesDone))}
        ${td(hid || !r.shifts || mt.machinesDone == null ? (hid ? HIDDEN : '—') : f1(mt.machinesDone / r.shifts))}
        ${td(L.locationPlannedPercent != null ? p1(L.locationPlannedPercent) : '—', 1, L.locationPlannedPercent != null && L.locationPlannedPercent < 85 ? R : null)}
        ${td(L.locationUnplannedQueue != null ? fmt(L.locationUnplannedQueue) : '—', 0, L.locationUnplannedQueue > 10 ? R : null)}${td(L.locationRepeatWithin6h != null ? fmt(L.locationRepeatWithin6h) : '—', 0, L.locationRepeatWithin6h > 3 ? RT : null)}
        ${td(pr ? fmt(pr) : '—')}${td(rep != null && pr ? f1(rep / pr * 100) : '—', 1)}${td(pr && r.people ? fmt(pr / r.people) : '—')}${td(rep && ph ? fmt(ph / rep) : '—', 1)}</tr>`;
    };
    const locRows = rows.filter(r => r.loc !== 'ALL').sort((a, b) => (+a.loc || 9e9) - (+b.loc || 9e9)), all0 = rows.find(r => r.loc === 'ALL');
    // «Разом»: показники рівня локації — сер. виконання ТО (зважене на принтери), сума черги і повторів
    let all = all0;
    if (all0) {
      const ll = locRows.map(r => [r.locLevel || {}, PR[r.loc] || 1]);
      const wsum = (f) => { let s = 0, w = 0; ll.forEach(([L, wt]) => { if (L[f] != null) { s += L[f] * wt; w += wt; } }); return w ? s / w : null; };
      const ssum = (f) => { const v = ll.map(([L]) => L[f]).filter(x => x != null); return v.length ? v.reduce((a, b) => a + b, 0) : null; };
      all = Object.assign({}, all0, { locLevel: { locationPlannedPercent: wsum('locationPlannedPercent'), locationUnplannedQueue: ssum('locationUnplannedQueue'), locationRepeatWithin6h: ssum('locationRepeatWithin6h') } });
    }
    const ms = months(), tr = ms.map(x => { const a = staffRows(x, 'TECH').find(r => r.loc === 'ALL'); const ph = printHours(x).ALL; const mt = (a && a.maintenance) || {}; return { rep: mt.repairsDone, pl: mt.plannedDone, mtbf: mt.repairsDone && ph ? ph / mt.repairsDone : null }; });
    $('sf-t-body').innerHTML = `<div class="card" style="margin-bottom:12px"><div class="ct" style="margin-bottom:8px">По локаціях · ${m}${isCur ? ' (місяць триває)' : ''}</div>${tbl(
      th('Локація') + th('Техніків', 1) + th('Змін', 1) + th('Непланові ремонти', 1) + th('Планові ТО', 1) + th('Не потребувало', 1) + th('Закрито машин', 1) + th('Машин / зміну', 1)
      + th('Виконання план. ТО', 1, 'по всій локації') + th('Черга зараз', 1, 'відкриті непланові заявки — поточний стан') + th('Повтор ≤6 год', 1, 'машин з повторним зверненням протягом 6 год — індикатор якості ремонту')
      + th('Принтерів', 1, 'поточна кількість (capacity)') + th('Ремонтів / 100 принт.', 1) + th('Принтерів / техніка', 1) + th('≈MTBF, год', 1, 'години друку ÷ непланові ремонти'),
      locRows.map(r => line(r, locName(r.loc))).join(''), all ? line(all, 'Разом') : '')}
      ${!PH._days ? '<div style="font-size:10px;color:var(--tl);margin-top:4px">≈MTBF по локаціях недоступний для цього місяця — даних партій по локаціях немає (є з 12.08.2026); «Разом» рахується з місячних даних компанії.</div>' : ''}</div>
      <div class="card" style="margin-bottom:12px"><div class="ct" style="margin-bottom:8px">Динаміка: ремонти vs планове ТО і ≈MTBF по компанії <span style="font-weight:500;color:var(--tl);font-size:10px">(* — місяць триває)</span></div><div class="cw" style="height:230px"><canvas id="sf-t-trend"></canvas></div></div>`;
    chart('sf-t-trend', { data: { labels: ms.map(x => x + (D.months[x].complete === false ? '*' : '')), datasets: [
      { type: 'bar', label: 'Непланові ремонти', data: tr.map(t => t.rep ?? null), backgroundColor: 'rgba(192,57,43,.65)', borderRadius: 3, yAxisID: 'y' },
      { type: 'bar', label: 'Планові ТО', data: tr.map(t => t.pl ?? null), backgroundColor: 'rgba(42,157,143,.65)', borderRadius: 3, yAxisID: 'y' },
      { type: 'line', label: '≈MTBF, год', data: tr.map(t => t.mtbf && Math.round(t.mtbf)), borderColor: WH, backgroundColor: WH, pointRadius: 3, tension: .3, yAxisID: 'y1' }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'top', labels: { boxWidth: 10, font: { size: 9 } } } },
        scales: { x: { grid: { display: false } }, y: { beginAtZero: true, grid: { color: GRID } }, y1: { position: 'right', beginAtZero: true, grid: { drawOnChartArea: false } } } } });
  }

  // ═══════════════ 5. HR: фактична робота за табелем ═══════════════
  function renderStaff() {
    const root = mount('panel-hr', 'w-sf-staff', header('🕒', 'Фактична робота за табелем — оператори, ІТО, ОТК',
      'З /api/shift-workers: люди, що мали хоча б одну зміну в місяці; години з табеля (обмеження 12,5 год/зміну). Тестерів файлів тут немає. Лише агрегати, без імен і ID.',
      sel('sf-h-per', '')) + `<div id="sf-h-body" style="margin-top:8px"></div>`);
    if (!root) return; stamp(root);
    const body = $('sf-h-body');
    if (!D || !months().length) return noData(body, 'Дані з’являться після першого запуску <b>update-shopfloor</b>.');
    const per = $('sf-h-per');
    if (!per.options.length) { per.innerHTML = periodOptions(false); per.onchange = drawStaff; }
    drawStaff();
  }
  function drawStaff() {
    const m = $('sf-h-per').value, st = (D.months[m].staff || []).filter(r => r.loc === 'ALL');
    const tot = st.reduce((a, r) => ({ people: a.people + r.people, hours: a.hours + (r.hours || 0), shifts: a.shifts + r.shifts, night: a.night + r.shiftsNight }), { people: 0, hours: 0, shifts: 0, night: 0 });
    const emp = HR && HR.employees_count;
    const row = (r, lbl, b) => `<tr${b ? ' style="background:var(--s2)"' : ''}><td>${lbl}</td>${td(fmt(r.people), 1)}${td(fmt(r.hours))}${td(fmt(r.shifts))}${td(p1(pct(r.night ?? r.shiftsNight, r.shifts)))}${td(r.shifts ? f1(r.hours / r.shifts) : '—')}${td(r.people ? f1(r.shifts / r.people) : '—')}${td(r.people ? fmt(r.hours / r.people) : '—')}</tr>`;
    const ms = months();
    $('sf-h-body').innerHTML = tiles([
      tile('Людей у змінах', fmt(tot.people), emp ? `з ${emp} співробітників (${p1(pct(tot.people, emp))}) — решта не в змінному табелі` : '', 'Оператори + ІТО + ОТК, що мали хоча б одну зміну'),
      tile('Людино-годин', fmt(tot.hours), `${fmt(tot.shifts)} змін`),
      tile('Частка нічних змін', p1(pct(tot.night, tot.shifts))),
      tile('Сер. тривалість зміни', tot.shifts ? f1(tot.hours / tot.shifts) + ' год' : '—', 'за табелем'),
    ]) + `<div class="g2" style="margin-bottom:12px"><div class="card"><div class="ct" style="margin-bottom:8px">По категоріях · ${m}</div>${tbl(
      th('Категорія') + th('Людей', 1) + th('Годин', 1) + th('Змін', 1) + th('Нічні', 1) + th('Год / зміну', 1) + th('Змін / люд.', 1) + th('Год / люд.', 1),
      ['OPERATOR', 'TECH', 'QC'].map(c => st.find(r => r.cat === c)).filter(Boolean).map(r => row(r, CAT[r.cat] || r.cat)).join(''), row(tot, 'Разом', 1))}</div>
      <div class="card"><div class="ct" style="margin-bottom:8px">Людей у змінах по місяцях <span style="font-weight:500;color:var(--tl);font-size:10px">(* — місяць триває)</span></div><div class="cw" style="height:230px"><canvas id="sf-h-trend"></canvas></div></div></div>`;
    chart('sf-h-trend', { type: 'bar', data: { labels: ms.map(x => x + (D.months[x].complete === false ? '*' : '')), datasets: ['OPERATOR', 'TECH', 'QC'].map((c, i) => ({
      label: CAT[c], data: ms.map(x => { const r = (D.months[x].staff || []).find(s => s.loc === 'ALL' && s.cat === c); return r ? r.people : null; }), backgroundColor: [G, RT, WH][i], borderRadius: 2, stack: 's' })) },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'top', labels: { boxWidth: 10, font: { size: 9 } } } },
        scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, beginAtZero: true, ticks: { precision: 0 }, grid: { color: GRID } } } } });
  }


  // ═══════════════ 6. ЯКІСТЬ: лоти з браком > X% (v6.2, реєстр #31) ═══════════════
  const LS_LOTX = 'e3d_sf_lotx_v1';
  function renderLots() {
    const root = mount('panel-qual', 'w-sf-lots', header('📦', 'Лоти з браком понад поріг',
      'Кожен фіналізований лот (ОТК) з даних партій: частка лотів, у яких брак перевищив поріг X% (редагується). Дані по окремих лотах накопичуються з 12.08.2026.',
      `${sel('sf-l-per', '')} ${sel('sf-l-loc', '')} <label title="Поріг браку лота, %">X = <input id="sf-l-x" type="number" min="0.5" step="0.5" style="width:52px;font-size:11px;padding:2px 4px;border:1px solid var(--bd);border-radius:6px">%</label>`)
      + `<div id="sf-l-body" style="margin-top:8px"></div>`);
    if (!root) return;
    const body = $('sf-l-body'), days = (BH && BH.days) || [];
    if (!days.some(d => (d.lots || []).length)) return noData(body, 'Дані по окремих лотах ще не накопичились.');
    const per = $('sf-l-per'), loc = $('sf-l-loc'), x = $('sf-l-x');
    if (!per.options.length) {
      const ms = [...new Set(days.filter(d => (d.lots || []).length).map(d => d.date.slice(0, 7)))].sort().reverse();
      per.innerHTML = `<option value="all">Увесь період (з 12.08)</option>` + ms.map(m => `<option value="${m}">${m}</option>`).join('');
      const locs = [...new Set(days.flatMap(d => (d.lots || []).map(l => String(l.location))))].sort((a, b) => (+a || 9e9) - (+b || 9e9));
      loc.innerHTML = `<option value="">Усі локації</option>` + locs.map(l => `<option value="${l}">${locName(l)}</option>`).join('');
      x.value = lsGet(LS_LOTX, 7.5);
      per.onchange = loc.onchange = drawLots;
      x.onchange = () => { lsSet(LS_LOTX, +x.value || 7.5); drawLots(); };
    }
    drawLots();
  }
  function drawLots() {
    const per = $('sf-l-per').value, loc = $('sf-l-loc').value, X = +$('sf-l-x').value || 7.5, days = (BH && BH.days) || [];
    const lots = [];
    days.forEach(d => (d.lots || []).forEach(l => { if ((per === 'all' || d.date.slice(0, 7) === per) && (!loc || String(l.location) === loc) && l.defectPercent != null) lots.push(Object.assign({ date: d.date }, l)); }));
    const bad = lots.filter(l => l.defectPercent > X), qty = lots.reduce((s, l) => s + (l.acceptedQty || 0), 0), badQty = bad.reduce((s, l) => s + (l.acceptedQty || 0), 0);
    const byLoc = {};
    lots.forEach(l => { const a = byLoc[l.location] || (byLoc[l.location] = { n: 0, b: 0, q: 0, bq: 0 }); a.n++; a.q += l.acceptedQty || 0; if (l.defectPercent > X) { a.b++; a.bq += l.acceptedQty || 0; } });
    const B = [[0, 0, '0%'], [0, 2, '0–2%'], [2, 5, '2–5%'], [5, X, '5–' + X + '%'], [X, 15, X + '–15%'], [15, 1e9, '>15%']].filter(b => b[0] < b[1] || b[2] === '0%');
    const cnt = B.map(([a, b, l]) => lots.filter(t => l === '0%' ? t.defectPercent === 0 : t.defectPercent > a && t.defectPercent <= b).length);
    const ms = [...new Set(days.filter(d => (d.lots || []).length).map(d => d.date.slice(0, 7)))].sort();
    const tr = ms.map(m => { const ls = []; days.forEach(d => { if (d.date.slice(0, 7) === m) (d.lots || []).forEach(l => { if ((!loc || String(l.location) === loc) && l.defectPercent != null) ls.push(l); }); }); return ls.length ? +(ls.filter(l => l.defectPercent > X).length / ls.length * 100).toFixed(1) : null; });
    $('sf-l-body').innerHTML = tiles([
      tile('Лотів перевірено', fmt(lots.length), `${fmt(qty)} прийнятих деталей`),
      tile(`Лотів з браком > ${X}%`, fmt(bad.length), p1(pct(bad.length, lots.length)) + ' від усіх лотів', '', pct(bad.length, lots.length) > 15 ? R : null),
      tile('Деталей у таких лотах', p1(pct(badQty, qty)), fmt(badQty) + ' шт'),
    ]) + `<div class="g2" style="margin-bottom:12px">
      <div class="card"><div class="ct" style="margin-bottom:8px">По локаціях</div>${tbl(th('Локація') + th('Лотів', 1) + th(`> ${X}%`, 1) + th('Частка', 1) + th('Деталей у них', 1),
        Object.entries(byLoc).sort((a, b) => (+a[0] || 9e9) - (+b[0] || 9e9)).map(([l, a]) => `<tr><td>${locName(l)}</td>${td(a.n)}${td(a.b, 1)}${td(p1(pct(a.b, a.n)), 1, pct(a.b, a.n) > 15 ? R : null)}${td(p1(pct(a.bq, a.q)))}</tr>`).join(''))}</div>
      <div class="card"><div class="ct" style="margin-bottom:8px">Розподіл лотів за % браку · і частка лотів > ${X}% по місяцях</div><div class="g2"><div class="cw" style="height:200px"><canvas id="sf-l-hist"></canvas></div><div class="cw" style="height:200px"><canvas id="sf-l-trend"></canvas></div></div></div></div>`;
    chart('sf-l-hist', { type: 'bar', data: { labels: B.map(b => b[2]), datasets: [{ data: cnt, backgroundColor: B.map(b => b[0] >= X ? R : b[0] >= 5 ? RT : G), borderRadius: 3 }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { grid: { display: false }, ticks: { font: { size: 9 } } }, y: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: GRID } } } } });
    chart('sf-l-trend', { type: 'line', data: { labels: ms, datasets: [{ label: `% лотів > ${X}%`, data: tr, borderColor: R, backgroundColor: R, pointRadius: 3, tension: .3 }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { grid: { display: false } }, y: { beginAtZero: true, grid: { color: GRID }, ticks: { callback: v => v + '%' } } } } });
  }

  // ═══════════════ 7. ВИРОБНИЦТВО: витрата сировини на годину друку (v6.2, реєстр #34) ═══════════════
  function renderMaterial() {
    const root = mount('panel-prod', 'w-sf-mat', header('🧵', 'Витрата сировини на годину друку',
      'Грами пластику на 1 машино-годину друку по локаціях: «план» — з денного плану друку, «факт» — з прийнятих партій дня (дані /api/capacity). Історія накопичується з 14.10.2026; щоб заповнити минулі дні — один раз запусти Backfill Capacity History.',
      '') + `<div id="sf-m-body" style="margin-top:8px"></div>`);
    if (!root) return;
    const days = ((CH && CH.days) || []).filter(d => Object.values(d.locations || {}).some(l => l.planMin || l.batchMin)).slice(-30);
    const src = days.length ? days : (CAP ? [{ date: CAP.date, locations: Object.fromEntries((CAP.locations || []).map(l => [(String(l.location).match(/\d+/) || [l.location])[0], { planKg: l.plan && l.plan.weightKg, planMin: l.plan && l.plan.printTimeMinutes, batchKg: l.batches && l.batches.weightKg, batchMin: l.batches && l.batches.printTimeMinutes }])) }] : []);
    if (!src.length) return noData($('sf-m-body'), 'Немає даних.');
    const a = {};
    src.forEach(d => Object.entries(d.locations || {}).forEach(([l, v]) => { const x = a[l] || (a[l] = { pk: 0, pm: 0, bk: 0, bm: 0, d: 0 }); x.pk += v.planKg || 0; x.pm += v.planMin || 0; x.bk += v.batchKg || 0; x.bm += v.batchMin || 0; x.d++; }));
    const gph = (kg, min) => min ? kg * 1000 / (min / 60) : null;
    const T = Object.values(a).reduce((t, x) => ({ pk: t.pk + x.pk, pm: t.pm + x.pm, bk: t.bk + x.bk, bm: t.bm + x.bm }), { pk: 0, pm: 0, bk: 0, bm: 0 });
    $('sf-m-body').innerHTML = `<div class="card" style="margin-bottom:12px"><div class="ct" style="margin-bottom:8px">${days.length ? `Останні ${days.length} дн. з даними (${days[0].date} – ${days[days.length - 1].date})` : `Сьогодні (${src[0].date}) — історія ще накопичується`}</div>${tbl(
      th('Локація') + th('План, г/год друку', 1) + th('Факт партій, г/год', 1) + th('Відхилення', 1, 'факт до плану') + th('Факт: кг', 1) + th('Факт: машино-год', 1),
      Object.entries(a).sort((p, q) => (+p[0] || 9e9) - (+q[0] || 9e9)).map(([l, x]) => { const p = gph(x.pk, x.pm), f = gph(x.bk, x.bm); return `<tr><td>${locName(l)}</td>${td(f1(p))}${td(f1(f), 1)}${td(p && f ? ((f / p - 1) * 100).toFixed(0) + '%' : '—', 0, p && f && f / p > 1.15 ? R : null)}${td(f1(x.bk))}${td(fmt(x.bm / 60))}</tr>`; }).join(''),
      `<tr><td>Разом</td>${td(f1(gph(T.pk, T.pm)), 1)}${td(f1(gph(T.bk, T.bm)), 1)}${td('—')}${td(f1(T.bk), 1)}${td(fmt(T.bm / 60), 1)}</tr>`)}</div>`;
  }

  // ── вхід: виклик з go()/restoreTab() при відкритті вкладки ──
  const BY_TAB = { qual: [renderDefects, renderQC, renderLots], prod: [renderShifts, renderMaterial], loc: [renderTech], hr: [renderStaff] };
  function onTab(id) {
    const fns = BY_TAB[id]; if (!fns || done[id]) return;
    done[id] = 1;
    load().then(() => fns.forEach(fn => { try { fn(); } catch (e) { console.warn('[Shopfloor]', id, e); } }));
  }
  // v7.21: дані для js/ops_metrics.js — без повторного завантаження тих самих файлів
  return { onTab, load, get: () => ({ D, CAP, BH, BMH, HR, CH }) };
})();
