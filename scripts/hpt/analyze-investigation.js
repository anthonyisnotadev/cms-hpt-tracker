'use strict';
// Additive per-CCN disposition analysis over the frozen investigation cohort.
// Never updates the tracker, prior reports, or the reviewed ledger unless --apply
// is passed; even then only the local reviewed-resolution ledger changes.
const fs=require('fs'),path=require('path');
const R=require('./recovery-run');
const {sha,PARSER_VERSION}=require('./lib/recovery-transport');
const {matchMrfHeader}=require('./lib/mrf-header-match');
const {nameSimilarity}=require('./lib/util');
const {metadataStatus}=require('./recheck-interventions');
const {applyResolutions}=require('./lib/reviewed-resolutions');
const {adjudicateIdentity}=require('./lib/adjudicate-identity');
const {normalizeName}=require('./lib/util');
const {toCSV}=require('./lib/util');
const OUT=path.join(R.BASE,'rechecks/2026-09-09/investigation');
const RAW=path.join(R.BASE,'.domain-discovery/investigation-20260909');
const read=f=>JSON.parse(fs.readFileSync(f,'utf8'));
const json=(f,v)=>{fs.writeFileSync(f,JSON.stringify(v,null,2)+'\n');};
const key=(kind,url)=>kind+'|'+sha(url+'|'+kind);
const normUrl=u=>/^https?:\/\//i.test(u)?u:'https://'+u;
const ok=s=>s>=200&&s<300;
function sameUrl(a,b){
 if(!a||!b)return false;
 const fix=u=>/^https?:\/\//i.test(u)?u:'https://'+u;
 a=fix(a);b=fix(b);
 if(a===b)return true;
 try{const x=new URL(a),y=new URL(b);
  if(x.host!==y.host)return false;
  const dx=decodeURIComponent(x.pathname+x.search),dy=decodeURIComponent(y.pathname+y.search);
  return dx===dy;
 }catch{return false;}
}
function freshObs(index,kind,url){return index.get(key(kind,url))||null;}
function rawProof(obs){
 if(!obs)return null;
 const f=path.join(RAW,obs.artifact);
 if(obs.toolError||!obs.artifact||!fs.existsSync(f))return null;
 if(sha(fs.readFileSync(f))!==obs.sha256)return null;
 return {artifact:obs.artifact,sha256:obs.sha256};
}
// Pointer entry labels may append campus qualifiers or use a network brand
// ("Summit Campus", "Columbia Memorial Health"). Accept a name only when the
// normalized strings overlap; per-facility file address matching stays mandatory.
function entryNameAgrees(entryName,facilityName){
 const a=String(entryName||'').toLowerCase(),b=String(facilityName||'').toLowerCase();
 if(!a||!b)return false;
 if(a===b||a.includes(b)||b.includes(a))return true;
 return nameSimilarity(entryName,facilityName)>=0.5;
}
// The pointer lists the file when it names the retrieved URL directly, or names
// a URL whose observed redirect this run landed on the retrieved file. Both
// observations stay in staging as the linkage proof.
const FILE_LIKE=/\.(csv|json|zip|txt)(\?|$)|standardcharg/i;
function pointerLinks(goodPointer,obs,mObsList,rosterName,headerLocation,requireRoster=true){
 if(!goodPointer||!obs)return [];
 const declared=[obs.url,obs.finalUrl].filter(Boolean);
 const redirectHit=u=>{const o2=mObsList.find(x=>sameUrl(x.url,u)&&x.finalUrl);return o2&&declared.some(d=>sameUrl(d,o2.finalUrl));};
 const labelOk=e=>entryNameAgrees(e.locationName,rosterName)||(!requireRoster&&entryNameAgrees(e.locationName,headerLocation));
 const links=[];
 for(const e of goodPointer.entries){
  if(!labelOk(e))continue;
  if(requireRoster&&!entryNameAgrees(e.locationName,headerLocation))continue;
  const urls=[...(e.mrfUrls||[]).map(normUrl)];
  if(e.sourcePageUrl&&FILE_LIKE.test(e.sourcePageUrl))urls.push(e.sourcePageUrl);
  for(const u of urls)if(declared.some(d=>sameUrl(u,d))||redirectHit(u)){links.push({entry:e,url:u});break;}
 }
 return links;
}
// Classify one CCN from fresh retrievals plus the prior recovery evidence.
function classify(row,roster,index,ledgerBy,leadJobs){
 const ccn=row.ccn,rosterRow=row.roster,prev=row.previous,base=row.base||{};
 const pointerJobs=[...new Set([prev.pointer_url,base.pointer_url,row.best&&row.best.pointerRequestedUrl,row.best&&row.best.pointerUrl,...((leadJobs&&leadJobs.pointers)||[])])].filter(Boolean);
 const mrfJobs=[...new Set([prev.mrf_url,base.mrf_url,row.best&&row.best.url,...(row.evidence||[]).map(e=>e.url),...((leadJobs&&leadJobs.mrfs)||[])])].filter(Boolean);
 const pObsList=pointerJobs.map(u=>freshObs(index,'document',u)).filter(Boolean);
 const mObsList=mrfJobs.flatMap(u=>{const shallow=freshObs(index,'mrf',u),deep=freshObs(index,'mrf-deep',u);return [shallow,deep].filter(Boolean);});
 const out={ccn,hospital_name:prev.hospital_name||rosterRow.name,state:prev.state||rosterRow.state,
  previous_status:prev.status,disposition:'unresolved',issue:'',next_step:'',
  pointer_url:'',pointer_status:'',pointer_checked_at:'',pointer_declared_url:'',mrf_url:'',mrf_status:'',mrf_final_url:'',
  identity:'',identity_basis:'',header_name:'',header_location:'',header_state:'',date:'',version:'',metadata:'',
  file_checked_at:'',pointer_sha256:'',file_sha256:'',adjudicated:'',note:''};
 const goodPointer=pObsList.find(o=>ok(o.status)&&!o.html&&o.entries&&o.entries.length);
 const goodMrf=mObsList.filter(o=>ok(o.status)&&o.parsed&&o.parsed.parsed&&o.parsed.parsed.length);
 // Identity + metadata check for every successfully parsed fresh file, per member.
 let best=null;
 let conflictCand=null;
 const multiCands=[];
 for(const o of goodMrf)for(const member of o.parsed.parsed){
  const probe={rangeStatus:o.status,mrfLicenseState:member.mrfLicenseState,mrfHospitalName:member.mrfHospitalName,mrfLocationName:member.mrfLocationName,mrfAddress:member.mrfAddress};
  const declaredUrls=[o.url,o.finalUrl].filter(Boolean);
  // Pointer linkage: fresh pointer entry naming this URL (directly or via an observed redirect).
  const links=pointerLinks(goodPointer,o,mObsList,rosterRow.name,member.mrfLocationName);
  const task={refs:links.map(e=>({location_name:e.entry.locationName}))};
  const match=matchMrfHeader(task,probe,roster);
  let mine=match.matches.filter(m=>m.hospital.ccn===ccn);
  let adjudication=null;
  if(!mine.length){
   const relaxed=pointerLinks(goodPointer,o,mObsList,rosterRow.name,member.mrfLocationName,false);
   adjudication=adjudicateIdentity({rosterRow,roster,member,pointerLinked:relaxed.length>0,pointerLabels:relaxed.map(l=>l.entry.locationName)});
   if(adjudication.accept)mine=[{hospital:rosterRow,identityBasis:adjudication.basis}];
   else if(adjudication.reason==='file-declares-conflicting-license-state'&&links.length)conflictCand={obs:o,member,adj:adjudication,pointerLinked:true};
  }
  const meta={declared_date:member.declaredLastUpdated,version:member.cmsVersion};
  const status=metadataStatus(meta,Date.parse(o.checkedAt));
  const cand={obs:o,member,match,mine,links,metadata:status,adjudication,
   pointerLinked:links.length>0,
   priorEvidence:(row.evidence||[]).find(e=>e.url===o.url||sameUrl(e.url,o.url))||null};
  if(cand.mine.length&&cand.pointerLinked&&cand.metadata==='date-within-365-days-version-3')multiCands.push(cand);
  if(!best||(mine.length&&(!best.mine.length||cand.metadata==='date-within-365-days-version-3'))||(mine.length===best.mine.length&&cand.pointerLinked&&!best.pointerLinked))best=cand;
 }
 if(best){
  out.mrf_url=best.obs.url;out.mrf_status=String(best.obs.status);
  out.mrf_final_url=best.obs.finalUrl||'';out.file_checked_at=best.obs.checkedAt;out.file_sha256=best.obs.sha256||'';
  const adjAccepted=best.adjudication&&best.adjudication.accept;
  out.identity=best.mine.length?(adjAccepted?'corroborated-adjudicated':'corroborated'):(best.match.status==='matched'?'other-facility':best.match.reason);
  out.identity_basis=best.mine.length?best.mine[0].identityBasis:'';
  if(adjAccepted)out.adjudicated=best.adjudication.basis;
  out.header_name=best.member.mrfHospitalName||'';out.header_location=best.member.mrfLocationName||'';
  out.header_state=best.member.mrfLicenseState||'';out.date=best.member.declaredLastUpdated||'';
  out.version=best.member.cmsVersion||'';out.metadata=best.metadata;
 }
 if(goodPointer){out.pointer_url=goodPointer.finalUrl||goodPointer.url;out.pointer_status=String(goodPointer.status);out.pointer_checked_at=goodPointer.checkedAt;out.pointer_sha256=goodPointer.sha256||'';}
 else{const p=pObsList.find(o=>!o.toolError)||pObsList[0];if(p){out.pointer_url=p.finalUrl||p.url;out.pointer_status=p.toolError?('tool-error:'+(p.error||'')):String(p.status||p.error||'');out.pointer_checked_at=p.checkedAt;}}
 if(conflictCand&&(!best||!best.mine.length)){
  const o=conflictCand.obs,m=conflictCand.member;
  out.mrf_url=o.url;out.mrf_status=String(o.status);out.mrf_final_url=o.finalUrl||'';
  out.file_checked_at=o.checkedAt;out.file_sha256=o.sha256||'';
  out.identity='license-state-conflict';out.identity_basis='exact-name-and-address-with-conflicting-license-state';
  out.header_name=m.mrfHospitalName||'';out.header_location=m.mrfLocationName||'';
  out.header_state=m.mrfLicenseState||'';out.date=m.declaredLastUpdated||'';out.version=m.cmsVersion||'';
  out.metadata=conflictCand.metadata;
  out.disposition='publisher-issue';out.issue='file-declares-conflicting-license-state';
  out.note=`File header declares license state ${m.mrfLicenseState||'(empty)'} while the roster state is ${rosterRow.state}; the name and address match the roster exactly and the official pointer lists the file.`;
  out.next_step='Publisher inquiry: ask the facility to correct the license_state field in the file header; recheck on their update';
  return out;
 }
 // Disposition 1: verified correction candidate (fresh, pointer-linked, per-facility identity, current metadata).
 const currentCorroborated=new Set((row.evidence||[]).filter(e=>e.identity==='corroborated'&&e.metadata==='date-within-365-days-version-3'&&ok(Number(e.http_status))).map(e=>e.url));
 for(const c of multiCands)currentCorroborated.add(c.obs.url);
 if(currentCorroborated.size>1){
  const missing=[...currentCorroborated].filter(url=>!multiCands.some(c=>sameUrl(url,c.obs.url)||sameUrl(url,c.obs.finalUrl)));
  if(missing.length){
   out.disposition='unresolved';out.issue='multiple-corroborated-candidates';
   out.note=`${missing.length} competing previously corroborated file(s) could not be re-verified; retrieval failure does not resolve the competing identity.`;
   out.next_step='Adjudicate competing current files against the pointer entries and roster address before assigning one';
   return out;
  }
  // Authorized duplicate adjudication: every candidate here is per-facility
  // corroborated, pointer-linked and current. Select the pointer entry label
  // closest to the roster name; refuse only a genuine tie (same score AND date).
  const distinct=multiCands.filter((c,i)=>!multiCands.slice(0,i).some(prev=>sameUrl(prev.obs.finalUrl||prev.obs.url,c.obs.finalUrl||c.obs.url)));
  const ranked=distinct.map(c=>({c,
   label:(c.links[0]&&c.links[0].entry.locationName)||c.member.mrfLocationName||'',
   s:nameSimilarity((c.links[0]&&c.links[0].entry.locationName)||c.member.mrfLocationName||'',rosterRow.name),
   date:c.member.declaredLastUpdated||''}))
   .sort((a,b)=>b.s-a.s||b.date.localeCompare(a.date)||a.c.obs.url.localeCompare(b.c.obs.url));
  const top=ranked[0],second=ranked[1];
  if(second&&top.s-second.s<0.02&&top.date===second.date){
   out.disposition='unresolved';out.issue='multiple-corroborated-candidates';
   out.note=`${currentCorroborated.size} distinct current files corroborate this facility and the pointer labels are indistinguishable ("${top.label}" = "${second.label}").`;
   out.next_step='Adjudicate competing current files against the pointer entries and roster address before assigning one';
   return out;
  }
  best=top.c;
  out.mrf_url=best.obs.url;out.mrf_status=String(best.obs.status);out.mrf_final_url=best.obs.finalUrl||'';
  out.file_checked_at=best.obs.checkedAt;out.file_sha256=best.obs.sha256||'';
  out.identity='corroborated';out.identity_basis=best.mine[0].identityBasis;
  out.header_name=best.member.mrfHospitalName||'';out.header_location=best.member.mrfLocationName||'';
  out.header_state=best.member.mrfLicenseState||'';out.date=best.member.declaredLastUpdated||'';
  out.version=best.member.cmsVersion||'';out.metadata=best.metadata;
  out.pointer_declared_url=(best.links[0]&&best.links[0].url)||'';
  out.note=`Duplicate adjudication: ${currentCorroborated.size} current corroborated files; selected the pointer entry "${top.label}" (label closest to the roster name).`;
 }
 if(best&&best.mine.length&&best.pointerLinked&&best.metadata==='date-within-365-days-version-3'){
  const already=ledgerBy.has(ccn)&&ledgerBy.get(ccn).action==='replace';
  if(already)out.note='Correction verified and already recorded in the reviewed ledger.';
  out.disposition='correction-verified';out.next_step=already?'Applied to the local reviewed ledger':'Verify raw pointer/file proofs then apply through the reviewed ledger';
  return out;
 }
 // Disposition 2: reproducible publisher issues, each anchored to corroborated identity or a repeated observation.
 if(best&&best.mine.length&&best.metadata==='date-over-365-days'){
  const prior=(row.evidence||[]).find(e=>e.date===best.member.declaredLastUpdated&&ok(Number(e.http_status)));
  out.disposition='publisher-issue';
  out.issue=/^2/.test(String(best.obs.status))?'declared-update-date-over-365-days':'declared-update-date-over-365-days';
  out.note=prior?`Same declared date ${out.date} observed again after the earlier check (${prior.checked_at}).`:'Declared date over 365 days at check time.';
  out.next_step='Publisher inquiry with the recorded file URL, declared date and response hash; recheck after their update window';
  return out;
 }
 if(best&&best.mine.length&&best.metadata==='date-within-365-days-older-version'){
  out.disposition='publisher-issue';out.issue='template-version-older-than-3';
  out.note=`Declared version ${out.version} with a current date; publisher has not adopted the current CMS dictionary.`;
  out.next_step='Publisher inquiry about the declared template version; recheck after their update window';
  return out;
 }
 if(best&&best.mine.length&&best.metadata==='date-within-365-days-version-unverified'){
  out.disposition='publisher-issue';out.issue='template-version-unrecognized';
  out.note=`Declared template version ${out.version||'(none)'} is not a recognized CMS data dictionary version; facility identity and the ${out.date} update date are corroborated${/[Bb]rowser/.test(best.obs.attempts&&best.obs.attempts[0]&&best.obs.attempts[0].via||'')?' via browser retrieval':''}.`;
  out.next_step='Publisher inquiry: confirm which CMS data dictionary version the file implements; recheck on their reply';
  return out;
 }
 if(best&&best.mine.length&&!best.pointerLinked&&best.metadata==='date-within-365-days-version-3'&&best.obs.viaBrowser){
  // The file itself is current and matches this facility exactly, but the
  // publisher serves it from a pricing page without any machine-readable
  // pointer (cms-hpt.txt). A pricing-page link cannot substitute for the
  // pointer, so this is recorded as a publisher gap, not a correction.
  out.disposition='publisher-issue';out.issue='file-published-no-machine-pointer';
  out.note=`File served on the facility's own site is current (${out.date}, version ${out.version}) and its header matches the roster facility, but no machine-readable pointer declares it.`;
  out.next_step='Publisher inquiry: ask the facility to publish a machine-readable pointer (cms-hpt.txt) alongside the file; the file itself is already verified';
  return out;
 }
 // Access blocked on the recorded file with corroborated facility identity (prior evidence), reconfirmed fresh.
 if(best&&best.mine.length===0&&best.match.status==='matched'&&!best.mine.length&&best.metadata!=='date-unverified'){
  // Header matched a different facility in the same state pool: identity conflict for this CCN.
  out.disposition='unresolved';out.issue='file-belongs-to-other-facility';
  out.next_step='Adjudicate facility identity: locate this facility\'s own pointer/file; do not reuse the shared-provider finding';
  return out;
 }
 const blockedMrf=mObsList.find(o=>Number(o.status)===403||Number(o.status)===401||/cloudflare|imunify|bot-protection|access denied/i.test(o.excerpt||''));
 if(blockedMrf&&(row.evidence||[]).some(e=>e.identity==='corroborated')){
  out.disposition='publisher-issue';out.issue='automated-file-access-denied';
  out.mrf_url=blockedMrf.finalUrl||blockedMrf.url;out.mrf_status=String(blockedMrf.status||blockedMrf.error||'');out.file_checked_at=blockedMrf.checkedAt||'';
  out.note='Automated retrieval denied while the earlier pass corroborated facility identity from this URL; not evidence of a missing file.';
  out.next_step='Browser download attempt, then publisher whitelist request with the recorded denial evidence';
  return out;
 }
 const dead404=mObsList.find(o=>Number(o.status)===404);
 if(dead404&&goodPointer){
  const urls=[dead404.url,dead404.finalUrl].filter(Boolean);
  const listed=goodPointer.entries.some(e=>(e.mrfUrls||[]).some(u=>urls.some(x=>sameUrl(u,x)))&&entryNameAgrees(e.locationName,rosterRow.name));
  if(listed){
   out.disposition='publisher-issue';out.issue='pointer-declared-file-404';
   out.mrf_url=dead404.finalUrl||dead404.url;out.mrf_status='404';out.file_checked_at=dead404.checkedAt||'';
   out.note='The official pointer declares this file URL and it returns 404 on repeated checks; reproducible broken link.';
   out.next_step='Publisher inquiry to restore or replace the declared file; recheck after their update window';
   return out;
  }
 }
 const unsupported=mObsList.find(o=>ok(o.status)&&o.deepRead&&(!o.parsed||!o.parsed.parsed||!o.parsed.parsed.length)&&o.bytes>0);
 if(unsupported){
  out.disposition='publisher-issue';out.issue='declared-file-format-unsupported';
  out.mrf_url=unsupported.finalUrl||unsupported.url;out.mrf_status=String(unsupported.status);out.file_checked_at=unsupported.checkedAt||'';
  out.note=`Complete bounded read (${(unsupported.bytes/1048576).toFixed(1)} MB) could not extract header metadata: the declared file is an archive/format the parser does not read (e.g. XLSX), so identity and metadata stay unverified.`;
  out.next_step='Extend the parser for the declared format or request a CSV/JSON export from the publisher; file URL and bytes are retained';
  return out;
 }
 const allTransport=mObsList.length&&mObsList.every(o=>!ok(o.status)&&!o.status);
 if(allTransport&&!goodMrf.length){
  out.note='All recorded file leads failed at transport level again this run (reproducible connection failure).';
  out.next_step='Browser download attempt on the recorded file URL; a failed automated request is not evidence the file is absent';
  return out;
 }
 const homeUrl=(leadJobs&&leadJobs.homes||[])[0];
 const homeObs=homeUrl?freshObs(index,'homepage',homeUrl):null;
 if(!goodPointer&&homeObs&&ok(homeObs.status)&&rosterHint(homeObs.excerpt||'',rosterRow)){
  out.issue=out.issue||'lead-domain-names-facility-no-pointer';
  out.note='Lead domain '+homeUrl+' names the facility on its homepage but serves no readable cms-hpt.txt at the standard location; homepage evidence retained.';
  out.next_step='Browser pricing-page walk on the named domain to locate the pointer or its replacement';
  return out;
 }
 // Disposition 3: unresolved, with a deterministic next step.
 out.next_step=nextStep(row,{goodPointer,goodMrf,mObsList,pObsList,blockedMrf});
 return out;
}
function rosterHint(excerpt,row){
 const text=normalizeName(excerpt);if(!text)return false;
 const generic=new Set(['hosp','health','med','ctr','system','regional','community','memorial','general','the','of','at','st']);
 const tokens=normalizeName(row.name).split(' ').filter(x=>x&&!generic.has(x));
 const nameHit=tokens.some(x=>text.includes(x));
 const cityHit=row.city&&text.includes(normalizeName(row.city));
 return nameHit&&cityHit;
}
function nextStep(row,{goodPointer,goodMrf,mObsList,pObsList,blockedMrf}){
 const prev=row.previous,blocker=prev.blocker||'';
 if(prev.status==='identity-quarantined')return 'Facility identity adjudication against the roster before any pointer or file work';
 if(prev.status==='publisher-date-review')return 'Publisher inquiry on the recorded declared date; recheck after their update window';
 if(prev.status==='publisher-template-review')return 'Publisher inquiry on the declared template version; recheck after their update window';
 if(blockedMrf)return 'Browser download attempt on the recorded file URL; a failed automated request is not evidence the file is absent';
 if(prev.file_access==='response received'){
  if(mObsList.some(o=>ok(o.status)&&o.html))return 'Record the direct file URL behind the web page served at the recorded file URL (browser or manual download), then re-verify';
  if(goodMrf.length)return 'Compare the parsed header against facility aliases, renames and campus entries; extend the capped read only if metadata may sit beyond it';
  return 'Complete-file read beyond the capped header to recover identity or metadata fields';
 }
 if(/official-pointer|domain/.test(blocker))return 'Official-domain discovery: confirm the roster facility controls a domain exposing cms-hpt.txt before assigning it';
 if(/archive|format/.test(blocker))return 'Extend the parser for the recorded archive/layout, then re-read the retained bytes';
 if(prev.website==='response received'&&!goodPointer)return 'Browser pricing-page walk to find the current pointer location; a page link alone cannot repair the pointer';
 return 'Retrieval retry from the retained leads, then browser adjudication if the block repeats';
}
function leadsFor(observations,ccn){
 const lead={pointers:[],mrfs:[],homes:[]};
 for(const o of observations)if((o.roles||[]).some(role=>['domain-lead','browser-fetch','publisher-response'].includes(role))&&(o.ccns||[]).includes(ccn)){
  if(o.kind==='document')lead.pointers.push(o.url);else if(o.kind==='mrf')lead.mrfs.push(o.url);else if(o.kind==='homepage')lead.homes.push(o.url);
 }
 return lead;
}
function main(){
 const apply=process.argv.includes('--apply');
 const cohort=read(path.join(OUT,'cohort.json'));
 const observations=read(path.join(OUT,'retrieval-results.json'));
 const roster=read(path.join(R.ROOT,'cms_data/hpt/roster.json'));
 const index=new Map(observations.map(o=>[key(o.kind,o.url),o.retrieval]));
 const ledger=read(path.join(R.ROOT,'data/hpt-audit/reviewed-resolutions.json'));
 const ledgerBy=new Map(ledger.map(r=>[r.ccn,r]));
 const compliance=R.csv(path.join(R.BASE,'compliance.csv'));
 const manifest=R.csv(path.join(R.BASE,'manifest.csv'));
 const gaps=R.csv(path.join(R.BASE,'gaps.csv'));
 const results=cohort.map(r=>{
  const lead=leadsFor(observations,r.ccn);
  return classify(r,roster,index,ledgerBy,lead);
 });
 for(const r of results)if(!r.next_step)r.next_step='Retrieval retry from the retained leads, then browser adjudication if the block repeats';
 // Verify correction candidates end-to-end before offering them.
 const proposals=[];
 for(const r of results.filter(x=>x.disposition==='correction-verified')){
  const obsP=freshObs(index,'document',r.pointer_url)||observations.map(o=>o.retrieval).find(o=>ok(o.status)&&!o.html&&(o.finalUrl||o.url)===r.pointer_url);
  const obsM=observations.map(o=>o.retrieval).find(o=>ok(o.status)&&o.url===r.mrf_url&&o.parsed&&(!r.file_sha256||o.sha256===r.file_sha256));
  const mObsAll=observations.filter(o=>o.kind==='mrf'||o.kind==='mrf-deep').map(o=>o.retrieval);
  try{
   if(!obsP||!obsM)throw new Error('fresh observation missing');
   const pProof=rawProof(obsP),mProof=rawProof(obsM);
   if(!pProof||pProof.sha256!==r.pointer_sha256)throw new Error('raw pointer proof missing');
   if(!mProof||mProof.sha256!==r.file_sha256)throw new Error('raw file proof missing');
   const linked=pointerLinks(obsP,obsM,mObsAll,r.hospital_name,r.header_location,!r.adjudicated);
   if(!linked.length)throw new Error('pointer body does not list the file under an agreeing location');
   r.pointer_declared_url=linked[0].url;
   const base=compliance.find(c=>c.ccn===r.ccn);
   if(!base)throw new Error('no original compliance row');
   const proposal={ccn:r.ccn,base:{...base},action:'replace',evidence:{
    ccn:r.ccn,hospital_name:r.hospital_name,url:r.mrf_url,location_name:r.header_location,
    pointerUrl:r.pointer_url,pointerRequestedUrl:obsP.url,pointerCheckedAt:obsP.checkedAt,pointerSha256:r.pointer_sha256,
    pointerDeclaredUrl:r.pointer_declared_url,
    sourcePageUrl:'',score:'1',member:'',identity:'corroborated',identity_basis:r.identity_basis,
    header_name:r.header_name,header_location:r.header_location,header_address:'',header_state:r.header_state,
    http_status:r.mrf_status,file_kind:'csv',date:r.date,version:r.version,checked_at:r.file_checked_at,
    metadata:r.metadata,transport:(obsM.attempts&&obsM.attempts[0]&&obsM.attempts[0].via)||'native',
    parser_version:'recovery-v1',fileSha256:r.file_sha256,officialDomain:new URL(obsP.finalUrl||obsP.url).hostname},
    reviewed_at:new Date().toISOString(),
    note:'Investigation pass re-verified current official pointer, facility identity and file metadata from fresh retrievals. Header review only.'};
   const dry=applyResolutions(compliance,manifest,gaps,[...ledger.filter(x=>x.ccn!==r.ccn),proposal]);
   if(!dry.applied.includes(r.ccn))throw new Error('current crawl conflicts with proposed correction');
   proposals.push(proposal);
  }catch(e){r.disposition='unresolved';r.issue='correction-verification-failed';r.note='Candidate rejected: '+e.message;r.next_step='Re-derive pointer/file proofs for this facility, then re-propose';}
 }
 json(path.join(OUT,'correction-proposals.json'),proposals);
 if(apply){
  if(!proposals.length)console.log('No unapplied proposals; ledger already current.');
  const by=new Map(ledger.map(x=>[x.ccn,x]));
  for(const p of proposals)if(!by.has(p.ccn))by.set(p.ccn,p);
  json(path.join(R.ROOT,'data/hpt-audit/reviewed-resolutions.json'),[...by.values()]);
 }
 json(path.join(OUT,'investigation-summary.json'),{
  cohort:results.length,generatedAt:new Date().toISOString(),applied:apply?proposals.length:0,
  counts:results.reduce((m,r)=>(m[r.disposition]=(m[r.disposition]||0)+1,m),{}),
  issues:results.filter(r=>r.disposition==='publisher-issue').reduce((m,r)=>(m[r.issue]=(m[r.issue]||0)+1,m),{}),
  previousStatus:results.reduce((m,r)=>(m[r.previous_status]=(m[r.previous_status]||0)+1,m),{}),
  nextSteps:results.filter(r=>r.disposition==='unresolved').reduce((m,r)=>{const k=r.next_step.split(':')[0];m[k]=(m[k]||0)+1;return m;},{})
 });
 const publicResults=results.map(r=>Object.fromEntries(Object.entries(r).map(([k,v])=>[k,typeof v==='string'?R.sanitize(v):v])));
 fs.writeFileSync(path.join(OUT,'results.csv'),toCSV(publicResults,Object.keys(results[0])));
 fs.writeFileSync(path.join(OUT,'publisher-issues.csv'),toCSV(publicResults.filter(r=>r.disposition==='publisher-issue'),Object.keys(results[0])));
 console.log(JSON.stringify({cohort:results.length,proposals:proposals.length,applied:apply?proposals.length:0,counts:results.reduce((m,r)=>(m[r.disposition]=(m[r.disposition]||0)+1,m),{})}));
}
if(require.main===module)try{main();}catch(e){console.error(e);process.exitCode=1;}
module.exports={classify,sameUrl,rawProof,entryNameAgrees,pointerLinks,leadsFor};
