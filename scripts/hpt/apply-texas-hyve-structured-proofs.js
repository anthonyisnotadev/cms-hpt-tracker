'use strict';
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../..'),audit=path.join(root,'data/hpt-audit');
const proofs=['reconciliation-memorial-hermann-surgical-hospital-kingwood-current-mrf-proof-2026-09-23.json','reconciliation-hospitals-of-providence-east-campus-current-mrf-proof-2026-09-23.json','reconciliation-westover-hills-baptist-hospital-current-mrf-proof-2026-09-23.json'].map(f=>JSON.parse(fs.readFileSync(path.join(audit,f),'utf8')));
const p=path.join(audit,'reconciliation-manual-access-observations.json'),doc=JSON.parse(fs.readFileSync(p,'utf8'));
for(const proof of proofs){const i=doc.records.findIndex(r=>r.ccn===proof.ccn);if(i<0)throw Error('missing '+proof.ccn);const m=proof.mrf_observation;doc.records[i]={...doc.records[i],facility_file_url:proof.mrf_url,file_status:m.http_status,file_bytes:m.bytes,file_sha256:m.sha256,declared_hospital_name:m.hospital_name,declared_location_name:m.location_name,declared_address:m.hospital_address,declared_license_state:m.license_state,declared_last_updated:m.last_updated_on,cms_template_version:m.cms_template_version,declared_npi:m.npi,attestation:m.attestation_confirmed===true,manual_identity_gate:'official-page-file-header-name-address-state-license-npi-agree'};}
doc.records.sort((a,b)=>a.ccn.localeCompare(b.ccn));
fs.writeFileSync(p,JSON.stringify(doc,null,2)+'\n');
console.log(JSON.stringify({updated:proofs.map(p=>p.ccn)}));
