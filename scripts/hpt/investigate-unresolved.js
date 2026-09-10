'use strict';
// Additive investigation: never updates the tracker, old reports, or reviewed ledger.
const fs=require('fs'),path=require('path'),cheerio=require('cheerio');
const R=require('./recovery-run');
const {retrieve,parsePayload,decode,sha}=require('./lib/recovery-transport');
const {parsePointer}=require('./lib/parse');
const {requestCapped}=require('./lib/probe');
const {pooled,toCSV,csvToObjects}=require('./lib/util');
const OUT=path.join(R.BASE,'rechecks/2026-09-09/investigation');
const RAW=path.join(R.BASE,'.domain-discovery/investigation-20260909');
const json=(f,v)=>{fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,JSON.stringify(v,null,2)+'\n');};
const read=f=>JSON.parse(fs.readFileSync(f,'utf8'));
function inventory(){
 const prior=R.csv(path.join(R.PRIOR,'assessments.csv')),latest=R.csv(path.join(R.OUT,'assessments.csv'));
 const map=new Map(prior.map(r=>[r.ccn,r]));for(const r of latest)map.set(r.ccn,r);
 const ev=[...R.csv(path.join(R.OUT,'file-evidence.csv')),...R.csv(path.join(R.PRIOR,'file-evidence.csv'))];
 const roster=new Map(read(path.join(R.ROOT,'cms_data/hpt/roster.json')).map(r=>[r.ccn,r]));
 const base=new Map(read(path.join(R.BASE,'.domain-discovery/intervention-recheck-20260909/cohort.json')).map(r=>[r.ccn,r]));
 const rows=[...map.values()].filter(r=>r.status!=='correction-verified').sort((a,b)=>a.ccn.localeCompare(b.ccn)).map(r=>{
  const evidence=ev.filter(e=>e.ccn===r.ccn);
  const best=evidence.find(e=>e.url===r.mrf_url&&e.identity==='corroborated')||evidence.find(e=>e.identity==='corroborated')||evidence.find(e=>e.url===r.mrf_url)||evidence[0];
  return {ccn:r.ccn,roster:roster.get(r.ccn),previous:r,base:base.get(r.ccn),evidence,best};
 });
 json(path.join(OUT,'cohort.json'),rows);
 const files=['data/hpt-audit/reviewed-resolutions.json','data/hpt-audit/compliance.csv','data/hpt-audit/manifest.csv','data/hpt-audit/gaps.csv',path.relative(R.ROOT,path.join(R.OUT,'assessments.csv')),path.relative(R.ROOT,path.join(R.PRIOR,'assessments.csv'))];
 json(path.join(OUT,'original-evidence-hashes.json'),files.map(file=>({file,sha256:sha(fs.readFileSync(path.join(R.ROOT,file)))})));
 console.log('Frozen '+rows.length+' unresolved CCNs');return rows;
}
async function get(url,kind='document'){
 const key=sha(url+'|'+kind),meta=path.join(RAW,key+'.json');if(fs.existsSync(meta)){const old=read(meta);
  const retry=process.env.HPT_RETRY_TOOL_ERRORS&&old.toolError||process.env.HPT_RETRY_FAILED&&!old.toolError&&(!old.status||/^curl: \((6|7|28|56)\)/.test(old.error||''));
  if(!retry)return old;json(path.join(RAW,key+'-failed-'+old.checkedAt.replace(/[:.]/g,'-')+'.json'),old);}
 const cap=kind==='mrf'?1048576:524288;
 let result;
 try{
  const opts={timeoutMs:12000};if(kind.endsWith('-plain'))opts.native=(u,o)=>{const headers={...o.headers};delete headers.Range;return requestCapped(u,{...o,headers});};
  const r=await retrieve(url,cap,opts);const artifact=key+'.bin';fs.mkdirSync(RAW,{recursive:true});fs.writeFileSync(path.join(RAW,artifact),r.body);
  const text=decode(r.body),html=/<!doctype\s+html|<html\b|<body\b/i.test(text.slice(0,2500));
  const links=[];let excerpt=text.slice(0,18000);
  if(html){const $=cheerio.load(text);$('script,style,noscript').remove();excerpt=$('body').text().replace(/\s+/g,' ').slice(0,18000);$('a[href]').each((_,a)=>{const label=$(a).text().trim().replace(/\s+/g,' ');try{const href=new URL($(a).attr('href'),r.finalUrl||url).href;if(/^https?:/.test(href)&&/cms-hpt|price|pricing|transparency|standard.?charges|MRFDownload|\.csv|\.json|\.zip/i.test(href+' '+label))links.push({url:href,label});}catch{}});}
  const entries=r.status>=200&&r.status<300&&!html&&kind.startsWith('document')?parsePointer(text).entries:[];
  const parsed=kind==='mrf'&&r.status>=200&&r.status<300?await parsePayload(r.body,r.headers['content-type'],4*1048576):null;
  result={url,kind,finalUrl:r.finalUrl||url,status:r.status,error:r.error||'',checkedAt:r.checkedAt,headers:r.headers,attempts:r.attempts,bytes:r.body.length,cap,truncated:r.body.length===cap,sha256:r.sha256,artifact,html,entries,links,excerpt:R.sanitize(excerpt),parsed};
 }catch(e){result={url,kind,status:0,error:e.code||e.message,checkedAt:new Date().toISOString(),attempts:[],toolError:true};}
 json(meta,result);return result;
}
function targets(rows){
 const jobs=new Map();const norm=u=>/^https?:\/\//i.test(u)?u:'https://'+u;
 const add=(url,kind,ccn,role)=>{if(!url)return;url=norm(url);const key=kind+'|'+url;if(!jobs.has(key))jobs.set(key,{url,kind,ccns:[],roles:[]});const j=jobs.get(key);if(!j.ccns.includes(ccn))j.ccns.push(ccn);if(!j.roles.includes(role))j.roles.push(role);};
 for(const r of rows){
  add(r.best?.pointerRequestedUrl||r.best?.pointerUrl||r.previous.pointer_url||r.base?.pointer_url,'document',r.ccn,'pointer-lead');
  add(r.best?.url||r.previous.mrf_url||r.base?.mrf_url,'mrf',r.ccn,'prior-file-lead');
  add(r.best?.sourcePageUrl||r.previous.source_page,'document',r.ccn,'source-page');
 }
 return [...jobs.values()];
}
async function run(){
 const rows=fs.existsSync(path.join(OUT,'cohort.json'))?read(path.join(OUT,'cohort.json')):inventory();const jobs=targets(rows);json(path.join(OUT,'retrieval-jobs.json'),jobs);
 await pooled(jobs,{concurrency:16,keyFn:j=>{try{return new URL(j.url).hostname;}catch{return 'invalid-url';}},onProgress:(n,t)=>{if(n%40===0||n===t)console.log(`Retrieved ${n}/${t}`);}},async j=>{await get(j.url,j.kind);});
 const observations=jobs.map(j=>({...j,retrieval:read(path.join(RAW,sha(j.url+'|'+j.kind)+'.json'))}));
 json(path.join(OUT,'retrieval-results.json'),observations);console.log('Saved '+observations.length+' retrievals');
}
// Pointer-declared file leads that the first pass never fetched. Same cache,
// same caps; results merge into retrieval-results.json without touching prior roles.
async function extraFiles(){
 const observations=read(path.join(OUT,'retrieval-results.json'));
 const results=fs.existsSync(path.join(OUT,'results.csv'))?toCSV(csvToObjects(fs.readFileSync(path.join(OUT,'results.csv'),'utf8')).filter(r=>r.disposition!=='unresolved'),['ccn']):'ccn';
 const resolved=new Set(csvToObjects(results).map(r=>r.ccn));
 const unresolved=new Set(read(path.join(OUT,'cohort.json')).map(r=>r.ccn));for(const c of resolved)unresolved.delete(c);
 const fetched=new Set(observations.filter(j=>j.kind==='mrf').map(j=>j.url));
 const jobs=new Map();
 for(const j of observations){
  const o=j.retrieval;if(j.kind!=='document')continue;
  if(!(o.status>=200&&o.status<300&&!o.html&&o.entries&&o.entries.length))continue;
  for(const c of j.ccns){if(!unresolved.has(c))continue;
   for(const e of o.entries)for(const u of (e.mrfUrls||[])){
    if(fetched.has(u))continue;
    if(!jobs.has(u))jobs.set(u,{url:u,kind:'mrf',ccns:[],roles:['pointer-declared']});
    const job=jobs.get(u);if(!job.ccns.includes(c))job.ccns.push(c);
   }}}
 const list=[...jobs.values()];console.log('Extra pointer-declared files: '+list.length);
 await pooled(list,{concurrency:16,keyFn:j=>{try{return new URL(j.url).hostname;}catch{return 'invalid-url';}},onProgress:(n,t)=>{if(n%40===0||n===t)console.log(`Retrieved ${n}/${t}`);}},async j=>{await get(j.url,j.kind);});
 const merged=[...observations,...list.map(j=>({...j,retrieval:read(path.join(RAW,sha(j.url+'|'+j.kind)+'.json'))}))];
 json(path.join(OUT,'retrieval-results.json'),merged);console.log('Saved '+merged.length+' retrievals');
}
if(require.main===module)(process.argv[2]==='inventory'?Promise.resolve(inventory()):process.argv[2]==='extra-files'?extraFiles():run()).catch(e=>{console.error(e);process.exitCode=1;});
module.exports={OUT,RAW,inventory,get,read,json,targets,extraFiles};
