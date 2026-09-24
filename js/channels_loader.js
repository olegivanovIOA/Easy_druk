/**
 * channels_loader.js — Easy 3D Print Dashboard v4.5
 * Вкладка «Маркетинг» → «Канали залучення (Bitrix24)».
 *
 * Джерело: crm_deals.json (поточний місяць) + crm_monthly_history.json (історія),
 * поле bySource / byUtm — рахується fetch_crm_deals.py (v4.5) з SOURCE_ID/UTM_SOURCE.
 * Тільки агрегати по каналу, без контактів/компаній.
 *
 * Що показуємо (тільки те, що допомагає вирішити, КУДИ вкладати маркетинг):
 *   1. Таблиця каналів: звернень → продажів, win-rate, % сміття, виручка, сер. чек, частка виручки
 *   2. Графік «звернення vs продажі» по каналах (де трафік є, а грошей нема)
 *   3. Тренд win-rate по місяцях для ТОП-5 каналів за виручкою
 *   4. Автоматичні висновки: найприбутковіший канал, найбільше сміття, "дорогий шум"
 */
window.ChannelsLoader = (() => {
  const WH = '#3D7EA6', RT = '#C98A2B', G = '#2A9D8F', R = '#C0392B', GRID = '#f0f2ee';
  const PALETTE = ['#3D7EA6', '#C98A2B', '#2A9D8F', '#8B5CF6', '#C0392B', '#14B8A6', '#EC4899', '#64748B'];
  let _cur = null, _hist = null, _charts = {};

  const fmt = n => n == null ? '—' : Math.abs(n) >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : Math.abs(n) >= 1e3 ? (n / 1e3).toFixed(0) + 'K' : String(Math.round(n));
  const pct = v => v == null ? '—' : v.toFixed(1) + '%';

  function chart(id, cfg) {
    const c = document.getElementById(id); if (!c) return;
    if (_charts[id]) { try { _charts[id].destroy(); } catch (e) {} }
    _charts[id] = new Chart(c, cfg);
  }

  async function load() {
    const root = document.getElementById('mkt-channels-root');
    if (!root) return;
    try {
      [_cur, _hist] = await Promise.all([
        fetch('data/crm_deals.json?t=' + Date.now()).then(r => r.ok ? r.json() : null),
        fetch('data/crm_monthly_history.json?t=' + Date.now()).then(r => r.ok ? r.json() : null).catch(() => null),
      ]);
    } catch (e) { console.warn('[Channels]', e); }

    const months = monthsWithSources();
    const ts = document.getElementById('mkt-channels-updated');
    if (ts && window.E3DFresh && _cur) ts.innerHTML = E3DFresh.html(_cur.fetched_at, 'Bitrix24');

    if (!months.length) {
      root.innerHTML = `<div class="al al-b" style="font-size:11px"><span class="ic">ℹ</span><div>
        Дані по каналах з'являться після наступного запуску джоби <b>update-crm</b> — у v4.5 до вибірки Bitrix24 додано
        <code>SOURCE_ID</code> / <code>UTM_SOURCE</code>. Щоб отримати історію з січня, запусти workflow
        <b>Backfill CRM Monthly History</b> (один раз, кілька хвилин).</div></div>`;
      return;
    }
    const sel = document.getElementById('mkt-channels-period');
    if (sel) {
      sel.innerHTML = '<option value="all">Всі місяці</option>' + months.slice().reverse()
        .map(m => `<option value="${m.month}">${m.month}${m.complete === false ? ' (частково)' : ''}</option>`).join('');
      sel.value = 'all';
      sel.onchange = render;
    }
    render();
  }

  // Місяці, де вже є bySource: історія + поточний (якщо його ще нема в історії)
  function monthsWithSources() {
    const map = {};
    ((_hist && _hist.months) || []).forEach(m => { if (m.bySource && m.bySource.length) map[m.month] = m; });
    if (_cur && _cur.bySource && _cur.bySource.length) map[_cur.month] = _cur;
    return Object.values(map).sort((a, b) => a.month.localeCompare(b.month));
  }

  function merge(monthsArr) {
    const agg = {};
    monthsArr.forEach(m => (m.bySource || []).forEach(s => {
      const a = agg[s.source] || (agg[s.source] = { source: s.source, name: s.name, reviewed: 0, won: 0, lost: 0, junk: 0, revenue: 0, revenueWholesale: 0, revenueRetail: 0, wonUah: 0 });
      a.reviewed += s.reviewed || 0; a.won += s.won || 0; a.lost += s.lost || 0; a.junk += s.junk || 0;
      a.revenue += s.revenue || 0; a.revenueWholesale += s.revenueWholesale || 0; a.revenueRetail += s.revenueRetail || 0;
      a.wonUah += (s.wonWholesale || 0) + (s.wonRetail || 0);
    }));
    const rows = Object.values(agg);
    const totRev = rows.reduce((s, r) => s + r.revenue, 0);
    const totRevd = rows.reduce((s, r) => s + r.reviewed, 0);
    rows.forEach(r => {
      const closed = r.won + r.lost;
      r.winRate = closed ? r.won / closed * 100 : null;
      r.junkShare = r.reviewed ? r.junk / r.reviewed * 100 : null;
      r.avgCheck = r.wonUah ? r.revenue / r.wonUah : null;
      r.revShare = totRev ? r.revenue / totRev * 100 : null;
      r.trafficShare = totRevd ? r.reviewed / totRevd * 100 : null;
    });
    rows.sort((a, b) => b.revenue - a.revenue || b.reviewed - a.reviewed);
    return { rows, totRev, totRevd };
  }

  function render() {
    const months = monthsWithSources();
    const sel = document.getElementById('mkt-channels-period');
    const period = sel ? sel.value : 'all';
    const picked = period === 'all' ? months : months.filter(m => m.month === period);
    const { rows, totRev, totRevd } = merge(picked);
    const note = document.getElementById('mkt-channels-note');
    if (note) note.textContent = picked.length ? `${picked[0].month} → ${picked[picked.length - 1].month} · ${totRevd.toLocaleString('uk-UA')} звернень · ${fmt(totRev)} грн виручки` : '—';

    renderInsights(rows);
    renderTable(rows);
    renderBars(rows);
    renderTrend(months);
  }

  function renderInsights(rows) {
    const el = document.getElementById('mkt-channels-insights'); if (!el) return;
    const withTraffic = rows.filter(r => r.reviewed >= 20);
    const out = [];
    const top = rows[0];
    if (top && top.revenue > 0) out.push(`💰 <b>${top.name}</b> дає ${pct(top.revShare)} виручки при ${pct(top.trafficShare)} звернень.`);
    const noisy = withTraffic.filter(r => r.junkShare != null).sort((a, b) => b.junkShare - a.junkShare)[0];
    if (noisy && noisy.junkShare >= 20) out.push(`🗑 Найбільше сміття: <b>${noisy.name}</b> — ${pct(noisy.junkShare)} звернень це спам/дублі/помилки.`);
    const waste = withTraffic.filter(r => r.trafficShare >= 10 && (r.revShare || 0) < r.trafficShare / 3).sort((a, b) => b.trafficShare - a.trafficShare)[0];
    if (waste) out.push(`⚠ <b>${waste.name}</b>: ${pct(waste.trafficShare)} трафіку, але лише ${pct(waste.revShare || 0)} виручки — перевірити якість/налаштування каналу.`);
    const best = withTraffic.filter(r => r.winRate != null).sort((a, b) => b.winRate - a.winRate)[0];
    if (best) out.push(`🎯 Найвища конверсія закритих звернень у продаж: <b>${best.name}</b> — ${pct(best.winRate)}.`);
    const unk = rows.find(r => r.source === '—');
    if (unk && totShare(unk) >= 15) out.push(`❓ ${pct(unk.trafficShare)} звернень без джерела (SOURCE_ID порожній) — аналітика каналів неповна, варто зробити поле обов'язковим у Bitrix24.`);
    el.innerHTML = out.length ? out.map(t => `<div style="margin-bottom:4px">${t}</div>`).join('') : '<div style="color:var(--tl)">Замало даних для висновків</div>';
    function totShare(r) { return r.trafficShare || 0; }
  }

  function renderTable(rows) {
    const tb = document.getElementById('mkt-channels-table'); if (!tb) return;
    tb.innerHTML = rows.map(r => {
      const wc = r.winRate == null ? 'var(--tl)' : r.winRate >= 30 ? G : r.winRate >= 10 ? WH : R;
      const jc = r.junkShare == null ? 'var(--tl)' : r.junkShare >= 30 ? R : r.junkShare >= 15 ? RT : 'var(--tx)';
      return `<tr>
        <td>${r.name}</td>
        <td style="text-align:right">${r.reviewed.toLocaleString('uk-UA')} <span style="color:var(--tl);font-size:9px">${pct(r.trafficShare)}</span></td>
        <td style="text-align:right">${r.won.toLocaleString('uk-UA')}</td>
        <td style="text-align:right;font-weight:700;color:${wc}">${pct(r.winRate)}</td>
        <td style="text-align:right;color:${jc}">${pct(r.junkShare)}</td>
        <td style="text-align:right;font-weight:700">${fmt(r.revenue)}</td>
        <td style="text-align:right">${fmt(r.avgCheck)}</td>
        <td style="text-align:right">${pct(r.revShare)}</td>
      </tr>`;
    }).join('');
  }

  function renderBars(rows) {
    const top = rows.filter(r => r.reviewed > 0).slice(0, 10);
    const DL = window.ChartDataLabels;
    chart('mkt-channels-bars', {
      type: 'bar', plugins: DL ? [DL] : [],
      data: { labels: top.map(r => r.name), datasets: [
        { label: 'Звернень', data: top.map(r => r.reviewed), backgroundColor: 'rgba(100,116,139,.25)', borderColor: '#64748B', borderWidth: 1, borderRadius: 4, xAxisID: 'x' },
        { label: 'Продажів (WON)', data: top.map(r => r.won), backgroundColor: 'rgba(42,157,143,.75)', borderRadius: 4, xAxisID: 'x' },
        { label: 'Виручка, M грн', data: top.map(r => +(r.revenue / 1e6).toFixed(2)), backgroundColor: 'rgba(201,138,43,.75)', borderRadius: 4, xAxisID: 'x1' },
      ] },
      options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'top', labels: { usePointStyle: true, padding: 8, font: { size: 9 } } },
          datalabels: DL ? { anchor: 'end', align: 'end', offset: 2, font: { size: 8, weight: '700' }, color: '#334155', formatter: (v, ctx) => v ? (ctx.datasetIndex === 2 ? v + 'M' : v) : '' } : { display: false } },
        layout: { padding: { right: 30 } },
        scales: { x: { beginAtZero: true, grid: { color: GRID }, title: { display: true, text: 'к-сть', font: { size: 9 } } },
          x1: { position: 'top', beginAtZero: true, grid: { drawOnChartArea: false }, ticks: { callback: v => v + 'M' } },
          y: { grid: { display: false }, ticks: { font: { size: 10 } } } } }
    });
  }

  function renderTrend(months) {
    const wrap = document.getElementById('mkt-channels-trend-wrap');
    if (!wrap) return;
    if (months.length < 2) { wrap.style.display = 'none'; return; }
    wrap.style.display = '';
    const topSources = merge(months).rows.filter(r => r.reviewed >= 20).slice(0, 5);
    const labels = months.map(m => m.month + (m.complete === false ? '*' : ''));
    chart('mkt-channels-trend', {
      type: 'line',
      data: { labels, datasets: topSources.map((s, i) => ({
        label: s.name, borderColor: PALETTE[i], backgroundColor: PALETTE[i] + '22', borderWidth: 2, tension: .3, pointRadius: 3, spanGaps: true,
        data: months.map(m => { const r = (m.bySource || []).find(x => x.source === s.source); return r && r.winRate != null ? r.winRate : null; }),
      })) },
      options: { responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom', labels: { usePointStyle: true, padding: 6, font: { size: 9 } } },
          tooltip: { callbacks: { label: ctx => ctx.dataset.label + ': ' + ctx.parsed.y + '%' } } },
        scales: { y: { beginAtZero: true, grid: { color: GRID }, ticks: { callback: v => v + '%' } }, x: { grid: { color: GRID }, ticks: { font: { size: 9 } } } } }
    });
  }

  return { load };
})();
