'use strict';
const fs=require('node:fs'),path=require('node:path');
const p=path.resolve(__dirname,'../../data/hpt-audit/reviewed-resolutions.json');
const x=JSON.parse(fs.readFileSync(p,'utf8')); fs.writeFileSync(p,JSON.stringify(x.filter(r=>r.ccn!=='670120'),null,2)+'\n');
