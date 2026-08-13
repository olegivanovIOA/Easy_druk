// ═══════════════════════════════════════════════════════════════════════════
// strategy_scoring.js  —  Easy 3D Print Dashboard  v2
// Зміни v2:
//   1. Скорінг завантажується із data/strategy.json (через E3D_LOADER)
//   2. Layout: загальний бар + ліво(цілі)/право(опис скорінгу) + таблиця
//   3. Проекти без прогресу також відображаються (з позначкою ⚠️)
// ═══════════════════════════════════════════════════════════════════════════

const E3D_STRATEGY = window.E3D_STRATEGY = (() => {

  const WEIGHT_KEY = 'e3d_strategy_weights_v1';

  // ── Статичні дані ─────────────────────────────────────────────────────────
  const GOALS_STATIC = [
    { id:'Ц1', name:'Система управління та діджиталізація',
      color:'#1D4ED8', light:'#DBEAFE', defaultWeight:25,
      owner:'Іванов Олег',
      participants:'Зубрицька О., Дубровін В., Жолудь М., Стріляний О.',
      projects:[
        { id:'1.0', name:'Система планування (люди, ресурси, гроші)',
          owner:'Іванов Олег',
          participants:'Стріляний О., Жолудь М., Дубровін В., Щуліпенко З., Щербань С.',
          sprints:[{n:1,dates:'20.04–11.05',done:5,total:8},{n:2,dates:'11.05–31.05',done:4,total:4},{n:3,dates:'01.06–14.06',done:0,total:2}]},
        { id:'3.0', name:'Діджиталізація поточних показників',
          owner:'Іванов Олег',
          participants:'Стріляний О., Дубровін В., Зубрицька О., Жолудь М.',
          sprints:[{n:1,dates:'20.04–11.05',done:6,total:7},{n:2,dates:'11.05–31.05',done:4,total:4},{n:3,dates:'01.06–14.06',done:0,total:4}]},
        { id:'12.0', name:'Система складського обліку',
          owner:'Бруновський Михайло', participants:'',
          sprints:[{n:1,dates:'20.04–11.05',done:0,total:0}]},
      ]},
    { id:'Ц2', name:'Операційна ефективність виробництва',
      color:'#16A34A', light:'#DCFCE7', defaultWeight:25,
      owner:'Жолудь Максим',
      participants:'Стріляний О., Зубрицька О., керівники локацій',
      projects:[
        { id:'8.0', name:'Запущено 1 автоматизовану локацію',
          owner:'Стріляний Олександр', participants:'Жолудь М., Зубрицька О.',
          sprints:[{n:1,dates:'20.04–11.05',done:7,total:7},{n:2,dates:'11.05–31.05',done:3,total:4},{n:3,dates:'01.06–14.06',done:0,total:8}]},
        { id:'9.0', name:'Якість — Відділ ОТК',
          owner:'Вакансія', participants:'Жолудь М., Стріляний О.',
          sprints:[{n:1,dates:'20.04–11.05',done:0,total:3},{n:2,dates:'11.05–31.05',done:0,total:3}]},
        { id:'10.0', name:'Система планування виробництва',
          owner:'Бруновський Михайло', participants:'',
          sprints:[{n:1,dates:'20.04–11.05',done:0,total:0}]},
        { id:'11.0', name:'Тестовий відділ',
          owner:'Бруновський Михайло', participants:'',
          sprints:[{n:1,dates:'20.04–11.05',done:0,total:0}]},
        { id:'16.0', name:'Запуск нових локацій',
          owner:'Зубрицька Олександра', participants:'Жолудь М.',
          sprints:[{n:1,dates:'20.04–11.05',done:0,total:0}]},
      ]},
    { id:'Ц3', name:'Продажі та диверсифікація клієнтської бази',
      color:'#EA580C', light:'#FFEDD5', defaultWeight:20,
      owner:'Щербань Сергій',
      participants:'Приходько В., Зубрицька О., Дубровін В.',
      projects:[
        { id:'7.0', name:'Система оцінки індустрій (B2B маркетинг)',
          owner:'Дубровін Вадим', participants:'Щербань С., Зубрицька О.',
          sprints:[{n:1,dates:'20.04–11.05',done:5,total:6},{n:2,dates:'11.05–31.05',done:3,total:13},{n:3,dates:'01.06–14.06',done:0,total:5}]},
        { id:'14.0', name:'Зменшення шуму відділу продажів',
          owner:'Приходько Владислав', participants:'Зубрицька О., Дубровін В.',
          sprints:[{n:1,dates:'20.04–11.05',done:1,total:3},{n:2,dates:'11.05–31.05',done:0,total:2}]},
        { id:'13.0', name:'Розробка плану підвищення ретеншенів',
          owner:'Вакансія (КД)', participants:'',
          sprints:[{n:1,dates:'20.04–11.05',done:0,total:0}]},
      ]},
    { id:'Ц4', name:'Команда та HR',
      color:'#7C3AED', light:'#EDE9FE', defaultWeight:15,
      owner:'Зубрицька Олександра', participants:'Щуліпенко З., Пастух М.',
      projects:[
        { id:'2.0', name:'Сформовано сильну команду (адмінка + топи)',
          owner:'Зубрицька Олександра', participants:'Щуліпенко З., Пастух М.',
          sprints:[{n:1,dates:'20.04–11.05',done:2,total:7},{n:2,dates:'11.05–31.05',done:0,total:4},{n:3,dates:'01.06–14.06',done:0,total:3}]},
      ]},
    { id:'Ц5', name:'Нові продукти та ринки',
      color:'#0891B2', light:'#CFFAFE', defaultWeight:15,
      owner:'Пастух Максим', participants:'Стріляний О., Зубрицька О., Дубровін В.',
      projects:[
        { id:'4.0', name:'Вироблено та продано 10 шт НРК',
          owner:'Пастух Максим', participants:'',
          sprints:[{n:1,dates:'20.04–11.05',done:1,total:2},{n:2,dates:'11.05–31.05',done:0,total:3}]},
        { id:'5.0', name:'Вироблено і продано 90 котушок',
          owner:'Пастух Максим', participants:'',
          sprints:[{n:1,dates:'20.04–11.05',done:0,total:0}]},
        { id:'6.0', name:'Відвантажено замовлення в Європу від 1 т',
          owner:'Вакансія', participants:'Стріляний О., Щербань С., Приходько В., Дубровін В.',
          sprints:[{n:3,dates:'01.06–14.06',done:0,total:27}]},
        { id:'15.0', name:'Збільшення в-ва для В2С',
          owner:'Зубрицька Олександра', participants:'',
          sprints:[{n:1,dates:'20.04–11.05',done:0,total:0}]},
      ]},
  ];

  // ── Математика ────────────────────────────────────────────────────────────
  function sprintPct(sp) {
    // "Перенесено" і "Відмінено" не повинні знижувати %: вони не є ні виконаною
    // роботою, ні простроченою — просто виключаємо їх зі знаменника.
    const denom = sp.total - (sp.postponed||0) - (sp.cancelled||0);
    if (denom <= 0) return sp.done > 0 ? 1 : 0;
    return sp.done / denom;
  }
  function projPct(p)    { const ps=p.sprints.map(sprintPct); return ps.length?ps.reduce((a,b)=>a+b,0)/ps.length:0; }
  // Проєкт без жодної заведеної задачі в жодному спринті (total=0 всюди) —
  // це не "провал", а "ще не розписали / немає власника". Такий проєкт не
  // повинен топити середнє по цілі нарівні з реально проваленими активними
  // проєктами — виключаємо його з goalPct і показуємо окремо у картці цілі.
  function hasNoData(p)  { return p.sprints.every(sp => (sp.total||0) === 0); }
  function goalPct(g) {
    const active = g.projects.filter(p => !hasNoData(p));
    const ps = active.map(projPct);
    return ps.length ? ps.reduce((a,b)=>a+b,0)/ps.length : 0;
  }
  function fmt(v)        { return (v*100).toFixed(1)+'%'; }

  // ── Ваги ─────────────────────────────────────────────────────────────────
  function loadWeights() {
    try { const r=localStorage.getItem(WEIGHT_KEY); if(r) return JSON.parse(r); } catch {}
    return Object.fromEntries(GOALS_STATIC.map(g=>[g.id,g.defaultWeight]));
  }
  function saveWeights(w) { try { localStorage.setItem(WEIGHT_KEY,JSON.stringify(w)); } catch {} }

  // ── Стан ─────────────────────────────────────────────────────────────────
  let _goals      = JSON.parse(JSON.stringify(GOALS_STATIC));
  let _weights    = loadWeights();
  let _status     = 'loading';  // loading | live | error | static
  let _lastUpdate = null;

  // ── Оновити динамічні проекти з даних loader-а ────────────────────────────
  function applyDynamic(dashData) {
    if (!dashData) return;
    const sprints = (dashData._sprints || []).sort((a,b)=>a.num-b.num);
    // Мета по проектах з листа "Проекти" (owner, team)
    const projMeta = dashData._projects || {};

    _goals.forEach(goal => {
      goal.projects.forEach(proj => {
        const pd = dashData[proj.id];
        const pm = projMeta[proj.id];

        // Оновити відповідального і команду з листа "Проекти"
        if (pm) {
          if (pm.owner) proj.owner = pm.owner;
          if (pm.team)  proj.participants = pm.team;
          if (pm.name)  proj.name = pm.name;
        }

        if (!pd) return;
        const live = sprints
          .filter(sp => pd['sprint'+sp.num] && pd['sprint'+sp.num].total > 0)
          .map(sp => ({n:sp.num, dates:sp.dates||'', done:pd['sprint'+sp.num].done, total:pd['sprint'+sp.num].total,
                       postponed:pd['sprint'+sp.num].postponed||0, cancelled:pd['sprint'+sp.num].cancelled||0}));
        if (live.length > 0) proj.sprints = live;
      });
    });
    _status     = 'live';
    _lastUpdate = new Date(dashData._ts || Date.now());
  }

  // ── Бейдж статусу ─────────────────────────────────────────────────────────
  function badge(v, noProgress) {
    if (noProgress) return `<span style="background:#FEF3C7;color:#92400E;font-size:10px;padding:2px 7px;border-radius:10px;white-space:nowrap">⚠️ Немає руху</span>`;
    if (v>=.7) return `<span style="background:#D1FAE5;color:#065F46;font-size:10px;padding:2px 7px;border-radius:10px;white-space:nowrap">✓ На треку</span>`;
    if (v>=.3) return `<span style="background:#FEF3C7;color:#92400E;font-size:10px;padding:2px 7px;border-radius:10px;white-space:nowrap">↗ В процесі</span>`;
    if (v>0)   return `<span style="background:#FEE2E2;color:#991B1B;font-size:10px;padding:2px 7px;border-radius:10px;white-space:nowrap">◉ Початок</span>`;
    return `<span style="background:#F3F4F6;color:#6B7280;font-size:10px;padding:2px 7px;border-radius:10px;white-space:nowrap">○ Заплановано</span>`;
  }

  function miniBar(v, color) {
    return `<div style="display:flex;align-items:center;gap:6px;width:100%">
      <div style="flex:1;height:5px;background:#E5E7EB;border-radius:3px;overflow:hidden;min-width:40px">
        <div style="height:100%;width:${Math.min(100,v*100).toFixed(1)}%;background:${color};border-radius:3px"></div>
      </div>
      <span style="font-size:11px;font-weight:600;color:#374151;min-width:36px;text-align:right">${fmt(v)}</span>
    </div>`;
  }

  // ── Рендер спринту ────────────────────────────────────────────────────────
  function renderSprint(sp, color) {
    const p   = sprintPct(sp);
    const bg  = p===1?'#F0FDF4':p>0?'#FFFBEB':'#F9FAFB';
    return `<div style="display:grid;grid-template-columns:60px 130px 1fr 60px 90px;gap:8px;align-items:center;padding:4px 12px 4px 28px;font-size:11px;border-bottom:0.5px solid #F3F4F6;background:${bg}">
      <span style="color:#9CA3AF">С${sp.n}</span>
      <span style="color:#6B7280">${sp.dates}</span>
      ${miniBar(p,color)}
      <span style="color:#9CA3AF;text-align:center">${sp.done}/${sp.total}</span>
      ${badge(p)}
    </div>`;
  }

  // ── Рендер проекту ────────────────────────────────────────────────────────
  function renderProject(proj, color) {
    const p       = projPct(proj);
    const noData  = hasNoData(proj); // жодної задачі в жодному спринті — виключено з goalPct
    const noMove  = proj.sprints.every(sp=>sp.done===0);  // немає жодного виконаного
    const liveP = window.E3D_LOADER && E3D_LOADER.getAllSprints ? new Set(E3D_LOADER.getAllSprints().flatMap(s=>Object.keys(s.projects||{}))) : new Set();
    const dyn = liveP.has(proj.id) ? ` <span style="font-size:9px;background:#DBEAFE;color:#1D4ED8;padding:1px 5px;border-radius:8px">live</span>` : '';
    const rowBg   = noData ? 'repeating-linear-gradient(135deg,#F9FAFB,#F9FAFB 6px,#F3F4F6 6px,#F3F4F6 12px)' : noMove ? '#FFFBEB' : 'transparent';

    const sprintRows = proj.sprints.map(sp=>renderSprint(sp,color)).join('');
    const noDataBadge = `<span title="Немає жодної заведеної задачі — не враховується в % цілі" style="background:#F3F4F6;color:#6B7280;font-size:10px;padding:2px 7px;border-radius:10px;white-space:nowrap">○ Без задач / без власника</span>`;

    return `<div style="border-bottom:0.5px solid var(--bd)">
      <div class="proj-row" style="display:grid;grid-template-columns:70px 1fr 110px 1fr 60px 100px;gap:8px;align-items:center;padding:7px 12px 7px 18px;cursor:pointer;background:${rowBg};opacity:${noData?.7:1}">
        <span style="font-size:11px;color:#9CA3AF;font-weight:500">${proj.id}${dyn}</span>
        <div>
          <div style="font-size:12px;font-weight:500;color:#1F2937">► ${proj.name}</div>
          <div style="font-size:10px;color:#9CA3AF;margin-top:1px">Відп: ${proj.owner}${noData?' · не враховується в % цілі':''}</div>
        </div>
        <div style="font-size:10px;color:#9CA3AF;line-height:1.4">${proj.participants}</div>
        ${noData?`<span style="font-size:11px;color:#9CA3AF">—</span>`:miniBar(p,color)}
        <span style="text-align:center;font-size:11px;color:#9CA3AF">${proj.sprints.length} спр.</span>
        ${noData?noDataBadge:badge(p, noMove && proj.sprints.some(sp=>sp.total>0))}
      </div>
      <div style="display:none">${sprintRows}</div>
    </div>`;
  }

  // ── Рендер цілі ──────────────────────────────────────────────────────────
  function renderGoal(goal, weights, weightOk, totalW) {
    const gp      = goalPct(goal);
    const w       = (weights[goal.id]??goal.defaultWeight)/100;
    const contrib = gp*w;
    const totSp   = goal.projects.reduce((s,p)=>s+p.sprints.length,0);
    const doneSp  = goal.projects.reduce((s,p)=>s+p.sprints.filter(sp=>sp.done===sp.total&&sp.total>0).length,0);
    const bClr    = !weightOk?'#EF4444':'#D1D5DB';
    const excluded= goal.projects.filter(hasNoData);
    const projRows= goal.projects.map(p=>renderProject(p,goal.color)).join('');
    const excludedNote = excluded.length
      ? `<div style="font-size:10px;color:#9CA3AF;padding:2px 12px 6px 18px;background:${goal.light}">⚠ ${excluded.length} проєкт${excluded.length>1?'и':''} без жодної задачі (${excluded.map(p=>p.id).join(', ')}) не враховано в % цілі — рахуються окремо як "без власника"</div>`
      : '';

    return `<div style="border:1px solid var(--bd);border-radius:10px;overflow:hidden;margin-bottom:8px">
      <div class="goal-row" style="display:grid;grid-template-columns:76px 1fr 110px 70px 140px 100px;gap:8px;align-items:center;padding:11px 12px;background:${goal.light}">
        <!-- ВАГА -->
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
        <!-- НАЗВА -->
        <div style="cursor:pointer">
          <div style="font-size:9px;font-weight:700;color:${goal.color};text-transform:uppercase;letter-spacing:.5px;margin-bottom:2px">${goal.id}</div>
          <div style="font-size:13px;font-weight:600;color:#1F2937;line-height:1.3">${goal.name}</div>
          <div style="font-size:10px;color:#6B7280;margin-top:1px">Відп: ${goal.owner}</div>
        </div>
        <div style="font-size:10px;color:#9CA3AF;line-height:1.4;cursor:pointer">${goal.participants}</div>
        <!-- СПРИНТИ -->
        <div style="text-align:center;cursor:pointer">
          <div style="font-size:9px;color:#9CA3AF;margin-bottom:1px">Спринти</div>
          <div style="font-size:15px;font-weight:600;color:#374151">${doneSp}<span style="font-size:11px;color:#9CA3AF">/${totSp}</span></div>
        </div>
        ${miniBar(gp,goal.color)}
        <div style="display:flex;align-items:center;justify-content:space-between;cursor:pointer">
          ${badge(gp)}
          <button class="goal-toggle" style="border:none;background:transparent;cursor:pointer;color:#9CA3AF;font-size:14px;padding:0 4px">▼</button>
        </div>
      </div>
      ${excludedNote}
      <!-- ПРОЕКТИ (розкриваються) -->
      <div style="display:none">
        <div style="display:grid;grid-template-columns:70px 1fr 110px 1fr 60px 100px;gap:8px;padding:4px 12px;background:#F9FAFB;font-size:9px;color:#9CA3AF;text-transform:uppercase;letter-spacing:.5px;border-bottom:0.5px solid var(--bd)">
          <span>ID</span><span>Проект</span><span>Учасники</span><span>%</span><span>Спр.</span><span>Статус</span>
        </div>
        ${projRows}
      </div>
    </div>`;
  }

  // ── Головний рендер ───────────────────────────────────────────────────────
  function render() {
    const container = document.getElementById('str-scoring-root');
    if (!container) return;

    const totalW   = Object.values(_weights).reduce((a,b)=>a+b,0);
    const weightOk = Math.abs(totalW-100)<0.5;
    const overall  = _goals.reduce((sum,g)=>sum+goalPct(g)*((_weights[g.id]??g.defaultWeight)/100),0);
    const totDone  = _goals.reduce((s,g)=>s+g.projects.reduce((ss,p)=>ss+p.sprints.reduce((sss,sp)=>sss+sp.done,0),0),0);
    const totTasks = _goals.reduce((s,g)=>s+g.projects.reduce((ss,p)=>ss+p.sprints.reduce((sss,sp)=>sss+sp.total,0),0),0);

    // Статус даних
    const dataTag = {
      live:    `<span style="color:#16A34A;font-size:11px">● Дані з Google Sheets · ${_lastUpdate?_lastUpdate.toLocaleTimeString('uk-UA',{hour:'2-digit',minute:'2-digit'}):''} · <a href="#" onclick="E3D_STRATEGY.refresh();return false">оновити</a></span>`,
      error:   `<span style="color:#EA580C;font-size:11px">⚠ Статичні дані · <a href="#" onclick="E3D_STRATEGY.refresh();return false">спробувати ще</a></span>`,
      loading: `<span style="color:#6B7280;font-size:11px">⟳ Завантаження…</span>`,
      static:  `<span style="color:#9CA3AF;font-size:11px">○ Статичні дані</span>`,
    }[_status] || '';

    // Верхній бар прогресу
    const topBar = `
      <div style="background:#f0fdf4;border:1px solid #a7f3d0;border-radius:10px;padding:12px 18px;margin-bottom:14px;display:flex;align-items:center;gap:14px">
        <div style="flex:1;height:10px;background:#d1fae5;border-radius:5px;overflow:hidden">
          <div style="height:100%;width:${Math.min(100,overall*100).toFixed(1)}%;background:#16A34A;border-radius:5px;transition:width .5s"></div>
        </div>
        <div style="font-size:22px;font-weight:700;color:#16A34A;min-width:60px;text-align:right">${fmt(overall)}</div>
        <div style="font-size:11px;color:#065F46">загальний %<br>стратегії 2026</div>
        <div style="font-size:11px;color:#6B7280">${totDone}/${totTasks}<br>задач</div>
        <div>${dataTag}</div>
        <button onclick="E3D_STRATEGY.resetWeights()" style="padding:3px 10px;border:1px solid var(--bd);border-radius:12px;background:transparent;cursor:pointer;font-size:10px;color:var(--tm)">↺ ваги</button>
      </div>`;

    // Ліво/право: цілі + опис скорінгу
    const scoringDesc = `
      <div style="background:var(--s2);border-radius:10px;padding:14px 16px;font-size:12px;color:var(--tm);line-height:1.8">
        <div style="font-weight:700;margin-bottom:8px;font-size:13px">📐 Як рахується скорінг</div>
        <div>% Спринту = виконані / (всього − перенесені − відмінені)</div>
        <div>% Проекту = середнє спринтів</div>
        <div>% Цілі = середнє проектів</div>
        <div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--bd)">
          <b>Загальний % = Σ (% Цілі × Вага)</b>
        </div>
        <div style="margin-top:8px;color:#9CA3AF;font-size:11px">
          Ваги редагуйте в лівому стовпці ↙<br>
          Сума ваг = ${totalW}% ${weightOk?'✓':'⚠️ має бути 100%'}
        </div>
        <div style="margin-top:10px;padding-top:8px;border-top:1px solid var(--bd);font-size:11px">
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px"><span style="background:#D1FAE5;color:#065F46;padding:1px 6px;border-radius:8px;font-size:10px">✓ На треку</span> ≥ 70%</div>
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px"><span style="background:#FEF3C7;color:#92400E;padding:1px 6px;border-radius:8px;font-size:10px">↗ В процесі</span> 30–69%</div>
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px"><span style="background:#FEE2E2;color:#991B1B;padding:1px 6px;border-radius:8px;font-size:10px">◉ Початок</span> 1–29%</div>
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px"><span style="background:#F3F4F6;color:#6B7280;padding:1px 6px;border-radius:8px;font-size:10px">○ Заплановано</span> 0%</div>
          <div style="display:flex;align-items:center;gap:6px"><span style="background:#FEF3C7;color:#92400E;padding:1px 6px;border-radius:8px;font-size:10px">⚠️ Немає руху</span> є задачі, але 0 виконано</div>
        </div>
        <div style="margin-top:10px;padding-top:8px;border-top:1px solid var(--bd);font-size:10px;color:#9CA3AF">
          <span style="background:#DBEAFE;color:#1D4ED8;padding:1px 5px;border-radius:8px">live</span> — дані підтягуються з Google Sheets автоматично
        </div>
      </div>`;

    const weightWarn = !weightOk
      ? `<div class="al al-r" style="margin:6px 0 10px"><span class="ic">⚠️</span> Сума ваг = <b>${totalW}%</b>. Має бути 100%. <button onclick="E3D_STRATEGY.resetWeights()" style="margin-left:8px;padding:2px 10px;border:1px solid #C0392B;border-radius:12px;background:transparent;cursor:pointer;font-size:11px;color:#C0392B">Скинути</button></div>` : '';

    // Зведена таблиця: Ціль → Проекти → Спринти → Учасники → %
    const summaryTable = `
      <table style="width:100%;border-collapse:collapse;font-size:12px">
        <thead>
          <tr style="background:var(--s2);font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--tm)">
            <th style="padding:6px 8px;text-align:center;width:70px">Вага</th>
            <th style="padding:6px 8px;text-align:left;width:160px">Ціль / Проект</th>
            <th style="padding:6px 8px;text-align:left;width:120px">Відповідальний</th>
            <th style="padding:6px 8px;text-align:left;width:100px">Учасники</th>
            <th style="padding:6px 8px;text-align:center;width:70px">Спринти</th>
            <th style="padding:6px 8px;text-align:right;width:130px">% виконання</th>
            <th style="padding:6px 8px;text-align:center;width:95px">Статус</th>
          </tr>
        </thead>
        <tbody>
          ${_goals.map(g => {
            const gp = goalPct(g);
            const w  = (_weights[g.id]??g.defaultWeight)/100;
            const totSp  = g.projects.reduce((s,p)=>s+p.sprints.length,0);
            const doneSp = g.projects.reduce((s,p)=>s+p.sprints.filter(sp=>sp.done===sp.total&&sp.total>0).length,0);
            const bClr   = !weightOk?'#EF4444':'#D1D5DB';
            const goalRow = `<tr style="background:${g.light};font-weight:600;border-bottom:1px solid var(--bd);border-top:2px solid ${g.color}20">
              <td style="padding:6px 8px;text-align:center">
                <div style="display:flex;align-items:center;gap:2px;justify-content:center">
                  <input class="weight-input" type="number" min="0" max="100" step="1" data-gid="${g.id}" value="${_weights[g.id]??g.defaultWeight}"
                    style="width:42px;padding:2px 3px;border:2px solid ${bClr};border-radius:5px;font-size:12px;font-weight:700;text-align:center;color:${g.color};outline:none">
                  <span style="font-size:11px;color:#6B7280">%</span>
                </div>
                <div style="font-size:9px;color:#9CA3AF;margin-top:2px">↗${fmt(gp*w)}</div>
              </td>
              <td style="padding:8px 10px">
                <div style="font-size:10px;font-weight:700;color:${g.color};text-transform:uppercase;letter-spacing:.5px">${g.id}</div>
                <div style="color:#1F2937">${g.name}</div>
              </td>
              <td style="padding:8px 10px;color:#374151">${g.owner}</td>
              <td style="padding:8px 10px;font-size:10px;color:#9CA3AF">${g.participants}</td>
              <td style="padding:8px 10px;text-align:center;color:#374151;font-weight:600">${doneSp}/${totSp}</td>
              <td style="padding:8px 10px;text-align:right">${miniBar(gp,g.color)}</td>
              <td style="padding:8px 10px;text-align:center">${badge(gp)}</td>
            </tr>`;
            const projRows = g.projects.map(proj => {
              const pp     = projPct(proj);
              const noMove = proj.sprints.every(sp=>sp.done===0) && proj.sprints.some(sp=>sp.total>0);
              // live = проект є в живих даних Google Sheets
              const liveProjs = window.E3D_LOADER && E3D_LOADER.getAllSprints ?
                new Set(E3D_LOADER.getAllSprints().flatMap(s=>Object.keys(s.projects||{}))) : new Set();
              const dyn = liveProjs.has(proj.id) ? ' <span style="font-size:9px;background:#DBEAFE;color:#1D4ED8;padding:1px 4px;border-radius:6px">live</span>' : '';
              return `<tr class="proj-row" style="border-bottom:0.5px solid var(--bd);cursor:pointer;font-size:11px" onmouseover="this.style.background='var(--s2)'" onmouseout="this.style.background=''">
                <td style="padding:3px 8px"></td>
                <td style="padding:3px 8px;padding-left:18px">
                  <span style="color:#9CA3AF;font-size:10px">► ${proj.id}${dyn}</span>
                  <span style="color:#374151;margin-left:4px">${proj.name}</span>
                </td>
                <td style="padding:3px 8px;color:#374151">${proj.owner}</td>
                <td style="padding:3px 8px;font-size:10px;color:#9CA3AF">${proj.participants}</td>
                <td style="padding:3px 8px;text-align:center;color:#9CA3AF">${proj.sprints.length}</td>
                <td style="padding:3px 8px">${miniBar(pp,g.color)}</td>
                <td style="padding:3px 8px;text-align:center">${badge(pp, noMove)}</td>
              </tr>
              <tr class="sprint-rows" style="display:none">
                <td colspan="7" style="padding:0">
                  ${proj.sprints.map(sp=>{
                    const sp_p = sprintPct(sp);
                    return `<div style="display:grid;grid-template-columns:76px 60px 130px 1fr 80px 140px 100px;gap:8px;align-items:center;padding:3px 10px 3px 36px;font-size:11px;background:${sp_p===1?'#F0FDF4':sp_p>0?'#FFFBEB':'#F9FAFB'};border-bottom:0.5px solid #F3F4F6">
                      <span></span>
                      <span style="color:#9CA3AF">С${sp.n}</span>
                      <span style="color:#6B7280">${sp.dates}</span>
                      <span></span>
                      <span style="color:#9CA3AF;text-align:center">${sp.done}/${sp.total}</span>
                      ${miniBar(sp_p,g.color)}
                      <span style="text-align:center">${badge(sp_p)}</span>
                    </div>`;
                  }).join('')}
                </td>
              </tr>`;
            }).join('');
            return goalRow + projRows;
          }).join('')}
        </tbody>
      </table>`;

    const twoCol = `
      <div class="str-two-col">
        <div>${weightWarn}<div class="str-table-wrap">${summaryTable}</div></div>
        <div style="position:sticky;top:60px">${scoringDesc}</div>
      </div>`;

    container.innerHTML = topBar + twoCol;

    // ── Events ──
    container.querySelectorAll('.proj-row').forEach(row => {
      row.addEventListener('click', function() {
        const body = this.nextElementSibling;
        if (!body || !body.classList.contains('sprint-rows')) return;
        body.style.display = body.style.display === 'none' ? 'table-row' : 'none';
      });
    });
    container.querySelectorAll('.weight-input').forEach(inp => {
      inp.addEventListener('change', function() {
        _weights[this.dataset.gid] = Math.max(0, Math.min(100, parseFloat(this.value)||0));
        saveWeights(_weights);
        render();
      });
    });
  }

  // ── Init / refresh / reset ────────────────────────────────────────────────
  function init() {
    _status = 'loading';
    render();
    if (window.E3D_LOADER) {
      E3D_LOADER.on('sheets', ({status, data}) => {
        if (status==='ok' && data) applyDynamic(data);
        else _status = 'error';
        render();
      });
    } else {
      _status = 'static';
      render();
    }
  }

  function refresh() {
    _status = 'loading';
    render();
    if (window.E3D_LOADER) {
      E3D_LOADER.initAll(true).catch(()=>{ _status='error'; render(); });
    }
  }

  function resetWeights() {
    _weights = Object.fromEntries(GOALS_STATIC.map(g=>[g.id,g.defaultWeight]));
    saveWeights(_weights);
    render();
  }

  return { init, render, refresh, resetWeights };
})();

// Автозапуск — працює незалежно від того коли скрипт завантажився
(function(){
  function run(){
    E3D_STRATEGY.render();
    if(window.E3D_LOADER){
      E3D_LOADER.on('sheets', function(){ E3D_STRATEGY.render(); });
      E3D_LOADER.initAll(true);
    }
  }
  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', run);
  } else {
    run(); // DOM вже готовий
  }
})();

// Примітка: перемикач спринтів (#sprint-switcher, #s1b) повністю керується
// кодом у index.html (з визначенням поточного спринту за датою) — щоб уникнути
// перезапису одного й того ж DOM двома незалежними скриптами.

