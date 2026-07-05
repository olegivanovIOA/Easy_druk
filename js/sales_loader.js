/**
 * sales_loader.js — Easy 3D Print Dashboard
 * Завантажує data/sales_planner.json (генерується fetch_sales.py з Планувальника)
 * Рендерить таб Продажі: зведення + Роздріб (план/факт) + Опт (план/факт)
 */

window.SalesLoader = (() => {
  const DATA_URL = 'data/sales_planner.json';
  let _data = null;
  let _charts = {};

  const G = '#2A9D8F', GD = '#1e7a6e', A = '#457B9D', R = '#C0392B';
  const GB = 'rgba(42,157,143,.15)', AB = 'rgba(69,123,157,.15)';
  const GRID = '#f0f2ee';

  async function load() {
    try {
      const r = await fetch(DATA_URL + '?t=' + Date.now());
      if (!r.ok) throw new Error('HTTP ' + r.status);
      _data = await r.json();
      render();
    } catch (e) {
      console.warn('[SALES] Не вдалось завантажити sales_planner.json:', e);
    }
  }

  function render() {
    if (!_data) return;
    _renderSummary();
    _renderCombinedChart();
    _renderRetail();
    _renderWholesale();
    _updateTimestamp();
  }

  function _fmt(n) {
    if (n == null) return '—';
    if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(0) + 'K';
    return String(Math.round(n));
  }

  function _set(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  }

  function _renderSummary() {
    const wh = _data.wholesale || {}, rt = _data.retail || {};
    _set('sales-wh-fact', _fmt(wh.ytd_fact) + ' грн');
    _set('sales-wh-pct', (wh.ytd_pct ?? '—') + '%');
    _set('sales-rt-fact', _fmt(rt.ytd_fact) + ' грн');
    _set('sales-rt-pct', (rt.ytd_pct ?? '—') + '%');

    const leadsM = _data.leads_conversion?.monthly || [];
    const leadsLast = leadsM.length ? leadsM[leadsM.length - 1] : null;
    if (leadsLast) {
      _set('sales-leads', leadsLast.leads != null ? Math.round(leadsLast.leads) : '—');
      const convEl = document.getElementById('sales-conv');
      if (convEl) {
        if (leadsLast.conv_pct != null) {
          convEl.textContent = leadsLast.conv_pct + '%';
          convEl.style.color = leadsLast.conv_pct >= 15 ? GD : R;
        } else {
          convEl.textContent = '—';
        }
      }
    }

    const checkM = _data.avg_check?.monthly || [];
    const checkLast = checkM.length ? checkM[checkM.length - 1] : null;
    if (checkLast) _set('sales-rt-check', _fmt(checkLast.fact) + ' грн');
  }

  function _renderCombinedChart() {
    const canvas = document.getElementById('sales-combined-chart');
    if (!canvas) return;

    const whM = _data.wholesale?.monthly || [];
    const rtM = _data.retail?.monthly || [];
    if (!whM.length && !rtM.length) {
      canvas.parentElement.innerHTML = '<p style="color:var(--tl);font-size:12px;padding:1rem">Даних немає</p>';
      return;
    }
    const labels = (whM.length ? whM : rtM).map(m => m.month);

    if (_charts.combined) { try { _charts.combined.destroy(); } catch(e){} }
    _charts.combined = new Chart(canvas, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: 'ОПТ факт', data: whM.map(m => m.fact), backgroundColor: GB, borderColor: G, borderWidth: 1.5, borderRadius: 4, yAxisID: 'y' },
          { label: 'Роздріб факт', data: rtM.map(m => m.fact), backgroundColor: AB, borderColor: A, borderWidth: 1.5, borderRadius: 4, yAxisID: 'y1' },
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'top', labels: { usePointStyle: true, padding: 10 } } },
        scales: {
          x: { grid: { color: GRID } },
          y: { type: 'linear', position: 'left', grid: { color: GRID }, ticks: { callback: v => _fmt(v) }, title: { display: true, text: 'ОПТ, грн', font: { size: 9 }, color: G } },
          y1: { type: 'linear', position: 'right', grid: { drawOnChartArea: false }, ticks: { callback: v => _fmt(v) }, title: { display: true, text: 'Роздріб, грн', font: { size: 9 }, color: A } },
        }
      }
    });
  }

  function _renderRetail() {
    const canvas = document.getElementById('sales-retail-chart');
    const data = _data.retail?.monthly || [];
    if (canvas) {
      if (!data.length) {
        canvas.parentElement.innerHTML = '<p style="color:var(--tl);font-size:12px;padding:1rem">Даних немає</p>';
      } else {
        if (_charts.retail) { try { _charts.retail.destroy(); } catch(e){} }
        _charts.retail = new Chart(canvas, {
          type: 'bar',
          data: {
            labels: data.map(m => m.month),
            datasets: [
              { label: 'План', data: data.map(m => m.plan), backgroundColor: 'rgba(150,168,144,.25)', borderRadius: 4 },
              { label: 'Факт', data: data.map(m => m.fact), backgroundColor: AB, borderColor: A, borderWidth: 1.5, borderRadius: 4 },
            ]
          },
          options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { position: 'top', labels: { usePointStyle: true, padding: 8, font: { size: 10 } } } },
            scales: { x: { grid: { color: GRID } }, y: { grid: { color: GRID }, ticks: { callback: v => _fmt(v) } } }
          }
        });
      }
    }

    const tbody = document.getElementById('sales-retail-table');
    if (tbody) {
      if (!data.length) {
        tbody.innerHTML = '<tr><td colspan="4" style="padding:10px;color:var(--tl)">Даних немає</td></tr>';
      } else {
        tbody.innerHTML = data.map(m => {
          const pctColor = m.pct == null ? 'var(--tl)' : m.pct >= 90 ? GD : m.pct >= 60 ? A : R;
          return `<tr>
            <td>${m.month}</td>
            <td style="text-align:right">${_fmt(m.plan)}</td>
            <td style="text-align:right">${m.fact != null ? _fmt(m.fact) : '—'}</td>
            <td style="text-align:right;font-weight:700;color:${pctColor}">${m.pct != null ? m.pct + '%' : '—'}</td>
          </tr>`;
        }).join('');
      }
    }
  }

  function _renderWholesale() {
    const canvas = document.getElementById('sales-wholesale-chart');
    const data = _data.wholesale?.monthly || [];
    if (canvas) {
      if (!data.length) {
        canvas.parentElement.innerHTML = '<p style="color:var(--tl);font-size:12px;padding:1rem">Даних немає</p>';
      } else {
        if (_charts.wholesale) { try { _charts.wholesale.destroy(); } catch(e){} }
        _charts.wholesale = new Chart(canvas, {
          type: 'bar',
          data: {
            labels: data.map(m => m.month),
            datasets: [
              { label: 'План', data: data.map(m => m.plan), backgroundColor: 'rgba(150,168,144,.25)', borderRadius: 4 },
              { label: 'Факт', data: data.map(m => m.fact), backgroundColor: GB, borderColor: G, borderWidth: 1.5, borderRadius: 4 },
            ]
          },
          options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { position: 'top', labels: { usePointStyle: true, padding: 8, font: { size: 10 } } } },
            scales: { x: { grid: { color: GRID } }, y: { grid: { color: GRID }, ticks: { callback: v => _fmt(v) } } }
          }
        });
      }
    }

    const tbody = document.getElementById('sales-wholesale-table');
    if (tbody) {
      if (!data.length) {
        tbody.innerHTML = '<tr><td colspan="4" style="padding:10px;color:var(--tl)">Даних немає</td></tr>';
      } else {
        tbody.innerHTML = data.map(m => {
          const pctColor = m.pct == null ? 'var(--tl)' : m.pct >= 100 ? GD : m.pct >= 70 ? A : R;
          return `<tr>
            <td>${m.month}</td>
            <td style="text-align:right">${m.plan != null ? _fmt(m.plan) : '—'}</td>
            <td style="text-align:right">${m.fact != null ? _fmt(m.fact) : '—'}</td>
            <td style="text-align:right;font-weight:700;color:${pctColor}">${m.pct != null ? m.pct + '%' : '—'}</td>
          </tr>`;
        }).join('');
      }
    }
  }

  function _updateTimestamp() {
    const el = document.getElementById('sales-updated-at');
    if (el && _data?.fetched_at) {
      try {
        const d = new Date(_data.fetched_at);
        el.textContent = 'Оновлено: ' + d.toLocaleString('uk-UA', { timeZone: 'Europe/Kyiv', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
      } catch(e) {}
    }
  }

  // auto-trigger removed — керується з index.html через go() і restoreTab()

  return { load };
})();
