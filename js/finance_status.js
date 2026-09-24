/**
 * finance_status.js — Easy 3D Print Dashboard v4.7
 * Вкладка «Фінанси»: матриця статусів звітів (CF / P&L / Баланс × місяці року).
 * Без сум — data/cashflow.json у публічному форматі містить лише статуси і відсотки.
 * Замінює попередній js/cashflow_loader.js (графіки у гривнях).
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

  async function load() {
    const dot = document.getElementById('fin-live-dot');
    try {
      const r = await fetch('data/cashflow.json?t=' + Date.now());
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const d = await r.json();
      render(d);
      if (dot) dot.className = 'ld ok';
      const ts = document.getElementById('cf-updated-at');
      if (ts && window.E3DFresh) ts.innerHTML = E3DFresh.html(d.fetched_at, 'CashFlow');
    } catch (e) {
      console.warn('[FIN]', e.message);
      if (dot) dot.className = 'ld err';
    }
  }

  function render(d) {
    const t = document.getElementById('fin-status-table'); if (!t) return;
    const year = d.year || 2026;
    const now = new Date();
    const curIdx = now.getFullYear() > year ? 12 : now.getMonth(); // 0-based поточний місяць
    // Фолбек для старого формату cashflow.json (до v4.7) — статус CF з months[].complete
    const reports = d.reports || { cf: { title: 'Cash Flow (CF)', months: (d.months || []).map(m => ({ month: m.month, status: m.complete === false ? 'incomplete' : 'complete' })) },
                                   pnl: { title: 'P&L', months: [] }, balance: { title: 'Баланс', months: [] } };
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
      return `<tr><td style="font-weight:700">${rep.title || title}${rep.source ? '' : key === 'cf' ? '' : ' <span style="font-weight:400;color:var(--tl);font-size:10px">(ще не ведеться)</span>'}</td>${cells}<td style="text-align:center;font-weight:700">${done}/${due}</td></tr>`;
    }).join('');
    t.innerHTML = `<thead>${head}</thead><tbody>${body}</tbody>`;
    const lg = document.getElementById('fin-status-legend');
    if (lg) lg.innerHTML = ['complete', 'incomplete', 'none'].map(k => `<span><span style="display:inline-block;min-width:18px;text-align:center;background:${ST[k].bg};border-radius:3px">${ST[k].icon}</span> ${ST[k].label}</span>`).join('') +
      (d.last_month ? `<span>Останній повний місяць CF: <b>${d.last_month}</b></span>` : '');
  }

  return { load };
})();
