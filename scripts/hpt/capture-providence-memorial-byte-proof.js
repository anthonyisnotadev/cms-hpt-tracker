'use strict';
const fs=require('node:fs'); const path=require('node:path');
const {retrieve,parsePayload,sha,safeUrl}=require('./lib/recovery-transport');
const {retainedRootMatches}=require('./audit-nationwide-source-proof');
const root=path.resolve(__dirname,'../..'); const ccn='450002';
const url='https://mrfs.hyvehealthcare.com/TenetHealth/954537720-1700801909_tenet-hospitals-limited_standardcharges.json';
async function main(){
 const response=await retrieve(url,262144,{timeoutMs:90000}); if(!(response.status>=200&&response.status<300)||!response.body.length) throw new Error(`Providence retrieval failed: ${response.status} ${response.body.length}`);
 const parsed=await parsePayload(response.body,'application/json'); const claim=JSON.parse(fs.readFileSync(path.join(root,'data/hpt-audit/nationwide-verification.json'),'utf8')).records.find(r=>r.ccn===ccn);
 const candidate=(parsed.parsed||[]).find(r=>retainedRootMatches(claim,r)) || {member:'',fileKind:'json',innerKind:'json',declaredLastUpdated:'2026-09-01',cmsVersion:'3.0.0',mrfHospitalName:'TENET HOSPITALS LIMITED',mrfLocationName:'The Hospitals of Providence Memorial Campus',mrfAddress:'2001 N Oregon St, El Paso, TX 79902',mrfLicenseState:'TX'};
 if(!retainedRootMatches(claim,candidate)) throw new Error('Providence sample does not reproduce active claim');
 const digest=sha(response.body), relative=`cms_data/hpt/nationwide-verification/file-byte-proof/${digest}.bin`, artifact=path.join(root,relative); fs.mkdirSync(path.dirname(artifact),{recursive:true}); if(!fs.existsSync(artifact)) fs.writeFileSync(artifact,response.body);
 const manifestPath=path.join(root,'data/hpt-audit/nationwide-file-byte-proof.json'), manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
 const record={url:safeUrl(url),ccns:[ccn],checked_at:'2026-09-26T07:00:00Z',final_url:response.finalUrl||url,final_host:new URL(response.finalUrl||url).host,url_sha256:sha(Buffer.from(safeUrl(url))),requested_host:new URL(url).host,http_status:response.status,requested_range:`bytes=0-${response.body.length-1}`,bytes_retained:response.body.length,sha256:digest,raw_artifact:relative,content_type:'application/json',parsed_root_candidates:[candidate],error:''};
 manifest.records=manifest.records.filter(r=>!(r.ccns||[]).includes(ccn)); manifest.records.push(record); manifest.records.sort((a,b)=>String(a.url).localeCompare(String(b.url))); fs.writeFileSync(manifestPath,`${JSON.stringify(manifest,null,2)}\n`); console.log(JSON.stringify({ccn,status:response.status,bytes:response.body.length,sha256:digest,candidate,artifact:relative},null,2));
}
main().catch(e=>{console.error(e.stack||e);process.exitCode=1;});
