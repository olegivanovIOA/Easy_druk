/* global_period.js — v7.36: ОДИН фільтр періоду на весь дашборд.
 *
 * Рік / місяць у шапці (#ysel / #msel) керують усіма блоками, що мають власний вибір періоду.
 * Локальні селектори не видаляються (модулі працюють як раніше), а ховаються й отримують значення
 * з шапки; замість них — сірий бейдж «📅 Жовтень 2026 · фільтр угорі».
 *
 * Відповідність:
 *   місяць у шапці        → опція «YYYY-MM» блоку (якщо такого місяця в блоці немає — найближчий, з ⚠ у бейджі)
 *   «Усі місяці» + рік    → «Y{рік}» / «ytd» (для поточного року) / «all» / останній місяць року
 *   ROI кампаній          → режим «Місяць» або «Рік»
 * У зовнішньому SEO-звіті цей файл не підключається — там лишаються локальні перемикачі.
 */
(function () {
  const ML = ['Січень', 'Лютий', 'Березень', 'Квітень', 'Травень', 'Червень', 'Липень', 'Серпень', 'Вересень', 'Жовтень', 'Листопад', 'Грудень'];
  // локальні селектори періоду (id) — усі ховаються й слухаються шапки
  const SELS = ['sf-s-per', 'qual-batches-period', 'sf-d-per', 'sf-q-per', 'sf-l-per', 'sales-funnels-period', 'tiers-period',
    'loss-reasons-total-period', 'mkt-leadgen-period', 'mkt-channels-period', 'sf-h-per', 'sf-t-per'];
  const $ = id => document.getElementById(id);

  function state() {
    const now = new Date();
    const ys = $('ysel'), ms = $('msel');
    let y = ys ? ys.value : String(now.getFullYear());
    if (y === 'all') y = String(now.getFullYear());   // «Усі роки» — блоки з помісячними даними показують поточний рік
    const m = ms ? ms.value : 'all';
    return { y, m, ym: m === 'all' ? null : y + '-' + String(+m + 1).padStart(2, '0'), allYears: ys && ys.value === 'all' };
  }
  const label = s => s.ym ? `${ML[+s.m]} ${s.y}` : (s.allYears ? 'Усі роки' : `${s.y} рік`);

  // найкраща опція селектора для стану шапки
  function pick(sel, s) {
    const vals = [...sel.options].map(o => o.value);
    if (!vals.length) return null;
    const months = vals.filter(v => /^\d{4}-\d{2}$/.test(v)).sort();
    if (s.ym) {
      if (vals.includes(s.ym)) return { v: s.ym };
      if (!months.length) return null;
      // немає такого місяця: беремо найближчий
      const near = months.reduce((b, v) => Math.abs(cmpYm(v, s.ym)) < Math.abs(cmpYm(b, s.ym)) ? v : b, months[0]);
      return { v: near, warn: `за ${label(s)} даних немає — показано ${near}` };
    }
    const cur = String(new Date().getFullYear());
    if (s.allYears && vals.includes('all')) return { v: 'all' };
    if (vals.includes('Y' + s.y)) return { v: 'Y' + s.y };
    if (s.y === cur && vals.includes('ytd')) return { v: 'ytd' };
    if (vals.includes('all')) return { v: 'all' };
    const inY = months.filter(v => v.startsWith(s.y + '-'));
    if (inY.length) return { v: inY[inY.length - 1], warn: 'блок показує один місяць — останній за рік' };
    return months.length ? { v: months[months.length - 1], warn: `за ${s.y} даних немає` } : null;
  }
  const cmpYm = (a, b) => { const [ay, am] = a.split('-').map(Number), [by, bm] = b.split('-').map(Number); return (ay * 12 + am) - (by * 12 + bm); };

  function badge(after, key, txt, warn) {
    let b = document.querySelector(`.gp-badge[data-for="${key}"]`);
    if (!b) {
      b = document.createElement('span'); b.className = 'gp-badge'; b.dataset.for = key;
      b.title = 'Період задається одним фільтром у шапці дашборда (Рік / Місяць). Клік — до фільтра';
      b.onclick = () => { const m = $('msel'); if (m) { m.scrollIntoView({ block: 'nearest' }); m.focus(); } };
      after.insertAdjacentElement('afterend', b);
    }
    b.innerHTML = `📅 ${txt}${warn ? ` <span class="gp-w">⚠ ${warn}</span>` : ''}`;
  }

  let busy = false;
  function applySel(id, s) {
    const sel = $(id); if (!sel) return;
    sel.classList.add('gp-hidden');
    const p = pick(sel, s);
    badge(sel, id, label(s), p && p.warn);
    if (!p || sel.value === p.v) return;
    sel.value = p.v;
    busy = true;
    try { sel.dispatchEvent(new Event('change', { bubbles: true })); } catch (e) { console.warn('[GP]', id, e); }
    busy = false;
  }

  function applyRoi(s) {
    const seg = $('roi-mode'); if (!seg) return;
    const box = seg.parentElement;
    box.classList.add('gp-hidden');
    badge(box, 'roi', label(s), null);
    const btn = m => seg.querySelector(`button[data-m="${m}"]`);
    try {
      // значення спершу, режим потім (клік по режиму перемальовує таблицю вже з новим періодом)
      if (s.ym) {
        const i = $('roi-month'); if (i) { i.value = s.ym; i.dispatchEvent(new Event('change', { bubbles: true })); }
        btn('month').click();
      } else {
        const ys = $('roi-year');
        if (ys && [...ys.options].some(o => o.value === s.y)) { ys.value = s.y; ys.dispatchEvent(new Event('change', { bubbles: true })); }
        btn('year').click();
      }
    } catch (e) { console.warn('[GP] roi', e); }
  }

  function apply() {
    const s = state();
    SELS.forEach(id => applySel(id, s));
    applyRoi(s);
  }

  // опції в блоках з'являються асинхронно (після завантаження даних) — застосовуємо фільтр щоразу, коли вони змінюються
  const watched = new WeakSet();
  function watch() {
    SELS.forEach(id => {
      const sel = $(id); if (!sel || watched.has(sel)) return;
      watched.add(sel);
      new MutationObserver(() => { if (!busy) applySel(id, state()); }).observe(sel, { childList: true });
    });
    const seg = $('roi-mode');
    if (seg && !watched.has(seg)) { watched.add(seg); new MutationObserver(() => applyRoi(state())).observe($('roi-year') || seg, { childList: true }); }
  }

  // шапка: обгортаємо setY / setM (старі графіки) — і застосовуємо до всіх блоків
  const wrap = name => { const f = window[name]; if (typeof f !== 'function' || f._gp) return; const g = function (v) { const r = f.apply(this, arguments); apply(); return r; }; g._gp = true; window[name] = g; };
  function init() {
    wrap('setY'); wrap('setM');
    const css = document.createElement('style');
    css.textContent = `.gp-hidden{display:none!important}
.gp-badge{display:inline-flex;align-items:center;gap:4px;font-size:10px;font-weight:600;color:#5f6b66;background:#eef1ec;border:1px solid var(--bd,#e3e7e2);border-radius:6px;padding:3px 8px;cursor:pointer;white-space:nowrap}
.gp-badge:hover{background:#e3e9e1}.gp-badge .gp-w{color:#B7791F;font-weight:500}
#msel,#ysel{font-weight:700}`;
    document.head.appendChild(css);
    watch(); apply();
    // вкладки й модулі довантажуються — кілька повторних проходів, потім лише MutationObserver
    [800, 2000, 4000, 8000].forEach(t => setTimeout(() => { watch(); apply(); }, t));
    document.addEventListener('click', e => { if (e.target.closest && e.target.closest('[data-tab]')) setTimeout(() => { watch(); apply(); }, 600); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  window.GlobalPeriod = { apply, state };
})();
