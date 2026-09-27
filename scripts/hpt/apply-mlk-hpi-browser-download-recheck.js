'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const proofName = 'reconciliation-mlk-hpi-browser-download-recheck-proof-2026-09-25.json';
const proof = JSON.parse(fs.readFileSync(path.join(audit, proofName), 'utf8'));
const file = path.join(audit, 'reconciliation-manual-access-observations.json');
const document = JSON.parse(fs.readFileSync(file, 'utf8'));
const index = document.records.findIndex(record => record.ccn === proof.ccn);
if (index < 0) throw new Error(`missing manual observation for ${proof.ccn}`);
const prior = document.records[index];
document.records[index] = {
  ...prior,
  latest_hpi_browser_download_recheck: {
    proof_file: proofName,
    observed_at: proof.observed_at,
    portal_url: proof.portal_url,
    portal_status: proof.portal_status,
    portal_last_update: proof.portal_last_update,
    file_url: proof.file_url,
    download_artifact_observed: proof.download_artifact_observed,
    result: proof.result,
  },
};
document.records.sort((a, b) => a.ccn.localeCompare(b.ccn));
fs.writeFileSync(file, JSON.stringify(document, null, 2) + '\n');
console.log(JSON.stringify({ updated: proof.ccn, download_artifact_observed: proof.download_artifact_observed }, null, 2));
