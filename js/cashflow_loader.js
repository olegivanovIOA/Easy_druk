/**
 * cashflow_loader.js — Easy 3D Print Dashboard v4.4
 * Читає data/cashflow.json і рендерить вкладку Фінанси.
 * Джерело: CF_2026 Google Sheets (автоматично оновлюється)
 */
window.CashflowLoader = (() => {
  const DATA_URL = 'data/cashflow.json';
  let _data = null;
  let _charts = {};

  const G = '#2A9D8F', GD = '#1e7a6e', A = '#457B9D', R = '#C0392B';
  const GB = 'rgba(42,157,143,.15)', AB = 'rgba(69,123,157,.15)', RB = 'rgba(192,57,43,.1)';
  const GRID = '#f0f2ee';

  async function load() {
    try {
      const r = await fetch(DATA_URL + '?t=' + Date.now());
      if (!r.ok) throw new Error('HTTP ' + r.status);
      _data = await r.json();
      render();
    } catch(e) {
      console.warn('[CF]', e.message);
      const el = document.getElementById('cf-status');
      if (el) el.textContent = '⚠ CF дані недоступні — ' + e.message;
    }
  }

  function render() {
    if (!_data) return;
    _renderKPI();
    _renderRevenueTrend();
    _renderEbitdaTrend();
    _renderCostBreakdown();
    _renderCashBalance();
    _renderClientConcentration();
    _renderMarketingROI();
    _updateTimestamp();
  }

  const fmt = (n, type='grn') => {
    if (n == null) return '—';
    if (type === 'pct') return n.toFixed(1) + '%';
    if (type === 'M') return (n/1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e6) return (n/1e6).toFixed(1) + 'M грн';
    if (Math.abs(n) >= 1e3) return (n/1e3).toFixed(0) + 'K грн';
    return Math.round(n).toLocaleString('uk-UA') + ' грн';
  };

  const set = (id, val, color) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = val;
    if (color) el.style.color = color;
  };

  const colorPct = (v, good, warn) => {
    if (v == null) return 'var(--tm)';
    return v >= good ? GD : v >= warn ? A : R;
  };

  // ── KPI картки ────────────────────────────────────────────────────────────
  function _renderKPI() {
    const ytd = _data.ytd || {};
    const months = _data.months || [];
    const last = months[months.length - 1] || {};

    // YTD
    set('cf-rev-ytd',    fmt(ytd.revenue));
    set('cf-ebitda-ytd', fmt(ytd.ebitda));
    set('cf-ebitda-pct', fmt(ytd.ebitda_pct, 'pct'),
        colorPct(ytd.ebitda_pct, 40, 20));
    set('cf-capex-ytd',  fmt(ytd.capex));
    set('cf-div-ytd',    fmt(ytd.dividends));
    set('cf-delta-ytd',  fmt(ytd.net_delta),
        ytd.net_delta >= 0 ? GD : R);

    // Поточний місяць
    set('cf-rev-last',   fmt(last.revenue));
    set('cf-gm-last',    fmt(last.gross_margin_pct, 'pct'),
        colorPct(last.gross_margin_pct, 50, 30));
    set('cf-ebitda-last', fmt(last.ebitda_pct, 'pct'),
        colorPct(last.ebitda_pct, 40, 20));
    set('cf-balance',    fmt(_data.last_balance),
        _data.last_balance >= 0 ? GD : R);
    set('cf-runway',     _data.runway_months != null
        ? _data.runway_months.toFixed(1) + ' міс.' : '—',
        _data.runway_months > 2 ? GD : R);
    set('cf-clients-last', last.clients_count || '—');
    set('cf-top2-last',  last.top2_concentration_pct != null
        ? last.top2_concentration_pct.toFixed(0) + '%' : '—',
        colorPct(100 - (last.top2_concentration_pct || 100), 30, 10));
    set('cf-marketing-pct', fmt(last.marketing_pct, 'pct'));
  }

  // ── Виручка по місяцях ────────────────────────────────────────────────────
  function _renderRevenueTrend() {
    const canvas = document.getElementById('cf-revenue-chart');
    if (!canvas) return;
    const months = _data.months || [];
    const labels = months.map(m => m.month.substring(0,3));

    if (_charts.rev) { try { _charts.rev.destroy(); } catch(e){} }
    _charts.rev = new Chart(canvas, {
      type: 'bar',
      data: { labels, datasets: [
        { label: 'ОПТ B2B',   data: months.map(m => (m.opt_b2b||0)/1e6),
          backgroundColor: 'rgba(42,157,143,.8)', borderRadius: 4 },
        { label: 'Роздріб B2C', data: months.map(m => (m.retail_b2c||0)/1e6),
          backgroundColor: 'rgba(69,123,157,.75)', borderRadius: 4 },
        { label: 'Net Delta', data: months.map(m => (m.delta||0)/1e6),
          type: 'line', borderColor: months.map(m => (m.delta||0) >= 0 ? GD : R),
          segment: { borderColor: ctx => ctx.p0.parsed.y >= 0 ? GD : R },
          borderWidth: 2, tension: 0.3, fill: false,
          pointRadius: 4, pointBackgroundColor: months.map(m => (m.delta||0) >= 0 ? GD : R),
          yAxisID: 'y1' },
      ]},
      options: { responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'top', labels: { usePointStyle: true, padding: 10, font: { size: 10 } } } },
        scales: {
          x: { stacked: true, grid: { display: false } },
          y:  { stacked: true, grid: { color: GRID }, ticks: { callback: v => v + 'M' },
                title: { display: true, text: 'Виручка (M грн)', font: { size: 9 }, color: GD } },
          y1: { grid: { drawOnChartArea: false }, ticks: { callback: v => v + 'M' },
                position: 'right', title: { display: true, text: 'Delta', font: { size: 9 } } },
        }
      }
    });
  }

  // ── EBITDA тренд ─────────────────────────────────────────────────────────
  function _renderEbitdaTrend() {
    const canvas = document.getElementById('cf-ebitda-chart');
    if (!canvas) return;
    const months = _data.months || [];
    const labels = months.map(m => m.month.substring(0,3));

    if (_charts.ebitda) { try { _charts.ebitda.destroy(); } catch(e){} }
    _charts.ebitda = new Chart(canvas, {
      type: 'line',
      data: { labels, datasets: [
        { label: 'EBITDA, M грн', data: months.map(m => (m.ebitda||0)/1e6),
          borderColor: G, backgroundColor: GB, borderWidth: 2.5,
          tension: 0.3, fill: true, pointRadius: 5, pointBackgroundColor: G },
        { label: 'EBITDA %', data: months.map(m => m.ebitda_pct),
          borderColor: A, borderWidth: 2, borderDash: [5,3],
          tension: 0.3, fill: false, pointRadius: 3, pointBackgroundColor: A,
          yAxisID: 'y1' },
      ]},
      options: { responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'top', labels: { usePointStyle: true, padding: 10, font: { size: 10 } } } },
        scales: {
          x: { grid: { color: GRID } },
          y:  { grid: { color: GRID }, ticks: { callback: v => v + 'M' },
                title: { display: true, text: 'EBITDA (M)', font: { size: 9 }, color: GD } },
          y1: { position: 'right', grid: { drawOnChartArea: false },
                ticks: { callback: v => v + '%' },
                title: { display: true, text: 'EBITDA %', font: { size: 9 }, color: A } },
        }
      }
    });
  }

  // ── Структура витрат по місяцях (stacked) ────────────────────────────────
  function _renderCostBreakdown() {
    const canvas = document.getElementById('cf-costs-chart');
    if (!canvas) return;
    const months = _data.months || [];
    const labels = months.map(m => m.month.substring(0,3));

    const COST_ITEMS = [
      { key: 'cogs',      label: 'Сировина',   color: 'rgba(42,157,143,.75)' },
      { key: 'salary',    label: 'ЗП',         color: 'rgba(69,123,157,.75)' },
      { key: 'electro',   label: 'Електро',    color: 'rgba(183,142,42,.7)'  },
      { key: 'rent',      label: 'Оренда',     color: 'rgba(130,100,160,.7)' },
      { key: 'taxes',     label: 'Податки',    color: 'rgba(192,57,43,.6)'   },
      { key: 'marketing', label: 'Маркетинг',  color: 'rgba(100,160,100,.7)' },
      { key: 'admin',     label: 'Адмін',      color: 'rgba(150,150,150,.6)' },
    ];

    if (_charts.costs) { try { _charts.costs.destroy(); } catch(e){} }
    _charts.costs = new Chart(canvas, {
      type: 'bar',
      data: { labels, datasets: COST_ITEMS.map(it => ({
        label: it.label,
        data: months.map(m => ((m[it.key]||0)/1e6)),
        backgroundColor: it.color, borderRadius: 3,
      }))},
      options: { responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'top', labels: { usePointStyle: true, padding: 6, font: { size: 9 } } } },
        scales: {
          x: { stacked: true, grid: { display: false } },
          y: { stacked: true, grid: { color: GRID }, ticks: { callback: v => v + 'M' } },
        }
      }
    });
  }

  // ── Залишок на рахунку + CAPEX ───────────────────────────────────────────
  function _renderCashBalance() {
    const canvas = document.getElementById('cf-balance-chart');
    if (!canvas) return;
    const months = _data.months || [];
    const labels = months.map(m => m.month.substring(0,3));

    if (_charts.balance) { try { _charts.balance.destroy(); } catch(e){} }
    _charts.balance = new Chart(canvas, {
      type: 'line',
      data: { labels, datasets: [
        { label: 'Залишок на кінець', data: months.map(m => (m.balance_end||0)/1e6),
          borderColor: G, backgroundColor: GB, borderWidth: 2.5,
          tension: 0.3, fill: true, pointRadius: 5, pointBackgroundColor: G },
        { label: 'CAPEX',
          data: months.map(m => -((m.capex||0)/1e6)),
          borderColor: R, borderWidth: 2, borderDash: [5,3],
          tension: 0.3, fill: false, pointRadius: 3, pointBackgroundColor: R },
      ]},
      options: { responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'top', labels: { usePointStyle: true, padding: 10, font: { size: 10 } } } },
        scales: {
          x: { grid: { color: GRID } },
          y: { grid: { color: GRID }, ticks: { callback: v => v + 'M' } },
        }
      }
    });
  }

  // ── Концентрація клієнтів по місяцях ─────────────────────────────────────
  function _renderClientConcentration() {
    const canvas = document.getElementById('cf-clients-chart');
    if (!canvas) return;
    const months = (_data.months || []).filter(m => m.top2_concentration_pct != null);
    const labels = months.map(m => m.month.substring(0,3));

    if (_charts.clients) { try { _charts.clients.destroy(); } catch(e){} }
    _charts.clients = new Chart(canvas, {
      type: 'line',
      data: { labels, datasets: [
        { label: 'Концентрація топ-2 %',
          data: months.map(m => m.top2_concentration_pct),
          borderColor: R, backgroundColor: RB, borderWidth: 2.5,
          tension: 0.3, fill: true, pointRadius: 5, pointBackgroundColor: R },
        { label: 'Кількість клієнтів',
          data: months.map(m => m.clients_count),
          borderColor: G, borderWidth: 2, tension: 0.3,
          fill: false, pointRadius: 3, pointBackgroundColor: G, yAxisID: 'y1' },
        // Цільова лінія 70%
        { label: 'Ціль ≤70%',
          data: labels.map(() => 70),
          borderColor: 'rgba(69,123,157,.5)', borderWidth: 1.5,
          borderDash: [8,4], pointRadius: 0, fill: false },
      ]},
      options: { responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'top', labels: { usePointStyle: true, padding: 10, font: { size: 10 } } } },
        scales: {
          x: { grid: { color: GRID } },
          y: { min: 0, max: 105, grid: { color: GRID },
               ticks: { callback: v => v + '%' } },
          y1: { position: 'right', beginAtZero: false,
                grid: { drawOnChartArea: false },
                title: { display: true, text: 'Клієнтів', font: { size: 9 }, color: G } },
        }
      }
    });
  }

  // ── Маркетинг / Виручка % ────────────────────────────────────────────────
  function _renderMarketingROI() {
    const el = document.getElementById('cf-mkt-list');
    if (!el) return;
    const months = _data.months || [];
    el.innerHTML = months.map(m => {
      const pct = m.marketing_pct;
      const abs = m.marketing;
      const barW = pct ? Math.min(pct / 3 * 100, 100) : 0;
      const color = pct < 1 ? GD : pct < 2 ? A : R;
      return `<div class="mr" style="margin-bottom:8px">
        <div class="mn" style="min-width:60px">${m.month.substring(0,3)}</div>
        <div style="flex:1;margin:0 10px">
          <div style="height:6px;background:var(--bd);border-radius:3px;overflow:hidden">
            <div style="width:${barW}%;height:100%;background:${color};border-radius:3px"></div>
          </div>
        </div>
        <div class="mv" style="color:${color};font-size:11px;min-width:40px">${pct != null ? pct.toFixed(2)+'%' : '—'}</div>
        <div style="font-size:10px;color:var(--tl);margin-left:8px;min-width:70px">${abs ? Math.round(abs/1e3)+'K грн' : ''}</div>
      </div>`;
    }).join('');
  }

  function _updateTimestamp() {
    const el = document.getElementById('cf-updated-at');
    if (!el || !_data?.fetched_at) return;
    try {
      const d = new Date(_data.fetched_at);
      el.textContent = 'CF: ' + d.toLocaleString('uk-UA', {
        timeZone: 'Europe/Kyiv', day:'2-digit', month:'2-digit',
        hour:'2-digit', minute:'2-digit'
      });
    } catch(e) {}
  }

  return { load };
})();
