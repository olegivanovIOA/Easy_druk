// ═══════════════════════════════════════════════════════════════════════════
// sheets_loader.js  —  Easy 3D Print Dashboard  v4
//
// Читає /data/strategy.json — статичний файл, який GitHub Actions
// оновлює раз на годину з Google Sheets.
// Жодних API ключів, жодних обмежень корпоративного акаунту.
// ═══════════════════════════════════════════════════════════════════════════

const E3D_LOADER = (() => {

  // Шлях до JSON — відносний, працює і локально і на GitHub Pages
  const DATA_URL  = './data/strategy.json';
  const CACHE_KEY = 'e3d_loader_cache_v4';
  const CACHE_TTL = 60 * 60 * 1000; // 1 година

  const _listeners = {};
  let _data    = null;
  let _summary = { ok: 0, error: 0, total: 1 };

  // ── Event emitter ────────────────────────────────────────────────────────
  function on(key, fn) { (_listeners[key] = _listeners[key] || []).push(fn); }
  function emit(key, payload) {
    (_listeners[key] || []).forEach(fn => { try { fn(payload); } catch(e){} });
    (_listeners['*']  || []).forEach(fn => { try { fn({key,...payload}); } catch(e){} });
  }
  function summary() { return {..._summary}; }

  // ── localStorage кеш ─────────────────────────────────────────────────────
  function loadCache(allowStale = false) {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      const {ts, data} = JSON.parse(raw);
      if (!allowStale && Date.now() - ts > CACHE_TTL) return null;
      return {ts, data};
    } catch { return null; }
  }
  function saveCache(data) {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ts: Date.now(), data})); } catch {}
  }

  // ── Завантаження ─────────────────────────────────────────────────────────
  async function initAll(force = false) {
    // Кеш (якщо не примусово)
    if (!force) {
      const cached = loadCache(false);
      if (cached) {
        _data = cached.data;
        _summary = {ok:1, error:0, total:1};
        emit('sheets', {status:'ok', data:_data, fromCache:true, ts:cached.ts});
        return _data;
      }
    }

    try {
      // Додаємо ?ts= щоб обійти кеш браузера/CDN
      const res = await fetch(`${DATA_URL}?ts=${Date.now()}`, {cache: 'no-store'});
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (json.error) throw new Error(json.error);

      _data = normalizeData(json);
      _summary = {ok:1, error:0, total:1};
      saveCache(_data);
      emit('sheets', {status:'ok', data:_data, fromCache:false, ts:_data._ts});
      return _data;

    } catch(e) {
      console.warn('[E3D_LOADER] fetch failed:', e.message);
      _summary = {ok:0, error:1, total:1};

      // Fallback: застарілий кеш краще ніж нічого
      const stale = loadCache(true);
      if (stale) {
        _data = stale.data;
        emit('sheets', {status:'ok', data:_data, fromCache:true, stale:true, ts:stale.ts});
        return _data;
      }

      emit('sheets', {status:'error', data:null, error:e.message});
      return null;
    }
  }

  // ── Нормалізація JSON → внутрішній формат ────────────────────────────────
  // Вхід:  {ts, sprints:[{num, name, dates, projects:{pid:{done,total,tasks}}}]}
  // Вихід: {_ts, _sprints:[...], [pid]: {sprint1:{done,total}, sprint2:...}}
  function normalizeData(raw) {
    const sprints = (raw.sprints || []).sort((a,b) => a.num - b.num);
    const result  = {_ts: raw.ts, _sprints: sprints, _projects: raw.projects || {}};

    // Зібрати всі унікальні proj IDs
    const allPids = new Set();
    sprints.forEach(sp => Object.keys(sp.projects || {}).forEach(p => allPids.add(p)));

    // Для кожного проекту — дані по кожному спринту
    allPids.forEach(pid => {
      result[pid] = {};
      sprints.forEach(sp => {
        const proj = (sp.projects || {})[pid];
        result[pid]['sprint' + sp.num] = proj
          ? {done: proj.done || 0, total: proj.total || 0,
             postponed: proj.postponed || 0, cancelled: proj.cancelled || 0,
             tasks: proj.tasks || []}
          : {done: 0, total: 0, postponed: 0, cancelled: 0, tasks: []};
      });
    });

    // Плоскі мапи для зворотної сумісності з renderStrategy()
    result._sprint1_all = getSprint(sprints, 1);
    result._sprint2_all = getSprint(sprints, 2);
    result._sprint3_all = getSprint(sprints, 3);

    return result;
  }

  function getSprint(sprints, num) {
    const sp = sprints.find(s => s.num === num);
    return sp ? (sp.projects || null) : null;
  }

  // ── Допоміжні ─────────────────────────────────────────────────────────────
  function sprintSummary(projId, sprintNum) {
    if (!_data || !_data[projId]) return {done:0, total:0, tasks:[]};
    return _data[projId]['sprint' + sprintNum] || {done:0, total:0, tasks:[]};
  }
  function getAllSprints() { return _data ? (_data._sprints || []) : []; }

  // Автооновлення раз на годину
  function startAutoRefresh() {
    setInterval(() => initAll(true).catch(() => {}), CACHE_TTL);
  }

  return { on, summary, initAll, startAutoRefresh, sprintSummary, getAllSprints };
})();

// КРИТИЧНО: top-level const/let у звичайному <script> НЕ потрапляє у window.
// Весь інший код (strategy_scoring.js, index.html) перевіряє саме window.E3D_LOADER,
// тож без цього рядка живі дані з Google Sheets НІКОЛИ не завантажувались —
// дашборд завжди показував лише статичні дані.
window.E3D_LOADER = E3D_LOADER;

// Зворотна сумісність
if (!window.E3D_DATA) {
  window.E3D_DATA = {
    on:      E3D_LOADER.on,
    summary: E3D_LOADER.summary,
    initAll: E3D_LOADER.initAll,
  };
}
