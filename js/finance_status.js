/**
 * finance_status.js — Easy 3D Print Dashboard v4.10
 * Вкладка «Фінанси»:
 *  1) матриця статусів звітів (CF / P&L / Баланс × місяці року);
 *  2) v4.10: P&L Easy (перше наближення) — ТІЛЬКИ відносні показники з data/pnl.json.
 * Без сум — cashflow.json і pnl.json у публічному форматі містять лише статуси і відсотки.
 */
window.CashflowLoader = (() => {
  const ST = {
    complete:   { icon: '✅', label: 'сформовано', bg: 'rgba(42,157,143,.12)' },
    incomplete: { icon: '⏳', label: 'неповний (сірий у CF)', bg: 'rgba(158,158,158,.18)' },
    none:       { icon: '—',  label: 'не сформовано', bg: 'transparent' },
    future:     { icon: '',   label: 'ще не настав', bg: 'transparent' },
  };
  const SHORT = ['Січ', 'Лют', 'Бер', 'Кві', 'Тра', 'Чер', 'Лип', 'Сер', 'Вер', 'Жов', 'Лис', 'Гру'];
  const FULL = ['Січень', 'Лютий', 'Березень', 'Квітень', 'Травень', 'Червень', 'Липень', 'Серпень', 'Вересень', 'Жовтень', 'Листопад', 'Грудень'];
  // Палітри перевірені валідатором (світла і темна тема, CVD/контраст)
  const C_MARGIN = { gross: '#0F9483', ebitda: '#2563C9', net: '#B8741A' };
  const C_COST = { cogs: '#C0392B', personnel: '#2563C9', production: '#B8741A', commadmin: '#8A5CC2' };

  const getJSON = url => fetch(url + '?t=' + Date.now()).then(r => (r.ok ? r.json() : null)).catch(() => null);

  async function load() {
    const dot = document.getElementById('fin-live-dot');
    const [cf, pnl] = await Promise.all([getJSON('data/cashflow.json'), getJSON('data/pnl.json')]);
    if (!cf && !pnl) { if (dot) dot.className = 'ld err'; return; }
    try {
      if (cf) render(cf, pnl);
      if (pnl) renderPnl(pnl);
      if (dot) dot.className = 'ld ok';
      const ts = document.getElementById('cf-updated-at');
      if (ts && window.E3DFresh) ts.innerHTML = E3DFresh.html([cf && { ts: cf.fetched_at, label: 'CashFlow' }, pnl && { ts: pnl.fetched_at, label: 'P&L' }].filter(Boolean));
    } catch (e) {
      console.warn('[FIN]', e.message);
      if (dot) dot.className = 'ld err';
    }
  }

  function render(d, pnl) {
    const t = document.getElementById('fin-status-table'); if (!t) return;
    const year = d.year || 2026;
    const now = new Date();
    const curIdx = now.getFullYear() > year ? 12 : now.getMonth(); // 0-based поточний місяць
    // Фолбек для старого формату cashflow.json (до v4.7) — статус CF з months[].complete
    const reports = d.reports || { cf: { title: 'Cash Flow (CF)', months: (d.months || []).map(m => ({ month: m.month, status: m.complete === false ? 'incomplete' : 'complete' })) },
                                   pnl: { title: 'P&L', months: [] }, balance: { title: 'Баланс', months: [] } };
    // v4.10: P&L ведеться в окремій книзі PnL_Easy → статус з pnl.json
    if (pnl && pnl.report) reports.pnl = pnl.report;
    const rows = [['cf', 'Cash Flow (CF)'], ['pnl', 'P&L'], ['balance', 'Баланс']];
    const head = '<tr><th>Звіт</th>' + SHORT.map((m, i) => `<th style="text-align:center;${i === curIdx ? 'color:var(--tx)' : ''}">${m}</th>`).join('') + '<th style="text-align:center">Готово</th></tr>';
    const body = rows.map(([key, title]) => {
      const rep = reports[key] || { months: [] };
      const st = {}; (rep.months || []).forEach(m => { st[m.month] = m.status; });
      let done = 0;
      const cells = FULL.map((m, i) => {
        let s = st[m] || 'none';
        if (i > curIdx && s === 'none') s = 'future';
        if (s === 'complete') done++;
        const c = ST[s];
        return `<td style="text-align:center;background:${c.bg};font-size:14px" title="${m}: ${c.label}">${c.icon}</td>`;
      }).join('');
      const due = Math.min(curIdx, 12); // місяців, що вже мали б бути закриті
      const tag = key === 'pnl' && rep.source ? ' <span style="font-weight:400;color:var(--tl);font-size:10px">(v1 · перше наближення)</span>'
        : (rep.source || key === 'cf') ? '' : ' <span style="font-weight:400;color:var(--tl);font-size:10px">(ще не ведеться)</span>';
      return `<tr><td style="font-weight:700">${rep.title || title}${tag}</td>${cells}<td style="text-align:center;font-weight:700">${done}/${due}</td></tr>`;
    }).join('');
    t.innerHTML = `<thead>${head}</thead><tbody>${body}</tbody>`;
    const lg = document.getElementById('fin-status-legend');
    if (lg) lg.innerHTML = ['complete', 'incomplete', 'none'].map(k => `<span><span style="display:inline-block;min-width:18px;text-align:center;background:${ST[k].bg};border-radius:3px">${ST[k].icon}</span> ${ST[k].label}</span>`).join('') +
      (d.last_month ? `<span>Останній повний місяць CF: <b>${d.last_month}</b></span>` : '');
  }

  // ── P&L ────────────────────────────────────────────────────────────────
  const fp = v => (v == null ? '—' : v.toFixed(1) + '%');
  const tone = (v, good, ok) => (v == null ? 'var(--tl)' : v >= good ? 'var(--g)' : v >= ok ? 'var(--amb)' : 'var(--red)');
  const toneLow = (v, good, ok) => (v == null ? 'var(--tl)' : v <= good ? 'var(--g)' : v <= ok ? 'var(--amb)' : 'var(--red)');

  function renderPnl(p) {
    const root = document.getElementById('fin-pnl'); if (!root) return;
    root.style.display = '';
    const y = p.ytd || {};
    const set = (id, v, color, title) => { const el = document.getElementById(id); if (!el) return; el.textContent = v; if (color) el.style.color = color; if (title) el.title = title; };
    set('pnl-period', y.period ? `YTD ${y.period} · ${y.months_count} повн. міс.` : '');
    set('pnl-gm', fp(y.gross_margin_pct), tone(y.gross_margin_pct, 60, 40));
    set('pnl-ebitda', fp(y.ebitda_pct), tone(y.ebitda_pct, 30, 15));
    set('pnl-ebit', fp(y.ebit_pct), tone(y.ebit_pct, 30, 15));
    set('pnl-net', fp(y.net_pct), tone(y.net_pct, 20, 10));
    set('pnl-net-vat', fp(y.net_after_vat_pct), tone(y.net_after_vat_pct, 20, 10));
    set('pnl-opex', fp(y.opex_pct), toneLow(y.opex_pct, 30, 40));
    set('pnl-cogs', fp(y.cogs_pct), toneLow(y.cogs_pct, 35, 50));
    set('pnl-personnel', fp(y.personnel_pct), toneLow(y.personnel_pct, 15, 20));
    set('pnl-tax', fp(y.tax_burden_pct));
    set('pnl-capex', fp(y.capex_cash_pct));
    set('pnl-profit-months', y.months_count ? `${y.profitable_months} з ${y.months_count}` : '—', y.profitable_months === y.months_count ? 'var(--g)' : 'var(--amb)');
    set('pnl-unclass', fp(y.unclassified_share_of_opex_pct), toneLow(y.unclassified_share_of_opex_pct, 5, 10),
      'Частка «Інших витрат (потребує уточнення категорії)» — CF розд. 17 — в операційних витратах. Чим менше, тим точніший P&L.');
    set('pnl-recon', y.recon_ok_all ? '✅ 0 розбіжностей' : '⚠ є розбіжності', y.recon_ok_all ? 'var(--g)' : 'var(--red)',
      'Блок «Звірка з CashFlow» у P&L: сума врахованих статей = РАЗОМ розділів CF по кожному місяцю');
    const built = document.getElementById('pnl-built'); if (built) built.textContent = p.pnl_built_at ? `P&L перераховано: ${p.pnl_built_at}` : '';

    const months = (p.months || []);
    const done = months.filter(m => m.complete);
    const labels = months.map(m => m.month.slice(0, 3) + (m.complete ? '' : '*'));
    const LBL = window.ChartDataLabels;
    // 1) Маржинальність по місяцях — одна вісь (% доходу), три лінії, неповні місяці без значень
    if (typeof safeChart === 'function') {
      const line = (label, key, color) => ({ label, data: months.map(m => m[key]), borderColor: color, backgroundColor: color, borderWidth: 2, tension: 0.3, pointRadius: 4, pointHoverRadius: 6, spanGaps: false, fill: false });
      safeChart('pnl-margin-chart', { type: 'line', data: { labels, datasets: [
        line('Валова маржа', 'gross_margin_pct', C_MARGIN.gross),
        line('EBITDA-маржа', 'ebitda_pct', C_MARGIN.ebitda),
        line('Чиста маржа', 'net_pct', C_MARGIN.net),
      ] }, options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
        plugins: { legend: { position: 'top', labels: { usePointStyle: true, padding: 10, font: { size: 10 } } }, datalabels: { display: false },
          tooltip: { callbacks: { label: c => `${c.dataset.label}: ${c.parsed.y != null ? c.parsed.y.toFixed(1) + '%' : 'неповний місяць'}` } } },
        scales: { x: { grid: { color: (typeof GRID !== 'undefined' ? GRID : '#f0f2ee') } }, y: { grid: { color: (typeof GRID !== 'undefined' ? GRID : '#f0f2ee') }, ticks: { callback: v => v + '%' } } } } });

      // 2) Структура витрат у % доходу — stacked bar, повні місяці
      const bar = (label, key, color) => ({ label, data: done.map(m => m[key]), backgroundColor: color, borderColor: 'transparent', borderWidth: 0, borderRadius: 2, stack: 's', borderSkipped: false });
      safeChart('pnl-cost-chart', { type: 'bar', plugins: LBL ? [LBL] : [], data: { labels: done.map(m => m.month.slice(0, 3)), datasets: [
        bar('Собівартість', 'cogs_pct', C_COST.cogs),
        bar('Персонал', 'personnel_pct', C_COST.personnel),
        bar('Виробничі', 'production_pct', C_COST.production),
        bar('Комерц. та адмін.', 'commadmin_pct', C_COST.commadmin),
      ] }, options: { responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'top', labels: { usePointStyle: true, padding: 10, font: { size: 10 } } },
          datalabels: LBL ? { display: c => (c.dataset.data[c.dataIndex] || 0) >= 8, color: '#fff', font: { size: 9, weight: '700' }, formatter: v => Math.round(v) + '%' } : { display: false },
          tooltip: { callbacks: { label: c => `${c.dataset.label}: ${c.parsed.y != null ? c.parsed.y.toFixed(1) + '%' : '—'} доходу` } } },
        scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, grid: { color: (typeof GRID !== 'undefined' ? GRID : '#f0f2ee') }, ticks: { callback: v => v + '%' } } } } });
    }

    // 3) Таблиця по місяцях (також — текстова альтернатива графікам)
    const tb = document.getElementById('pnl-table');
    if (tb) {
      const cols = [['gross_margin_pct', 'Валова'], ['ebitda_pct', 'EBITDA'], ['net_pct', 'Чиста'], ['net_after_vat_pct', 'Чиста після ПДВ'],
        ['cogs_pct', 'Собів.'], ['opex_pct', 'OpEx'], ['personnel_pct', 'Персонал'], ['marketing_pct', 'Маркет.'], ['drukar_share_of_cogs_pct', 'Філамент Друкаря у собів.']];
      const cell = (v, neg) => `<td style="text-align:right;${neg && v != null && v < 0 ? 'color:var(--red);font-weight:700' : ''}">${fp(v)}</td>`;
      const rowsHtml = months.map(m => `<tr style="${m.complete ? '' : 'color:var(--tl)'}"><td>${m.month}${m.complete ? '' : ' ⏳'}</td>${cols.map(([k], i) => cell(m[k], i < 4)).join('')}<td style="text-align:center">${m.recon_ok ? '✅' : '⚠'}</td></tr>`).join('');
      const ytdRow = `<tr style="font-weight:700;border-top:2px solid var(--bd)"><td>YTD</td>${cols.map(([k], i) => cell(y[k], i < 4)).join('')}<td style="text-align:center">${y.recon_ok_all ? '✅' : '⚠'}</td></tr>`;
      tb.innerHTML = `<thead><tr><th>Місяць</th>${cols.map(([, h]) => `<th style="text-align:right">${h}</th>`).join('')}<th style="text-align:center">Звірка з CF</th></tr></thead><tbody>${rowsHtml}${ytdRow}</tbody>`;
    }
    const meth = document.getElementById('pnl-method');
    if (meth && p.method) meth.innerHTML = `<b>Як рахується (v1):</b> собівартість — ${p.method.cogs}; амортизація — ${p.method.amortization}; податок на прибуток — ${p.method.profit_tax}; ${p.method.vat}. Неповні місяці (⏳) у YTD не входять.`;
  }

  return { load };
})();
