'use strict';
// Bounded larger reads for files whose capped pass could not recover metadata.
// Uses the standard 32 MB progressive feasibility pass; results are stored under
// a distinct 'mrf-deep' key so the original capped observations remain intact.
const fs=require('fs'),path=require('path');
const R=require('./recovery-run');
const {retrieve,parsePayload,sha,MAX_BYTES,PARSER_VERSION}=require('./lib/recovery-transport');
const OUT=path.join(R.BASE,'rechecks/2026-09-09/investigation');
const RAW=path.join(R.BASE,'.domain-discovery/investigation-20260909');
const read=f=>JSON.parse(fs.readFileSync(f,'utf8'));
const json=(f,v)=>{fs.writeFileSync(f,JSON.stringify(v,null,2)+'\n');};
const ok=s=>s>=200&&s<300;
async function deepRead(url){
 const key=sha(url+'|mrf-deep'),meta=path.join(RAW,key+'.json');
 if(fs.existsSync(meta))return read(meta);
 let transferred=0,decompressed=0,attempts=[],last=null,parsed=[],excerpt='';
 for(const desired of [262144,1048576,4194304,26*1048576]){
  const cap=Math.min(desired,MAX_BYTES-transferred);if(cap<=0)break;
  let r;
  try{r=await retrieve(url,cap,{timeoutMs:30000});}
  catch(e){r={status:0,body:Buffer.alloc(0),error:e.code||e.message,attempts:[],finalUrl:url,checkedAt:new Date().toISOString()};}
  last=r;attempts.push(...(r.attempts||[]));transferred+=((r.attempts||[]).reduce((s,a)=>s+a.bytes,0)||r.body?.length||0);
  if(!ok(r.status)){parsed=[];break;}
  const p=await parsePayload(r.body,r.headers?.['content-type']||'',MAX_BYTES-decompressed);
  parsed=p.parsed;decompressed+=p.inflatedBytes;
  if(parsed.some(m=>m.declaredLastUpdated&&m.cmsVersion&&m.mrfHospitalName&&m.mrfAddress&&m.mrfLicenseState))break;
  if(r.body.length<cap)break;
 }
 const body=last?.body||Buffer.alloc(0),artifact=key+'.bin';
 if(body.length){fs.mkdirSync(RAW,{recursive:true});fs.writeFileSync(path.join(RAW,artifact),body);excerpt=body.toString('utf8').slice(0,2000);}
 const result={url,kind:'mrf-deep',finalUrl:last?.finalUrl||url,status:last?.status||0,error:last?.error||'',
  checkedAt:last?.checkedAt||new Date().toISOString(),headers:last?.headers||{},attempts,
  bytes:body.length,cap:MAX_BYTES,truncated:body.length>=MAX_BYTES,sha256:last?.sha256||'',artifact,
  html:false,entries:[],excerpt,deepRead:true,transferred,decompressed,parserVersion:PARSER_VERSION,
  parsed:{parsed,inflatedBytes:decompressed,archive:false}};
 json(meta,result);return result;
}
async function main(){
 const buckets=read(path.join(R.BASE,'.domain-discovery','bucket-ccns.json'));
 const obs=read(path.join(OUT,'retrieval-results.json'));
 const targets=new Set(buckets.capped);
 const jobs=new Map();
 for(const j of obs){
  if(j.kind!=='mrf'||!j.ccns.some(c=>targets.has(c)))continue;
  const o=j.retrieval;
  const parsedIncomplete=ok(o.status)&&(o.truncated||(o.parsed&&o.parsed.parsed&&o.parsed.parsed.some(m=>!m.declaredLastUpdated||!m.mrfAddress)));
  const transportFailed=!ok(o.status)&&!o.status;
  if(!parsedIncomplete&&!transportFailed)continue;
  if(!jobs.has(j.url))jobs.set(j.url,{url:j.url,kind:'mrf-deep',ccns:[],roles:['deep-read']});
  const job=jobs.get(j.url);for(const c of j.ccns)if(targets.has(c)&&!job.ccns.includes(c))job.ccns.push(c);
 }
 const list=[...jobs.values()];
 console.log('Deep reads queued: '+list.length+' URLs');
 for(const job of list)await deepRead(job.url);
 const merged=[...obs];
 for(const job of list){
  const existing=merged.find(x=>x.kind==='mrf-deep'&&x.url===job.url);
  if(existing)Object.assign(existing.retrieval,read(path.join(RAW,sha(job.url+'|mrf-deep')+'.json')));
  else merged.push({...job,retrieval:read(path.join(RAW,sha(job.url+'|mrf-deep')+'.json'))});
 }
 json(path.join(OUT,'retrieval-results.json'),merged);
 console.log('Saved '+merged.length+' retrievals (+'+list.length+' deep)');
}
if(require.main===module)main().catch(e=>{console.error(e);process.exitCode=1;});
module.exports={deepRead};
