// ═══════════════════════════════════════════════════════════════════════════
// strategy_scoring.js  —  Easy 3D Print Dashboard
// Скорінг-модель стратегії 2026: Цілі → Проекти → Спринти → %
// Ваги цілей редагуються прямо в UI, зберігаються в localStorage.
// Дані для проектів 1.0 і 3.0 підтягуються динамічно з E3D_LOADER.
// ═══════════════════════════════════════════════════════════════════════════

const E3D_STRATEGY = (() => {

  const WEIGHT_KEY = 'e3d_strategy_weights_v1';

  // ── Статичні дані по всіх проектах (окрім 1.0 і 3.0 — вони динамічні) ──
  const GOALS_STATIC = [
    {
      id: 'Ц1', name: 'Система управління та діджиталізація',
      color: '#1D4ED8', light: '#DBEAFE', defaultWeight: 25,
      owner: 'Іванов Олег',
      participants: 'Зубрицька О., Дубровін В., Жолудь М., Стріляний О.',
      projects: [
        { id: '1.0', name: 'Система планування (люди, ресурси, гроші)',
          owner: 'Іванов Олег',
          participants: 'Стріляний О., Жолудь М., Дубровін В., Щуліпенко З., Щербань С.',
          dynamic: true,  // ← заповнюється з Google Sheets
          sprints: [
            { n:1, dates:'20.04–11.05', done:5, total:8 },
            { n:2, dates:'11.05–31.05', done:4, total:4 },
            { n:3, dates:'01.06–14.06', done:0, total:2 },
          ]
        },
        { id: '3.0', name: 'Діджиталізація поточних показників',
          owner: 'Іванов Олег',
          participants: 'Стріляний О., Дубровін В., Зубрицька О., Жолудь М.',
          dynamic: true,
          sprints: [
            { n:1, dates:'20.04–11.05', done:6, total:7 },
            { n:2, dates:'11.05–31.05', done:4, total:4 },
            { n:3, dates:'01.06–14.06', done:0, total:4 },
          ]
        },
      ]
    },
    {
      id: 'Ц2', name: 'Операційна ефективність виробництва',
      color: '#16A34A', light: '#DCFCE7', defaultWeight: 25,
      owner: 'Жолудь Максим',
      participants: 'Стріляний О., Зубрицька О., керівники локацій',
      projects: [
        { id: '8.0', name: 'Запущено 1 автоматизовану локацію',
          owner: 'Стріляний Олександр', participants: 'Жолудь М., Зубрицька О.',
          sprints: [
            { n:1, dates:'20.04–11.05', done:7, total:7 },
            { n:2, dates:'11.05–31.05', done:3, total:4 },
            { n:3, dates:'01.06–14.06', done:0, total:8 },
          ]
        },
        { id: '9.0', name: 'Якість — Відділ ОТК',
          owner: 'Вакансія', participants: 'Жолудь М., Стріляний О.',
          sprints: [
            { n:1, dates:'20.04–11.05', done:0, total:3 },
            { n:2, dates:'11.05–31.05', done:0, total:3 },
          ]
        },
      ]
    },
    {
      id: 'Ц3', name: 'Продажі та диверсифікація клієнтської бази',
      color: '#EA580C', light: '#FFEDD5', defaultWeight: 20,
      owner: 'Щербань Сергій',
      participants: 'Приходько В., Зубрицька О., Дубровін В.',
      projects: [
        { id: '7.0', name: 'Система оцінки індустрій (B2B маркетинг)',
          owner: 'Дубровін Вадим', participants: 'Щербань С., Зубрицька О.',
          sprints: [
            { n:1, dates:'20.04–11.05', done:5, total:6 },
            { n:2, dates:'11.05–31.05', done:3, total:13 },
            { n:3, dates:'01.06–14.06', done:0, total:5 },
          ]
        },
        { id: '14.0', name: 'Зменшення шуму відділу продажів',
          owner: 'Приходько Владислав', participants: 'Зубрицька О., Дубровін В.',
          sprints: [
            { n:1, dates:'20.04–11.05', done:1, total:3 },
            { n:2, dates:'11.05–31.05', done:0, total:2 },
          ]
        },
      ]
    },
    {
      id: 'Ц4', name: 'Команда та HR',
      color: '#7C3AED', light: '#EDE9FE', defaultWeight: 15,
      owner: 'Зубрицька Олександра',
      participants: 'Щуліпенко З., Пастух М.',
      projects: [
        { id: '2.0', name: 'Сформовано сильну команду (адмінка + топи)',
          owner: 'Зубрицька Олександра', participants: 'Щуліпенко З., Пастух М.',
          sprints: [
            { n:1, dates:'20.04–11.05', done:2, total:7 },
            { n:2, dates:'11.05–31.05', done:0, total:4 },
            { n:3, dates:'01.06–14.06', done:0, total:3 },
          ]
        },
      ]
    },
    {
      id: 'Ц5', name: 'Нові продукти та ринки',
      color: '#0891B2', light: '#CFFAFE', defaultWeight: 15,
      owner: 'Пастух Максим',
      participants: 'Стріляний О., Зубрицька О., Дубровін В.',
      projects: [
        { id: '4.0', name: 'Вироблено та продано 10 шт НРК',
          owner: 'Пастух Максим', participants: '',
          sprints: [
            { n:1, dates:'20.04–11.05', done:1, total:2 },
            { n:2, dates:'11.05–31.05', done:0, total:3 },
          ]
        },
        { id: '6.0', name: 'Відвантажено замовлення в Європу від 1 т',
          owner: 'Вакансія', participants: 'Стріляний О., Щербань С., Приходько В., Дубровін В.',
          sprints: [
            { n:3, dates:'01.06–14.06', done:0, total:27 },
          ]
        },
      ]
    },
  ];

  // ── Математика ────────────────────────────────────────────────────────────
  function sprintPct(sp) { return sp.total > 0 ? sp.done / sp.total : 0; }
  function projPct(proj) {
    const ps = proj.sprints.map(sprintPct);
    return ps.length ? ps.reduce((a, b) => a + b, 0) / ps.length : 0;
  }
  function goalPct(goal) {
    const ps = goal.projects.map(projPct);
    return ps.length ? ps.reduce((a, b) => a + b, 0) / ps.length : 0;
  }
  function fmt(v)   { return (v * 100).toFixed(1) + '%'; }
  function fmtInt(v){ return Math.round(v * 100) + '%'; }

  // ── Ваги ─────────────────────────────────────────────────────────────────
  function loadWeights() {
    try {
      const raw = localStorage.getItem(WEIGHT_KEY);
      if (raw) return JSON.parse(raw);
    } catch {}
    return Object.fromEntries(GOALS_STATIC.map(g => [g.id, g.defaultWeight]));
  }
  function saveWeights(w) {
    try { localStorage.setItem(WEIGHT_KEY, JSON.stringify(w)); } catch {}
  }

  // ── Стан ─────────────────────────────────────────────────────────────────
  let _goals   = JSON.parse(JSON.stringify(GOALS_STATIC)); // deep copy
  let _weights = loadWeights();
  let _dataStatus = 'static'; // 'static' | 'loading' | 'live' | 'error'
  let _lastUpdated = null;

  // Оновити спринти проектів 1.0 і 3.0 з живих даних.
  // Динамічно підхоплює ВСІ спринти (1,2,3,4...N) — жодного хардкоду.
  function applyDynamic(dashData) {
    if (!dashData) return;

    // Всі спринти з Web App (відсортовані)
    const allSprints = (dashData._sprints || []).sort((a,b) => a.num - b.num);

    _goals.forEach(goal => {
      goal.projects.forEach(proj => {
        if (!proj.dynamic) return;
        const pid = proj.id;
        const pd  = dashData[pid];
        if (!pd) return;

        // Rebuild sprints array from live data (may be more than 3)
        const liveSprints = allSprints
          .filter(sp => pd['sprint' + sp.num] && pd['sprint' + sp.num].total > 0)
          .map(sp => ({
            n:     sp.num,
            dates: sp.dates || '',
            done:  pd['sprint' + sp.num].done,
            total: pd['sprint' + sp.num].total,
          }));

        if (liveSprints.length > 0) {
          proj.sprints = liveSprints;
        }
      });
    });
    _dataStatus  = 'live';
    _lastUpdated = new Date(dashData._ts || Date.now());
  }

  // ── Рендер ───────────────────────────────────────────────────────────────
  function render() {
    const container = document.getElementById('str-scoring-root');
    if (!container) return;

    const totalW = Object.values(_weights).reduce((a, b) => a + b, 0);
    const weightOk = Math.abs(totalW - 100) < 0.5;
    const overallPct = _goals.reduce((sum, g) => {
      return sum + goalPct(g) * ((_weights[g.id] ?? g.defaultWeight) / 100);
    }, 0);

    const totDone  = _goals.reduce((s,g)=>s+g.projects.reduce((ss,p)=>ss+p.sprints.reduce((sss,sp)=>sss+sp.done,0),0),0);
    const totTasks = _goals.reduce((s,g)=>s+g.projects.reduce((ss,p)=>ss+p.sprints.reduce((sss,sp)=>sss+sp.total,0),0),0);

    // Статус даних
    const statusHtml = _dataStatus === 'live'
      ? `<div class="al al-g" style="margin-bottom:12px"><span class="ic">🔄</span>
           Дані актуальні — завантажено з Google Sheets о ${_lastUpdated.toLocaleTimeString('uk-UA',{hour:'2-digit',minute:'2-digit'})}
           · <a href="#" onclick="E3D_STRATEGY.refresh();return false">Оновити зараз</a>
         </div>`
      : _dataStatus === 'error'
      ? `<div class="al al-r" style="margin-bottom:12px"><span class="ic">⚠️</span>
           Не вдалося завантажити з Google Sheets — відображаються статичні дані.
           Перевірте що таблиця опублікована (Файл → Поділитися → Опублікувати в інтернеті → CSV)
           · <a href="#" onclick="E3D_STRATEGY.refresh();return false">Спробувати ще раз</a>
         </div>`
      : _dataStatus === 'loading'
      ? `<div class="al al-b" style="margin-bottom:12px"><span class="ic">⟳</span> Завантаження даних з Google Sheets…</div>`
      : '';

    // Попередження про суму ваг
    const weightWarn = !weightOk
      ? `<div class="al al-r" style="margin:8px 0"><span class="ic">⚠️</span>
           Сума ваг = <b>${totalW}%</b>. Має бути рівно <b>100%</b>.
           <button onclick="E3D_STRATEGY.resetWeights()" style="margin-left:8px;padding:2px 10px;border:1px solid #C0392B;border-radius:12px;background:transparent;cursor:pointer;font-size:11px;color:#C0392B">Скинути</button>
         </div>`
      : `<div style="font-size:11px;color:#2A9D8F;margin:6px 0 10px">✓ Сума ваг = 100% · збережено у браузері</div>`;

    // Загальна шкала прогресу
    const overallBar = `
      <div style="background:#f0fdf4;border:1px solid #a7f3d0;border-radius:10px;padding:14px 18px;margin-bottom:16px;display:flex;align-items:center;gap:16px">
        <div style="flex:1;height:10px;background:#d1fae5;border-radius:5px;overflow:hidden">
          <div style="height:100%;width:${Math.min(100,overallPct*100).toFixed(1)}%;background:#16A34A;border-radius:5px;transition:width .5s"></div>
        </div>
        <div style="font-size:22px;font-weight:700;color:#16A34A;min-width:64px;text-align:right">${fmt(overallPct)}</div>
        <div style="font-size:11px;color:#065F46;min-width:110px">загальний % виконання стратегії 2026</div>
        <div style="font-size:11px;color:#6B7280">${totDone}/${totTasks} задач виконано</div>
        <button onclick="E3D_STRATEGY.resetWeights()" title="Скинути ваги" style="padding:4px 10px;border:1px solid var(--bd);border-radius:12px;background:transparent;cursor:pointer;font-size:10px;color:var(--tm)">↺ ваги</button>
      </div>`;

    // Заголовок таблиці
    const thead = `
      <div style="display:grid;grid-template-columns:76px 1fr 110px 70px 140px 90px;gap:8px;padding:5px 12px;background:var(--s2);border-radius:8px;margin-bottom:6px;font-size:10px;font-weight:700;color:var(--tm);text-transform:uppercase;letter-spacing:.5px">
        <span style="text-align:center">Вага %</span>
        <span>Ціль / Проект / Спринт</span>
        <span>Відп.</span>
        <span style="text-align:center">Спринти</span>
        <span>% виконання</span>
        <span>Статус</span>
      </div>`;

    // Рядки цілей
    const goalsHtml = _goals.map(goal => renderGoal(goal, _weights, weightOk, totalW)).join('');

    container.innerHTML = statusHtml + overallBar + weightWarn + thead + goalsHtml;

    // Прив'язати обробники після рендеру
    container.querySelectorAll('.goal-toggle').forEach(btn => {
      btn.addEventListener('click', function() {
        const body = this.closest('.goal-row').nextElementSibling;
        if (!body) return;
        const isOpen = body.style.display !== 'none';
        body.style.display = isOpen ? 'none' : 'block';
        this.textContent = isOpen ? '▼' : '▲';
      });
    });
    container.querySelectorAll('.proj-toggle').forEach(btn => {
      btn.addEventListener('click', function() {
        const body = this.closest('.proj-row').nextElementSibling;
        if (!body) return;
        body.style.display = body.style.display === 'none' ? 'block' : 'none';
      });
    });
    container.querySelectorAll('.weight-input').forEach(inp => {
      inp.addEventListener('change', function() {
        const gid = this.dataset.gid;
        const val = Math.max(0, Math.min(100, parseFloat(this.value) || 0));
        _weights[gid] = val;
        saveWeights(_weights);
        render();
      });
    });
  }

  function badge(v) {
    if (v >= .7) return '<span style="background:#D1FAE5;color:#065F46;font-size:10px;padding:2px 7px;border-radius:10px;white-space:nowrap">✓ На треку</span>';
    if (v >= .3) return '<span style="background:#FEF3C7;color:#92400E;font-size:10px;padding:2px 7px;border-radius:10px;white-space:nowrap">↗ В процесі</span>';
    if (v >  0)  return '<span style="background:#FEE2E2;color:#991B1B;font-size:10px;padding:2px 7px;border-radius:10px;white-space:nowrap">◉ Початок</span>';
    return '<span style="background:#F3F4F6;color:#6B7280;font-size:10px;padding:2px 7px;border-radius:10px;white-space:nowrap">○ Заплановано</span>';
  }

  function miniBar(v, color) {
    return `<div style="display:flex;align-items:center;gap:6px;width:100%">
      <div style="flex:1;height:5px;background:#E5E7EB;border-radius:3px;overflow:hidden;min-width:40px">
        <div style="height:100%;width:${Math.min(100,v*100).toFixed(1)}%;background:${color};border-radius:3px"></div>
      </div>
      <span style="font-size:11px;font-weight:600;color:#374151;min-width:36px;text-align:right">${fmt(v)}</span>
    </div>`;
  }

  function renderGoal(goal, weights, weightOk, totalW) {
    const gp    = goalPct(goal);
    const w     = (weights[goal.id] ?? goal.defaultWeight) / 100;
    const contrib = gp * w;
    const totSp = goal.projects.reduce((s,p)=>s+p.sprints.length, 0);
    const doneSp= goal.projects.reduce((s,p)=>s+p.sprints.filter(sp=>sp.done===sp.total&&sp.total>0).length, 0);
    const bClr  = !weightOk ? '#EF4444' : '#D1D5DB';

    const projRows = goal.projects.map(proj => renderProject(proj, goal.color)).join('');

    return `
    <div style="border:1px solid var(--bd);border-radius:10px;overflow:hidden;margin-bottom:8px">
      <div class="goal-row" style="display:grid;grid-template-columns:76px 1fr 110px 70px 140px 90px;gap:8px;align-items:center;padding:11px 12px;background:${goal.light};cursor:pointer">
        <div onclick="event.stopPropagation()" style="display:flex;flex-direction:column;align-items:center;gap:2px">
          <span style="font-size:9px;font-weight:700;color:${goal.color};text-transform:uppercase">Вага</span>
          <div style="display:flex;align-items:center;gap:2px">
            <input class="weight-input" type="number" min="0" max="100" step="1"
              data-gid="${goal.id}" value="${weights[goal.id]??goal.defaultWeight}"
              style="width:42px;padding:2px 3px;border:2px solid ${bClr};border-radius:5px;font-size:13px;font-weight:700;text-align:center;color:${goal.color};outline:none">
            <span style="font-size:11px;color:#6B7280">%</span>
          </div>
          <span style="font-size:9px;color:#9CA3AF">↗${fmt(contrib)}</span>
        </div>
        <div>
          <div style="font-size:9px;font-weight:700;color:${goal.color};text-transform:uppercase;letter-spacing:.5px;margin-bottom:2px">${goal.id}</div>
          <div style="font-size:13px;font-weight:600;color:#1F2937;line-height:1.3">${goal.name}</div>
          <div style="font-size:10px;color:#6B7280;margin-top:1px">Відп: ${goal.owner}</div>
        </div>
        <div style="font-size:10px;color:#9CA3AF;line-height:1.4">${goal.participants}</div>
        <div style="text-align:center">
          <div style="font-size:9px;color:#9CA3AF;margin-bottom:1px">Спринти</div>
          <div style="font-size:15px;font-weight:600;color:#374151">${doneSp}<span style="font-size:11px;color:#9CA3AF">/${totSp}</span></div>
        </div>
        ${miniBar(gp, goal.color)}
        <div style="display:flex;align-items:center;justify-content:space-between">
          ${badge(gp)}
          <button class="goal-toggle" style="border:none;background:transparent;cursor:pointer;color:#9CA3AF;font-size:14px;padding:0 4px">▼</button>
        </div>
      </div>
      <div style="display:none">
        <div style="display:grid;grid-template-columns:76px 1fr 110px 70px 140px 90px;gap:8px;padding:4px 12px;background:#F9FAFB;font-size:9px;color:#9CA3AF;text-transform:uppercase;letter-spacing:.5px;border-bottom:0.5px solid var(--bd)">
          <span>ID</span><span>Проект</span><span>Учасники</span><span style="text-align:center">Спр.</span><span>%</span><span>Статус</span>
        </div>
        ${projRows}
      </div>
    </div>`;
  }

  function renderProject(proj, color) {
    const p    = projPct(proj);
    const totSp= proj.sprints.length;
    const dyn  = proj.dynamic ? ' <span style="font-size:9px;background:#DBEAFE;color:#1D4ED8;padding:1px 5px;border-radius:8px">live</span>' : '';

    const sprintRows = proj.sprints.map(sp => renderSprint(sp, color)).join('');

    return `
    <div style="border-bottom:0.5px solid var(--bd)">
      <div class="proj-row" style="display:grid;grid-template-columns:76px 1fr 110px 70px 140px 90px;gap:8px;align-items:center;padding:7px 12px 7px 18px;cursor:pointer">
        <span style="font-size:11px;color:#9CA3AF;font-weight:500">${proj.id}${dyn}</span>
        <div>
          <div style="font-size:12px;font-weight:500;color:#1F2937">► ${proj.name}</div>
          <div style="font-size:10px;color:#9CA3AF;margin-top:1px">Відп: ${proj.owner}</div>
        </div>
        <div style="font-size:10px;color:#9CA3AF;line-height:1.4">${proj.participants}</div>
        <span style="text-align:center;font-size:11px;color:#9CA3AF">${totSp} спр.</span>
        ${miniBar(p, color)}
        <div style="display:flex;align-items:center;justify-content:space-between">
          ${badge(p)}
          <button class="proj-toggle" style="border:none;background:transparent;cursor:pointer;color:#9CA3AF;font-size:12px;padding:0 4px">▼</button>
        </div>
      </div>
      <div style="display:none">
        ${sprintRows}
      </div>
    </div>`;
  }

  function renderSprint(sp, color) {
    const p = sprintPct(sp);
    const bg = p === 1 ? '#F0FDF4' : p > 0 ? '#FFFBEB' : '#F9FAFB';
    return `
    <div style="display:grid;grid-template-columns:76px 130px 1fr 70px 90px;gap:8px;align-items:center;padding:4px 12px 4px 28px;font-size:11px;border-bottom:0.5px solid #F3F4F6;background:${bg}">
      <span style="color:#9CA3AF">С${sp.n}</span>
      <span style="color:#6B7280">${sp.dates}</span>
      ${miniBar(p, color)}
      <span style="color:#9CA3AF;text-align:center">${sp.done}/${sp.total}</span>
      ${badge(p)}
    </div>`;
  }

  // ── Публічний API ─────────────────────────────────────────────────────────
  function init() {
    _dataStatus = 'loading';
    render(); // показати скелет зі статичними даними

    if (window.E3D_LOADER) {
      E3D_LOADER.on('sheets', ({ status, data, ts }) => {
        if (status === 'ok' && data) {
          applyDynamic(data);
        } else {
          _dataStatus = 'error';
        }
        render();
      });
    } else {
      _dataStatus = 'static';
      render();
    }
  }

  function refresh() {
    _dataStatus = 'loading';
    render();
    if (window.E3D_LOADER) {
      E3D_LOADER.initAll(true).then(() => {}).catch(() => {
        _dataStatus = 'error';
        render();
      });
    }
  }

  function resetWeights() {
    _weights = Object.fromEntries(GOALS_STATIC.map(g => [g.id, g.defaultWeight]));
    saveWeights(_weights);
    render();
  }

  return { init, render, refresh, resetWeights };
})();
