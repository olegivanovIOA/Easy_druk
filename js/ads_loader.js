/**
 * ads_loader.js — Easy 3D Print Dashboard v1.2
 * Фільтри по кампанії/статусу/ROAS, тижневий/денний перемикач,
 * ROAS гістограма, алерти RED кампаній, рекомендації
 */

window.AdsLoader = (() => {
  const DATA_URL = 'data/ads.json';
  let _data = null;
  let _charts = {};
  let _period = 'week';

  const G = '#2A9D8F', GD = '#1e7a6e', A = '#457B9D', R = '#C0392B';
  const GB = 'rgba(42,157,143,.15)', AB = 'rgba(69,123,157,.15)';
  const GRID = '#f0f2ee';

  async function load() {
    try {
      const r = await fetch(DATA_URL + '?t=' + Date.now());
      if (!r.ok) throw new Error('HTTP ' + r.status);
      _data = await r.json();
      _initFilters();
      render();
    } catch (e) {
      console.warn('[ADS] Помилка:', e);
      const s = document.getElementById('ads-status');
      if (s) s.textContent = '✗ Дані реклами недоступні';
    }
  }

  function _initFilters() {
    const sel = document.getElementById('ads-filter-campaign');
    if (!sel || !_data) return;
    sel.innerHTML = '<option value="all">Всі кампанії</option>';
    (_data.analytics?.active || []).forEach(c => {
      const o = document.createElement('option');
      o.value = c.campaign;
      o.textContent = c.campaign.length > 35 ? c.campaign.substring(0,33)+'…' : c.campaign;
      sel.appendChild(o);
    });
  }

  function _getFilters() {
    return {
      campaign: document.getElementById('ads-filter-campaign')?.value || 'all',
      status:   document.getElementById('ads-filter-status')?.value   || 'all',
      roas:     document.getElementById('ads-filter-roas')?.value     || 'all',
    };
  }

  function _filterCampaigns(list) {
    const f = _getFilters();
    return list.filter(c => {
      if (f.campaign !== 'all' && c.campaign !== f.campaign) return false;
      if (f.status !== 'all' && c.traffic_light !== f.status) return false;
      const rv = parseFloat(c.roas);
      if (f.roas === 'profitable' && (isNaN(rv) || rv < 2)) return false;
      if (f.roas === 'loss' && (isNaN(rv) || rv >= 1)) return false;
      return true;
    });
  }

  function applyFilters() {
    if (!_data) return;
    _renderSummary();
    _renderCampaignsTable();
    _renderRoasChart();
    _renderBudgetChart();
  }

  function setPeriod(period) {
    _period = period;
    ['week','day'].forEach(p => {
      const btn = document.getElementById('ads-period-'+p);
      if (btn) {
        btn.style.background = p === period ? 'var(--g)' : 'transparent';
        btn.style.color = p === period ? '#fff' : 'var(--tm)';
      }
    });
    _renderFunnelChart();
    _renderCtrChart();
  }

  function render() {
    if (!_data) return;
    _renderSummary();
    _renderAlertRed();
    _renderRecommendations();
    _renderFunnelChart();
    _renderCtrChart();
    _renderCampaignsTable();
    _renderRoasChart();
    _renderBudgetChart();
    _updateTimestamp();
  }

  function _renderSummary() {
    const allActive = _data.analytics?.active || [];
    const filtered = _filterCampaigns(allActive);
    const totalCost = filtered.reduce((s,c) => s+(c.cost_uah||0), 0);
    const totalConv = filtered.reduce((s,c) => s+(parseFloat(c.conversions)||0), 0);
    const roasVals = filtered.map(c=>parseFloat(c.roas)).filter(v=>!isNaN(v)&&v>0);
    const avgRoas = roasVals.length ? (roasVals.reduce((a,b)=>a+b,0)/roasVals.length).toFixed(2) : null;
    const redCount = filtered.filter(c=>c.traffic_light==='RED').length;
    const funnel = _data.funnel || [];
    const avgCtr = funnel.length ? (funnel.reduce((s,d)=>s+(d.ctr_pct||0),0)/funnel.length).toFixed(2) : null;

    _set('ads-cost-total',   totalCost ? _fmt(totalCost)+' грн' : '—');
    _set('ads-conv-total',   Math.round(totalConv) || '—');
    _set('ads-roas-avg',     avgRoas ? avgRoas+'x' : '—');
    _set('ads-active-count', filtered.length);
    _set('ads-red-count',    redCount);
    _set('ads-ctr-avg',      avgCtr ? avgCtr+'%' : '—');

    const re = document.getElementById('ads-roas-avg');
    if (re && avgRoas) re.style.color = avgRoas>=3?GD:avgRoas>=1?A:R;
    const redEl = document.getElementById('ads-red-count');
    if (redEl) redEl.style.color = redCount>0?R:GD;
  }

  function _renderAlertRed() {
    const alertEl = document.getElementById('ads-alert-red');
    const textEl  = document.getElementById('ads-alert-red-text');
    if (!alertEl||!textEl) return;
    const reds = (_data.analytics?.active||[]).filter(c=>c.traffic_light==='RED'&&c.cost_uah>0);
    if (!reds.length){alertEl.style.display='none';return;}
    alertEl.style.display='';
    textEl.innerHTML = reds.map(c=>`<b>${c.campaign}</b> (${_fmt(c.cost_uah)} грн, ROAS ${isNaN(parseFloat(c.roas))?'—':parseFloat(c.roas).toFixed(2)+'x'})`).join('; ') + ' — рекомендовано зупинити';
  }

  function _renderRecommendations() {
    const el = document.getElementById('ads-recommendations');
    if (!el||!_data) return;
    const active = _data.analytics?.active||[];
    const recs = [];

    [...active].filter(c=>parseFloat(c.roas)>=3&&c.cost_uah>0)
      .sort((a,b)=>parseFloat(b.roas)-parseFloat(a.roas)).slice(0,2)
      .forEach(c=>recs.push({t:'g',icon:'🚀',text:`<b>${c.campaign}</b> — ROAS ${parseFloat(c.roas).toFixed(2)}x. Рекомендовано збільшити бюджет.`}));

    active.filter(c=>c.traffic_light==='RED'&&c.cost_uah>0)
      .forEach(c=>recs.push({t:'r',icon:'🛑',text:`<b>${c.campaign}</b> — ${_fmt(c.cost_uah)} грн, ROAS ${isNaN(parseFloat(c.roas))?'0':parseFloat(c.roas).toFixed(2)}x. Зупинити або переглянути.`}));

    const funnel = _data.funnel||[];
    if (funnel.length>=14){
      const last7=funnel.slice(-7), prev7=funnel.slice(-14,-7);
      const cvr1=last7.reduce((s,d)=>s+(d.cvr_pct||0),0)/7;
      const cvr0=prev7.reduce((s,d)=>s+(d.cvr_pct||0),0)/7;
      const delta=cvr1-cvr0;
      if(Math.abs(delta)>0.5) recs.push({t:delta>0?'g':'a',icon:delta>0?'📈':'📉',text:`CVR останні 7 днів: <b>${cvr1.toFixed(1)}%</b> (${delta>0?'+':''}${delta.toFixed(1)}% до попереднього тижня).`});
    }

    el.innerHTML = recs.map(r=>`<div class="al al-${r.t}" style="margin-bottom:6px"><span class="ic">${r.icon}</span><div style="font-size:12px">${r.text}</div></div>`).join('');
  }

  function _getWeeklyFunnel() {
    const funnel = _data.funnel||[];
    const byWeek={};
    funnel.forEach(d=>{
      const dt=new Date(d.date);
      const key=`${dt.getFullYear()}-${String(dt.getMonth()).padStart(2,'0')}-${Math.ceil(dt.getDate()/7)}`;
      if(!byWeek[key]) byWeek[key]={clicks:0,leads:0,ctr:[],cvr:[]};
      byWeek[key].clicks+=d.clicks||0;
      byWeek[key].leads+=d.leads||0;
      byWeek[key].ctr.push(d.ctr_pct||0);
      byWeek[key].cvr.push(d.cvr_pct||0);
    });
    return Object.keys(byWeek).sort().map((k,i)=>({
      label:'Тиж.'+(i+1),
      clicks:byWeek[k].clicks,
      leads:Math.round(byWeek[k].leads),
      ctr:+(byWeek[k].ctr.reduce((a,b)=>a+b,0)/byWeek[k].ctr.length).toFixed(2),
      cvr:+(byWeek[k].cvr.reduce((a,b)=>a+b,0)/byWeek[k].cvr.length).toFixed(2),
    }));
  }

  function _renderFunnelChart() {
    const canvas=document.getElementById('ads-funnel-chart');if(!canvas)return;
    let data, labels, clicks, leads;
    if(_period==='week'){
      data=_getWeeklyFunnel();
      labels=data.map(d=>d.label);clicks=data.map(d=>d.clicks);leads=data.map(d=>d.leads);
    } else {
      const f=(_data.funnel||[]).slice(-30);
      labels=f.map(d=>{const dt=new Date(d.date);return(dt.getMonth()+1)+'/'+dt.getDate();});
      clicks=f.map(d=>d.clicks||0);leads=f.map(d=>Math.round(d.leads||0));
    }
    if(_charts.funnel){try{_charts.funnel.destroy();}catch(e){}}
    _charts.funnel=new Chart(canvas,{type:'bar',data:{labels,datasets:[
      {label:'Кліки',data:clicks,backgroundColor:AB,borderColor:A,borderWidth:1.5,borderRadius:4,yAxisID:'y1'},
      {label:'Ліди',data:leads,backgroundColor:GB,borderColor:G,borderWidth:1.5,borderRadius:4,yAxisID:'y'},
    ]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'top',labels:{usePointStyle:true,padding:10,font:{size:10}}}},scales:{x:{grid:{color:GRID}},y:{type:'linear',position:'left',beginAtZero:true,grid:{color:GRID},title:{display:true,text:'Ліди',font:{size:9},color:G}},y1:{type:'linear',position:'right',beginAtZero:true,grid:{drawOnChartArea:false},title:{display:true,text:'Кліки',font:{size:9},color:A}}}}});
  }

  function _renderCtrChart() {
    const canvas=document.getElementById('ads-ctr-chart');if(!canvas)return;
    let labels,ctrData,cvrData;
    if(_period==='week'){
      const data=_getWeeklyFunnel();
      labels=data.map(d=>d.label);ctrData=data.map(d=>d.ctr);cvrData=data.map(d=>d.cvr);
    } else {
      const f=(_data.funnel||[]).slice(-30);
      labels=f.map(d=>{const dt=new Date(d.date);return(dt.getMonth()+1)+'/'+dt.getDate();});
      ctrData=f.map(d=>d.ctr_pct||0);cvrData=f.map(d=>d.cvr_pct||0);
    }
    if(_charts.ctr){try{_charts.ctr.destroy();}catch(e){}}
    _charts.ctr=new Chart(canvas,{type:'line',data:{labels,datasets:[
      {label:'CTR%',data:ctrData,borderColor:A,borderWidth:2,tension:.4,fill:false,pointRadius:3,pointBackgroundColor:A},
      {label:'CVR%',data:cvrData,borderColor:G,borderWidth:2,tension:.4,fill:false,pointRadius:3,pointBackgroundColor:G},
    ]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'top',labels:{usePointStyle:true,padding:10,font:{size:10}}}},scales:{x:{grid:{color:GRID}},y:{grid:{color:GRID},ticks:{callback:v=>v+'%'},beginAtZero:true}}}});
  }

  function _renderCampaignsTable() {
    const container=document.getElementById('ads-campaigns-table');if(!container)return;
    const allActive=_data.analytics?.active||[];
    const filtered=_filterCampaigns(allActive);
    const countEl=document.getElementById('ads-camp-count');
    if(countEl) countEl.textContent=`Показано: ${filtered.length} з ${allActive.length}`;
    if(!filtered.length){container.innerHTML='<p style="color:var(--tl);font-size:12px;padding:12px">Немає кампаній за фільтром</p>';return;}
    const sorted=[...filtered].sort((a,b)=>{
      if(a.traffic_light==='RED'&&b.traffic_light!=='RED')return-1;
      if(b.traffic_light==='RED'&&a.traffic_light!=='RED')return 1;
      return(b.cost_uah||0)-(a.cost_uah||0);
    });
    const LIGHT={GREEN:{bg:'#d4edda',color:'#0A3D20'},RED:{bg:'#f8d7da',color:'#721c24'},YELLOW:{bg:'#fff3cd',color:'#856404'}};
    const rows=sorted.map(c=>{
      const lc=LIGHT[c.traffic_light]||LIGHT.YELLOW;
      const rv=parseFloat(c.roas);
      const rc=!isNaN(rv)?(rv>=3?GD:rv>=1?A:R):'var(--tl)';
      const rt=!isNaN(rv)?rv.toFixed(2)+'x':'—';
      return `<tr><td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${c.campaign}">${c.campaign}</td><td style="text-align:right;font-weight:600">${_fmt(c.cost_uah)} грн</td><td style="text-align:center">${Math.round(parseFloat(c.conversions)||0)}</td><td style="text-align:right;font-weight:700;color:${rc}">${rt}</td><td style="text-align:right">${(c.clicks||0).toLocaleString('uk-UA')}</td><td style="text-align:center">${(c.ctr_pct||0).toFixed(2)}%</td><td style="text-align:center"><span style="background:${lc.bg};color:${lc.color};padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700">${c.traffic_light}</span></td></tr>`;
    }).join('');
    container.innerHTML=`<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:12px"><thead><tr style="background:var(--s2)"><th style="padding:7px 10px;text-align:left;font-size:10px;font-weight:700;text-transform:uppercase">Кампанія</th><th style="padding:7px 10px;text-align:right;font-size:10px;font-weight:700;text-transform:uppercase">Витрати</th><th style="padding:7px 10px;text-align:center;font-size:10px;font-weight:700;text-transform:uppercase">Конв.</th><th style="padding:7px 10px;text-align:right;font-size:10px;font-weight:700;text-transform:uppercase">ROAS</th><th style="padding:7px 10px;text-align:right;font-size:10px;font-weight:700;text-transform:uppercase">Кліки</th><th style="padding:7px 10px;text-align:center;font-size:10px;font-weight:700;text-transform:uppercase">CTR</th><th style="padding:7px 10px;text-align:center;font-size:10px;font-weight:700;text-transform:uppercase">Статус</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }

  function _renderRoasChart() {
    const canvas=document.getElementById('ads-roas-chart');if(!canvas)return;
    const filtered=_filterCampaigns(_data.analytics?.active||[]).filter(c=>parseFloat(c.roas)>0&&c.cost_uah>0).sort((a,b)=>parseFloat(b.roas)-parseFloat(a.roas)).slice(0,12);
    if(!filtered.length){canvas.parentElement.innerHTML='<p style="color:var(--tl);font-size:12px;padding:1rem">Немає даних ROAS</p>';return;}
    const colors=filtered.map(c=>{const r=parseFloat(c.roas);return r>=3?'rgba(42,157,143,.8)':r>=1?'rgba(69,123,157,.7)':'rgba(192,57,43,.7)';});
    if(_charts.roas){try{_charts.roas.destroy();}catch(e){}}
    _charts.roas=new Chart(canvas,{type:'bar',data:{labels:filtered.map(c=>c.campaign.length>20?c.campaign.substring(0,18)+'…':c.campaign),datasets:[{label:'ROAS',data:filtered.map(c=>parseFloat(c.roas)),backgroundColor:colors,borderRadius:4}]},options:{indexAxis:'y',responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:ctx=>ctx.parsed.x.toFixed(2)+'x'}}},scales:{x:{grid:{color:GRID},title:{display:true,text:'ROAS',font:{size:9}},beginAtZero:true},y:{grid:{display:false},ticks:{font:{size:9}}}}}});
  }

  function _renderBudgetChart() {
    const canvas=document.getElementById('ads-budget-chart');if(!canvas)return;
    const filtered=_filterCampaigns(_data.analytics?.active||[]).filter(c=>(c.cost_uah||0)>0).sort((a,b)=>b.cost_uah-a.cost_uah).slice(0,10);
    if(!filtered.length){canvas.parentElement.innerHTML='<p style="color:var(--tl);font-size:12px;padding:1rem">Немає витрат</p>';return;}
    const colors=filtered.map(c=>c.traffic_light==='RED'?'rgba(192,57,43,.75)':c.traffic_light==='GREEN'?'rgba(42,157,143,.75)':'rgba(69,123,157,.6)');
    if(_charts.budget){try{_charts.budget.destroy();}catch(e){}}
    _charts.budget=new Chart(canvas,{type:'bar',data:{labels:filtered.map(c=>c.campaign.length>22?c.campaign.substring(0,20)+'…':c.campaign),datasets:[{label:'Витрати, грн',data:filtered.map(c=>c.cost_uah),backgroundColor:colors,borderRadius:4}]},options:{indexAxis:'y',responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:ctx=>_fmt(ctx.parsed.x)+' грн'}}},scales:{x:{grid:{color:GRID},ticks:{callback:v=>_fmt(v)+' грн'}},y:{grid:{display:false},ticks:{font:{size:9}}}}}});
  }

  function _set(id,val){const el=document.getElementById(id);if(el)el.textContent=val;}
  function _fmt(n){if(!n&&n!==0)return'—';return Number(n).toLocaleString('uk-UA',{maximumFractionDigits:0});}
  function _updateTimestamp(){
    const el=document.getElementById('ads-updated-at');
    if(!el||!_data?.fetched_at)return;
    try{const d=new Date(_data.fetched_at);el.textContent='Оновлено: '+d.toLocaleString('uk-UA',{timeZone:'Europe/Kyiv',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});}catch(e){}
  }

  return{load,applyFilters,setPeriod};
})();
