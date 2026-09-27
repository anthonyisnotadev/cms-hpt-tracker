'use strict';
const fs=require('node:fs'),path=require('node:path');
const {csvToObjects}=require('./lib/util');
const root=path.resolve(__dirname,'../..'),audit=path.join(root,'data/hpt-audit');
const proofName='reconciliation-broward-medical-center-current-page-file-proof-2026-09-22.json';
const p=JSON.parse(fs.readFileSync(path.join(audit,proofName),'utf8'));
const base=csvToObjects(fs.readFileSync(path.join(audit,'compliance.csv'),'utf8')).find(r=>r.ccn===p.ccn)||{};
const e={
  identity:'corroborated',
  identity_basis:'official-first-party-page-complete-current-csv-campus-name-address-state-date-version-npi',
  officialDomain:'browardhealth.org',
  sourcePageUrl:p.official_pricing_page,
  pointerUrl:p.pointer_url,
  pointerIssue:'root-pointer-http-error',
  pointerHttpStatus:p.pointer_http_status,
  pointerResponseContentType:'text/html',
  pointerSha256:p.pointer_sha256,
  url:p.mrf_url,
  http_status:p.mrf_status,
  checked_at:p.observed_at,
  date:p.declared_last_updated,
  version:p.cms_template_version,
  declared_hospital_name:p.declared_hospital_name,
  location_name:p.declared_location_name,
  declared_address:p.declared_address,
  facility_address:'1600 S Andrews Ave, Fort Lauderdale, FL 33316',
  declared_license_state:p.declared_license_state,
  declared_npi:p.declared_npi,
  file_kind:'csv',
  fileSha256:p.mrf_response_sha256.toLowerCase(),
  bytesRetained:p.mrf_response_bytes,
  fullFileBytes:p.mrf_total_bytes,
  retainedSampleBytes:p.mrf_response_bytes,
  etag:p.mrf_etag,
  lastModified:p.mrf_last_modified,
  attestationPresent:true,
  cmsRecord:p.cms_record,
  observedFinding:'official-page-mrf-root-pointer-unavailable'
};
const ledgerPath=path.join(audit,'reviewed-resolutions.json'),ledger=JSON.parse(fs.readFileSync(ledgerPath,'utf8'));
const entry={ccn:p.ccn,base,action:'replace',finding:'verified-current-mrf',evidence:e,evidence_run:'broward-medical-center-current-page-file-bounded-header-2026-09-22',reviewed_at:p.observed_at,note:'The official Broward Health page links a facility-specific current CSV. Its bounded header identifies Broward Health Medical Center, Florida, the CMS campus address, NPI, CMS 3.0.0 and 2026-09-15; the additional Sunrise emergency-department address is retained as a separate location. The 5,230,656,201-byte object was range-retrieved with stable ETag/last-modified metadata. The root pointer returned a documented 403 response, so this is observed page-linked evidence and not a legal compliance conclusion.'};
const i=ledger.findIndex(r=>r.ccn===p.ccn); if(i>=0) ledger[i]=entry; else ledger.push(entry); ledger.sort((a,b)=>a.ccn.localeCompare(b.ccn)); fs.writeFileSync(ledgerPath,JSON.stringify(ledger,null,2)+'\n');
const manualPath=path.join(audit,'reconciliation-manual-access-observations.json'),manual=JSON.parse(fs.readFileSync(manualPath,'utf8'));
const rec={...p,proof_file:proofName,disposition:'verified-current-page-file-root-pointer-blocked',interpretation:p.interpretation,next_action:'Retry the root cms-hpt.txt pointer after the site security response changes; retain this page-linked file evidence and the separate Sunrise emergency-department address.'};
manual.records=manual.records.filter(r=>r.ccn!==p.ccn); manual.records.push(rec); manual.records.sort((a,b)=>a.ccn.localeCompare(b.ccn)); fs.writeFileSync(manualPath,JSON.stringify(manual,null,2)+'\n');
console.log(JSON.stringify({applied:p.ccn,finding:entry.finding,bytes:p.mrf_total_bytes},null,2));
