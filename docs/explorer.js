const $=id=>document.getElementById(id);
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const name=x=>String(x).replaceAll('_',' ').replace(/\b\w/g,c=>c.toUpperCase());
const fmt=x=>x==null?'—':typeof x==='number'?Number.isInteger(x)?x.toLocaleString():Math.abs(x)>0&&Math.abs(x)<.0001?x.toExponential(3):x.toFixed(4):esc(x);
const cell=(v,key)=>key==='beta'?`<span class="${v>0?'positive':v<0?'negative':''}">${fmt(v)}</span>`:fmt(v);
const url=p=>p.split('/').map(encodeURIComponent).join('/');
const table=(heads,rows)=>`<table><thead><tr>${heads.map(h=>`<th scope="col">${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${r.map((v,i)=>i?`<td>${v}</td>`:`<th scope="row">${v}</th>`).join('')}</tr>`).join('')}</tbody></table>`;
let catalog, family, selected=[], pinned=[], loaded=null, page=0, sortKey=null, ascending=true, request=0;
const rowLabel=r=>['source','model','exposure_label','exposure','timing','specification','method','crime','quantile','k'].filter(k=>r[k]!=null).map(k=>['quantile','k'].includes(k)?`${name(k)} ${r[k]}`:r[k]).join(' · ');
const options=()=>family.rows.filter(r=>family.id!=='main'||r.model===$('model').value);
function renderCompare(){
 const rows=options(); if(!rows.length){$('comparison').textContent='No matching regressions.';return;}
 selected=selected.filter(id=>rows.some(r=>r.id===id));
 while(selected.length<Math.min(2,rows.length))selected.push(rows.find(r=>!selected.includes(r.id)).id);
 $('selectors').innerHTML=selected.map((id,i)=>`<div><label for="r${i}">Comparison ${i+1}</label><select id="r${i}" data-select="${i}">${rows.map(r=>`<option value="${esc(r.id)}" ${r.id===id?'selected':''}>${esc(rowLabel(r))}</option>`).join('')}</select><button data-remove="${i}" ${selected.length<=2?'disabled':''}>Remove ${i+1}</button></div>`).join('');
 $('add').disabled=selected.length>=5||selected.length>=rows.length;
 const chosen=selected.map(id=>rows.find(r=>r.id===id));
 const preferred=['beta','se','bootstrap_se','ci_low','ci_high','p','N','clusters','first_stage_wald_F','partial_R2','AR_95_set','bootstrap_success','fixed_effects','r2','r2_type'];
 const fields=[...new Set([...preferred,...family.columns])].filter(k=>!['id','source','output','model'].includes(k)&&chosen.some(r=>r[k]!=null));
 $('comparison').innerHTML=table(['Statistic',...chosen.map((r,i)=>`${i+1}. ${rowLabel(r)}`)],fields.map(k=>[esc(name(k)),...chosen.map(r=>cell(r[k],k))]));
 const cols=new Set(family.columns);
 $('context').textContent=cols.has('method')?'IV: first stage predicts residential burglary; reduced form predicts prices using the instrument. Instrument strength does not establish validity.':cols.has('quantile')?'Quantiles describe the conditional price distribution. Review sample size and successful bootstrap draws before interpreting intervals.':cols.has('k')?'Spatial models use area-year observations. k is the number of neighbours. Check the specification before comparing coefficients.':'Compare samples, timing and fixed effects alongside coefficients. M1 is a property-only benchmark.';
}
function changeFamily(){family=catalog.families.find(f=>f.id===$('family').value);if(!family)return;selected=[];$('model-control').hidden=family.id!=='main';const models=[...new Set(family.rows.map(r=>r.model).filter(Boolean))].sort();$('model').innerHTML=models.map(m=>`<option>${esc(m)}</option>`).join('');if(models.includes('M2'))$('model').value='M2';renderCompare();}
function matches(item){return(!$('group').value||item.group===$('group').value)&&(`${item.title} ${item.group}`.toLowerCase().includes($('search').value.toLowerCase()));}
function browse(){
 const items=catalog.files.filter(matches), images=items.filter(x=>x.kind==='figure'), tables=items.filter(x=>x.kind==='table');
 $('gallery').innerHTML=images.map(f=>`<article><button class="image-button" data-open="${esc(f.id)}"><img loading="lazy" src="${url(f.url)}" alt="${esc(f.title)}"></button><strong>${esc(f.title)}</strong><small>${esc(name(f.group))}</small><button data-pin="${esc(f.id)}">${pinned.includes(f.id)?'Unpin':'Compare figure'}</button> <a href="${url(f.url)}" download>Download</a></article>`).join('')||'<p>No matching figures.</p>';
 $('files').innerHTML=tables.map(f=>`<article><button data-table="${esc(f.id)}">${esc(f.title)}</button><small>${esc(name(f.group))} · ${f.rows.toLocaleString()} rows</small><a href="${url(f.url)}" download>Download CSV</a></article>`).join('')||'<p>No matching tables.</p>';
 $('inventory').textContent=`${images.length} figures · ${tables.length} tables matching filters`;
 $('pinned').innerHTML=pinned.map(id=>{const f=catalog.files.find(f=>f.id===id);return `<article><button data-open="${esc(id)}" class="image-button"><img src="${url(f.url)}" alt="${esc(f.title)}"></button><p>${esc(f.title)}</p><button data-pin="${esc(id)}">Remove</button></article>`;}).join('');
 $('pin-status').textContent=pinned.length?`${pinned.length}/2 figures selected`:'Select up to two figures for side-by-side viewing.';
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
 if(b.dataset.remove!=null&&selected.length>2){selected.splice(+b.dataset.remove,1);renderCompare();}
 if(b.dataset.open){const f=catalog.files.find(f=>f.id===b.dataset.open);$('large-image').src=url(f.url);$('large-image').alt=f.title;$('image-title').textContent=f.title;$('image-dialog').showModal();}
 if(b.dataset.pin){const id=b.dataset.pin;if(pinned.includes(id))pinned=pinned.filter(x=>x!==id);else if(pinned.length<2)pinned.push(id);else{$('pin-status').textContent='Remove a selected figure before adding another.';return;}browse();}
 if(b.dataset.table){const f=catalog.files.find(f=>f.id===b.dataset.table),token=++request;$('table-title').textContent=f.title;$('preview-panel').hidden=false;$('preview').textContent='Loading…';try{const r=await fetch(url(f.json));if(!r.ok)throw Error(`HTTP ${r.status}`);const data=await r.json();if(token!==request)return;loaded=data;page=0;sortKey=null;$('row-search').value='';$('sort').innerHTML='<option value="">Original order</option>'+loaded.columns.map(c=>`<option value="${esc(c)}">${esc(name(c))}</option>`).join('');renderTable();}catch(err){if(token===request){loaded=null;$('preview').textContent=`Could not load table: ${err.message}`;}}}
});
$('selectors').addEventListener('change',e=>{if(e.target.dataset.select!=null){selected[+e.target.dataset.select]=e.target.value;renderCompare();}});
$('add').onclick=()=>{if(selected.length<5){const next=options().find(r=>!selected.includes(r.id));if(next)selected.push(next.id);renderCompare();}};
$('family').onchange=changeFamily;$('model').onchange=()=>{selected=[];renderCompare();};
$('group').onchange=browse;$('search').oninput=browse;
$('close-image').onclick=()=>$('image-dialog').close();
$('row-search').oninput=()=>{page=0;renderTable();};$('sort').onchange=()=>{sortKey=$('sort').value;renderTable();};$('direction').onclick=()=>{ascending=!ascending;$('direction').textContent=ascending?'Ascending':'Descending';renderTable();};$('prev').onclick=()=>{page--;renderTable();};$('next').onclick=()=>{page++;renderTable();};
fetch('generated/catalog.json').then(r=>{if(!r.ok)throw Error(`HTTP ${r.status}`);return r.json();}).then(data=>{catalog=data;$('family').innerHTML=data.families.map(f=>`<option value="${esc(f.id)}">${esc(f.label)}</option>`).join('');$('group').innerHTML='<option value="">All notebooks</option>'+data.groups.map(g=>`<option value="${esc(g.id)}">${esc(g.label)}</option>`).join('');if(data.families.length)changeFamily();else $('comparison').textContent='No regression summaries found.';browse();$('status').textContent=`Built ${new Date(data.built_at).toLocaleString()} · ${data.files.length} outputs. Build time is not notebook execution time.`;}).catch(e=>{$('status').textContent=`Could not load results: ${e.message}`;});
