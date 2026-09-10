'use strict';
// Intake for publisher responses to the approved outreach pack.
// Usage: node scripts/hpt/stage-publisher-response.js <responses.json>
// responses.json: array of {ccn, kind:'note'|'pointer'|'file', url?, text?,
//   received_at?, note?}
//  - kind 'pointer': url points at a (re)published cms-hpt.txt; it is fetched
//    in-browser-free HTTP through the standard capped transport and staged as
//    document evidence for that CCN.
//  - kind 'file': url points at the standard-charges file; staged as mrf
//    evidence (header parsed for identity + metadata).
//  - kind 'note': free-text publisher statement; recorded verbatim (sanitized)
//    for the human adjudication queue.
// After staging, re-run: node scripts/hpt/analyze-investigation.js --apply
const fs=require('fs'),path=require('path');
const R=require('./recovery-run');
const {sha,decode,parsePayload}=require('./lib/recovery-transport');
const {parsePointer}=require('./lib/parse');
const {requestCapped}=require('./lib/probe');
const inv=require('./investigate-unresolved');
const OUT=inv.OUT,RAW=inv.RAW;
const ok=s=>s>=200&&s<300;
async function main(inputFile){
 const items=JSON.parse(fs.readFileSync(inputFile,'utf8'));
 const obs=JSON.parse(fs.readFileSync(path.join(OUT,'retrieval-results.json'),'utf8'));
 const responsesPath=path.join(OUT,'publisher-responses.json');
 const responses=fs.existsSync(responsesPath)?JSON.parse(fs.readFileSync(responsesPath,'utf8')):[];
 for(const it of items){
  if(!it.ccn||!it.kind){console.error('skip: missing ccn/kind',JSON.stringify(it).slice(0,80));continue;}
  if(it.kind==='note'){
   responses.push({ccn:it.ccn,received_at:it.received_at||new Date().toISOString(),text:R.sanitize(it.text||''),note:it.note||''});
   console.log('recorded note for',it.ccn);continue;
  }
  if(!it.url){console.error('skip: no url',it.ccn);continue;}
  const kind=it.kind==='pointer'?'document':'mrf';
  const key=sha(it.url+'|'+kind);
  let buf;
  try{
   const r=await requestCapped(it.url,{cap:262144,timeoutMs:20000,headers:require('./lib/fetch').BROWSER_HEADERS});
   buf=r.body;
   var meta={url:it.url,finalUrl:r.finalUrl||it.url,status:r.status};
  }catch(e){
   console.error('fetch failed for',it.ccn,it.url,'-',e.message);continue;
  }
  fs.writeFileSync(path.join(RAW,key+'.bin'),buf);
  const text=decode(buf),html=/<!doctype\s+html|<html\b|<body\b/i.test(text.slice(0,2500));
  const entries=kind==='document'&&ok(meta.status)&&!html?parsePointer(text).entries:[];
  const parsed=kind==='mrf'&&ok(meta.status)?await parsePayload(buf,it.contentType||'',4*1048576):null;
  const record={url:it.url,kind,finalUrl:meta.finalUrl,status:meta.status,error:'',
   checkedAt:new Date().toISOString(),headers:{},viaBrowser:false,source:'publisher-response',
   attempts:[{method:'GET',via:'http',url:it.url,finalUrl:meta.finalUrl,status:meta.status,bytes:buf.length,sha256:sha(buf),checkedAt:new Date().toISOString()}],
   bytes:buf.length,cap:262144,truncated:buf.length>=262144,sha256:sha(buf),artifact:key+'.bin',html,
   entries,links:[],excerpt:R.sanitize(text.slice(0,18000)),parsed};
  fs.writeFileSync(path.join(RAW,key+'.json'),JSON.stringify(record,null,2));
  const existing=obs.find(x=>x.kind===kind&&x.url===it.url);
  if(existing){
   if(!existing.ccns.includes(it.ccn))existing.ccns.push(it.ccn);
   existing.roles=existing.roles||[];
   if(!existing.roles.includes('publisher-response'))existing.roles.push('publisher-response');
   existing.retrieval=record;
  }
  else obs.push({url:it.url,kind,ccns:[it.ccn],roles:['publisher-response'],retrieval:record});
  responses.push({ccn:it.ccn,kind,received_at:new Date().toISOString(),url:it.url,status:meta.status,sha256:record.sha256});
  console.log('staged',kind,'for',it.ccn,'-',it.url.slice(0,70),'status',meta.status);
 }
 fs.writeFileSync(responsesPath,JSON.stringify(responses,null,2));
 fs.writeFileSync(path.join(OUT,'retrieval-results.json'),JSON.stringify(obs,null,2));
 console.log('Done. Now re-run: node scripts/hpt/analyze-investigation.js --apply');
}
if(require.main===module)main(process.argv[2]).catch(e=>{console.error(e);process.exitCode=1;});
module.exports={main};
