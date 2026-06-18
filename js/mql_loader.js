/**
 * mql_loader.js — Easy 3D Print Dashboard
 * Завантажує data/mql_sql.json (генерується fetch_mql.py, динамічно по місяцях)
 * Рендерить блок на CRM таб: перемикач місяців, KPI, воронку, канали, кампанії, менеджерів
 */

window.MqlLoader = (() => {
  const DATA_URL = 'data/mql_sql.json';
  let _data = null;
  let _activeMonth = null;
  let _chart = null;

  const G = '#2A9D8F', GD = '#1e7a6e', A = '#457B9D', R = '#C0392B';
  const GB = 'rgba(42,157,143,.15)';
  const GRID = '#f0f2ee';

  async function load() {
    try {
      const r = await fetch(DATA_URL + '?t=' + Date.now());
      if (!r.ok) throw new Error('HTTP ' + r.status);
      _data = await r.json();
      const months = _data.months || [];
      _activeMonth = months.length ? months[months.length - 1].period : null;
      render();
    } catch (e) {
      console.warn('[MQL] Не вдалось завантажити mql_sql.json:', e);
    }
  }

  function getCurrentMonthData() {
    if (!_data) return null;
    const months = _data.months || [];
    return months.find(m => m.period === _activeMonth) || _data.latest || null;
  }

  function render() {
    if (!_data) return;
    renderMonthSwitcher();
    const m = getCurrentMonthData();
    if (!m) return;
    _renderKPI(m);
    _renderFunnelChart(m);
    _renderChannels(m);
    _renderCampaigns(m);
    _renderManagers(m);
    _updateTimestamp();
  }

  function renderMonthSwitcher() {
    const el = document.getElementById('mql-month-switcher');
    if (!el) return;
    const months = _data.months || [];
    if (months.length <= 1) { el.innerHTML = ''; return; }

    el.innerHTML = months.map(m => {
      const active = m.period === _activeMonth;
      return `<button data-month="${m.period}" style="padding:3px 10px;border:1px solid var(--bd);border-radius:12px;cursor:pointer;font-size:11px;font-weight:600;transition:all .15s;background:${active ? 'var(--g)' : 'transparent'};color:${active ? '#fff' : 'var(--tm)'}">${m.period}</button>`;
    }).join('');

    el.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('click', () => {
        _activeMonth = btn.dataset.month;
        render();
      });
    });
  }

  function _fmt(n) {
    if (n == null) return '—';
    if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(2) + 'M';
    if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(0) + 'K';
    return String(Math.round(n));
  }

  function _set(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  }

  function _renderKPI(m) {
    const k = m.kpi || {}, mq = m.mql || {};
    _set('mql-total-leads', (k.total_leads || 0).toLocaleString('uk-UA'));
    _set('mql-deals', k.deals_closed ?? '—');
    _set('mql-conv', (k.conversion_pct ?? '—') + '%');
    _set('mql-revenue', _fmt(k.revenue_uah) + ' грн');
    _set('mql-no-mql', (mq.deals_without_mql ?? '—') + ' (' + (mq.deals_without_mql_pct ?? 0) + '%)');
    _set('mql-false', (mq.false_mql1 ?? '—') + ' (' + (mq.false_mql1_pct ?? 0) + '%)');

    const insightEl = document.getElementById('mql-critical-insight');
    if (insightEl) {
      insightEl.innerHTML = m.critical_insight
        ? '<b>Критично:</b> ' + m.critical_insight
        : 'Немає критичних інсайтів за цей період';
    }
  }

  function _renderFunnelChart(m) {
    const canvas = document.getElementById('mql-funnel-chart');
    if (!canvas) return;
    const funnel = m.funnel || [];
    if (!funnel.length) {
      canvas.parentElement.innerHTML = '<p style="color:var(--tl);font-size:12px;padding:1rem">Даних воронки немає</p>';
      return;
    }

    if (_chart) { try { _chart.destroy(); } catch(e){} }
    _chart = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: funnel.map(f => f.segment),
        datasets: [
          { label: 'Всього', data: funnel.map(f => f.total), backgroundColor: 'rgba(150,168,144,.25)', borderRadius: 4 },
          { label: 'Угод', data: funnel.map(f => f.deals), backgroundColor: GB, borderColor: G, borderWidth: 1.5, borderRadius: 4 },
        ]
      },
      options: {
        indexAxis: 'y',
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'top', labels: { usePointStyle: true, padding: 10 } } },
        scales: {
          x: { grid: { color: GRID } },
          y: { grid: { display: false }, ticks: { font: { size: 10 } } }
        }
      }
    });
  }

  function _renderChannels(m) {
    const tbody = document.getElementById('mql-channels-body');
    if (!tbody) return;
    const channels = m.channels || [];
    if (!channels.length) { tbody.innerHTML = '<tr><td colspan="7" style="padding:10px;color:var(--tl)">Даних немає</td></tr>'; return; }

    tbody.innerHTML = channels.map(c => {
      const convColor = c.conv_pct >= 12 ? GD : c.conv_pct >= 8 ? A : R;
      return `<tr>
        <td>${c.channel}</td>
        <td style="text-align:right">${c.leads}</td>
        <td style="text-align:right">${c.deals}</td>
        <td style="text-align:right;font-weight:700;color:${convColor}">${c.conv_pct}%</td>
        <td style="text-align:right">${_fmt(c.revenue_uah)} грн</td>
        <td style="text-align:right">${c.noise_pct}%</td>
        <td>${c.label || ''}</td>
      </tr>`;
    }).join('');
  }

  function _renderCampaigns(m) {
    const container = document.getElementById('mql-campaigns-table');
    if (!container) return;
    const campaigns = (m.campaigns || []).slice(0, 8);
    if (!campaigns.length) { container.innerHTML = '<p style="color:var(--tl);font-size:12px">Даних немає</p>'; return; }

    container.innerHTML = campaigns.map(c => {
      const isStop = (c.label || '').includes('ЗУПИНИТИ');
      const color = isStop ? R : c.conv_pct >= 20 ? GD : A;
      return `<div class="mr"><div class="mn">${c.campaign}</div><div class="mv" style="color:${color}">${c.conv_pct}%</div></div>`;
    }).join('');
  }

  function _renderManagers(m) {
    const container = document.getElementById('mql-managers-table');
    if (!container) return;
    const sm = m.sources_managers || [[], []];
    const managers = sm[1] || [];
    if (!managers.length) { container.innerHTML = '<p style="color:var(--tl);font-size:12px">Даних немає</p>'; return; }

    container.innerHTML = managers.map(mgr => {
      return `<div class="mr"><div class="mn">${mgr.manager}</div><div class="mv g">${_fmt(mgr.revenue_uah)} грн</div></div>
      <div style="font-size:9px;color:var(--tl);margin:-2px 0 6px">${mgr.leads} лідів · ${mgr.deals} угод · ${mgr.conv_pct}%</div>`;
    }).join('');
  }

  function _updateTimestamp() {
    const el = document.getElementById('mql-updated-at');
    if (el && _data?.fetched_at) {
      try {
        const d = new Date(_data.fetched_at);
        el.textContent = 'Оновлено: ' + d.toLocaleString('uk-UA', { timeZone: 'Europe/Kyiv', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
      } catch(e) {}
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('panel-crm')?.classList.contains('active')) load();
  });

  return { load };
})();
