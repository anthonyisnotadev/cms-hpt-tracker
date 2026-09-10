'use strict';
const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const { csvToObjects, toCSV, pooled, nameSimilarity } = require('./lib/util');
const { parsePointer, isPlausibleMrfUrl } = require('./lib/parse');
const { retrieve, progressiveProbe, decode, sha, safeUrl, PARSER_VERSION } = require('./lib/recovery-transport');
const { parsePayload, MAX_BYTES } = require('./lib/recovery-transport');
const { requestCapped } = require('./lib/probe');
const { matchMrfHeader } = require('./lib/mrf-header-match');
const { metadataStatus } = require('./recheck-interventions');
const ROOT = path.resolve(__dirname, '../..');
const BASE = path.join(ROOT, 'data/hpt-audit');
const PRIOR = path.join(BASE, 'rechecks/2026-09-09/resolution');
const STAGE = path.join(BASE, '.domain-discovery/recovery-856-v1');
const OUT = path.join(BASE, 'rechecks/2026-09-09/recovery-856');
const CATEGORIES = ['file-access-review', 'metadata-or-pointer-review', 'identity-or-format-review', 'pointer-or-domain-review'];
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const csv = file => csvToObjects(fs.readFileSync(file, 'utf8'));
const json = (file, value) => { fs.mkdirSync(path.dirname(file),{recursive:true}); const temp = file + '.partial'; fs.writeFileSync(temp,JSON.stringify(value,null,2)+'\n');fs.renameSync(temp,file); };
const good = status => Number(status) >= 200 && Number(status) < 300;
const fileLink = url => /\.(csv|json|zip|gz)([?#]|$)|MRFDownload|fileType=|standardcharges|\/charges\/mrf/i.test(url);
const pricing = /price|pricing|transparency|standard.?charges|machine.?readable|chargemaster|financial|billing|cms-hpt/i;
const sanitize = text => String(text || '').replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,'[email removed]').replace(/(?:contact[-_ ]?name|contact[-_ ]?email)\s*[:=][^\n\r]+/gi,'[contact removed]');
const pending = new Map();
async function cached(kind, key, work) {
  const f=path.join(STAGE,kind+'-'+sha(key)+'.json');
  if(fs.existsSync(f))return read(f);
  if(pending.has(f))return pending.get(f);
  const p=(async()=>{const value=await work();json(f,value);return value;})();pending.set(f,p);
  try{return await p;}finally{pending.delete(f);}
}
function inventory() {
  fs.mkdirSync(STAGE,{recursive:true});fs.mkdirSync(OUT,{recursive:true});
  const f=path.join(STAGE,'cohort.json');if(fs.existsSync(f))return read(f);
  const original=new Map(read(path.join(BASE,'.domain-discovery/intervention-recheck-20260909/cohort.json')).map(r=>[r.ccn,r]));
  const rows=csv(path.join(PRIOR,'assessments.csv')).filter(r=>CATEGORIES.includes(r.status)).map(r=>({...r,base:original.get(r.ccn)}));
  if(rows.length!==856||new Set(rows.map(r=>r.ccn)).size!==856)throw new Error('Expected frozen cohort of 856 unique hospitals');
  rows.sort((a,b)=>CATEGORIES.indexOf(a.status)-CATEGORIES.indexOf(b.status)||a.ccn.localeCompare(b.ccn));json(f,rows);return rows;
}
async function document(url) {
  try {url=safeUrl(url);}catch(e){return {url,status:0,error:e.message,entries:[],links:[],text:''};}
  return cached('doc',url,async()=>{
    const r=await retrieve(url,524288), text=decode(r.body), html=/<!doctype\s+html|<html\b|<body\b/i.test(text.slice(0,2000));
    const artifact='document-'+sha(url)+'.bin';fs.writeFileSync(path.join(STAGE,artifact),r.body);
    if(r.attempts.length)r.attempts.at(-1).artifact=artifact;
    const entries=good(r.status)&&!html?parsePointer(text).entries.map(e=>({location_name:e.locationName||'',sourcePageUrl:e.sourcePageUrl||'',urls:(e.mrfUrls||[e.mrfUrl]).filter(isPlausibleMrfUrl)})):[];
    const links=[];let excerpt=text;
    if(html){const $=cheerio.load(text);$('a[href]').each((i,a)=>{const label=$(a).text().trim().replace(/\s+/g,' ');try{const u=safeUrl(new URL($(a).attr('href'),r.finalUrl||url).href);if(pricing.test(u+' '+label)||fileLink(u))links.push({url:u,label:sanitize(label)});}catch{}});$('script,style,noscript').remove();excerpt=$('body').text().replace(/\s+/g,' ');}
    return {url,finalUrl:r.finalUrl||url,status:r.status,error:r.error||'',checkedAt:r.checkedAt,sha256:r.sha256,attempts:r.attempts,html,entries,links:[...new Map(links.map(l=>[l.url,l])).values()].slice(0,60),text:sanitize(excerpt).slice(0,16000)};
  });
}
async function discover(domain,rows, extra=[]) {
  const docs=[],seen=new Set();
  const queue=[...new Set(rows.map(r=>r.base.pointer_url).filter(Boolean)),`https://${domain}/cms-hpt.txt`,`https://${domain}/.well-known/cms-hpt.txt`,`https://${domain}/`,...rows.map(r=>r.source_page).filter(Boolean),...extra].map(url=>({url,depth:0}));
  while(queue.length&&docs.length<8){const item=queue.shift();if(seen.has(item.url))continue;seen.add(item.url);
    const d=await document(item.url);docs.push(d);
    if(item.depth<3)for(const l of d.links||[]){if(!fileLink(l.url)||/cms-hpt\.txt/i.test(l.url))queue.push({url:l.url,depth:item.depth+1});}
  }
  return {domain,docs};
}
function refsFor(r,discovery, priorEvidence) {
  const refs=[];
  for(const d of discovery.docs)for(const e of d.entries||[])for(const url of e.urls)refs.push({url,location_name:e.location_name,pointerUrl:d.finalUrl,pointerRequestedUrl:d.url,pointerCheckedAt:d.checkedAt,pointerSha256:d.sha256,sourcePageUrl:e.sourcePageUrl,score:nameSimilarity(e.location_name,r.hospital_name)});
  refs.sort((a,b)=>b.score-a.score);
  const selected=refs.filter(e=>e.score>=0.45||e.url===r.base.mrf_url).slice(0,12);
  if(!selected.length)selected.push(...refs.slice(0,4));
  for(const d of discovery.docs)for(const l of d.links||[])if(fileLink(l.url))selected.push({url:l.url,location_name:l.label,pointerUrl:'',sourcePageUrl:d.finalUrl,score:0});
  for(const p of priorEvidence.filter(e=>e.ccn===r.ccn))if(p.url)selected.push({url:p.url,location_name:p.location_name,pointerUrl:'',sourcePageUrl:p.sourcePageUrl||'',score:0});
  if(r.base.mrf_url)selected.push({url:r.base.mrf_url,location_name:'',pointerUrl:'',sourcePageUrl:'',score:0});
  return [...new Map(selected.map(e=>[e.url,e])).values()].map(e=>{
    // Do not discard current pointer provenance when a historical URL duplicates it.
    const linked=refs.find(ref=>ref.url===e.url);return linked||e;
  });
}
async function probe(url){return cached('probe-'+PARSER_VERSION,url,()=>progressiveProbe(url,async(u,cap)=>{
  const r=await retrieve(u,cap),artifact='body-'+sha(u+'|'+cap)+'.bin';
  fs.writeFileSync(path.join(STAGE,artifact),r.body);
  if(r.attempts.length)r.attempts.at(-1).artifact=artifact;
  return r;
}));}
async function deepen() {
  const files=fs.readdirSync(STAGE).filter(f=>f.startsWith('probe-'+PARSER_VERSION+'-'));
  const selected=files.map(f=>({file:f,p:read(path.join(STAGE,f))})).filter(({p})=>!p.deepened&&p.candidates?.some(c=>c.innerKind==='json'&&(!c.declaredLastUpdated||!c.cmsVersion||!c.mrfAddress||!c.mrfLicenseState)));
  console.log(`Checking complete-file feasibility for ${selected.length} JSON files`);
  await pooled(selected,{concurrency:9,keyFn:({p})=>new URL(p.url).hostname+':'+(parseInt(sha(p.url).slice(0,4),16)%3),onProgress:(n,t)=>{if(n%10===0||n===t)console.log(`deepen ${n}/${t}`)}},async({file,p})=>{
    p.deepened=true;
    try {
      const h=await requestCapped(p.url,{method:'HEAD',timeoutMs:15000,validateUrl:safeUrl}),size=good(h.status)?Number(h.headers['content-length']):0,remaining=MAX_BYTES-(p.transferred||0);
      p.attempts.push({method:'HEAD',via:'native',url:p.url,finalUrl:h.finalUrl,status:h.status,bytes:0,checkedAt:new Date().toISOString(),contentLength:size||null,redirects:h.redirects||[]});
      if(!size||size>remaining){p.blocker='complete-json-exceeds-byte-budget-or-size-unknown';json(path.join(STAGE,file),p);return;}
      if(p.attempts.some(a=>a.method==='GET'&&a.bytes===size)){json(path.join(STAGE,file),p);return;}
      const r=await retrieve(p.url,size),artifact='body-'+sha(p.url+'|complete')+'.bin';fs.writeFileSync(path.join(STAGE,artifact),r.body);r.attempts.at(-1).artifact=artifact;
      p.attempts.push(...r.attempts);p.transferred+=r.attempts.reduce((s,a)=>s+a.bytes,0);
      if(good(r.status)){
        const parsed=await parsePayload(r.body,r.headers['content-type'],MAX_BYTES-(p.decompressed||0));
        p.candidates=parsed.parsed.map(c=>({...c,rangeStatus:r.status,checkedAt:r.checkedAt}));p.rangeStatus=r.status;p.checkedAt=r.checkedAt;p.finalUrl=r.finalUrl;p.error=r.error||'';
        p.blocker=p.candidates.some(c=>c.declaredLastUpdated&&c.cmsVersion&&c.mrfAddress&&c.mrfLicenseState)?'':'complete-json-metadata-unresolved';
      }
    }catch(e){p.deepenError=e.code||e.message;if(/EACCES|EPERM/.test(p.deepenError))throw e;}
    json(path.join(STAGE,file),p);
  });
  report();
}
async function free() {
  const cohort=inventory();await retrieve('https://www.cms.gov/',512);
  const byDomain=new Map();for(const r of cohort){const d=r.base.domain;if(!byDomain.has(d))byDomain.set(d,[]);byDomain.get(d).push(r);}
  const discoveries={};let errors=[];
  await pooled([...byDomain],{concurrency:12,keyFn:([d])=>d,onProgress:(n,t)=>{if(n%25===0||n===t)console.log(`discovery ${n}/${t}`)}},async([domain,rows])=>{
    try{discoveries[domain]=await cached('discovery',domain,()=>discover(domain,rows));}catch(e){errors.push({domain,error:e.message});}
  });
  if(errors.length)throw new Error(`Discovery incomplete: ${JSON.stringify(errors.slice(0,3))}`);
  json(path.join(STAGE,'discoveries.json'),discoveries);
  const evidence=csv(path.join(PRIOR,'file-evidence.csv')), refs={}, tasks=new Set();
  for(const r of cohort){refs[r.ccn]=refsFor(r,discoveries[r.base.domain],evidence);for(const ref of refs[r.ccn])tasks.add(ref.url);}
  json(path.join(STAGE,'refs.json'),refs);console.log(`Probing ${tasks.size} distinct URLs`);
  await pooled([...tasks],{concurrency:12,keyFn:u=>{try{return new URL(u).hostname+':'+(parseInt(sha(u).slice(0,4),16)%3);}catch{return 'invalid';}},onProgress:(n,t)=>{if(n%25===0||n===t)console.log(`files ${n}/${t}`)}},async url=>{
    try{await probe(url);}catch(e){if(/EACCES|EPERM/.test(e.message))errors.push({url,error:e.message});else json(path.join(STAGE,'probe-'+PARSER_VERSION+'-'+sha(url)+'.json'),{url,error:e.message,rangeStatus:0,candidates:[],attempts:[],blocker:'invalid-url-or-tool-error'});}
  });
  if(errors.length)throw new Error('File pass incomplete due to local errors');
  return report();
}
async function refresh(){
  const discoveries=read(path.join(STAGE,'discoveries.json')),prior=csv(path.join(PRIOR,'file-evidence.csv')),refs={},urls=new Set(),errors=[];
  // The pilot observed canonical www pointers that worked when bare-domain
  // requests failed. Reuse that navigation pattern; never reuse a verdict.
  const variants=Object.values(discoveries).filter(d=>d.domain.split('.').length===2&&!d.docs.some(p=>p.entries?.length));
  await pooled(variants,{concurrency:12,keyFn:d=>d.domain},async d=>{
    const url='https://www.'+d.domain+'/cms-hpt.txt';if(d.docs.some(p=>p.url===url))return;
    try{d.docs.push(await document(url));}catch(e){errors.push({url,error:e.message});}
  });
  if(errors.length)throw new Error('Pointer variant checks have unresolved tool errors');
  json(path.join(STAGE,'discoveries.json'),discoveries);
  for(const r of inventory()){refs[r.ccn]=refsFor(r,discoveries[r.base.domain],prior);for(const ref of refs[r.ccn])urls.add(ref.url);}
  const pendingUrls=[...urls].filter(url=>!fs.existsSync(path.join(STAGE,'probe-'+PARSER_VERSION+'-'+sha(url)+'.json')));
  console.log(`Verifying ${pendingUrls.length} additional URLs from shared navigation discoveries`);
  await pooled(pendingUrls,{concurrency:12,keyFn:url=>{try{return new URL(url).hostname+':'+parseInt(sha(url).slice(0,4),16)%3;}catch{return 'invalid';}},onProgress:(n,t)=>{if(n%20===0||n===t)console.log(`refresh ${n}/${t}`);}},async url=>{
    try{await probe(url);}catch(e){errors.push({url,error:e.message});}
  });
  if(errors.length)throw new Error('Refresh has unresolved tool errors: '+JSON.stringify(errors.slice(0,3)));
  json(path.join(STAGE,'refs.json'),refs);report();
}
function report() {
  const cohort=inventory(), refs=read(path.join(STAGE,'refs.json')), discoveries=read(path.join(STAGE,'discoveries.json'));
  const roster=read(path.join(ROOT,'cms_data/hpt/roster.json')), assessments=[],evidence=[],proposals=[],jobs=[];
  const browserFile=path.join(STAGE,'browser-observations.json'),browser=fs.existsSync(browserFile)?read(browserFile):[];
  const attempts=new Map(),matchCache=new Map();
  for(const r of cohort){const files=[];
    for(const ref of refs[r.ccn]||[]){const f=path.join(STAGE,'probe-'+PARSER_VERSION+'-'+sha(ref.url)+'.json');if(!fs.existsSync(f))throw new Error('Missing probe '+ref.url);const p=read(f);
      attempts.set(ref.url,p.attempts||[]);
      if(!p.candidates?.length)evidence.push({ccn:r.ccn,hospital_name:r.hospital_name,...ref,member:'',identity:'mrf-header-unreachable',identity_basis:'',header_name:'',header_location:'',header_address:'',header_state:'',http_status:p.rangeStatus,file_kind:'',date:'',version:'',checked_at:p.checkedAt||'',metadata:'unverified',transport:p.attempts?.at(-1)?.via||'',parser_version:p.parserVersion||PARSER_VERSION,error:p.error||p.blocker||'no-header-recovered'});
      for(const c of p.candidates||[]){const matchKey=JSON.stringify([ref.url,c.member,ref.location_name,p.checkedAt]);
        if(!matchCache.has(matchKey))matchCache.set(matchKey,matchMrfHeader({refs:[ref]},c,roster));
        const m=matchCache.get(matchKey),hit=m.matches.find(x=>x.hospital.ccn===r.ccn);
        const file={ccn:r.ccn,hospital_name:r.hospital_name,...ref,member:c.member,identity:hit?'corroborated':m.matches.length?'header-matches-other-roster-hospital':m.reason,identity_basis:hit?.identityBasis||'',
          header_name:c.mrfHospitalName||'',header_location:c.mrfLocationName||'',header_address:c.mrfAddress||'',header_state:c.mrfLicenseState||'',http_status:p.rangeStatus,file_kind:c.innerKind,date:c.declaredLastUpdated||'',version:c.cmsVersion||'',checked_at:p.checkedAt,
          metadata:metadataStatus({declared_date:c.declaredLastUpdated,version:c.cmsVersion},Date.parse(p.checkedAt)),transport:p.attempts?.at(-1)?.via||'',parser_version:p.parserVersion,
          fileSha256:p.attempts?.filter(a=>a.method==='GET'&&good(a.status)&&a.artifact).at(-1)?.sha256||''};files.push(file);evidence.push(file);
      }
    }
    const linked=files.filter(f=>f.pointerUrl&&f.identity==='corroborated'&&good(f.http_status));
    const chosen=linked.length===1?linked[0]:null;
    const identified=files.filter(f=>f.identity==='corroborated');
    const observed=chosen||(identified.length===1?identified[0]:null);
    const status=chosen?.metadata==='date-within-365-days-version-3'?'correction-verified':chosen?.metadata==='date-over-365-days'?'publisher-date-review':chosen?.metadata==='date-within-365-days-older-version'?'publisher-template-review':r.status;
    const d=discoveries[r.base.domain], pointer=d.docs.find(x=>x.entries?.some(e=>e.urls.length));
    const diagnostics=[...new Set((refs[r.ccn]||[]).flatMap(ref=>{
      const p=read(path.join(STAGE,'probe-'+PARSER_VERSION+'-'+sha(ref.url)+'.json'));
      return [p.error,p.blocker,p.deepenError,...(p.attempts||[]).filter(a=>!good(a.status)).map(a=>a.error||('HTTP '+a.status)),...files.filter(f=>f.url===ref.url&&f.identity!=='corroborated').map(f=>f.identity)].filter(Boolean);
    }))];
    const browserChecks=browser.filter(o=>o.ccn?o.ccn===r.ccn:o.domain===r.base.domain&&o.visited.some(u=>new URL(u).hostname.replace(/^www\./,'')===r.base.domain.replace(/^www\./,'')));
    const row={...Object.fromEntries(Object.entries(r).filter(([k])=>k!=='base')),status,previous_status:r.status,
      website:d.docs.some(x=>good(x.status))?'response received':'not verified',pointer:pointer?'entries retrieved':'not retrieved',identity:observed?'corroborated':'unresolved',file_access:(refs[r.ccn]||[]).some(ref=>(attempts.get(ref.url)||[]).some(a=>a.method==='GET'&&good(a.status)))?'response received':'unresolved',
      metadata:observed?.metadata||'unverified',pointer_url:chosen?.pointerUrl||pointer?.finalUrl||r.pointer_url||'',mrf_url:observed?.url||'',date:observed?.date||'',version:observed?.version||'',checked_at:observed?.checked_at||d.docs[0]?.checkedAt||'',
      methods:[...new Set(d.docs.flatMap(x=>(x.attempts||[]).map(a=>a.via)).concat((refs[r.ccn]||[]).flatMap(x=>(attempts.get(x.url)||[]).map(a=>a.via))))].join('|'),
      blocker:chosen?'':linked.length>1?'multiple-corroborated-candidates':files.some(f=>f.identity==='corroborated')?'official-pointer-or-metadata-unresolved':files.length?'facility-identity-or-metadata-unresolved':'retrieval-or-domain-unresolved',
      blocker_details:chosen?chosen.metadata:diagnostics.join(' | ')||d.docs.map(p=>(p.error||('HTTP '+p.status))+' at '+p.url).join(' | '),
      browser_observation:browserChecks.map(o=>o.outcome+': '+(o.note||'')).join(' | ')};
    const additionalMethods=[];
    if(browserChecks.length)additionalMethods.push('brave');
    if(fs.existsSync(path.join(STAGE,'pilot-'+r.ccn+'.json')))additionalMethods.push('glm-5.3-flash');
    if(fs.existsSync(path.join(STAGE,'search-import-'+r.ccn+'.json')))additionalMethods.push('web-search-verification');
    row.methods=[...new Set(row.methods.split('|').filter(Boolean).concat(additionalMethods))].join('|');
    assessments.push(row);
    if(status==='correction-verified')proposals.push({ccn:r.ccn,base:r.base,action:'replace',evidence:{...chosen,officialDomain:d.docs.find(p=>p.finalUrl===chosen.pointerUrl)?.officialDomain||r.base.domain},reviewed_at:new Date().toISOString(),note:'Recovery pass corroborated current official pointer, facility identity and file metadata. Header review only.'});
    if(!/^correction|^publisher/.test(status))jobs.push({ccn:r.ccn,hospital_name:r.hospital_name,domain:r.base.domain,status,startUrl:r.pointer_url||`https://${r.base.domain}/`,pricingPages:d.docs.filter(x=>x.html).map(x=>x.finalUrl),maxPages:8,maxDepth:3,maxSelections:2,timeoutMs:300000});
  }
  for(const [name,rows]of [['assessments.csv',assessments],['file-evidence.csv',evidence]])fs.writeFileSync(path.join(OUT,name),toCSV(rows,[...new Set(rows.flatMap(Object.keys))]));
  json(path.join(STAGE,'proposals.json'),proposals);json(path.join(STAGE,'browser-jobs.json'),jobs);
  const counts={};for(const r of assessments)counts[r.status]=(counts[r.status]||0)+1;
  const summary={hospitals:cohort.length,counts,distinctFileUrls:attempts.size,fileBytes:[...attempts.values()].flat().reduce((n,a)=>n+a.bytes,0)};
  json(path.join(OUT,'summary.json'),summary);console.log(JSON.stringify(summary));return summary;
}
async function main(){const cmd=process.argv[2]||'free';if(cmd==='free')await free();else if(cmd==='refresh')await refresh();else if(cmd==='deepen')await deepen();else if(cmd==='report')report();else if(cmd==='inventory')console.log(inventory().length);else throw new Error('Unknown stage');}
if(require.main===module)main().catch(e=>{console.error(e);process.exitCode=1;});
module.exports={inventory,document,discover,refsFor,probe,report,cached,json,read,csv,sanitize,STAGE,OUT,BASE,ROOT,PRIOR};
