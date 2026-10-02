'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const proofName = 'reconciliation-hoboken-complete-file-byte-equality-proof-2026-10-01.json';
const proof = JSON.parse(fs.readFileSync(path.join(audit, proofName), 'utf8'));
if (proof.ccn !== '310040'
  || proof.complete_file_equality?.identical !== true
  || proof.complete_file_equality?.page_file_bytes !== 191019559
  || proof.complete_file_equality?.pointer_cdn_file_bytes !== 191019559
  || proof.complete_file_equality?.page_file_sha256 !== '031eee20b78e7f61a7eb1581245b238e9c3958faae3b42950ec116e58f15aef8'
  || proof.complete_file_equality?.page_file_sha256 !== proof.complete_file_equality?.pointer_cdn_file_sha256) {
  throw new Error('Hoboken complete-file equality proof is incomplete or changed; review before applying');
}

const manualPath = path.join(audit, 'reconciliation-manual-access-observations.json');
const manualDoc = JSON.parse(fs.readFileSync(manualPath, 'utf8'));
const observation = {
  ccn: proof.ccn,
  observed_at: proof.observed_at,
  proof_file: proofName,
  latest_pointer_file_recheck: {
    pointer_status: 200,
    pointer_url: proof.url_pointer_cdn_file,
    pointer_url_relation: 'complete-file-byte-equality-established',
    complete_file_bytes: proof.complete_file_equality.pointer_cdn_file_bytes,
    complete_file_sha256: proof.complete_file_equality.pointer_cdn_file_sha256,
    page_file_url: proof.url_page_file,
    page_file_sha256: proof.complete_file_equality.page_file_sha256,
    note: 'Both exact URLs retrieved completely and hashed; identical length and SHA-256. The pointer/page URL equivalence gate for CCN 310040 is cleared. CMS validator-grade full-file review has not yet been performed, so no disposition change is applied.'
  },
  disposition: 'pointer-facility-match-unresolved',
  next_action: proof.next_step
};
const existingIndex = manualDoc.records.findIndex(record => record.ccn === proof.ccn
  && record.observed_at === proof.observed_at);
if (existingIndex >= 0) manualDoc.records[existingIndex] = observation;
else manualDoc.records.push(observation);
fs.writeFileSync(manualPath, `${JSON.stringify(manualDoc, null, 2)}\n`);
console.log(JSON.stringify({ applied: true, ccn: proof.ccn, action: existingIndex >= 0 ? 'update' : 'append' }));
