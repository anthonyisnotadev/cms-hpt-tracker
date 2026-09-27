const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.resolve(__dirname, '../../..');
const proof = JSON.parse(fs.readFileSync(path.join(root, 'data/hpt-audit/reconciliation-eamc-lanier-cms-reh-identity-recheck-2026-09-20.json'), 'utf8'));
const transitionProof = JSON.parse(fs.readFileSync(path.join(root, 'data/hpt-audit/reconciliation-eamc-lanier-alabama-audit-transition-proof-2026-09-27.json'), 'utf8'));
const manual = JSON.parse(fs.readFileSync(path.join(root, 'data/hpt-audit/reconciliation-manual-access-observations.json'), 'utf8'));
const rec = JSON.parse(fs.readFileSync(path.join(root, 'data/hpt-audit/nationwide-reconciliation.json'), 'utf8')).records.find((x) => x.ccn === '010780');

assert.equal(proof.ccn, '010780');
assert.equal(proof.cms_row.facility_id, '010780');
assert.equal(proof.cms_row.state, 'AL');
assert.equal(proof.cms_row.address, '4800 48TH STREET');
assert.equal(proof.disposition, 'current-cms-reh-identity-corroborated-pointer-file-still-unresolved');
assert.equal(transitionProof.ccn, '010780');
assert.match(transitionProof.auditor_report_excerpt, /November 2024/);
assert.equal(transitionProof.related_cms_identity_proof.cms_ccn, '010780');
assert.equal(transitionProof.related_current_pointer_proof.pointer_lanier_entry_present, false);
assert.equal(transitionProof.disposition_effect.includes('Update'), true);
assert.equal(manual.records.find((x) => x.ccn === '010780' && x.proof_file === 'reconciliation-eamc-lanier-alabama-audit-transition-proof-2026-09-27.json').disposition, 'historical-transition-audit-confirmed-current-reh-mrf-unresolved');
assert.equal(manual.records.find((x) => x.ccn === '010780').proof_file, 'reconciliation-eamc-lanier-current-cms-general-proof-2026-09-25.json');
assert.equal(rec.manual_access_observation.proof_file, 'reconciliation-eamc-lanier-alabama-audit-transition-proof-2026-09-27.json');
assert.equal(rec.manual_access_observation.disposition, 'historical-transition-audit-confirmed-current-reh-mrf-unresolved');
assert.equal(manual.records.find((x) => x.ccn === '010780' && x.proof_file === 'reconciliation-eamc-lanier-current-cms-general-proof-2026-09-25.json').disposition, 'current-cms-reh-identity-corroborated-pointer-file-still-unresolved');
console.log('EAMC-Lanier CMS REH identity recheck assertions passed.');
