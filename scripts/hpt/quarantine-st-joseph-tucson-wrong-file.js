'use strict';
const fs=require('fs'),path=require('path');const {csvToObjects}=require('./lib/util');
const root=path.resolve(__dirname,'../..'),audit=path.join(root,'data/hpt-audit');
const base=csvToObjects(fs.readFileSync(path.join(audit,'compliance.csv'),'utf8')).find(r=>r.ccn==='030011');
const p=path.join(audit,'reviewed-resolutions.json'),ledger=JSON.parse(fs.readFileSync(p,'utf8'));
if(!base||base.mrf_url.indexOf('st-josephs-westgate-medical-center')<0)throw Error('Changed base');
const entry={ccn:'030011',base,action:'quarantine',official:{domain:'carondelet.org'},evidence:{checked_at:'2026-09-17T16:49:31.000Z',identity:'conflict',identityPageUrl:'https://www.carondelet.org/locations/detail/st-josephs-hospital',pointerUrl:'https://www.commonspirit.org/cms-hpt.txt',url:base.mrf_url,declared_address:'7300 N 99th Ave, Glendale, AZ 85305'},evidence_run:'st-joseph-tucson-westgate-misattribution-2026-09-17',reviewed_at:'2026-09-17T16:49:31.000Z',note:'The assigned CommonSpirit file explicitly identifies St. Joseph’s Westgate Medical Center at 7300 N 99th Ave, Glendale AZ, not the roster’s St. Joseph’s Hospital in Tucson. Current Carondelet root, pricing and hospital-page requests returned 403 HTML to this client; that is an access observation, not file absence. The unrelated Westgate file is quarantined while a Tucson-specific current pointer/file remains required.'};
if(!ledger.some(r=>r.ccn==='030011')){ledger.push(entry);ledger.sort((a,b)=>a.ccn.localeCompare(b.ccn));fs.writeFileSync(p,JSON.stringify(ledger,null,2)+'\n');}console.log(JSON.stringify({ccn:'030011'}));
