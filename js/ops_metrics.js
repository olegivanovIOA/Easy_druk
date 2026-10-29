/**
 * ops_metrics.js — Easy 3D Print Dashboard v7.21
 * Розрахункові метрики з уже зібраних даних (нових запитів до API немає):
 *   • OEE по локаціях = A × P × Q
 *       A (доступність)   — робочий парк / весь парк (Гант: мінус ремонт, ТО, резерв)          ← gantt.json
 *       P (завантаженість) — зайняті машини / парк (факт за добу)                                ← capacity / capacity_history
 *       Q (якість)         — 1 − брак ОТК (браковані / прийняті на ОТК)                         ← batches_history
 *   • Простої, машино-год — парк × (1 − завантаженість) × 24; ремонт/ТО — машини в ремонті зараз × 24
 *   • Сировина — кг за типом пластику й кольором, брак у вазі, кг на партію                    ← batches_monthly_history.materials
 *   • Люди під план — машин на оператора-зміну (факт 30 дн) → скільки операторо-змін потребує план Ганта
 *   • Трудомісткість — людино-годин цеху на 1000 деталей                                        ← shopfloor + batches_history
 * Плюс зведення плану Ганта для вкладки CEO і карток Локацій.
 * Дані цеху беруться з тих самих файлів, що вже завантажує js/shopfloor_loader.js (без повторного завантаження).
 */
