'use strict';
// Search snippets supply leads only; fresh official pages and file evidence
// still pass the same independent promotion gate as the free stage.
const fs=require('fs'),path=require('path'),R=require('./recovery-run');
const {safeUrl}=require('./lib/recovery-transport');
const {normalizeName}=require('./lib/util');
async function main(){
 const leads=R.read(path.join(R.STAGE,'web-search-results.json'));
 const discoveries=R.read(path.join(R.STAGE,'discoveries.json')),refs=R.read(path.join(R.STAGE,'refs.json'));
 const roster=new Map(R.read(path.join(R.ROOT,'cms_data/hpt/roster.json')).map(r=>[r.ccn,r]));
 for(const r of R.inventory().filter(r=>leads[r.ccn]?.length)){
  const done=path.join(R.STAGE,'search-import-'+r.ccn+'.json');if(fs.existsSync(done))continue;
  const d=discoveries[r.base.domain],observations=[],queue=leads[r.ccn].filter(l=>l.url).slice(0,3).map(l=>({url:safeUrl(l.url),depth:0})),seen=new Set(),started=Date.now();
  while(queue.length&&seen.size<8&&Date.now()-started<300000){
   const job=queue.shift();if(seen.has(job.url)||job.depth>3)continue;seen.add(job.url);
   const page=await R.document(job.url),host=new URL(page.finalUrl||page.url).hostname.replace(/^www\./,'');
   const target=roster.get(r.ccn),text=normalizeName(page.text||'');
   const same=host===r.base.domain.replace(/^www\./,''),official=same||(text.includes(normalizeName(target.address))&&text.includes(normalizeName(target.city))&&text.includes(normalizeName(r.hospital_name)));
   const observation={url:page.url,finalUrl:page.finalUrl,status:page.status,checkedAt:page.checkedAt,sha256:page.sha256,officialRelationship:official?'corroborated-page':'lead-only'};observations.push(observation);
   d.docs.push({...page,entries:official?page.entries:[],searchObserved:true});
   if(official&&job.depth<3){queue.push({url:new URL('/cms-hpt.txt',page.finalUrl||page.url).href,depth:job.depth+1});
    for(const link of page.links.filter(l=>/cms-hpt\.txt|price.?transparen|standard.?charg/i.test(l.url+' '+l.label)).slice(0,3))queue.push({url:link.url,depth:job.depth+1});
   }
  }
  d.docs=[...new Map(d.docs.map(x=>[x.url,x])).values()];refs[r.ccn]=R.refsFor(r,d,R.csv(path.join(R.PRIOR,'file-evidence.csv')));
  for(const ref of refs[r.ccn])await R.probe(ref.url);
  R.json(path.join(R.STAGE,'discoveries.json'),discoveries);R.json(path.join(R.STAGE,'refs.json'),refs);R.json(done,{ccn:r.ccn,searches:leads[r.ccn],observations,completedAt:new Date().toISOString()});console.log('search verification '+r.ccn);
 }
 R.report();
}
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
