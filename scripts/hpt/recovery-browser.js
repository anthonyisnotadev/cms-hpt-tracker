'use strict';
// Import observations made through the connected browser tool. Browser DOM
// evidence supplies leads; native verification still controls file assignment.
const fs=require('fs'),path=require('path');
const R=require('./recovery-run');
const {safeUrl}=require('./lib/recovery-transport');
const {strongAddressAgreement}=require('./lib/mrf-header-match');
const {normalizeName}=require('./lib/util');
function validateObservation(o){
 if(!o||!o.domain||!o.checkedAt||!['page-read','access-denied','tool-unavailable','navigation-failed'].includes(o.outcome)||!Array.isArray(o.visited)||o.visited.length>8||!Array.isArray(o.links))throw new Error('Invalid browser observation');
 for(const url of o.visited)safeUrl(url);
 for(const l of o.links){safeUrl(l.url);if(!o.visited.includes(l.sourcePageUrl))throw new Error('Unobserved browser link source');}
 return o;
}
async function main(){
 const file=process.argv[2];if(!file)throw new Error('Supply browser observations JSON');
 const observations=R.read(path.resolve(file)).map(validateObservation),discoveries=R.read(path.join(R.STAGE,'discoveries.json')),refs=R.read(path.join(R.STAGE,'refs.json'));
 const cohort=R.inventory(),old=R.csv(path.join(R.PRIOR,'file-evidence.csv'));
 for(const o of observations){
  const d=discoveries[o.domain];if(!d)continue;
  if(o.officialIdentity){
   const h=R.read(path.join(R.ROOT,'cms_data/hpt/roster.json')).find(r=>r.ccn===o.ccn);
   const proof=o.officialIdentity;
   if(!h||!o.visited.includes(proof.sourcePageUrl)||normalizeName(h.name)!==normalizeName(proof.name)||!strongAddressAgreement(h.address,proof.address)||!proof.address.includes(String(h.zip).slice(0,5)))throw new Error('Browser official identity does not match roster');
   d.docs.push(await R.document(new URL('/cms-hpt.txt',proof.sourcePageUrl).href));
  }
  for(const pageUrl of o.visited){const links=o.links.filter(l=>l.sourcePageUrl===pageUrl).map(l=>({url:l.url,label:R.sanitize(l.label||'')}));
   if(!links.length)continue;
   const page=await R.document(pageUrl);d.docs.push({...page,links:[...page.links,...links],browserObservedAt:o.checkedAt});
  }
  for(const r of cohort.filter(r=>r.base.domain===o.domain)){
   refs[r.ccn]=R.refsFor(r,d,old);for(const ref of refs[r.ccn])await R.probe(ref.url);
  }
 }
 R.json(path.join(R.STAGE,'browser-observations.json'),observations);R.json(path.join(R.STAGE,'discoveries.json'),discoveries);R.json(path.join(R.STAGE,'refs.json'),refs);R.report();
}
if(require.main===module)main().catch(e=>{console.error(e);process.exitCode=1;});
module.exports={validateObservation};
