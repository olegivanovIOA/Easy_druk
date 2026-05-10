// ═══════════════════════════════════════════════════════
// Easy 3D Print — Google Sheets live loader
// Reads published CSV exports from two Sheets files.
//
// HOW TO PUBLISH:
//   Google Sheets → File → Share → Publish to web
//   Choose sheet → CSV → Copy link
//   Paste the CSV URL below for each sheet/tab
//
// The dashboard works fully offline from static.js;
// this module progressively enhances with live data
// when the sheets are published and accessible.
// ═══════════════════════════════════════════════════════

window.E3D_SHEETS = {

  // ── CONFIG ────────────────────────────────────────────
  // Replace these with your actual Published-CSV URLs
  // Format: https://docs.google.com/spreadsheets/d/{ID}/export?format=csv&gid={GID}

  urls: {
    // Стратегічні цілі та проекти (Проекти sheet)
    // Source: https://docs.google.com/spreadsheets/d/1GD3tyFOC7-0tSjAIR1uaS9H2nbVUwrUFGAbfgBJMV2A/edit#gid=0
    projects:      'https://docs.google.com/spreadsheets/d/1GD3tyFOC7-0tSjAIR1uaS9H2nbVUwrUFGAbfgBJMV2A/export?format=csv&gid=0',
    sprints_s1:    'https://docs.google.com/spreadsheets/d/1GD3tyFOC7-0tSjAIR1uaS9H2nbVUwrUFGAbfgBJMV2A/export?format=csv&gid=sprint1_gid',
    sprints_s2:    'https://docs.google.com/spreadsheets/d/1GD3tyFOC7-0tSjAIR1uaS9H2nbVUwrUFGAbfgBJMV2A/export?format=csv&gid=sprint2_gid',
    goals:         'https://docs.google.com/spreadsheets/d/1GD3tyFOC7-0tSjAIR1uaS9H2nbVUwrUFGAbfgBJMV2A/export?format=csv&gid=goals_gid',

    // Реєстр метрик (Реєстр метрик sheet)
    // Source: https://docs.google.com/spreadsheets/d/1RFZV9ChnSXAkBgW4nv86mWvVqh4vjUKU/edit?gid=485374783
    metrics:       'https://docs.google.com/spreadsheets/d/1RFZV9ChnSXAkBgW4nv86mWvVqh4vjUKU/export?format=csv&gid=485374783',
    metrics_summary: 'https://docs.google.com/spreadsheets/d/1RFZV9ChnSXAkBgW4nv86mWvVqh4vjUKU/export?format=csv&gid=summary_gid',
  },

  // ── CSV PARSER ────────────────────────────────────────
  parseCSV(text) {
    const lines = text.trim().split('\n');
    const headers = lines[0].split(',').map(h => h.replace(/^"|"$/g,'').trim());
    return lines.slice(1).map(line => {
      // handle quoted commas
      const vals = [];
      let cur = '', inQ = false;
      for (const ch of line) {
        if (ch==='"') { inQ=!inQ; } 
        else if (ch===',' && !inQ) { vals.push(cur.trim()); cur=''; }
        else cur += ch;
      }
      vals.push(cur.trim());
      const obj = {};
      headers.forEach((h,i) => obj[h] = (vals[i]||'').replace(/^"|"$/g,''));
      return obj;
    }).filter(r => Object.values(r).some(v=>v));
  },

  // ── FETCH WITH TIMEOUT ────────────────────────────────
  async fetchCSV(url, timeoutMs=6000) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const r = await fetch(url, { signal: ctrl.signal });
      clearTimeout(timer);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.text();
    } catch(e) {
      clearTimeout(timer);
      throw e;
    }
  },

  // ── LOAD PROJECTS from Sheets ─────────────────────────
  async loadProjects() {
    try {
      const csv = await this.fetchCSV(this.urls.projects);
      const rows = this.parseCSV(csv);
      // Map columns: №, Проект (назва), Пріоритет, Відповідальний, Дата старту, Дедлайн, ...
      const projects = rows
        .filter(r => r['№'] && !isNaN(parseInt(r['№'])))
        .map(r => ({
          id:       parseInt(r['№']),
          name:     r['Проект (назва)'] || r['Назва'] || '',
          priority: r['Пріоритет'] || 'B',
          owner:    r['Відповідальний (керівник проекту)'] || r['Відповідальний'] || '',
          start:    r['Дата старту проекту'] || r['Дата старту'] || '',
          deadline: r['Дедлайн'] || '',
          kpi:      r['Які KPI потрібно встановити?'] || r['KPI'] || '',
          // parse progress if column exists
          progress: parseFloat(r['Прогрес'] || r['Progress'] || '0') || 0,
        }));
      console.log(`[Sheets] Loaded ${projects.length} projects`);
      return projects;
    } catch(e) {
      console.warn('[Sheets] Projects load failed, using static data:', e.message);
      return null;
    }
  },

  // ── LOAD SPRINT TASKS ─────────────────────────────────
  async loadSprintTasks(sprintUrl) {
    try {
      const csv = await this.fetchCSV(sprintUrl);
      const rows = this.parseCSV(csv);
      return rows
        .filter(r => r['Задача'] || r['Task'])
        .map(r => ({
          project_id: parseInt(r['№']) || 0,
          project:    r['Проекти (назва)'] || r['Проект'] || '',
          task:       r['Задача'] || r['Task'] || '',
          owner:      r['Відповідальний'] || r['Відповідальний + учасники'] || '',
          start:      r['Дата старту (або проведення зустрічі)'] || '',
          deadline:   r['Дедлайн'] || '',
          result:     r['Очікуваний результат'] || '',
          status:     r['Статус'] || '',
        }));
    } catch(e) {
      console.warn('[Sheets] Sprint load failed:', e.message);
      return null;
    }
  },

  // ── LOAD METRICS REGISTRY ─────────────────────────────
  async loadMetrics() {
    try {
      const csv = await this.fetchCSV(this.urls.metrics);
      const rows = this.parseCSV(csv);
      // columns: consider(ТАК/НІ), section, subsection, metric, formula, granularity, status, comments
      return rows
        .filter(r => {
          const v = (r['Врахову-\nвати?'] || r['Враховувати?'] || r[Object.keys(r)[0]] || '').toUpperCase();
          return v.includes('ТАК') || v.includes('YES');
        })
        .map(r => ({
          consider:    true,
          section:     r['Розділ'] || r[Object.keys(r)[1]] || '',
          subsection:  r['Підрозділ'] || r[Object.keys(r)[2]] || '',
          metric:      r['Метрика / KPI'] || r[Object.keys(r)[3]] || '',
          status:      r['Статус'] || r[Object.keys(r)[6]] || '',
        }));
    } catch(e) {
      console.warn('[Sheets] Metrics load failed, using static data:', e.message);
      return null;
    }
  },

  // ── MAIN INIT (called from dashboard) ─────────────────
  async init(onUpdate) {
    const results = await Promise.allSettled([
      this.loadProjects(),
      this.loadSprintTasks(this.urls.sprints_s2),
      this.loadMetrics(),
    ]);

    const live = {
      projects:    results[0].value,
      sprint_tasks: results[1].value,
      metrics:     results[2].value,
      loaded_at:   new Date().toISOString(),
    };

    // Only call onUpdate if at least one source loaded
    const anyLoaded = Object.values(live).some(v => Array.isArray(v) && v.length > 0);
    if (anyLoaded && typeof onUpdate === 'function') {
      onUpdate(live);
    }
    return live;
  },
};
