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
  }

  // ── 2. Комбінований графік ОПТ + Роздріб ──────────────────────────────────
  function _renderCombinedChart() {
    const canvas=document.getElementById('sales-combined-chart');if(!canvas)return;
    const wm=_data.wholesale?.monthly||[], rm=_data.retail?.monthly||[];
    const labels=(wm.length?wm:rm).map(m=>m.month.substring(0,3));
    if(_charts.combined){try{_charts.combined.destroy();}catch(e){}}
    _charts.combined=new Chart(canvas,{type:'bar',data:{labels,datasets:[
      {label:'ОПТ факт',data:wm.map(m=>m.fact),backgroundColor:GB,borderColor:G,borderWidth:1.5,borderRadius:4,yAxisID:'y'},
      {label:'Роздріб факт',data:rm.map(m=>m.fact),backgroundColor:AB,borderColor:A,borderWidth:1.5,borderRadius:4,yAxisID:'y1'},
    ]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'top',labels:{usePointStyle:true,padding:10}}},scales:{
      x:{grid:{color:GRID}},
      y:{type:'linear',position:'left',grid:{color:GRID},ticks:{callback:v=>_fmt(v)},title:{display:true,text:'ОПТ',font:{size:9},color:G}},
      y1:{type:'linear',position:'right',grid:{drawOnChartArea:false},ticks:{callback:v=>_fmt(v)},title:{display:true,text:'Роздріб',font:{size:9},color:A}},
    }}});
  }

  // ── 3. Роздріб: графік + таблиця ──────────────────────────────────────────
  function _renderRetail() {
    const data=_data.retail?.monthly||[];
    const canvas=document.getElementById('sales-retail-chart');
    if(canvas&&data.length){
      if(_charts.retail){try{_charts.retail.destroy();}catch(e){}}
      _charts.retail=new Chart(canvas,{type:'bar',data:{labels:data.map(m=>m.month.substring(0,3)),datasets:[
        {label:'План',data:data.map(m=>m.plan),backgroundColor:'rgba(150,168,144,.25)',borderRadius:4},
        {label:'Факт',data:data.map(m=>m.fact),backgroundColor:AB,borderColor:A,borderWidth:1.5,borderRadius:4},
      ]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'top',labels:{usePointStyle:true,padding:8,font:{size:10}}}},scales:{x:{grid:{color:GRID}},y:{grid:{color:GRID},ticks:{callback:v=>_fmt(v)}}}}});
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
      _charts.wh=new Chart(canvas,{type:'bar',data:{labels:data.map(m=>m.month.substring(0,3)),datasets:[
        {label:'План',data:data.map(m=>m.plan),backgroundColor:'rgba(150,168,144,.25)',borderRadius:4},
        {label:'Факт',data:data.map(m=>m.fact),backgroundColor:GB,borderColor:G,borderWidth:1.5,borderRadius:4},
      ]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'top',labels:{usePointStyle:true,padding:8,font:{size:10}}}},scales:{x:{grid:{color:GRID}},y:{grid:{color:GRID},ticks:{callback:v=>_fmt(v)}}}}});
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
