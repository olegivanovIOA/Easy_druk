/**
 * cashflow_loader.js — Easy 3D Print Dashboard v4.4
 * Правки: без дивідендів, неповні місяці виключені з графіків,
 * підписи значень на графіках (Chart.js datalabels).
 */
window.CashflowLoader = (() => {
  const DATA_URL = 'data/cashflow.json';
  let _data = null;
  let _charts = {};

  const G = '#2A9D8F', GD = '#1e7a6e', A = '#457B9D', R = '#C0392B';
  const GB = 'rgba(42,157,143,.15)', RB = 'rgba(192,57,43,.1)';
  const GRID = '#f0f2ee';

  // Datalabels плагін — підключаємо локально тільки де потрібно
  const DL = window.ChartDataLabels || null;

  async function load() {
    try {
      const r = await fetch(DATA_URL + '?t=' + Date.now());
      if (!r.ok) throw new Error('HTTP ' + r.status);
      _data = await r.json();
      render();
    } catch(e) {
      console.warn('[CF]', e.message);
      const el = document.getElementById('cf-status');
      if (el) el.innerHTML = `⚠ CF дані недоступні: ${e.message}.<br>
        <span style="font-size:10px">Переконайтеся що SA <code>easy3d-dashboard@ts-alpha.iam.gserviceaccount.com</code>
        має доступ Viewer до таблиці CF.</span>`;
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
    _renderUnitEconomics();
    _updateTimestamp();
  }

  // Повні місяці для графіків (complete === true)
  const completedMonths = () => (_data.months || []).filter(m => m.complete !== false);

  const fmt = (n, type='grn') => {
    if (n == null) return '—';
    if (type === 'pct') return n.toFixed(1) + '%';
    if (Math.abs(n) >= 1e6) return (n/1e6).toFixed(1) + 'M грн';
    if (Math.abs(n) >= 1e3) return (n/1e3).toFixed(0) + 'K грн';
    return Math.round(n).toLocaleString('uk-UA') + ' грн';
  };

  const fmtShort = n => {
    if (n == null || n === 0) return '';
    if (Math.abs(n) >= 1e6) return (n/1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return (n/1e3).toFixed(0) + 'K';
    return Math.round(n).toString();
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

  // ── Загальні налаштування datalabels ─────────────────────────────────────
  const dlBase = {
    anchor: 'end', align: 'top',
    font: { size: 9, weight: '600' },
    color: 'var(--tx)',
    formatter: (v) => v ? fmtShort(v) : '',
    padding: 2,
  };

  // ── KPI ───────────────────────────────────────────────────────────────────
  function _renderKPI() {
    const ytd  = _data.ytd  || {};
    const months = _data.months || [];
    // Останній ПОВНИЙ місяць
    const last = completedMonths().slice(-1)[0] || {};

    // YTD — без дивідендів
    set('cf-rev-ytd',    fmt(ytd.revenue));
    set('cf-ebitda-ytd', fmt(ytd.ebitda));
    set('cf-ebitda-pct', ytd.ebitda_pct != null ? ytd.ebitda_pct.toFixed(1)+'%' : '—',
        colorPct(ytd.ebitda_pct, 40, 20));
    set('cf-capex-ytd',  fmt(ytd.capex));
    set('cf-delta-ytd',  fmt(ytd.net_delta),
        ytd.net_delta != null ? (ytd.net_delta >= 0 ? GD : R) : undefined);

    // Поточний місяць
    set('cf-rev-last',    fmt(last.revenue));
    set('cf-gm-last',     last.gross_margin_pct != null ? last.gross_margin_pct.toFixed(1)+'%' : '—',
        colorPct(last.gross_margin_pct, 50, 30));
    set('cf-ebitda-last', last.ebitda_pct != null ? last.ebitda_pct.toFixed(1)+'%' : '—',
        colorPct(last.ebitda_pct, 40, 20));
    set('cf-balance',     fmt(_data.last_balance),
        _data.last_balance != null ? (_data.last_balance >= 0 ? GD : R) : undefined);
    set('cf-top2-last',   last.top2_concentration_pct != null
        ? last.top2_concentration_pct.toFixed(0)+'%' : '—',
        colorPct(100-(last.top2_concentration_pct||100), 30, 10));
    set('cf-marketing-pct', last.marketing_pct != null ? last.marketing_pct.toFixed(2)+'%' : '—');

    // Назва останнього місяця в заголовку
    const hdr = document.getElementById('cf-last-month-label');
    if (hdr && _data.last_month) hdr.textContent = _data.last_month;
  }

  // ── Виручка по місяцях ────────────────────────────────────────────────────
  function _renderRevenueTrend() {
    const canvas = document.getElementById('cf-revenue-chart');
    if (!canvas) return;
    const months = completedMonths();
    const labels = months.map(m => m.month.substring(0,3));

    const plugins = DL ? [DL] : [];
    if (_charts.rev) { try { _charts.rev.destroy(); } catch(e){} }
    _charts.rev = new Chart(canvas, {
      type: 'bar',
      plugins,
      data: { labels, datasets: [
        { label: 'ОПТ B2B',
          data: months.map(m => m.opt_b2b ? +(m.opt_b2b/1e6).toFixed(2) : null),
          backgroundColor: 'rgba(42,157,143,.8)', borderRadius: 4, stack: 's' },
        { label: 'Роздріб B2C',
          data: months.map(m => m.retail_b2c ? +(m.retail_b2c/1e6).toFixed(2) : null),
          backgroundColor: 'rgba(69,123,157,.75)', borderRadius: 4, stack: 's' },
        { label: 'Delta (CF)',
          data: months.map(m => m.delta ? +(m.delta/1e6).toFixed(2) : null),
          type: 'line', borderWidth: 2, tension: 0.3, fill: false,
          pointRadius: 5,
          borderColor: months.map(m => (m.delta||0) >= 0 ? GD : R),
          pointBackgroundColor: months.map(m => (m.delta||0) >= 0 ? GD : R),
          segment: { borderColor: ctx => ctx.p0.parsed.y >= 0 ? GD : R },
          yAxisID: 'y1',
          datalabels: DL ? {
            ...dlBase, yAxisID: 'y1',
            align: ctx => ctx.dataset.data[ctx.dataIndex] >= 0 ? 'top' : 'bottom',
            color: ctx => ctx.dataset.data[ctx.dataIndex] >= 0 ? GD : R,
            formatter: v => v ? (v > 0 ? '+' : '') + fmtShort(v*1e6) : '',
          } : { display: false },
        },
      ]},
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { position: 'top', labels: { usePointStyle: true, padding: 10, font: { size: 10 } } },
          datalabels: DL ? {
            display: ctx => ctx.datasetIndex < 2, // тільки bar datasets
            ...dlBase,
            formatter: (v, ctx) => {
              // Показуємо підпис тільки для топового стовпця (ОПТ)
              if (ctx.datasetIndex === 0) {
                const total = (ctx.chart.data.datasets[0].data[ctx.dataIndex]||0) +
                              (ctx.chart.data.datasets[1].data[ctx.dataIndex]||0);
                return total ? fmtShort(total * 1e6) : '';
              }
              return '';
            },
            anchor: 'end', align: 'top',
          } : { display: false },
        },
        scales: {
          x: { stacked: true, grid: { display: false } },
          y:  { stacked: true, grid: { color: GRID },
                ticks: { callback: v => v+'M' },
                title: { display: true, text: 'M грн', font: { size: 9 }, color: GD } },
          y1: { position: 'right', grid: { drawOnChartArea: false },
                ticks: { callback: v => v+'M' },
                title: { display: true, text: 'Delta', font: { size: 9 } } },
        }
      }
    });
  }

  // ── EBITDA тренд ──────────────────────────────────────────────────────────
  function _renderEbitdaTrend() {
    const canvas = document.getElementById('cf-ebitda-chart');
    if (!canvas) return;
    const months = completedMonths();
    const labels = months.map(m => m.month.substring(0,3));

    const plugins = DL ? [DL] : [];
    if (_charts.ebitda) { try { _charts.ebitda.destroy(); } catch(e){} }
    _charts.ebitda = new Chart(canvas, {
      type: 'line',
      plugins,
      data: { labels, datasets: [
        { label: 'EBITDA, M грн',
          data: months.map(m => m.ebitda ? +(m.ebitda/1e6).toFixed(2) : null),
          borderColor: G, backgroundColor: GB, borderWidth: 2.5,
          tension: 0.3, fill: true, pointRadius: 5, pointBackgroundColor: G,
          datalabels: DL ? { ...dlBase, color: GD, formatter: v => v ? fmtShort(v*1e6) : '' } : { display: false },
        },
        { label: 'EBITDA %',
          data: months.map(m => m.ebitda_pct),
          borderColor: A, borderWidth: 2, borderDash: [5,3],
          tension: 0.3, fill: false, pointRadius: 3, pointBackgroundColor: A,
          yAxisID: 'y1',
          datalabels: DL ? { ...dlBase, color: A, formatter: v => v != null ? v.toFixed(0)+'%' : '' } : { display: false },
        },
      ]},
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { position: 'top', labels: { usePointStyle: true, padding: 10, font: { size: 10 } } },
          datalabels: DL ? { display: true } : { display: false },
        },
        scales: {
          x: { grid: { color: GRID } },
          y:  { grid: { color: GRID }, ticks: { callback: v => v+'M' },
                title: { display: true, text: 'EBITDA (M)', font: { size: 9 }, color: GD } },
          y1: { position: 'right', grid: { drawOnChartArea: false },
                ticks: { callback: v => v+'%' },
                title: { display: true, text: 'EBITDA %', font: { size: 9 }, color: A } },
        }
      }
    });
  }

  // ── Структура витрат ──────────────────────────────────────────────────────
  function _renderCostBreakdown() {
    const canvas = document.getElementById('cf-costs-chart');
    if (!canvas) return;
    const months = completedMonths();
    const labels = months.map(m => m.month.substring(0,3));

    const ITEMS = [
      { key:'cogs',      label:'Сировина',  color:'rgba(42,157,143,.75)'  },
      { key:'salary',    label:'ЗП',        color:'rgba(69,123,157,.75)'  },
      { key:'electro',   label:'Електро',   color:'rgba(183,142,42,.7)'   },
      { key:'rent',      label:'Оренда',    color:'rgba(130,100,160,.7)'  },
      { key:'taxes',     label:'Податки',   color:'rgba(192,57,43,.6)'    },
      { key:'marketing', label:'Маркетинг', color:'rgba(100,160,100,.7)'  },
      { key:'admin',     label:'Адмін',     color:'rgba(150,150,150,.6)'  },
    ];

    const plugins = DL ? [DL] : [];
    if (_charts.costs) { try { _charts.costs.destroy(); } catch(e){} }
    _charts.costs = new Chart(canvas, {
      type: 'bar',
      plugins,
      data: { labels, datasets: ITEMS.map((it, idx) => ({
        label: it.label,
        data: months.map(m => m[it.key] ? +(m[it.key]/1e6).toFixed(2) : null),
        backgroundColor: it.color, borderRadius: 2,
        // Підпис % на кожному сегменті — тільки якщо сегмент помітний (≥6% від суми місяця)
        datalabels: DL ? {
          anchor: 'center', align: 'center',
          font: { size: 8, weight: '700' },
          color: '#fff',
          textStrokeColor: 'rgba(0,0,0,.35)', textStrokeWidth: 2,
          formatter: (v, ctx) => {
            if (!v) return '';
            const total = ITEMS.reduce((s, it2, i) =>
              s + (ctx.chart.data.datasets[i].data[ctx.dataIndex] || 0), 0);
            const pct = total ? v / total * 100 : 0;
            return pct >= 6 ? Math.round(pct) + '%' : '';
          },
        } : { display: false },
      }))},
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { position: 'top', labels: { usePointStyle: true, padding: 6, font: { size: 9 } } },
          tooltip: {
            callbacks: {
              label: ctx => {
                const total = ITEMS.reduce((s, it2, i) =>
                  s + (ctx.chart.data.datasets[i].data[ctx.dataIndex] || 0), 0);
                const v = ctx.parsed.y || 0;
                const pct = total ? Math.round(v/total*100) : 0;
                return `${ctx.dataset.label}: ${v.toFixed(2)}M (${pct}%)`;
              }
            }
          },
          datalabels: DL ? { display: true } : { display: false },
        },
        scales: {
          x: { stacked: true, grid: { display: false } },
          y: { stacked: true, grid: { color: GRID }, ticks: { callback: v => v+'M' } },
        }
      }
    });
  }

  // ── Залишок + CAPEX ───────────────────────────────────────────────────────
  function _renderCashBalance() {
    const canvas = document.getElementById('cf-balance-chart');
    if (!canvas) return;
    const months = completedMonths();
    const labels = months.map(m => m.month.substring(0,3));

    const plugins = DL ? [DL] : [];
    if (_charts.balance) { try { _charts.balance.destroy(); } catch(e){} }
    _charts.balance = new Chart(canvas, {
      type: 'line',
      plugins,
      data: { labels, datasets: [
        { label: 'Залишок кінець',
          data: months.map(m => m.balance_end ? +(m.balance_end/1e6).toFixed(2) : null),
          borderColor: G, backgroundColor: GB, borderWidth: 2.5,
          tension: 0.3, fill: true, pointRadius: 5, pointBackgroundColor: G,
          datalabels: DL ? { ...dlBase, color: GD, formatter: v => v != null ? fmtShort(v*1e6) : '' } : { display: false },
        },
        { label: 'CAPEX',
          data: months.map(m => m.capex ? +(m.capex/1e6).toFixed(2) : null),
          borderColor: R, borderWidth: 2, borderDash: [5,3],
          tension: 0.3, fill: false, pointRadius: 3, pointBackgroundColor: R,
          datalabels: DL ? { ...dlBase, color: R, align: 'bottom', formatter: v => v ? fmtShort(v*1e6) : '' } : { display: false },
        },
      ]},
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { position: 'top', labels: { usePointStyle: true, padding: 10, font: { size: 10 } } },
          datalabels: DL ? { display: true } : { display: false },
        },
        scales: {
          x: { grid: { color: GRID } },
          y: { grid: { color: GRID }, ticks: { callback: v => v+'M' } },
        }
      }
    });
  }

  // ── Концентрація топ-2 ────────────────────────────────────────────────────
  function _renderClientConcentration() {
    const canvas = document.getElementById('cf-clients-chart');
    if (!canvas) return;
    // Фільтруємо: тільки повні місяці З даними клієнтів і нормальною кількістю (>20)
    const months = completedMonths().filter(m =>
      m.top2_concentration_pct != null && (m.clients_count == null || m.clients_count > 20)
    );
    const labels = months.map(m => m.month.substring(0,3));

    const plugins = DL ? [DL] : [];
    if (_charts.clients) { try { _charts.clients.destroy(); } catch(e){} }
    _charts.clients = new Chart(canvas, {
      type: 'line',
      plugins,
      data: { labels, datasets: [
        { label: 'Концентрація топ-2 %',
          data: months.map(m => m.top2_concentration_pct),
          borderColor: R, backgroundColor: RB, borderWidth: 2.5,
          tension: 0.3, fill: true, pointRadius: 5, pointBackgroundColor: R,
          datalabels: DL ? { ...dlBase, color: R, formatter: v => v != null ? v.toFixed(0)+'%' : '' } : { display: false },
        },
        { label: 'Клієнтів',
          data: months.map(m => m.clients_count),
          borderColor: G, borderWidth: 2, tension: 0.3,
          fill: false, pointRadius: 3, pointBackgroundColor: G,
          yAxisID: 'y1',
          datalabels: DL ? { ...dlBase, color: GD, align: 'bottom', formatter: v => v || '' } : { display: false },
        },
        { label: 'Ціль ≤70%',
          data: labels.map(() => 70),
          borderColor: 'rgba(69,123,157,.4)', borderWidth: 1.5,
          borderDash: [8,4], pointRadius: 0, fill: false,
          datalabels: { display: false },
        },
      ]},
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { position: 'top', labels: { usePointStyle: true, padding: 10, font: { size: 10 } } },
          datalabels: DL ? { display: true } : { display: false },
        },
        scales: {
          x: { grid: { color: GRID } },
          y:  { min: 0, max: 105, grid: { color: GRID }, ticks: { callback: v => v+'%' } },
          y1: { position: 'right', beginAtZero: false,
                grid: { drawOnChartArea: false },
                title: { display: true, text: 'Клієнтів', font: { size: 9 }, color: G } },
        }
      }
    });
  }

  // ── Маркетинг / Виручка ───────────────────────────────────────────────────
  function _renderMarketingROI() {
    const el = document.getElementById('cf-mkt-list');
    if (!el) return;
    const months = completedMonths();
    el.innerHTML = `<div style="display:flex;gap:8px;align-items:flex-end;height:70px;padding:4px 0">
      ${months.map(m => {
        const pct = m.marketing_pct;
        const barH = pct ? Math.min(pct / 3 * 100, 100) : 4;
        const color = !pct ? 'var(--bd)' : pct < 1 ? GD : pct < 2 ? A : R;
        return `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:4px;height:100%;justify-content:flex-end">
          <div style="font-size:9px;color:${color};font-weight:700">${pct != null ? pct.toFixed(1)+'%' : '—'}</div>
          <div style="width:100%;max-width:28px;height:${barH}%;background:${color};border-radius:3px 3px 0 0;min-height:3px" title="${m.month}: ${pct != null ? pct.toFixed(2)+'%' : '—'} (${m.marketing ? Math.round(m.marketing/1e3)+'K грн' : '—'})"></div>
          <div style="font-size:9px;color:var(--tl)">${m.month.substring(0,3)}</div>
        </div>`;
      }).join('')}
    </div>`;
  }

  // ── Юніт-економіка: виручка/маркетинг на клієнта, CAPEX на локацію ────────
  function _renderUnitEconomics() {
    const ytd = _data.ytd || {};
    const done = completedMonths();
    // Клієнтів беремо з останнього місяця де кількість "нормальна" (>20, бо липень
    // часто має неповні дані по клієнтах навіть якщо CF вже complete)
    const withClients = done.filter(m => m.clients_count && m.clients_count > 20);
    const lastClients = withClients.length ? withClients[withClients.length - 1].clients_count : null;

    const revPerClient = (ytd.revenue && lastClients) ? ytd.revenue / lastClients : null;
    const mktPerClient = (ytd.marketing && lastClients) ? ytd.marketing / lastClients : null;
    const capexPerLoc  = ytd.capex ? ytd.capex / 5 : null; // 5 активних локацій

    set('cf-rev-per-client', revPerClient != null ? fmt(revPerClient) : '—');
    set('cf-mkt-per-client', mktPerClient != null ? fmt(mktPerClient) : '—');
    set('cf-capex-per-loc',  capexPerLoc  != null ? fmt(capexPerLoc)  : '—');
  }

  function _updateTimestamp() {
    const el = document.getElementById('cf-updated-at');
    if (!el || !_data?.fetched_at) return;
    try {
      const d = new Date(_data.fetched_at);
      el.textContent = 'CF: ' + d.toLocaleString('uk-UA', {
        timeZone:'Europe/Kyiv', day:'2-digit', month:'2-digit',
        hour:'2-digit', minute:'2-digit'
      });
    } catch(e){}
  }

  return { load };
})();
