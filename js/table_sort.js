/**
 * table_sort.js — Easy 3D Print Dashboard v7.4
 * Сортування будь-якої таблиці на вкладці «Маркетинг» кліком по назві колонки (▼/▲).
 *  - числа розпізнаються з форматів дашборду: «1 234», «4.6M», «72K», «12.5%», «54 000 грн», «3.74x»;
 *    у клітинках «число + частка дрібним шрифтом» береться перше число;
 *  - «—», «н/д», порожні — завжди внизу; рядки «Інші…» / «Разом» лишаються в кінці;
 *  - сортування зберігається, коли таблиця перемальовується (зміна періоду/фільтра);
 *  - таблиця ROI має власне сортування (th[data-k]) — її не чіпаємо.
 */
(() => {
  const PANELS = ['panel-crm'];
  const state = new Map();            // підпис таблиці (тексти заголовків) → {col, dir}
  let busy = false;

  const sig = t => [...t.querySelectorAll('thead th')].map(th => th.dataset.lbl || th.textContent.trim()).join('|');
  const eligible = t => t && t.tHead && t.tBodies[0] && !t.classList.contains('roi-ddt') && !t.dataset.nosort &&
    !t.querySelector('thead th[data-k]');

  function cellVal(td) {
    if (!td) return null;
    const sel = td.querySelector('select');
    let txt = sel ? (sel.selectedOptions[0] || {}).text || '' : '';
    if (!txt) {   // перший текстовий вузол з цифрами (щоб «9 351 47.8%» не злипалось)
      const w = document.createTreeWalker(td, NodeFilter.SHOW_TEXT);
      let n, first = '';
      while ((n = w.nextNode())) { const v = n.nodeValue.trim(); if (!v) continue; if (!first) first = v; if (/\d/.test(v)) { txt = v; break; } }
      txt = txt || first || td.textContent.trim();
    }
    txt = txt.replace(/ /g, ' ').trim();
    if (!txt || /^(—|-|–|н\/д|n\/a)$/i.test(txt)) return null;
    const m = txt.match(/^([+−-]?)\s*(\d[\d ]*(?:[.,]\d+)?)\s*([KMКМ])?/i);
    if (m && (/^[+−-]?\s*\d/.test(txt))) {
      let v = parseFloat(m[2].replace(/ /g, '').replace(',', '.'));
      const suf = (m[3] || '').toUpperCase();
      if (suf === 'K' || suf === 'К') v *= 1e3; else if (suf === 'M' || suf === 'М') v *= 1e6;
      return m[1] && m[1] !== '+' ? -v : v;
    }
    return txt.toLowerCase();
  }
  const pinned = tr => /^(інші|разом|итого|всього|усього)/i.test((tr.cells[0] && tr.cells[0].textContent || '').trim());

  function sortTable(t, col, dir) {
    const tb = t.tBodies[0];
    const rows = [...tb.rows].filter(r => r.cells.length > col && !r.querySelector('td[colspan]'));
    if (rows.length < 2) return;
    const keep = [...tb.rows].filter(r => !rows.includes(r));
    const top = rows.filter(r => !pinned(r)), bottom = rows.filter(pinned);
    const vals = new Map(top.map(r => [r, cellVal(r.cells[col])]));
    top.sort((a, b) => {
      const x = vals.get(a), y = vals.get(b);
      if (x == null && y == null) return 0; if (x == null) return 1; if (y == null) return -1;
      if (typeof x === 'number' && typeof y === 'number') return (x - y) * dir;
      return String(x).localeCompare(String(y), 'uk') * dir;
    });
    busy = true;
    top.concat(bottom, keep).forEach(r => tb.appendChild(r));
    [...t.tHead.rows[t.tHead.rows.length - 1].cells].forEach((th, i) => {
      const a = th.querySelector('.ts-arr'); if (a) a.remove();
      if (i === col) th.insertAdjacentHTML('beforeend', `<span class="ts-arr">${dir > 0 ? '▲' : '▼'}</span>`);
    });
    busy = false;
  }

  document.addEventListener('click', ev => {
    const th = ev.target.closest('thead th'); if (!th || ev.target.closest('select,input,a,.roi-i')) return;
    const t = th.closest('table'); if (!eligible(t) || !PANELS.some(id => t.closest('#' + id))) return;
    const row = th.parentElement, col = [...row.cells].indexOf(th);
    if (row !== t.tHead.rows[t.tHead.rows.length - 1] || col < 0) return;
    if (!th.dataset.lbl) [...row.cells].forEach(c => { c.dataset.lbl = c.textContent.replace(/[▲▼]/g, '').trim(); });
    const key = sig(t), cur = state.get(key);
    let dir;
    if (cur && cur.col === col) dir = -cur.dir;
    else { const sample = [...t.tBodies[0].rows].map(r => cellVal(r.cells[col])).find(v => v != null); dir = typeof sample === 'number' ? -1 : 1; }
    state.set(key, { col, dir });
    sortTable(t, col, dir);
  });

  // таблиці перемальовуються при зміні періоду/фільтрів — повторюємо збережене сортування
  let tm = null;
  const reapply = () => {
    PANELS.forEach(id => { const p = document.getElementById(id); if (!p) return;
      p.querySelectorAll('table').forEach(t => {
        if (!eligible(t)) return;
        const hr = t.tHead.rows[t.tHead.rows.length - 1];
        if (hr && ![...hr.cells].some(c => c.dataset.lbl)) [...hr.cells].forEach(c => { c.dataset.lbl = c.textContent.replace(/[▲▼]/g, '').trim(); });
        const st = state.get(sig(t)); if (st) sortTable(t, st.col, st.dir);
      });
    });
  };
  const obs = new MutationObserver(() => { if (busy) return; clearTimeout(tm); tm = setTimeout(() => { reapply(); obs.takeRecords(); }, 60); });
  const start = () => PANELS.forEach(id => { const p = document.getElementById(id); if (p) obs.observe(p, { childList: true, subtree: true }); });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
