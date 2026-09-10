'use strict';
// Stage evidence bytes fetched by the interactive browser into the same RAW
// cache and retrieval-results format the HTTP pipeline uses. Input JSON:
// array of {url, kind:'document'|'mrf', ccns:[], status, text?|base64?}.
// Transport is recorded as 'browser' — availability shown by a real browser,
// separate from automated HTTP access.
const fs=require('fs'),path=require('path');
const R=require('./recovery-run');
const {sha,decode,parsePayload}=require('./lib/recovery-transport');
const {parsePointer}=require('./lib/parse');
const inv=require('./investigate-unresolved');
const OUT=inv.OUT,RAW=inv.RAW;
const ok=s=>s>=200&&s<300;
async function main(inputFile){
 const items=JSON.parse(fs.readFileSync(inputFile,'utf8'));
 const obs=JSON.parse(fs.readFileSync(path.join(OUT,'retrieval-results.json'),'utf8'));
 for(const it of items){
  const key=sha(it.url+'|'+it.kind);
  const buf=it.base64?Buffer.from(it.base64,'base64'):Buffer.from(it.text||'','utf8');
  fs.writeFileSync(path.join(RAW,key+'.bin'),buf);
  const text=decode(buf),html=/<!doctype\s+html|<html\b|<body\b/i.test(text.slice(0,2500));
  const entries=ok(it.status)&&!html&&it.kind==='document'?parsePointer(text).entries:[];
  const parsed=it.kind==='mrf'&&ok(it.status)?await parsePayload(buf,it.contentType||'',4*1048576):null;
  const record={url:it.url,kind:it.kind,finalUrl:it.finalUrl||it.url,status:it.status,error:'',
   checkedAt:new Date().toISOString(),headers:it.headers||{},viaBrowser:true,
   attempts:[{method:'GET',via:'browser',url:it.url,finalUrl:it.finalUrl||it.url,status:it.status,error:'',bytes:buf.length,sha256:sha(buf),checkedAt:new Date().toISOString()}],
   bytes:buf.length,cap:262144,truncated:false,sha256:sha(buf),artifact:key+'.bin',html,
   entries,links:[],excerpt:R.sanitize(text.slice(0,18000)),parsed};
  fs.writeFileSync(path.join(RAW,key+'.json'),JSON.stringify(record,null,2));
  const existing=obs.find(x=>x.kind===it.kind&&x.url===it.url);
  if(existing){
   for(const c of it.ccns||[])if(!existing.ccns.includes(c))existing.ccns.push(c);
   if(!existing.roles.includes('browser-fetch'))existing.roles.push('browser-fetch');
   existing.retrieval=record;
  } else obs.push({url:it.url,kind:it.kind,ccns:it.ccns||[],roles:['browser-fetch'],retrieval:record});
 }
 fs.writeFileSync(path.join(OUT,'retrieval-results.json'),JSON.stringify(obs,null,2));
 console.log('Staged '+items.length+' browser fetches; total retrievals '+obs.length);
}
if(require.main===module)main(process.argv[2]).catch(e=>{console.error(e);process.exitCode=1;});
module.exports={main};
