'use strict';
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const root=path.resolve(__dirname,'../..'),audit=path.join(root,'data/hpt-audit');
const show=file=>JSON.parse(cp.execFileSync('git',['show',`HEAD:data/hpt-audit/${file}`],{cwd:root,encoding:'utf8',maxBuffer:64*1024*1024}));
const resolution=show('reviewed-resolutions.json').find(r=>r.ccn==='090004');
const ledgerPath=path.join(audit,'reviewed-resolutions.json'),ledger=JSON.parse(fs.readFileSync(ledgerPath,'utf8'));const i=ledger.findIndex(r=>r.ccn==='090004');if(i<0)ledger.push(resolution);else ledger[i]=resolution;ledger.sort((a,b)=>a.ccn.localeCompare(b.ccn));fs.writeFileSync(ledgerPath,JSON.stringify(ledger,null,2)+'\n');
const prior=show('reconciliation-manual-access-observations.json').records.find(r=>r.ccn==='090004');const mp=path.join(audit,'reconciliation-manual-access-observations.json'),m=JSON.parse(fs.readFileSync(mp,'utf8'));m.records=m.records.filter(r=>r.ccn!=='090004');m.records.push(prior);m.records.sort((a,b)=>a.ccn.localeCompare(b.ccn));fs.writeFileSync(mp,JSON.stringify(m,null,2)+'\n');console.log(JSON.stringify({restored:'090004',finding:resolution.finding,disposition:prior.disposition},null,2));
