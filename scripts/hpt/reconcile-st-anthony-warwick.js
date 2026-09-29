'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const {csvToObjects}=require('./lib/util');
const root=path.resolve(__dirname,'../..'),audit=path.join(root,'data/hpt-audit'),ccn='330205';
const pointerUrl='https://www.wmchealth.org/wp-content/uploads/2025/01/cms-hpt.txt';
const identityUrl='https://www.wmchealth.org/contact-us';
const pricesUrl='https://www.wmchealth.org/patients-and-visitors/insurance-and-billing/price-transparency';
const mrfUrl='https://www.wmchealth.org/141340100_StAnthonysCommunityHospital_standardcharges.csv';
const pageMrfUrl='https://www.wmchealth.org/wp-content/uploads/standard-charges/141340100_StAnthonyCommunityHospital_standardcharges.csv';
const sampleRel='cms_data/hpt/nationwide-verification/file-byte-proof/st-anthony-warwick-330205.bin';
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
async function get(url,headers={}){const response=await fetch(url,{headers});return {response,bytes:Buffer.from(await response.arrayBuffer())};}
(async()=>{
 const base=csvToObjects(fs.readFileSync(path.join(audit,'compliance.csv'),'utf8')).find(r=>r.ccn===ccn);
 const n=JSON.parse(fs.readFileSync(path.join(audit,'nationwide-verification.json'),'utf8')).records.find(r=>r.ccn===ccn);
 if(!base||base.finding!=='compliant-observed'||!n||n.declared_address!=='15 Maple Ave., Warwick, NY 10990')throw Error('unexpected 330205 base');
 const [pointer,identity,prices,file,pageFile]=await Promise.all([get(pointerUrl),get(identityUrl),get(pricesUrl),get(mrfUrl,{Range:'bytes=0-262143'}),get(pageMrfUrl,{Range:'bytes=0-262143'})]);
 if(pointer.response.status!==200||identity.response.status!==200||prices.response.status!==200||file.response.status!==206||pageFile.response.status!==206)throw Error('source retrieval gate failed');
 const text=identity.bytes.toString('utf8')+' '+prices.bytes.toString('utf8');
 if(!text.includes('St. Anthony')||!text.includes('15 Maple')||!text.includes('Warwick')||!text.includes('10990')||!prices.bytes.toString('utf8').includes(pageMrfUrl))throw Error('identity/pricing evidence missing');
 fs.mkdirSync(path.dirname(path.join(root,sampleRel)),{recursive:true});fs.writeFileSync(path.join(root,sampleRel),file.bytes);
 const now=new Date().toISOString(), proof={ccn,roster_name:base.hospital_name,roster_address:base.address,roster_state:base.state,pointer_url:pointerUrl,pointer_sha256:sha(pointer.bytes),identity_page_url:identityUrl,identity_page_sha256:sha(identity.bytes),prices_page_url:pricesUrl,prices_page_sha256:sha(prices.bytes),pointer_mrf_url:mrfUrl,file_http_status:file.response.status,file_sample_bytes:file.bytes.length,file_sample_sha256:sha(file.bytes),retained_sample:sampleRel,declared_hospital_name:n.declared_hospital_name,declared_location_name:n.declared_location_name,declared_address:n.declared_address,declared_license_state:n.declared_license_state,declared_date:n.declared_last_updated,version:n.cms_template_version,observed_at:now,limitation:'First-party identity and pricing pages link the pointer MRF; bounded CSV evidence identifies the Warwick campus. This is not full-file or rate validation.'};
 fs.writeFileSync(path.join(audit,'reconciliation-st-anthony-warwick-proof.json'),JSON.stringify(proof,null,2)+'\n');
 const evidence={identity:'corroborated',identity_basis:'first-party-WMC-identity-and-price-page-exact-campus-address-plus-bounded-pointer-file-header',officialDomain:'wmchealth.org',pointerUrl,pointerSha256:sha(pointer.bytes),sourcePageUrl:pricesUrl,sourcePageSha256:sha(prices.bytes),identityPageUrl:identityUrl,identityPageSha256:sha(identity.bytes),url:mrfUrl,fileSha256:sha(file.bytes),bytesRetained:file.bytes.length,http_status:file.response.status,checked_at:now,date:n.declared_last_updated,version:n.cms_template_version,location_name:n.declared_location_name,declared_hospital_name:n.declared_hospital_name,declared_address:n.declared_address,declared_license_state:n.declared_license_state,observedFinding:'compliant-observed'};
 const entry={ccn,base,action:'replace',evidence,evidence_run:'st-anthony-warwick-first-party-header-proof-2026-09-17',reviewed_at:now,note:'WMCHealth current identity/contact and price-transparency pages identify St. Anthony Community Hospital at 15 Maple Avenue, Warwick NY 10990 and link the pointer-declared CSV. The bounded CSV header identifies St Anthony Community Hospital at the same address and NY state, with 2026-06-30/CMS 3.0.0. This resolves the generic identity review without asserting full-file validity.'};
 const lp=path.join(audit,'reviewed-resolutions.json'),ledger=JSON.parse(fs.readFileSync(lp,'utf8')),old=ledger.find(r=>r.ccn===ccn);if(old&& (old.evidence_run!==entry.evidence_run||JSON.stringify(old.evidence)!==JSON.stringify(evidence)))throw Error('existing resolution differs');if(!old){ledger.push(entry);ledger.sort((a,b)=>a.ccn.localeCompare(b.ccn));fs.writeFileSync(lp,JSON.stringify(ledger,null,2)+'\n');} console.log(JSON.stringify({ccn,applied:!old,file_sample_sha256:sha(file.bytes)}));
})().catch(e=>{console.error(e.stack||e);process.exitCode=1;});
