export const RULES = {
  empty: 'Missing translation', placeholders: 'Placeholder mismatch', tags: 'Tag mismatch',
  numbers: 'Number mismatch', urls: 'Link mismatch', unchanged: 'Unchanged text',
  whitespace: 'Edge whitespace', consistency: 'Inconsistent translation', glossary: 'Glossary term',
  unsupported: 'Complex message syntax'
};
export const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function parseDelimited(input, delimiter) {
  const text = String(input).replace(/^\uFEFF/, '');
  if (text.length > 10_000_000) throw Error('File exceeds the 10 MB text limit.');
  if (!delimiter) {
    const counts=new Map([['\t',0],[',',0],[';',0]]);let inQuote=false;
    for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(inQuote&&text[i+1]==='"')i++;else inQuote=!inQuote;}else if(!inQuote){if(c==='\r'||c==='\n')break;if(counts.has(c))counts.set(c,counts.get(c)+1);}}
    delimiter=[...counts].sort((a,b)=>b[1]-a[1])[0][0];
  }
  const rows=[]; let row=[], cell='', quoted=false, closed=false;
  const push = () => { row.push(cell); cell=''; closed=false; if(row.length>100) throw Error('Use a table with at most 100 columns.'); };
  for(let i=0;i<text.length;i++) {
    const c=text[i];
    if(quoted) { if(c==='"') { if(text[i+1]==='"'){cell+='"';i++;}else{quoted=false;closed=true;} } else cell+=c; }
    else if(c==='"' && cell==='' && !closed) quoted=true;
    else if(c===delimiter) push();
    else if(c==='\n'||c==='\r') {push();rows.push(row);row=[];if(c==='\r'&&text[i+1]==='\n')i++;}
    else {if(closed && c.trim())throw Error('Unexpected text after a closing quote.'); if(!closed)cell+=c;}
    if(rows.length>20001 || cell.length>10000)throw Error('Limit: 20,000 segments and 10,000 characters per cell.');
  }
  if(quoted)throw Error('A quoted field is not closed. Export the file as UTF-8 CSV again.');
  if(cell!==''||row.length||closed){push();rows.push(row);}
  if(!rows.length||!rows[0].some(v=>v!==''))throw Error('The table is empty or starts with a blank row. Put the header first.');
  const width=rows[0].length;
  if(width<2)throw Error('At least two columns are needed: source and translation.');
  // Retain blank records so review locations still point to the original spreadsheet row.
  const aligned=rows.map(r=>r.length===1&&r[0]===''?Array(width).fill(''):r);
  if(aligned.length>20001)throw Error('Limit: 20,000 data rows per file.');
  if(aligned.some(r=>r.length!==width))throw Error('Rows have different column counts. Check the separator and quoted fields.');
  return aligned;
}
export function makeSegments(table, mapping, file='Pasted table', sheet='') {
  const {source,target,id=-1,header=true}=mapping;
  const width=table[0]?.length||0;
  if(!Array.isArray(table)||source===target||![source,target].every(n=>Number.isInteger(n)&&n>=0&&n<width)||!Number.isInteger(id)||id< -1||id>=width)throw Error('Choose valid, different source and translation columns.');
  return table.slice(header?1:0).map((r,i)=>({
    source:String(r[source]??''),target:String(r[target]??''),id:String(id>=0?r[id]??i+1:i+1),
    row:i+(header?2:1),file,sheet
  })).filter(r=>r.source.trim()||r.target.trim());
}
const bag = a => JSON.stringify([...a].sort());
export function placeholders(s) {
  return s.match(/\{\{\s*[\w.]+\s*\}\}|\$\{[\w.]+\}|\{[\w.]+\}|%(?:\d+\$)?[-+0 #]*\d*(?:\.\d+)?[sdifuxXegc]/g)||[];
}
function tags(s){return (s.match(/<\/?[a-zA-Z][^>]{0,300}>/g)||[]).map(t=>{
  const name=t.match(/^<\/?([\w:-]+)/)[1];const id=t.match(/\bid\s*=\s*["']([^"']+)["']/);
  return `${t.startsWith('</')?'./':''}${name}${id?'#'+id[1]:''}${t.endsWith('./>')?'./':''}`;
});}
export function numbers(s, locale='en-US') {
  const parts=new Intl.NumberFormat(locale).formatToParts(12345.6);
  const decimal=parts.find(p=>p.type==='decimal')?.value||'.';
  const group=parts.find(p=>p.type==='group')?.value||',';
  // Remove placeholders and URLs; digits inside them belong to the other checks.
  for(const p of placeholders(s))s=s.replace(p,'');
  s=s.replace(/https?:\/\/[^\s<>"']+/g,'').replace(/<[^>]*>/g,'');
  return (s.match(/[-+−]?\d+(?:[.,\u00a0\u202f]\d+)*/g)||[]).map(v=>{
    v=v.replace('−','-').split(group).join('').replace(/[\u00a0\u202f]/g,'');
    if(decimal!=='.')v=v.replace(decimal,'.');
    if(!/^[+-]?\d+(?:\.\d+)?$/.test(v))return v;
    const negative=v.startsWith('-');v=v.replace(/^[+-]/,'');
    let [integer,fraction='']=v.split('.');integer=integer.replace(/^0+(?=\d)/,'');fraction=fraction.replace(/0+$/,'');
    return (negative&&(integer!=='0'||fraction)?'-':'')+integer+(fraction?'.'+fraction:'');
  });
}
function links(s){return (s.match(/https?:\/\/[^\s<>"']+/g)||[]).map(v=>v.replace(/[.,;!?)]*$/,''));}
export function analyze(segments, options={}) {
  if(!Array.isArray(segments)||segments.length>20000)throw Error('Limit: 20,000 segments per check.');
  const enabled=new Set(options.rules||Object.keys(RULES));
  const sourceLocale=options.sourceLocale||'en-US',targetLocale=options.targetLocale||'de-DE';
  const glossary=options.glossary||[];
  if(glossary.length>200)throw Error('Use at most 200 glossary terms.');
  const issues=[];const sourceGroups=new Map();let chars=0;
  function add(r,index,rule,severity,detail){
    if(enabled.has(rule)&&issues.length<20000)issues.push({...r,index,rule,severity,detail,key:`${index}:${rule}`,status:'open',note:''});
  }
  segments.forEach((r,index)=>{
    if(typeof r.source!=='string'||typeof r.target!=='string'||r.source.length>10000||r.target.length>10000)throw Error('Invalid or oversized segment.');
    chars+=r.source.length+r.target.length;if(chars>10_000_000)throw Error('Limit: 10 million characters per check.');
    const s=r.source.normalize('NFC'),t=r.target.normalize('NFC');
    if(s.trim()&&!t.trim()){add(r,index,'empty','error','The source has text but the translation is empty.');return;}
    if(bag(placeholders(s))!==bag(placeholders(t)))add(r,index,'placeholders','error',`Source: ${placeholders(s).join(', ')||'none'} · Target: ${placeholders(t).join(', ')||'none'}`);
    if(bag(tags(s))!==bag(tags(t)))add(r,index,'tags','error','Opening, closing, self-closing tags or tag IDs differ. Review tag order separately.');
    if(bag(numbers(s,sourceLocale))!==bag(numbers(t,targetLocale)))add(r,index,'numbers','warning',`Source values: ${numbers(s,sourceLocale).join(', ')||'none'} · Target values: ${numbers(t,targetLocale).join(', ')||'none'}`);
    if(bag(links(s))!==bag(links(t)))add(r,index,'urls','warning','URLs differ. A localized destination may be intentional.');
    if(s.trim()===t.trim() && /\p{L}{3}/u.test(s))add(r,index,'unchanged','warning','The translation matches the source. Brand names and shared words may be correct.');
    if(t!==t.trim() && s===s.trim())add(r,index,'whitespace','warning','The translation adds leading or trailing whitespace.');
    if(/\{[^{}]+,\s*(plural|select|selectordinal)\s*,/.test(s+t))add(r,index,'unsupported','warning','ICU plural/select syntax needs a dedicated ICU validator; this check does not validate branches.');
    const group=s.trim(); if(group){if(!sourceGroups.has(group))sourceGroups.set(group,[]);sourceGroups.get(group).push({r,index,t:t.trim()});}
    for(const term of glossary){
      if(!term.source||!term.target)continue;
      const includes=(text,word)=>{
        const a=text.toLocaleLowerCase(),b=word.toLocaleLowerCase();let from=0,pos;
        while((pos=a.indexOf(b,from))>=0){const before=a[pos-1]||'',after=a[pos+b.length]||'';
          if(!/[\p{L}\p{N}_]/u.test(before)&&!/[\p{L}\p{N}_]/u.test(after))return true;from=pos+b.length;}
        return false;
      };
      if(includes(s,term.source)&&!includes(t,term.target)){add(r,index,'glossary','warning',`Expected “${term.target}” for “${term.source}”. Literal term check; inflections need review.`);break;}
    }
  });
  for(const group of sourceGroups.values())if(new Set(group.map(x=>x.t)).size>1)for(const {r,index}of group)add(r,index,'consistency','warning','Identical source text has different translations in this batch. Context may justify this.');
  return {segments:segments.length,issues,capped:issues.length>=20000,checkedAt:new Date().toISOString(),rules:[...enabled],sourceLocale,targetLocale};
}
export function csvCell(value){let s=String(value??'');if(/^[\s]*[=+@\-\t\r]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';}
export function reportCSV(result){
  const fields=['file','sheet','row','id','severity','rule','status','source','target','detail','note'];
  return '\uFEFF'+[fields,...result.issues.map(i=>fields.map(f=>i[f]??''))].map(r=>r.map(csvCell).join(',')).join('\r\n');
}
