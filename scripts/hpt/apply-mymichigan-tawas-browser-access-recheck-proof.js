'use strict';
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../..'),audit=path.join(root,'data/hpt-audit');
const proofName='reconciliation-mymichigan-tawas-browser-access-recheck-proof-2026-09-25.json';
const p=JSON.parse(fs.readFileSync(path.join(audit,proofName),'utf8'));
const fp=path.join(audit,'reconciliation-manual-access-observations.json'); const doc=JSON.parse(fs.readFileSync(fp,'utf8'));
const i=doc.records.findIndex(x=>x.ccn===p.ccn); if(i<0) throw new Error('missing '+p.ccn); const prior=doc.records[i];
doc.records[i]={...prior,latest_browser_access_recheck_2026_09_25:{proof_file:proofName,observed_at:p.observed_at,official_facility_page:p.official_facility_page,official_pricing_page:p.official_pricing_page,page_file_url:p.page_file_url,browser_status:p.browser_status,browser_result:p.browser_result,browser_surface:p.browser_surface,pointer_url:p.pointer_url,pointer_status:p.pointer_status,interpretation:p.interpretation,disposition:p.disposition},next_action:p.next_action};
doc.records.sort((a,b)=>a.ccn.localeCompare(b.ccn)); fs.writeFileSync(fp,JSON.stringify(doc,null,2)+'\n'); console.log(JSON.stringify({updated:p.ccn,disposition:p.disposition},null,2));
