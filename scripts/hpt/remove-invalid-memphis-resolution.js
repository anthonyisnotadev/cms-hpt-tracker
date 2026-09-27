'use strict';
const fs=require('node:fs'),path=require('node:path');
const file=path.resolve(__dirname,'../../data/hpt-audit/reviewed-resolutions.json');
const rows=JSON.parse(fs.readFileSync(file,'utf8')).filter(r=>r.ccn!=='444001');
fs.writeFileSync(file,JSON.stringify(rows,null,2)+'\n');
console.log(JSON.stringify({removed:'444001',remaining:rows.length}));
