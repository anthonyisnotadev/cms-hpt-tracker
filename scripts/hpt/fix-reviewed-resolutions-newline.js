'use strict';
const fs=require('node:fs'),path=require('node:path');
const p=path.resolve(__dirname,'../../data/hpt-audit/reviewed-resolutions.json');
let s=fs.readFileSync(p,'utf8');
if(s.endsWith('\\n')) s=s.slice(0,-2)+'\n';
JSON.parse(s);
fs.writeFileSync(p,s);
console.log('fixed literal newline suffix');
