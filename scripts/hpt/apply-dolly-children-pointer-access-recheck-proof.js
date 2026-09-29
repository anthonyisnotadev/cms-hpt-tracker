'use strict';
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../..'),audit=path.join(root,'data/hpt-audit');
const proofName='reconciliation-dolly-children-pointer-access-recheck-proof-2026-09-25.json';
const p=JSON.parse(fs.readFileSync(path.join(audit,proofName),'utf8'));
const fp=path.join(audit,'reconciliation-manual-access-observations.json'); const doc=JSON.parse(fs.readFileSync(fp,'utf8'));
const i=doc.records.findIndex(x=>x.ccn===p.ccn); if(i<0) throw new Error('missing '+p.ccn); const prior=doc.records[i];
doc.records[i]={...prior,latest_publisher_transition_access_recheck_2026_09_25:{proof_file:proofName,observed_at:p.observed_at,publisher_change_reason:p.publisher_change_reason,current_official_domain:p.current_official_domain,current_pointer_url:p.current_pointer_url,current_pointer_browser_result:p.current_pointer_browser_result,current_pointer_direct_status:p.current_pointer_direct_status,legacy_file_url:p.legacy_file_url,legacy_file_direct_status:p.legacy_file_direct_status,legacy_file_content_type:p.legacy_file_content_type,legacy_file_response_bytes:p.legacy_file_response_bytes,interpretation:p.interpretation,disposition:p.disposition},next_action:p.next_action};
doc.records.sort((a,b)=>a.ccn.localeCompare(b.ccn)); fs.writeFileSync(fp,JSON.stringify(doc,null,2)+'\n'); console.log(JSON.stringify({updated:p.ccn,disposition:p.disposition},null,2));
