/**
 * sales_loader.js — Easy 3D Print Dashboard v1.2
 * Нові блоки: пайплайн угод, якість лідів, ефективність менеджерів
 */

window.SalesLoader = (() => {
  const DATA_URL = 'data/sales_planner.json';
  let _data = null;
  let _charts = {};

  const G = '#2A9D8F', GD = '#1e7a6e', A = '#457B9D', R = '#C0392B';
  const GB = 'rgba(42,157,143,.15)', AB = 'rgba(69,123,157,.15)';
  const GRID = '#f0f2ee';
  // Брендові кольори ОПТ/Роздріб (тепла українська палітра — пшеничне золото
  // для Роздробу, м'яке небесне синє для ОПТ) — ОКРЕМО від G/A вище, бо ті
  // ще використовуються як семантика "добре/середньо/погано" в інших місцях
  // цього файлу (пороги виконання плану, стадії пайплайну) і їх не можна
  // просто перефарбувати під бренд, не зламавши той сенс.
  const WH = '#3D7EA6', WHB = 'rgba(61,126,166,.15)';
  const RT = '#C98A2B', RTB = 'rgba(201,138,43,.15)';

  // Змішує hex-колір з білим у пропорції amount (0=майже білий, 1=повний
  // колір) — потрібно для градієнта відтінків сегментів пирога причин
  // відмов (щоб усі сектори лишались впізнавано "в тому самому бренді",
  // а не бралися з довільної палітри).
  function shadeColor(hex, amount){
    const h=hex.replace('#','');
    const r=parseInt(h.substring(0,2),16), g=parseInt(h.substring(2,4),16), b=parseInt(h.substring(4,6),16);
    const mix=(c)=>Math.round(255+(c-255)*amount);
    return `rgb(${mix(r)},${mix(g)},${mix(b)})`;
  }

  async function load() {
    try {
      const r = await fetch(DATA_URL + '?t=' + Date.now());
      if (!r.ok) throw new Error('HTTP ' + r.status);
      _data = await r.json();
      render();
    } catch (e) {
      console.warn('[SALES]', e);
    }
  }

  async function render() {
    if (!_data) return;
    await _renderSummary();
    _renderCombinedChart();
    _renderRetail();
    _renderWholesale();
    _renderPipeline();
    _renderLeadsQuality();
    _renderManagerEfficiency();
    _updateTimestamp();
  }

  function _fmt(n) {
    if (n == null) return '—';
    if (Math.abs(n) >= 1e6) return (n/1e6).toFixed(1)+'M';
    if (Math.abs(n) >= 1e3) return (n/1e3).toFixed(0)+'K';
    return String(Math.round(n));
  }
  function _set(id, val) { const el=document.getElementById(id); if(el) el.textContent=val; }

  // ── 1. KPI зведення ───────────────────────────────────────────────────────
  async function _renderSummary() {
    const wh=_data.wholesale||{}, rt=_data.retail||{};
    _set('sales-wh-fact', _fmt(wh.ytd_fact)+' грн');
    _set('sales-wh-pct',  (wh.ytd_pct??'—')+'%');
    _set('sales-rt-fact', _fmt(rt.ytd_fact)+' грн');
    _set('sales-rt-pct',  (rt.ytd_pct??'—')+'%');
    // Ті самі YTD-цифри, продубльовані в картках ОПТ/Роздріб зон (замість
    // старих статичних "Виручка 2025", які були просто текстом, не даними)
    _set('sales-wh-fact-zone', _fmt(wh.ytd_fact)+' грн');
    _set('sales-rt-fact-zone', _fmt(rt.ytd_fact)+' грн');

    const lm = (_data.leads_conversion?.monthly||[]).filter(m=>m.leads).slice(-1)[0];
    if (lm) {
      _set('sales-leads', lm.leads ? Math.round(lm.leads) : '—');
      const ce=document.getElementById('sales-conv');
      if(ce){ ce.textContent=(lm.conv_pct??'—')+'%'; ce.style.color=(lm.conv_pct>=15)?GD:R; }
    }
    const cm=(_data.avg_check?.monthly||[]).filter(m=>m.fact).slice(-1)[0];
    if(cm) _set('sales-rt-check', _fmt(cm.fact)+' грн');

    // Динаміка МоМ (%) для ОПТ — (поточний факт − попередній факт) / попередній факт × 100
    const whMonthly=(wh.monthly||[]).filter(m=>m.fact!=null);
    if(whMonthly.length>=2){
      const cur=whMonthly[whMonthly.length-1].fact, prev=whMonthly[whMonthly.length-2].fact;
      const momEl=document.getElementById('sales-wh-mom');
      if(momEl && prev){
        const mom=(cur-prev)/prev*100;
        momEl.textContent=(mom>=0?'+':'')+mom.toFixed(1)+'%';
        momEl.style.color=mom>=0?GD:R;
      }
    }

    // Пайплайн KPI
    const pipe=_data.pipeline||{};
    _set('sales-pipe-total',  _fmt(pipe.total_active_sum)+' грн');
    const active = (pipe.stages||[]).filter(s=>['active','test','calculation','waiting'].includes(s.stage)).reduce((s,x)=>s+x.sum,0);
    _set('sales-pipe-active', _fmt(active)+' грн');
    _set('sales-pipe-wr',     (pipe.win_rate_pct??'—')+'%');

    // ── Реальний середній чек/медіана з Bitrix24 CRM (WON-угоди поточного місяця) ──
    try{
      const crm=await fetch('data/crm_deals.json?t='+Date.now()).then(r=>r.ok?r.json():null);
      if(crm){
        const wh=crm.wholesale||{}, rt=crm.retail||{};
        _set('crm-wh-avg', wh.avgCheck!=null ? _fmt(wh.avgCheck)+' грн ('+wh.deals+' уг.)' : '—');
        _set('crm-wh-median', wh.medianCheck!=null ? _fmt(wh.medianCheck)+' грн' : '—');
        _set('crm-rt-avg', rt.avgCheck!=null ? _fmt(rt.avgCheck)+' грн ('+rt.deals+' уг.)' : '—');
        _set('crm-rt-median', rt.medianCheck!=null ? _fmt(rt.medianCheck)+' грн' : '—');
      }
    }catch(e){console.warn('[CRM deals]',e.message);}

    // ── Причини відмов + сегменти угод за розміром — поточний місяць (live) + історія ──
    try{
      const [current, hist] = await Promise.all([
        fetch('data/crm_deals.json?t='+Date.now()).then(r=>r.ok?r.json():null),
        fetch('data/crm_monthly_history.json?t='+Date.now()).then(r=>r.ok?r.json():null).catch(()=>null),
      ]);
      _lrCurrent=current; _lrHistory=hist;

      const lrWrap=document.getElementById('w-sales-loss-reasons');
      const tiersWrap=document.getElementById('w-sales-tiers');
      const periodOptions = (hist && hist.months && hist.months.length)
        ? '<option value="all">Всі місяці</option>' + hist.months.slice().sort((a,b)=>b.month.localeCompare(a.month)).map(m=>`<option value="${m.month}">${m.month}${m.complete===false?' (частково)':''}</option>`).join('')
        : null;

      if(lrWrap && current){
        lrWrap.style.display='';
        const sel=document.getElementById('loss-reasons-total-period');
        if(sel && periodOptions){ sel.innerHTML=periodOptions; sel.addEventListener('change', ()=>{renderTotalReasons();renderTotalReasonsTrend();}); }
        renderTotalReasons();
        renderTotalReasonsTrend();
      }
      if(tiersWrap && current){
        tiersWrap.style.display='';
        const sel=document.getElementById('tiers-period');
        if(sel && periodOptions){ sel.innerHTML=periodOptions; sel.addEventListener('change', ()=>{renderTiers();renderTiersTrend();}); }
        renderTiers();
        renderTiersTrend();
      }

      // #9 гістограма + #6 конверсія — з'являються тільки якщо бекенд уже
      // віддає нові поля histogram/totalReviewed (після перезаливки
      // fetch_crm_deals.py і повторного прогону — старі знімки їх не мають)
      const histWrap=document.getElementById('w-sales-histogram-funnel');
      if(histWrap && current && current.wholesale && current.wholesale.histogram){
        histWrap.style.display='';
        renderHistogram();
      }
      if(histWrap && hist && hist.months && hist.months.some(m=>m.totalReviewed)){
        histWrap.style.display='';
        renderConversionTrend();
      }
      // #7 швидкість закриття — те саме "з'явиться тільки якщо є дані" правило
      const ttcWrap=document.getElementById('w-sales-time-to-close');
      if(ttcWrap && hist && hist.months && hist.months.some(m=>m.wholesale?.timeToClose?.sampleSize)){
        ttcWrap.style.display='';
        renderTimeToClose();
      }
    }catch(e){console.warn('[Loss reasons / Tiers]',e.message);}
  }

  let _lrCurrent=null, _lrHistory=null;

  // ── #9 Розподіл сум угод (гістограма, 9 бакетів) — поточний місяць ──
  function renderHistogram(){
    const DL=window.ChartDataLabels;
    const buildChart=(canvasId, histData, color)=>{
      if(!histData || !histData.length) return;
      const total=histData.reduce((s,h)=>s+h.deals,0);
      safeChartLoss(canvasId,{type:'bar',plugins:DL?[DL]:[],data:{labels:histData.map(h=>h.label),datasets:[
        {label:'Угод', data:histData.map(h=>h.deals), backgroundColor:color+'33', borderColor:color, borderWidth:1.5, borderRadius:4},
      ]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},datalabels:{anchor:'end',align:'end',offset:2,font:{size:9,weight:'700'},color:color,formatter:v=>v?`${v} (${Math.round(v/total*100)}%)`:''}},layout:{padding:{top:16}},scales:{y:{beginAtZero:true,grid:{color:GRID},ticks:{stepSize:1}},x:{grid:{display:false},ticks:{font:{size:8}}}}}});
    };
    buildChart('hist-wh-chart', _lrCurrent?.wholesale?.histogram, WH);
    buildChart('hist-rt-chart', _lrCurrent?.retail?.histogram, RT);
  }

  // ── #6 Конверсія в угоду по місяцях — WON / totalReviewed × 100, окремо
  // по ОПТ/Роздроб/Скринінгу. Потребує wholesale.deals (вже є) і
  // totalReviewed.* (нове поле, з'явиться після бекфілу). ──
  function renderConversionTrend(){
    const months=(_lrHistory&&_lrHistory.months||[]).slice().sort((a,b)=>a.month.localeCompare(b.month)).filter(m=>m.totalReviewed);
    if(months.length<2) return;
    const labels=months.map(m=>m.month);

    // Примітка: конверсію скринінгу лідів (категорія 0) свідомо НЕ рахуємо —
    // 25.08.2026 з'ясувалось, що totalReviewed для цієї категорії фактично
    // збігається з к-стю відмов (тому "конверсія" виходила ~0%). Причина:
    // WON-угоди переїжджають з категорії 0 в 24/18/32 і зникають з вибірки,
    // а угоди "в роботі" мають ненадійний CLOSEDATE і випадають з місячного
    // фільтра — на виду лишаються тільки реальні відмови. Щоб порахувати це
    // правильно, знадобиться DATE_CREATE замість CLOSEDATE саме для
    // категорії 0 — окрема задача, не робимо цього нашвидкуруч.
    const buildChart=(canvasId, wonKey, reviewedKey, color)=>{
      const data=months.map(m=>{
        const reviewed=m.totalReviewed?.[reviewedKey];
        const won=m[wonKey]?.deals;
        return (reviewed && won!=null) ? Math.round(won/reviewed*1000)/10 : null;
      });
      safeChartLoss(canvasId,{type:'line',data:{labels,datasets:[
        {label:'% конверсії',data,borderColor:color,backgroundColor:color+'22',borderWidth:2.5,tension:.3,fill:true,pointRadius:4,pointBackgroundColor:color,spanGaps:true},
      ]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:(ctx)=>ctx.parsed.y+'%'}}},scales:{y:{min:0,grid:{color:GRID},ticks:{callback:v=>v+'%'}},x:{grid:{color:GRID},ticks:{font:{size:9}}}}}});
    };
    buildChart('conv-wh-chart', 'wholesale', 'wholesale', WH);
    buildChart('conv-rt-chart', 'retail', 'retail', RT);
  }

  // ── #7 Швидкість закриття угоди (днів від DATE_CREATE до CLOSEDATE) —
  // тільки для WON, тому надійно (CLOSEDATE перевірено для WON раніше).
  // Показуємо і середнє, і медіану — за аналогією з середнім чеком: якщо
  // кілька угод довго висіли, середнє спотвориться сильніше за медіану. ──
  function renderTimeToClose(){
    const months=(_lrHistory&&_lrHistory.months||[]).slice().sort((a,b)=>a.month.localeCompare(b.month)).filter(m=>m.wholesale?.timeToClose || m.retail?.timeToClose);
    if(months.length<2) return;
    const labels=months.map(m=>m.month);

    const buildChart=(canvasId, groupKey, color)=>{
      const avgData=months.map(m=>m[groupKey]?.timeToClose?.avgDays ?? null);
      const medData=months.map(m=>m[groupKey]?.timeToClose?.medianDays ?? null);
      safeChartLoss(canvasId,{type:'line',data:{labels,datasets:[
        {label:'Середнє',data:avgData,borderColor:color,backgroundColor:color+'15',borderWidth:2,tension:.3,fill:false,pointRadius:3,pointBackgroundColor:color,spanGaps:true},
        {label:'Медіана',data:medData,borderColor:color,borderWidth:2.5,borderDash:[5,3],tension:.3,fill:false,pointRadius:4,pointBackgroundColor:'#fff',pointBorderColor:color,pointBorderWidth:2,spanGaps:true},
      ]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'top',labels:{usePointStyle:true,padding:8,font:{size:9}}},tooltip:{callbacks:{label:(ctx)=>ctx.dataset.label+': '+ctx.parsed.y+' дн.',afterBody:(items)=>{const m=months[items[0]?.dataIndex];const n=m?.[groupKey]?.timeToClose?.sampleSize;return n?`на основі ${n} угод`:'';}}}},scales:{y:{beginAtZero:true,grid:{color:GRID},ticks:{callback:v=>v+' дн.'}},x:{grid:{color:GRID},ticks:{font:{size:9}}}}}});
    };
    buildChart('ttc-wh-chart', 'wholesale', WH);
    buildChart('ttc-rt-chart', 'retail', RT);
  }

  // ── Всього (компанія) — сума 24+18+32+0 разом. Безпечно сумувати причини
  // відмов (не гроші!) — вже порахована на сервері як lossReasonsTotal,
  // тут просто рендеримо. Темний нейтральний колір — виділяє це як
  // ЗВЕДЕНИЙ підсумок, не ще одну "групу" поряд з ОПТ/Роздроб/Скринінг. ──
  const TOTAL_CLR = '#334155';
  let _totalReasonsView='bar';

  window.setTotalReasonsView=function(view){
    _totalReasonsView=view;
    const barBtn=document.getElementById('loss-reasons-total-view-bar');
    const pieBtn=document.getElementById('loss-reasons-total-view-pie');
    if(barBtn&&pieBtn){
      barBtn.style.background=view==='bar'?'var(--tx)':'#fff';
      barBtn.style.color=view==='bar'?'#fff':'var(--tx)';
      pieBtn.style.background=view==='pie'?'var(--tx)':'#fff';
      pieBtn.style.color=view==='pie'?'#fff':'var(--tx)';
    }
    renderTotalReasons();
  };

  function renderTotalReasons(){
    const sel=document.getElementById('loss-reasons-total-period');
    const period=sel?sel.value:'all';
    const note=document.getElementById('loss-reasons-total-note');

    let reasons, label;
    if(period==='all' && _lrHistory && _lrHistory.months && _lrHistory.months.length){
      const merged={};
      _lrHistory.months.forEach(m=>(m['lossReasonsTotal']||[]).forEach(r=>{merged[r.reason]=(merged[r.reason]||0)+r.count;}));
      reasons=Object.entries(merged).map(([reason,count])=>({reason,count})).sort((a,b)=>b.count-a.count);
      const months=_lrHistory.months.map(m=>m.month).sort();
      label=`${months[0]} → ${months[months.length-1]} (${months.length} міс.)`;
    }else if(period==='all'){
      reasons=(_lrCurrent&&_lrCurrent.lossReasonsTotal)||[];
      label=(_lrCurrent&&_lrCurrent.month)||'—';
    }else{
      const m=(_lrHistory&&_lrHistory.months||[]).find(x=>x.month===period);
      reasons=(m&&m.lossReasonsTotal)||[];
      label=period+(m&&m.complete===false?' (частково, ще триває)':'');
    }
    if(note) note.textContent=label;

    const DL=window.ChartDataLabels;
    const total=reasons.reduce((s,r)=>s+r.count,0);
    const canvasId='loss-reasons-total-chart';
    if(_totalReasonsView==='pie'){
      const shades=reasons.map((_,i)=>{
        const t=reasons.length>1?i/(reasons.length-1):0;
        return shadeColor(TOTAL_CLR, .15+t*.55);
      });
      safeChartLoss(canvasId,{type:'pie',plugins:DL?[DL]:[],data:{labels:reasons.map(r=>r.reason),datasets:[{
        data:reasons.map(r=>r.count), backgroundColor:shades, borderColor:'#fff', borderWidth:2,
      }]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'right',labels:{font:{size:9},boxWidth:10,padding:6}},datalabels:{color:'#fff',font:{size:10,weight:'700'},formatter:v=>total?Math.round(v/total*100)+'%':'',display:ctx=>ctx.dataset.data[ctx.dataIndex]/total>0.04}}}});
      return;
    }
    safeChartLoss(canvasId,{type:'bar',plugins:DL?[DL]:[],data:{labels:reasons.slice(0,10).map(r=>r.reason),datasets:[{
      label:'Відмов', data:reasons.slice(0,10).map(r=>r.count), backgroundColor:TOTAL_CLR+'26', borderColor:TOTAL_CLR, borderWidth:1.5, borderRadius:5,
    }]},options:{indexAxis:'y',responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},datalabels:{anchor:'end',align:'end',offset:4,color:TOTAL_CLR,font:{size:10,weight:'700'},formatter:v=>total?`${v} (${Math.round(v/total*100)}%)`:v}},layout:{padding:{right:60}},scales:{x:{beginAtZero:true,grid:{color:GRID},ticks:{stepSize:1}},y:{grid:{display:false},ticks:{font:{size:10}}}}}});
  }

  function renderTotalReasonsTrend(){
    const months=(_lrHistory&&_lrHistory.months||[]).slice().sort((a,b)=>a.month.localeCompare(b.month));
    const canvas=document.getElementById('loss-reasons-total-trend-chart');
    if(!canvas || months.length<2) return;
    const sel=document.getElementById('loss-reasons-total-period');
    const selected=sel?sel.value:'all';
    const labels=months.map(m=>m.month);
    const palette=[TOTAL_CLR,WH,RT,G,A,R,GD,'#8B5CF6','#EC4899','#14B8A6'];

    const totals={};
    months.forEach(m=>(m['lossReasonsTotal']||[]).forEach(r=>{totals[r.reason]=(totals[r.reason]||0)+r.count;}));
    const topReasons=Object.entries(totals).sort((a,b)=>b[1]-a[1]).slice(0,8).map(x=>x[0]);
    const datasets=topReasons.map((reason,i)=>{
      const data=months.map(m=>{
        const r=(m['lossReasonsTotal']||[]).find(x=>x.reason===reason);
        return r?r.count:0;
      });
      const pointRadius=months.map(m=>m.month===selected?7:3);
      const color=palette[i%palette.length];
      return {label:reason, data, borderColor:color, backgroundColor:color+'22', borderWidth:2, tension:.3, pointRadius, pointBackgroundColor:color, fill:false};
    });
    safeChartLoss('loss-reasons-total-trend-chart',{type:'line',data:{labels,datasets},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'bottom',labels:{usePointStyle:true,padding:6,font:{size:8},boxWidth:8}}},scales:{y:{beginAtZero:true,grid:{color:GRID},ticks:{stepSize:1}},x:{grid:{color:GRID},ticks:{font:{size:9}}}}}});
  }


  const TIER_LABELS=['Дрібні (<10К)','Середні (10К–100К)','Мега-опт (>100К)'];
  const TIER_KEYS=['small','medium','mega'];

  function renderTiers(){
    const sel=document.getElementById('tiers-period');
    const period=sel?sel.value:'all';
    const note=document.getElementById('tiers-note');

    let whTiers, rtTiers, label;
    const sumTiers=(monthsArr, groupKey)=>{
      const merged={}; TIER_KEYS.forEach(k=>merged[k]={deals:0,revenue:0});
      monthsArr.forEach(m=>{
        (m[groupKey]?.tiers||[]).forEach(t=>{ merged[t.tier].deals+=t.deals; merged[t.tier].revenue+=t.revenue; });
      });
      return TIER_KEYS.map((k,i)=>({tier:k,label:TIER_LABELS[i],...merged[k]}));
    };

    if(period==='all' && _lrHistory && _lrHistory.months && _lrHistory.months.length){
      whTiers=sumTiers(_lrHistory.months,'wholesale');
      rtTiers=sumTiers(_lrHistory.months,'retail');
      const months=_lrHistory.months.map(m=>m.month).sort();
      label=`${months[0]} → ${months[months.length-1]} (${months.length} міс.)`;
    }else if(period==='all'){
      whTiers=(_lrCurrent&&_lrCurrent.wholesale&&_lrCurrent.wholesale.tiers)||[];
      rtTiers=(_lrCurrent&&_lrCurrent.retail&&_lrCurrent.retail.tiers)||[];
      label=(_lrCurrent&&_lrCurrent.month)||'—';
    }else{
      const m=(_lrHistory&&_lrHistory.months||[]).find(x=>x.month===period);
      whTiers=(m&&m.wholesale&&m.wholesale.tiers)||[];
      rtTiers=(m&&m.retail&&m.retail.tiers)||[];
      label=period+(m&&m.complete===false?' (частково, ще триває)':'');
    }
    if(note) note.textContent=label;

    const tierColors=[RT, A, WH]; // дрібні->бренд роздрібу, середні->нейтральний, мега->бренд опту (умовно, просто для розрізнення стовпців)
    const buildChart=(canvasId, tiers)=>{
      const DL=window.ChartDataLabels;
      const total=tiers.reduce((s,t)=>s+t.deals,0);
      safeChartLoss(canvasId,{type:'bar',plugins:DL?[DL]:[],data:{labels:tiers.map(t=>t.label),datasets:[{
        label:'Угод', data:tiers.map(t=>t.deals), backgroundColor:tierColors.map(c=>c+'33'), borderColor:tierColors, borderWidth:1.5, borderRadius:6,
      }]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{afterLabel:(ctx)=>{const t=tiers[ctx.dataIndex];return t?_fmt(t.revenue)+' грн разом':'';}}},datalabels:{anchor:'end',align:'end',offset:4,color:(ctx)=>tierColors[ctx.dataIndex],font:{size:11,weight:'700'},formatter:v=>total?`${v} (${Math.round(v/total*100)}%)`:v}},layout:{padding:{top:24}},scales:{y:{beginAtZero:true,grid:{color:GRID},ticks:{stepSize:1}},x:{grid:{display:false},ticks:{font:{size:10}}}}}});
    };
    buildChart('tiers-wh-chart', whTiers);
    buildChart('tiers-rt-chart', rtTiers);
  }

  // Локальний кеш чартів для причин відмов/тірів (окремо від _charts, щоб
  // не конфліктувати з destroy-логікою інших графіків цього файлу)
  const _lrCharts={};
  function safeChartLoss(id,cfg){
    const canvas=document.getElementById(id); if(!canvas) return;
    if(_lrCharts[id]){ try{_lrCharts[id].destroy();}catch(e){} }
    _lrCharts[id]=new Chart(canvas,cfg);
  }

  // ── Динаміка тірів по місяцях (сезонність) — завжди весь рік, вибраний у
  // фільтрі місяць лише підсвічується більшою точкою на лінії ──
  function renderTiersTrend(){
    const wrap=document.getElementById('tiers-trend-wrap');
    if(!wrap) return;
    const months=(_lrHistory&&_lrHistory.months||[]).slice().sort((a,b)=>a.month.localeCompare(b.month));
    if(months.length<2){ wrap.style.display='none'; return; }
    wrap.style.display='';
    const sel=document.getElementById('tiers-period');
    const selected=sel?sel.value:'all';
    const labels=months.map(m=>m.month);
    const tierColors=[RT, A, WH];

    const buildTrend=(canvasId, groupKey)=>{
      const datasets=TIER_KEYS.map((key,i)=>{
        const data=months.map(m=>{
          const t=(m[groupKey]?.tiers||[]).find(x=>x.tier===key);
          return t?t.deals:0;
        });
        const pointRadius=months.map(m=>m.month===selected?7:3);
        return {
          label:TIER_LABELS[i], data, borderColor:tierColors[i], backgroundColor:tierColors[i]+'22',
          borderWidth:2, tension:.3, pointRadius, pointBackgroundColor:tierColors[i], fill:false,
        };
      });
      safeChartLoss(canvasId,{type:'line',data:{labels,datasets},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'top',labels:{usePointStyle:true,padding:8,font:{size:9}}}},scales:{y:{beginAtZero:true,grid:{color:GRID},ticks:{stepSize:1}},x:{grid:{color:GRID},ticks:{font:{size:9}}}}}});
    };
    buildTrend('tiers-wh-trend-chart','wholesale');
    buildTrend('tiers-rt-trend-chart','retail');
  }

  // ── 2. Комбінований графік ОПТ + Роздріб ──────────────────────────────────
  function _renderCombinedChart() {
    const canvas=document.getElementById('sales-combined-chart');if(!canvas)return;
    const wm=_data.wholesale?.monthly||[], rm=_data.retail?.monthly||[];
    const labels=(wm.length?wm:rm).map(m=>m.month.substring(0,3));
    if(_charts.combined){try{_charts.combined.destroy();}catch(e){}}
    const DL=window.ChartDataLabels;
    _charts.combined=new Chart(canvas,{type:'bar',plugins:DL?[DL]:[],data:{labels,datasets:[
      {label:'ОПТ факт',data:wm.map(m=>m.fact),backgroundColor:WHB,borderColor:WH,borderWidth:1.5,borderRadius:4,yAxisID:'y'},
      {label:'Роздріб факт',data:rm.map(m=>m.fact),backgroundColor:RTB,borderColor:RT,borderWidth:1.5,borderRadius:4,yAxisID:'y1'},
    ]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'top',labels:{usePointStyle:true,padding:10}},datalabels:{anchor:'end',align:'end',offset:2,font:{size:8,weight:'700'},color:(ctx)=>ctx.datasetIndex===0?WH:RT,formatter:v=>v?_fmt(v):''}},layout:{padding:{top:16}},scales:{
      x:{grid:{color:GRID}},
      y:{type:'linear',position:'left',grid:{color:GRID},ticks:{callback:v=>_fmt(v)},title:{display:true,text:'ОПТ',font:{size:9},color:WH}},
      y1:{type:'linear',position:'right',grid:{drawOnChartArea:false},ticks:{callback:v=>_fmt(v)},title:{display:true,text:'Роздріб',font:{size:9},color:RT}},
    }}});
  }

  // ── 3. Роздріб: графік + таблиця ──────────────────────────────────────────
  function _renderRetail() {
    const data=_data.retail?.monthly||[];
    const canvas=document.getElementById('sales-retail-chart');
    if(canvas&&data.length){
      if(_charts.retail){try{_charts.retail.destroy();}catch(e){}}
      const DL=window.ChartDataLabels;
      _charts.retail=new Chart(canvas,{type:'bar',plugins:DL?[DL]:[],data:{labels:data.map(m=>m.month.substring(0,3)),datasets:[
        {label:'План',data:data.map(m=>m.plan),backgroundColor:'rgba(150,168,144,.25)',borderRadius:4},
        {label:'Факт',data:data.map(m=>m.fact),backgroundColor:RTB,borderColor:RT,borderWidth:1.5,borderRadius:4},
      ]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'top',labels:{usePointStyle:true,padding:8,font:{size:10}}},datalabels:{anchor:'end',align:'end',offset:2,font:{size:8,weight:'700'},color:(ctx)=>ctx.datasetIndex===0?'#96a890':RT,formatter:v=>v?_fmt(v):''}},layout:{padding:{top:14}},scales:{x:{grid:{color:GRID}},y:{grid:{color:GRID},ticks:{callback:v=>_fmt(v)}}}}});
    }
    const tbody=document.getElementById('sales-retail-table');
    if(tbody) tbody.innerHTML=data.map(m=>{
      const pc=m.pct==null?'var(--tl)':m.pct>=90?GD:m.pct>=60?A:R;
      const isCurrentMonth=!m.fact&&m.plan;
      return `<tr style="${isCurrentMonth?'opacity:.6':''}"><td>${m.month}</td><td style="text-align:right">${_fmt(m.plan)}</td><td style="text-align:right">${m.fact?_fmt(m.fact):'очікується'}</td><td style="text-align:right;font-weight:700;color:${pc}">${m.pct!=null?m.pct+'%':'—'}</td></tr>`;
    }).join('');
  }

  // ── 4. Опт: графік + таблиця ──────────────────────────────────────────────
  function _renderWholesale() {
    const data=_data.wholesale?.monthly||[];
    const canvas=document.getElementById('sales-wholesale-chart');
    if(canvas&&data.length){
      if(_charts.wh){try{_charts.wh.destroy();}catch(e){}}
      const DL=window.ChartDataLabels;
      _charts.wh=new Chart(canvas,{type:'bar',plugins:DL?[DL]:[],data:{labels:data.map(m=>m.month.substring(0,3)),datasets:[
        {label:'План',data:data.map(m=>m.plan),backgroundColor:'rgba(150,168,144,.25)',borderRadius:4},
        {label:'Факт',data:data.map(m=>m.fact),backgroundColor:WHB,borderColor:WH,borderWidth:1.5,borderRadius:4},
      ]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'top',labels:{usePointStyle:true,padding:8,font:{size:10}}},datalabels:{anchor:'end',align:'end',offset:2,font:{size:8,weight:'700'},color:(ctx)=>ctx.datasetIndex===0?'#96a890':WH,formatter:v=>v?_fmt(v):''}},layout:{padding:{top:14}},scales:{x:{grid:{color:GRID}},y:{grid:{color:GRID},ticks:{callback:v=>_fmt(v)}}}}});
    }
    const tbody=document.getElementById('sales-wholesale-table');
    if(tbody) tbody.innerHTML=data.map(m=>{
      const pc=m.pct==null?'var(--tl)':m.pct>=100?GD:m.pct>=70?A:R;
      const isCurrentMonth=!m.fact&&m.plan;
      return `<tr style="${isCurrentMonth?'opacity:.6':''}"><td>${m.month}</td><td style="text-align:right">${m.plan?_fmt(m.plan):'—'}</td><td style="text-align:right">${m.fact?_fmt(m.fact):'очікується'}</td><td style="text-align:right;font-weight:700;color:${pc}">${m.pct!=null?m.pct+'%':'—'}</td></tr>`;
    }).join('');
  }

  // ── 5. Пайплайн оптових угод ──────────────────────────────────────────────
  function _renderPipeline() {
    const pipe=_data.pipeline||{};
    const stages=pipe.stages||[];

    // Воронка — bar chart по стадіях
    const canvas=document.getElementById('sales-pipeline-chart');
    if(canvas&&stages.length){
      const STAGE_COLORS={
        won:'rgba(42,157,143,.85)', active:'rgba(69,123,157,.8)',
        test:'rgba(183,142,42,.75)', calculation:'rgba(130,130,180,.7)',
        waiting:'rgba(160,110,60,.65)', slow:'rgba(192,140,57,.6)',
        lost:'rgba(192,57,43,.5)', other:'rgba(150,150,150,.5)',
      };
      if(_charts.pipeline){try{_charts.pipeline.destroy();}catch(e){}}
      const nonLost=stages.filter(s=>s.stage!=='lost');
      _charts.pipeline=new Chart(canvas,{type:'bar',data:{
        labels:nonLost.map(s=>s.label),
        datasets:[
          {label:'Сума угод, грн',data:nonLost.map(s=>s.sum),backgroundColor:nonLost.map(s=>STAGE_COLORS[s.stage]||'rgba(150,150,150,.5)'),borderRadius:4,yAxisID:'y'},
          {label:'К-сть угод',data:nonLost.map(s=>s.count),backgroundColor:'rgba(0,0,0,.08)',borderRadius:4,yAxisID:'y1'},
        ]
      },options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'top',labels:{usePointStyle:true,padding:8,font:{size:10}}}},scales:{
        x:{grid:{display:false},ticks:{font:{size:9},maxRotation:30}},
        y:{type:'linear',position:'left',grid:{color:GRID},ticks:{callback:v=>_fmt(v)},title:{display:true,text:'Сума',font:{size:9},color:GD}},
        y1:{type:'linear',position:'right',grid:{drawOnChartArea:false},title:{display:true,text:'Угод',font:{size:9}}},
      }}});
    }

    // Топ активних угод
    const listEl=document.getElementById('sales-pipeline-list');
    if(listEl){
      const deals=(pipe.active_deals||[]).slice(0,8);
      if(!deals.length){listEl.innerHTML='<p style="color:var(--tl)">Немає активних угод</p>';return;}
      const STAGE_COLOR={won:GD,active:G,test:'#b58b2a',calculation:A,waiting:'#a06e3c',slow:'#c08c39'};
      listEl.innerHTML=deals.map(d=>`
        <div class="mr" style="margin-bottom:6px">
          <div class="mn" style="white-space:normal;line-height:1.3">${d.client||'—'}</div>
          <div style="display:flex;flex-direction:column;align-items:flex-end;gap:2px">
            <div class="mv" style="color:${STAGE_COLOR[d.stage]||A};font-size:11px;font-weight:700">${_fmt(d.total)} грн</div>
            <div style="font-size:9px;color:var(--tl)">${d.stage_label}</div>
          </div>
        </div>`).join('');
    }
  }

  // ── 6. Якість лідів ──────────────────────────────────────────────────────
  function _renderLeadsQuality() {
    const canvas=document.getElementById('sales-leads-quality-chart');
    if(!canvas) return;
    const lq=(_data.leads_quality||[]).filter(m=>m.total_leads>0);
    if(!lq.length){canvas.parentElement.innerHTML='<p style="color:var(--tl);padding:1rem">Даних немає</p>';return;}
    const labels=lq.map(m=>`${m.month_name.substring(0,3)} ${String(m.year).substring(2)}`);
    if(_charts.lq){try{_charts.lq.destroy();}catch(e){}}
    _charts.lq=new Chart(canvas,{type:'bar',data:{labels,datasets:[
      {label:'Цільові %',data:lq.map(m=>m.target_pct),backgroundColor:'rgba(42,157,143,.8)',borderRadius:3,stack:'s'},
      {label:'Спам %',data:lq.map(m=>m.spam_pct),backgroundColor:'rgba(192,57,43,.65)',borderRadius:3,stack:'s'},
      {label:'Не завершили %',data:lq.map(m=>m.no_cont_pct),backgroundColor:'rgba(150,150,150,.5)',borderRadius:3,stack:'s'},
    ]},options:{responsive:true,maintainAspectRatio:false,
      plugins:{legend:{position:'top',labels:{usePointStyle:true,padding:10,font:{size:10}}},
        tooltip:{callbacks:{label:ctx=>`${ctx.dataset.label}: ${ctx.parsed.y.toFixed(1)}%`}}},
      scales:{
        x:{stacked:true,grid:{display:false}},
        y:{stacked:true,max:100,grid:{color:GRID},ticks:{callback:v=>v+'%'}},
      }}});
  }

  // ── 7. Ефективність менеджерів (похідні метрики) ──────────────────────────
  function _renderManagerEfficiency() {
    const mgrs=_data.manager_efficiency||[];
    if(!mgrs.length) return;

    // Гістограма: частка в пайплайні + угоди/тиждень
    const canvas=document.getElementById('sales-mgr-chart');
    if(canvas){
      const names=mgrs.map(m=>m.manager.split(' ').slice(-1)[0]); // тільки прізвище
      if(_charts.mgr){try{_charts.mgr.destroy();}catch(e){}}
      _charts.mgr=new Chart(canvas,{type:'bar',data:{labels:names,datasets:[
        {label:'Частка в пайплайні %',data:mgrs.map(m=>m.pipeline_share_pct),backgroundColor:'rgba(42,157,143,.75)',borderRadius:4,yAxisID:'y'},
        {label:'Угод / активний тиждень',data:mgrs.map(m=>m.deals_per_week),backgroundColor:'rgba(69,123,157,.65)',borderRadius:4,yAxisID:'y1'},
      ]},options:{responsive:true,maintainAspectRatio:false,
        plugins:{legend:{position:'top',labels:{usePointStyle:true,padding:10,font:{size:10}}}},
        scales:{
          x:{grid:{display:false}},
          y:{type:'linear',position:'left',beginAtZero:true,grid:{color:GRID},ticks:{callback:v=>v+'%'},title:{display:true,text:'Частка пайплайну',font:{size:9},color:GD}},
          y1:{type:'linear',position:'right',beginAtZero:true,grid:{drawOnChartArea:false},title:{display:true,text:'Угод/тиждень',font:{size:9},color:A}},
        }}});
    }

    // Картки менеджерів
    const grid=document.getElementById('sales-mgr-cards');
    if(grid){
      const maxShare=Math.max(...mgrs.map(m=>m.pipeline_share_pct),1);
      grid.innerHTML=mgrs.map(m=>{
        const barW=Math.max(m.pipeline_share_pct/maxShare*100,4);
        const cls=m.pipeline_share_pct>20?'pef-hi':m.pipeline_share_pct>5?'pef-md':'pef-lo';
        return `<div class="pec">
          <div class="pen">${m.manager}</div>
          <div class="pebw"><div class="pef ${cls}" style="width:${barW}%"></div></div>
          <div class="pept" style="display:flex;flex-direction:column;gap:2px">
            <span>Пайплайн: <b>${_fmt(m.deals_sum)} грн</b> (${m.pipeline_share_pct}%)</span>
            <span style="color:var(--tl)">${m.deals_count} угод · ${m.deals_per_week} угод/тиж · ${m.active_weeks} акт.тижнів</span>
          </div>
        </div>`;
      }).join('');
    }
  }

  function _updateTimestamp() {
    const el=document.getElementById('sales-updated-at');
    if(!el||!_data?.fetched_at) return;
    try{
      const d=new Date(_data.fetched_at);
      el.textContent='Оновлено: '+d.toLocaleString('uk-UA',{timeZone:'Europe/Kyiv',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});
    }catch(e){}
  }

  document.addEventListener('DOMContentLoaded',()=>{
    if(document.getElementById('panel-sales')?.classList.contains('active')) load();
  });

  return {load};
})();
