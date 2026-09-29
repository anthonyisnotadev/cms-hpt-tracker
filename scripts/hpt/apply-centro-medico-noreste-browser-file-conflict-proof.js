'use strict';
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../..'),audit=path.join(root,'data/hpt-audit');
const proofName='reconciliation-centro-medico-noreste-browser-file-conflict-proof-2026-09-22.json';
const p=JSON.parse(fs.readFileSync(path.join(audit,proofName),'utf8'));
const fp=path.join(audit,'reconciliation-manual-access-observations.json');
const doc=JSON.parse(fs.readFileSync(fp,'utf8'));
const rec={ccn:p.ccn,observed_at:p.observed_at,proof_file:proofName,official_pricing_page:p.official_pricing_page,official_pricing_page_status:p.official_pricing_page_status,official_page_observation:p.official_page_observation,official_identity_page:p.official_identity_page,cms_pointer_url:p.cms_pointer_url,cms_pointer_result:p.cms_pointer_result,mrf_url:p.mrf_url,mrf_status:p.mrf_status,mrf_response_bytes:p.mrf_response_bytes,mrf_response_sha256:p.mrf_response_sha256,official_facility_name:'Centro Médico del Noreste',official_facility_address:'Ave. Osvaldo Molina #151, Fajardo, PR 00738',cms_api_url:p.cms_api_url,cms_api_status:p.cms_api_status,cms_api_response_bytes:p.cms_api_response_bytes,cms_api_response_sha256:p.cms_api_response_sha256,cms_record:p.cms_record,disposition:p.disposition,interpretation:p.interpretation,next_action:p.next_action};
doc.records=doc.records.filter(x=>x.ccn!==p.ccn); doc.records.push(rec); doc.records.sort((a,b)=>a.ccn.localeCompare(b.ccn)); fs.writeFileSync(fp,JSON.stringify(doc,null,2)+'\n'); console.log(JSON.stringify({updated:p.ccn,disposition:p.disposition},null,2));
