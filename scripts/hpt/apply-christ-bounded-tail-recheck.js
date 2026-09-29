'use strict';
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../..'),audit=path.join(root,'data/hpt-audit');
const proofName='reconciliation-christ-hospital-current-file-header-proof-2026-09-21.json';
const p=JSON.parse(fs.readFileSync(path.join(audit,proofName),'utf8'));
const file=path.join(audit,'reconciliation-manual-access-observations.json'); const doc=JSON.parse(fs.readFileSync(file,'utf8')); const old=doc.records.find(r=>r.ccn===p.ccn); if(!old) throw new Error('missing manual observation');
const rec={...old,observed_at:'2026-09-23T14:30:00Z',proof_file:proofName,bounded_tail_retrieval:p.bounded_tail_retrieval,publisher_content_length:p.publisher_content_length,publisher_etag:p.publisher_etag,disposition:'pointer-linked-file-review-pending',interpretation:p.interpretation,next_action:p.next_action}; doc.records=doc.records.filter(r=>r.ccn!==p.ccn); doc.records.push(rec); doc.records.sort((a,b)=>a.ccn.localeCompare(b.ccn)); fs.writeFileSync(file,JSON.stringify(doc,null,2)+'\n'); console.log(JSON.stringify({updated:p.ccn,tail_bytes:p.bounded_tail_retrieval.bytes},null,2));
