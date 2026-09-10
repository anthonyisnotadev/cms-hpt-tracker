'use strict';
const fs=require('fs'),path=require('path');
const R=require('./recovery-run');
const {sha,PARSER_VERSION}=require('./lib/recovery-transport');
const {matchMrfHeader}=require('./lib/mrf-header-match');
const {applyResolutions}=require('./lib/reviewed-resolutions');
function verifyProposal(r,roster,pointerIndex){
 const e=r.evidence;
 const pointer=pointerIndex.get(e.pointerUrl+'|'+e.pointerSha256);
 if(!pointer||pointer.html||!pointer.entries.some(x=>x.urls.includes(e.url)&&x.location_name===e.location_name))throw new Error('Pointer proof mismatch for '+r.ccn);
 const pointerRaw=path.join(R.STAGE,'pointer-proof-'+e.pointerSha256+'.bin');
 if(!fs.existsSync(pointerRaw)||sha(fs.readFileSync(pointerRaw))!==e.pointerSha256)throw new Error('Raw pointer proof missing for '+r.ccn);
 const p=R.read(path.join(R.STAGE,'probe-'+PARSER_VERSION+'-'+sha(e.url)+'.json'));
 const c=p.candidates.find(c=>c.member===e.member&&c.declaredLastUpdated===e.date&&c.cmsVersion===e.version);
 const a=p.attempts.filter(a=>a.method==='GET'&&/^2\d\d$/.test(String(a.status))&&a.artifact).at(-1);
 if(!a||!e.fileSha256||a.sha256!==e.fileSha256||sha(fs.readFileSync(path.join(R.STAGE,a.artifact)))!==e.fileSha256)throw new Error('Raw file proof mismatch for '+r.ccn);
 if(!c||!matchMrfHeader({refs:[e]},c,roster).matches.some(m=>m.hospital.ccn===r.ccn))throw new Error('File proof mismatch for '+r.ccn);
 return true;
}
function main(){
 R.report();const proposals=R.read(path.join(R.STAGE,'proposals.json')),roster=R.read(path.join(R.ROOT,'cms_data/hpt/roster.json'));
 const pointerIndex=new Map(fs.readdirSync(R.STAGE).filter(f=>f.startsWith('doc-')).map(f=>R.read(path.join(R.STAGE,f))).map(d=>[d.finalUrl+'|'+d.sha256,d]));
 const ledgerPath=path.join(R.BASE,'reviewed-resolutions.json'),ledger=R.read(ledgerPath),by=new Map(ledger.map(r=>[r.ccn,r]));
 for(const r of proposals){verifyProposal(r,roster,pointerIndex);if(!by.has(r.ccn))by.set(r.ccn,r);}
 const result=applyResolutions(R.csv(path.join(R.BASE,'compliance.csv')),R.csv(path.join(R.BASE,'manifest.csv')),R.csv(path.join(R.BASE,'gaps.csv')),[...by.values()]);
 if(proposals.some(r=>!result.applied.includes(r.ccn)))throw new Error('Current crawl conflicts with proposed correction');
 if(process.argv.includes('--apply'))R.json(ledgerPath,[...by.values()]);
 R.json(path.join(R.OUT,'verified-corrections.json'),proposals);
 const summary=R.read(path.join(R.OUT,'summary.json'));
 const budgetPath=path.join(R.STAGE,'budget.json'),budget=fs.existsSync(budgetPath)?R.read(budgetPath):{limit:10,entries:[]};
 const pilotFiles=fs.readdirSync(R.STAGE).filter(f=>/^pilot-\d{6}\.json$/.test(f));
 R.json(path.join(R.OUT,'pilot-observations.json'),pilotFiles.map(file=>{
  const p=R.read(path.join(R.STAGE,file));
  return {ccn:p.ccn,model:p.model,completedAt:p.completedAt,role:'unverified leads; independent verification required',
   decisions:p.decisions.map(d=>Object.fromEntries(Object.entries(d).filter(([k])=>['turn','action','url','query','explanation','evidence_ids','status','error'].includes(k)).map(([k,v])=>[k,typeof v==='string'?R.sanitize(v):v]))),
   usage:budget.entries.filter(e=>e.id.startsWith(p.ccn+'-')).map(e=>({id:e.id,status:e.status,actual:e.actual,reserved:e.reserved}))};
 }));
 const browserPath=path.join(R.STAGE,'browser-observations.json'),browser=fs.existsSync(browserPath)?R.read(browserPath):[];
 const assessments=R.csv(path.join(R.OUT,'assessments.csv'));
 const cohort=R.inventory(),refs=R.read(path.join(R.STAGE,'refs.json')),discoveries=R.read(path.join(R.STAGE,'discoveries.json'));
 const attemptIndex=new Map();
 function addAttempt(ccn,a,kind){
  const id=sha(JSON.stringify([a.url,a.finalUrl,a.method,a.via,a.checkedAt,a.sha256]));
  if(!attemptIndex.has(id))attemptIndex.set(id,{id,hospital_ids:[],kind,requested_url:R.sanitize(a.url),final_url:R.sanitize(a.finalUrl),method:a.method,transport:a.via,timestamp:a.checkedAt,status:a.status,error:R.sanitize(a.error||''),bytes:a.bytes,sha256:a.sha256||'',parser_version:PARSER_VERSION});
  const ids=attemptIndex.get(id).hospital_ids;if(!ids.includes(ccn))ids.push(ccn);
 }
 for(const r of cohort){
  for(const d of discoveries[r.base.domain].docs)for(const a of d.attempts||[])addAttempt(r.ccn,a,'page-or-pointer');
  for(const ref of refs[r.ccn]||[]){const p=R.read(path.join(R.STAGE,'probe-'+PARSER_VERSION+'-'+sha(ref.url)+'.json'));for(const a of p.attempts||[])addAttempt(r.ccn,a,'file');}
 }
 R.json(path.join(R.OUT,'attempts.json'),[...attemptIndex.values()]);
 const queue=assessments.filter(r=>r.status!=='correction-verified').map(r=>({...r,next_action:/^publisher/.test(r.status)?'Review the exact declared metadata before publisher inquiry':r.blocker==='official-pointer-or-metadata-unresolved'?'Resolve official pointer linkage or conflicting metadata':r.blocker==='multiple-corroborated-candidates'?'Adjudicate competing current files':r.file_access==='response received'?'Compare facility identity and inspect unparsed metadata':'Continue bounded browser or official-domain discovery'}));
 fs.writeFileSync(path.join(R.OUT,'followup-queue.csv'),require('./lib/util').toCSV(queue,Object.keys(queue[0]||{})));
 const spending={model:'z-ai/glm-5.3-flash',limit:10,actualModelCost:budget.entries.filter(e=>e.kind==='openrouter'&&e.status==='settled').reduce((s,e)=>s+e.actual,0),reservedOrUncertain:budget.entries.filter(e=>e.status!=='settled').reduce((s,e)=>s+e.reserved,0),modelCalls:budget.entries.filter(e=>e.kind==='openrouter').length,serperCalls:0,completedPilotCases:pilotFiles.length};
 R.json(path.join(R.OUT,'pilot-spending.json'),spending);
 R.json(path.join(R.OUT,'browser-observations.json'),browser);
 const yieldByHost={},yieldByTransport={};for(const p of proposals){const host=new URL(p.evidence.url).hostname;yieldByHost[host]=(yieldByHost[host]||0)+1;yieldByTransport[p.evidence.transport]=(yieldByTransport[p.evidence.transport]||0)+1;}
 const baselinePath=path.join(R.STAGE,'free-baseline.json'),free=fs.existsSync(baselinePath)?R.read(baselinePath).corrections:[];
 const incremental=proposals.filter(p=>!free.includes(p.ccn)).map(p=>p.ccn);
 R.json(path.join(R.OUT,'summary.json'),{...summary,applied:process.argv.includes('--apply')?proposals.length:0,preservedLedgerEntries:37,browserDomains:browser.length,attempts:attemptIndex.size,yieldByHost,yieldByTransport,freePassCorrections:free.length,additionalAfterBrowserModelSearch:incremental,...spending});
 const publisher=assessments.filter(r=>/^publisher/.test(r.status)).length;
 const lines=['# Recovery of 856 unresolved hospital records','',
  `Checked ${cohort.length} frozen records. ${proposals.length} corrections ${process.argv.includes('--apply')?'were applied locally':'passed verification but have not been applied by this command'}. ${publisher} additional records have corroborated facility identity and an old declared update date or template. ${cohort.length-proposals.length-publisher} retain unresolved blockers.`,
  '',`The earlier 34 corrections, three quarantines, and 97 publisher-review cases were preserved. Raw audit CSVs were not changed. No outreach, purchase, commit, push, or deployment was performed.`,
  '',`The initial free pass recovered ${free.length} correction candidates; ${incremental.length} additional corrections followed the browser/model/search stages. Native/curl retrieval checked ${summary.distinctFileUrls} distinct candidate URLs. ${browser.length} browser observations were recorded; browser coverage is selective, with remaining jobs retained in private staging.`,
  '',`The GLM-5.3-Flash pilot completed ${spending.completedPilotCases} cases using ${spending.modelCalls} model calls. OpenRouter reported $${spending.actualModelCost.toFixed(8)} in actual usage. Reserved or uncertain cost: $${spending.reservedOrUncertain.toFixed(8)}. Serper calls: 0. The combined ceiling remains $10; unused budget does not authorize expansion beyond this pilot.`,
  '', '## Evidence and remaining work','',
  '- [Per-hospital assessments](assessments.csv): separate site, pointer, identity, file, metadata and browser observations.',
  '- [Verified corrections](verified-corrections.json): current pointer linkage, facility metadata and response hashes.',
  '- [Remaining queue](followup-queue.csv): every uncorrected record and its next action.',
  '- [Candidate file evidence](file-evidence.csv): successful and unsuccessful candidates, including identity rejection reasons.',
  '- [Request attempts](attempts.json): hospital IDs, requested/final URLs, method, time, response/error, bytes and hashes.',
  '- [Spending](pilot-spending.json) and [summary](summary.json): actual costs and recovery yield by host and transport.',
  '', '## Interpretation','',
  'These are evidence-based header and pointer corrections, not full price-row validation or legal compliance certification. A browser-readable pricing page does not prove automated access to its file. A file found outside the pointer cannot resolve a pointer issue. Larger files, unsupported formats, missing metadata, conflicting locations/licenses, and competing current files remain unresolved.',
  '', 'Raw file reads and hash-matching pointer bodies supporting corrections are retained in ignored staging. Earlier page checks retain sanitized excerpts and hashes. Model output provides leads only; independent verification controls application. Search requests were handled through available web tools with Serper disabled. See [the recovery workflow](../../../../../scripts/hpt/RECOVERY.md) for resumption commands.',
  '', '## Current disposition','',...Object.entries(summary.counts).map(([key,n])=>`- ${key}: ${n}`),''];
 fs.writeFileSync(path.join(R.OUT,'README.md'),lines.join('\n'));
 console.log(JSON.stringify({proposals:proposals.length,applied:process.argv.includes('--apply'),spending}));
}
if(require.main===module)try{main();}catch(e){console.error(e);process.exitCode=1;}
module.exports={verifyProposal};
