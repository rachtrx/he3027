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
const timingLabel=r=>{const t=timingOf(r);return ({lagyear:'Previous year','previous-year':'Previous year','current-year':'Annual',prior12:'Prior 12 months',annual:'Annual',none:'Not applicable'})[t]||t||'Not specified';};
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
 const model=r.model||r.specification||(r.quantile!=null?`Q${Number((r.quantile*100).toFixed(2))}`:'Model unspecified');
 const sample=r._group==='08_crime_original_robustness_outputs'?(String(r.panel).startsWith('pre2014')?'2012–2013 sales':'2012–2014 sales'):null;
 return [model,estimator,data,sample,time,crime,r.quantile!=null&&r.specification?`Q${r.quantile*100}`:null,r.k!=null?`${r.k} neighbours`:null].filter(Boolean).join(' · ');
}
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
function prepareComparisons(){
 const unique=new Map();diagnostics=[];
 for(const family of catalog.families){
  const iv=family.columns.includes('first_stage_wald_F')||family.rows.some(r=>r.method==='2SLS');
  for(const row of family.rows){
   if(iv&&!['2SLS','OLS','TWFE'].includes(row.method)){diagnostics.push({...row,analysis:family.label});continue;}
   const identity=JSON.stringify([family.id==='main'?'main':family.id.split('/')[0],...['model','panel','specification','method','crime','quantile','k','N','beta'].map(k=>row[k]??null),timingOf(row)]);
   const interaction=String(row.method||'').startsWith('Crime ×')||row.interaction_beta!=null;
   const candidate={...row,id:identity,_iv:iv,_family:row._group==='08_crime_original_robustness_outputs'?'Original crime · restricted years':family.id==='main'?'Main regressions':interaction?'Interaction regressions':iv?'IV and matched OLS/TWFE':row.quantile!=null?'Quantile regressions':'Spatial regressions',analysis:family.label};
   const previous=unique.get(identity);
   if(!previous||Object.keys(row).length>Object.keys(previous).length-4)unique.set(identity,candidate);
  }
 }
 const order=['Main regressions','Original crime · restricted years','Interaction regressions','IV and matched OLS/TWFE','Quantile regressions','Spatial regressions'];
 pool=[...unique.values()].sort((a,b)=>order.indexOf(a._family)-order.indexOf(b._family));
 renderShortcuts();
 const shared=decodeSharedSelection();
 const validShared=shared?.filter(id=>pool.some(r=>r.id===id))||[];
 selected=validShared.length?validShared:defaultPreset().map(r=>r.id);
 if(selected.length<2)selected.push(...pool.filter(r=>!selected.includes(r.id)).slice(0,2-selected.length).map(r=>r.id));
 renderCompare();
 const fields=['analysis','exposure','specification','method','beta','se','ci_low','ci_high','first_stage_wald_F','partial_R2','AR_95_set'];
 $('diagnostic-table').innerHTML=diagnostics.length?table(fields.map(name),diagnostics.map(r=>fields.map(k=>cell(r[k],k)))):'No IV diagnostics available.';
 const tests=(catalog.diagnostics||[]).flatMap(x=>x.rows);
 const detailRows=tests.map(r=>{const weak=Number(r.first_stage_wald_F)<10;const verdict=r.reject_exogeneity_5pct?'Reject exogeneity H₀':'Do not reject H₀';return[esc(r.model||r.specification),esc(crimeLabel(r)),esc(timingLabel(r)),fmt(r.clustered_wooldridge_chi2),fmt(r.clustered_wooldridge_p,'p-value'),verdict+(weak?' · weak first stage':''),r.reject_exogeneity_5pct?'Yes*':'No*',fmt(r.first_stage_wald_F),fmt(r.partial_R2),fmt(r.N),fmt(r.clusters)];});
 $('hausman-summary').textContent=tests.length?`${tests.filter(r=>r.reject_exogeneity_5pct).length} of ${tests.length} M7 tests reject the exogeneity null at 5%, conditional on a valid instrument. Weak first stages cannot diagnose endogeneity reliably.`:'No exported endogeneity tests found.';
 $('diagnostic-table').innerHTML=tests.length?table(['Model','Crime','Timing','Wooldridge χ²','p-value','Conditional test result','Requires IV?*','Weather-cell first-stage F','Partial R²','N','Weather cells'],detailRows):'No exported endogeneity tests found.';
 const auxiliary=catalog.families.flatMap(f=>f.rows).filter(r=>r.first_stage_wald_F!=null||['First stage','Reduced form'].includes(r.method));
 const auxCols=['exposure','specification','method','beta','se','ci_low','ci_high','p','first_stage_wald_F','partial_R2','AR_95_set'];
 $('other-iv-diagnostics').innerHTML=auxiliary.length?table(auxCols.map(name),auxiliary.map(r=>auxCols.map(k=>cell(r[k],k)))):'No additional IV diagnostics found.';
}
function shortcutRows(predicate,source='Original Stata'){
 const matches=pool.filter(r=>r._family==='Main regressions'&&!r._iv&&/^M[2-7]$/i.test(r.model||'')&&sourceOf(r)===source&&predicate(r));
 const unique=new Map(matches.map(r=>[JSON.stringify([r.model,crimeLabel(r),timingLabel(r)]),r]));
 return [...unique.values()].sort(modelOrder);
}
function defaultPreset(){
 return shortcutRows(r=>crimeLabel(r)==='All crime'&&timingLabel(r)==='Annual').filter(r=>/^M[2-7]$/i.test(r.model||''));
}
function renderShortcuts(){
 const sourceGroup=source=>{
  const base=pool.filter(r=>r._family==='Main regressions'&&!r._iv&&/^M[2-7]$/i.test(r.model||'')&&sourceOf(r)===source);
  const combos=[...new Map(base.map(r=>{const key=JSON.stringify([crimeLabel(r),timingLabel(r)]);return[key,{crime:crimeLabel(r),timing:timingLabel(r)}]})).values()].sort((a,b)=>a.crime.localeCompare(b.crime)||a.timing.localeCompare(b.timing));
  const comboButtons=combos.map(c=>`<button class="quick-button" data-shortcut="combo" data-source="${esc(source)}" data-crime="${esc(c.crime)}" data-timing="${esc(c.timing)}">${esc(c.crime)} · ${esc(c.timing)}</button>`).join('');
  const models=[...new Set(base.map(r=>r.model))].sort((a,b)=>Number(a.slice(1))-Number(b.slice(1)));
  const modelButtons=models.map(m=>`<button class="quick-button" data-shortcut="same-model" data-source="${esc(source)}" data-model="${esc(m)}">${esc(m)}</button>`).join('');
  return `<div class="shortcut-source"><h3>${esc(source)}</h3><div class="shortcut-group"><span class="shortcut-group-label">M2–M7 by crime × exposure:</span>${comboButtons||'<span class="note">No matching runs</span>'}</div><div class="shortcut-group"><span class="shortcut-group-label">Compare variants of:</span>${modelButtons||'<span class="note">No matching runs</span>'}</div></div>`;
 };
 $('shortcuts').innerHTML=sourceGroup('Original Stata')+sourceGroup('MPS');
}
function applyShortcut(button){
 let rows=[];
 const source=button.dataset.source;
 if(button.dataset.shortcut==='combo')rows=shortcutRows(r=>crimeLabel(r)===button.dataset.crime&&timingLabel(r)===button.dataset.timing,source);
 else if(button.dataset.shortcut==='same-model')rows=shortcutRows(r=>r.model===button.dataset.model,source);
 if(!rows.length)return;
 selected=rows.map(r=>r.id);
 renderCompare();
}
function renderCompare(){
 const rows=options();$('iv-diagnostics').hidden=!(catalog.diagnostics||[]).length;
 if(!rows.length){$('comparison').textContent='No matching regressions.';return;}
 selected=selected.filter(id=>rows.some(r=>r.id===id));
 while(selected.length<Math.min(2,rows.length))selected.push(rows.find(r=>!selected.includes(r.id)).id);
 const dropdownGroup=r=>r._family==='Main regressions'?`Main regressions · ${sourceOf(r)}`:r._family==='Original crime · restricted years'?`${r._family} · ${String(r.panel).startsWith('pre2014')?'2012–2013':'2012–2014'}`:r._family;
 const groups=[...new Set(rows.map(dropdownGroup))];
 const headers=selected.map((id,i)=>`<th class="column-head" scope="col"><div class="column-control"><select id="r${i}" aria-label="Regression for column ${i+1}" title="${esc(rowLabel(rows.find(r=>r.id===id)))}" data-select="${i}">${groups.map(group=>`<optgroup label="${esc(group)}">${rows.filter(r=>dropdownGroup(r)===group).map(r=>`<option value="${esc(r.id)}" ${r.id===id?'selected':''}>${esc(rowLabel(r))}</option>`).join('')}</optgroup>`).join('')}</select><button class="column-remove" data-remove="${i}" aria-label="Remove comparison ${i+1}" title="Remove column" ${selected.length<=2?'disabled':''}>×</button></div><button class="full-model-button" data-open-coeff="${i}">Full regression</button></th>`).join('');
 const atLimit=selected.length>=rows.length;
 const chosen=selected.map(id=>rows.find(r=>r.id===id));
 const isInteraction=chosen.some(r=>r._family==='Interaction regressions');
 const fields=['model','crime','canonical_exposure',...(isInteraction?['crime_main_beta']:[]),'beta','se','p','requires_iv','ci_low','ci_high','N','r2'].filter(k=>k!=='r2'||chosen.some(r=>r.r2!=null));
 const labels={model:'Model / estimator',crime:'Crime measure',canonical_exposure:'Crime data · exposure',crime_main_beta:'Crime β at mean borough income (04)',beta:isInteraction?'Reported β (04: crime × income)':hatSymbol('β','beta hat'),se:isInteraction?'Reported β standard error':`SE(${hatSymbol('β','beta hat')})`,p:'p-value',requires_iv:'Requires IV?*',ci_low:'95% CI lower',ci_high:'95% CI upper',N:'N',r2:'R²'};
 const shown=(r,k)=>{
  if(k==='crime')return ({allcrime:'All crime',violent_crime:'Violence',propertycrime:'Property crime',mps_all:'All crime',mps_violence:'Violence',mps_property:'Property crime','no crime':'None (benchmark)'})[r[k]]||r[k]||'—';
  if(k==='model'){
   const base=r.model||(r.quantile!=null?`Q${Number((r.quantile*100).toFixed(0))}`:r.specification)||'—';
   const estimator=r.method||(r.estimator)||(r.quantile!=null?'Quantile':r.model?'OLS':r._family==='Spatial regressions'?'Spatial':'');
   return estimator?`${base} · ${estimator}`:base;
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
   if(sourceOf(r)!=='MPS'||(!r._iv&&r._family!=='Main regressions'))return '—';
   const test=(catalog.diagnostics||[]).flatMap(d=>d.rows).find(t=>t.model===r.model&&crimeLabel(t)===crimeLabel(r)&&timingLabel(t)===timingLabel(r));
   return test?(test.reject_exogeneity_5pct?'Yes*':'No*'):'—';
  }
  return fmt(r[k],k);
 };
 const scroll=$('comparison').scrollLeft;
 $('comparison').innerHTML=`<table style="--comparison-count:${selected.length}"><thead><tr><th scope="col">Statistic</th>${headers}<th class="add-column" scope="col"><button data-add="true" aria-label="Add comparison column" title="${atLimit?'No more regressions to add':'Add comparison'}" ${atLimit?'disabled':''}>+</button></th></tr></thead><tbody>${fields.map(k=>`<tr><th scope="row">${labels[k]}</th>${chosen.map(r=>`<td>${shown(r,k)}</td>`).join('')}<td class="add-column"></td></tr>`).join('')}</tbody></table>`;
 $('comparison').scrollLeft=scroll;
 writeSharedSelection();
 if($('coeff-dialog').open)renderFullCoefficients(activeCoeffIndex);
 $('context').textContent='Cross-analysis comparisons are descriptive: notebook 08 repeats original crime models on common 2012–2014 and 2012–2013 sale samples; temperature IV targets the three MPS crime types under M7; quantiles target conditional price percentiles; spatial SLX uses individual sales; Moran statistics use LSOA-year summaries. Heat may affect prices directly. Check the sample, timing and fixed effects in each column. M1 has no crime coefficient.';
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
  b.textContent=copied?'Copied table':'Copy failed';setTimeout(()=>{b.textContent=b.dataset.copyTable==='diagnostic-table'?'Copy endogeneity table':'Copy IV diagnostics table';},1800);return;
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
fetch('generated/catalog.json').then(r=>{if(!r.ok)throw Error(`HTTP ${r.status}`);return r.json();}).then(data=>{catalog=data;$('group').innerHTML='<option value="">All notebooks</option>'+data.groups.map(g=>`<option value="${esc(g.id)}">${esc(g.label)}</option>`).join('');prepareComparisons();browse();$('status').textContent=`Built ${new Date(data.built_at).toLocaleString()} · ${data.files.length} outputs. Build time is not notebook execution time.`;}).catch(e=>{$('status').textContent=`Could not load results: ${e.message}`;});
