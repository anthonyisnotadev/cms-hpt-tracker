'use strict';
const fs=require('node:fs'),path=require('node:path');
const {csvToObjects}=require('./lib/util');
const root=path.resolve(__dirname,'../..'),audit=path.join(root,'data/hpt-audit');
const names=['reconciliation-broward-north-current-page-file-proof-2026-09-22.json','reconciliation-broward-imperial-point-current-page-file-proof-2026-09-22.json','reconciliation-broward-coral-springs-current-page-file-proof-2026-09-22.json'];
const compliance=csvToObjects(fs.readFileSync(path.join(audit,'compliance.csv'),'utf8'));
const ledgerPath=path.join(audit,'reviewed-resolutions.json'),ledger=JSON.parse(fs.readFileSync(ledgerPath,'utf8'));
const manualPath=path.join(audit,'reconciliation-manual-access-observations.json'),manual=JSON.parse(fs.readFileSync(manualPath,'utf8'));
for(const proofName of names){
  const p=JSON.parse(fs.readFileSync(path.join(audit,proofName),'utf8')),base=compliance.find(r=>r.ccn===p.ccn)||{};
  const e={identity:'corroborated',identity_basis:'official-first-party-page-complete-current-csv-campus-name-address-state-date-version-npi',officialDomain:'browardhealth.org',sourcePageUrl:p.official_pricing_page,pointerUrl:p.pointer_url,pointerIssue:'root-pointer-http-error',pointerHttpStatus:p.pointer_http_status,pointerResponseContentType:'text/html',pointerSha256:p.pointer_sha256,url:p.mrf_url,http_status:p.mrf_status,checked_at:p.observed_at,date:p.declared_last_updated,version:p.cms_template_version,declared_hospital_name:p.declared_hospital_name,location_name:p.declared_location_name,declared_address:p.declared_address,facility_address:p.cms_record.address+', '+p.cms_record.citytown+', '+p.cms_record.state+' '+p.cms_record.zip_code,declared_license_state:p.declared_license_state,declared_license_number:p.declared_license_number,declared_npi:p.declared_npi,file_kind:'csv',fileSha256:p.mrf_response_sha256.toLowerCase(),bytesRetained:p.mrf_response_bytes,fullFileBytes:p.mrf_total_bytes,retainedSampleBytes:p.mrf_response_bytes,etag:p.mrf_etag,lastModified:p.mrf_last_modified,attestationPresent:true,cmsRecord:p.cms_record,observedFinding:'official-page-mrf-root-pointer-unavailable'};
  const entry={ccn:p.ccn,base,action:'replace',finding:'verified-current-mrf',evidence:e,evidence_run:'broward-campus-current-page-file-bounded-header-2026-09-22',reviewed_at:p.observed_at,note:'The official Broward Health campus page links a facility-specific current CSV. Its bounded header identifies the named campus, Florida, CMS 3.0.0, 2026-09-15 and matching CMS address/NPI. The range response preserves total-byte, ETag and last-modified metadata. The shared root pointer returned a documented 403, so this is observed page-linked evidence and not a legal compliance conclusion.'};
  const i=ledger.findIndex(r=>r.ccn===p.ccn); if(i>=0) ledger[i]=entry; else ledger.push(entry);
  const rec={...p,proof_file:proofName,disposition:'verified-current-page-file-root-pointer-blocked',interpretation:p.interpretation,next_action:'Retry the shared root cms-hpt.txt pointer after the site security response changes; retain the campus file and any separately listed emergency-department address.'};
  manual.records=manual.records.filter(r=>r.ccn!==p.ccn); manual.records.push(rec);
  console.log(JSON.stringify({applied:p.ccn,finding:entry.finding,bytes:p.mrf_total_bytes}));
}
ledger.sort((a,b)=>a.ccn.localeCompare(b.ccn)); manual.records.sort((a,b)=>a.ccn.localeCompare(b.ccn));
fs.writeFileSync(ledgerPath,JSON.stringify(ledger,null,2)+'\n'); fs.writeFileSync(manualPath,JSON.stringify(manual,null,2)+'\n');
