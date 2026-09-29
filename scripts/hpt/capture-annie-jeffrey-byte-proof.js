'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {retrieve}=require('./lib/recovery-transport');
const root=path.resolve(__dirname,'../..'),url='http://www.ajhc.org/476000710_annie-jeffrey-memorial-county-health-center_standardcharges.csv';
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
async function main(){
 const r=await retrieve(url,262144,{timeoutMs:30000}),b=r.body,d=sha(b);
 if(!(r.status>=200&&r.status<300)||b.length!==262144||d!=='29995e2f028dc190672a02cda86e2c4d3ce5a0bf07d671a6aab4428292888b4d')throw Error(`Annie Jeffrey changed: ${r.status} ${b.length} ${d}`);
 const t=b.toString('utf8');if(!t.includes('ANNIE JEFFREY MEMORIAL COUNTY HEALTH CENTER')||!t.includes('531 BEEBE ST'))throw Error('Annie Jeffrey identity changed');
 const rel=`cms_data/hpt/nationwide-verification/file-byte-proof/${d}.bin`,ap=path.join(root,rel);fs.mkdirSync(path.dirname(ap),{recursive:true});if(fs.existsSync(ap)&&sha(fs.readFileSync(ap))!==d)throw Error('Existing artifact changed');if(!fs.existsSync(ap))fs.writeFileSync(ap,b);
 const lp=path.join(root,'data/hpt-audit/nationwide-file-byte-proof.json'),l=JSON.parse(fs.readFileSync(lp,'utf8'));l.records=l.records.filter(x=>!(x.ccns||[]).includes('281314'));l.records.push({url,ccns:['281314'],checked_at:'2026-09-25T10:52:00Z',final_url:r.finalUrl||url,http_status:r.status,requested_range:'bytes=0-262143',bytes_retained:b.length,sha256:d,raw_artifact:rel,content_type:'text/csv',parsed_root_candidates:[{member:'',fileKind:'csv',innerKind:'csv',declaredLastUpdated:'2025-11-25',cmsVersion:'2.0.0',mrfHospitalName:'ANNIE JEFFREY MEMORIAL COUNTY HEALTH CENTER',mrfLocationName:'ANNIE JEFFREY MEMORIAL COUNTY HEALTH CENTER',mrfAddress:'531 BEEBE ST, PO BOX 428, OSCEOLA, NE, 68651',mrfLicenseState:'NE'}],error:'',final_host:'www.ajhc.org'});l.records.sort((a,b)=>String(a.url).localeCompare(String(b.url)));fs.writeFileSync(lp,JSON.stringify(l,null,2)+'\n');console.log(JSON.stringify({ccn:'281314',bytes:b.length,sha256:d,artifact:rel}));
}
main().catch(e=>{console.error(e.stack||e);process.exitCode=1});
