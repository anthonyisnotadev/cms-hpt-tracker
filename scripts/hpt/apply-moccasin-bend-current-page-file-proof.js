'use strict';
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../..'),audit=path.join(root,'data/hpt-audit');
const proofName='reconciliation-moccasin-bend-current-page-file-proof-2026-09-22.json';
const p=JSON.parse(fs.readFileSync(path.join(audit,proofName),'utf8'));
const manualPath=path.join(audit,'reconciliation-manual-access-observations.json'),manual=JSON.parse(fs.readFileSync(manualPath,'utf8'));manual.records=manual.records.filter(r=>r.ccn!==p.ccn);manual.records.push({...p,proof_file:proofName});manual.records.sort((a,b)=>a.ccn.localeCompare(b.ccn));fs.writeFileSync(manualPath,JSON.stringify(manual,null,2)+'\n');
console.log(JSON.stringify({applied:p.ccn,finding:p.disposition,bytes:p.mrf_total_bytes},null,2));
