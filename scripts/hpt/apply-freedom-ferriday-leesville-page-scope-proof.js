'use strict';
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../..'),audit=path.join(root,'data/hpt-audit');
const proofName='reconciliation-freedom-ferriday-leesville-current-page-scope-proof-2026-09-25.json';
const p=JSON.parse(fs.readFileSync(path.join(audit,proofName),'utf8'));
const f=path.join(audit,'reconciliation-manual-access-observations.json'); const d=JSON.parse(fs.readFileSync(f,'utf8'));
for(const ccn of p.ccns){const old=d.records.find(r=>r.ccn===ccn); if(!old) throw new Error('missing manual observation '+ccn); const rec={...old,observed_at:p.observed_at,proof_file:proofName,official_price_page:p.price_page_url,official_price_page_status:p.price_page_status,official_price_page_bytes:p.price_page_bytes,official_price_page_sha256:p.price_page_sha256,listed_facilities:p.listed_facilities,listed_standard_charge_links:p.listed_standard_charge_links,omitted_facility_specific_files:p.omitted_facilities,disposition:p.disposition,interpretation:p.interpretation,next_action:p.next_action}; d.records=d.records.filter(r=>r.ccn!==ccn); d.records.push(rec);}
d.records.sort((a,b)=>a.ccn.localeCompare(b.ccn)); fs.writeFileSync(f,JSON.stringify(d,null,2)+'\n'); console.log(JSON.stringify({updated:p.ccns,disposition:p.disposition},null,2));
