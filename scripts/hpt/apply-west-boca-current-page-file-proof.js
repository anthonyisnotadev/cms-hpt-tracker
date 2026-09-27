'use strict';
const fs=require('node:fs'),path=require('node:path'); const root=path.resolve(__dirname,'../..'),audit=path.join(root,'data/hpt-audit');
const proofName='reconciliation-west-boca-current-page-file-proof-2026-09-22.json'; const p=JSON.parse(fs.readFileSync(path.join(audit,proofName),'utf8'));
const fp=path.join(audit,'reconciliation-manual-access-observations.json'); const doc=JSON.parse(fs.readFileSync(fp,'utf8'));
const rec={...p,proof_file:proofName}; doc.records=doc.records.filter(x=>x.ccn!==p.ccn); doc.records.push(rec); doc.records.sort((a,b)=>a.ccn.localeCompare(b.ccn)); fs.writeFileSync(fp,JSON.stringify(doc,null,2)+'\n'); console.log(JSON.stringify({applied:p.ccn,finding:p.disposition},null,2));
