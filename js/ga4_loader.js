/**
 * ga4_loader.js — Easy 3D Print Dashboard v5.1
 * Вкладка «Маркетинг» → «Сайт — Google Analytics (easy3dprint.com.ua)».
 *
 * Дані: data/ga4.json (fetch_ga4.py, ресурс GA4 378398411). Тільки агрегати.
 * Період — ТОЙ САМИЙ, що обраний у таблиці «ROI кампаній» (день / кілька днів /
 * місяць / рік): leadgen_loader.js викликає GA4View.render(ga, from, to, ctx)
 * після кожної зміни періоду.
 */
window.GA4View = (() => {
  const G = '#2A9D8F', GD = '#1e7a6e', WH = '#3D7EA6', RT = '#C98A2B', R = '#C0392B', GRID = '#f0f2ee';
  const $ = id => document.getElementById(id);
  const fmt = n => n == null ? '—' : Math.abs(n) >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : Math.abs(n) >= 1e4 ? (n / 1e3).toFixed(0) + 'K' : Math.round(n).toLocaleString('uk-UA');
  const p1 = v => v == null || !isFinite(v) ? '—' : v.toFixed(1) + '%';
  const pct = (a, b) => b ? a / b * 100 : null;
  const fmtD = d => d.split('-').reverse().join('.');
  let _chart = null;

  // Людські назви груп каналів GA
  const GROUP_UA = {
    'Organic Search': 'Органічний пошук', 'Paid Search': 'Платний пошук', 'Direct': 'Прямі заходи',
    'Referral': 'Реферали (сайти)', 'Organic Social': 'Соцмережі (органіка)', 'Paid Social': 'Соцмережі (реклама)',
    'Cross-network': 'Cross-network (PMax)', 'Display': 'Медійна реклама', 'Email': 'Email', 'Unassigned': 'Не визначено',
    'Organic Video': 'Відео (органіка)', 'Paid Video': 'Відео (реклама)', 'Organic Shopping': 'Shopping (органіка)',
    'Paid Shopping': 'Shopping (реклама)', 'Paid Other': 'Інша реклама', 'Affiliates': 'Партнери', 'SMS': 'SMS',
    'Mobile Push Notifications': 'Push', 'Audio': 'Аудіо', 'AI Assistant': 'AI-асистенти (ChatGPT…)',
  };
  // Найчастіші назви подій → зрозуміло
  const EVENT_UA = {
    generate_lead: 'Заявка (generate_lead)', form_submit: 'Відправка форми', click_phone: 'Клік по телефону',
    phone_click: 'Клік по телефону', call: 'Дзвінок', click_tel: 'Клік по телефону', purchase: 'Покупка',
    contact: 'Контакт', click_email: 'Клік по email', email_click: 'Клік по email', click_telegram: 'Клік Telegram',
    click_viber: 'Клік Viber', click_whatsapp: 'Клік WhatsApp', file_download: 'Завантаження файлу',
    // реальні ключові події ресурсу easy3dprint.com.ua
    PhonetTrackingCall: 'Дзвінок (Phonet, трекінг)', 'Phonet_Call requested': 'Запит дзвінка (Phonet)',
    'Phonet_Off hours call requested': 'Запит дзвінка в неробочий час', all_forms: 'Форми на сайті (усі)',
    phone_b2b: 'Телефон B2B', Ringostat_calls: 'Дзвінки (Ringostat)', 'crm-form': 'CRM-форма Bitrix',
    Callback_calls: 'Callback-дзвінки', Answered_Calls: 'Прийняті дзвінки',
  };

  function inRange(rows, from, to) { return (rows || []).filter(r => r.d >= from && r.d <= to); }
  function sum(rows, f) { return rows.reduce((s, r) => s + (r[f] || 0), 0); }

  function render(ga, from, to, ctx) {
    const root = $('mkt-ga4-root'); if (!root) return;
    const ts = $('mkt-ga4-updated');
    if (ts && window.E3DFresh) ts.innerHTML = ga ? E3DFresh.html(ga.fetched_at, 'GA4') : '';
    if (!ga) {
      root.innerHTML = `<div class="al al-b" style="font-size:11px"><div>ℹ Google Analytics ще не підключено. Потрібно: секрети <b>GA4_SA_KEY</b> і <b>GA4_PROPERTY_ID</b> у GitHub,
        service account <code>ga4-dashboard@easydash-511514.iam.gserviceaccount.com</code> доданий у GA з роллю Viewer, потім запуск <b>Update Dashboard Data</b>.</div></div>`;
      return;
    }
    const per = from === to ? fmtD(from) : `${fmtD(from)} – ${fmtD(to)}`;
    const gaFrom = ga.from, gaTo = (ga.fetched_at || '').slice(0, 10) || ga.to;
    const partial = from < gaFrom || to > gaTo;
    const ch = inRange(ga.channels, from, to), ev = inRange(ga.events, from, to);
    const ses = sum(ch, 'ses'), usr = sum(ch, 'usr'), nw = sum(ch, 'new'), eng = sum(ch, 'eng'), ke = sum(ch, 'ke');
    const bxSite = ctx && ctx.siteDeals != null ? ctx.siteDeals : null;

    const tile = (lbl, val, sub, tip, color) => `<div class="krow" style="flex-direction:column;align-items:flex-start;gap:3px;padding:10px 12px" title="${tip || ''}">
      <div class="krow-lbl" style="white-space:normal">${lbl}</div><div style="font-size:18px;font-weight:800;color:${color || 'var(--tx)'}">${val}</div><div style="font-size:10px;color:var(--tl)">${sub || ''}</div></div>`;

    // ── Групи каналів ──
    const groups = {};
    ch.forEach(r => { const g = groups[r.g] || (groups[r.g] = { g: r.g, ses: 0, usr: 0, new: 0, eng: 0, ke: 0 }); ['ses', 'usr', 'new', 'eng', 'ke'].forEach(k => g[k] += r[k] || 0); });
    const gArr = Object.values(groups).sort((a, b) => b.ses - a.ses);

    // ── Події ──
    const evs = {};
    ev.forEach(r => evs[r.e] = (evs[r.e] || 0) + r.n);
    const evArr = Object.entries(evs).sort((a, b) => b[1] - a[1]);

    const l30 = ga.last30 || {};
    const tbl = (head, rows) => `<div class="tw"><table class="tbl"><thead><tr>${head}</tr></thead><tbody>${rows || '<tr><td colspan="9" style="color:var(--tl);font-weight:400">Немає даних</td></tr>'}</tbody></table></div>`;
    const r = v => `<td style="text-align:right">${v}</td>`;

    root.innerHTML = `
      <div style="font-size:10px;color:var(--tl);margin-bottom:8px"><b>${per}</b> · період той самий, що в таблиці «ROI кампаній» вище. Сайт <b>easy3dprint.com.ua</b>.
        ${partial ? `<span style="color:${RT}">⚠ дані GA4 у дашборді є з ${fmtD(gaFrom)} по ${fmtD(gaTo)}.</span>` : ''}
        GA4 недораховує частину візитів (блокувальники, відмова від cookies) — для порівняння каналів і конверсії, не для грошей.</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin-bottom:12px">
        ${tile('Сеанси', fmt(ses), `${fmt(usr)} користувачів · ${fmt(nw)} нових`, 'sessions / totalUsers / newUsers')}
        ${tile('Залучені сеанси', p1(pct(eng, ses)), `${fmt(eng)} з ${fmt(ses)}`, 'Сеанс > 10 с, або 2+ сторінки, або ключова подія')}
        ${tile('Ключові події', fmt(ke), evArr.length ? evArr.slice(0, 2).map(([e]) => EVENT_UA[e] || e).join(', ') : 'немає', 'Події, позначені в GA як ключові (заявки, кліки по контактах…)', GD)}
        ${tile('Конверсія сайту', p1(pct(ke, ses)), 'ключові події / сеанси', 'Яка частка візитів закінчується ключовою подією')}
        ${bxSite != null ? tile('GA-події vs угоди Bitrix', p1(pct(bxSite, ke)), `${fmt(ke)} подій GA → ${fmt(bxSite)} угод з сайту/реклами`,
          'Угоди Bitrix, створені в періоді, з UTM-мітками або джерелом «сайт/форма». Сильно < 100% — частина заявок губиться між сайтом і CRM (або одна заявка рахується в GA кількома подіями).',
          bxSite && ke && bxSite / ke < 0.5 ? R : null) : ''}
      </div>
      <div class="card" id="mkt-ga4-trend-wrap" style="margin-bottom:12px">
        <div class="ct" style="margin-bottom:8px">Сеанси і ключові події</div>
        <div class="cw" style="height:200px"><canvas id="mkt-ga4-trend"></canvas></div>
      </div>
      <div class="g2" style="margin-bottom:12px">
        <div class="card"><div class="ct" style="margin-bottom:8px">Канали трафіку (групи GA)</div>
          ${tbl('<th>Канал</th><th style="text-align:right">Сеанси</th><th style="text-align:right">Нові корист.</th><th style="text-align:right">Залучені</th><th style="text-align:right">Ключ. події</th><th style="text-align:right">CR</th>',
            gArr.map(g => `<tr><td>${GROUP_UA[g.g] || g.g}</td>${r(fmt(g.ses))}${r(fmt(g.new))}${r(p1(pct(g.eng, g.ses)))}${r(fmt(g.ke))}<td style="text-align:right;font-weight:700">${p1(pct(g.ke, g.ses))}</td></tr>`).join(''))}
        </div>
        <div class="card"><div class="ct" style="margin-bottom:8px">Ключові події по типах</div>
          ${tbl('<th>Подія</th><th style="text-align:right">Кількість</th><th style="text-align:right">Частка</th>',
            evArr.map(([e, n]) => `<tr><td>${EVENT_UA[e] || e}${EVENT_UA[e] ? '' : ''}</td>${r(fmt(n))}${r(p1(pct(n, ke)))}</tr>`).join(''))}
        </div>
      </div>
      <div class="g2" style="margin-bottom:12px">
        <div class="card"><div class="ct" style="margin-bottom:8px">Посадкові сторінки <span style="font-weight:500;color:var(--tl);font-size:10px">(останні 30 днів)</span></div>
          <div style="max-height:320px;overflow:auto">${tbl('<th>Сторінка</th><th style="text-align:right">Сеанси</th><th style="text-align:right">Ключ. події</th><th style="text-align:right">CR</th>',
            (l30.landing || []).map(x => `<tr><td style="font-weight:500;max-width:320px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${x.k}">${x.k || '(не визначено)'}</td>${r(fmt(x.ses))}${r(fmt(x.ke))}<td style="text-align:right;font-weight:700">${p1(pct(x.ke, x.ses))}</td></tr>`).join(''))}</div>
        </div>
        <div class="card"><div class="ct" style="margin-bottom:8px">Міста і пристрої <span style="font-weight:500;color:var(--tl);font-size:10px">(останні 30 днів)</span></div>
          <div style="font-size:11px;color:var(--td);margin-bottom:8px">${(l30.devices || []).map(x => `<b>${({ desktop: 'Комп\'ютер', mobile: 'Телефон', tablet: 'Планшет' })[x.k] || x.k}</b> ${p1(pct(x.ses, sum(l30.devices, 'ses')))} <span style="color:var(--tl)">(CR ${p1(pct(x.ke, x.ses))})</span>`).join(' · ')}</div>
          <div style="max-height:280px;overflow:auto">${tbl('<th>Місто</th><th style="text-align:right">Сеанси</th><th style="text-align:right">Ключ. події</th><th style="text-align:right">CR</th>',
            (l30.cities || []).map(x => `<tr><td>${x.k === '(not set)' ? '<span style="color:var(--tl)">не визначено</span>' : x.k}</td>${r(fmt(x.ses))}${r(fmt(x.ke))}${r(p1(pct(x.ke, x.ses)))}</tr>`).join(''))}</div>
        </div>
      </div>`;
    renderTrend(ch, from, to);
  }

  // Динаміка: по днях (до 62 днів) або по місяцях
  function renderTrend(ch, from, to) {
    const wrap = $('mkt-ga4-trend-wrap'), c = $('mkt-ga4-trend');
    if (!wrap || !c || typeof Chart === 'undefined') return;
    const days = Math.round((new Date(to) - new Date(from)) / 864e5) + 1;
    if (days < 2 || !ch.length) { wrap.style.display = 'none'; return; }
    wrap.style.display = '';
    const byMonth = days > 62, agg = {};
    ch.forEach(r => { const k = byMonth ? r.d.slice(0, 7) : r.d; const a = agg[k] || (agg[k] = { ses: 0, ke: 0 }); a.ses += r.ses; a.ke += r.ke; });
    const keys = Object.keys(agg).sort();
    if (_chart) { try { _chart.destroy(); } catch (e) {} }
    _chart = new Chart(c, {
      data: {
        labels: keys.map(k => byMonth ? k : k.slice(8, 10) + '.' + k.slice(5, 7)),
        datasets: [
          { type: 'bar', label: 'Сеанси', data: keys.map(k => agg[k].ses), backgroundColor: 'rgba(61,126,166,.45)', borderRadius: 3, yAxisID: 'y' },
          { type: 'line', label: 'Ключові події', data: keys.map(k => Math.round(agg[k].ke)), borderColor: G, backgroundColor: G, tension: .3, pointRadius: 2, yAxisID: 'y1' },
        ]
      },
      options: { responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'top', labels: { usePointStyle: true, padding: 8, font: { size: 9 } } }, datalabels: { display: false } },
        scales: { x: { grid: { display: false }, ticks: { font: { size: 9 }, maxRotation: 0, autoSkip: true } },
          y: { beginAtZero: true, grid: { color: GRID } },
          y1: { position: 'right', beginAtZero: true, grid: { drawOnChartArea: false } } } }
    });
  }

  return { render };
})();
