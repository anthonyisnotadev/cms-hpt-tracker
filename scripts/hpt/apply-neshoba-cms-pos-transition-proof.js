'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const proofFile = 'reconciliation-neshoba-cms-pos-transition-proof-2026-09-27.json';
const proof = JSON.parse(fs.readFileSync(path.join(audit, proofFile), 'utf8'));
const observationsFile = path.join(audit, 'reconciliation-manual-access-observations.json');
const document = JSON.parse(fs.readFileSync(observationsFile, 'utf8'));

const shared = {
  observed_at: proof.observed_at,
  proof_file: proofFile,
  cms_dataset_url: proof.source.dataset_url,
  cms_release: proof.source.release,
  cms_rows: proof.cms_rows,
  interpretation: proof.interpretation,
  disposition: proof.disposition,
  unresolved_count_change: proof.unresolved_count_change,
  next_action: proof.next_action
};

const records = proof.ccns.map(ccn => ({
  ccn,
  ...shared,
  record_role: ccn === '250043' ? 'former-acute-care-ccn' : 'active-cah-successor-ccn',
  next_action: ccn === '250043'
    ? 'Retain the QIES POS termination boundary as dated historical evidence and do not assign the 2026-06-04 MRF to 250043. Keep 250043 in the historical accountability baseline; do not claim closure or non-applicability. Determine whether any distinct pre-termination HPT evidence needs to be retained, and preserve the effective-dated status proof in history.'
    : 'CCN 251340 is active in Q1 2026 with original participation date 2026-01-01. Treat the 2026-06-04 campus MRF only as a successor-scope candidate while the current root pointer is inaccessible. Recover current pointer bytes or publisher confirmation binding the exact mrf-url to 251340; retain the stronger standing finding until then.'
}));

document.records = (document.records || []).filter(record =>
  !(record.proof_file === proofFile && proof.ccns.includes(record.ccn))
).concat(records).sort((a, b) => a.ccn.localeCompare(b.ccn)
  || String(a.observed_at).localeCompare(String(b.observed_at)));
fs.writeFileSync(observationsFile, `${JSON.stringify(document, null, 2)}\n`);

console.log(JSON.stringify({
  proof_file: proofFile,
  observations_added: records.map(record => record.ccn),
  unresolved_count_change: proof.unresolved_count_change
}, null, 2));
