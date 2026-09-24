/**
 * freshness.js — Easy 3D Print Dashboard v4.5
 * Єдиний формат "Оновлено: 24.09.26, 03:12 · 5 год тому" для ВСІХ вкладок.
 *
 *  - E3DFresh.fmt(ts)        → рядок "24.09.26, 03:12 · 5 год тому"
 *  - E3DFresh.html(ts,label) → той самий рядок з кольором за віком даних
 *                              (<6 год — звичайний, 6–48 год — бурштин, >48 год — червоний)
 *  - E3DFresh.render(tab)    → для вкладок без власного лоадера-таймстемпа
 *                              (CEO/Стратегія/Виробництво/Якість/Локації) — сам тягне
 *                              fetched_at з JSON-джерел вкладки й малює рядок у шапці панелі.
 *
 * ts: ISO-рядок ('2026-09-24T00:12:29Z'), epoch у мс (strategy.json.ts) або Date.
 */
window.E3DFresh = (() => {
  const TZ = 'Europe/Kyiv';

  function toDate(ts) {
    if (ts == null || ts === '') return null;
    if (ts instanceof Date) return isNaN(ts) ? null : ts;
    if (typeof ts === 'number') return new Date(ts < 1e12 ? ts * 1000 : ts);
    const d = new Date(ts);
    return isNaN(d) ? null : d;
  }

  function ago(d) {
    const min = Math.max(0, Math.round((Date.now() - d.getTime()) / 60000));
    if (min < 1) return 'щойно';
    if (min < 60) return min + ' хв тому';
    const h = Math.floor(min / 60);
    if (h < 24) return h + ' год тому';
    const days = Math.floor(h / 24);
    const rest = h % 24;
    return days + ' дн' + (rest && days < 3 ? ' ' + rest + ' год' : '') + ' тому';
  }

  function ageHours(ts) {
    const d = toDate(ts);
    return d ? (Date.now() - d.getTime()) / 3.6e6 : null;
  }

  function stamp(d) {
    try {
      return d.toLocaleString('uk-UA', { timeZone: TZ, day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
    } catch (e) { return d.toISOString().slice(0, 16).replace('T', ' '); }
  }

  function color(h) {
    if (h == null) return 'var(--tl)';
    if (h > 48) return '#C0392B';
    if (h > 6) return '#BA7517';
    return 'var(--tl)';
  }

  function fmt(ts) {
    const d = toDate(ts);
    return d ? stamp(d) + ' · ' + ago(d) : '—';
  }

  function part(ts, label) {
    const d = toDate(ts);
    const h = ageHours(ts);
    const txt = d ? stamp(d) + ' · <b>' + ago(d) + '</b>' : 'немає даних';
    const warn = h != null && h > 48 ? ' ⚠' : '';
    const tip = d ? d.toISOString() : '';
    return '<span style="color:' + color(h) + '" title="' + (label ? label + ': ' : '') + tip + '">' +
      (label ? label + ' ' : '') + txt + warn + '</span>';
  }

  // Один або кілька джерел: [{ts,label}] або (ts,label)
  function html(tsOrList, label) {
    const list = Array.isArray(tsOrList) ? tsOrList : [{ ts: tsOrList, label }];
    return '<span style="font-size:11px">Оновлено: ' + list.map(s => part(s.ts, s.label)).join(' <span style="color:var(--tl)">|</span> ') + '</span>';
  }

  // ── Автоматичний рядок для вкладок без власного таймстемпа ───────────────
  const SOURCES = {
    ceo:  [{ url: 'data/cashflow.json', label: 'CF' }, { url: 'data/crm_deals.json', label: 'Bitrix' },
           { url: 'data/hr.json', label: 'HR' }, { url: 'data/capacity.json', label: 'Парк' }],
    str:  [{ url: 'data/strategy.json', label: 'Спринти', key: 'ts' }],
    prod: [{ url: 'data/capacity.json', label: 'Парк' }, { url: 'data/batches_lots.json', label: 'Партії' },
           { url: 'data/plan_week.json', label: 'План тижня (ручний експорт)', key: 'generated_at' }],
    qual: [{ url: 'data/batches_lots.json', label: 'Партії/ОТК' }, { url: 'data/crm_deals.json', label: 'Bitrix' }],
    loc:  [{ url: 'data/capacity.json', label: 'Парк' }],
  };

  async function getTs(src) {
    try {
      const r = await fetch(src.url + '?t=' + Date.now());
      if (!r.ok) return null;
      const j = await r.json();
      return j[src.key || 'fetched_at'] ?? j.fetched_at ?? j.ts ?? j.updated_at ?? j.generated_at ?? null;
    } catch (e) { return null; }
  }

  function slot(tab) {
    let el = document.getElementById('fresh-' + tab);
    if (el) return el;
    const panel = document.getElementById('panel-' + tab);
    if (!panel) return null;
    el = document.createElement('div');
    el.id = 'fresh-' + tab;
    el.style.cssText = 'display:flex;justify-content:flex-end;margin:-4px 0 6px;min-height:14px';
    panel.insertBefore(el, panel.firstChild);
    return el;
  }

  async function render(tab) {
    const srcs = SOURCES[tab];
    if (!srcs) return;
    const el = slot(tab);
    if (!el) return;
    const list = await Promise.all(srcs.map(async s => ({ ts: await getTs(s), label: s.label })));
    el.innerHTML = html(list);
  }

  function renderAll() { Object.keys(SOURCES).forEach(render); }

  // Відносний час ("5 год тому") старіє, поки сторінка відкрита — перемальовуємо раз на 5 хв
  if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', () => { renderAll(); setInterval(renderAll, 5 * 60 * 1000); });
  }

  return { fmt, html, render, renderAll, ageHours, toDate };
})();
