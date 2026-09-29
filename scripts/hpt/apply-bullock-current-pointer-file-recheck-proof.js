'use strict';
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../..'),audit=path.join(root,'data/hpt-audit');
const proofName='reconciliation-bullock-current-pointer-file-recheck-proof-2026-09-25.json';
const p=JSON.parse(fs.readFileSync(path.join(audit,proofName),'utf8'));
const fp=path.join(audit,'reconciliation-manual-access-observations.json');
const doc=JSON.parse(fs.readFileSync(fp,'utf8'));
for(const ccn of ['010110','010779']){
  const i=doc.records.findIndex(x=>x.ccn===ccn); if(i<0) throw new Error('missing CCN '+ccn);
  const prior=doc.records[i];
  doc.records[i]={...prior,latest_current_pointer_file_recheck_2026_09_25:{proof_file:proofName,observed_at:p.observed_at,official_site:p.official_site,pointer_url:p.pointer_url,pointer_redirect_status:p.pointer_redirect_status,pointer_final_url:p.pointer_final_url,pointer_status:p.pointer_status,pointer_bytes:p.pointer_bytes,pointer_sha256:p.pointer_sha256,mrf_url:p.mrf_url,mrf_status:p.mrf_status,mrf_sample_bytes:p.mrf_sample_bytes,mrf_sample_sha256:p.mrf_sample_sha256,mrf_total_bytes:p.mrf_total_bytes,interpretation:p.interpretation,disposition:ccn==='010110'?p.disposition_010110:p.disposition_010779}};
}
doc.records.sort((a,b)=>a.ccn.localeCompare(b.ccn)); fs.writeFileSync(fp,JSON.stringify(doc,null,2)+'\n'); console.log(JSON.stringify({updated:['010110','010779'],proof:proofName},null,2));
