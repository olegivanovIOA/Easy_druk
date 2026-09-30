/**
 * funnels_loader.js — Easy 3D Print Dashboard v4.9
 * Вкладка «Продажі» → «Воронки CRM по стадіях».
 * Для кожної воронки Bitrix24 (0 ЛИДЫ, 24 ОПТ, 18/32 Роздріб) — угоди, СТВОРЕНІ в обраному
 * періоді (місяць або рік), розкладені по стадіях зліва направо.
 *
 * Джерело: crm_deals.json / crm_monthly_history.json → cohort.pipelines (fetch_crm_deals.py v4.9).
 * «Дійшли до стадії» = угоди, що ЗАРАЗ на цій або подальшій робочій стадії + успішні.
 * Історії переходів між стадіями Bitrix не віддає, тому це стандартне наближення:
 * відмова на будь-якому кроці виводиться окремим блоком «Відмови».
 */
window.FunnelsLoader = (() => {
  const PAL = ['#1f5f8b', '#2b73a3', '#3d86b8', '#529ac9', '#6aaed6', '#86c0e0', '#a3d0e8', '#bfdeee', '#d6e9f3'];
  const WON_C = '#2A9D8F', LOST_C = '#C0392B';
  let _cur = null, _hist = null, _sel = null;

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
      const o = out[p.id] || (out[p.id] = { id: p.id, title: p.title, total: 0, stages: [], _idx: {} });
      o.total += p.total;
      p.stages.forEach(s => {
        let t = o._idx[s.id];
        if (!t) { t = o._idx[s.id] = { id: s.id, name: s.name, sem: s.sem, count: 0, sum: 0 }; o.stages.push(t); }
        t.count += s.count; t.sum += s.sum; t.name = s.name; t.sem = s.sem;
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
      pipes = mergePipelines(ms); label = `рік ${v.slice(1)} · ${ms.length} міс.`;
    } else {
      const m = months.find(x => x.month === v) || months[months.length - 1];
      pipes = m.cohort.pipelines; label = m.month + (m.complete === false ? ' (місяць триває)' : '');
    }
    const note = document.getElementById('sales-funnels-note'); if (note) note.textContent = label;

    // Список воронок (чипи з к-стю) + вибір, яку показати
    if (!_sel || !pipes.some(p => p.id === _sel)) _sel = (pipes.find(p => p.id === 24) || pipes[0]).id;
    const chips = pipes.map(p => {
      const won = p.stages.filter(s => s.sem === 'S').reduce((a, s) => a + s.count, 0);
      const on = p.id === _sel;
      return `<button onclick="FunnelsLoader.pick(${p.id})" style="text-align:left;padding:8px 12px;border-radius:10px;cursor:pointer;border:1px solid ${on ? '#1f5f8b' : 'var(--bd)'};background:${on ? '#EAF2F8' : '#fff'};min-width:180px">
        <div style="font-size:11px;font-weight:700;color:var(--tx)">${p.id} · ${esc(p.title)}</div>
        <div style="font-size:10px;color:var(--tl);margin-top:2px">${p.total.toLocaleString('uk-UA')} створено · ${won} WON${p.total ? ' · ' + (won / p.total * 100).toFixed(1) + '%' : ''}</div></button>`;
    }).join('');
    const p = pipes.find(x => x.id === _sel);
    root.innerHTML = `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">${chips}</div>` + funnelHTML(p);
  }

  function funnelHTML(p) {
    if (!p || !p.total) return '<div style="font-size:11px;color:var(--tl)">У цій воронці немає угод, створених у періоді.</div>';
    const proc = p.stages.filter(s => s.sem !== 'S' && s.sem !== 'F');
    const won = p.stages.filter(s => s.sem === 'S');
    const lost = p.stages.filter(s => s.sem === 'F');
    const wonN = won.reduce((a, s) => a + s.count, 0), wonSum = won.reduce((a, s) => a + s.sum, 0);
    const lostN = lost.reduce((a, s) => a + s.count, 0);
    // «дійшли до стадії i» = зараз на i..кінець робочих + WON
    const tailFrom = i => proc.slice(i).reduce((a, s) => a + s.count, 0) + wonN;
    const cols = proc.map((s, i) => ({ name: s.name, now: s.count, sum: s.sum, reached: tailFrom(i), color: PAL[Math.min(i, PAL.length - 1)] }));
    cols.push({ name: won.map(s => s.name).join(' / ') || 'Успішні', now: wonN, sum: wonSum, reached: wonN, color: WON_C, won: true });
    // Вхід воронки = усі створені (включно з відмовами)
    const entry = p.total;
    const W = 1400, H = 250, top = 30, bot = 70, n = cols.length;
    const cw = W / n, maxH = H - top - bot;
    let svg = `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block" font-family="Inter,system-ui,sans-serif">`;
    cols.forEach((c, i) => {
      const x = i * cw + 4, w = cw - 8;
      const h = Math.max(3, maxH * (c.reached / entry));
      const y = top + (maxH - h) / 2;
      const prev = i ? cols[i - 1].reached : entry;
      const cp = pct(c.reached, prev), ce = pct(c.reached, entry);
      // шар (трапеція до наступної колонки)
      const nx = cols[i + 1];
      if (nx) {
        const nh = Math.max(3, maxH * (nx.reached / entry)), ny = top + (maxH - nh) / 2;
        svg += `<path d="M${x + w},${y} L${x + w + 8},${ny} L${x + w + 8},${ny + nh} L${x + w},${y + h} Z" fill="${c.color}" opacity=".18"/>`;
      }
      svg += `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4" fill="${c.color}" opacity="${c.won ? 0.9 : 0.85}">
        <title>${esc(c.name)}\nДійшли: ${c.reached} (${ce != null ? ce.toFixed(1) : '—'}% від входу)\nЗараз на стадії: ${c.now}\nСума зараз на стадії: ${fmt(c.sum)} грн</title></rect>`;
      const tc = (i < 4 && !c.won) ? '#fff' : '#12303f';
      svg += `<text x="${x + w / 2}" y="${top + maxH / 2 - 2}" text-anchor="middle" font-size="18" font-weight="800" fill="${h > 30 ? tc : '#12303f'}">${c.reached.toLocaleString('uk-UA')}</text>`;
      svg += `<text x="${x + w / 2}" y="${top + maxH / 2 + 15}" text-anchor="middle" font-size="11" fill="${h > 30 ? tc : '#12303f'}" opacity=".9">${ce != null ? ce.toFixed(1) + '%' : ''}</text>`;
      if (i) svg += `<text x="${x - 4}" y="${top - 10}" text-anchor="middle" font-size="11" font-weight="700" fill="${cp != null && cp < 50 ? '#C0392B' : '#1e7a6e'}">→ ${cp != null ? cp.toFixed(0) + '%' : '—'}</text>`;
      // підпис стадії (до 2 рядків)
      const words = String(c.name).split(/\s+/); let l1 = '', l2 = '';
      words.forEach(wd => { if ((l1 + ' ' + wd).trim().length <= 20 && !l2) l1 = (l1 + ' ' + wd).trim(); else l2 = (l2 + ' ' + wd).trim(); });
      if (l2.length > 22) l2 = l2.slice(0, 21) + '…';
      svg += `<text x="${x + w / 2}" y="${H - bot + 18}" text-anchor="middle" font-size="10.5" font-weight="600" fill="#334155">${esc(l1)}</text>`;
      if (l2) svg += `<text x="${x + w / 2}" y="${H - bot + 31}" text-anchor="middle" font-size="10.5" font-weight="600" fill="#334155">${esc(l2)}</text>`;
      svg += `<text x="${x + w / 2}" y="${H - bot + 47}" text-anchor="middle" font-size="9.5" fill="#64748b">зараз: ${c.now}${c.sum ? ' · ' + fmt(c.sum) : ''}</text>`;
    });
    svg += '</svg>';
    // Відмови (окремо, з топ-причинами)
    const lostTop = lost.filter(s => s.count).sort((a, b) => b.count - a.count).slice(0, 6);
    const lostHTML = `<div style="border:1px solid #f3d0cb;background:#FDF4F2;border-radius:10px;padding:10px 12px">
      <div style="font-size:11px;font-weight:700;color:${LOST_C}">Відмови: ${lostN.toLocaleString('uk-UA')} · ${pct(lostN, entry) != null ? pct(lostN, entry).toFixed(1) + '%' : '—'} від створених</div>
      ${lostTop.map(s => `<div style="display:flex;justify-content:space-between;gap:8px;font-size:10.5px;margin-top:4px"><span style="color:var(--tx)">${esc(s.name)}</span><b style="color:${LOST_C}">${s.count} · ${(s.count / entry * 100).toFixed(1)}%</b></div>`).join('')}
    </div>`;
    const inWork = proc.reduce((a, s) => a + s.count, 0);
    const kpi = (l, v, c) => `<div style="flex:1;min-width:120px"><div style="font-size:10px;color:var(--tl)">${l}</div><div style="font-size:16px;font-weight:800;color:${c || 'var(--tx)'}">${v}</div></div>`;
    const note0 = p.id === 0 ? '<div style="font-size:10px;color:#8a6a2b;margin-top:6px">ℹ У воронці 0 (скринінг) успішні заявки переїжджають у продажні воронки 24/18/32, тому WON тут ≈ 0 — конверсію скринінгу дивіться як «не відмова».</div>' : '';
    return `<div class="card" style="padding:12px 14px">
      <div style="display:flex;gap:14px;flex-wrap:wrap;margin-bottom:8px">
        ${kpi('Створено у періоді', entry.toLocaleString('uk-UA'))}
        ${kpi('Зараз у роботі', inWork.toLocaleString('uk-UA'), '#1f5f8b')}
        ${kpi('Успішні (WON)', wonN.toLocaleString('uk-UA') + (entry ? ' · ' + (wonN / entry * 100).toFixed(1) + '%' : ''), WON_C)}
        ${kpi('Сума WON', fmt(wonSum) + ' грн', WON_C)}
        ${kpi('Відмови', lostN.toLocaleString('uk-UA') + (entry ? ' · ' + (lostN / entry * 100).toFixed(1) + '%' : ''), LOST_C)}
      </div>
      <div style="display:grid;grid-template-columns:minmax(0,1fr) 260px;gap:12px;align-items:start">
        <div>${svg}<div style="font-size:9.5px;color:var(--tl);margin-top:2px">Число в колонці — угод, що <b>дійшли</b> до стадії (зараз на ній або далі + WON); % під ним — від створених; «→ %» — конверсія з попередньої стадії. Наведіть на колонку для деталей.</div>${note0}</div>
        ${lostHTML}
      </div></div>`;
  }

  return { load, pick: id => { _sel = id; render(); } };
})();
