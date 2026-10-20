const $=id=>document.getElementById(id);
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const name=x=>String(x).replaceAll('_',' ').replace(/\b\w/g,c=>c.toUpperCase());
const groupName=id=>catalog.groups.find(g=>g.id===id)?.label||name(id.replace(/^\d+[_ -]*/, '').replace(/_outputs$/, ''));
const fmt=(x,key='')=>x==null?'—':typeof x==='number'?key.toLowerCase().includes('p')&&x<.0001?'<0.0001':Number.isInteger(x)?x.toLocaleString():Math.abs(x)>0&&Math.abs(x)<.0001?x.toExponential(3):x.toFixed(4):esc(x);
const cell=(v,key)=>key==='beta'?`<span class="${v>0?'positive':v<0?'negative':''}">${fmt(v)}</span>`:fmt(v);
const url=p=>p.split('/').map(encodeURIComponent).join('/');
const table=(heads,rows)=>`<table><thead><tr>${heads.map(h=>`<th scope="col">${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${r.map((v,i)=>i?`<td>${v}</td>`:`<th scope="row">${v}</th>`).join('')}</tr>`).join('')}</tbody></table>`;
let catalog, pool=[], diagnostics=[], selected=[], loaded=null, page=0, sortKey=null, ascending=true, request=0;
function rowLabel(r){
 const crime={allcrime:'All crime',violent_crime:'Violence',propertycrime:'Property crime',mps_all:'All crime',mps_violence:'Violence',mps_property:'Property crime','no crime':'Property-only benchmark'}[r.crime]||r.crime||(r._iv?'Residential burglary':'');
 const data=r.data_source||(r._iv||String(r.crime).startsWith('mps_')||/\bmps\b/i.test(r.source||'')?'MPS':r.model?'Original':'Source unspecified');
 const timing=r.exposure_label||r.exposure||r.timing;
 const time={lagyear:'prevyear','previous-year':'prevyear','current-year':'annual'}[timing]||timing||'Timing unspecified';
 const estimator=r.method==='2SLS'?'IV':r.method||r.estimator||(r.quantile!=null?'Quantile':r._family==='Spatial regressions'?'Spatial':'OLS');
 const model=r.model||r.specification||(r.quantile!=null?`Q${Number((r.quantile*100).toFixed(2))}`:'Model unspecified');
 return [model,estimator,data,time,crime,r.quantile!=null&&r.specification?`Q${r.quantile*100}`:null,r.k!=null?`${r.k} neighbours`:null].filter(Boolean).join(' · ');
}
const options=()=>pool;
function prepareComparisons(){
 const unique=new Map();diagnostics=[];
 for(const family of catalog.families){
  const iv=family.columns.includes('first_stage_wald_F')||family.rows.some(r=>r.method==='2SLS');
  for(const row of family.rows){
   if(iv&&!['2SLS','OLS','TWFE'].includes(row.method)){diagnostics.push({...row,analysis:family.label});continue;}
   const identity=JSON.stringify([family.id==='main'?'main':family.id.split('/')[0],...['model','panel','exposure','exposure_label','specification','method','crime','quantile','k','N','beta'].map(k=>row[k]??null)]);
   const candidate={...row,id:identity,_iv:iv,_family:family.id==='main'?'Main regressions':iv?'IV and matched OLS/TWFE':row.quantile!=null?'Quantile regressions':'Spatial regressions',analysis:family.label};
   const previous=unique.get(identity);
   if(!previous||Object.keys(row).length>Object.keys(previous).length-4)unique.set(identity,candidate);
  }
 }
 const order=['Main regressions','IV and matched OLS/TWFE','Quantile regressions','Spatial regressions'];
 pool=[...unique.values()].sort((a,b)=>order.indexOf(a._family)-order.indexOf(b._family));
 const defaults=pool.filter(r=>r.model==='M2');selected=defaults.slice(0,2).map(r=>r.id);
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
function renderCompare(){
 const rows=options();$('iv-diagnostics').hidden=!(catalog.diagnostics||[]).length;
 if(!rows.length){$('comparison').textContent='No matching regressions.';return;}
 selected=selected.filter(id=>rows.some(r=>r.id===id));
 while(selected.length<Math.min(2,rows.length))selected.push(rows.find(r=>!selected.includes(r.id)).id);
 const headers=selected.map((id,i)=>`<th class="column-head" scope="col"><div class="column-control"><select id="r${i}" aria-label="Regression for column ${i+1}" title="${esc(rowLabel(rows.find(r=>r.id===id)))}" data-select="${i}">${[...new Set(rows.map(r=>r._family))].map(group=>`<optgroup label="${esc(group)}">${rows.filter(r=>r._family===group).map(r=>`<option value="${esc(r.id)}" ${r.id===id?'selected':''}>${esc(rowLabel(r))}</option>`).join('')}</optgroup>`).join('')}</select><button class="column-remove" data-remove="${i}" aria-label="Remove comparison ${i+1}" title="Remove column" ${selected.length<=2?'disabled':''}>×</button></div></th>`).join('');
 const atLimit=selected.length>=5||selected.length>=rows.length;
 const chosen=selected.map(id=>rows.find(r=>r.id===id));
 const preferred=['model','method','data_source','crime','exposure_label','exposure','quantile','specification','k','beta','se','bootstrap_se','ci_low','ci_high','p','N','clusters','first_stage_wald_F','partial_R2','AR_95_set','bootstrap_success','fixed_effects','r2','r2_type'];
 const fields=[...new Set([...preferred,...chosen.flatMap(Object.keys)])].filter(k=>!k.startsWith('_')&&!['id','source','output','analysis','panel'].includes(k)&&chosen.some(r=>r[k]!=null));
 const scroll=$('comparison').scrollLeft;
 $('comparison').innerHTML=`<table style="--comparison-count:${selected.length}"><thead><tr><th scope="col">Statistic</th>${headers}<th class="add-column" scope="col"><button data-add="true" aria-label="Add comparison column" title="${atLimit?'Comparison limit reached':'Add comparison'}" ${atLimit?'disabled':''}>+</button></th></tr></thead><tbody>${fields.map(k=>`<tr><th scope="row">${esc(name(k))}</th>${chosen.map(r=>`<td>${cell(r[k],k)}</td>`).join('')}<td class="add-column"></td></tr>`).join('')}</tbody></table>`;
 $('comparison').scrollLeft=scroll;
 $('full-regressions').innerHTML=chosen.map((r,i)=>{
  const coeff=r.coefficients||[];
  if(!coeff.length)return `<details class="full-regression"><summary>${esc(rowLabel(r))} · Full regression</summary><p class="note">No matching full-coefficient export was found for this result.</p></details>`;
  const cols=['variable','beta','se','t','p','ci_low','ci_high'].filter(k=>r.coefficient_columns?.includes(k));
  const shown=coeff.map(c=>cols.map(k=>k==='variable'?esc(c[k]):fmt(c[k],k)));
  return `<details class="full-regression"><summary>${esc(rowLabel(r))} · Full regression (${coeff.length} terms)</summary><button data-copy-coeff="${i}">Copy table</button><div class="table-wrap">${table(cols.map(k=>k==='variable'?'Variable':k==='beta'?'Coefficient':k==='se'?'Standard error':k==='p'?'p-value':k==='ci_low'?'95% CI lower':k==='ci_high'?'95% CI upper':name(k)),shown)}</div></details>`;
 }).join('');
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
 if(b.dataset.remove!=null&&selected.length>2){const index=+b.dataset.remove;selected.splice(index,1);renderCompare();document.getElementById(`r${Math.min(index,selected.length-1)}`)?.focus();}
 if(b.dataset.add&&selected.length<5){const next=options().find(r=>!selected.includes(r.id));if(next){selected.push(next.id);renderCompare();document.getElementById(`r${selected.length-1}`)?.focus();}}
 if(b.dataset.copyCoeff!=null){const r=options().find(r=>r.id===selected[+b.dataset.copyCoeff]);if(r){const cols=['variable','beta','se','t','p','ci_low','ci_high'].filter(k=>r.coefficient_columns?.includes(k));const tsv=[cols.join('\t'),...(r.coefficients||[]).map(row=>cols.map(k=>row[k]??'').join('\t'))].join('\n');try{await navigator.clipboard.writeText(tsv);b.textContent='Copied';setTimeout(()=>b.textContent='Copy table',1400);}catch{const area=document.createElement('textarea');area.value=tsv;document.body.append(area);area.select();document.execCommand('copy');area.remove();b.textContent='Copied';setTimeout(()=>b.textContent='Copy table',1400);}}}
 if(b.dataset.open){const f=catalog.files.find(f=>f.id===b.dataset.open);$('large-image').src=url(f.url);$('large-image').alt=f.title;$('image-title').textContent=f.title;$('image-dialog').showModal();}
 if(b.dataset.table){const f=catalog.files.find(f=>f.id===b.dataset.table),token=++request;loaded=null;$('table-title').textContent=f.title;$('preview').textContent='Loading…';$('page').textContent='';$('prev').disabled=true;$('next').disabled=true;$('table-dialog').showModal();try{const r=await fetch(url(f.json));if(!r.ok)throw Error(`HTTP ${r.status}`);const data=await r.json();if(token!==request)return;loaded=data;page=0;sortKey=null;ascending=true;$('direction').textContent='Ascending';$('row-search').value='';$('sort').innerHTML='<option value="">Original order</option>'+loaded.columns.map(c=>`<option value="${esc(c)}">${esc(name(c))}</option>`).join('');renderTable();}catch(err){if(token===request){loaded=null;$('preview').textContent=`Could not load table: ${err.message}`;}}}
});
$('comparison').addEventListener('change',e=>{if(e.target.dataset.select!=null){const index=+e.target.dataset.select;selected[index]=e.target.value;renderCompare();document.getElementById(`r${index}`)?.focus({preventScroll:true});}});
$('group').onchange=browse;$('search').oninput=browse;
$('close-image').onclick=()=>$('image-dialog').close();
$('close-table').onclick=()=>$('table-dialog').close();
for(const id of ['image-dialog','table-dialog']){
 const dialog=$(id);
 dialog.addEventListener('click',e=>{if(e.target===dialog)dialog.close();});
}
$('table-dialog').addEventListener('close',()=>{request++;});
$('row-search').oninput=()=>{page=0;renderTable();};$('sort').onchange=()=>{sortKey=$('sort').value;renderTable();};$('direction').onclick=()=>{ascending=!ascending;$('direction').textContent=ascending?'Ascending':'Descending';renderTable();};$('prev').onclick=()=>{page--;renderTable();};$('next').onclick=()=>{page++;renderTable();};
fetch('generated/catalog.json').then(r=>{if(!r.ok)throw Error(`HTTP ${r.status}`);return r.json();}).then(data=>{catalog=data;$('group').innerHTML='<option value="">All notebooks</option>'+data.groups.map(g=>`<option value="${esc(g.id)}">${esc(g.label)}</option>`).join('');prepareComparisons();browse();$('status').textContent=`Built ${new Date(data.built_at).toLocaleString()} · ${data.files.length} outputs. Build time is not notebook execution time.`;}).catch(e=>{$('status').textContent=`Could not load results: ${e.message}`;});
