'use strict';
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../..'),audit=path.join(root,'data/hpt-audit');
const proofName='reconciliation-fort-duncan-browser-recheck-proof-2026-09-22.json';
const p=JSON.parse(fs.readFileSync(path.join(audit,proofName),'utf8'));
const fp=path.join(audit,'reconciliation-manual-access-observations.json');
const doc=JSON.parse(fs.readFileSync(fp,'utf8'));
const rec={ccn:p.ccn,observed_at:p.observed_at,proof_file:proofName,official_pricing_page:p.official_pricing_page,official_pricing_page_status:p.official_pricing_page_status,official_page_observation:p.official_page_observation,cms_pointer_url:p.cms_pointer_url,cms_pointer_result:p.cms_pointer_result,official_facility_name:'Fort Duncan Medical Center',official_facility_address:'3333 N Foster Maldonado Blvd, Eagle Pass, TX 78852',cms_api_url:p.cms_api_url,cms_api_status:p.cms_api_status,cms_api_response_bytes:p.cms_api_response_bytes,cms_api_response_sha256:p.cms_api_response_sha256,cms_record:p.cms_record,disposition:p.disposition,interpretation:p.interpretation,next_action:p.next_action};
doc.records=doc.records.filter(x=>x.ccn!==p.ccn); doc.records.push(rec); doc.records.sort((a,b)=>a.ccn.localeCompare(b.ccn)); fs.writeFileSync(fp,JSON.stringify(doc,null,2)+'\n'); console.log(JSON.stringify({updated:p.ccn,disposition:p.disposition},null,2));
