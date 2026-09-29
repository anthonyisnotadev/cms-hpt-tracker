'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const proofFile = 'reconciliation-hss-main-mrf-referrer-range-recheck-proof-2026-09-27.json';
const proof = JSON.parse(fs.readFileSync(path.join(audit, proofFile), 'utf8'));
const observationsFile = path.join(audit, 'reconciliation-manual-access-observations.json');
const observations = JSON.parse(fs.readFileSync(observationsFile, 'utf8'));
const record = observations.records.find(item => item.ccn === proof.ccn);

if (!record) throw new Error(`Missing existing manual observation for CCN ${proof.ccn}`);
if (proof.response.status !== 403 || proof.response.content_type !== 'text/html' || proof.response.bytes_read !== 919) {
  throw new Error('Unexpected HSS response; refusing to apply the recorded access-only disposition.');
}
if (!proof.request.range || !proof.request.referer || proof.unresolved_count_change !== 0) {
  throw new Error('Proof is missing bounded-request provenance or count accounting.');
}

record.observed_at = proof.observed_at;
record.proof_file = proofFile;
record.disposition = proof.disposition;
record.interpretation = proof.interpretation;
record.next_action = proof.next_action;
record.latest_referrer_range_recheck_2026_09_27 = {
  observed_at: proof.observed_at,
  proof_file: proofFile,
  request_range: proof.request.range,
  request_referer: proof.request.referer,
  page_notice: proof.source_page.page_notice,
  response_status: proof.response.status,
  response_content_type: proof.response.content_type,
  response_bytes: proof.response.bytes_read,
  response_sha256: proof.response.body_sha256,
  result: 'CloudFront returned denial HTML; no MRF bytes or metadata were obtained.',
  unresolved_count_change: proof.unresolved_count_change
};

fs.writeFileSync(observationsFile, `${JSON.stringify(observations, null, 2)}\n`);
console.log(JSON.stringify({
  ccn: proof.ccn,
  proof_file: proofFile,
  disposition: record.disposition,
  unresolved_count_change: proof.unresolved_count_change
}, null, 2));
