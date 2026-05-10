// ═══════════════════════════════════════════════════════
// Easy 3D Print — Data Source Isolation Layer
//
// Each data source runs in isolation.
// A failure in one source NEVER affects others.
// Every widget gets either real data or a fallback.
// ═══════════════════════════════════════════════════════

window.E3D_DATA = {

  // ── SOURCE REGISTRY ───────────────────────────────────
  sources: {
    projects:     { status:'idle', data:null, error:null, loadedAt:null },
    sprint1:      { status:'idle', data:null, error:null, loadedAt:null },
    sprint2:      { status:'idle', data:null, error:null, loadedAt:null },
    metrics:      { status:'idle', data:null, error:null, loadedAt:null },
    goals:        { status:'idle', data:null, error:null, loadedAt:null },
  },

  // ── FETCH ONE SOURCE ──────────────────────────────────
  // Returns { ok, data, error }
  // NEVER throws — all errors are caught internally
  async fetchSource(key, fetchFn) {
    const src = this.sources[key];
    src.status = 'loading';
    this._notify(key, 'loading');
    try {
      const data = await Promise.race([
        fetchFn(),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 8000)),
      ]);
      if (!data || (Array.isArray(data) && data.length === 0)) throw new Error('empty');
      src.data      = data;
      src.status    = 'ok';
      src.error     = null;
      src.loadedAt  = new Date();
      this._notify(key, 'ok', data);
      return { ok:true, data };
    } catch(e) {
      src.status = 'error';
      src.error  = e.message || 'unknown';
      this._notify(key, 'error', null, src.error);
      return { ok:false, data:null, error:src.error };
    }
  },

  // ── GET DATA (real or fallback) ───────────────────────
  get(key) {
    const src = this.sources[key];
    if (src && src.status === 'ok' && src.data) return { ok:true, data:src.data };
    // Return static fallback
    const fallback = this._fallback(key);
    return { ok:false, data:fallback, error: src?.error || 'not loaded', isStatic:true };
  },

  _fallback(key) {
    const s = window.E3D_STATIC;
    if (!s) return null;
    switch(key) {
      case 'projects':  return s.projects;
      case 'sprint1':   return null;
      case 'sprint2':   return null;
      case 'goals':     return s.goals_1y;
      case 'metrics':   return s.metrics_coverage;
      default:          return null;
    }
  },

  // ── STATUS SUMMARY ────────────────────────────────────
  summary() {
    const entries = Object.entries(this.sources);
    return {
      total:   entries.length,
      ok:      entries.filter(([,s])=>s.status==='ok').length,
      error:   entries.filter(([,s])=>s.status==='error').length,
      loading: entries.filter(([,s])=>s.status==='loading').length,
      idle:    entries.filter(([,s])=>s.status==='idle').length,
    };
  },

  // ── OBSERVER PATTERN ──────────────────────────────────
  _listeners: {},

  on(key, fn) {
    if (!this._listeners[key]) this._listeners[key] = [];
    this._listeners[key].push(fn);
  },

  _notify(key, status, data=null, error=null) {
    (this._listeners[key] || []).forEach(fn => { try { fn({ key, status, data, error }); } catch(e){} });
    (this._listeners['*']  || []).forEach(fn => { try { fn({ key, status, data, error }); } catch(e){} });
  },

  // ── INIT ALL SOURCES IN PARALLEL ──────────────────────
  async initAll() {
    const L = window.E3D_SHEETS;
    if (!L) return;

    // All fetches are independent — one failure cannot block others
    const tasks = [
      this.fetchSource('projects', () => L.loadProjects()),
      this.fetchSource('sprint1',  () => L.loadSprintTasks(L.urls.sprints_s1)),
      this.fetchSource('sprint2',  () => L.loadSprintTasks(L.urls.sprints_s2)),
      this.fetchSource('metrics',  () => L.loadMetrics()),
    ];

    // Fire and forget — each resolves independently
    tasks.forEach(p => p.catch(() => {}));
    return Promise.allSettled(tasks);
  },
};
