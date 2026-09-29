'use strict';
const fs=require('node:fs'),path=require('node:path');
const audit=path.resolve(__dirname,'../../data/hpt-audit');
const file=path.join(audit,'reconciliation-manual-access-observations.json');
const data=JSON.parse(fs.readFileSync(file,'utf8'));
for(const row of data.records){
  if(row.ccn==='291301' || row.ccn==='370203') row.observed_at=row.page_observed_at;
}
fs.writeFileSync(file,JSON.stringify(data,null,2)+'\n');
console.log(JSON.stringify({repaired:['291301','370203']}));
