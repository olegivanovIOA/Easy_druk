/**
 * funnels_loader.js — Easy 3D Print Dashboard v4.9
 * Вкладка «Продажі» → «Воронки CRM по стадіях».
 * Для кожної воронки Bitrix24 (0 ЛИДЫ, 24 ОПТ, 18/32 Роздріб) — угоди, СТВОРЕНІ в обраному
 * періоді (місяць або рік), розкладені по стадіях зліва направо.
 *
 * Джерело: crm_deals.json / crm_monthly_history.json → cohort.pipelines (fetch_crm_deals.py v4.9).
 * v4.9.1: шари зверху вниз; «дійшли» — з історії переходів (crm.stagehistory.list):
 * найдальша робоча стадія кожної угоди. Відмови розкладено по стадіях, після яких вони сталися.
 * Якщо для періоду історії ще немає (method=current) — наближення за поточною стадією.
 */
window.FunnelsLoader = (() => {
  const PAL = ['#1f5f8b', '#2b73a3', '#3d86b8', '#529ac9', '#6aaed6', '#86c0e0', '#a3d0e8', '#bfdeee', '#d6e9f3'];
  const WON_C = '#2A9D8F', LOST_C = '#C0392B';
  let _cur = null, _hist = null, _sel = null, _collapse = false;

  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fmt = n => n == null ? '—' : Math.abs(n) >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : Math.abs(n) >= 1e3 ? (n / 1e3).toFixed(0) + 'K' : String(Math.round(n));
  const pct = (a, b) => b ? (a / b * 100) : null;

  async function load() {
    const root = document.getElementById('sales-funnels-root'); if (!root) return;
    try {
      [_cur, _hist] = await Promise.all([
        fetch('data/crm_deals.json?t=' + Date.now()).then(r => r.ok ? r.json() : null),
        fetch('data/crm_monthly_history.json?t=' + Date.now()).then(r => r.ok ? r.json() : null).catch(() => null),
      ]);
    } catch (e) { console.warn('[Funnels]', e); }
    const months = monthsWithPipelines();
    if (!months.length) {
      root.innerHTML = '<div style="font-size:11px;color:var(--tl);padding:8px 0">Воронки по стадіях з\'являться після наступного оновлення CRM (для минулих місяців — після Backfill CRM Monthly History).</div>';
      return;
    }
    const sel = document.getElementById('sales-funnels-period');
    if (sel) {
      const years = [...new Set(months.map(m => m.month.slice(0, 4)))];
      sel.innerHTML = months.slice().reverse().map(m => `<option value="${m.month}">${m.month}${m.complete === false ? ' (триває)' : ''}</option>`).join('') +
        years.map(y => `<option value="Y${y}">Рік ${y} (усі місяці)</option>`).join('');
      sel.onchange = render;
    }
    render();
  }

  function monthsWithPipelines() {
    const map = {};
    ((_hist && _hist.months) || []).forEach(m => { if (m.cohort && m.cohort.pipelines) map[m.month] = m; });
    if (_cur && _cur.cohort && _cur.cohort.pipelines) map[_cur.month] = _cur;
    return Object.values(map).sort((a, b) => a.month.localeCompare(b.month));
  }

  // Сумуємо воронки кількох місяців (для «Рік») — по ID стадії, порядок з останнього місяця
  function mergePipelines(list) {
    const out = {};
    list.forEach(m => m.cohort.pipelines.forEach(p => {
      const o = out[p.id] || (out[p.id] = { id: p.id, title: p.title, total: 0, stages: [], _idx: {}, method: 'history' });
      o.total += p.total; if (p.method !== 'history') o.method = 'current'; o.v = Math.min(o.v == null ? 9 : o.v, p.v || 1); o.wonDirect = (o.wonDirect || 0) + (p.wonDirect || 0);
      p.stages.forEach(s => {
        let t = o._idx[s.id];
        if (!t) { t = o._idx[s.id] = { id: s.id, name: s.name, sem: s.sem, count: 0, sum: 0, reached: 0, lostHere: 0 }; o.stages.push(t); }
        t.count += s.count; t.sum += s.sum; t.reached += s.reached || 0; t.lostHere += s.lostHere || 0; t.name = s.name; t.sem = s.sem;
      });
    }));
    // порядок — як у найсвіжішому місяці
    const last = list[list.length - 1].cohort.pipelines;
    return last.map(lp => {
      const o = out[lp.id]; if (!o) return lp;
      const order = lp.stages.map(s => s.id);
      o.stages.sort((a, b) => (order.indexOf(a.id) + 1 || 999) - (order.indexOf(b.id) + 1 || 999));
      delete o._idx; return o;
    });
  }

  function render() {
    const root = document.getElementById('sales-funnels-root'); if (!root) return;
    const months = monthsWithPipelines();
    const sel = document.getElementById('sales-funnels-period');
    const v = sel ? sel.value : months[months.length - 1].month;
    let pipes, label;
    if (v && v[0] === 'Y') {
      const ms = months.filter(m => m.month.startsWith(v.slice(1)));
      pipes = mergePipelines(ms); label = `${ms.length} міс. · угоди, створені за рік`;
    } else {
      const m = months.find(x => x.month === v) || months[months.length - 1];
      pipes = m.cohort.pipelines; label = m.complete === false ? 'місяць триває · угоди, створені в цьому місяці' : 'угоди, створені в цьому місяці';
    }
    const note = document.getElementById('sales-funnels-note'); if (note) note.textContent = label;

    // Список воронок (чипи з к-стю) + вибір, яку показати
    if (_sel == null || !pipes.some(p => p.id === _sel)) _sel = (pipes.find(p => p.id === 24) || pipes[0]).id;
    const chips = pipes.map(p => {
      const won = p.stages.filter(s => s.sem === 'S').reduce((a, s) => a + s.count, 0);
      const on = p.id === _sel;
      return `<button onclick="FunnelsLoader.pick(${p.id})" style="text-align:left;padding:8px 12px;border-radius:10px;cursor:pointer;border:1px solid ${on ? '#1f5f8b' : 'var(--bd)'};background:${on ? '#EAF2F8' : '#fff'};min-width:180px">
        <div style="font-size:11px;font-weight:700;color:var(--tx)">${p.id} · ${esc(p.title)}</div>
        <div style="font-size:10px;color:var(--tl);margin-top:2px">${p.total.toLocaleString('uk-UA')} ${p.id === 0 ? 'звернень' : 'створено'} · ${won} ${p.id === 0 ? 'передано' : 'WON'}${p.total ? ' · ' + (won / p.total * 100).toFixed(1) + '%' : ''}</div></button>`;
    }).join('');
    const p = pipes.find(x => x.id === _sel);
    root.innerHTML = `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">${chips}</div>` + funnelHTML(p);
  }

  // Шари піраміди = робочі стадії воронки в порядку Bitrix (SORT).
  // _collapse=true — стадії, між якими ніхто не зупинився й не відмовився, зливаються в один шар.
  function layers(p) {
    const proc = p.stages.filter(s => s.sem !== 'S' && s.sem !== 'F');
    const won = p.stages.filter(s => s.sem === 'S');
    const wonN = won.reduce((a, s) => a + s.count, 0);
    const hist = p.method === 'history';
    const tailFrom = i => proc.slice(i).reduce((a, s) => a + s.count, 0) + wonN;
    // v1-історія (до v4.9.2) не рахувала WON як «пройшли всі стадії» — підстраховуємось поточною стадією
    const reachedOf = (s, i) => !hist ? (i ? tailFrom(i) : p.total) : (p.v >= 2 ? (s.reached || 0) : (i ? Math.max(s.reached || 0, tailFrom(i)) : (s.reached || p.total)));
    const rows = proc.map((s, i) => ({ names: [s.name], now: s.count, sum: s.sum, reached: reachedOf(s, i), lost: hist ? (s.lostHere || 0) : null }))
      .filter((r, i) => i === 0 || r.reached > 0 || r.now > 0);
    let out = rows;
    if (_collapse) {
      out = [];
      rows.forEach(r => {
        const g = out[out.length - 1];
        if (g && g.reached === r.reached) { g.names.push(...r.names); g.now += r.now; g.sum += r.sum; if (g.lost != null) g.lost += r.lost; }
        else out.push({ ...r, names: [...r.names] });
      });
    }
    return { out, side: [], wonN, wonSum: won.reduce((a, s) => a + s.sum, 0), wonName: won.map(s => s.name).join(' / ') || 'Успішні', hist };
  }

  // Колір шару: від темно-синього (вхід) до світло-блакитного (глибокі стадії)
  function layerColor(i, n) {
    const c1 = [31, 95, 139], c2 = [150, 200, 228], t = n > 1 ? i / (n - 1) : 0;
    return `rgb(${c1.map((v, k) => Math.round(v + (c2[k] - v) * t)).join(',')})`;
  }

  function funnelHTML(p) {
    if (!p || !p.total) return '<div style="font-size:11px;color:var(--tl)">У цій воронці немає угод, створених у періоді.</div>';
    const lost = p.stages.filter(s => s.sem === 'F');
    const lostN = lost.reduce((a, s) => a + s.count, 0);
    const entry = p.total;
    const L = layers(p);
    const isLeads = p.id === 0;
    const finalName = isLeads ? 'Цільові → передано у продажі (24/18/32)' : L.wonName;
    const all = L.out.concat([{ names: [finalName], now: isLeads ? 0 : L.wonN, sum: isLeads ? 0 : L.wonSum, reached: L.wonN, lost: null, won: true }]);
    const inWork = L.out.concat(L.side).reduce((a, r) => a + r.now, 0);
    const MINW = 7;
    const width = r => MINW + (100 - MINW) * Math.min(1, (r.reached || 0) / entry);
    const nP = all.length - 1;
    const bar = (r, i) => {
      const prev = i ? all[i - 1].reached : entry;
      const ce = pct(r.reached, entry), cp = pct(r.reached, prev);
      const t = width(r), nb = all[i + 1] ? width(all[i + 1]) : t * 0.82;
      const col = r.won ? WON_C : layerColor(i, nP);
      const dark = !r.won && i / Math.max(1, nP) > 0.55;
      const tc = t < 16 ? '#12303f' : dark ? '#12303f' : '#fff';
      const name = r.names.length > 1
        ? `${esc(r.names[r.names.length - 1])} <span style="color:var(--tl);font-weight:400">(+${r.names.length - 1})</span>`
        : esc(r.names[0]);
      const tip = esc(r.names.join(' → ')) + `&#10;Дійшли: ${r.reached} (${ce != null ? ce.toFixed(1) : '—'}% від входу)` + (i ? `&#10;Конверсія з попереднього шару: ${cp != null ? cp.toFixed(1) + '%' : '—'}` : '') + `&#10;Зараз на стадії: ${r.now}` + (r.lost != null ? `&#10;Відмовились після цієї стадії: ${r.lost}` : '');
      const poly = `polygon(${50 - t / 2}% 0, ${50 + t / 2}% 0, ${50 + nb / 2}% 100%, ${50 - nb / 2}% 100%)`;
      return `<div title="${tip}" style="display:grid;grid-template-columns:240px minmax(0,1fr);gap:12px;align-items:center;height:30px">
        <div style="font-size:10.5px;font-weight:${r.won ? 800 : 600};color:${r.won ? WON_C : 'var(--tx)'};text-align:right;line-height:1.15;overflow:hidden;max-height:30px">${name}</div>
        <div style="position:relative;height:30px">
          <div style="position:absolute;inset:0 0 1px 0;background:${col};clip-path:${poly}"></div>
          <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:800;color:${tc};text-shadow:${tc === '#fff' ? '0 1px 1px rgba(0,0,0,.25)' : 'none'}">${r.reached.toLocaleString('uk-UA')}<span style="font-weight:500;font-size:10px;margin-left:6px">${ce != null ? ce.toFixed(1) + '%' : ''}</span></div>
        </div>
</div>`;
    };
    // Найбільші «дірки» воронки
    const leaks = L.hist ? L.out.filter(r => r.lost).sort((a, b) => b.lost - a.lost).slice(0, 3) : [];
    const leakHTML = leaks.length ? `<div style="font-size:10.5px;color:var(--tx)">🕳 Найбільше відмов після стадій: ${leaks.map(r => `<b>${esc(r.names[r.names.length - 1])}</b> <span style="color:${LOST_C}">(${r.lost} · ${(r.lost / entry * 100).toFixed(0)}%)</span>`).join(', ')}</div>` : '';
    const directHTML = L.hist && p.wonDirect ? `<div style="font-size:10.5px;color:#8a6a2b;margin-top:2px">⚡ ${p.wonDirect} з ${L.wonN} успішних угод переведено у WON одразу з першої стадії, без проміжних кроків — у піраміді вони рахуються як такі, що пройшли всі стадії.</div>` : '';
    const lostTop = lost.filter(s => s.count).sort((a, b) => b.count - a.count).slice(0, 7);
    const lostHTML = `<div style="border:1px solid #f3d0cb;background:#FDF4F2;border-radius:10px;padding:10px 12px">
      <div style="font-size:11px;font-weight:700;color:${LOST_C}">Відмови: ${lostN.toLocaleString('uk-UA')} · ${pct(lostN, entry) != null ? pct(lostN, entry).toFixed(1) + '%' : '—'} від входу</div>
      <div style="font-size:9.5px;color:var(--tl);margin-top:1px">причини (стадія відмови в Bitrix)</div>
      ${lostTop.map(s => `<div style="display:flex;justify-content:space-between;gap:8px;font-size:10.5px;margin-top:4px"><span style="color:var(--tx)">${esc(s.name)}</span><b style="color:${LOST_C};white-space:nowrap">${s.count} · ${(s.count / entry * 100).toFixed(1)}%</b></div>`).join('')}
    </div>`;
    const kpi = (l, v, c) => `<div style="flex:1;min-width:120px"><div style="font-size:10px;color:var(--tl)">${l}</div><div style="font-size:16px;font-weight:800;color:${c || 'var(--tx)'}">${v}</div></div>`;
    const methodNote = L.hist
      ? 'Кожна угода рахується до <b>найдальшої стадії, до якої вона реально дійшла</b> (історія переходів Bitrix). Успішні угоди рахуються як такі, що пройшли всі стадії. Наведіть на шар — конверсія з попереднього шару, відмови після стадії, скільки угод зараз на ній.'
      : '⚠ Для цього періоду ще немає історії переходів — «дійшли» рахується лише за поточною стадією, відмови по кроках не розкладено. Запустіть Backfill CRM Monthly History.';
    const sideNote = L.side.length ? `<div style="font-size:9.5px;color:var(--tl);margin-top:3px">Поза основним шляхом до WON: ${L.side.map(r => esc(r.names.join(', ')) + ` (дійшли ${r.reached}${r.now ? ', зараз ' + r.now : ''})`).join('; ')}.</div>` : '';
    const note0 = isLeads && !L.hist ? '<div style="font-size:10px;color:#8a6a2b;margin-top:6px">ℹ Цільові звернення переїжджають у воронки 24/18/32 — без історії переходів їх тут не видно.</div>' : '';
    return `<div class="card" style="padding:12px 14px">
      <div style="display:flex;gap:14px;flex-wrap:wrap;margin-bottom:10px">
        ${kpi(isLeads ? 'Звернень на скринінгу' : 'Створено у періоді', entry.toLocaleString('uk-UA'))}
        ${kpi('Зараз у роботі', inWork.toLocaleString('uk-UA'), '#1f5f8b')}
        ${kpi(isLeads ? 'Передано у продажі' : 'Успішні (WON)', L.wonN.toLocaleString('uk-UA') + (entry ? ' · ' + (L.wonN / entry * 100).toFixed(1) + '%' : ''), WON_C)}
        ${isLeads ? '' : kpi('Сума WON', fmt(L.wonSum) + ' грн', WON_C)}
        ${kpi('Відмови', lostN.toLocaleString('uk-UA') + (entry ? ' · ' + (lostN / entry * 100).toFixed(1) + '%' : ''), LOST_C)}
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:6px">
        <div>${leakHTML}${directHTML}</div>
        <label style="font-size:10.5px;color:var(--tl);cursor:pointer;white-space:nowrap"><input type="checkbox" ${_collapse ? 'checked' : ''} onchange="FunnelsLoader.collapse(this.checked)" style="vertical-align:middle"> згорнути стадії без змін</label>
      </div>
      <div style="display:grid;grid-template-columns:minmax(0,1fr) 270px;gap:14px;align-items:start">
        <div>${all.map(bar).join('')}<div style="font-size:9.5px;color:var(--tl);margin-top:6px;line-height:1.4">${methodNote}</div>${sideNote}${note0}</div>
        ${lostHTML}
      </div></div>`;
  }

  return { load, pick: id => { _sel = id; render(); }, collapse: v => { _collapse = !!v; render(); } };
})();
