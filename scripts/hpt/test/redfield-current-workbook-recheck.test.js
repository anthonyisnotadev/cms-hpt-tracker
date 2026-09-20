const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.resolve(__dirname, '../../..');
const proof = JSON.parse(fs.readFileSync(path.join(root, 'data/hpt-audit/reconciliation-redfield-current-workbook-recheck-2026-09-20.json'), 'utf8'));
const manual = JSON.parse(fs.readFileSync(path.join(root, 'data/hpt-audit/reconciliation-manual-access-observations.json'), 'utf8'));
const rec = JSON.parse(fs.readFileSync(path.join(root, 'data/hpt-audit/nationwide-reconciliation.json'), 'utf8')).records.find((x) => x.ccn === '431316');

assert.equal(proof.ccn, '431316');
assert.equal(proof.workbook_observation.source_link_present, true);
assert.equal(proof.workbook_observation.declared_format, 'xlsx');
assert.equal(proof.workbook_observation.bytes_retrieved, false);
assert.equal(proof.disposition, 'official-custom-workbook-historical-current-link-no-cms-mrf-promotion');
assert.equal(manual.records.find((x) => x.ccn === '431316').latest_workbook_recheck.proof_file, 'reconciliation-redfield-current-workbook-recheck-2026-09-20.json');
assert.equal(rec.manual_access_observation.latest_workbook_recheck.disposition, 'official-custom-workbook-historical-current-link-no-cms-mrf-promotion');
console.log('Redfield workbook recheck assertions passed.');
