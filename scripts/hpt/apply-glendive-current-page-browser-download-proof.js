'use strict';
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../..'),audit=path.join(root,'data/hpt-audit');
const proofName='reconciliation-glendive-current-page-browser-download-proof-2026-09-21.json';
const p=JSON.parse(fs.readFileSync(path.join(audit,proofName),'utf8'));
const fp=path.join(audit,'reconciliation-manual-access-observations.json');
const doc=JSON.parse(fs.readFileSync(fp,'utf8'));
const rec={ccn:p.ccn,observed_at:p.observed_at,proof_file:proofName,official_pricing_page:p.official_pricing_page,official_page_observation:p.official_pricing_page_browser_observation,official_facility_name:'Glendive Medical Center',official_facility_address:'202 Prospect Dr, Glendive, MT 59330',page_file_url:p.page_file_url,page_file_http_status:p.page_file_http_status,page_file_response_bytes:p.page_file_response_bytes,page_file_response_kind:p.page_file_response_kind,browser_download_result:p.browser_download_result,disposition:p.disposition,next_action:p.next_action};
doc.records=doc.records.filter(x=>x.ccn!==p.ccn); doc.records.push(rec); doc.records.sort((a,b)=>a.ccn.localeCompare(b.ccn)); fs.writeFileSync(fp,JSON.stringify(doc,null,2)+'\n'); console.log(JSON.stringify({updated:p.ccn,disposition:p.disposition},null,2));
