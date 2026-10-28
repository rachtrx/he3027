const $=id=>document.getElementById(id);
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const name=x=>String(x).replaceAll('_',' ').replace(/\b\w/g,c=>c.toUpperCase());
const groupName=id=>catalog.groups.find(g=>g.id===id)?.label||name(id.replace(/^\d+[_ -]*/, '').replace(/_outputs$/, ''));
const fmt=(x,key='')=>x==null?'—':typeof x==='number'?((key==='p'||key.endsWith('_p')||key==='p-value')&&x<.001)?'<0.001':Number.isInteger(x)?x.toLocaleString():Math.abs(x)>0&&Math.abs(x)<.0001?x.toExponential(3):x.toFixed(4):esc(x);
const cell=(v,key)=>key==='beta'?`<span class="${v>0?'positive':v<0?'negative':''}">${fmt(v)}</span>`:fmt(v);
const url=p=>p.split('/').map(encodeURIComponent).join('/');
const table=(heads,rows)=>`<table><thead><tr>${heads.map(h=>`<th scope="col">${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${r.map((v,i)=>i?`<td>${v}</td>`:`<th scope="row">${v}</th>`).join('')}</tr>`).join('')}</tbody></table>`;
const hatSymbol=(letter,label)=>`<span class="math-hat" role="img" aria-label="${label}"><span>${letter}</span><span class="hat-accent" aria-hidden="true">ˆ</span></span>`;
let catalog, pool=[], diagnostics=[], selected=[], activeCoeffIndex=0, loaded=null, page=0, sortKey=null, ascending=true, request=0;
const timingOf=r=>r.exposure_label||r.crime_exposure||r.exposure||r.timing||null;
const timingLabel=r=>{const t=timingOf(r);return ({lagyear:'Previous year','previous-year':'Previous year','current-year':'Annual',prior6:'Prior 6 months',prior12:'Prior 12 months',prior24:'Prior 24 months',prior36:'Prior 36 months',annual:'Annual',none:'Not applicable'})[t]||t||'Not specified';};
const sourceOf=r=>{const source=r.data_source||((String(r.crime||'').startsWith('mps_')||r._iv||/\bmps\b/i.test(r.source||''))?'MPS':r.model||r.specification?'Original Stata':r.source||'Source unspecified');return /mps/i.test(source)?'MPS':/stata|original/i.test(source)?'Original Stata':source;};
const crimeLabel=r=>({allcrime:'All crime',mps_all:'All crime',violentcrime:'Violence',violent_crime:'Violence',mps_violence:'Violence',propertycrime:'Property crime',mps_property:'Property crime'})[r.crime]||r.crime||'Crime unspecified';
const modelOrder=(a,b)=>Number(String(a.model||'').replace(/^M/i,''))-Number(String(b.model||'').replace(/^M/i,''));
function decodeSharedSelection(){
 if(!location.hash.startsWith('#compare='))return null;
 try{const token=location.hash.slice(9).replace(/-/g,'+').replace(/_/g,'/');const binary=atob(token+'='.repeat((4-token.length%4)%4));const bytes=Uint8Array.from(binary,c=>c.charCodeAt(0));const value=JSON.parse(new TextDecoder().decode(bytes));return Array.isArray(value)?value.filter(x=>typeof x==='string'):null;}catch{return null;}
}
function writeSharedSelection(){
 if(!selected.length)return;
 const bytes=new TextEncoder().encode(JSON.stringify(selected));let binary='';for(const byte of bytes)binary+=String.fromCharCode(byte);
 const token=btoa(binary).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
 const hash=`#compare=${token}`;if(location.hash!==hash)history.replaceState(null,'',`${location.pathname}${location.search}${hash}`);
}
function rowLabel(r){
 const crime={allcrime:'All crime',violentcrime:'Violence',violent_crime:'Violence',propertycrime:'Property crime',mps_all:'All crime',mps_violence:'Violence',mps_property:'Property crime','no crime':'Property-only benchmark'}[r.crime]||r.crime||'';
 const data=sourceOf(r);
 const time=timingLabel(r);
 const estimator=r.method==='2SLS'?'IV':r.method||r.estimator||(r.quantile!=null?'Quantile':r._family==='Spatial regressions'?'Spatial':'OLS');
 const specification=({recent_level:'Recent 12-month level',year_on_year_change:'Δ log crime'})[r.specification]||r.specification;
 const model=r.model||specification||(r.quantile!=null?`Q${Number((r.quantile*100).toFixed(2))}`:'Model unspecified');
 const sample=r._group==='08_crime_original_robustness_outputs'?(String(r.panel).startsWith('pre2014')?'2012–2013 sales':'2012–2014 sales'):r._group==='01_crime_original_outputs'?'Full 2011–2015 sales':r._family==='Crime exposure windows'?'April 2013–2015 sales':null;
 return [model,estimator,data,sample,time,crime,r._group==='11_crime_mps_change_outputs'?specification:null,r.threshold_c!=null?`${r.threshold_c}°C`:null,r.quantile!=null&&r.specification?`Q${r.quantile*100}`:null].filter(Boolean).join(' · ');
}
const reportGroup=r=>{
 if(r._group==='02_crime_mps_outputs')return timingOf(r)==='prior12'?'6.1–6.2 · MPS prior 12 months':'6.2.1 · MPS crime timing';
 if(r._group==='01_crime_original_outputs'||r._group==='08_crime_original_robustness_outputs')return '6.2.2 · Original crime sample windows';
 if(r._group==='04_crime_iv_outputs')return '6.3.1 · Violent-crime temperature IV';
 if(r._group==='06_crime_spatial_outputs')return '6.3.2 · Neighbouring violent crime';
 if(r._group==='03_crime_mps_interaction_outputs')return 'Additional · Borough-income interaction';
 if(r._group==='10_crime_mps_exposure_windows_outputs')return 'Additional · Longer crime windows';
 if(r._group==='11_crime_mps_change_outputs')return 'Additional · Crime level and Δ log crime';
 return 'Additional · Quantile regressions';
};
const reportGroups=['6.1–6.2 · MPS prior 12 months','6.2.1 · MPS crime timing','6.2.2 · Original crime sample windows','6.3.1 · Violent-crime temperature IV','6.3.2 · Neighbouring violent crime','Additional · Borough-income interaction','Additional · Longer crime windows','Additional · Crime level and Δ log crime','Additional · Quantile regressions'];
const crimeRank=r=>({mps_all:0,allcrime:0,mps_violence:1,violent_crime:1,violentcrime:1,mps_property:2,propertycrime:2})[r.crime]??9;
const timingRank=r=>({annual:0,lagyear:1,prior12:2,prior6:3,prior24:4,prior36:5})[timingOf(r)]??9;
const reportSort=(a,b)=>{
 const group=reportGroups.indexOf(reportGroup(a))-reportGroups.indexOf(reportGroup(b));if(group)return group;
 const sample=r=>r._group==='01_crime_original_outputs'?0:String(r.panel||'').startsWith('pre2014')?2:1;
 if(reportGroup(a)==='6.2.2 · Original crime sample windows'){const diff=sample(a)-sample(b);if(diff)return diff;}
 const crime=crimeRank(a)-crimeRank(b);if(crime)return crime;
 if(reportGroup(a)==='6.1–6.2 · MPS prior 12 months')return modelOrder(a,b);
 if(reportGroup(a)==='6.3.1 · Violent-crime temperature IV')return a.threshold_c-b.threshold_c;
 if(reportGroup(a)==='6.3.2 · Neighbouring violent crime')return (a.specification==='Own crime only'?0:a.k)-(b.specification==='Own crime only'?0:b.k);
 if(reportGroup(a)==='Additional · Longer crime windows')return ({prior6:0,prior12:1,prior24:2,prior36:3})[timingOf(a)]-({prior6:0,prior12:1,prior24:2,prior36:3})[timingOf(b)];
 if(reportGroup(a)==='Additional · Crime level and Δ log crime')return (a.specification==='recent_level'?0:1)-(b.specification==='recent_level'?0:1);
 if(reportGroup(a)==='Additional · Quantile regressions')return Number(a.quantile)-Number(b.quantile);
 return timingRank(a)-timingRank(b)||modelOrder(a,b);
};
function renderFullCoefficients(index){
 activeCoeffIndex=index;
 const r=options().find(r=>r.id===selected[index]);if(!r)return;
 const coeff=r.coefficients||[];
 $('coeff-title').textContent=`${rowLabel(r)} · Full regression`;
 $('copy-coeff').dataset.copyCoeff=String(index);
 const statsText=`N = ${fmt(r.N)} · R² = ${fmt(r.r2)} · Clusters = ${fmt(r.clusters)}`;
 if(!coeff.length){$('coeff-content').innerHTML=`<p class="note">${statsText}</p><p class="note">No matching full coefficient export was found for this result.</p>`;return;}
 const cols=['variable','beta','se','t','p','ci_low','ci_high'].filter(k=>r.coefficient_columns?.includes(k));
 const headings={variable:'Variable',beta:'Coefficient',se:'Standard error',t:'t statistic',p:'p-value',ci_low:'95% CI lower',ci_high:'95% CI upper'};
 $('coeff-content').innerHTML=`<p class="note">${statsText}</p>${table(cols.map(k=>headings[k]||name(k)),coeff.map(c=>cols.map(k=>k==='variable'?esc(c[k]):fmt(c[k],k))))}`;
}
const options=()=>pool;
function inReportDropdown(row,family){
 const group=row._group||family.id.split('/')[0];
 if(family.id==='main'){
  if(group==='02_crime_mps_outputs')return (/^M[2-7]$/i.test(row.model||'')&&timingOf(row)==='prior12')||(row.model==='M7'&&['annual','lagyear'].includes(timingOf(row)));
  return ['01_crime_original_outputs','08_crime_original_robustness_outputs'].includes(group)&&row.model==='M7'&&['annual','lagyear'].includes(timingOf(row));
 }
 if(group==='05_crime_quantile_outputs')return family.id.endsWith('/quantile_results.csv');
 if(group==='06_crime_spatial_outputs')return row.crime==='mps_violence'&&row.exposure==='prior12';
 return ['03_crime_mps_interaction_outputs','04_crime_iv_outputs','10_crime_mps_exposure_windows_outputs','11_crime_mps_change_outputs'].includes(group);
}
function prepareComparisons(){
 const unique=new Map();diagnostics=[];
 for(const family of catalog.families){
  const iv=family.columns.includes('first_stage_wald_F')||family.rows.some(r=>r.method==='2SLS');
  for(const row of family.rows){
   if(!inReportDropdown(row,family))continue;
   if(iv&&!['2SLS','OLS','TWFE'].includes(row.method)){diagnostics.push({...row,analysis:family.label});continue;}
   const identity=JSON.stringify([family.id==='main'?'main':family.id.split('/')[0],...['model','panel','specification','method','crime','quantile','k','N','beta','threshold_c'].map(k=>row[k]??null),timingOf(row)]);
   const interaction=String(row.method||'').startsWith('Crime ×')||row.interaction_beta!=null;
   const group=row._group||family.id.split('/')[0];
   const candidate={...row,id:identity,_group:group,_iv:iv,_family:group==='08_crime_original_robustness_outputs'?'Original crime · restricted years':family.id==='main'?'Main regressions':group==='10_crime_mps_exposure_windows_outputs'?'Crime exposure windows':group==='11_crime_mps_change_outputs'?'Δ log crime':interaction?'Interaction regressions':iv?'Temperature IV · prior12 violence':row.quantile!=null?'Quantile regressions':'Spatial regressions',analysis:family.label};
   if(group==='06_crime_spatial_outputs'){
    const neighbour=(row.coefficients||[]).find(c=>/^W(4|8|12)_mps_violence$/.test(c.variable||''));
    candidate.neighbour_beta=neighbour?.beta??null;
    candidate.neighbour_se=neighbour?.se??null;
   }
   const previous=unique.get(identity);
   if(!previous||Object.keys(row).length>Object.keys(previous).length-4)unique.set(identity,candidate);
  }
 }
 pool=[...unique.values()].sort(reportSort);
 renderShortcuts();
 const shared=decodeSharedSelection();
 const validShared=shared?.filter(id=>pool.some(r=>r.id===id))||[];
 selected=validShared.length?validShared:defaultPreset().map(r=>r.id);
 if(selected.length<2)selected.push(...pool.filter(r=>!selected.includes(r.id)).slice(0,2-selected.length).map(r=>r.id));
 renderCompare();
 const baseline=(catalog.baseline_iv_diagnostics||[]).sort((a,b)=>crimeRank(a)-crimeRank(b));
 const precise=x=>x==null?'—':Number(x).toPrecision(3);
 $('diagnostic-table').innerHTML=baseline.length?table(
  ['Crime','N','First-stage β / hot day','First-stage SE','First-stage F','Partial R²','Wooldridge χ²','Wooldridge p','Reject exogeneity at 5%?','F below 10?'],
  baseline.map(r=>[esc(crimeLabel(r)),fmt(r.N),precise(r.first_stage_beta_per_hot_day),precise(r.first_stage_se_weather_cell),fmt(r.first_stage_F_weather_cell),precise(r.partial_R2),fmt(r.wooldridge_exogeneity_chi2),fmt(r.wooldridge_exogeneity_p,'p-value'),r.wooldridge_exogeneity_p<.05?'Yes':'No',r.first_stage_F_weather_cell<10?'Yes':'No'])):'No 25°C prior-12-month diagnostics found.';
 const tests=(catalog.diagnostics||[]).flatMap(x=>x.rows);
 $('hausman-summary').textContent=tests.length?`For violent crime, ${tests.filter(r=>r.wooldridge_exogeneity_p<.05).length} of ${tests.length} threshold-specific conditional exogeneity tests reject at 5%. These tests are conditional on a valid instrument.`:'No focused endogeneity tests found.';
 const auxiliary=catalog.families.flatMap(f=>f.rows).filter(r=>r.threshold_c!=null&&r.crime==='violentcrime'&&r.exposure==='prior12').sort((a,b)=>a.threshold_c-b.threshold_c);
 const auxCols=['threshold_c','beta','se','ci_low','ci_high','p','first_stage_wald_F','partial_R2','wooldridge_exogeneity_p'];
 const auxNames=['Threshold (°C)','2SLS β','SE','95% CI lower','95% CI upper','p-value','First-stage F','Partial R²','Wooldridge p'];
 $('other-iv-diagnostics').innerHTML=auxiliary.length?table(auxNames,auxiliary.map(r=>auxCols.map(k=>k==='partial_R2'?precise(r[k]):cell(r[k],k)))):'No focused IV results found.';
 const focus=catalog.files.find(f=>f.id==='04_crime_iv_outputs/temperature_m7_violent_prior12_thresholds.csv');
 const figure=catalog.files.find(f=>f.id==='04_crime_iv_outputs/temperature_m7_threshold_violent_prior12_iv.png');
 if(focus)$('iv-download').href=url(focus.url);
 if(figure)$('iv-threshold-figure').innerHTML=`<button class="image-button" data-open="${esc(figure.id)}" aria-label="Enlarge ${esc(figure.title)}"><img src="${url(figure.url)}" alt="Violent-crime prior12 IV estimates by temperature threshold"></button>`;
}
const reportPresets=[
 {id:'table1',section:'6.1–6.2',label:'All crime · M2–M7',match:r=>r._group==='02_crime_mps_outputs'&&r.crime==='mps_all'&&timingOf(r)==='prior12'},
 ...['mps_all','mps_violence','mps_property'].map(crime=>({id:`timing_${crime}`,section:'6.2.1',label:`${crimeLabel({crime})} · three timings`,match:r=>r._group==='02_crime_mps_outputs'&&r.model==='M7'&&r.crime===crime})),
 ...['allcrime','violent_crime','propertycrime'].map(crime=>({id:`original_${crime}`,section:'6.2.2',label:`${crimeLabel({crime})} · three windows, current/previous`,match:r=>['01_crime_original_outputs','08_crime_original_robustness_outputs'].includes(r._group)&&r.crime===crime})),
 {id:'violent_m5_m7',section:'6.3',label:'Violence · M5–M7',match:r=>r._group==='02_crime_mps_outputs'&&r.crime==='mps_violence'&&timingOf(r)==='prior12'&&['M5','M6','M7'].includes(r.model)},
 {id:'iv',section:'6.3.1',label:'Violence · IV thresholds',match:r=>r._group==='04_crime_iv_outputs'},
 {id:'spatial',section:'6.3.2',label:'Violence · neighbours',match:r=>r._group==='06_crime_spatial_outputs'},
];
const presetRows=id=>{
 const rows=pool.filter(reportPresets.find(p=>p.id===id)?.match||(()=>false));
 return rows.sort(id.startsWith('timing_')?(a,b)=>timingRank(a)-timingRank(b):reportSort);
};
function defaultPreset(){return presetRows('table1');}
function renderShortcuts(){
 const sections=[...new Set(reportPresets.map(p=>p.section))];
 $('shortcuts').innerHTML=sections.map(section=>`<div class="shortcut-source"><h3>Report §${esc(section)}</h3><div class="shortcut-group">${reportPresets.filter(p=>p.section===section).map(p=>`<button class="quick-button" data-shortcut="report" data-preset="${esc(p.id)}">${esc(p.label)}</button>`).join('')}</div></div>`).join('');
}
function applyShortcut(button){
 const rows=presetRows(button.dataset.preset);
 if(!rows.length)return;
 selected=rows.map(r=>r.id);
 renderCompare();
}
function renderCompare(){
 const rows=options();$('iv-diagnostics').hidden=!(catalog.diagnostics||[]).length;
 if(!rows.length){$('comparison').textContent='No matching regressions.';return;}
 selected=selected.filter(id=>rows.some(r=>r.id===id));
 while(selected.length<Math.min(2,rows.length))selected.push(rows.find(r=>!selected.includes(r.id)).id);
 const dropdownGroup=reportGroup;
 const groups=[...new Set(rows.map(dropdownGroup))];
 const headers=selected.map((id,i)=>`<th class="column-head" scope="col"><div class="column-control"><select id="r${i}" aria-label="Regression for column ${i+1}" title="${esc(rowLabel(rows.find(r=>r.id===id)))}" data-select="${i}">${groups.map(group=>`<optgroup label="${esc(group)}">${rows.filter(r=>dropdownGroup(r)===group).map(r=>`<option value="${esc(r.id)}" ${r.id===id?'selected':''}>${esc(rowLabel(r))}</option>`).join('')}</optgroup>`).join('')}</select><button class="column-remove" data-remove="${i}" aria-label="Remove comparison ${i+1}" title="Remove column" ${selected.length<=2?'disabled':''}>×</button></div><button class="full-model-button" data-open-coeff="${i}">Full regression</button></th>`).join('');
 const atLimit=selected.length>=rows.length;
 const chosen=selected.map(id=>rows.find(r=>r.id===id));
 const isInteraction=chosen.some(r=>r._family==='Interaction regressions');
 const isSpatial=chosen.some(r=>r._group==='06_crime_spatial_outputs');
 const fields=['model','crime','canonical_exposure',...(isInteraction?['crime_main_beta']:[]),'beta','se',...(isSpatial?['neighbour_beta','neighbour_se']:[]),'p','requires_iv','ci_low','ci_high','N','r2'].filter(k=>k!=='r2'||chosen.some(r=>r.r2!=null));
 const labels={model:'Model / estimator',crime:'Crime measure',canonical_exposure:'Crime data · exposure',crime_main_beta:'Crime β at mean borough income (04)',beta:isInteraction?'Reported β (04: crime × income)':isSpatial?'Crime β (own area for spatial)':hatSymbol('β','beta hat'),se:isInteraction?'Reported β standard error':isSpatial?'Crime SE (own area for spatial)':`SE(${hatSymbol('β','beta hat')})`,neighbour_beta:'Neighbouring crime β',neighbour_se:'Neighbouring crime SE',p:isSpatial?'Crime p-value (own area for spatial)':'p-value',requires_iv:'Requires IV?*',ci_low:isSpatial?'Crime 95% CI lower (own area for spatial)':'95% CI lower',ci_high:isSpatial?'Crime 95% CI upper (own area for spatial)':'95% CI upper',N:'N',r2:'R²'};
 const shown=(r,k)=>{
  if(k==='crime')return ({allcrime:'All crime',violent_crime:'Violence',propertycrime:'Property crime',mps_all:'All crime',mps_violence:'Violence',mps_property:'Property crime','no crime':'None (benchmark)'})[r[k]]||r[k]||'—';
  if(k==='model'){
   const base=r.model||(r.quantile!=null?`Q${Number((r.quantile*100).toFixed(0))}`:r.specification)||'—';
   const display=r._group==='11_crime_mps_change_outputs'?`${base} · ${({recent_level:'Recent 12-month level',year_on_year_change:'Δ log crime'})[r.specification]||r.specification}`:base;
   const estimator=r.method||(r.estimator)||(r.quantile!=null?'Quantile':r.model?'OLS':r._family==='Spatial regressions'?'Spatial':'');
   return estimator?`${display} · ${estimator}`:display;
  }
  if(k==='canonical_exposure'){
   const timing=timingLabel(r);
   return `${sourceOf(r)} · ${timing}`;
  }
  if(k==='crime_main_beta'){
   if(r._family!=='Interaction regressions')return '—';
   const main=(r.coefficients||[]).find(c=>c.variable===`crime_${r.crime}_c`);
   return fmt(main?.beta);
  }
  if(k==='requires_iv'){
   if(!r._iv||r.threshold_c==null)return '—';
   const test=(catalog.diagnostics||[]).flatMap(d=>d.rows).find(t=>t.threshold_c===r.threshold_c&&t.crime===r.crime&&t.exposure===r.exposure);
   return test?(test.wooldridge_exogeneity_p<.05?'Yes*':'No*'):'—';
  }
  return fmt(r[k],k);
 };
 const scroll=$('comparison').scrollLeft;
 $('comparison').innerHTML=`<table style="--comparison-count:${selected.length}"><thead><tr><th scope="col">Statistic</th>${headers}<th class="add-column" scope="col"><button data-add="true" aria-label="Add comparison column" title="${atLimit?'No more regressions to add':'Add comparison'}" ${atLimit?'disabled':''}>+</button></th></tr></thead><tbody>${fields.map(k=>`<tr><th scope="row">${labels[k]}</th>${chosen.map(r=>`<td>${shown(r,k)}</td>`).join('')}<td class="add-column"></td></tr>`).join('')}</tbody></table>`;
 $('comparison').scrollLeft=scroll;
 writeSharedSelection();
 if($('coeff-dialog').open)renderFullCoefficients(activeCoeffIndex);
 $('context').textContent='The dropdown follows report sections 6.1–6.3, then lists additional analyses. Cross-analysis comparisons are descriptive and samples differ. For spatial rows, the main crime β, SE, p and confidence interval describe own-LSOA crime; separate rows show neighbouring-crime β and SE. The displayed temperature IV models target only prior-12-month violent crime at four cutoffs, but heat may affect prices directly. Notebook 11’s Δ log crime compares two non-overlapping 12-month periods.';
}
function matches(item){return(!$('group').value||item.group===$('group').value)&&(`${item.title} ${item.group}`.toLowerCase().includes($('search').value.toLowerCase()));}
function browse(){
 const items=catalog.files.filter(matches), images=items.filter(x=>x.kind==='figure'), tables=items.filter(x=>x.kind==='table');
 $('gallery').innerHTML=images.map(f=>`<article><button class="image-button" data-open="${esc(f.id)}" aria-label="Enlarge ${esc(f.title)}"><img loading="lazy" src="${url(f.url)}" alt="${esc(f.title)}"></button><h3 class="output-title">${esc(f.title)}</h3><small>${esc(groupName(f.group))}</small><a href="${url(f.url)}" download>Download</a></article>`).join('')||'<p>No matching figures.</p>';
 $('files').innerHTML=tables.map(f=>`<article><h3 class="output-title">${esc(f.title)}</h3><small>${esc(groupName(f.group))} · ${f.rows.toLocaleString()} rows</small><div class="output-actions"><button data-table="${esc(f.id)}" aria-label="View table: ${esc(f.title)}">View table</button><a href="${url(f.url)}" download>Download CSV</a></div></article>`).join('')||'<p>No matching tables.</p>';
 $('inventory').textContent=`${images.length} figures · ${tables.length} tables matching filters`;
}
function renderTable(){
 if(!loaded)return;
 let rows=loaded.rows.filter(r=>Object.values(r).some(v=>String(v??'').toLowerCase().includes($('row-search').value.toLowerCase())));
 if(sortKey)rows.sort((a,b)=>{const x=a[sortKey],y=b[sortKey];return (typeof x==='number'&&typeof y==='number'?x-y:String(x??'').localeCompare(String(y??'')))*(ascending?1:-1);});
 page=Math.max(0,Math.min(page,Math.ceil(rows.length/50)-1));
 $('preview').innerHTML=table(loaded.columns.map(name),rows.slice(page*50,(page+1)*50).map(r=>loaded.columns.map(k=>cell(r[k],k))));
 $('page').textContent=`${rows.length? page*50+1:0}–${Math.min((page+1)*50,rows.length)} of ${rows.length}`;
 $('prev').disabled=page===0;$('next').disabled=(page+1)*50>=rows.length;
}
async function renderSpatialAppendix(){
 const files=[
  ['moran_diagnostics_crime_formatted.csv','spatial-appendix-table','spatial-appendix-download'],
  ['moran_diagnostics_price_formatted.csv','spatial-price-table','spatial-price-download']
 ];
 for(const [filename,tableId,downloadId] of files){
  const file=catalog.files.find(f=>f.id===`06_crime_spatial_outputs/${filename}`);
  if(!file)return;
  const response=await fetch(url(file.json));
  if(!response.ok)throw Error(`HTTP ${response.status}`);
  const data=await response.json();
  $(tableId).innerHTML=table(data.columns,data.rows.map(row=>data.columns.map(key=>cell(row[key],key))));
  $(downloadId).href=url(file.url);
 }
 $('spatial-appendix').hidden=false;
}
document.addEventListener('click',async e=>{
 const b=e.target.closest('button');if(!b)return;
 if(b.dataset.copyTable){
  const source=$(b.dataset.copyTable)?.querySelector('table');if(!source)return;
  const rows=[...source.querySelectorAll('tr')].map(tr=>[...tr.children].map(c=>c.textContent.trim()));
  const plain=rows.map(row=>row.join('\t')).join('\n');
  const html=`<table border="1" style="border-collapse:collapse">${source.innerHTML}</table>`;
  let copied=false;
  try{await navigator.clipboard.write([new ClipboardItem({'text/html':new Blob([html],{type:'text/html'}),'text/plain':new Blob([plain],{type:'text/plain'})})]);copied=true;}
  catch{const area=document.createElement('div');area.contentEditable='true';area.style.position='fixed';area.style.left='-10000px';area.innerHTML=html;document.body.append(area);const range=document.createRange();range.selectNodeContents(area);const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);copied=document.execCommand('copy');selection.removeAllRanges();area.remove();}
  b.textContent=copied?'Copied table':'Copy failed';setTimeout(()=>{b.textContent=b.dataset.copyLabel|| (b.dataset.copyTable==='diagnostic-table'?'Copy endogeneity table':'Copy IV diagnostics table');},1800);return;
 }
 if(b.id==='reset-comparison'){selected=defaultPreset().map(r=>r.id);renderCompare();return;}
 if(b.dataset.shortcut){applyShortcut(b);return;}
 if(b.dataset.remove!=null&&selected.length>2){const index=+b.dataset.remove;selected.splice(index,1);renderCompare();document.getElementById(`r${Math.min(index,selected.length-1)}`)?.focus();}
 if(b.dataset.add){const next=options().find(r=>!selected.includes(r.id));if(next){selected.push(next.id);renderCompare();document.getElementById(`r${selected.length-1}`)?.focus();}}
 if(b.dataset.openCoeff!=null){renderFullCoefficients(+b.dataset.openCoeff);$('coeff-dialog').showModal();}
 if(b.dataset.copyCoeff!=null){const r=options().find(r=>r.id===selected[+b.dataset.copyCoeff]);if(r){
  const cols=['variable','beta','se','t','p','ci_low','ci_high'].filter(k=>r.coefficient_columns?.includes(k));
  const heading={variable:'Variable',beta:'Coefficient',se:'Standard error',t:'t statistic',p:'p-value',ci_low:'95% CI lower',ci_high:'95% CI upper'};
  const safe=x=>esc(x==null?'':x);
  const statsText=`N = ${fmt(r.N)} · R² = ${fmt(r.r2)} · Clusters = ${fmt(r.clusters)}`;
  const html=`<p>${safe(statsText)}</p><table border="1" style="border-collapse:collapse"><caption>${safe(rowLabel(r))} · Full regression</caption><thead><tr>${cols.map(k=>`<th>${safe(heading[k]||name(k))}</th>`).join('')}</tr></thead><tbody>${(r.coefficients||[]).map(row=>`<tr>${cols.map(k=>`<td>${safe(k==='variable'?row[k]:fmt(row[k],k))}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  const plain=[statsText,cols.map(k=>heading[k]||name(k)).join('\t'),...(r.coefficients||[]).map(row=>cols.map(k=>row[k]??'').join('\t'))].join('\n');
  try{
   if(navigator.clipboard?.write&&window.ClipboardItem){
    await navigator.clipboard.write([new ClipboardItem({'text/html':new Blob([html],{type:'text/html'}),'text/plain':new Blob([plain],{type:'text/plain'})})]);
   }else throw Error('Rich clipboard unavailable');
   b.classList.add('is-copied');b.setAttribute('aria-label','Copied');b.title='Copied as table';
  }catch{
   const area=document.createElement('div');area.contentEditable='true';area.style.position='fixed';area.style.left='-10000px';area.innerHTML=html;document.body.append(area);
   const range=document.createRange();range.selectNodeContents(area);const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);
   const copied=document.execCommand('copy');selection.removeAllRanges();area.remove();
   b.classList.toggle('is-copied',copied);b.setAttribute('aria-label',copied?'Copied':'Copy failed');b.title=copied?'Copied as table':'Select and copy the table';
  }
  setTimeout(()=>{b.classList.remove('is-copied');b.setAttribute('aria-label','Copy table');b.title='Copy table';},1800);
 }}
 if(b.dataset.open){const f=catalog.files.find(f=>f.id===b.dataset.open);$('large-image').src=url(f.url);$('large-image').alt=f.title;$('image-title').textContent=f.title;$('image-dialog').showModal();}
 if(b.dataset.table){const f=catalog.files.find(f=>f.id===b.dataset.table),token=++request;loaded=null;$('table-title').textContent=f.title;$('preview').textContent='Loading…';$('page').textContent='';$('prev').disabled=true;$('next').disabled=true;$('table-dialog').showModal();try{const r=await fetch(url(f.json));if(!r.ok)throw Error(`HTTP ${r.status}`);const data=await r.json();if(token!==request)return;loaded=data;page=0;sortKey=null;ascending=true;$('direction').textContent='Ascending';$('row-search').value='';$('sort').innerHTML='<option value="">Original order</option>'+loaded.columns.map(c=>`<option value="${esc(c)}">${esc(name(c))}</option>`).join('');renderTable();}catch(err){if(token===request){loaded=null;$('preview').textContent=`Could not load table: ${err.message}`;}}}
});
$('comparison').addEventListener('change',e=>{if(e.target.dataset.select!=null){const index=+e.target.dataset.select;selected[index]=e.target.value;renderCompare();document.getElementById(`r${index}`)?.focus({preventScroll:true});}});
$('group').onchange=browse;$('search').oninput=browse;
$('close-image').onclick=()=>$('image-dialog').close();
$('close-coeff').onclick=()=>$('coeff-dialog').close();
$('coeff-dialog').addEventListener('click',e=>{if(e.target===$('coeff-dialog'))$('coeff-dialog').close();});
$('close-table').onclick=()=>$('table-dialog').close();
for(const id of ['image-dialog','table-dialog']){
 const dialog=$(id);
 dialog.addEventListener('click',e=>{if(e.target===dialog)dialog.close();});
}
$('table-dialog').addEventListener('close',()=>{request++;});
$('row-search').oninput=()=>{page=0;renderTable();};$('sort').onchange=()=>{sortKey=$('sort').value;renderTable();};$('direction').onclick=()=>{ascending=!ascending;$('direction').textContent=ascending?'Ascending':'Descending';renderTable();};$('prev').onclick=()=>{page--;renderTable();};$('next').onclick=()=>{page++;renderTable();};
fetch('generated/catalog.json').then(r=>{if(!r.ok)throw Error(`HTTP ${r.status}`);return r.json();}).then(data=>{catalog=data;$('group').innerHTML='<option value="">All notebooks</option>'+data.groups.map(g=>`<option value="${esc(g.id)}">${esc(g.label)}</option>`).join('');prepareComparisons();browse();renderSpatialAppendix().catch(e=>{$('spatial-appendix-table').textContent=`Could not load appendix table: ${e.message}`;$('spatial-appendix').hidden=false;});$('status').textContent=`Built ${new Date(data.built_at).toLocaleString()} · ${data.files.length} outputs. Build time is not notebook execution time.`;}).catch(e=>{$('status').textContent=`Could not load results: ${e.message}`;});
