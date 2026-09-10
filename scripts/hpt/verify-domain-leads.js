'use strict';
// Probe official-domain LEADS for the domain-unknown bucket. Leads come from
// prior discovery records and recorded web searches; nothing here trusts a lead.
// A lead only progresses when the domain serves a readable cms-hpt.txt whose
// entries name the roster facility, or when the homepage plainly names it.
const fs=require('fs'),path=require('path');
const R=require('./recovery-run');
const {pooled}=require('./lib/util');
const {distinctiveNameOverlap}=require('./lib/mrf-header-match');
const {sha}=require('./lib/recovery-transport');
const inv=require('./investigate-unresolved');
const {get,read,json}=inv;
const OUT=inv.OUT;
const ok=s=>s>=200&&s<300;
const FILE_LIKE=/\.(csv|json|zip|txt)(\?|$)|standardcharg/i;
const normUrl=u=>/^https?:\/\//i.test(u)?u:'https://'+u;
function mergeLeads(){
 const dir=path.join(R.BASE,'.domain-discovery');
 const leads={},pages={},mrfs={};
 const add=(ccn,domain,src)=>{if(!ccn||!domain)return;const h=domain.replace(/^https?:\/\//,'').replace(/\/.*$/,'').replace(/^www\./,'');if(!h||!/^[a-z0-9.-]+$/i.test(h))return;(leads[ccn]=leads[ccn]||[]);if(!leads[ccn].some(x=>x.domain===h))leads[ccn].push({domain:h,src});};
 const addPage=(ccn,u)=>{if(!ccn||!u||!/^https?:\/\//i.test(u))return;(pages[ccn]=pages[ccn]||new Set()).add(u);};
 const addMrf=(ccn,u)=>{if(!ccn||!u||!/^https?:\/\//i.test(u))return;(mrfs[ccn]=mrfs[ccn]||new Set()).add(u);};
 const priorPath=path.join(dir,'bucket-leads.json');
 if(fs.existsSync(priorPath)){
  const prior=JSON.parse(fs.readFileSync(priorPath,'utf8'));
  for(const [ccn,v] of Object.entries(prior))for(const d of v.domains||[])add(ccn,d,'prior-discovery');
 }
 for(const f of fs.readdirSync(dir).filter(f=>/^bucket-leads-search-\d+\.json$/.test(f)).sort()){
  for(const e of JSON.parse(fs.readFileSync(path.join(dir,f),'utf8'))){
   for(const c of e.candidates||[]){
    add(e.ccn,c.domain,'search:'+(c.source||''));
    if(c.pricingPageUrl)addPage(e.ccn,c.pricingPageUrl);
    if(c.mrfUrl)addMrf(e.ccn,c.mrfUrl);
   }
  }
 }
 return {leads,pages,mrfs};
}
const runPool=async list=>await pooled(list,{concurrency:16,keyFn:j=>{try{return new URL(j.url).hostname;}catch{return 'invalid-url';}},onProgress:(n,t)=>{if(n%50===0||n===t)console.log(`Probed ${n}/${t}`);}},async j=>{await get(j.url,j.kind);});
function entryAgrees(a,b){
 const x=String(a||'').toLowerCase(),y=String(b||'').toLowerCase();
 return !!x&&!!y&&(x===y||x.includes(b)&&b.length>3||y.includes(a)&&a.length>3);
}
async function main(){
 const {leads,pages,mrfs}=mergeLeads();
 const roster=read(path.join(R.ROOT,'cms_data/hpt/roster.json'));
 const rosterBy=new Map(roster.map(r=>[r.ccn,r]));
 const obs=fs.existsSync(path.join(OUT,'retrieval-results.json'))?read(path.join(OUT,'retrieval-results.json')):[];
 const pointerJobs=new Map(),pageJobs=new Map(),mrfJobs=new Map(),homeJobs=new Map();
 const addJob=(map,url,ccn)=>{if(!map.has(url))map.set(url,{url,kind:map===pageJobs?'document':map===mrfJobs?'mrf':map===homeJobs?'homepage':'document',ccns:[],roles:['domain-lead']});const j=map.get(url);if(ccn&&!j.ccns.includes(ccn))j.ccns.push(ccn);};
 for(const [ccn,arr] of Object.entries(leads))for(const {domain} of arr){
  addJob(pointerJobs,`https://${domain}/cms-hpt.txt`,ccn);
  addJob(pointerJobs,`https://www.${domain}/cms-hpt.txt`,ccn);
 }
 for(const [ccn,urls] of Object.entries(pages))for(const u of urls)addJob(pageJobs,u,ccn);
 for(const [ccn,urls] of Object.entries(mrfs)){let n=0;for(const u of urls){if(n>=2)break;addJob(mrfJobs,u,ccn);n++;}}
 console.log('Lead pointer probes: '+pointerJobs.size+', pricing pages: '+pageJobs.size+', direct files: '+mrfJobs.size+' for '+Object.keys(leads).length+' CCNs');
 await runPool([...pointerJobs.values(),...pageJobs.values()]);
 // Select files from readable pointers: the entry must agree with the roster
 // name or city, or share a distinctive name token; small system pointers are
 // scanned in full. Bounded per CCN.
 for(const [ccn,arr] of Object.entries(leads)){
  const rh=rosterBy.get(ccn);if(!rh)continue;
  let files=0;
  for(const {domain} of arr){
   for(const variant of [`https://${domain}/cms-hpt.txt`,`https://www.${domain}/cms-hpt.txt`]){
    const o=await get(variant,'document');
    if(!(ok(o.status)&&!o.html&&o.entries&&o.entries.length))continue;
    const fullScan=o.entries.length<=12;
    // Agreeing entries (name/city/distinctive token) take the per-CCN budget
    // before a small system pointer's remaining entries are scanned.
    for(const pass of ['agree','rest']){
     for(const e of o.entries){
      const agree=entryAgrees(e.locationName,rh.name)||distinctiveNameOverlap(e.locationName,rh.name)||entryAgrees(e.locationName,rh.city);
      if(pass==='agree'&&!agree)continue;
      if(files>=6)break;
      const urls=[...(e.mrfUrls||[]).map(normUrl)];
      if(e.sourcePageUrl&&FILE_LIKE.test(e.sourcePageUrl))urls.push(e.sourcePageUrl);
      for(const u of urls){if(files>=6)break;addJob(mrfJobs,u,ccn);files++;}
      if(files>=6)break;
     }
     if(files>=6||(pass==='agree'&&!fullScan))break;
    }
    if(files>=6)break;
   }
   if(files>=6)break;
  }
 }
 console.log('Lead file probes: '+mrfJobs.size+' URLs');
 await runPool([...mrfJobs.values()]);
 // Retry lead files whose first fetch failed at transport or redirect level,
 // using the bounded 32 MB progressive pass (curl fallback follows redirects).
 const {deepRead}=require('./deep-read-capped');
 let retried=0;
 for(const j of mrfJobs.values()){
  const o=await get(j.url,'mrf');
  if(ok(o.status)||[403,401,404,410,422].includes(Number(o.status)))continue;
  const key=sha(j.url+'|mrf'),meta=path.join(inv.RAW,key+'.json');
  const old=JSON.parse(fs.readFileSync(meta,'utf8'));
  fs.writeFileSync(path.join(inv.RAW,key+'-failed-'+old.checkedAt.replace(/[:.]/g,'-')+'.json'),JSON.stringify(old));
  const deep=await deepRead(j.url);
  fs.writeFileSync(meta,JSON.stringify(deep,null,2));
  retried++;
 }
 if(retried)console.log('Retried (deep) lead files: '+retried);
 // Homepages for CCNs whose pointer variants all failed.
 const homes=[];
 for(const [ccn,arr] of Object.entries(leads)){
  let pointerOk=false;
  for(const {domain} of arr){
   for(const variant of [`https://${domain}/cms-hpt.txt`,`https://www.${domain}/cms-hpt.txt`]){
    const o=await get(variant,'document');
    if(ok(o.status)&&!o.html&&o.entries&&o.entries.length){pointerOk=true;break;}
   }
   if(pointerOk)break;
  }
  if(!pointerOk){const {domain}=arr[0];addJob(homeJobs,`https://${domain}/`,ccn);homes.push(homeJobs.get(`https://${domain}/`));}
 }
 console.log('Homepage probes: '+homeJobs.size+' URLs');
 await runPool([...homeJobs.values()]);
 // Merge into retrieval-results.json without disturbing earlier roles.
 const merged=[...obs];
 const upsert=job=>{
  const o=read(path.join(inv.RAW,sha(job.url+'|'+job.kind)+'.json'));
  const existing=merged.find(x=>x.kind===job.kind&&x.url===job.url);
  if(existing){for(const c of job.ccns)if(!existing.ccns.includes(c))existing.ccns.push(c);if(!existing.roles.includes('domain-lead'))existing.roles.push('domain-lead');Object.assign(existing.retrieval,o);}
  else merged.push({...job,retrieval:o});
 };
 for(const j of pointerJobs.values())upsert(j);
 for(const j of pageJobs.values())upsert(j);
 for(const j of mrfJobs.values())upsert(j);
 for(const j of homeJobs.values())upsert(j);
 json(path.join(OUT,'retrieval-results.json'),merged);
 console.log('Saved '+merged.length+' retrievals');
}
// Follow pricing-page links for lead domains that serve no root pointer.
// A fetched page that turns out to be a real pointer (non-HTML with entries)
// has its agreeing files fetched too, so the next classify can complete chains.
async function pricingLinks(){
 const obs=read(path.join(OUT,'retrieval-results.json'));
 const candidates=obs.filter(o=>(o.roles||[]).includes('domain-lead')&&ok(o.retrieval.status)&&(o.kind==='homepage'||(o.kind==='document'&&o.retrieval.html))&&(o.retrieval.links||[]).length);
 const roster=read(path.join(R.ROOT,'cms_data/hpt/roster.json'));
 const rosterBy=new Map(roster.map(r=>[r.ccn,r]));
 const links=new Map();
 for(const h of candidates){
  const link=(h.retrieval.links||[]).find(l=>/cms-hpt|transparen|standard.?charg|pricing|price|machine/i.test(l.label+' '+l.url));
  if(link)links.set(link.url,h.ccns);
 }
 console.log('Pricing-link fetches: '+links.size);
 const jobs=[...links.entries()].map(([url,ccns])=>({url,kind:'document',ccns,roles:['domain-lead']}));
 await runPool(jobs);
 // Pointer-shaped pages contribute their agreeing files.
 const files=new Map();
 for(const j of jobs){
  const o=await get(j.url,'document');
  if(!(ok(o.status)&&!o.html&&o.entries&&o.entries.length))continue;
  for(const ccn of j.ccns){
   const rh=rosterBy.get(ccn);if(!rh)continue;
   let n=0;
   for(const e of o.entries){
    if(!entryAgrees(e.locationName,rh.name)&&!distinctiveNameOverlap(e.locationName,rh.name))continue;
    for(const u of (e.mrfUrls||[]).map(normUrl)){if(n>=3)break;if(!files.has(u))files.set(u,{url:u,kind:'mrf',ccns:[],roles:['domain-lead']});const f=files.get(u);if(!f.ccns.includes(ccn))f.ccns.push(ccn);n++;}
    if(n>=3)break;
   }
  }
 }
 // Pricing pages that stay HTML still declare their standard-charges files via
 // plain links; fetch those files so identity and metadata can be verified.
 const pageFiles=new Map();
 for(const j of jobs){
  const cur=await get(j.url,'document');
  if(!(ok(cur.status)&&cur.html))continue;
  for(const ccn of j.ccns){
   let n=0;
   for(const l of (cur.links||[])){
    if(!FILE_LIKE.test(l.url))continue;
    const u=normUrl(l.url);
    if(!pageFiles.has(u))pageFiles.set(u,{url:u,kind:'mrf',ccns:[],roles:['domain-lead']});
    const f=pageFiles.get(u);if(!f.ccns.includes(ccn))f.ccns.push(ccn);
    if(++n>=3)break;
   }
  }
 }
 if(pageFiles.size){console.log('Pricing-page file links: '+pageFiles.size);await runPool([...pageFiles.values()]);}
 const merged=[...obs];
 const upsert=job=>{
  const o=read(path.join(inv.RAW,sha(job.url+'|'+job.kind)+'.json'));
  const existing=merged.find(x=>x.kind===job.kind&&x.url===job.url);
  if(existing){for(const c of job.ccns)if(!existing.ccns.includes(c))existing.ccns.push(c);Object.assign(existing.retrieval,o);}
  else merged.push({...job,retrieval:o});
 };
 for(const j of jobs)upsert(j);
 for(const j of files.values())upsert(j);
 for(const j of pageFiles.values())upsert(j);
 json(path.join(OUT,'retrieval-results.json'),merged);
 console.log('Saved '+merged.length+' retrievals');
}
if(require.main===module)(process.argv[2]==='pricing-links'?pricingLinks():main()).catch(e=>{console.error(e);process.exitCode=1;});
module.exports={mergeLeads,pricingLinks};
