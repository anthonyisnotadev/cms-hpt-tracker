const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.resolve(__dirname, '../../..');
const proof = JSON.parse(fs.readFileSync(path.join(root, 'data/hpt-audit/reconciliation-taylor-regional-cross-facility-portal-proof-2026-09-20.json'), 'utf8'));
const manual = JSON.parse(fs.readFileSync(path.join(root, 'data/hpt-audit/reconciliation-manual-access-observations.json'), 'utf8'));
const rec = JSON.parse(fs.readFileSync(path.join(root, 'data/hpt-audit/nationwide-reconciliation.json'), 'utf8')).records.find((x) => x.ccn === '110256');

assert.equal(proof.ccn, '110256');
assert.equal(proof.portal_browser_observation.http_status, 200);
assert.equal(proof.portal_browser_observation.displayed_contact_phone_area_code, '270');
assert.equal(proof.portal_browser_observation.file_bytes_retrieved, false);
assert.equal(proof.disposition, 'cross-facility-portal-excluded-no-georgia-mrf-promotion');
const entry = manual.records.find((x) => x.ccn === '110256');
assert(entry);
assert.equal(entry.latest_cross_facility_portal_observation.proof_file, 'reconciliation-taylor-regional-cross-facility-portal-proof-2026-09-20.json');
assert.equal(rec.manual_access_observation.latest_cross_facility_portal_observation.disposition, 'cross-facility-portal-excluded-no-georgia-mrf-promotion');
console.log('Taylor Regional cross-facility portal assertions passed.');
