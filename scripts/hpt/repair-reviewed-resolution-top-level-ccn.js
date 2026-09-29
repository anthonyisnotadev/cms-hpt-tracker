'use strict';
const fs=require('node:fs'),path=require('node:path');
const p=path.resolve(__dirname,'../../data/hpt-audit/reviewed-resolutions.json');
const raw=JSON.parse(fs.readFileSync(p,'utf8')); const arr=Array.isArray(raw)?raw:(raw.records||[]); let changed=0;
for(const r of arr){if(!r.ccn && r.base && r.base.ccn){r.ccn=r.base.ccn; changed++;}}
const out=Array.isArray(raw)?arr:{...raw,records:arr}; const tmp=path.join(require('node:os').tmpdir(),'reviewed-resolutions-ccn-'+Date.now()+'.json'); fs.writeFileSync(tmp,JSON.stringify(out,null,2)+'\n'); fs.renameSync(tmp,p); console.log(JSON.stringify({changed},null,2));
