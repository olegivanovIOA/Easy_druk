// ═══════════════════════════════════════════════════════
// Easy 3D Print — Widget Registry & Persistence
// Handles: widget show/hide, order, localStorage persist
// ═══════════════════════════════════════════════════════

window.E3D_WIDGETS = {

  STORAGE_KEY: 'e3d_widget_prefs_v1',

  // ── WIDGET CATALOGUE ──────────────────────────────────
  // Each widget: { id, tab, label, defaultVisible }
  catalogue: [
    // CEO tab
    { id:'ceo-kpi-grid',     tab:'ceo',      label:'Пульс компанії (12 KPI)',         defaultVisible:true },
    { id:'ceo-coverage-kpi', tab:'ceo',      label:'Покриття метрик (прогрес проекту)',defaultVisible:true },
    { id:'ceo-rev-chart',    tab:'ceo',      label:'Динаміка виручки',                defaultVisible:true },
    { id:'ceo-client-conc',  tab:'ceo',      label:'Концентрація клієнтів',           defaultVisible:true },
    { id:'ceo-goals-prog',   tab:'ceo',      label:'Прогрес стратегічних цілей 2026', defaultVisible:true },
    { id:'ceo-team-stats',   tab:'ceo',      label:'Парк та команда',                 defaultVisible:true },
    // STRATEGY tab
    { id:'str-goals',        tab:'strategy', label:'Річні цілі (SMART)',              defaultVisible:true },
    { id:'str-projects',     tab:'strategy', label:'Проекти — скоринг',               defaultVisible:true },
    { id:'str-persons',      tab:'strategy', label:'Скоринг по учасниках',            defaultVisible:true },
    { id:'str-sprint-cur',   tab:'strategy', label:'Поточний спринт',                 defaultVisible:true },
    { id:'str-sprint-prev',  tab:'strategy', label:'Спринт 1 — підсумок',             defaultVisible:true },
    // PROD tab
    { id:'prod-capacity',    tab:'prod',     label:'Потужність та завантаженість',    defaultVisible:true },
    { id:'prod-batch',       tab:'prod',     label:'Партії (Batch)',                  defaultVisible:true },
    { id:'prod-trend',       tab:'prod',     label:'Lead Time та виробіток',          defaultVisible:true },
    // QUAL tab
    { id:'qual-kpis',        tab:'qual',     label:'Показники браку',                 defaultVisible:true },
    { id:'qual-trend',       tab:'qual',     label:'Динаміка браку',                  defaultVisible:true },
    // SALES tab
    { id:'sales-b2b',        tab:'sales',    label:'Продажі ОПТ B2B',                defaultVisible:true },
    { id:'sales-b2c',        tab:'sales',    label:'Продажі Роздріб B2C',             defaultVisible:true },
    { id:'sales-trend',      tab:'sales',    label:'Динаміка виручки',                defaultVisible:true },
    // CRM tab
    { id:'crm-funnel',       tab:'crm',      label:'Воронка та CAC/LTV',             defaultVisible:true },
    { id:'crm-campaigns',    tab:'crm',      label:'Рекламні кампанії',               defaultVisible:true },
    // FIN tab
    { id:'fin-pl',           tab:'fin',      label:'P&L',                             defaultVisible:true },
    { id:'fin-unit',         tab:'fin',      label:'Юніт-економіка',                  defaultVisible:true },
    // HR tab
    { id:'hr-kpis',          tab:'hr',       label:'HR показники',                    defaultVisible:true },
    // LOC tab
    { id:'loc-table',        tab:'loc',      label:'Зведена таблиця локацій',         defaultVisible:true },
    { id:'loc-cards',        tab:'loc',      label:'Картки локацій',                  defaultVisible:true },
    // REGISTRY tab
    { id:'reg-charts',       tab:'registry', label:'Графіки покриття',                defaultVisible:true },
    { id:'reg-table',        tab:'registry', label:'Таблиця реєстру',                 defaultVisible:true },
  ],

  // ── STATE ─────────────────────────────────────────────
  _prefs: null,

  load() {
    try {
      const raw = localStorage.getItem(this.STORAGE_KEY);
      this._prefs = raw ? JSON.parse(raw) : {};
    } catch(e) {
      this._prefs = {};
    }
  },

  save() {
    try { localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this._prefs)); }
    catch(e) { /* quota exceeded — ignore */ }
  },

  isVisible(id) {
    if (!this._prefs) this.load();
    if (this._prefs[id] !== undefined) return this._prefs[id];
    const w = this.catalogue.find(w => w.id === id);
    return w ? w.defaultVisible : true;
  },

  setVisible(id, visible) {
    if (!this._prefs) this.load();
    this._prefs[id] = visible;
    this.save();
  },

  getForTab(tab) {
    return this.catalogue.filter(w => w.tab === tab);
  },
};
