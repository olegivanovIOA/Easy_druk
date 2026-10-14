/**
 * clients_loader.js — Easy 3D Print Dashboard v6.2
 * Вкладка «Продажі» → блок «👥 Клієнти: LTV, RFM, відтік, галузі» (data/clients.json, fetch_clients.py).
 * Лише агрегати по клієнтах Bitrix24 (WON-угоди воронок 24 / 18 / 32 за весь час), без ID і назв.
 */
window.ClientsView = (() => {
  const G = '#2A9D8F', GD = '#1e7a6e', WH = '#3D7EA6', RT = '#C98A2B', R = '#C0392B', GRID = '#f0f2ee';
  const $ = id => document.getElementById(id);
  const fmt = n => n == null || !isFinite(n) ? '—' : Math.abs(n) >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : Math.round(n).toLocaleString('uk-UA');
  const p1 = v => v == null || !isFinite(v) ? '—' : (+v).toFixed(1) + '%';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const charts = {};
  let C = null, done = false;
  const SEG_C = { 'Чемпіони': GD, 'Лояльні': G, 'Потенційно лояльні': '#6FB7A8', 'Нові': WH, 'Потребують уваги': '#C9B458', 'Не можна втратити': R, 'Під ризиком': RT, 'Сплячі': '#9AA5A0', 'Втрачені': '#C9CFCB' };
  const SEG_TIP = {
    'Чемпіони': 'купували ≤90 днів тому і 5+ разів за 2 роки', 'Лояльні': 'купують часто (5+), останній раз до 180 днів',
    'Потенційно лояльні': 'недавні (≤90 дн.), 2–4 покупки', 'Нові': 'перша покупка ≤90 днів тому', 'Потребують уваги': 'остання покупка 91–180 днів тому',
    'Не можна втратити': 'були дуже активні (5+), але не купують > 180 днів', 'Під ризиком': '2–4 покупки, не купують > 180 днів',
    'Сплячі': '1 покупка 181–365 днів тому', 'Втрачені': '1 покупка > 365 днів тому' };
  function chart(id, cfg) {
    const c = $(id); if (!c || typeof Chart === 'undefined') return;
    if (charts[id]) { try { charts[id].destroy(); } catch (e) {} }
    cfg.options = cfg.options || {}; cfg.options.plugins = Object.assign({ datalabels: { display: false } }, cfg.options.plugins || {});
    charts[id] = new Chart(c, cfg);
  }
  const tile = (lbl, val, sub, tip, color) => `<div class="krow" style="flex-direction:column;align-items:flex-start;gap:3px;padding:10px 12px" title="${esc(tip || '')}">
    <div class="krow-lbl" style="white-space:normal;padding-left:0">${lbl}</div><div style="font-size:18px;font-weight:800;color:${color || 'var(--tx)'}">${val}</div><div style="font-size:10px;color:var(--tl)">${sub || ''}</div></div>`;
  const th = (t, r, tip) => `<th${r ? ' style="text-align:right"' : ''}${tip ? ` title="${esc(tip)}"` : ''}>${t}</th>`;
  const td = (v, b, c) => `<td style="text-align:right${b ? ';font-weight:700' : ''}${c ? ';color:' + c : ''}">${v}</td>`;
  const tbl = (h, b) => `<div class="tw"><table class="tbl"><thead><tr>${h}</tr></thead><tbody>${b || '<tr><td colspan="9" style="color:var(--tl)">Немає даних</td></tr>'}</tbody></table></div>`;

  function onTab(id) {
    if (id !== 'sales' || done) return;
    done = true;
    fetch('data/clients.json?t=' + Date.now()).then(r => r.ok ? r.json() : null).catch(() => null).then(d => { C = d; render(); });
  }

  function render() {
    const p = $('panel-sales'); if (!p) return;
    if (!$('w-cl')) p.insertAdjacentHTML('beforeend', `<div id="w-cl">
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-top:22px">
        <div class="sec" style="margin:0">👥 Клієнти: LTV, RFM, відтік, галузі <span style="font-size:10px;font-weight:500;text-transform:none;letter-spacing:normal;color:var(--tl);cursor:help" title="Bitrix24: усі успішні (WON) угоди воронок 24 ОПТ і 18/32 Роздріб за весь час. Клієнт = компанія угоди (або контакт, якщо компанії немає). Втрачений клієнт — без нової покупки понад ${(C && C.params && C.params.churnDays) || 180} днів. Лише агрегати, без назв і ID.">ⓘ</span></div>
        <div style="display:flex;gap:8px;align-items:center;font-size:11px"><select id="cl-grp" style="font-size:11px;padding:3px 6px;border:1px solid var(--bd);border-radius:6px"><option value="all">Усі клієнти</option><option value="wholesale">ОПТ (B2B)</option><option value="retail">Роздріб</option></select><span id="cl-upd"></span></div>
      </div><div id="cl-body" style="margin-top:8px"></div></div>`);
    const upd = $('cl-upd'); if (upd && window.E3DFresh && C) upd.innerHTML = E3DFresh.html(C.fetched_at, 'Bitrix24');
    const body = $('cl-body');
    if (!C) { body.innerHTML = `<div class="al al-b" style="font-size:11px"><div>ℹ Дані з’являться після першого запуску <b>update-clients</b> (раз на добу).</div></div>`; return; }
    $('cl-grp').onchange = draw;
    draw();
  }

  function draw() {
    const g = $('cl-grp').value, L = C.ltv[g] || C.ltv.all, ch = C.churn[g === 'wholesale' ? 'wholesale' : 'all'];
    const body = $('cl-body');
    const last = (ch.series || []).filter(x => x.complete).slice(-1)[0];
    body.innerHTML = `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin-bottom:12px">
      ${tile('Клієнтів', fmt(L.clients), `активних за 12 міс.: ${fmt(L.activeClients12m)}`, `З першої угоди ${C.firstDeal}`)}
      ${tile('Виручка на клієнта (факт LTV)', fmt(L.avgRevenuePerClient) + ' ₴', `медіана ${fmt(L.medianRevenuePerClient)} ₴`, 'Уся виручка клієнта за весь час, середнє і медіана. Медіана стійкіша до кількох великих клієнтів.', GD)}
      ${tile('LTV за формулою', fmt(L.ltvFormula) + ' ₴', `чек ${fmt(L.avgCheck12m)} ₴ × ${L.purchasesPerYear ?? '—'} пок./рік × ${L.avgLifespanChurnedMonths ?? '—'} міс.`, 'Середній чек (12 міс.) × покупок на рік на активного клієнта × середня тривалість «життя» клієнтів, що вже пішли')}
      ${tile('Повторні клієнти', p1(L.repeatShare), `${L.avgDealsPerClient} угод на клієнта`, 'Частка клієнтів з 2+ успішними угодами')}
      ${tile('Топ-10% клієнтів', p1(L.top10Share12m), 'виручки за 12 міс.', 'Концентрація: яку частку виручки дають 10% найбільших клієнтів', L.top10Share12m > 70 ? R : null)}
      ${tile('Відтік за рік', p1(ch.annualChurnPct), last ? `за ${last.month}: ${p1(last.rate)} (${last.churned} з ${last.base})` : '', 'Сума місячних відтоків за 12 повних місяців ÷ середня база активних клієнтів', ch.annualChurnPct > 40 ? R : null)}
      ${tile('Під ризиком зараз', fmt(ch.atRisk.clients), `${p1(ch.atRisk.revenueShare12m)} виручки 12 міс.`, `Остання покупка ${C.params.riskFromDays}–${C.params.churnDays} днів тому — ще не втрачені, варто зв'язатися`, ch.atRisk.clients ? RT : null)}
    </div>
    <div class="g2" style="margin-bottom:12px">
      <div class="card"><div class="ct" style="margin-bottom:8px">RFM-сегменти <span style="font-weight:500;color:var(--tl);font-size:10px">(клієнти з покупками за 24 міс., усі групи)</span></div>${tbl(
        th('Сегмент') + th('Клієнтів', 1) + th('Частка виручки 24 міс.', 1) + th('Днів з останньої покупки', 1, 'медіана'),
        (C.rfm || []).map(s => `<tr><td title="${esc(SEG_TIP[s.segment] || '')}"><span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${SEG_C[s.segment] || '#ccc'};margin-right:6px"></span>${s.segment}</td>${td(fmt(s.clients))}${td(p1(s.revenueShare24m), 1)}${td(fmt(s.medianDaysSinceLast))}</tr>`).join(''))}
        <div style="font-size:10px;color:var(--tl);margin-top:6px">Давність (R): ≤30 / ≤90 / ≤180 / ≤365 / >365 днів · Частота (F) за 24 міс.: 1 / 2 / 3–4 / 5–9 / 10+ угод. Наведіть на сегмент — опис.</div></div>
      <div class="card"><div class="ct" style="margin-bottom:8px">Відтік і повернення клієнтів по місяцях <span style="font-weight:500;color:var(--tl);font-size:10px">(${g === 'wholesale' ? 'ОПТ' : 'усі'}; * — місяць триває)</span></div><div class="cw" style="height:250px"><canvas id="cl-churn"></canvas></div></div>
    </div>
    <div class="g2" style="margin-bottom:12px">
      <div class="card"><div class="ct" style="margin-bottom:8px">Когорти: накопичена виручка на клієнта <span style="font-weight:500;color:var(--tl);font-size:10px">(за роком першої покупки, ₴)</span></div>${tbl(
        th('Когорта') + th('Клієнтів', 1) + [0, 1, 2, 3, 4].map(k => th(k === 0 ? '1-й рік' : `+${k} р.`, 1)).join(''),
        (C.cohorts || []).map(c => `<tr><td>${c.year}</td>${td(fmt(c.clients))}${[0, 1, 2, 3, 4].map(k => td(c.cumRevenuePerClient[k] != null ? fmt(c.cumRevenuePerClient[k]) : '')).join('')}</tr>`).join(''))}
        <div style="font-size:10px;color:var(--tl);margin-top:6px">Поточний рік ще не завершений — останнє значення кожної когорти неповне.</div></div>
      <div class="card"><div class="ct" style="margin-bottom:8px">Галузі клієнтів <span style="font-weight:500;color:var(--tl);font-size:10px">(виручка за 12 міс.)</span></div><div id="cl-ind"></div></div>
    </div>`;

    const s = ch.series || [];
    chart('cl-churn', { data: { labels: s.map(x => x.month + (x.complete ? '' : '*')), datasets: [
      { type: 'bar', label: 'Втрачено', data: s.map(x => x.churned), backgroundColor: 'rgba(192,57,43,.6)', borderRadius: 3, yAxisID: 'y' },
      { type: 'bar', label: 'Повернулись', data: s.map(x => x.reactivated), backgroundColor: 'rgba(42,157,143,.6)', borderRadius: 3, yAxisID: 'y' },
      { type: 'line', label: 'Відтік, % бази', data: s.map(x => x.rate), borderColor: RT, backgroundColor: RT, pointRadius: 2, tension: .3, yAxisID: 'y1' }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'top', labels: { boxWidth: 10, font: { size: 9 } } } },
        scales: { x: { grid: { display: false }, ticks: { font: { size: 9 }, maxRotation: 0, autoSkip: true } }, y: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: GRID } },
          y1: { position: 'right', beginAtZero: true, grid: { drawOnChartArea: false }, ticks: { callback: v => v + '%' } } } } });

    const I = C.industries, el = $('cl-ind');
    if (!I || !I.rows || !I.rows.length) {
      el.innerHTML = `<div style="font-size:11px;color:var(--tl)">Поле галузі/сфери в картках компаній Bitrix24 ${I && I.field ? `(<code>${esc(I.field)}</code>) ще не заповнене` : 'не знайдено'}. Як тільки менеджери почнуть заповнювати — розподіл з’явиться тут автоматично.</div>`;
    } else {
      const cov = I.coverageRevenue12mPct;
      el.innerHTML = `<div style="font-size:10px;color:${cov < 60 ? RT : 'var(--tl)'};margin-bottom:6px">Поле «${esc(I.fieldLabel || I.field)}» заповнене для <b>${p1(cov)}</b> виручки${cov < 60 ? ' — висновки поки орієнтовні' : ''}.</div>`
        + `<div class="cw" style="height:${Math.max(160, Math.min(12, I.rows.length) * 22)}px;margin-bottom:8px"><canvas id="cl-ind-ch"></canvas></div>`
        + tbl(th('Галузь') + th('Клієнтів', 1) + th('Угод', 1) + th('Частка виручки', 1) + th('Сер. чек', 1, 'показується, якщо в галузі ≥2 клієнтів'),
          I.rows.map(r => `<tr><td${r.industry === 'Не вказано' ? ' style="color:var(--tl)"' : ''}>${esc(r.industry)}</td>${td(fmt(r.clients))}${td(fmt(r.deals))}${td(p1(r.revenueShare12m), 1)}${td(r.avgCheck12m != null ? fmt(r.avgCheck12m) + ' ₴' : '—')}</tr>`).join(''));
      const top = I.rows.filter(r => r.industry !== 'Не вказано').slice(0, 12);
      chart('cl-ind-ch', { type: 'bar', data: { labels: top.map(r => r.industry), datasets: [{ data: top.map(r => r.revenueShare12m), backgroundColor: WH, borderRadius: 3 }] },
        options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } },
          scales: { x: { grid: { color: GRID }, ticks: { callback: v => v + '%' } }, y: { grid: { display: false }, ticks: { font: { size: 9 } } } } } });
    }
  }
  return { onTab };
})();
