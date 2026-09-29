'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {retrieve}=require('./lib/recovery-transport');
const root=path.resolve(__dirname,'../..');
const url='https://ce2ea91a-ba41-4498-ab16-2bae48bc8556.usrfiles.com/ugd/ce2ea9_229d2d077ea74cf6a45992ffbb655715.csv';
const expected={bytes:262144,sha256:'33669a00c5d3331929c09384a7c26edbd2721dcf7b1d88caea1581958221facb'};
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
async function main(){
  const r=await retrieve(url,expected.bytes,{timeoutMs:60000}),b=r.body,d=sha(b);
  if(r.status!==206||b.length!==expected.bytes||d!==expected.sha256) throw Error(`Bullock sample changed: ${r.status} ${b.length} ${d}`);
  const text=b.toString('utf8');
  if(!text.includes('hospital_name,last_updated_on,version')||!text.includes('Bullock County Hospital,11/24/2024,2.0.0')||!text.includes('102 Conecuh Avenue West, Union Springs, AL 36089')||!text.includes('license_number|CA')) throw Error('Bullock identity/metadata fields missing');
  const rel=`cms_data/hpt/nationwide-verification/file-byte-proof/${d}.bin`,ap=path.join(root,rel);fs.mkdirSync(path.dirname(ap),{recursive:true});
  if(fs.existsSync(ap)&&sha(fs.readFileSync(ap))!==d) throw Error('Existing artifact changed'); if(!fs.existsSync(ap)) fs.writeFileSync(ap,b);
  const lp=path.join(root,'data/hpt-audit/nationwide-file-byte-proof.json'),l=JSON.parse(fs.readFileSync(lp,'utf8'));
  l.records=l.records.filter(x=>!(x.ccns||[]).some(c=>['010110','010779'].includes(c)));
  l.records.push({url,ccns:['010779'],checked_at:'2026-09-25T16:45:00Z',final_url:r.finalUrl||url,http_status:r.status,requested_range:'header-sample-262144',bytes_retained:b.length,sha256:d,raw_artifact:rel,content_type:'text/csv',parsed_root_candidates:[{fileKind:'csv',innerKind:'csv',declaredLastUpdated:'2024-11-24',cmsVersion:'2.0.0',mrfHospitalName:'Bullock County Hospital',mrfLocationName:'Bullock County Hospital',mrfAddress:'102 Conecuh Avenue West, Union Springs, AL 36089',mrfLicenseState:'CA'}],error:'',final_host:'usrfiles.com'});
  l.records.sort((a,b)=>String(a.url).localeCompare(String(b.url)));fs.writeFileSync(lp,JSON.stringify(l,null,2)+'\n');console.log(JSON.stringify({ccn:'010779',bytes:b.length,sha256:d,artifact:rel}));
}
main().catch(e=>{console.error(e.stack||e);process.exitCode=1});
