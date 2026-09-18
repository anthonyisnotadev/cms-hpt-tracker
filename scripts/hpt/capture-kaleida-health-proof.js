'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const privateDir = path.join(root, 'cms_data/hpt/nationwide-verification');
const pointerUrl = 'https://www.kaleidahealth.org/cms-hpt.txt';
const mrfUrl = 'https://hospitalpricedisclosure.com/download.aspx?pi=8O1flKb9ncxmFbwWjt6PBg*-*';
const mrfRetrievalUrl = 'https://cleverleypteusstatic.blob.core.windows.net/readable/161533232_kaleida-health_standardcharges.json';
const identityUrl = 'https://www.kaleidahealth.org/physician-careers/';
const sha = value => crypto.createHash('sha256').update(value).digest('hex');

async function get(url, headers = {}) {
  const response = await fetch(url, { headers, redirect: 'follow' });
  const body = Buffer.from(await response.arrayBuffer());
  return { response, body };
}

(async () => {
  const observedAt = new Date().toISOString();
  const pointer = await get(pointerUrl);
  let file;
  try { file = await get(mrfUrl, { Range: 'bytes=0-1048575' }); }
  catch { file = await get(mrfRetrievalUrl, { Range: 'bytes=0-1048575' }); }
  const identity = await get(identityUrl);
  if (!pointer.response.ok || ![200, 206].includes(file.response.status) || !identity.response.ok)
    throw new Error(`Capture failed: pointer=${pointer.response.status}, file=${file.response.status}, identity=${identity.response.status}`);
  const pointerText = pointer.body.toString('utf8');
  const fileText = file.body.toString('utf8');
  const identityText = identity.body.toString('utf8');
  if (!pointerText.includes('location-name: Buffalo General Medical Center') || !pointerText.includes(mrfUrl))
    throw new Error('Current pointer no longer links the reviewed Buffalo General MRF');
  for (const token of ['Kaleida Health', 'Buffalo General Medical Center', '100 High Street', '2026-04-01', '3.0.0'])
    if (!fileText.includes(token)) throw new Error(`Retained file bytes lack ${token}`);
  for (const token of ['Buffalo General Medical Center', '100 High Street', 'Buffalo, NY 14203'])
    if (!identityText.includes(token)) throw new Error(`Official identity page lacks ${token}`);
  const sampleRel = 'cms_data/hpt/nationwide-verification/file-byte-proof/kaleida-health-330005.bin';
  fs.writeFileSync(path.join(root, sampleRel), file.body);
  const proof = {
    ccn: '330005', observed_at: observedAt, official_domain: 'kaleidahealth.org',
    pointer_url: pointerUrl, pointer_http_status: pointer.response.status, pointer_sha256: sha(pointer.body),
    pointer_location_name: 'Buffalo General Medical Center', mrf_url: mrfUrl,
    mrf_retrieval_url: mrfRetrievalUrl, mrf_final_url: file.response.url, mrf_http_status: file.response.status,
    retained_sample: sampleRel.replaceAll('\\', '/'), retained_bytes: file.body.length,
    mrf_sample_sha256: sha(file.body), declared_hospital_name: 'Kaleida Health',
    declared_location_name: 'Buffalo General Medical Center',
    declared_address: '100 High Street, Buffalo, NY 14214', declared_state: 'NY',
    declared_date: '2026-04-01', version: '3.0.0',
    identity_page_url: identityUrl, identity_page_http_status: identity.response.status,
    identity_page_sha256: sha(identity.body), official_address: '100 High Street, Buffalo, NY 14203',
    roster_address: '100 HIGH STREET, BUFFALO, NY 14210',
    caveat: 'Street, city and state agree; ZIP differs across CMS roster, current MRF and current official site.'
  };
  fs.writeFileSync(path.join(audit, 'reconciliation-kaleida-health-proof.json'), `${JSON.stringify(proof, null, 2)}\n`);
  console.log(JSON.stringify(proof, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
