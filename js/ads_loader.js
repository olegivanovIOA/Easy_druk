/**
 * ads_loader.js — Easy 3D Print Dashboard v1.1
 * Завантажує data/ads.json (генерується fetch_ads.py з Google Ads)
 * Рендерить CRM таб: зведення, воронка, кампанії, розподіл бюджету
 */

window.AdsLoader = (() => {
  const DATA_URL = 'data/ads.json';
  let _data = null;
  let _charts = {};

  const G = '#2A9D8F', GD = '#1e7a6e', A = '#457B9D', R = '#C0392B';
  const GB = 'rgba(42,157,143,.13)', AB = 'rgba(69,123,157,.13)', RB = 'rgba(192,57,43,.11)';
  const GRID = '#f0f2ee';

  // ── Завантаження ────────────────────────────────────────────────────────────
  async function load() {
    try {
      const r = await fetch(DATA_URL + '?t=' + Date.now());
      if (!r.ok) throw new Error('HTTP ' + r.status);
      _data = await r.json();
      render();
    } catch (e) {
      console.warn('[ADS] Не вдалось завантажити ads.json:', e);
      _renderError();
    }
  }

  // ── Головний рендер ──────────────────────────────────────────────────────────
  function render() {
    if (!_data) return;
    _renderSummary();
    _renderFunnelChart();
    _renderCampaignsTable();
    _renderBudgetChart();
    _updateTimestamp();
  }

  // ── 1. Зведення KPI ─────────────────────────────────────────────────────────
  function _renderSummary() {
    const s = _data.analytics?.summary || {};

    _set('ads-cost-total',    s.total_cost_uah   ? _fmt(s.total_cost_uah) + ' грн' : '—');
    _set('ads-conv-total',    s.total_conversions != null ? s.total_conversions : '—');
    _set('ads-roas-avg',      s.avg_roas          ? s.avg_roas + 'x'              : '—');
    _set('ads-active-count',  s.active_count      != null ? s.active_count        : '—');

    // Кольори для ROAS
    const roasEl = document.getElementById('ads-roas-avg');
    if (roasEl && s.avg_roas) {
      roasEl.style.color = s.avg_roas >= 3 ? GD : s.avg_roas >= 1 ? A : R;
    }

    // RED кампанії — попередження
    const redEl = document.getElementById('ads-red-count');
    if (redEl) {
      redEl.textContent = s.red_count || 0;
      redEl.style.color = s.red_count > 0 ? R : GD;
    }

    // Воронка — останній день
    const funnel = _data.funnel || [];
    if (funnel.length) {
      const last = funnel[funnel.length - 1];
      _set('ads-leads-last',   last.leads);
      _set('ads-ctr-last',     last.ctr_pct + '%');
      _set('ads-cvr-last',     last.cvr_pct + '%');
    }
  }

  // ── 2. Графік воронки по днях ────────────────────────────────────────────────
  function _renderFunnelChart() {
    const canvas = document.getElementById('ads-funnel-chart');
    if (!canvas) return;

    const funnel = _data.funnel || [];
    if (!funnel.length) {
      canvas.parentElement.innerHTML = '<p style="color:var(--tl);font-size:12px;padding:1rem">Даних воронки немає</p>';
      return;
    }

    // Показуємо останні 30 днів
    const data = funnel.slice(-30);
    const labels = data.map(d => {
      const dt = new Date(d.date);
      return (dt.getMonth()+1) + '/' + dt.getDate();
    });

    if (_charts.funnel) { try { _charts.funnel.destroy(); } catch(e){} }
    _charts.funnel = new Chart(canvas, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Ліди',
            data: data.map(d => d.leads),
            borderColor: GD, backgroundColor: GB,
            borderWidth: 2, tension: 0.4, fill: true,
            pointRadius: 3, pointBackgroundColor: GD, yAxisID: 'y',
          },
          {
            label: 'Кліки',
            data: data.map(d => d.clicks),
            borderColor: A, backgroundColor: AB,
            borderWidth: 1.5, tension: 0.4, fill: false,
            pointRadius: 2, pointBackgroundColor: A, yAxisID: 'y1',
          },
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { position: 'top', labels: { usePointStyle: true, padding: 10, font: { size: 10 } } }
        },
        scales: {
          x: { grid: { color: GRID }, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 10 } },
          y: {
            type: 'linear', position: 'left',
            grid: { color: GRID },
            title: { display: true, text: 'Ліди', font: { size: 9 }, color: GD },
            beginAtZero: true,
          },
          y1: {
            type: 'linear', position: 'right',
            grid: { drawOnChartArea: false },
            title: { display: true, text: 'Кліки', font: { size: 9 }, color: A },
            beginAtZero: true,
          },
        }
      }
    });

    // CTR/CVR лінійний міні-графік
    const canvas2 = document.getElementById('ads-ctr-chart');
    if (canvas2) {
      if (_charts.ctr) { try { _charts.ctr.destroy(); } catch(e){} }
      _charts.ctr = new Chart(canvas2, {
        type: 'line',
        data: {
          labels,
          datasets: [
            { label: 'CTR%', data: data.map(d => d.ctr_pct), borderColor: A, borderWidth: 1.5, tension: 0.4, fill: false, pointRadius: 2 },
            { label: 'CVR%', data: data.map(d => d.cvr_pct), borderColor: GD, borderWidth: 1.5, tension: 0.4, fill: false, pointRadius: 2 },
          ]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { position: 'top', labels: { usePointStyle: true, padding: 8, font: { size: 10 } } } },
          scales: {
            x: { grid: { color: GRID }, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 10 } },
            y: { grid: { color: GRID }, ticks: { callback: v => v + '%' }, beginAtZero: true }
          }
        }
      });
    }
  }

  // ── 3. Таблиця кампаній ──────────────────────────────────────────────────────
  function _renderCampaignsTable() {
    const container = document.getElementById('ads-campaigns-table');
    if (!container) return;

    const active = _data.analytics?.active || [];
    if (!active.length) {
      container.innerHTML = '<p style="color:var(--tl);font-size:12px">Активних кампаній немає</p>';
      return;
    }

    // Сортуємо: спочатку RED, потім GREEN за витратами
    const sorted = [...active].sort((a, b) => {
      if (a.traffic_light === 'RED' && b.traffic_light !== 'RED') return -1;
      if (b.traffic_light === 'RED' && a.traffic_light !== 'RED') return 1;
      return b.cost_uah - a.cost_uah;
    });

    const LIGHT = {
      GREEN: { bg: '#d4edda', color: '#0A3D20', label: '✓' },
      RED:   { bg: '#f8d7da', color: '#721c24', label: '✗' },
      YELLOW:{ bg: '#fff3cd', color: '#856404', label: '~' },
    };

    const rows = sorted.map(c => {
      const lc = LIGHT[c.traffic_light] || LIGHT.YELLOW;
      const roasVal = c.roas !== 'N/A' ? parseFloat(c.roas) : null;
      const roasColor = roasVal ? (roasVal >= 3 ? GD : roasVal >= 1 ? A : R) : 'var(--tl)';
      const roasText = roasVal ? roasVal + 'x' : 'N/A';
      const cplText = c.cpl !== 'N/A' ? c.cpl + ' грн' : 'N/A';

      return `<tr>
        <td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${c.campaign}">${c.campaign}</td>
        <td style="text-align:right;font-weight:600">${_fmt(c.cost_uah)} грн</td>
        <td style="text-align:center">${c.conversions || 0}</td>
        <td style="text-align:right;font-weight:700;color:${roasColor}">${roasText}</td>
        <td style="text-align:right">${c.clicks.toLocaleString('uk-UA')}</td>
        <td style="text-align:center">${c.ctr_pct}%</td>
        <td style="text-align:center">
          <span style="background:${lc.bg};color:${lc.color};padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700">${c.traffic_light}</span>
        </td>
      </tr>`;
    }).join('');

    const total = _data.analytics?.summary || {};
    container.innerHTML = `
      <div style="overflow-x:auto">
      <table style="width:100%;border-collapse:collapse;font-size:12px">
        <thead>
          <tr style="background:var(--s2)">
            <th style="padding:7px 10px;text-align:left;font-size:10px;font-weight:700;letter-spacing:.5px;text-transform:uppercase">Кампанія</th>
            <th style="padding:7px 10px;text-align:right;font-size:10px;font-weight:700;letter-spacing:.5px;text-transform:uppercase">Витрати</th>
            <th style="padding:7px 10px;text-align:center;font-size:10px;font-weight:700;letter-spacing:.5px;text-transform:uppercase">Конв.</th>
            <th style="padding:7px 10px;text-align:right;font-size:10px;font-weight:700;letter-spacing:.5px;text-transform:uppercase">ROAS</th>
            <th style="padding:7px 10px;text-align:right;font-size:10px;font-weight:700;letter-spacing:.5px;text-transform:uppercase">Кліки</th>
            <th style="padding:7px 10px;text-align:center;font-size:10px;font-weight:700;letter-spacing:.5px;text-transform:uppercase">CTR</th>
            <th style="padding:7px 10px;text-align:center;font-size:10px;font-weight:700;letter-spacing:.5px;text-transform:uppercase">Статус</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      </div>
      <div style="padding:7px 12px;font-size:10px;color:var(--tm);background:var(--s2);border-top:1px solid var(--bd);border-radius:0 0 var(--r) var(--r)">
        Активних: ${total.active_count} · Бюджет 30 днів: ${_fmt(total.total_cost_uah)} грн · Ліди: ${total.total_conversions} · Avg ROAS: ${total.avg_roas}x
      </div>`;
  }

  // ── 4. Розподіл бюджету (bar chart) ─────────────────────────────────────────
  function _renderBudgetChart() {
    const canvas = document.getElementById('ads-budget-chart');
    if (!canvas) return;

    const active = (_data.analytics?.active || []).filter(c => c.cost_uah > 0);
    if (!active.length) {
      canvas.parentElement.innerHTML = '<p style="color:var(--tl);font-size:12px;padding:1rem">Немає даних по витратах</p>';
      return;
    }

    const sorted = [...active].sort((a, b) => b.cost_uah - a.cost_uah).slice(0, 10);
    const colors = sorted.map(c =>
      c.traffic_light === 'RED' ? 'rgba(192,57,43,.7)' :
      c.traffic_light === 'GREEN' ? 'rgba(42,157,143,.75)' : 'rgba(69,123,157,.6)'
    );

    if (_charts.budget) { try { _charts.budget.destroy(); } catch(e){} }
    _charts.budget = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: sorted.map(c => c.campaign.length > 22 ? c.campaign.substring(0,20)+'…' : c.campaign),
        datasets: [{
          label: 'Витрати, грн',
          data: sorted.map(c => c.cost_uah),
          backgroundColor: colors,
          borderRadius: 4, borderWidth: 0,
        }]
      },
      options: {
        indexAxis: 'y',
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: ctx => _fmt(ctx.parsed.x) + ' грн' } }
        },
        scales: {
          x: {
            grid: { color: GRID },
            title: { display: true, text: 'Витрати, грн (за 30 днів)', font: { size: 10 }, color: '#6b836a' },
            ticks: { callback: v => _fmt(v) + ' грн' }
          },
          y: { grid: { display: false }, ticks: { font: { size: 10 } } }
        }
      }
    });
  }

  // ── Утиліти ──────────────────────────────────────────────────────────────────
  function _set(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  }

  function _fmt(n) {
    if (!n && n !== 0) return '—';
    return Number(n).toLocaleString('uk-UA', { maximumFractionDigits: 0 });
  }

  function _updateTimestamp() {
    const el = document.getElementById('ads-updated-at');
    if (!el || !_data?.fetched_at) return;
    try {
      const d = new Date(_data.fetched_at);
      el.textContent = 'Оновлено: ' + d.toLocaleString('uk-UA', {
        timeZone: 'Europe/Kyiv', day: '2-digit', month: '2-digit',
        hour: '2-digit', minute: '2-digit'
      });
    } catch(e) {}
  }

  function _renderError() {
    const el = document.getElementById('ads-status');
    if (el) el.textContent = '✗ Дані реклами недоступні';
  }

  // auto-trigger removed — керується з index.html через go() і restoreTab()

  return { load };
})();
