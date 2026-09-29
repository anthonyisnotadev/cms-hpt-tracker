'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {retrieve}=require('./lib/recovery-transport');
const root=path.resolve(__dirname,'../..');
const ccn='330270';
const url='https://d2cg6hcwj0g0z0.cloudfront.net/131624135-1598703019_ny-society-for-the-relief-of-ruptured-and-crippled-maintaing-the-hospital-for-special-surgery_standardcharges.json';
const bytes=262144;
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
async function main(){
  const r=await retrieve(url,bytes,{timeoutMs:120000});
  if(![200,206].includes(r.status)||r.body.length!==bytes) throw Error(`HSS range retrieval failed: ${r.status} ${r.body.length}`);
  const b=r.body,d=sha(b),text=b.toString('utf8');
  const required=['Hospital for Special Surgery','535 East 70th Street','NY'];
  const found=required.filter(x=>text.includes(x));
  const rel=`cms_data/hpt/nationwide-verification/file-byte-proof/${d}.bin`,ap=path.join(root,rel);
  fs.mkdirSync(path.dirname(ap),{recursive:true});
  if(fs.existsSync(ap)&&sha(fs.readFileSync(ap))!==d) throw Error('Existing HSS artifact hash mismatch');
  if(!fs.existsSync(ap)) fs.writeFileSync(ap,b);
  const proof={ccn,observed_at:'2026-09-25T14:00:00Z',official_page_url:'https://www.hss.edu/patient-care/paying-for-care/price-transparency',url,http_status:r.status,requested_range:'header-sample-262144',bytes_retained:b.length,sha256:d,raw_artifact:rel,content_type:r.headers?.get?.('content-type')||'',publisher_page_claim:'The official page links this Main Hospital JSON and states the JSON files exceed 500MB.',sample_text_prefix:text.slice(0,1000),identity_tokens_found:found,interpretation:'A permitted bounded range retrieved bytes from the exact first-party page-linked JSON. This is an access/byte-proof gain only; complete-file usability and parsed CMS metadata require a streaming or publisher-provided route.',disposition:'official-page-linked-large-json-bounded-byte-recheck',promotion:'none',next_action:'Use a streaming authorized route or publisher-provided metadata/complete-file validation before promotion.'};
  fs.writeFileSync(path.join(root,'data/hpt-audit/reconciliation-hss-current-range-proof-2026-09-25.json'),JSON.stringify(proof,null,2)+'\n');
  console.log(JSON.stringify({ccn,status:r.status,bytes:b.length,sha256:d,identity_tokens_found:found,artifact:rel}));
}
main().catch(e=>{console.error(e.stack||e);process.exitCode=1});
