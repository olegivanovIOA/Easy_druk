/**
 * org_loader.js — Easy 3D Print Dashboard v4.11
 * Вкладка HR → блок «Оргструктура».
 * Джерело: data/org_structure.json (генерується build_org_structure.py з org_structure.xlsx).
 *
 * Макет: Власник → CEO зверху, під ними департаменти колонками,
 * всередині колонки — вертикальне дерево (відділи → посади).
 * Клік по відділу / керівній посаді згортає-розгортає гілку.
 * Персональних даних (імен) не показує — лише посади (дашборд публічний).
 */
window.OrgLoader = (() => {
  const DATA_URL = 'data/org_structure.json';
  let _nodes = [], _kids = {}, _byId = {};
  let _loaded = false;

  const esc = s => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  async function load() {
    if (_loaded) return;
    _loaded = true;
    const host = document.getElementById('org-tree');
    if (!host) return;
    try {
      const r = await fetch(DATA_URL + '?t=' + Date.now());
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const d = await r.json();
      _nodes = d.nodes || [];
      _kids = {}; _byId = {};
      _nodes.forEach(n => { _byId[n.id] = n; (_kids[n.parent || '__root'] = _kids[n.parent || '__root'] || []).push(n); });
      render(d.updated);
    } catch (e) {
      console.warn('[Org] Не вдалось завантажити org_structure.json:', e);
      host.innerHTML = '<p style="color:var(--tl);font-size:12px">Оргструктура недоступна (data/org_structure.json).</p>';
      _loaded = false;
    }
  }

  // Кількість осіб у вузлі: явне значення або 1 для посад/керівників без числа
  function own(n) {
    if (n.type === 'department' || n.type === 'division') return 0;
    if (!n.parent) return 0; // Власник — поза штатом
    if (n.count != null) return n.count;
    return 1;
  }
  function headcount(id) {
    const n = _byId[id];
    return own(n) + (_kids[id] || []).reduce((s, k) => s + headcount(k.id), 0);
  }
  const isVac = n => /вакан/i.test(n.status || '');
  const isPlan = n => /план/i.test(n.status || '');

  function nodeHtml(n, cls, canTog = true) {
    const vac = isVac(n), plan = isPlan(n);
    const kids = _kids[n.id] || [];
    const cnt = (n.type === 'role' || n.type === 'executive') && n.parent && n.count != null && n.count > 1
      ? `<span class="org-cnt">×${n.count}</span>` : '';
    const hc = (n.type === 'division') ? `<span class="org-hc" title="Осіб у відділі">${headcount(n.id)}</span>` : '';
    const badge = vac ? '<span class="org-badge vac">Вакансія</span>' : plan ? '<span class="org-badge plan">Планується</span>' : '';
    const tog = canTog && kids.length && n.type !== 'role' ? ' org-tog' : '';
    return `<div class="org-n org-${n.type}${vac ? ' is-vac' : ''}${cls ? ' ' + cls : ''}${tog}" data-id="${esc(n.id)}"${tog ? ' role="button" tabindex="0" aria-expanded="true"' : ''}>
      <div class="org-row"><span class="org-name">${esc(n.name)}</span>${cnt}${hc}</div>${badge}</div>`;
  }

  function branch(id) {
    const kids = _kids[id] || [];
    if (!kids.length) return '';
    return '<ul class="org-ul">' + kids.map(k =>
      `<li class="org-li">${nodeHtml(k)}${branch(k.id)}</li>`).join('') + '</ul>';
  }

  function render(updated) {
    const host = document.getElementById('org-tree');
    const root = (_kids['__root'] || [])[0];
    if (!root) { host.innerHTML = '<p style="color:var(--tl)">Порожня структура</p>'; return; }
    const ceo = (_kids[root.id] || []).find(n => n.type === 'executive') || null;
    const top = ceo || root;
    const deps = (_kids[top.id] || []);

    // KPI
    const total = headcount(root.id);
    const nDiv = _nodes.filter(n => n.type === 'division').length;
    const vac = _nodes.filter(isVac);
    setText('org-k-total', total);
    setText('org-k-deps', deps.filter(d => d.type === 'department').length);
    setText('org-k-divs', nDiv);
    setText('org-k-vac', vac.length);
    const vEl = document.getElementById('org-k-vac');
    if (vEl) vEl.className = 'krow-val ' + (vac.length ? 'r' : 'g');
    setText('org-updated', updated ? 'Оновлено: ' + updated.split('-').reverse().join('.') : '');

    host.innerHTML = `
      <div class="org-top">
        ${nodeHtml(root, '', false)}
        ${ceo ? '<div class="org-vline"></div>' + nodeHtml(ceo, '', false) : ''}
        <div class="org-vline"></div>
      </div>
      <div class="org-deps" style="--org-cols:${Math.min(deps.length, 6)}">
        ${deps.map(d => `<div class="org-col">
          <div class="org-dephead">${nodeHtml(d, '', false)}<div class="org-dep-hc">${headcount(d.id)} ос.</div></div>
          ${branch(d.id)}
        </div>`).join('')}
      </div>`;

    host.querySelectorAll('.org-tog').forEach(el => {
      const fn = () => {
        const li = el.parentElement;
        const ul = li && li.querySelector(':scope > .org-ul');
        if (!ul) return;
        const hidden = ul.classList.toggle('org-hidden');
        el.classList.toggle('org-collapsed', hidden);
        el.setAttribute('aria-expanded', String(!hidden));
      };
      el.addEventListener('click', fn);
      el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(); } });
    });
  }

  function setText(id, v) { const el = document.getElementById(id); if (el) el.textContent = v; }

  function toggleAll(expand) {
    document.querySelectorAll('#org-tree .org-ul').forEach(ul => {
      if (ul.parentElement.classList.contains('org-col')) return; // корінь колонки завжди видно
      ul.classList.toggle('org-hidden', !expand);
    });
    document.querySelectorAll('#org-tree .org-tog').forEach(el => {
      el.classList.toggle('org-collapsed', !expand);
      el.setAttribute('aria-expanded', String(expand));
    });
  }

  return { load, toggleAll };
})();

// Легкий JSON — вантажимо одразу (і при відкритті HR, якщо ще не завантажено)
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => window.OrgLoader.load());
else window.OrgLoader.load();
