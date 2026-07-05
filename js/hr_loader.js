/**
 * hr_loader.js — Easy 3D Print Dashboard v1.1
 * Завантажує data/hr.json і рендерить HR таб:
 *   - Загальна кількість співробітників
 *   - Графік стажерів по місяцях (Chart.js)
 *   - Поточні відкриті вакансії (таблиця)
 *   - Графік вакансій по місяцях (з history)
 *   - Довідник норм закриття вакансій
 *   - Графік плинності кадрів
 */

window.HRLoader = (() => {
  const DATA_URL = 'data/hr.json';

  let _data = null;
  let _charts = {};

  const UA_MONTH_ORDER = [
    'Січень','Лютий','Березень','Квітень','Травень','Червень',
    'Липень','Серпень','Вересень','Жовтень','Листопад','Грудень'
  ];

  // ─── Завантаження ──────────────────────────────────────────────────────────
  async function load() {
    try {
      const r = await fetch(DATA_URL + '?t=' + Date.now());
      if (!r.ok) throw new Error('HTTP ' + r.status);
      _data = await r.json();
      render();
    } catch (e) {
      console.warn('[HR] Не вдалось завантажити hr.json:', e);
      renderError();
    }
  }

  // ─── Головний рендер ───────────────────────────────────────────────────────
  function render() {
    if (!_data) return;
    renderEmployeeCount();
    renderInternsChart();
    renderVacanciesCurrent();
    renderVacanciesHistory();
    renderClosingNorms();
    renderTurnoverChart();
    updateTimestamp();
  }

  // ─── 1. Загальна кількість співробітників + зведені картки ────────────────
  function renderEmployeeCount() {
    const el = document.getElementById('hr-employees-count');
    if (el) el.textContent = _data.employees_count || 0;

    const vacCount = (_data.vacancies_current?.vacancies || []).length;
    const vacEl = document.getElementById('hr-open-vacancies-count');
    if (vacEl) vacEl.textContent = vacCount || '—';

    const staff = _data.turnover?.staff || [];
    if (staff.length) {
      const last = staff[staff.length - 1];
      const turnEl = document.getElementById('hr-turnover-latest');
      if (turnEl) {
        turnEl.textContent = last.turnover_pct + '%';
        const val = parseFloat(last.turnover_pct);
        turnEl.style.color = val > 5 ? '#dc3545' : '#0A3D20';
      }
    }

    const interns = _data.interns_by_month || [];
    if (interns.length) {
      const last = interns[interns.length - 1];
      const intEl = document.getElementById('hr-interns-latest');
      if (intEl) intEl.textContent = last.count;
    }
  }

  // ─── 2. Графік стажерів по місяцях ────────────────────────────────────────
  function renderInternsChart() {
    const canvas = document.getElementById('hr-interns-chart');
    if (!canvas) return;

    const data = _data.interns_by_month || [];
    if (!data.length) {
      canvas.parentElement.innerHTML = '<p style="color:var(--color-text-secondary);font-size:13px;padding:1rem">Даних по стажерах немає</p>';
      return;
    }

    // Сортуємо по порядку місяців
    const sorted = [...data].sort((a, b) =>
      UA_MONTH_ORDER.indexOf(a.month) - UA_MONTH_ORDER.indexOf(b.month)
    );

    if (_charts['interns']) _charts['interns'].destroy();
    _charts['interns'] = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: sorted.map(d => d.month),
        datasets: [{
          label: 'Стажерів',
          data: sorted.map(d => d.count),
          backgroundColor: '#16A34A',
          borderRadius: 4,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          datalabels: {
            anchor: 'end', align: 'top',
            font: { size: 12, weight: '500' },
            color: '#0A3D20',
            formatter: v => v
          }
        },
        scales: {
          y: { beginAtZero: true, ticks: { stepSize: 1 } },
          x: { ticks: { autoSkip: false } }
        }
      },
      plugins: window.ChartDataLabels ? [window.ChartDataLabels] : []
    });
  }

  // ─── 3. Поточні відкриті вакансії ─────────────────────────────────────────
  function renderVacanciesCurrent() {
    const container = document.getElementById('hr-vacancies-current');
    if (!container) return;

    const current = _data.vacancies_current || {};
    const list = current.vacancies || [];
    const month = current.month || '—';

    if (!list.length) {
      container.innerHTML = `<p style="color:var(--color-text-secondary);font-size:13px">Вакансій немає</p>`;
      return;
    }

    const STATUS_COLORS = {
      'Закрита':   { bg: '#d4edda', color: '#0A3D20' },
      'Погоджена': { bg: '#fff3cd', color: '#856404' },
      'Відкрита':  { bg: '#f8d7da', color: '#721c24' },
    };

    const REASON_COLORS = {
      'Заміна співробітника': { bg: '#f8d7da', color: '#721c24' },
      'Підсилення команди':   { bg: '#fff3cd', color: '#856404' },
      'Розширення штату':     { bg: '#d4edda', color: '#0A3D20' },
    };

    const rows = list.map(v => {
      const sc = STATUS_COLORS[v.status] || { bg: '#e9ecef', color: '#495057' };
      const rc = REASON_COLORS[v.reason] || { bg: '#e9ecef', color: '#495057' };
      return `<tr>
        <td style="font-weight:500">${v.vacancy}</td>
        <td style="text-align:center">${v.location || '—'}</td>
        <td style="text-align:center">${v.qty || '1'}</td>
        <td><span style="background:${rc.bg};color:${rc.color};padding:2px 8px;border-radius:4px;font-size:12px">${v.reason || '—'}</span></td>
        <td><span style="background:${sc.bg};color:${sc.color};padding:2px 10px;border-radius:4px;font-size:12px;font-weight:500">${v.status || '—'}</span></td>
      </tr>`;
    }).join('');

    container.innerHTML = `
      <p style="font-size:13px;color:var(--color-text-secondary);margin-bottom:8px">Місяць: <strong>${month}</strong> · Вакансій: <strong>${list.length}</strong></p>
      <div style="overflow-x:auto">
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead>
          <tr style="background:var(--color-background-secondary)">
            <th style="padding:8px 10px;text-align:left;font-weight:500">Вакансія</th>
            <th style="padding:8px 10px;font-weight:500">Локація</th>
            <th style="padding:8px 10px;font-weight:500">К-сть</th>
            <th style="padding:8px 10px;text-align:left;font-weight:500">Причина</th>
            <th style="padding:8px 10px;text-align:left;font-weight:500">Статус</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      </div>`;
  }

  // ─── 4. Графік вакансій по місяцях (history) ──────────────────────────────
  function renderVacanciesHistory() {
    const canvas = document.getElementById('hr-vacancies-history-chart');
    if (!canvas) return;

    const history = _data.vacancies_history || [];
    if (history.length < 2) {
      canvas.parentElement.innerHTML = `<p style="color:var(--color-text-secondary);font-size:13px;padding:1rem">Накопичується з кожним місяцем…</p>`;
      return;
    }

    const sorted = [...history].sort((a, b) =>
      UA_MONTH_ORDER.indexOf(a.month) - UA_MONTH_ORDER.indexOf(b.month)
    );

    if (_charts['vac_hist']) _charts['vac_hist'].destroy();
    _charts['vac_hist'] = new Chart(canvas, {
      type: 'line',
      data: {
        labels: sorted.map(d => d.month),
        datasets: [{
          label: 'Відкриті вакансії',
          data: sorted.map(d => d.total),
          borderColor: '#0A3D20',
          backgroundColor: 'rgba(10,61,32,0.1)',
          pointBackgroundColor: '#16A34A',
          pointRadius: 5,
          tension: 0.3,
          fill: true,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          y: { beginAtZero: true, ticks: { stepSize: 1 } },
          x: { ticks: { autoSkip: false } }
        }
      }
    });
  }

  // ─── 5. Довідник норм закриття вакансій ────────────────────────────────────
  function renderClosingNorms() {
    const container = document.getElementById('hr-closing-norms');
    if (!container) return;

    const norms = _data.closing_norms || [];
    if (!norms.length) {
      container.innerHTML = '<p style="color:var(--color-text-secondary);font-size:13px">Довідник не завантажено</p>';
      return;
    }

    const rows = norms.map(n => {
      const color = n.days <= 14 ? '#0A3D20' : '#1A2B3C';
      const bg    = n.days <= 14 ? '#d4edda' : '#e6f1fb';
      return `<tr>
        <td style="padding:5px 10px;font-size:13px">${n.position}</td>
        <td style="padding:5px 10px;text-align:center">
          <span style="background:${bg};color:${color};padding:2px 10px;border-radius:4px;font-size:12px;font-weight:500">${n.days} дн.</span>
        </td>
      </tr>`;
    }).join('');

    container.innerHTML = `
      <p style="font-size:12px;color:var(--color-text-secondary);margin-bottom:8px">* Відлік від погодження заявки та повного опису вакансії</p>
      <div style="overflow-x:auto;max-height:340px;overflow-y:auto">
      <table style="width:100%;border-collapse:collapse">
        <thead>
          <tr style="background:var(--color-background-secondary);position:sticky;top:0">
            <th style="padding:8px 10px;text-align:left;font-weight:500;font-size:13px">Посада</th>
            <th style="padding:8px 10px;font-weight:500;font-size:13px">Норма</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      </div>`;
  }

  // ─── 6. Графік плинності кадрів ────────────────────────────────────────────
  function renderTurnoverChart() {
    const canvas = document.getElementById('hr-turnover-chart');
    if (!canvas) return;

    const turnover = _data.turnover || {};
    const staff = turnover.staff || [];
    const target = turnover.target_staff || null;

    if (!staff.length) {
      canvas.parentElement.innerHTML = '<p style="color:var(--color-text-secondary);font-size:13px;padding:1rem">Даних по плинності немає</p>';
      return;
    }

    const sorted = [...staff].sort((a, b) =>
      UA_MONTH_ORDER.indexOf(a.month) - UA_MONTH_ORDER.indexOf(b.month)
    );
    const labels = sorted.map(d => d.month);
    const vals   = sorted.map(d => parseFloat(d.turnover_pct) || 0);

    const datasets = [{
      label: 'Плинність %',
      data: vals,
      borderColor: '#1A2B3C',
      backgroundColor: 'rgba(26,43,60,0.1)',
      pointBackgroundColor: vals.map(v => v > 5 ? '#dc3545' : '#16A34A'),
      pointRadius: 5,
      tension: 0.3,
      fill: true,
    }];

    // Таргет лінія
    if (target) {
      const targetVal = parseFloat(target.replace('%','').replace(',','.')) || 5;
      datasets.push({
        label: 'Таргет ' + target,
        data: labels.map(() => targetVal),
        borderColor: '#dc3545',
        borderDash: [6, 3],
        borderWidth: 1.5,
        pointRadius: 0,
        fill: false,
      });
    }

    if (_charts['turnover']) _charts['turnover'].destroy();
    _charts['turnover'] = new Chart(canvas, {
      type: 'line',
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: !!target, position: 'top', labels: { boxWidth: 12, font: { size: 12 } } }
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: { callback: v => v + '%' }
          },
          x: { ticks: { autoSkip: false } }
        }
      }
    });
  }

  // ─── Таймстамп ─────────────────────────────────────────────────────────────
  function updateTimestamp() {
    const el = document.getElementById('hr-updated-at');
    if (!el || !_data?.fetched_at) return;
    const d = new Date(_data.fetched_at);
    el.textContent = 'Оновлено: ' + d.toLocaleString('uk-UA', { timeZone: 'Europe/Kyiv', dateStyle: 'short', timeStyle: 'short' });
  }

  function renderError() {
    const el = document.getElementById('hr-status');
    if (el) el.textContent = '✗ HR дані недоступні';
  }

  return { load };
})();

// auto-trigger removed — керується з index.html через go() і restoreTab()
