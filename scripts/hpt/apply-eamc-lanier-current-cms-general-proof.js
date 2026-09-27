'use strict';
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../..'),audit=path.join(root,'data/hpt-audit');
const proofName='reconciliation-eamc-lanier-current-cms-general-proof-2026-09-25.json';
const p=JSON.parse(fs.readFileSync(path.join(audit,proofName),'utf8'));
const f=path.join(audit,'reconciliation-manual-access-observations.json'); const d=JSON.parse(fs.readFileSync(f,'utf8')); const old=d.records.find(r=>r.ccn===p.ccn); if(!old) throw new Error('missing manual observation');
const rec={...old,observed_at:p.observed_at,proof_file:proofName,cms_general_recheck:p.cms_record,cms_general_query_url:p.cms_query_url,cms_general_response_sha256:p.response_sha256,latest_cms_reh_identity_recheck:{observed_at:p.observed_at,query_url:p.cms_query_url,response_bytes:p.response_bytes,response_sha256:p.response_sha256,record:p.cms_record,disposition:p.disposition},disposition:p.disposition,interpretation:p.interpretation,next_action:p.next_action};
d.records=d.records.filter(r=>r.ccn!==p.ccn); d.records.push(rec); d.records.sort((a,b)=>a.ccn.localeCompare(b.ccn)); fs.writeFileSync(f,JSON.stringify(d,null,2)+'\n'); console.log(JSON.stringify({updated:p.ccn,disposition:p.disposition},null,2));
