'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const proofName = 'reconciliation-glendive-fy27-repeat-download-proof-2026-09-25.json';
const proof = JSON.parse(fs.readFileSync(path.join(audit, proofName), 'utf8'));
const file = path.join(audit, 'reconciliation-manual-access-observations.json');
const document = JSON.parse(fs.readFileSync(file, 'utf8'));
const index = document.records.findIndex(record => record.ccn === proof.ccn);
if (index < 0) throw new Error(`missing manual observation for ${proof.ccn}`);
const prior = document.records[index];
document.records[index] = {
  ...prior,
  repeat_download_recheck: {
    proof_file: proofName,
    observed_at: proof.observed_at,
    route: proof.retrieval_route,
    file_bytes: proof.file_bytes,
    file_sha256: proof.file_sha256,
    header_sha256: proof.header_sha256,
    result: proof.result,
  },
};
document.records.sort((a, b) => a.ccn.localeCompare(b.ccn));
fs.writeFileSync(file, JSON.stringify(document, null, 2) + '\n');
console.log(JSON.stringify({ updated: proof.ccn, file_sha256: proof.file_sha256 }, null, 2));
