const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.resolve(__dirname, '../../..');
const proof = JSON.parse(fs.readFileSync(path.join(root, 'data/hpt-audit/reconciliation-eamc-lanier-cms-reh-identity-recheck-2026-09-20.json'), 'utf8'));
const manual = JSON.parse(fs.readFileSync(path.join(root, 'data/hpt-audit/reconciliation-manual-access-observations.json'), 'utf8'));
const rec = JSON.parse(fs.readFileSync(path.join(root, 'data/hpt-audit/nationwide-reconciliation.json'), 'utf8')).records.find((x) => x.ccn === '010780');

assert.equal(proof.ccn, '010780');
assert.equal(proof.cms_row.facility_id, '010780');
assert.equal(proof.cms_row.state, 'AL');
assert.equal(proof.cms_row.address, '4800 48TH STREET');
assert.equal(proof.disposition, 'current-cms-reh-identity-corroborated-pointer-file-still-unresolved');
assert.equal(manual.records.find((x) => x.ccn === '010780').latest_cms_reh_identity_recheck.proof_file, 'reconciliation-eamc-lanier-cms-reh-identity-recheck-2026-09-20.json');
assert.equal(rec.manual_access_observation.latest_cms_reh_identity_recheck.disposition, 'current-cms-reh-identity-corroborated-pointer-file-still-unresolved');
console.log('EAMC-Lanier CMS REH identity recheck assertions passed.');
