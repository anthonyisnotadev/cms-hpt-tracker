'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {retrieve}=require('./lib/recovery-transport');
const root=path.resolve(__dirname,'../..');
const url='https://fcphd.org/910879683_Ferry-County-Health_standardcharges.csv';
const expected={bytes:7690618,sha256:'def48d54a03626e21dfc0519916086aeb61e08e02ab148fb2d38e2dbf3cc5acc'};
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
async function main(){
  const r=await retrieve(url,expected.bytes,{timeoutMs:120000}),b=r.body,d=sha(b);
  if(!(r.status>=200&&r.status<300)||b.length!==expected.bytes||d!==expected.sha256) throw Error(`Ferry file changed: ${r.status} ${b.length} ${d}`);
  const rel=`cms_data/hpt/nationwide-verification/file-byte-proof/${d}.bin`,ap=path.join(root,rel);
  fs.mkdirSync(path.dirname(ap),{recursive:true});
  if(fs.existsSync(ap)&&sha(fs.readFileSync(ap))!==d) throw Error('Existing artifact changed');
  if(!fs.existsSync(ap)) fs.writeFileSync(ap,b);
  const lp=path.join(root,'data/hpt-audit/nationwide-file-byte-proof.json'),l=JSON.parse(fs.readFileSync(lp,'utf8'));
  l.records=l.records.filter(x=>!(x.ccns||[]).includes('501322'));
  l.records.push({url,ccns:['501322'],checked_at:'2026-09-25T16:00:00Z',final_url:r.finalUrl||url,http_status:r.status,requested_range:'complete-csv',bytes_retained:b.length,sha256:d,raw_artifact:rel,content_type:'text/csv',parsed_root_candidates:[{fileKind:'csv',innerKind:'csv',declaredLastUpdated:'2025-07-01',cmsVersion:'2.0.0',mrfHospitalName:'Ferry County Health Republic Hospital',mrfLocationName:'Ferry County Health Republic Hospital',mrfAddress:'36 N Klondike Rd, Republic, WA 99166',mrfLicenseState:'WA'}],error:'',final_host:'fcphd.org'});
  l.records.sort((a,b)=>String(a.url).localeCompare(String(b.url)));fs.writeFileSync(lp,JSON.stringify(l,null,2)+'\n');
  console.log(JSON.stringify({ccn:'501322',bytes:b.length,sha256:d,artifact:rel}));
}
main().catch(e=>{console.error(e.stack||e);process.exitCode=1});
