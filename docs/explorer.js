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
const sourceOf=r=>r.data_source||((String(r.crime||'').startsWith('mps_')||r._iv||/\bmps\b/i.test(r.source||''))?'MPS':r.model||r.specification?'Original Stata':r.source||'Source unspecified');
const crimeLabel=r=>({allcrime:'All crime',mps_all:'All crime',violent_crime:'Violence',mps_violence:'Violence',propertycrime:'Property crime',mps_property:'Property crime'})[r.crime]||r.crime||'Crime unspecified';
const modelOrder=(a,b)=>Number(String(a.model||'').replace(/^M/i,''))-Number(String(b.model||'').replace(/^M/i,''));
function rowLabel(r){
 const crime={allcrime:'All crime',violent_crime:'Violence',propertycrime:'Property crime',mps_all:'All crime',mps_violence:'Violence',mps_property:'Property crime','no crime':'Property-only benchmark'}[r.crime]||r.crime||(r._iv?'Residential burglary':'');
 const data=sourceOf(r);
 const time=timingLabel(r);
 const estimator=r.method==='2SLS'?'IV':r.method||r.estimator||(r.quantile!=null?'Quantile':r._family==='Spatial regressions'?'Spatial':'OLS');
 const model=r.model||r.specification||(r.quantile!=null?`Q${Number((r.quantile*100).toFixed(2))}`:'Model unspecified');
 return [model,estimator,data,time,crime,r.quantile!=null&&r.specification?`Q${r.quantile*100}`:null,r.k!=null?`${r.k} neighbours`:null].filter(Boolean).join(' · ');
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
   const candidate={...row,id:identity,_iv:iv,_family:family.id==='main'?'Main regressions':iv?'IV and matched OLS/TWFE':row.quantile!=null?'Quantile regressions':'Spatial regressions',analysis:family.label};
   const previous=unique.get(identity);
   if(!previous||Object.keys(row).length>Object.keys(previous).length-4)unique.set(identity,candidate);
  }
 }
 const order=['Main regressions','IV and matched OLS/TWFE','Quantile regressions','Spatial regressions'];
 pool=[...unique.values()].sort((a,b)=>order.indexOf(a._family)-order.indexOf(b._family));
 renderShortcuts();
 selected=defaultPreset().map(r=>r.id);
 if(selected.length<2)selected.push(...pool.filter(r=>!selected.includes(r.id)).slice(0,2-selected.length).map(r=>r.id));
 renderCompare();
 const fields=['analysis','exposure','specification','method','beta','se','ci_low','ci_high','first_stage_wald_F','partial_R2','AR_95_set'];
 $('diagnostic-table').innerHTML=diagnostics.length?table(fields.map(name),diagnostics.map(r=>fields.map(k=>cell(r[k],k)))):'No IV diagnostics available.';
 const tests=(catalog.diagnostics||[]).flatMap(x=>x.rows);
 const detailRows=tests.map(r=>[r.exposure,r.specification,fmt(r.clustered_wooldridge_chi2),fmt(r.clustered_wooldridge_p,'p-value'),r.reject_exogeneity_5pct?'Reject at 5%':'Do not reject',fmt(r.classical_wu_hausman_F),fmt(r.classical_wu_hausman_p,'p-value'),fmt(r.N),fmt(r.clusters)]);
 $('hausman-summary').textContent=tests.length?(()=>{const detailed=tests.filter(r=>/LSOA \+ quarter/i.test(r.specification));const rejects=detailed.filter(r=>r.reject_exogeneity_5pct).length;return detailed.length?`For LSOA + quarter, ${rejects} of ${detailed.length} clustered tests reject exogeneity at 5%. This test assumes the instrument is valid.`:`${tests.length} clustered endogeneity tests available.`})():'No exported Hausman tests found.';
 $('diagnostic-table').innerHTML=tests.length?table(['Timing','Specification','Clustered Wooldridge χ²','Clustered p-value','5% conclusion','Wu–Hausman F¹','Wu–Hausman p¹','N','Clusters'],detailRows):'No exported Hausman tests found.';
 const auxiliary=catalog.families.flatMap(f=>f.rows).filter(r=>r.first_stage_wald_F!=null||['First stage','Reduced form'].includes(r.method));
 const auxCols=['exposure','specification','method','beta','se','ci_low','ci_high','p','first_stage_wald_F','partial_R2','AR_95_set'];
 $('other-iv-diagnostics').innerHTML=auxiliary.length?table(auxCols.map(name),auxiliary.map(r=>auxCols.map(k=>cell(r[k],k)))):'No additional IV diagnostics found.';
}
function shortcutRows(predicate){
 const matches=pool.filter(r=>r._family==='Main regressions'&&!r._iv&&/^M[2-7]$/i.test(r.model||'')&&sourceOf(r)==='Original Stata'&&predicate(r));
 const unique=new Map(matches.map(r=>[JSON.stringify([r.model,crimeLabel(r),timingLabel(r)]),r]));
 return [...unique.values()].sort(modelOrder);
}
function defaultPreset(){
 return shortcutRows(r=>crimeLabel(r)==='All crime'&&timingLabel(r)==='Annual').filter(r=>/^M[2-7]$/i.test(r.model||''));
}
function renderShortcuts(){
 const base=pool.filter(r=>r._family==='Main regressions'&&!r._iv&&/^M[2-7]$/i.test(r.model||'')&&sourceOf(r)==='Original Stata');
 const combos=[...new Map(base.map(r=>{const key=JSON.stringify([crimeLabel(r),timingLabel(r)]);return[key,{crime:crimeLabel(r),timing:timingLabel(r)}]})).values()].sort((a,b)=>a.crime.localeCompare(b.crime)||a.timing.localeCompare(b.timing));
 const comboButtons=combos.map(c=>`<button class="quick-button" data-shortcut="combo" data-crime="${esc(c.crime)}" data-timing="${esc(c.timing)}">${esc(c.crime)} · ${esc(c.timing)}</button>`).join('');
 const models=[...new Set(base.map(r=>r.model))].sort((a,b)=>Number(a.slice(1))-Number(b.slice(1)));
 const modelButtons=models.map(m=>`<button class="quick-button" data-shortcut="same-model" data-model="${esc(m)}">${esc(m)}</button>`).join('');
 const defaults=defaultPreset();
 $('shortcuts').innerHTML=`<div class="shortcut-group"><span class="shortcut-group-label">Sequence:</span><button class="quick-button" data-shortcut="default" ${defaults.length?'':'disabled'}>M2–M7 · All crime · Original Stata · Annual</button></div><div class="shortcut-group"><span class="shortcut-group-label">M2–M7 by crime × exposure:</span>${comboButtons}</div><div class="shortcut-group"><span class="shortcut-group-label">Compare variants of:</span>${modelButtons}</div>`;
}
function applyShortcut(button){
 let rows=[];
 if(button.dataset.shortcut==='default')rows=defaultPreset();
 else if(button.dataset.shortcut==='combo')rows=shortcutRows(r=>crimeLabel(r)===button.dataset.crime&&timingLabel(r)===button.dataset.timing);
 else if(button.dataset.shortcut==='same-model')rows=shortcutRows(r=>r.model===button.dataset.model);
 if(!rows.length)return;
 selected=rows.map(r=>r.id);
 renderCompare();
}
function renderCompare(){
 const rows=options();$('iv-diagnostics').hidden=!(catalog.diagnostics||[]).length;
 if(!rows.length){$('comparison').textContent='No matching regressions.';return;}
 selected=selected.filter(id=>rows.some(r=>r.id===id));
 while(selected.length<Math.min(2,rows.length))selected.push(rows.find(r=>!selected.includes(r.id)).id);
 const headers=selected.map((id,i)=>`<th class="column-head" scope="col"><div class="column-control"><select id="r${i}" aria-label="Regression for column ${i+1}" title="${esc(rowLabel(rows.find(r=>r.id===id)))}" data-select="${i}">${[...new Set(rows.map(r=>r._family))].map(group=>`<optgroup label="${esc(group)}">${rows.filter(r=>r._family===group).map(r=>`<option value="${esc(r.id)}" ${r.id===id?'selected':''}>${esc(rowLabel(r))}</option>`).join('')}</optgroup>`).join('')}</select><button class="column-remove" data-remove="${i}" aria-label="Remove comparison ${i+1}" title="Remove column" ${selected.length<=2?'disabled':''}>×</button></div><button class="full-model-button" data-open-coeff="${i}">Full regression</button></th>`).join('');
 const atLimit=selected.length>=rows.length;
 const chosen=selected.map(id=>rows.find(r=>r.id===id));
 const fields=['model','crime','canonical_exposure','beta','se','p','ci_low','ci_high','N','r2'].filter(k=>k!=='r2'||chosen.some(r=>r.r2!=null));
 const labels={model:'Model / estimator',crime:'Crime measure',canonical_exposure:'Crime data · exposure',beta:hatSymbol('β','beta hat'),se:`SE(${hatSymbol('β','beta hat')})`,p:'p-value',ci_low:'95% CI lower',ci_high:'95% CI upper',N:'N',r2:'R²'};
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
  return fmt(r[k],k);
 };
 const scroll=$('comparison').scrollLeft;
 $('comparison').innerHTML=`<table style="--comparison-count:${selected.length}"><thead><tr><th scope="col">Statistic</th>${headers}<th class="add-column" scope="col"><button data-add="true" aria-label="Add comparison column" title="${atLimit?'No more regressions to add':'Add comparison'}" ${atLimit?'disabled':''}>+</button></th></tr></thead><tbody>${fields.map(k=>`<tr><th scope="row">${labels[k]}</th>${chosen.map(r=>`<td>${shown(r,k)}</td>`).join('')}<td class="add-column"></td></tr>`).join('')}</tbody></table>`;
 $('comparison').scrollLeft=scroll;
 if($('coeff-dialog').open)renderFullCoefficients(activeCoeffIndex);
 $('context').textContent='Cross-analysis comparisons are descriptive: IV targets residential burglary, quantiles target conditional price percentiles, and spatial models may use area-year observations. Check the crime definition, sample, timing and fixed effects in each column. M1 has no crime coefficient.';
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
