/* ═══════════════════════════════════════════════════════════════
   tab_status.js — Easy 3D Print Dashboard v1.1
   Управляє точками статусу та тултіпами на табах.

   Підключити в index.html перед </body>:
   <script src="js/tab_status.js"></script>
   ═══════════════════════════════════════════════════════════════

   Конфіг TAB_STATUS — єдина точка правди.
   Статуси:
     'live'    → зелена точка  "Реальні дані"
     'partial' → жовта точка   "Частково реальні"
     ''        → без точки     (демо)

   Поле source    → назва джерела (показується в тултіпі)
   Поле dataKey   → ключ з data/*.json для авто-читання часу оновлення
                    (якщо є — час береться з fetched_at, інакше — '—')
*/

window.TabStatus = (() => {

  // ─── КОНФІГ ────────────────────────────────────────────────────────────────
  // tab: значення атрибута data-tab або id таб-кнопки
  const TAB_STATUS = [
    { tab: 'ceo',    status: '',         source: '',                dataKey: null },
    { tab: 'str',    status: 'partial',  source: 'Google Sheets',   dataKey: 'strategy' },
    { tab: 'prod',   status: '',         source: '',                dataKey: null },
    { tab: 'qual',   status: '',         source: '',                dataKey: null },
    { tab: 'sales',  status: '',         source: '',                dataKey: null },
    { tab: 'crm',    status: 'partial',  source: 'Google Ads',      dataKey: null },
    { tab: 'fin',    status: 'live',     source: 'CashFlow 2026',   dataKey: 'cashflow' },
    { tab: 'hr',     status: 'live',     source: 'Google Sheets',   dataKey: 'hr' },
    { tab: 'loc',    status: '',         source: '',                dataKey: null },
    { tab: 'reg',    status: '',         source: '',                dataKey: null },
  ];

  const LABELS = {
    live:    { text: 'Реальні дані',       color: '#16A34A', dotColor: '#16A34A' },
    partial: { text: 'Частково реальні',   color: '#BA7517', dotColor: '#BA7517' },
  };

  // Кеш часів оновлення — заповнюється з data/*.json
  const _timestamps = {};

  // ─── ІНІЦІАЛІЗАЦІЯ ─────────────────────────────────────────────────────────
  async function init() {
    // Завантажуємо timestamps з json-файлів де потрібно
    await Promise.allSettled(
      TAB_STATUS
        .filter(t => t.dataKey)
        .map(t => loadTimestamp(t.dataKey))
    );

    TAB_STATUS.forEach(cfg => {
      if (!cfg.status) return;
      const btn = findTabButton(cfg.tab);
      if (!btn) return;
      injectDot(btn, cfg);
      injectTooltip(btn, cfg);
    });
  }

  // ─── Знаходимо кнопку таба ─────────────────────────────────────────────────
  function findTabButton(tabName) {
    // Пробуємо різні варіанти селекторів — адаптується під структуру index.html
    return (
      document.querySelector(`[data-tab="${tabName}"]`) ||
      document.querySelector(`#tab-btn-${tabName}`) ||
      document.querySelector(`.tab-btn[href="#tab-${tabName}"]`) ||
      // fallback: шукаємо по тексту в nav
      [...document.querySelectorAll('.tab-nav button, nav button, .tabs button')]
        .find(el => el.dataset.tab === tabName || el.id?.includes(tabName))
    );
  }

  // ─── Точка статусу ─────────────────────────────────────────────────────────
  function injectDot(btn, cfg) {
    if (btn.querySelector('.e3d-status-dot')) return; // вже є

    const info = LABELS[cfg.status];
    const dot = document.createElement('span');
    dot.className = 'e3d-status-dot';
    dot.style.cssText = `
      display: inline-block;
      width: 7px; height: 7px;
      border-radius: 50%;
      background: ${info.dotColor};
      margin-left: 4px;
      flex-shrink: 0;
      vertical-align: middle;
      position: relative;
      top: -1px;
    `;

    // Пульсація тільки для 'live'
    if (cfg.status === 'live') {
      dot.style.animation = 'e3d-pulse 2.5s ease-in-out infinite';
      ensurePulseKeyframes();
    }

    btn.style.position = 'relative';
    btn.appendChild(dot);
  }

  // ─── Тултіп ────────────────────────────────────────────────────────────────
  function injectTooltip(btn, cfg) {
    if (btn.querySelector('.e3d-tooltip')) return;

    const info = LABELS[cfg.status];
    const ts = cfg.dataKey ? formatTs(_timestamps[cfg.dataKey]) : '—';
    const hasDemoBlocks = cfg.status === 'partial';

    const tip = document.createElement('div');
    tip.className = 'e3d-tooltip';
    tip.style.cssText = `
      display: none;
      position: absolute;
      top: calc(100% + 8px);
      left: 50%;
      transform: translateX(-50%);
      background: var(--color-background-primary);
      border: 0.5px solid var(--color-border-secondary);
      border-radius: 8px;
      padding: 9px 13px;
      font-size: 11px;
      white-space: nowrap;
      z-index: 1000;
      color: var(--color-text-primary);
      min-width: 170px;
      pointer-events: none;
    `;

    tip.innerHTML = `
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;padding-bottom:6px;border-bottom:0.5px solid var(--color-border-tertiary)">
        <span style="width:7px;height:7px;border-radius:50%;background:${info.dotColor};display:inline-block;flex-shrink:0"></span>
        <span style="font-weight:500;color:${info.color}">${info.text}</span>
      </div>
      ${cfg.source ? row('Джерело', cfg.source) : ''}
      ${row('Оновлено', ts)}
      ${row('Демо-блоки', hasDemoBlocks ? 'є' : 'немає')}
    `;

    btn.appendChild(tip);

    // Hover логіка
    btn.addEventListener('mouseenter', () => { tip.style.display = 'block'; });
    btn.addEventListener('mouseleave', () => { tip.style.display = 'none'; });
  }

  function row(label, val) {
    return `<div style="display:flex;justify-content:space-between;gap:16px;margin-bottom:3px">
      <span style="color:var(--color-text-secondary)">${label}</span>
      <span style="font-weight:500">${val}</span>
    </div>`;
  }

  // ─── Завантаження timestamps ────────────────────────────────────────────────
  async function loadTimestamp(key) {
    try {
      const r = await fetch(`data/${key}.json?t=${Date.now()}`);
      if (!r.ok) return;
      const json = await r.json();
      if (json.fetched_at) _timestamps[key] = json.fetched_at;
    } catch (e) {
      // тихо ігноруємо
    }
  }

  function formatTs(isoStr) {
    if (!isoStr) return '—';
    try {
      const d = new Date(isoStr);
      return d.toLocaleString('uk-UA', {
        timeZone: 'Europe/Kyiv',
        day: '2-digit', month: '2-digit',
        hour: '2-digit', minute: '2-digit'
      });
    } catch (e) {
      return isoStr;
    }
  }

  // ─── CSS анімація пульсу (одноразово) ─────────────────────────────────────
  function ensurePulseKeyframes() {
    if (document.getElementById('e3d-pulse-style')) return;
    const style = document.createElement('style');
    style.id = 'e3d-pulse-style';
    style.textContent = `
      @keyframes e3d-pulse {
        0%, 100% { opacity: 1; transform: scale(1); }
        50%       { opacity: 0.5; transform: scale(0.75); }
      }
    `;
    document.head.appendChild(style);
  }

  // ─── Публічний метод оновлення статусу ─────────────────────────────────────
  // Виклик: TabStatus.setStatus('hr', 'live', 'Google Sheets')
  function setStatus(tabName, status, source) {
    const cfg = TAB_STATUS.find(t => t.tab === tabName);
    if (cfg) {
      cfg.status = status;
      cfg.source = source || cfg.source;
    }
    // Перерендер
    const btn = findTabButton(tabName);
    if (btn) {
      btn.querySelector('.e3d-status-dot')?.remove();
      btn.querySelector('.e3d-tooltip')?.remove();
      const newCfg = cfg || { tab: tabName, status, source };
      if (status) {
        injectDot(btn, newCfg);
        injectTooltip(btn, newCfg);
      }
    }
  }

  // ─── Запуск ────────────────────────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  return { init, setStatus };

})();
