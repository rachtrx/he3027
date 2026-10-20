const $=id=>document.getElementById(id);
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=(x,d=4)=>x==null||x===''?'—':typeof x==='number'?x.toLocaleString(undefined,{minimumFractionDigits:d,maximumFractionDigits:d}):esc(x);
const beta=x=>`<span class="${typeof x==='number'?(x>0?'positive':x<0?'negative':''):''}">${fmt(x)}</span>`;
const names={crime:'Crime category',quantile:'Conditional quantile',beta:'Crime coefficient',ci_low:'95% CI lower',ci_high:'95% CI upper',N:'Observations',bootstrap_success:'Successful bootstrap draws',specification:'Specification',k:'Neighbours',se:'Standard error',year:'Year',variable:'Variable',moran_I:'Moran’s I',permutation_p:'Permutation p-value',permutations:'Permutations'};
const friendly=x=>({mps_all:'All crime',mps_violence:'Violence',mps_property:'Property crime',mean_log_price:'Mean log price',residual_mps_all:'Residual · all crime',residual_mps_violence:'Residual · violence',residual_mps_property:'Residual · property crime'}[x]||x);
const table=(heads,rows)=>`<table><thead><tr>${heads.map(h=>`<th scope="col">${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${row.map((v,i)=>i?`<td>${v}</td>`:`<th scope="row">${v}</th>`).join('')}</tr>`).join('')}</tbody></table>`;
let records=[],selected=[];
const options=()=>records.filter(r=>r.model===$('model').value);
const label=r=>r.crime==='no crime'?`${r.source} · ${r.timing}`:r.label;
function render(){
 const opts=options();
 $('selectors').innerHTML=selected.map((id,i)=>`<div><label for="r${i}">Comparison ${i+1}</label><select id="r${i}" data-index="${i}">${opts.map(r=>`<option value="${esc(r.id)}" ${r.id===id?'selected':''}>${esc(label(r))}</option>`).join('')}</select><button data-remove="${i}" ${selected.length<=2?'disabled':''} aria-label="Remove comparison ${i+1}">Remove</button></div>`).join('');
 $('add').disabled=selected.length>=5||selected.length>=opts.length;
 const chosen=selected.map(id=>records.find(r=>r.id===id)), heads=['Statistic',...chosen.map((r,i)=>`${i+1}. ${label(r)}`)];
 const fields=[['Crime coefficient',r=>beta(r.beta)],['95% confidence interval',r=>r.ci_low==null?'—':`${fmt(r.ci_low)} to ${fmt(r.ci_high)}`],['Clustered standard error',r=>fmt(r.se)],['p-value',r=>r.p!=null&&r.p<.0001?'&lt;0.0001':fmt(r.p)],['Observations',r=>fmt(r.N,0)],['Clusters',r=>fmt(r.clusters,0)],['Fixed effects',r=>esc(r.fixed_effects||'None')],['R²',r=>`${fmt(r.r2)} (${esc(r.r2_type)})`],['Omitted / absorbed terms',r=>esc(r.absorbed_or_collinear||'None reported')]];
 $('comparison').innerHTML=table(heads,fields.map(([name,f])=>[name,...chosen.map(f)]));
 const vars=[...new Set(chosen.flatMap(r=>r.coefficients.map(c=>c.variable)))];
 $('coefficients').innerHTML=table(['Variable',...heads.slice(1)],vars.map(v=>[esc(v),...chosen.map(r=>{const c=r.coefficients.find(c=>c.variable===v);return c?`${beta(c.beta)}<small>(${fmt(c.se)})</small>`:'—';})]));
}
$('selectors').addEventListener('change',e=>{if(e.target.matches('select')){selected[+e.target.dataset.index]=e.target.value;render();}});
$('selectors').addEventListener('click',e=>{if(e.target.matches('[data-remove]')&&selected.length>2){selected.splice(+e.target.dataset.remove,1);render();}});
$('add').addEventListener('click',()=>{const r=options().find(r=>!selected.includes(r.id));if(r&&selected.length<5){selected.push(r.id);render();}});
$('model').addEventListener('change',()=>{const opts=options();selected=selected.map((id,i)=>{const old=records.find(r=>r.id===id);return (opts.find(r=>r.source_id===old.source_id&&r.crime===old.crime)||opts.find(r=>r.source_id===old.source_id)||opts[i%opts.length]).id;});render();});
fetch('data/regressions.json').then(r=>{if(!r.ok)throw Error(`HTTP ${r.status}`);return r.json();}).then(data=>{
 records=data.records;if(!records.length)throw Error('No results available');
 const models=[...new Set(records.map(r=>r.model))].sort();$('model').innerHTML=models.map(m=>`<option>${esc(m)}</option>`).join('');$('model').value=models.includes('M2')?'M2':models[0];selected=options().slice(0,2).map(r=>r.id);render();
 $('extensions').innerHTML=(data.extensions||[]).map(item=>`<section class="panel"><h2>${esc(item.title)}</h2><p>${esc(item.note)}</p>${item.rows.length?`<details><summary>Explore ${item.rows.length} results</summary><div class="table-wrap">${table(item.columns.map(k=>names[k]||k),item.rows.map(r=>item.columns.map(k=>k==='beta'?beta(r[k]):fmt(friendly(r[k]),['N','k','year','bootstrap_success','permutations'].includes(k)?0:4))))}</div></details>`:'<p>No exported results available for this notebook.</p>'}</section>`).join('');
 $('status').textContent='Associations do not establish causality. A dash means a term is unavailable or absent.';
}).catch(e=>{$('status').textContent=`Unable to load results: ${e.message}`;});
