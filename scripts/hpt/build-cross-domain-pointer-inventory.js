'use strict';
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../..'),audit=path.join(root,'data/hpt-audit');
const input=JSON.parse(fs.readFileSync(path.join(audit,'nationwide-verification.json'),'utf8'));
const host=url=>{try{return new URL(url).hostname.toLowerCase().replace(/^www\./,'')}catch{return ''}};
const records=input.records.filter(row=>{
  const official=String(row.official_domain||'').toLowerCase().replace(/^www\./,'');
  const pointer=host(row.standing_pointer_url);
  return official&&pointer&&official!==pointer;
}).map(row=>{
  const unresolved=!row.latest_observation_superseded&&[
    'mrf-facility-identity-unresolved','linked-mrf-header-unmatched','pointer-facility-match-unresolved',
    'mrf-request-unsuccessful','verified-template-review','verified-stale-mrf'
  ].includes(row.disposition);
  return {ccn:row.ccn,hospital_name:row.hospital_name,state:row.state,official_domain:row.official_domain,
    pointer_domain:host(row.standing_pointer_url),standing_pointer_url:row.standing_pointer_url,
    standing_mrf_url:row.standing_mrf_url,disposition:row.disposition,standing_finding:row.standing_finding,
    latest_observation_superseded:row.latest_observation_superseded,
    review_class:unresolved?'cross-domain-unresolved-review':'cross-domain-verified-or-superseded-review'};
}).sort((a,b)=>a.review_class.localeCompare(b.review_class)||a.state.localeCompare(b.state)||a.ccn.localeCompare(b.ccn));
const summary={generated_at:new Date().toISOString(),source:'data/hpt-audit/nationwide-verification.json',total:records.length,
  by_review_class:records.reduce((m,r)=>(m[r.review_class]=(m[r.review_class]||0)+1,m),{}),
  by_disposition:records.reduce((m,r)=>(m[r.disposition]=(m[r.disposition]||0)+1,m),{}),
  note:'A different pointer and recorded official domain is not itself an attribution failure: parent systems and legacy domains can legitimately publish a hospital MRF. The unresolved-review class requires facility-specific pointer/file/identity evidence before promotion or exclusion.'};
fs.writeFileSync(path.join(audit,'cross-domain-pointer-inventory.json'),JSON.stringify({summary,records},null,2)+'\n');
console.log(JSON.stringify(summary));
