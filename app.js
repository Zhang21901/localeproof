import {parseDelimited,makeSegments,RULES,escapeHTML as e,reportCSV} from './core.js';
const $=s=>document.querySelector(s);
const state={files:[],pro:false,result:null,page:0,config:null,busy:false,revision:0};
const pageSize=8;
function message(text,error=false){$('#message').textContent=text;$('#message').className='message'+(error?' error':'');}
function invalidate(){state.revision++;state.result=null;$('#results').classList.add('hidden');$('#empty-state').classList.remove('hidden');$('#export-csv').disabled=true;$('#export-html').disabled=true;}
function setPro(pro){state.pro=pro;$('#plan-badge').textContent=pro?'PRO · 20,000 SEGMENTS':'FREE · 100 SEGMENTS';if($('#rule-glossary'))$('#rule-glossary').disabled=!pro;$('#glossary').disabled=!pro;}
async function api(path,body){if(path==='config')return {salesEnabled:false,demo:false};throw Error('This free demo has no paid checkout. Use one file with up to 100 segments.');}
async function checkAccess(){try{await api('access');setPro(true);return true;}catch(err){setPro(false);throw err;}}
function openUnlock(){if(!$('#license-dialog').open)$('#license-dialog').showModal();$('#license-key').focus();}
for(const btn of document.querySelectorAll('[data-unlock]'))btn.onclick=openUnlock;
$('#close-dialog').onclick=()=>$('#license-dialog').close();
$('#license-form').onsubmit=async ev=>{ev.preventDefault();const b=ev.target.querySelector('[type=submit]');b.disabled=true;$('#license-error').textContent='Checking your license…';try{await api('license',{license:$('#license-key').value.trim()});setPro(true);$('#license-key').value='';$('#license-error').textContent='';$('#license-dialog').close();message('Pro is ready. Add up to 10 files, check your columns, then run your project.');}catch(err){$('#license-error').textContent=err.message;}finally{b.disabled=false;}};
$('#logout').onclick=async()=>{try{await api('logout',{});setPro(false);$('#license-dialog').close();invalidate();message('This browser is locked. Your imported files are still in memory until you close the page.');}catch(err){$('#license-error').textContent=err.message;}};
async function buy(plan){try{const data=await api('checkout',{plan});location.href=data.url;}catch(err){message(err.message,true);$('#workbench').scrollIntoView();}}
for(const b of document.querySelectorAll('[data-buy]'))b.onclick=()=>buy(b.dataset.buy);
$('#rule-list').innerHTML=Object.entries(RULES).filter(([id])=>id!=='glossary').map(([id,title])=>`<label><input type="checkbox" id="rule-${id}" value="${id}" ${id==='glossary'?'disabled':'checked'}>${e(title)}${id==='glossary'?'<span>PRO</span>':''}</label>`).join('');
$('#rule-list').onchange=invalidate;
$('#source-locale').onchange=invalidate;$('#target-locale').onchange=invalidate;$('#glossary').oninput=invalidate;
function mapFor(rows){const headers=(rows[0]||[]).map(String);const find=words=>headers.findIndex(x=>words.some(w=>x.toLowerCase()===w||x.toLowerCase().includes(w)));
  let source=find(['source','original','english']),target=find(['translation','target','german','french']);
  if(source<0)source=headers.length>=3?1:0;if(target<0||source===target)target=source===0?1:Math.min(source+1,headers.length-1);
  return {source,target,id:find(['id','key','segment']),header:true};
}
function renderFiles(){
  $('#file-list').innerHTML=state.files.map((f,i)=>`<div class="file-item"><span title="${e(f.name)}">▤ &nbsp; ${e(f.name)}</span><button class="text-btn" data-remove="${i}" aria-label="Remove ${e(f.name)} from this check">✕</button></div>`).join('');
  for(const b of document.querySelectorAll('[data-remove]'))b.onclick=()=>{state.files.splice(Number(b.dataset.remove),1);invalidate();renderFiles();};
  const panel=$('#mapping-panel');panel.classList.toggle('hidden',!state.files.length);
  panel.innerHTML=state.files.map((f,i)=>{
    const rows=f.sheets[f.sheet].rows,head=rows[0]||[];
    const opts=selected=>head.map((v,j)=>`<option value="${j}" ${j===selected?'selected':''}>${j+1}. ${e(String(v).slice(0,38)||'Column '+(j+1))}</option>`).join('');
    return `<div class="mapping-row" data-file="${i}"><div class="mapping-name">${e(f.name)} · ${Math.max(0,rows.length-1).toLocaleString()} data rows</div><label>Worksheet<select data-map="sheet">${f.sheets.map((s,j)=>`<option value="${j}" ${j===f.sheet?'selected':''}>${e(s.name)}</option>`).join('')}</select></label><label>Source column<select data-map="source">${opts(f.mapping.source)}</select></label><label>Translation column<select data-map="target">${opts(f.mapping.target)}</select></label><label>Segment ID<select data-map="id"><option value="-1">Row number</option>${opts(f.mapping.id)}</select></label></div>`;
  }).join('');
  for(const el of panel.querySelectorAll('select'))el.onchange=()=>{const f=state.files[Number(el.closest('[data-file]').dataset.file)];const field=el.dataset.map;if(field==='sheet'){f.sheet=Number(el.value);f.mapping=mapFor(f.sheets[f.sheet].rows);renderFiles();}else f.mapping[field]=Number(el.value);invalidate();};
}
function parseFile(file){return new Promise(async(resolve,reject)=>{
  if(file.size>10_000_000){reject(Error('Maximum file size is 10 MB.'));return;}
  const worker=new Worker('./parse-worker.js');const timer=setTimeout(()=>{worker.terminate();reject(Error('This file took too long to read. Export a smaller UTF-8 CSV and try again.'));},10000);
  const finish=fn=>v=>{clearTimeout(timer);worker.terminate();fn(v);};
  worker.onmessage=({data})=>data.error?finish(reject)(Error(data.error)):finish(resolve)(data.sheets);
  worker.onerror=finish(reject);
  try{const buffer=await file.arrayBuffer();worker.postMessage({buffer,name:file.name},[buffer]);}catch(err){finish(reject)(err);}
});}
async function addFiles(files){
  if(state.busy)return;state.busy=true;$('#run-check').disabled=true;
  try{
    const batch=[...files];const limit=state.pro?10:1;if(state.files.length+batch.length>limit)throw Error(state.pro?'Use at most 10 files per batch.':'Free checks support one file. Remove the current file or unlock Pro for a batch.');
    const added=[];
    for(const file of batch){message(`Reading ${file.name} on this device…`);const sheets=await parseFile(file);const sheet=sheets.findIndex(s=>s.rows.length>=2);if(sheet<0)throw Error('Add a header row and at least one data row.');added.push({name:file.name,sheets,sheet,mapping:mapFor(sheets[sheet].rows)});}
    state.files.push(...added);
    invalidate();renderFiles();message('Check the detected columns and number formats, then run your check.');
  }catch(err){renderFiles();message(err.message||'This file could not be read.',true);}finally{state.busy=false;$('#run-check').disabled=false;$('#files').value='';}
}
$('#files').onchange=ev=>addFiles(ev.target.files);
$('#dropzone').onkeydown=ev=>{if(ev.key==='Enter'||ev.key===' '){ev.preventDefault();$('#files').click();}};
$('#dropzone').ondragover=ev=>{ev.preventDefault();$('#dropzone').classList.add('drag');};
$('#dropzone').ondragleave=()=>$('#dropzone').classList.remove('drag');
$('#dropzone').ondrop=ev=>{ev.preventDefault();$('#dropzone').classList.remove('drag');addFiles(ev.dataTransfer.files);};
$('#use-paste').onclick=()=>{try{const rows=parseDelimited($('#paste').value);if(state.files.length>=(state.pro?10:1))throw Error('Remove a file before adding another, or unlock Pro for batches.');state.files.push({name:'Pasted table',sheets:[{name:'Table',rows}],sheet:0,mapping:mapFor(rows)});invalidate();renderFiles();message('Pasted table is ready. Check the columns before running.');}catch(err){message(err.message,true);}};
function options(){
  const rules=[...document.querySelectorAll('#rule-list input:checked')].filter(i=>!i.disabled).map(i=>i.value);
  const glossary=state.pro?$('#glossary').value.split(/\r?\n/).filter(s=>s.trim()).map(s=>{const a=s.split('\t');if(a.length!==2||!a[0].trim()||!a[1].trim())throw Error('Each glossary line needs a source term and target term, separated by a tab.');return {source:a[0].trim(),target:a[1].trim()};}):[];
  if(!rules.length)throw Error('Choose at least one check.');
  return {rules,sourceLocale:$('#source-locale').value,targetLocale:$('#target-locale').value,glossary};
}
function runWorker(segments,opts){return new Promise((resolve,reject)=>{
  const worker=new Worker('./qa-worker.js',{type:'module'});const timer=setTimeout(()=>{worker.terminate();reject(Error('The check exceeded 30 seconds. Try a smaller batch.'));},30000);
  const finish=fn=>value=>{clearTimeout(timer);worker.terminate();fn(value);};
  worker.onmessage=({data})=>data.error?finish(reject)(Error(data.error)):finish(resolve)(data.result);
  worker.onerror=()=>finish(reject)(Error('The check could not start. Refresh and unlock Pro again if needed.'));
  worker.postMessage({segments,options:opts,pro:state.pro});
});}
async function run(){
  if(state.busy)return;state.busy=true;$('#run-check').disabled=true;$('#run-check').textContent='Checking locally…';
  invalidate();message('Checking the selected files on this device…');
  try{
    if(!state.files.length)throw Error('Add a bilingual file or try the sample first.');
    if(state.pro)await checkAccess();
    if(state.files.length>(state.pro?10:1))throw Error('Unlock Pro again to check this batch.');
    const segments=state.files.flatMap(f=>makeSegments(f.sheets[f.sheet].rows,f.mapping,f.name,f.sheets[f.sheet].name));
    if(!segments.length)throw Error('No text found in those columns. Check your mapping.');
    if(segments.length>(state.pro?20000:100))throw Error(state.pro?'Split this project into batches of at most 20,000 segments.':`This file has ${segments.length.toLocaleString()} segments. Free checks cover 100; Pro checks cover 20,000. Nothing has been uploaded or charged.`);
    const opts=options(),revision=state.revision,result=await runWorker(segments,opts);
    if(revision!==state.revision)throw Error('Files or settings changed during the check. Run it again to review the current version.');
    state.result=result;state.page=0;$('#filter').value='all';$('#search').value='';renderResult();$('#export-csv').disabled=false;$('#export-html').disabled=false;
    message(state.result.capped?'The 20,000 finding limit was reached. Split the batch for a complete report.':`Checked ${segments.length.toLocaleString()} segments on this device. Review each finding in context.`);
  }catch(err){invalidate();message(err.message,true);}finally{state.busy=false;$('#run-check').disabled=false;$('#run-check').innerHTML='Run quality check <span>→</span>';}
}
$('#run-check').onclick=run;
async function sample(){if(state.busy)return;if(state.result&&!confirm('Replace this review with the sample? Export your current findings first.'))return;try{const rows=parseDelimited(await(await fetch('./samples/bilingual-demo.csv')).text());state.files=[{name:'website-copy_de-DE.csv',sheets:[{name:'Table',rows}],sheet:0,mapping:mapFor(rows)}];$('#source-locale').value='en-US';$('#target-locale').value='de-DE';invalidate();renderFiles();$('#workbench').scrollIntoView();await run();}catch(err){message(err.message,true);}}
for(const id of ['#try-demo','#load-sample','#empty-sample'])$(id).onclick=sample;
function filtered(){const q=$('#search').value.toLowerCase(),filter=$('#filter').value;return(state.result?.issues||[]).filter(i=>(filter==='all'||i.status===filter||i.severity===filter)&&(!q||[i.source,i.target,i.id,i.file,i.detail].some(s=>String(s).toLowerCase().includes(q))));}
function renderResult(){
  const r=state.result;if(!r)return;$('#empty-state').classList.add('hidden');$('#results').classList.remove('hidden');
  $('#stat-segments').textContent=r.segments.toLocaleString();$('#stat-errors').textContent=r.issues.filter(i=>i.severity==='error').length.toLocaleString();$('#stat-warnings').textContent=r.issues.filter(i=>i.severity==='warning').length.toLocaleString();$('#stat-open').textContent=r.issues.filter(i=>i.status==='open').length.toLocaleString();
  const items=filtered(),pages=Math.max(1,Math.ceil(items.length/pageSize));state.page=Math.min(state.page,pages-1);$('#result-count').textContent=`${items.length} findings`;$('#page-info').textContent=`${state.page+1} / ${pages}`;$('#prev-page').disabled=state.page===0;$('#next-page').disabled=state.page===pages-1;
  $('#findings').innerHTML=items.slice(state.page*pageSize,(state.page+1)*pageSize).map(i=>`<article class="finding-card"><header><span class="severity ${i.severity}">${i.severity}</span><strong>${e(RULES[i.rule])}</strong><small title="${e(i.file)} · ${e(i.sheet)} · row ${i.row}">${e(i.id)} · row ${i.row}</small></header><div class="segment-pair"><div><span class="label">SOURCE</span><p>${e(i.source)||'—'}</p></div><div><span class="label">TRANSLATION</span><p>${e(i.target)||'—'}</p></div></div><p class="finding-detail">${e(i.detail)}</p><div class="review-row"><label for="review-${i.key}">Decision</label><select id="review-${i.key}" data-review="${i.key}" aria-label="Review decision for ${e(i.id)} ${e(RULES[i.rule])}">${['open','ignored','resolved'].map(s=>`<option value="${s}" ${s===i.status?'selected':''}>${s[0].toUpperCase()+s.slice(1)}</option>`).join('')}</select><input data-note="${i.key}" aria-label="Reviewer note for ${e(i.id)} ${e(RULES[i.rule])}" placeholder="Add a review note…" maxlength="1000" value="${e(i.note)}"></div></article>`).join('')||`<div class="success-empty"><strong>${r.issues.length?'No findings match this filter.':'No issues found by these checks.'}</strong><p>${r.issues.length?'Change the filter or search to see more findings.':'A human review is still needed for meaning, tone and context.'}</p></div>`;
  for(const s of document.querySelectorAll('[data-review]'))s.onchange=()=>{r.issues.find(i=>i.key===s.dataset.review).status=s.value;renderResult();};
  for(const n of document.querySelectorAll('[data-note]'))n.oninput=()=>{r.issues.find(i=>i.key===n.dataset.note).note=n.value;};
}
$('#filter').onchange=()=>{state.page=0;renderResult();};$('#search').oninput=()=>{state.page=0;renderResult();};$('#prev-page').onclick=()=>{state.page--;renderResult();};$('#next-page').onclick=()=>{state.page++;renderResult();};
function download(name,text,type){const url=URL.createObjectURL(new Blob([text],{type}));const a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);}
$('#export-csv').onclick=async()=>{try{if(!state.result)return;const result=state.result,revision=state.revision;if(result.segments>100||state.files.length>1||result.rules.includes('glossary'))await checkAccess();if(revision!==state.revision)throw Error('The check changed. Run it again before exporting.');download('localeproof-findings.csv',reportCSV(result),'text/csv;charset=utf-8');}catch(err){message(err.message,true);openUnlock();}};
$('#export-html').onclick=async()=>{if(!state.pro){openUnlock();return;}try{const result=state.result,revision=state.revision;if(!result)throw Error('Run a check first.');await checkAccess();const pro=await import('./api/pro.js?report='+Date.now());if(revision!==state.revision)throw Error('The check changed. Run it again before exporting.');download('localeproof-review.html',pro.html(result),'text/html;charset=utf-8');}catch(err){message(err.message,true);openUnlock();}};
$('#save-profile').onclick=async()=>{if(!state.pro){openUnlock();return;}try{const o=options();await checkAccess();localStorage.setItem('localeproof-profile-v1',JSON.stringify(o));message('Settings and glossary saved in this browser. Document contents and findings were not saved.');}catch(err){message(err.message,true);}};
$('#load-profile').onclick=async()=>{if(!state.pro){openUnlock();return;}try{await checkAccess();const data=JSON.parse(localStorage.getItem('localeproof-profile-v1')||'null');if(!data)throw Error('There is no saved profile in this browser yet.');$('#source-locale').value=data.sourceLocale;$('#target-locale').value=data.targetLocale;for(const input of document.querySelectorAll('#rule-list input'))input.checked=data.rules.includes(input.value);$('#glossary').value=data.glossary.map(t=>t.source+'\t'+t.target).join('\n');invalidate();message('Profile loaded. Run a new check with these settings.');}catch(err){message(err.message,true);}};
async function init(){
  setPro(false);
  try{state.config=await api('config');const c=state.config;$('#billing-status').textContent=c.demo?'Local payment simulation · no real charges':c.salesEnabled?'Secure checkout by Lemon Squeezy':'Free public demo · no signup or checkout';
    if(c.demo){const b=document.createElement('div');b.className='demo-banner';b.textContent='LOCAL DEMO — Checkout simulates a purchase. No money is collected.';document.body.prepend(b);}
    try{await checkAccess();}catch{}
  }catch{$('#billing-status').textContent='Billing is temporarily unavailable. Free local checks still work.';}
}
init();
