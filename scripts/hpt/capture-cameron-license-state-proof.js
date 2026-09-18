'use strict';
const crypto=require('crypto'),fs=require('fs'),path=require('path'),childProcess=require('child_process');
const root=path.resolve(__dirname,'../..'),audit=path.join(root,'data/hpt-audit');
const pointerUrl='https://www.cameronregional.org/cms-hpt.txt';
const pointerMrfUrl='https://www.cameronregional.org/440668347_cameron-regional-medical-center_standardcharges.csv';
const sourcePageUrl='https://www.cameronregional.org/price-transparency';
const mrfUrl='https://irp.cdn-website.com/87401228/files/uploaded/440668347_cameron-regional-medical-center_standardcharges-b094301b-664adbbd.csv';
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
async function get(url,headers={}){try{const response=await fetch(url,{headers});return{response,body:Buffer.from(await response.arrayBuffer())}}catch{const args=['-L','--fail','--silent','--show-error'];if(headers.Range)args.push('--range',headers.Range.replace(/^bytes=/,''));args.push(url);const body=childProcess.execFileSync('curl.exe',args,{maxBuffer:2*1024*1024});return{response:{ok:true,status:headers.Range?206:200,url},body}}}
(async()=>{const observedAt=new Date().toISOString(),pointer=await get(pointerUrl),page=await get(sourcePageUrl),file=await get(mrfUrl,{Range:'bytes=0-1048575'});
if(!pointer.response.ok||!page.response.ok||![200,206].includes(file.response.status))throw Error('Capture failed');
const pt=pointer.body.toString('utf8'),pg=page.body.toString('utf8'),ft=file.body.toString('utf8');
for(const token of ['Cameron Regional Medical Center',sourcePageUrl,pointerMrfUrl])if(!pt.includes(token))throw Error(`Pointer lacks ${token}`);
if(!pg.includes(mrfUrl))throw Error('Source page no longer links reviewed file');
for(const token of ['license_number|IN','440668347 | MO','CAMERON REGIONAL MEDICAL CENTER','1600 East Evergreen Street, Cameron, MO 64429','4/1/2026','2.0.0'])if(!ft.toLowerCase().includes(token.toLowerCase()))throw Error(`File lacks ${token}`);
const sample='cms_data/hpt/nationwide-verification/file-byte-proof/cameron-license-state-260057.bin';fs.writeFileSync(path.join(root,sample),file.body);
const proof={ccn:'260057',observed_at:observedAt,pointer_url:pointerUrl,pointer_http_status:pointer.response.status,pointer_sha256:sha(pointer.body),pointer_mrf_url:pointerMrfUrl,source_page_url:sourcePageUrl,source_page_sha256:sha(page.body),mrf_url:mrfUrl,mrf_http_status:file.response.status,mrf_final_url:file.response.url,retained_sample:sample,retained_bytes:file.body.length,mrf_sample_sha256:sha(file.body),declared_hospital_name:'CAMERON REGIONAL MEDICAL CENTER',declared_location_name:'CAMERON REGIONAL MEDICAL CENTER',declared_address:'1600 East Evergreen Street, Cameron, MO 64429',declared_license_state:'IN',license_value_state:'MO',facility_state:'MO',declared_date:'2026-04-01',version:'2.0.0'};
fs.writeFileSync(path.join(audit,'reconciliation-cameron-license-state-proof.json'),JSON.stringify(proof,null,2)+'\n');console.log(JSON.stringify({captured:proof.ccn,bytes:proof.retained_bytes},null,2));})().catch(e=>{console.error(e);process.exitCode=1});
