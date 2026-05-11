// ═══════════════════════════════════════════════════════════════════════════
// sheets_loader.js  —  Easy 3D Print Dashboard
// Завантажує CSV з Google Sheets, парсить задачі по спринтах і проектах,
// кешує в localStorage, автооновлення раз на годину.
// ═══════════════════════════════════════════════════════════════════════════

const E3D_LOADER = (() => {

  const SHEET_ID   = '1GD3tyFOC7-0tSjAIR1uaS9H2nbVUwrUFGAbfgBJMV2A';
  const CACHE_TTL  = 60 * 60 * 1000; // 1 година

  // gid кожного листа — беремо з URL Google Sheets (параметр gid=)
  const GIDS = {
    sprint1: '739884490',
    sprint2: '1832832800',
    sprint3: '601192624',
  };

  const CACHE_KEY  = 'e3d_sheets_cache_v2';
  const _listeners = {};
  let   _summary   = { ok: 0, error: 0, total: Object.keys(GIDS).length };

  // ── CSV helpers ──────────────────────────────────────────────────────────
  function csvUrl(gid) {
    return `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${gid}`;
  }

  function parseCsvLine(line) {
    const cells = [];
    let cur = '', inQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') { inQ = !inQ; continue; }
      if (c === ',' && !inQ) { cells.push(cur.trim()); cur = ''; continue; }
      cur += c;
    }
    cells.push(cur.trim());
    return cells;
  }

  function parseCsv(text) {
    return text.split('\n').map(parseCsvLine);
  }

  // ── Визначити чи задача виконана ─────────────────────────────────────────
  function isDone(status) {
    return (status || '').trim() === 'Виконано';
  }

  // ── Парсинг одного CSV-листа спринту ─────────────────────────────────────
  // Повертає: { 'proj_id': { name, tasks:[{task,owner,deadline,status,done}] }, ... }
  function parseSprintCsv(csvText) {
    const rows = parseCsv(csvText);
    const projects = {};
    let currentProj = null;

    for (let i = 0; i < rows.length; i++) {
      const row  = rows[i];
      const colA = (row[0] || '').trim();  // №  / proj id
      const colB = (row[1] || '').trim();  // Проект
      const colC = (row[2] || '').trim();  // Задача
      const colD = (row[3] || '').trim();  // Відповідальний
      const colF = (row[5] || '').trim();  // Дедлайн
      const colH = (row[7] || '').trim();  // Статус

      // Пропускаємо рядки заголовків
      if (colA === '№' || colB === 'Проекти (назва)') continue;

      // Заголовок проекту: colA = "1.0" / "3.0" і colC пустий
      const isProjHeader = /^\d+\.\d+$/.test(colA) && !colC;
      if (isProjHeader) {
        currentProj = colA;
        if (!projects[colA]) {
          projects[colA] = { name: colB || colA, tasks: [] };
        }
        continue;
      }

      // Задача: є вміст в colC і є поточний проект
      if (currentProj && colC && colC.length > 2) {
        projects[currentProj].tasks.push({
          task:     colC,
          owner:    colD,
          deadline: colF,
          status:   colH,
          done:     isDone(colH),
        });
      }
    }

    return projects;
  }

  // ── Агрегат по проекту в спринті ─────────────────────────────────────────
  function sprintSummary(projects, projId) {
    if (!projects || !projects[projId]) return { done: 0, total: 0, tasks: [] };
    const tasks = projects[projId].tasks;
    return {
      done:  tasks.filter(t => t.done).length,
      total: tasks.length,
      tasks,
    };
  }

  // ── Завантаження одного листа ─────────────────────────────────────────────
  async function fetchSheet(key, gid) {
    const res = await fetch(csvUrl(gid), { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    return parseSprintCsv(text);
  }

  // ── Кеш ──────────────────────────────────────────────────────────────────
  function loadCache() {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      const { ts, data } = JSON.parse(raw);
      if (Date.now() - ts > CACHE_TTL) return null;
      return { ts, data };
    } catch { return null; }
  }

  function saveCache(data) {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), data }));
    } catch {}
  }

  // ── Event emitter ─────────────────────────────────────────────────────────
  function emit(key, payload) {
    (_listeners[key] || []).forEach(fn => { try { fn(payload); } catch {} });
    (_listeners['*']  || []).forEach(fn => { try { fn({ key, ...payload }); } catch {} });
  }

  // ── Публічний API ─────────────────────────────────────────────────────────
  function on(key, fn)  { (_listeners[key] = _listeners[key] || []).push(fn); }
  function summary()    { return { ..._summary }; }

  // Побудувати об'єкт даних для дашборду з розпарсених листів
  function buildDashData(sheets) {
    // sheets = { sprint1: {projId: {tasks}}, sprint2: ..., sprint3: ... }
    const projs = ['1.0', '3.0'];
    const result = {};
    projs.forEach(pid => {
      result[pid] = {
        sprint1: sprintSummary(sheets.sprint1, pid),
        sprint2: sprintSummary(sheets.sprint2, pid),
        sprint3: sprintSummary(sheets.sprint3, pid),
      };
    });
    // Також повертаємо всі задачі Спринту 2 для таблиці
    result._sprint2_all = sheets.sprint2;
    result._sprint1_all = sheets.sprint1;
    result._sprint3_all = sheets.sprint3;
    result._ts = Date.now();
    return result;
  }

  async function initAll(force = false) {
    _summary = { ok: 0, error: 0, total: Object.keys(GIDS).length };

    // Спробувати кеш
    if (!force) {
      const cached = loadCache();
      if (cached) {
        emit('sheets', { status: 'ok', data: cached.data, fromCache: true, ts: cached.ts });
        emit('*',      { key: 'sheets', status: 'ok' });
        _summary.ok = _summary.total;
        return cached.data;
      }
    }

    // Завантажити всі три листи
    const sheets = {};
    const errors = [];

    await Promise.all(
      Object.entries(GIDS).map(async ([key, gid]) => {
        try {
          sheets[key] = await fetchSheet(key, gid);
          _summary.ok++;
        } catch (e) {
          console.warn(`[E3D_LOADER] Не вдалося завантажити ${key}:`, e.message);
          sheets[key] = null;
          errors.push(key);
          _summary.error++;
        }
      })
    );

    if (_summary.ok === 0) {
      emit('sheets', { status: 'error', data: null });
      return null;
    }

    const dashData = buildDashData(sheets);
    saveCache(dashData);
    emit('sheets', { status: 'ok', data: dashData, fromCache: false, ts: dashData._ts });
    return dashData;
  }

  // Автооновлення кожну годину
  function startAutoRefresh() {
    setInterval(() => initAll(true), CACHE_TTL);
  }

  return { on, summary, initAll, startAutoRefresh, isDone, sprintSummary };
})();

// Зворотна сумісність з data_layer.js (якщо він є)
if (!window.E3D_DATA) {
  window.E3D_DATA = {
    on:      E3D_LOADER.on,
    summary: E3D_LOADER.summary,
    initAll: E3D_LOADER.initAll,
  };
}
