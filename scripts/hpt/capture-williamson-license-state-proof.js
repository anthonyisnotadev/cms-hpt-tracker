'use strict';
const crypto = require('crypto'), fs = require('fs'), path = require('path'), childProcess = require('child_process');
const root = path.resolve(__dirname, '../..'), audit = path.join(root, 'data/hpt-audit');
const pointerUrl = 'https://www.williamsonmemorial.net/cms-hpt.txt';
const mrfUrl = 'https://www.williamsonmemorial.net/assets/pdf/852143734_Williamson_Memorial_Inc._Standard_Charges_V3_.0.0_Wide_CSV_Format_.3.30.26csv_.csv';
const identityUrl = 'https://www.williamsonmemorial.net/price-transparency';
const sha = body => crypto.createHash('sha256').update(body).digest('hex');
async function get(url, headers = {}) { try { const response = await fetch(url, { headers }); return { response, body: Buffer.from(await response.arrayBuffer()) }; } catch { const args = ['-L','--fail','--silent','--show-error']; if(headers.Range) args.push('--range',headers.Range.replace(/^bytes=/,'')); args.push(url); const body=childProcess.execFileSync('curl.exe',args,{maxBuffer:2*1024*1024}); return {response:{ok:true,status:headers.Range?206:200,url},body}; } }
(async()=>{
  const observedAt=new Date().toISOString(), pointer=await get(pointerUrl), file=await get(mrfUrl,{Range:'bytes=0-1048575'}), identity=await get(identityUrl);
  if(!pointer.response.ok||![200,206].includes(file.response.status)||!identity.response.ok)throw Error('Capture failed');
  const pt=pointer.body.toString('utf8'), ft=file.body.toString('utf8'), it=identity.body.toString('utf8');
  if(!pt.toLowerCase().includes('williamson memorial')||!pt.includes(mrfUrl))throw Error('Pointer changed');
  for(const token of ['license_number|CA','182 |WV','Williamson Memorial, Inc.','859 Alderson Street, Williamson, WV 25661','3/12/2026','3.0.0'])if(!ft.toLowerCase().includes(token.toLowerCase()))throw Error(`File lacks ${token}`);
  for(const token of ['Williamson Memorial','859 Alderson St','Williamson, WV 25661'])if(!it.toLowerCase().includes(token.toLowerCase()))throw Error(`Identity page lacks ${token}`);
  const sample='cms_data/hpt/nationwide-verification/file-byte-proof/williamson-license-state-510094.bin'; fs.writeFileSync(path.join(root,sample),file.body);
  const proof={ccn:'510094',observed_at:observedAt,pointer_url:pointerUrl,pointer_http_status:pointer.response.status,pointer_sha256:sha(pointer.body),mrf_url:mrfUrl,mrf_http_status:file.response.status,mrf_final_url:file.response.url,retained_sample:sample,retained_bytes:file.body.length,mrf_sample_sha256:sha(file.body),identity_page_url:identityUrl,identity_page_sha256:sha(identity.body),declared_hospital_name:'Williamson Memorial, Inc.',declared_location_name:'Williamson Memorial, Inc.',declared_address:'859 Alderson Street, Williamson, WV 25661',declared_license_state:'CA',license_value_state:'WV',facility_state:'WV',declared_date:'2026-03-12',version:'3.0.0'};
  fs.writeFileSync(path.join(audit,'reconciliation-williamson-license-state-proof.json'),JSON.stringify(proof,null,2)+'\n'); console.log(JSON.stringify({captured:proof.ccn,bytes:proof.retained_bytes},null,2));
})().catch(e=>{console.error(e);process.exitCode=1});
