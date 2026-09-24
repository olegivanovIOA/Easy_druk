/**
 * leadgen_loader.js — Easy 3D Print Dashboard v4.6
 * Вкладка «Маркетинг» → «Лідогенерація, ROI кампаній та retention».
 *
 * Замінює ручний Looker Studio-звіт тими самими показниками, але з живих даних:
 *   - crm_deals.json / crm_monthly_history.json → cohort (угоди, СТВОРЕНІ в місяці):
 *       воронка кваліфікації, UTM-кампанії (нові угоди, очікувана і фактична сума),
 *       retention (клієнти, що повернулись / повторні покупці), завислі великі угоди
 *   - ads.json → вартість/кліки по кампаніях Google Ads (акаунт EASY, скрипт Вадима)
 * Персональних даних немає — тільки агрегати.
 */
window.LeadgenLoader = (() => {
  const G = '#2A9D8F', GD = '#1e7a6e', WH = '#3D7EA6', RT = '#C98A2B', R = '#C0392B', GRID = '#f0f2ee';
  let _cur = null, _hist = null, _ads = null, _charts = {};

  const fmt = n => n == null ? '—' : Math.abs(n) >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : Math.abs(n) >= 1e3 ? (n / 1e3).toFixed(0) + 'K' : String(Math.round(n));
  const pct = (a, b) => (b ? (a / b * 100) : null);
  const p1 = v => v == null ? '—' : v.toFixed(1) + '%';
  const $ = id => document.getElementById(id);

  function chart(id, cfg) {
    const c = $(id); if (!c) return;
    if (_charts[id]) { try { _charts[id].destroy(); } catch (e) {} }
    _charts[id] = new Chart(c, cfg);
  }

  async function load() {
    const root = $('mkt-leadgen-root'); if (!root) return;
    try {
      [_cur, _hist, _ads] = await Promise.all([
        fetch('data/crm_deals.json?t=' + Date.now()).then(r => r.ok ? r.json() : null),
        fetch('data/crm_monthly_history.json?t=' + Date.now()).then(r => r.ok ? r.json() : null).catch(() => null),
        fetch('data/ads.json?t=' + Date.now()).then(r => r.ok ? r.json() : null).catch(() => null),
      ]);
    } catch (e) { console.warn('[Leadgen]', e); }
    const months = monthsWithCohort();
    const ts = $('mkt-leadgen-updated');
    if (ts && window.E3DFresh) ts.innerHTML = E3DFresh.html([{ ts: _cur && _cur.fetched_at, label: 'Bitrix24' }, { ts: _ads && _ads.fetched_at, label: 'Google Ads' }]);
    if (!months.length) {
      root.innerHTML = `<div class="al al-b" style="font-size:11px"><div>ℹ Блок з'явиться після наступного запуску <b>update-crm</b> (v4.6 рахує угоди, створені в місяці: воронку, UTM-кампанії, retention).
        Для історії з січня — один раз запусти <b>Backfill CRM Monthly History</b>.</div></div>`;
      return;
    }
    const sel = $('mkt-leadgen-period');
    if (sel) {
      sel.innerHTML = months.slice().reverse().map(m => `<option value="${m.month}">${m.month}${m.complete === false ? ' (триває)' : ''}</option>`).join('');
      sel.onchange = render;
    }
    render();
  }

  function monthsWithCohort() {
    const map = {};
    ((_hist && _hist.months) || []).forEach(m => { if (m.cohort) map[m.month] = m; });
    if (_cur && _cur.cohort) map[_cur.month] = _cur;
    return Object.values(map).sort((a, b) => a.month.localeCompare(b.month));
  }

  function render() {
    const months = monthsWithCohort();
    const sel = $('mkt-leadgen-period');
    const key = sel ? sel.value : months[months.length - 1].month;
    const idx = months.findIndex(m => m.month === key);
    const m = months[idx], prev = idx > 0 ? months[idx - 1] : null;
    renderFunnel(m.cohort, prev && prev.cohort, m);
    renderRetention(m.cohort, prev && prev.cohort);
    renderRoi(m);
    renderStale(m.cohort);
    renderTrend(months);
  }

  function delta(cur, prev) {
    if (cur == null || prev == null || !prev) return '';
    const d = (cur - prev) / prev * 100;
    return `<span style="font-size:9px;color:${d >= 0 ? GD : R};margin-left:4px">${d >= 0 ? '▲' : '▼'}${Math.abs(d).toFixed(0)}%</span>`;
  }

  // ── 1. Воронка кваліфікації лідів ──
  function renderFunnel(c, pc, m) {
    const el = $('mkt-leadgen-funnel'); if (!el) return;
    const f = c.funnel, pf = pc && pc.funnel;
    const steps = [
      ['Усі звернення', 'all', 'усі угоди 4 воронок, створені в місяці'],
      ['Без дублів і тестів', 'clean', c.definitions && c.definitions.clean],
      ['Кваліфіковані', 'qualified', c.definitions && c.definitions.qualified],
      ['В роботі + успішні', 'activeOrWon', 'не відмовлені'],
      ['Успішні (WON)', 'won', c.definitions && c.definitions.won],
    ];
    el.innerHTML = `<div style="display:grid;grid-template-columns:repeat(5,1fr);gap:8px">` + steps.map(([lbl, k, tip], i) => {
      const v = f[k], prevStep = i ? f[steps[i - 1][1]] : null;
      const conv = i ? pct(v, prevStep) : null;
      const w = f.all ? Math.max(8, v / f.all * 100) : 0;
      return `<div class="krow" style="flex-direction:column;align-items:flex-start;gap:4px;padding:10px 12px" title="${tip || ''}">
        <div class="krow-lbl" style="white-space:normal">${lbl}</div>
        <div style="font-size:20px;font-weight:800;color:var(--tx)">${v.toLocaleString('uk-UA')}${delta(v, pf && pf[k])}</div>
        <div style="height:5px;width:100%;background:var(--bd);border-radius:3px"><div style="height:5px;width:${w}%;background:${i === 4 ? G : WH};border-radius:3px"></div></div>
        <div style="font-size:10px;color:var(--tl)">${i ? 'з попер. кроку: <b>' + p1(conv) + '</b>' : m.month + (m.complete === false ? ' · триває' : '')}</div>
      </div>`;
    }).join('') + `</div>
      <div style="font-size:10px;color:var(--tl);margin-top:6px">Очікувана сума (в роботі + успішні): <b>${fmt(f.expectedSumActiveWon)} грн</b> · фактична (WON): <b>${fmt(f.wonSum)} грн</b> · наскрізна конверсія звернення→WON: <b>${p1(pct(f.won, f.all))}</b>${delta(pct(f.won, f.all), pf && pct(pf.won, pf.all))}</div>`;
  }

  // ── 2. Retention ──
  function renderRetention(c, pc) {
    const el = $('mkt-leadgen-retention'); if (!el) return;
    const r = c.retention, pr = pc && pc.retention;
    const retShareDeals = pct(r.returning.deals, r.returning.deals + r.new.deals);
    const repeatShareRev = pct(r.repeatPurchase.wonSum, c.funnel.wonSum);
    const tile = (lbl, val, sub, tip, color) => `<div class="krow" style="flex-direction:column;align-items:flex-start;gap:3px;padding:10px 12px" title="${tip}">
      <div class="krow-lbl" style="white-space:normal">${lbl}</div><div style="font-size:18px;font-weight:800;color:${color || 'var(--tx)'}">${val}</div><div style="font-size:10px;color:var(--tl)">${sub}</div></div>`;
    el.innerHTML = `<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px">` +
      tile('Звернення від клієнтів, що повернулись', p1(retShareDeals), `${r.returning.deals} з ${r.returning.deals + r.new.deals} угод`, c.definitions.returning) +
      tile('Частка WON-виручки від повторних покупців', p1(repeatShareRev), `${fmt(r.repeatPurchase.wonSum)} з ${fmt(c.funnel.wonSum)} грн`, c.definitions.repeatPurchase, GD) +
      tile('Win-rate: повернулись vs нові', `${p1(r.returning.winRate)} / ${p1(r.new.winRate)}`, 'WON / (WON + відмови)', 'Серед закритих угод місяця') +
      tile('Угоди без прив\'язки до клієнта', String(r.noClientLinked), 'без компанії/контакту в Bitrix — не рахуються в retention', 'Такі угоди не можна віднести ні до нових, ні до тих, що повернулись', r.noClientLinked > 50 ? RT : null) +
      `</div>`;
  }

  // ── 3. ROI кампаній: Google Ads (вартість) × Bitrix (угоди/виручка за UTM) ──
  function adsCampaigns() {
    const all = (_ads && _ads.analytics && _ads.analytics.all) || [];
    const sum = (_ads && _ads.analytics && _ads.analytics.summary) || {};
    // Скрипт Ads пише cost_uah у ТИСЯЧАХ (напр. 66 замість ~66 000 при 3 786 кліках) —
    // виявляємо за неправдоподібною ціною кліку і масштабуємо, з позначкою "≈".
    const clicks = sum.total_clicks || all.reduce((s, c) => s + (c.clicks || 0), 0);
    const cost = sum.total_cost_uah || all.reduce((s, c) => s + (c.cost_uah || 0), 0);
    const scale = (clicks > 500 && cost / clicks < 0.5) ? 1000 : 1;
    // Ads-дані — за останні 30 днів; Bitrix-когорта — з 1-го числа. Приводимо вартість
    // до "з 1-го числа" пропорційно клікам (денна воронка ads.funnel).
    const fun = (_ads && _ads.funnel) || [];
    const monthStart = new Date().toISOString().slice(0, 7);
    const clicksAll = fun.reduce((s, d) => s + (d.clicks || 0), 0);
    const clicksMtd = fun.filter(d => (d.date || '').startsWith(monthStart)).reduce((s, d) => s + (d.clicks || 0), 0);
    const mtdRatio = clicksAll ? clicksMtd / clicksAll : null;
    return { list: all.filter(c => (c.cost_uah || 0) > 0 || (c.clicks || 0) > 0), scale, mtdRatio };
  }

  function renderRoi(m) {
    const el = $('mkt-leadgen-roi'); if (!el) return;
    const isCurrent = _cur && m.month === _cur.month;
    const camps = (m.cohort.byCampaign || []);
    const { list, scale, mtdRatio } = adsCampaigns();
    const note = $('mkt-leadgen-roi-note');
    const useAds = isCurrent && list.length && mtdRatio;
    const rows = {};
    camps.forEach(c => {
      const [src, name] = c.key.split(' / ');
      rows[c.key] = { src, name, deals: c.deals, expectedSum: c.expectedSum, won: c.won, wonSum: c.wonSum, cost: null, clicks: null };
    });
    if (useAds) list.forEach(a => {
      const k = 'google / ' + a.campaign;
      const r = rows[k] || (rows[k] = { src: 'google', name: a.campaign, deals: 0, expectedSum: 0, won: 0, wonSum: 0 });
      r.cost = (a.cost_uah || 0) * scale * mtdRatio;
      r.clicks = Math.round((a.clicks || 0) * mtdRatio);
    });
    const arr = Object.values(rows).filter(r => r.deals || r.cost).sort((a, b) => (b.wonSum - a.wonSum) || ((b.cost || 0) - (a.cost || 0)) || (b.deals - a.deals)).slice(0, 25);
    if (note) note.innerHTML = useAds
      ? `Вартість — з Google Ads (акаунт EASY), <b>≈ з 1-го числа</b> (30-денна вартість × частка кліків з 1-го числа${scale !== 1 ? '; ⚠ скрипт Ads пише вартість у тисячах — перераховано ×1000, округлення до тис.' : ''}). Угоди/виручка — Bitrix24 за UTM (source / campaign), створені в ${m.month}. Кампанії UKR-акаунта (Search_miltech тощо) у вивантаженні Ads відсутні — для них тільки Bitrix-частина.`
      : `Вартість Google Ads доступна тільки для поточного місяця. Для ${m.month} — лише Bitrix-частина (угоди/виручка за UTM).`;
    const tb = $('mkt-leadgen-roi-table'); if (!tb) return;
    tb.innerHTML = arr.map(r => {
      const cpl = r.cost && r.deals ? r.cost / r.deals : null, cac = r.cost && r.won ? r.cost / r.won : null;
      const roas = r.cost ? r.wonSum / r.cost * 100 : null;
      const rc = roas == null ? 'var(--tl)' : roas >= 300 ? GD : roas >= 100 ? WH : R;
      return `<tr><td>${r.name === '—' ? '<span style="color:var(--tl)">без UTM</span>' : r.name}<span style="color:var(--tl);font-size:9px"> ${r.src === '—' ? '' : r.src}</span></td>
        <td style="text-align:right">${r.cost != null ? fmt(r.cost) : '—'}</td>
        <td style="text-align:right">${r.deals}</td>
        <td style="text-align:right">${cpl != null ? fmt(cpl) : '—'}</td>
        <td style="text-align:right">${fmt(r.expectedSum)}</td>
        <td style="text-align:right">${r.won}</td>
        <td style="text-align:right;font-weight:700">${fmt(r.wonSum)}</td>
        <td style="text-align:right">${cac != null ? fmt(cac) : '—'}</td>
        <td style="text-align:right;font-weight:700;color:${rc}">${roas != null ? roas.toFixed(0) + '%' : '—'}</td></tr>`;
    }).join('');
  }

  // ── 4. Завислі великі угоди ──
  function renderStale(c) {
    const el = $('mkt-leadgen-stale'); if (!el) return;
    const s = c.staleBigDeals || [];
    if (!s.length) { el.style.display = 'none'; return; }
    const total = s.reduce((a, d) => a + d.amount, 0);
    el.style.display = '';
    el.innerHTML = `<div>⚠ <b>Завислі великі угоди</b> (відкриті > 90 днів, сума ≥ 1M): ${s.length} на <b>${fmt(total)} грн</b> — вони роздувають «очікувану суму» пайплайну.
      ${s.slice(0, 5).map(d => `#${d.id} · ${fmt(d.amount)} грн · ${d.stage} · з ${d.created}`).join('; ')}. Варто закрити або актуалізувати в Bitrix24.</div>`;
  }

  // ── 5. Тренд: звернення / кваліфіковані / WON + частка повторних ──
  function renderTrend(months) {
    const wrap = $('mkt-leadgen-trend-wrap'); if (!wrap) return;
    if (months.length < 2) { wrap.style.display = 'none'; return; }
    wrap.style.display = '';
    const labels = months.map(m => m.month + (m.complete === false ? '*' : ''));
    chart('mkt-leadgen-trend', {
      type: 'bar',
      data: { labels, datasets: [
        { label: 'Звернення', data: months.map(m => m.cohort.funnel.all), backgroundColor: 'rgba(100,116,139,.25)', borderRadius: 4, yAxisID: 'y' },
        { label: 'Кваліфіковані', data: months.map(m => m.cohort.funnel.qualified), backgroundColor: 'rgba(61,126,166,.55)', borderRadius: 4, yAxisID: 'y' },
        { label: 'WON', data: months.map(m => m.cohort.funnel.won), backgroundColor: 'rgba(42,157,143,.85)', borderRadius: 4, yAxisID: 'y' },
        { label: '% WON-виручки від повторних', type: 'line', yAxisID: 'y1', borderColor: RT, backgroundColor: RT, tension: .3, pointRadius: 3,
          data: months.map(m => { const c = m.cohort; return c.funnel.wonSum ? +(c.retention.repeatPurchase.wonSum / c.funnel.wonSum * 100).toFixed(1) : null; }) },
      ] },
      options: { responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'top', labels: { usePointStyle: true, padding: 8, font: { size: 9 } } }, datalabels: { display: false } },
        scales: { x: { grid: { display: false } }, y: { beginAtZero: true, grid: { color: GRID } },
          y1: { position: 'right', beginAtZero: true, max: 100, grid: { drawOnChartArea: false }, ticks: { callback: v => v + '%' } } } }
    });
  }

  return { load };
})();
