/**
 * hr_report.js — Easy 3D Print Dashboard v7.23
 * «Звіт HR» (Google Sheet HR відділу, лист «Звіт HR») → data/hr.json → report (fetch_hr.py).
 * Верх вкладки HR: плитки останнього заповненого місяця, рух штату, плинність проти цілей, повна таблиця звіту.
 * Грошові рядки в публічному JSON — лише зміна до попереднього місяця (%), зарплатні рядки не публікуються.
 */
window.HRReport = (() => {
  const $ = id => document.getElementById(id);
  // v7.24: пастельна жовто-блакитна палітра; статус «в межах / вище цілі» — м'які синій / теракотовий
  const BL = '#8DB8DE', BL2 = '#BCD6EE', BLD = '#2F5D8A', YL = '#F2D27A', YL2 = '#F8E3A6', YLD = '#B8860B';
  const G = BLD, GD = '#2F6F8F', A = BL, R = '#C46A5A', Y = YLD, GRID = '#f0f2ee';
  const SH = { 'Січень': 'січ', 'Лютий': 'лют', 'Березень': 'бер', 'Квітень': 'кві', 'Травень': 'тра', 'Червень': 'чер', 'Липень': 'лип', 'Серпень': 'сер', 'Вересень': 'вер', 'Жовтень': 'жов', 'Листопад': 'лис', 'Грудень': 'гру' };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const n0 = v => v == null || isNaN(v) ? '—' : (+v).toLocaleString('uk-UA', { maximumFractionDigits: 1 });
  const sgn = v => v > 0 ? '+' : v < 0 ? '−' : '±';
  let _loaded = false, _charts = {};

  // чистий підпис без «( таргет до X%)», «, грн», «,%»
  const clean = l => String(l || '').replace(/\(\s*таргет[^)]*\)/i, '').replace(/\(\s*щоквартально\s*\)/i, '').replace(/\(\s*кількість лікарняних\s*\)/i, '')
    .replace(/,\s*%/, '').replace(/,\s*грн/i, '').replace(/\s+,/g, ',').replace(/\s{2,}/g, ' ').replace(/[\s,]+$/, '').trim();

  function css() {
    if ($('hrr-css')) return;
    const s = document.createElement('style'); s.id = 'hrr-css';
    s.textContent = `
#hrr-root .k{display:grid;grid-template-columns:repeat(8,minmax(0,1fr));gap:6px;margin-bottom:10px}
@media(max-width:1250px){#hrr-root .k{grid-template-columns:repeat(4,minmax(0,1fr))}}
@media(max-width:560px){#hrr-root .k{grid-template-columns:repeat(2,minmax(0,1fr))}}
#hrr-root .t{background:#fff;border:1px solid var(--bd);border-radius:8px;box-shadow:var(--sh);padding:6px 8px 6px 10px;position:relative;overflow:hidden;min-width:0}
#hrr-root .t:before{content:'';position:absolute;left:0;top:0;bottom:0;width:3px;background:var(--c,#2A9D8F)}
#hrr-root .t .l{font-size:9.5px;font-weight:600;color:var(--tm);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#hrr-root .t .v{font-size:17px;font-weight:800;line-height:1.25;white-space:nowrap}
#hrr-root .t .v small{font-size:10px;font-weight:700;margin-left:3px}
#hrr-root .t .s{font-size:9.5px;color:var(--tl);line-height:1.3;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
#hrr-root .c{background:#fff;border:1px solid var(--bd);border-radius:var(--r);box-shadow:var(--sh);padding:10px 12px;min-width:0}
#hrr-root .h{font-size:12px;font-weight:700;color:var(--td);margin-bottom:2px}
#hrr-root .n{font-size:10px;color:var(--tl);margin-bottom:6px;line-height:1.45}
#hrr-root table{width:100%;border-collapse:collapse;font-size:11.5px}
#hrr-root th{font-size:10px;font-weight:600;color:var(--tl);text-align:center;padding:5px 6px;border-bottom:1px solid var(--bd);white-space:nowrap}
#hrr-root th:first-child,#hrr-root td:first-child{text-align:left}
#hrr-root td{padding:5px 6px;border-bottom:1px solid #f1f3ef;text-align:center;white-space:nowrap}
#hrr-root tr.hs td{background:#f3f7fb;font-weight:700;color:var(--td);font-size:11px;border-bottom:1px solid var(--bd)}
#hrr-root tr.sub td:first-child{padding-left:18px;color:var(--tm)}
#hrr-root tr.calc td{color:var(--tm);font-style:italic}
#hrr-root td.ok{background:rgba(141,184,222,.28);font-weight:700}
#hrr-root td.bad{background:rgba(242,210,122,.45);font-weight:700;color:#8a5a00}
#hrr-root .tw{overflow-x:auto}`;
    document.head.appendChild(s);
  }

  async function load() {
    if (_loaded) return; _loaded = true;
    const root = $('hrr-root'); if (!root) return;
    css();
    try {
      const d = await fetch('data/hr.json?t=' + Date.now()).then(r => r.ok ? r.json() : null);
      render(d);
    } catch (e) { console.warn('[HRReport]', e); root.innerHTML = `<div class="c" style="font-size:11px;color:${R}">Не вдалося завантажити звіт HR: ${esc(e.message)}</div>`; }
  }

  function render(d) {
    const root = $('hrr-root'), rep = d && d.report;
    if (!rep || !rep.sections || !rep.months) {
      root.innerHTML = `<div class="c" style="font-size:11px;color:var(--tl)">Звіт HR з’явиться після найближчого оновлення даних (лист «Звіт HR» у таблиці HR відділу).</div>`;
      return;
    }
    const M = rep.months, F = rep.filled && rep.filled.length ? rep.filled : [];
    const all = rep.sections.flatMap(s => s.rows.map(r => Object.assign({ _sec: s }, r)));
    const find = re => all.find(r => re.test(r.label));
    const R_ = {
      head: find(/кількість співробітників/i), fired: find(/звільнено/i), turn: find(/плинність штату/i),
      hLP: find(/прийнято.*лп/i), hAdm: find(/прийнято.*адмін/i), intern: find(/плинність стажер/i),
      oLP: find(/відкритих.*лп/i), oAdm: find(/відкритих.*адмін/i), closed: find(/закритих/i),
      sick: find(/лікарнян/i), enps: find(/enps/i), cost: all.find(r => r.money && !r.parent && /найм/i.test(r.label)),
    };
    const cphSec = rep.sections.find(s => s.costPerHireMom);
    const i = F.length ? F[F.length - 1] : 0, p = F.length > 1 ? F[F.length - 2] : null;
    const v = (r, k) => r && r.values ? r.values[k] : null;
    const sum = (a, b, k) => (v(a, k) == null && v(b, k) == null) ? null : (v(a, k) || 0) + (v(b, k) || 0);
    const dl = (cur, prev, unit) => cur == null || prev == null ? '' : `<small style="color:var(--tl)">${sgn(cur - prev)}${n0(Math.abs(cur - prev))}${unit || ''}</small>`;
    const tCol = (r, x) => r && r.target && x != null ? (x <= r.target.max ? GD : R) : 'var(--tx)';
    const mName = k => M[k] ? M[k].toLowerCase() : '';

    const head = v(R_.head, i), headP = p != null ? v(R_.head, p) : null;
    const hired = sum(R_.hLP, R_.hAdm, i), fired = v(R_.fired, i), net = hired != null && fired != null ? hired - fired : null;
    const open = sum(R_.oLP, R_.oAdm, i), openP = p != null ? sum(R_.oLP, R_.oAdm, p) : null, closed = v(R_.closed, i), closedP = p != null ? v(R_.closed, p) : null;
    const turn = v(R_.turn, i), turnP = p != null ? v(R_.turn, p) : null, intern = v(R_.intern, i), internP = p != null ? v(R_.intern, p) : null;
    const sick = v(R_.sick, i), sickP = p != null ? v(R_.sick, p) : null;
    const costMom = R_.cost && R_.cost.mom ? R_.cost.mom[i] : null, cphMom = cphSec ? cphSec.costPerHireMom[i] : null;
    const tile = (c, l, val, s, title) => `<div class="t" style="--c:${c}"${title ? ` title="${esc(title)}"` : ''}><div class="l">${l}</div><div class="v">${val}</div><div class="s">${s}</div></div>`;

    const tiles = `<div class="k">` +
      tile(BL, `Штат · ${mName(i)}`, `${n0(head)}${dl(head, headP)}`, headP != null && head != null ? `${sgn(head - headP)}${n0(Math.abs((head - headP) / headP * 100))}% за місяць` : '', 'Кількість співробітників на кінець місяця') +
      tile(YL, 'Рух штату', `${net == null ? '—' : sgn(net) + n0(Math.abs(net))}`, `+${n0(hired)} (ЛП ${n0(v(R_.hLP, i))}, адм. ${n0(v(R_.hAdm, i))}) · −${n0(fired)}`, 'Чистий приріст = прийнято (ЛП + адмінка) − звільнено') +
      tile(BL, 'Плинність штату', `<span style="color:${tCol(R_.turn, turn)}">${n0(turn)}%</span>${dl(turn, turnP, ' п.п.')}`, R_.turn && R_.turn.target ? `ціль ≤${n0(R_.turn.target.max)}% · ${turn != null && turn <= R_.turn.target.max ? 'в межах' : 'вище'}` : '', 'Звільнені за місяць ÷ штат') +
      tile(YL, 'Плинність стажерів', `<span style="color:${tCol(R_.intern, intern)}">${n0(intern)}%</span>${dl(intern, internP, ' п.п.')}`, R_.intern && R_.intern.target ? `ціль ≤${n0(R_.intern.target.max)}% · ${intern != null && intern <= R_.intern.target.max ? 'в межах' : 'вище'}` : '') +
      tile(YL, 'Відкриті позиції', `${n0(open)}${dl(open, openP)}`, `ЛП ${n0(v(R_.oLP, i))} · адм. ${n0(v(R_.oAdm, i))}${open != null && head ? ` · ${n0(open / head * 100)}% штату` : ''}`, 'Відкриті позиції на кінець місяця; % від штату — скільки людей бракує відносно поточного штату') +
      tile(BL, 'Закрито позицій', `${n0(closed)}${dl(closed, closedP)}`, closed != null && open != null ? `${n0(closed / (closed + open) * 100)}% потреби місяця` : '', 'Кількість закритих позицій (загальна). % потреби = закриті ÷ (закриті + відкриті)') +
      tile(YL, 'Вартість найму', costMom == null ? '—' : `${sgn(costMom)}${n0(Math.abs(costMom))}%`, `до попер. міс.${cphMom != null ? ` · на 1 позицію <b>${sgn(cphMom)}${n0(Math.abs(cphMom))}%</b>` : ''}`, 'Суми в гривнях не публікуються (публічний репозиторій) — лише зміна до попереднього місяця. На 1 позицію = вартість найму ÷ закриті позиції') +
      tile(BL, 'Лікарняні', `${n0(sick)}${dl(sick, sickP)}`, `${sick != null && head ? n0(sick / head * 100) + ' на 100 осіб' : ''}${R_.enps ? ` · eNPS ${R_.enps.values && R_.enps.values.some(x => x != null) ? n0(R_.enps.values.filter(x => x != null).slice(-1)[0]) : '—'}` : ''}`) +
      `</div>`;

    // таблиця: усі місяці року з листа (порожні — «—»)
    const cell = (r, k) => {
      if (r.money) { const m = r.mom ? r.mom[k] : null; return `<td style="color:var(--tl)">${m == null ? (F.includes(k) && k === F[0] ? '<span title="база">•</span>' : '—') : `<span style="color:${m > 0 ? Y : GD}">${sgn(m)}${n0(Math.abs(m))}%</span>`}</td>`; }
      const x = r.values ? r.values[k] : null;
      const cls = r.target && x != null ? (x <= r.target.max ? 'ok' : 'bad') : '';
      return `<td class="${cls}">${x == null ? '—' : n0(x) + (r.unit || '')}</td>`;
    };
    let body = '';
    rep.sections.forEach(s => {
      body += `<tr class="hs"><td colspan="${M.length + 2}">${esc(s.title)}</td></tr>`;
      s.rows.forEach(r => {
        body += `<tr class="${r.parent ? 'sub' : ''}"><td>${esc(clean(r.label))}${r.money ? ' <span style="color:var(--tl);font-size:9.5px">(зміна, %)</span>' : ''}</td>${M.map((_, k) => cell(r, k)).join('')}<td style="color:var(--tl);font-size:10px">${r.target ? '≤ ' + n0(r.target.max) + '%' : ''}</td></tr>`;
      });
      if (s.costPerHireMom) body += `<tr class="calc"><td>Вартість 1 закритої позиції <span style="font-size:9.5px">(розрах., зміна, %)</span></td>${M.map((_, k) => { const m = s.costPerHireMom[k]; return `<td>${m == null ? '—' : `<span style="color:${m > 0 ? Y : GD}">${sgn(m)}${n0(Math.abs(m))}%</span>`}</td>`; }).join('')}<td></td></tr>`;
    });
    const calc = [
      ['Прийнято всього (ЛП + адмінка)', k => sum(R_.hLP, R_.hAdm, k)],
      ['Чистий приріст (прийнято − звільнено)', k => { const h = sum(R_.hLP, R_.hAdm, k), f = v(R_.fired, k); return h == null || f == null ? null : h - f; }],
      ['Відкриті позиції, % від штату', k => { const o = sum(R_.oLP, R_.oAdm, k), h = v(R_.head, k); return o == null || !h ? null : +(o / h * 100).toFixed(1); }, '%'],
      ['Лікарняні на 100 співробітників', k => { const x = v(R_.sick, k), h = v(R_.head, k); return x == null || !h ? null : +(x / h * 100).toFixed(1); }],
    ];
    body += `<tr class="hs"><td colspan="${M.length + 2}">Розрахункові</td></tr>` + calc.map(([l, f, u]) => `<tr class="calc"><td>${l}</td>${M.map((_, k) => { const x = f(k); return `<td>${x == null ? '—' : (x > 0 && /приріст/.test(l) ? '+' : '') + n0(x) + (u || '')}</td>`; }).join('')}<td></td></tr>`).join('');

    const table = `<div class="c" style="margin-top:10px"><div class="h">Звіт HR — ${rep.year || ''} по місяцях</div>
      <div class="n">Дані — лист «Звіт HR» таблиці HR відділу, оновлення щогодини. Блакитне / жовте — у межах / вище цілі. Суми в гривнях і зарплати не публікуються (репозиторій дашборда публічний): для витрат показано лише зміну до попереднього місяця.</div>
      <div class="tw"><table><thead><tr><th>Показник</th>${M.map(m => `<th>${esc(m)}</th>`).join('')}<th>Ціль</th></tr></thead><tbody>${body}</tbody></table></div></div>`;

    const charts = `<div class="g2" style="margin-top:10px">
      <div class="c"><div class="h">Рух штату</div><div class="n">прийнято (ЛП, адмінка) ↑ · звільнено ↓ · лінія — штат на кінець місяця</div><div style="height:180px"><canvas id="hrr-flow"></canvas></div></div>
      <div class="c"><div class="h">Плинність проти цілей, %</div><div class="n">штат (ціль ≤ ${R_.turn && R_.turn.target ? n0(R_.turn.target.max) : '—'}%) і стажери (ціль ≤ ${R_.intern && R_.intern.target ? n0(R_.intern.target.max) : '—'}%) · пунктир — ціль</div><div style="height:180px"><canvas id="hrr-turn"></canvas></div></div></div>`;

    root.innerHTML = tiles + charts + table;
    drawCharts(rep, R_, F);
  }

  function chart(id, cfg) {
    const c = $(id); if (!c || typeof Chart === 'undefined') return;
    if (_charts[id]) { try { _charts[id].destroy(); } catch (e) {} }
    _charts[id] = new Chart(c, cfg);
  }

  function drawCharts(rep, R_, F) {
    // показуємо заповнені місяці + один наступний (видно, що він ще порожній)
    const last = F.length ? Math.min(F[F.length - 1] + 1, rep.months.length - 1) : rep.months.length - 1;
    const ks = rep.months.map((_, k) => k).filter(k => k <= last), labels = ks.map(k => SH[rep.months[k]] || rep.months[k]);
    const val = (r, k) => r && r.values ? r.values[k] : null;
    const lg = { position: 'top', labels: { usePointStyle: true, padding: 8, font: { size: 10 } } };
    const dv = c => c.dataset.data[c.dataIndex];   // у контексті datalabels немає c.raw
    const dlab = { display: c => dv(c) != null && dv(c) !== 0, anchor: 'end', align: c => dv(c) < 0 ? 'bottom' : 'top', offset: 1, font: { size: 9, weight: '700' }, color: '#3b4a44', formatter: x => x == null ? '' : Math.abs(x) };
    const inBar = { display: c => dv(c) != null && dv(c) !== 0, anchor: 'center', align: 'center', font: { size: 10, weight: '700' }, color: '#2b3a4a', formatter: x => x == null ? '' : Math.abs(x) };
    // шкали розводимо: стовпчики — у нижній частині, лінія штату — над ними (без накладання підписів)
    const pos = ks.map(k => (val(R_.hLP, k) || 0) + (val(R_.hAdm, k) || 0)), neg = ks.map(k => val(R_.fired, k) || 0);
    const hv = ks.map(k => val(R_.head, k)).filter(x => x != null), hMin = hv.length ? Math.min(...hv) : 0, hMax = hv.length ? Math.max(...hv) : 1, hR = Math.max(10, hMax - hMin);
    chart('hrr-flow', { type: 'bar', data: { labels, datasets: [
      { label: 'Прийнято — ЛП', data: ks.map(k => val(R_.hLP, k)), backgroundColor: BL, stack: 'h', borderRadius: 3, yAxisID: 'y', datalabels: inBar },
      { label: 'Прийнято — адмінка', data: ks.map(k => val(R_.hAdm, k)), backgroundColor: BL2, stack: 'h', borderRadius: 3, yAxisID: 'y', datalabels: inBar },
      { label: 'Звільнено', data: ks.map(k => { const x = val(R_.fired, k); return x == null ? null : -x; }), backgroundColor: YL, stack: 'h', borderRadius: 3, yAxisID: 'y', datalabels: inBar },
      { label: 'Штат', type: 'line', data: ks.map(k => val(R_.head, k)), borderColor: BLD, backgroundColor: BLD, borderWidth: 2, pointRadius: 3, tension: .25, yAxisID: 'y1', spanGaps: false,
        datalabels: { display: c => dv(c) != null, align: 'top', offset: 3, font: { size: 9, weight: '700' }, color: BLD, backgroundColor: 'rgba(255,255,255,.85)', borderRadius: 3, padding: { top: 1, bottom: 1, left: 3, right: 3 } } },
    ] }, plugins: window.ChartDataLabels ? [ChartDataLabels] : [],
    options: { responsive: true, maintainAspectRatio: false, layout: { padding: { top: 14 } }, interaction: { mode: 'index', intersect: false },
      plugins: { legend: lg, tooltip: { callbacks: { label: c => c.raw == null ? null : ` ${c.dataset.label}: ${Math.abs(c.raw)}` } } },
      scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, grid: { color: GRID }, ticks: { callback: x => Math.abs(x) }, title: { display: true, text: 'людей', font: { size: 9 } },
          max: Math.ceil(Math.max(...pos, 1) * 2.1), min: -Math.ceil(Math.max(...neg, 1) * 1.3) },
        y1: { position: 'right', grid: { drawOnChartArea: false }, min: Math.max(0, Math.floor(hMin - hR * 3)), max: Math.ceil(hMax + hR * 0.6), title: { display: true, text: 'штат', font: { size: 9 } } } } } });

    const tline = (r, c) => r && r.target ? [{ label: `ціль ${r === R_.turn ? 'штат' : 'стажери'} ≤ ${r.target.max}%`, type: 'line', data: ks.map(() => r.target.max), borderColor: c, borderDash: [5, 4], borderWidth: 1.2, pointRadius: 0, fill: false, datalabels: { display: false } }] : [];
    chart('hrr-turn', { type: 'bar', data: { labels, datasets: [
      { label: 'Плинність штату', data: ks.map(k => val(R_.turn, k)), backgroundColor: BL, borderRadius: 3, datalabels: Object.assign({}, dlab, { formatter: x => x == null ? '' : n0(x) + '%' }) },
      { label: 'Плинність стажерів', data: ks.map(k => val(R_.intern, k)), backgroundColor: YL, borderRadius: 3, datalabels: Object.assign({}, dlab, { formatter: x => x == null ? '' : n0(x) + '%' }) },
      ...tline(R_.turn, BLD), ...tline(R_.intern, YLD),
    ] }, plugins: window.ChartDataLabels ? [ChartDataLabels] : [],
    options: { responsive: true, maintainAspectRatio: false, layout: { padding: { top: 14 } }, plugins: { legend: lg, tooltip: { callbacks: { label: c => c.raw == null ? null : ` ${c.dataset.label}: ${n0(c.raw)}%` } } },
      scales: { x: { grid: { display: false } }, y: { beginAtZero: true, grid: { color: GRID }, ticks: { callback: x => x + '%' } } } } });
  }

  return { load };
})();