window.E3DOps = (() => {
  const $ = id => document.getElementById(id);
  const G = '#2A9D8F', A = '#457B9D', R = '#C0392B', Y = '#BA7517', GD = '#1F7A6E', GRID = '#f0f2ee';
  const LOC_C = { '1': G, '2': A, '4': R, '5': '#6aA5C2', '6': '#BA7517', '101': '#6B4E9B' };
  const MAT_C = { PETG: '#2A9D8F', PLA: '#BA7517', ABS: '#C0392B', TPU: '#6B4E9B', ASA: '#457B9D', 'Невідомо': '#C9CFCB' };
  const MS = ['січ', 'лют', 'бер', 'кві', 'тра', 'чер', 'лип', 'сер', 'вер', 'жов', 'лис', 'гру'];
  const fmt = v => v == null || isNaN(v) ? '—' : Math.round(v).toLocaleString('uk-UA');
  const f1 = v => v == null || isNaN(v) ? '—' : (+v).toLocaleString('uk-UA', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
  const pct = (v, d) => v == null || isNaN(v) ? '—' : (+v).toFixed(d || 0) + '%';
  const kfmt = v => v == null ? '—' : Math.abs(v) >= 1e4 ? (v / 1000).toLocaleString('uk-UA', { maximumFractionDigits: 1 }) + ' тис.' : fmt(v);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const kyivToday = () => { try { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv' }).format(new Date()); } catch (e) { return new Date().toISOString().slice(0, 10); } };
  const addD = (s, n) => { const d = new Date(s + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const fD = d => d ? d.slice(8, 10) + '.' + d.slice(5, 7) : '—';
  const locNum = s => String(s == null ? '' : s).replace(/\D/g, '') || String(s);

  let S = null, GT = null, GH = null, _p = null, _charts = {};
  const done = {};

  function chart(id, cfg) {
    const c = $(id); if (!c || typeof Chart === 'undefined') return;
    if (_charts[id]) { try { _charts[id].destroy(); } catch (e) {} }
    cfg.options = cfg.options || {};
    cfg.options.plugins = Object.assign({ datalabels: { display: false } }, cfg.options.plugins || {});
    _charts[id] = new Chart(c, cfg);
  }

  function load() {
    if (_p) return _p;
    const j = u => fetch(u + '?t=' + Date.now()).then(r => r.ok ? r.json() : null).catch(() => null);
    const sf = window.Shopfloor && Shopfloor.load ? Shopfloor.load().then(() => Shopfloor.get()) :
      Promise.all(['shopfloor', 'capacity', 'batches_history', 'batches_monthly_history', 'capacity_history'].map(n => j('data/' + n + '.json')))
        .then(([D, CAP, BH, BMH, CH]) => ({ D, CAP, BH, BMH, CH }));
    _p = Promise.all([sf, j('data/gantt.json'), j('data/gantt_history.json')]).then(([s, g, gh]) => { S = s || {}; GT = g; GH = gh; api.ready = true; });
    return _p;
  }

  // ── базові ряди ─────────────────────────────────────────────────────────────────────────────────────
  const today = kyivToday();
  function capDays(n) {         // повні дні capacity_history (без поточної неповної доби), останні n
    const ds = ((S.CH && S.CH.days) || []).filter(d => d.date < today && Object.values(d.locations || {}).some(l => (l.util || 0) > 0));
    return n ? ds.slice(-n) : ds;
  }
  function activeLocs() {
    const cap = (S.CAP && S.CAP.locations) || [];
    return cap.map(l => locNum(l.location));
  }
  function ganttLoc(k) { return GT && GT.locations ? GT.locations.find(l => l.key === k) : null; }

  // ── 1) OEE ──────────────────────────────────────────────────────────────────────────────────────────
  function oee() {
    const days = capDays(30), from = days.length ? days[0].date : addD(today, -30);
    const bh = ((S.BH && S.BH.days) || []).filter(d => d.date >= from && d.date < today);
    const capNow = {}; ((S.CAP && S.CAP.locations) || []).forEach(l => { capNow[locNum(l.location)] = l; });
    const rows = activeLocs().map(k => {
      const g = ganttLoc(k), m = g && g.machines;
      const Av = m && m.total ? m.effective / m.total : null;
      const ut = days.map(d => d.locations && d.locations[k] && d.locations[k].util).filter(v => v != null);
      const P30 = ut.length ? ut.reduce((a, b) => a + b, 0) / ut.length / 100 : null;
      const Pnow = capNow[k] && capNow[k].machines ? (capNow[k].machines.utilizationPercent || 0) / 100 : null;
      let acc = 0, dfc = 0; bh.forEach(d => { const x = d.locations && d.locations[k]; if (x) { acc += x.acceptedQty || 0; dfc += x.defectQty || 0; } });
      const Q30 = acc ? 1 - dfc / acc : null;
      const lastB = bh.slice().reverse().find(d => d.locations && d.locations[k] && d.locations[k].acceptedQty);
      const Qlast = lastB ? 1 - (lastB.locations[k].defectQty || 0) / lastB.locations[k].acceptedQty : Q30;
      const total = (m && m.total) || (capNow[k] && capNow[k].machines && capNow[k].machines.total) || 0;
      const o = (a, p, q) => p == null || q == null ? null : (a == null ? 1 : a) * p * q * 100;
      return { k, name: 'Локація ' + k, total, A: Av, P30, Pnow, Q30, Qlast, acc, dfc, oee30: o(Av, P30, Q30), oeeNow: o(Av, Pnow, Qlast), aKnown: Av != null };
    });
    const T = rows.reduce((t, r) => t + r.total, 0) || 1;
    const w = f => rows.filter(r => r[f] != null).reduce((s, r) => s + r[f] * r.total, 0) / (rows.filter(r => r[f] != null).reduce((s, r) => s + r.total, 0) || 1);
    const tm = GT && GT.total && GT.total.machines;
    const acc = rows.reduce((s, r) => s + r.acc, 0), dfc = rows.reduce((s, r) => s + r.dfc, 0);
    const lastAll = ((S.BH && S.BH.days) || []).filter(d => d.date < today).slice(-1)[0];
    const qLast = lastAll && lastAll.company && lastAll.company.acceptedQty ? 1 - (lastAll.company.defectQty || 0) / lastAll.company.acceptedQty : null;
    const tot = { k: '*', name: 'Парк', total: T, A: tm && tm.total ? tm.effective / tm.total : null, P30: w('P30'), Pnow: w('Pnow'), Q30: acc ? 1 - dfc / acc : null, Qlast: qLast };
    tot.oee30 = tot.P30 != null && tot.Q30 != null ? (tot.A == null ? 1 : tot.A) * tot.P30 * tot.Q30 * 100 : null;
    tot.oeeNow = tot.Pnow != null && tot.Qlast != null ? (tot.A == null ? 1 : tot.A) * tot.Pnow * tot.Qlast * 100 : null;
    return { rows, tot, days: days.length };
  }

  // ── 2) Простої ──────────────────────────────────────────────────────────────────────────────────────
  function idle() {
    const all = capDays(0), last = all.slice(-30);
    const per = {}, monthly = {};
    all.forEach(d => Object.entries(d.locations || {}).forEach(([k, l]) => {
      if (l.util == null || !l.total) return;
      const mh = l.total * (1 - l.util / 100) * 24, m = d.date.slice(0, 7);
      const x = (monthly[m] || (monthly[m] = {})); x[k] = (x[k] || 0) + mh;
      (monthly[m]._cap = (monthly[m]._cap || 0) + l.total * 24);
    }));
    last.forEach(d => Object.entries(d.locations || {}).forEach(([k, l]) => {
      if (l.util == null || !l.total) return;
      const x = per[k] || (per[k] = { idle: 0, cap: 0, days: 0 }); x.idle += l.total * (1 - l.util / 100) * 24; x.cap += l.total * 24; x.days++;
    }));
    const rows = activeLocs().filter(k => per[k]).map(k => {
      const x = per[k], g = ganttLoc(k), m = (g && g.machines) || {};
      const rep = m.repair != null ? m.repair : m.maintenance, pm = m.plannedMaintenance || 0;
      const maintDay = ((m.maintenance != null ? m.maintenance : (rep || 0) + pm) + (m.reserved || 0)) * 24;
      const idleDay = x.idle / x.days;
      return { k, idleDay, share: x.idle / x.cap * 100, maintDay, rep, pm, noOrders: Math.max(0, idleDay - maintDay), days: x.days };
    });
    const t = rows.reduce((a, r) => ({ idleDay: a.idleDay + r.idleDay, maintDay: a.maintDay + r.maintDay, noOrders: a.noOrders + r.noOrders }), { idleDay: 0, maintDay: 0, noOrders: 0 });
    const capDay = Object.values(per).reduce((s, x) => s + x.cap / x.days, 0);
    t.share = capDay ? t.idleDay / capDay * 100 : null; t.days = last.length;
    return { rows, tot: t, monthly };
  }

  // ── 3) Сировина ─────────────────────────────────────────────────────────────────────────────────────
  function material() {
    const ms = ((S.BMH && S.BMH.months) || []).filter(m => m.materials && m.materials.kg);
    const cur = ((S.BMH && S.BMH.months) || []).slice(-1)[0];
    const capD = capDays(30), batchKg = capD.map(d => Object.values(d.locations || {}).reduce((s, l) => s + (l.batchKg || 0), 0)).filter(v => v > 0);
    const capT = (S.CAP && S.CAP.totals) || {};
    return { ms, cur, curMat: cur && cur.materials, avgDay: batchKg.length ? batchKg.reduce((a, b) => a + b, 0) / batchKg.length : null, nDay: batchKg.length,
      planKg: capT.plan && capT.plan.weightKg, printedKg: capT.printed && capT.printed.weightKg };
  }

  // ── 4) Люди під план ────────────────────────────────────────────────────────────────────────────────
  function people() {
    const D = S.D; if (!D || !D.months) return null;
    const from = addD(today, -30);
    const od = []; Object.keys(D.months).forEach(m => (D.months[m].operatorDays || []).forEach(r => { if (r[0] >= from && r[0] < today) od.push(r); }));
    const capBy = {}; capDays(0).forEach(d => { capBy[d.date] = d.locations || {}; });
    const rows = activeLocs().map(k => {
      const mine = od.filter(r => String(r[2]) === k);
      const days = [...new Set(mine.map(r => r[0]))];
      const os = mine.reduce((s, r) => s + (r[3] || 0), 0);
      const ms = days.reduce((s, d) => { const l = capBy[d] && capBy[d][k]; return s + (l && l.util != null ? l.util / 100 * (l.total || 0) * 2 : 0); }, 0);
      const ratio = os ? ms / os : null;                 // машин на оператора-зміну (факт)
      const actual = days.length ? os / days.length : null; // операторо-змін на добу (факт)
      // план Ганта: зайняті машино-зміни на добу, з завтрашнього дня, 7 діб
      // беремо лише дні, які план уже заповнив (≥5% робочого парку зайнято) — порожній «хвіст» Ганта не означає, що людей не треба
      const g = ganttLoc(k), eff = g && g.machines ? g.machines.effective || 0 : 0; let busy = 0, nd = 0, seen = 0;
      if (g && GT.dates) GT.dates.forEach((d, i) => { if (d <= today || seen >= 7) return; const r = g.d[i]; if (!r) return; seen++;
        const b = (r[2] ? r[1] || 0 : 0) + (r[5] ? r[4] || 0 : 0); if (b >= eff * 2 * 0.05) { busy += b; nd++; } });
      const planBusy = nd ? busy / nd : null;
      const need = ratio && planBusy != null ? planBusy / ratio : null;
      return { k, ratio, actual, need, planBusy, nd, seen, days: days.length };
    }).filter(r => r.days || r.planBusy != null);
    // трудомісткість: людино-год (оператори + ОТК + техніки) на 100 кг надрукованого (якщо в місячній історії є сировина
    // по локаціях — після бекфілу) або на 1000 прийнятих деталей; кг коректніше: деталі різного розміру не порівнянні
    const kgM = {}; ((S.BMH && S.BMH.months) || []).forEach(m => { if (m.materialsByLocation) { const x = kgM[m.month] = { _all: (m.materials && m.materials.kg) || 0 }; Object.entries(m.materialsByLocation).forEach(([k, v]) => { x[k] = v.kg || 0; }); } });
    const D2 = D, hrsOf = (m, k) => (D2.months[m].staff || []).filter(r => (k === '_all' ? r.loc !== 'ALL' : String(r.loc) === k) && r.hours != null).reduce((s, r) => s + r.hours, 0);
    const kgMonths = Object.keys(D.months).sort().filter(m => kgM[m] && kgM[m]._all > 0);
    if (kgMonths.length) {
      const inten = kgMonths.map(m => { const o = { m, partial: D.months[m].complete === false, all: hrsOf(m, '_all') / kgM[m]._all * 100 };
        activeLocs().forEach(k => { o[k] = kgM[m][k] ? hrsOf(m, k) / kgM[m][k] * 100 : null; }); return o; });
      return { rows, inten, unit: 'kg' };
    }
    // fallback: на 1000 прийнятих деталей
    const bhm = {}; ((S.BH && S.BH.days) || []).forEach(d => { const m = d.date.slice(0, 7); Object.entries(d.locations || {}).forEach(([k, l]) => { const x = (bhm[m] || (bhm[m] = {})); x[k] = (x[k] || 0) + (l.acceptedQty || 0); x._all = (x._all || 0) + (l.acceptedQty || 0); }); });
    const months = Object.keys(D.months).sort().filter(m => bhm[m] && bhm[m]._all > 0 && m >= (((S.BH && S.BH.days) || [])[0] || { date: '9' }).date.slice(0, 7));
    const inten = months.map(m => {
      const st = D.months[m].staff || [], hrs = k => st.filter(r => (k === '_all' ? r.loc !== 'ALL' : String(r.loc) === k) && r.hours != null).reduce((s, r) => s + r.hours, 0);
      const o = { m, partial: D.months[m].complete === false, all: bhm[m]._all ? hrs('_all') / bhm[m]._all * 1000 : null };
      activeLocs().forEach(k => { o[k] = bhm[m][k] ? hrs(k) / bhm[m][k] * 1000 : null; });
      return o;
    }).filter(x => x.all);
    // повний перший місяць (у batches_history дані з 12.08 — серпень неповний, його не беремо, якщо є наступні)
    return { rows, inten: inten.length > 2 ? inten.slice(1) : inten, unit: 'pcs' };
  }

  // ── план Ганта: зведення для CEO і карток ───────────────────────────────────────────────────────────
  function planSum(k) {
    if (!GT || !GT.dates) return null;
    const x = k ? ganttLoc(k) : GT.total; if (!x) return null;
    let b = 0, c = 0; x.d.slice(0, 7).forEach(r => { if (!r) return; [[0, 1, 2], [3, 4, 5]].forEach(([fi, bi, ai]) => { if (r[ai] && r[fi] != null && r[bi] != null) { b += r[bi]; c += r[fi] + r[bi]; } }); });
    const eff = (x.machines || {}).effective || 0, thr = Math.max(1, eff * (GT.freePct || 5) / 100);
    let win = null;
    for (let i = 0; i < x.d.length && !win; i++) { const r = x.d[i]; if (!r) continue; for (const [fi, ai, s] of [[0, 2, 'д'], [3, 5, 'н']]) if (r[ai] && (r[fi] || 0) >= thr) { win = { d: GT.dates[i], s, i }; break; } }
    return { load7: c ? b / c * 100 : null, win, ok: !GT.status || GT.status.ok };
  }
  const loadCol = v => v == null ? 'var(--tl)' : v >= 95 ? R : v >= 80 ? Y : v >= 50 ? GD : A;

  // ── РЕНДЕР: Виробництво ─────────────────────────────────────────────────────────────────────────────
  function css() {
    if ($('ops-css')) return;
    const s = document.createElement('style'); s.id = 'ops-css';
    s.textContent = `
#ops-root .oc{background:#fff;border:1px solid var(--bd);border-radius:var(--r);box-shadow:var(--sh);padding:10px 12px;min-width:0}
#ops-root .oh{font-size:12px;font-weight:700;color:var(--td);margin-bottom:2px}
#ops-root .on{font-size:10px;color:var(--tl);margin-bottom:8px;line-height:1.45}
#ops-root .ok{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-bottom:8px}
@media(max-width:600px){#ops-root .ok{grid-template-columns:1fr 1fr}}
#ops-root .ok>div{border:1px solid var(--bd);border-radius:7px;padding:6px 8px}
#ops-root .ok .l{font-size:9.5px;font-weight:600;color:var(--tm)} #ops-root .ok .v{font-size:16px;font-weight:800;margin-top:1px;white-space:nowrap} #ops-root .ok .s{font-size:9.5px;color:var(--tl);line-height:1.3}
#ops-root table{width:100%;border-collapse:collapse;font-size:11px}
#ops-root th{font-size:10px;font-weight:600;color:var(--tl);text-align:right;padding:4px 5px;border-bottom:1px solid var(--bd);white-space:nowrap}
#ops-root td{padding:4px 5px;border-bottom:1px solid #f1f3ef;text-align:right;white-space:nowrap}
#ops-root th:first-child,#ops-root td:first-child{text-align:left}
#ops-root tr.t td{font-weight:700;border-top:1.5px solid var(--bd)}
#ops-root .tw{overflow-x:auto}
#ops-root .sw{display:inline-block;width:10px;height:10px;border-radius:3px;border:1px solid rgba(0,0,0,.15);vertical-align:-1px;margin-right:5px}
#ops-root .bar{height:6px;border-radius:3px;background:#eef1ec;overflow:hidden;min-width:60px} #ops-root .bar>i{display:block;height:100%}
#ops-root .warn{font-size:10.5px;color:#856404;background:#fff3cd;border-radius:7px;padding:5px 8px;margin-bottom:8px}`;
    document.head.appendChild(s);
  }
  const tile = (l, v, s, c, t) => `<div${t ? ` title="${esc(t)}"` : ''}><div class="l">${l}</div><div class="v" style="color:${c || 'var(--tx)'}">${v}</div><div class="s">${s || ''}</div></div>`;
  function lossNote(t) {   // яка складова OEE «з'їдає» найбільше
    const L = [['A', 'доступність (ремонт/ТО/резерв)', t.A], ['P', 'завантаженість (машини без завдань)', t.P30], ['Q', 'якість (брак)', t.Q30]].filter(x => x[2] != null).map(x => [x[0], x[1], (1 - x[2]) * 100]).sort((a, b) => b[2] - a[2]);
    if (!L.length) return '';
    return `<div class="on" style="margin:6px 0 0">Втрати OEE парку за 30 дн: ${L.map(x => `${x[0]} — ${x[1]}: <b>−${x[2].toFixed(1)} п.п.</b>`).join(' · ')}. Найбільший резерв — <b>${L[0][1]}</b>.</div>`;
  }
  const oeeCol = v => v == null ? 'var(--tl)' : v >= 80 ? GD : v >= 60 ? A : v >= 40 ? Y : R;

  function renderProd() {
    const root = $('ops-root'); if (!root) return;
    css();
    const O = oee(), I = idle(), M = material(), P = people();
    // OEE
    const oRow = (r, cls) => `<tr class="${cls || ''}"><td>${r.k === '*' ? '<b>Парк</b>' : `<span class="sw" style="background:${LOC_C[r.k] || '#999'}"></span>${esc(r.name)}`}</td>
      <td>${r.A != null ? pct(r.A * 100) : '—'}</td><td>${pct(r.Pnow != null ? r.Pnow * 100 : null)}</td><td>${pct(r.P30 != null ? r.P30 * 100 : null)}</td><td>${pct(r.Q30 != null ? r.Q30 * 100 : null, 1)}</td>
      <td style="color:${oeeCol(r.oeeNow)}">${pct(r.oeeNow)}</td><td style="color:${oeeCol(r.oee30)};font-weight:800">${pct(r.oee30)}</td></tr>`;
    const oeeCard = `<div class="oc"><div class="oh">OEE по локаціях = доступність × завантаженість × якість</div>
      <div class="on">A — робочий парк без ремонту/ТО/резерву (Гант, зараз) · P — зайняті машини / парк (факт, сьогодні і середнє ${O.days} дн) · Q — 1 − брак ОТК (${O.days} дн). Ціль OEE 80%+.${GT && GT.locations ? '' : ' <b>Гант недоступний — A не враховано (=100%).</b>'}</div>
      <div class="tw"><table><thead><tr><th>Локація</th><th title="Availability">A</th><th title="Performance — сьогодні">P сьогодні</th><th title="Performance — середнє">P 30 дн</th><th title="Quality">Q 30 дн</th><th>OEE сьогодні</th><th>OEE 30 дн</th></tr></thead>
      <tbody>${O.rows.map(r => oRow(r)).join('')}${oRow(O.tot, 't')}</tbody></table></div>
      ${lossNote(O.tot)}</div>`;

    // Простої
    const mk = Object.keys(I.monthly).sort(), lk = activeLocs().concat(['1', '2'].filter(k => mk.some(m => I.monthly[m][k]) && !activeLocs().includes(k)));
    const idleCard = `<div class="oc"><div class="oh">Простої парку, машино-години</div>
      <div class="on">Простій = парк × (1 − завантаженість) × 24 год, повні дні capacity · ремонт/ТО — машини в ремонті, на ТО і в резерві зараз (Гант) × 24 · решта — машини без завдань (немає замовлень/плану).</div>
      <div class="ok">${tile(`Простій · ${I.tot.days} дн`, kfmt(I.tot.idleDay * I.tot.days) + ' <span style="font-size:10px">маш-год</span>', `${pct(I.tot.share)} часу парку · ${kfmt(I.tot.idleDay)} маш-год/добу`, I.tot.share > 40 ? R : I.tot.share > 20 ? Y : GD)}
        ${tile('Ремонт / ТО / резерв', kfmt(I.tot.maintDay) + ' <span style="font-size:10px">маш-год/добу</span>', `${fmt(I.tot.maintDay / 24)} машин зараз`, A, 'Аварійний + плановий простій: машини в ремонті, на ТО і в резерві за даними Ганта, × 24 год')}
        ${tile('Без замовлень', kfmt(I.tot.noOrders) + ' <span style="font-size:10px">маш-год/добу</span>', `≈ ${fmt(I.tot.noOrders / 24)} машин стоять щодня`, I.tot.noOrders > I.tot.maintDay ? R : Y, 'Простій мінус ремонт/ТО — машини справні, але без завдань')}</div>
      <div class="tw"><table><thead><tr><th>Локація</th><th>Простій, маш-год/добу</th><th>% часу</th><th>Ремонт+ТО зараз</th><th>Без замовлень/добу</th></tr></thead><tbody>${I.rows.map(r => `<tr><td><span class="sw" style="background:${LOC_C[r.k] || '#999'}"></span>Локація ${r.k}</td><td>${fmt(r.idleDay)}</td><td style="color:${r.share > 40 ? R : r.share > 20 ? Y : GD}">${pct(r.share)}</td><td title="ремонт ${r.rep ?? '—'} · ТО ${r.pm}">${fmt(r.maintDay / 24)} маш.</td><td>${fmt(r.noOrders)}</td></tr>`).join('')}</tbody></table></div>
      <div style="height:170px;margin-top:8px"><canvas id="ops-idle-ch"></canvas></div></div>`;

    // Сировина
    const cm = M.curMat, last = M.ms.slice(-1)[0], src = cm && cm.kg ? cm : last && last.materials;
    const srcM = cm && cm.kg ? M.cur : last;
    const types = src ? src.byType : [];
    const matWarn = M.ms.length < 2 ? `<div class="warn">${M.ms.length ? 'Сировина є лише за поточний місяць.' : 'Розбивки за типом і кольором ще немає — поточний місяць з’явиться після найближчого щогодинного оновлення.'} Щоб заповнити попередні місяці 2026, запусти один раз Actions → «Backfill Batches Monthly History».</div>` : '';
    const matCard = `<div class="oc"><div class="oh">Сировина — витрата і мікс</div>
      <div class="on">Вага = (прийняті + брак) × вага деталі (калібрована) за партіями, що пройшли ОТК · брак у вазі — пластик, що пішов у брак.</div>${matWarn}
      <div class="ok">${tile(srcM ? `Надруковано · ${MS[+srcM.month.slice(5) - 1]}${srcM.complete === false ? ' (по ' + fD(srcM.to) + ')' : ''}` : 'Надруковано · міс.', src ? kfmt(src.kg) + ' <span style="font-size:10px">кг</span>' : '—', src ? `покриття вагою ${pct(src.coveragePercent)}` : '', A)}
        ${tile('Брак у вазі', src ? pct(src.defectKg / src.kg * 100, 1) : '—', src ? `${kfmt(src.defectKg)} кг пластику в браку` : '', src && src.defectKg / src.kg > 0.06 ? R : GD)}
        ${tile('Кг на партію', src && src.batchesWithWeight ? f1(src.kg / src.batchesWithWeight) : '—', src ? `${fmt(src.batchesWithWeight)} партій з вагою` : '', A)}
        ${tile('Середньо за добу', M.avgDay != null ? kfmt(M.avgDay) + ' <span style="font-size:10px">кг</span>' : '—', `партії, ${M.nDay} дн (capacity)`, A)}
        ${tile('План сьогодні', M.planKg != null ? kfmt(M.planKg) + ' <span style="font-size:10px">кг</span>' : '—', M.printedKg != null ? `надруковано ${kfmt(M.printedKg)} кг (${M.planKg ? pct(M.printedKg / M.planKg * 100) : '—'})` : '', A, 'Скільки пластику потребує план друку на сьогодні — орієнтир для видачі сировини')}
        ${tile('Мікс', types.length ? types.slice(0, 2).map(t => `${esc(t.type)} ${pct(t.kg / src.kg * 100)}`).join(' · ') : '—', types.length > 2 ? types.slice(2).map(t => `${esc(t.type)} ${pct(t.kg / src.kg * 100, 1)}`).join(' · ') : '', G)}</div>
      ${src && src.byColor && src.byColor.length ? `<div class="tw"><table><thead><tr><th>Колір (ТОП за вагою)</th><th>Пластик</th><th>кг</th><th>частка</th><th>у браку</th></tr></thead><tbody>${src.byColor.slice(0, 8).map(c => `<tr><td><span class="sw" style="background:${/^#[0-9A-F]{6}$/i.test(c.color) ? c.color : '#ddd'}"></span>${esc(c.color)}</td><td>${esc(c.type)}</td><td>${fmt(c.kg)}</td><td><div class="bar"><i style="width:${Math.min(100, c.kg / src.kg * 100)}%;background:${MAT_C[c.type] || A}"></i></div></td><td>${pct(c.kg ? c.defectKg / c.kg * 100 : null, 1)}</td></tr>`).join('')}</tbody></table></div>` : ''}
      ${M.ms.length > 1 ? `<div style="height:170px;margin-top:8px"><canvas id="ops-mat-ch"></canvas></div>` : ''}</div>`;

    // Люди
    let pplCard = '<div class="oc"><div class="oh">Люди під план</div><div class="on">Немає даних цеху (shopfloor.json).</div></div>';
    if (P) {
      const tr = P.rows.reduce((t, r) => ({ need: t.need + (r.need || 0), actual: t.actual + (r.actual || 0) }), { need: 0, actual: 0 });
      const im = P.inten.slice(-3), ik = activeLocs();
      pplCard = `<div class="oc"><div class="oh">Люди під план — оператори на наступні 7 днів</div>
        <div class="on">Продуктивність — скільки машин обслуговує один оператор за зміну (факт 30 дн: зайняті машино-зміни ÷ операторо-зміни). Потреба = зайняті планом Ганта машино-зміни на добу ÷ продуктивність — лише по днях, які план уже заповнив (≥5% парку зайнято) з наступних 7.</div>
        <div class="ok">${tile('Потрібно під план', f1(tr.need) + ' <span style="font-size:10px">опер.-змін/добу</span>', `план заповнений на ${Math.max(0, ...P.rows.map(r => r.nd))} з 7 днів`, A)}
          ${tile('Факт (30 дн)', f1(tr.actual) + ' <span style="font-size:10px">опер.-змін/добу</span>', 'виходи операторів на зміну', A)}
          ${tile('Різниця', (tr.need - tr.actual > 0 ? '+' : '') + f1(tr.need - tr.actual), tr.need > tr.actual * 1.1 ? 'план потребує більше людей' : tr.need < tr.actual * 0.7 ? 'людей більше, ніж потребує план' : 'укомплектованість відповідає плану', tr.need > tr.actual * 1.1 ? R : tr.need < tr.actual * 0.7 ? Y : GD)}</div>
        <div class="tw"><table><thead><tr><th>Локація</th><th title="машин на оператора-зміну, факт 30 дн">Машин/опер.</th><th title="операторо-змін на добу, факт 30 дн">Факт</th><th title="зайняті машино-зміни на добу, у середньому по заповнених днях плану">План, маш-зм</th><th title="заповнених днів плану з наступних 7">Днів</th><th title="операторо-змін на добу під план">Потрібно</th><th>Δ</th></tr></thead><tbody>${P.rows.map(r => { const dl = r.need != null && r.actual != null ? r.need - r.actual : null;
          return `<tr><td><span class="sw" style="background:${LOC_C[r.k] || '#999'}"></span>Локація ${r.k}</td><td>${f1(r.ratio)}</td><td>${f1(r.actual)}</td><td>${fmt(r.planBusy)}</td><td>${r.nd} / ${r.seen}</td><td>${f1(r.need)}</td><td style="color:${dl == null ? 'var(--tl)' : dl > 0.5 ? R : dl < -0.5 ? Y : GD}">${dl == null ? '—' : (dl > 0 ? '+' : '') + f1(dl)}</td></tr>`; }).join('')}</tbody></table></div>
        ${im.length ? `<div class="oh" style="margin-top:10px">Трудомісткість — людино-годин цеху ${P.unit === 'kg' ? 'на 100 кг надрукованого' : 'на 1000 деталей'}</div><div class="on">оператори + ОТК + техніки (shopfloor) ÷ ${P.unit === 'kg' ? 'кг пластику за партіями (прийняті + брак)' : 'прийняті на ОТК деталі (batches_history; деталі різного розміру — порівнюйте локацію саму з собою; після бекфілу сировини метрика перейде на кг)'}; нижче — краще</div>
        <div class="tw"><table><thead><tr><th>Місяць</th>${ik.map(k => `<th>Лок. ${k}</th>`).join('')}<th>Разом</th></tr></thead><tbody>${im.map(x => `<tr><td>${MS[+x.m.slice(5) - 1]}${x.partial ? '*' : ''}</td>${ik.map(k => `<td>${f1(x[k])}</td>`).join('')}<td><b>${f1(x.all)}</b></td></tr>`).join('')}</tbody></table></div>` : ''}</div>`;
    }

    root.innerHTML = `<div class="g2">${oeeCard}${idleCard}</div><div class="g2" style="margin-top:10px">${matCard}${pplCard}</div>`;

    // графіки
    chart('ops-idle-ch', { type: 'bar', data: { labels: mk.map(m => MS[+m.slice(5) - 1]), datasets: lk.map(k => ({ label: 'Лок. ' + k, data: mk.map(m => Math.round((I.monthly[m][k] || 0) / 1000)), backgroundColor: LOC_C[k] || '#999', stack: 's', borderRadius: 2 }))
      .concat([{ label: '% часу парку', type: 'line', data: mk.map(m => { const t = Object.entries(I.monthly[m]).filter(([k]) => k !== '_cap').reduce((s, [, v]) => s + v, 0); return I.monthly[m]._cap ? +(t / I.monthly[m]._cap * 100).toFixed(1) : null; }), borderColor: '#1A2B3C', backgroundColor: '#1A2B3C', yAxisID: 'y1', tension: .25, pointRadius: 2 }]) },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'top', labels: { usePointStyle: true, padding: 6, font: { size: 9 } } }, tooltip: { callbacks: { label: c => c.dataset.yAxisID === 'y1' ? ` ${c.dataset.label}: ${c.raw}%` : ` ${c.dataset.label}: ${c.raw} тис. маш-год` } } },
        scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, grid: { color: GRID }, title: { display: true, text: 'тис. маш-год', font: { size: 9 } } }, y1: { position: 'right', min: 0, max: 100, grid: { drawOnChartArea: false }, ticks: { callback: v => v + '%' } } } } });
    if (M.ms.length > 1) {
      const tps = [...new Set(M.ms.flatMap(m => m.materials.byType.map(t => t.type)))];
      chart('ops-mat-ch', { type: 'bar', data: { labels: M.ms.map(m => MS[+m.month.slice(5) - 1] + (m.complete === false ? '*' : '')), datasets: tps.map((t, i) => ({ label: t, data: M.ms.map(m => { const x = m.materials.byType.find(y => y.type === t); return x ? Math.round(x.kg) : 0; }), backgroundColor: MAT_C[t] || ['#457B9D', '#6aA5C2', '#8A6D3B'][i % 3], stack: 's', borderRadius: 2 }))
        .concat([{ label: 'брак у вазі, %', type: 'line', data: M.ms.map(m => +(m.materials.defectKg / m.materials.kg * 100).toFixed(2)), borderColor: R, backgroundColor: R, yAxisID: 'y1', tension: .25, pointRadius: 2 }]) },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'top', labels: { usePointStyle: true, padding: 6, font: { size: 9 } } } },
          scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, grid: { color: GRID }, title: { display: true, text: 'кг', font: { size: 9 } }, ticks: { callback: v => kfmt(v) } }, y1: { position: 'right', beginAtZero: true, grid: { drawOnChartArea: false }, ticks: { callback: v => v + '%' } } } } });
    }
  }

  // ── РЕНДЕР: CEO ─────────────────────────────────────────────────────────────────────────────────────
  function renderCeo() {
    const set = (id, html, col) => { const e = $(id); if (e) { e.innerHTML = html; if (col) e.style.color = col; } };
    const ps = planSum(null), O = oee(), I = idle(), M = material(), P = people();
    if (ps) { set('ceo-ops-plan7', pct(ps.load7), loadCol(ps.load7)); set('ceo-ops-win', ps.win ? fD(ps.win.d) + ' ' + ps.win.s : 'немає', ps.win ? (ps.win.i <= 1 ? GD : ps.win.i <= 7 ? Y : R) : R); }
    else { set('ceo-ops-plan7', '—'); set('ceo-ops-win', '—'); }
    set('ceo-ops-oee', pct(O.tot.oee30), oeeCol(O.tot.oee30));
    set('ceo-ops-idle', I.tot.days ? fmt(I.tot.noOrders / 24) + ' <span style="font-size:10px;font-weight:600">маш.</span>' : '—', I.tot.noOrders > I.tot.maintDay ? R : Y);
    const src = M.curMat && M.curMat.kg ? M.curMat : null;
    set('ceo-ops-mat', src ? kfmt(src.kg) + ' <span style="font-size:10px;font-weight:600">кг</span>' : M.avgDay != null ? kfmt(M.avgDay) + ' <span style="font-size:10px;font-weight:600">кг/добу</span>' : '—', A);
    if (P) { const t = P.rows.reduce((a, r) => ({ n: a.n + (r.need || 0), f: a.f + (r.actual || 0) }), { n: 0, f: 0 }); set('ceo-ops-ppl', `${f1(t.n)} <span style="font-size:10px;font-weight:600">/ ${f1(t.f)}</span>`, t.n > t.f * 1.1 ? R : t.n < t.f * 0.7 ? Y : GD); }
    // OEE на CEO — тепер повний A×P×Q (сьогодні)
    if (O.tot.oeeNow != null) {
      const v = O.tot.oeeNow; set('ceo-oee', v.toFixed(1) + '%', v >= 80 ? G : v >= 60 ? A : R); set('ceo-oee-val', v.toFixed(1) + '%');
      const b = $('ceo-oee-bar'); if (b) b.style.width = Math.min(v / 80 * 100, 100) + '%';
    }
  }

  // ── РЕНДЕР: картки Локацій ──────────────────────────────────────────────────────────────────────────
  function fillCards() {
    if (!api.ready) return;
    const O = oee();
    document.querySelectorAll('.loc-plan[data-loc]').forEach(el => {
      const k = el.dataset.loc, ps = planSum(k), o = O.rows.find(r => r.k === k);
      const parts = [];
      if (ps) parts.push(`📅 План 7 дн <b style="color:${loadCol(ps.load7)}">${pct(ps.load7)}</b> · вільно з <b>${ps.win ? fD(ps.win.d) + ' ' + ps.win.s : '—'}</b>`);
      if (o && o.oee30 != null) parts.push(`OEE 30 дн <b style="color:${oeeCol(o.oee30)}">${pct(o.oee30)}</b>`);
      el.innerHTML = parts.length ? `<div style="font-size:9.5px;color:var(--tm);margin-top:5px;padding-top:5px;border-top:1px dashed var(--bd);line-height:1.5">${parts.join('<br>')}</div>` : '';
    });
  }

  function onTab(id) {
    if (!['ceo', 'prod', 'loc'].includes(id)) return;
    load().then(() => {
      try {
        if (id === 'prod' && !done.prod) { done.prod = 1; renderProd(); }
        if (id === 'ceo' && !done.ceo) { done.ceo = 1; renderCeo(); }
        if (id === 'loc') fillCards();
      } catch (e) { console.warn('[Ops]', id, e); }
    });
  }

  const api = { onTab, fillCards, ready: false, _calc: { oee: () => oee(), idle: () => idle(), material: () => material(), people: () => people() } };
  return api;
})();
