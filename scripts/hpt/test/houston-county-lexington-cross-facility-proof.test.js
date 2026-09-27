const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.resolve(__dirname, '../../..');
const read = (name) => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
const proof = read('data/hpt-audit/reconciliation-houston-county-lexington-cross-facility-proof-2026-09-27.json');
const manual = read('data/hpt-audit/reconciliation-manual-access-observations.json');
const current = read('data/hpt-audit/nationwide-verification.json').records.find((x) => x.ccn === '441322');
const investigation = read('data/hpt-audit/unresolved-investigation-worklist.json').records.find((x) => x.ccn === '441322');
const roster = read('data/hpt-audit/reconciliation-891-baseline-member-roster-2026-09-27.json');
const cmsRows = fs.readFileSync(path.join(root, 'cms_data/Hospital_General_Information.csv'), 'utf8').split(/\r?\n/);

const observation = manual.records.find((x) => x.ccn === '441322');
const crossFacility = observation.latest_cross_facility_address_review_2026_09_27;
const cmsHenderson = cmsRows.find((row) => row.startsWith('440008,'));
const cohort = roster.current_crosswalk_ccns['genuinely-unresolved'];

assert.equal(proof.ccn_under_review, '441322');
assert.equal(proof.current_facility_crosswalk.henderson_ccn, '440008');
assert.match(proof.current_facility_crosswalk.cms_record_observation, /200 W CHURCH ST, LEXINGTON, TN 38351/);
assert(cmsHenderson, 'CMS general information must retain the separate Henderson facility record');
assert.equal(proof.houston_county_conflicting_file.declared_address, '200 West Church St, Lexington, TN 38351');
assert.equal(proof.houston_county_conflicting_file.declared_license_value, '441322');
assert.equal(proof.evidence_gain_vs_recheck.disposition_change, 'None. CCN 441322 remains unresolved with its address/name discrepancy visible; no file reassignment, MRF verification, or compliance conclusion is made.');
assert.equal(crossFacility.proof_file, 'reconciliation-houston-county-lexington-cross-facility-proof-2026-09-27.json');
assert.equal(crossFacility.disposition, 'retain-unmatched-address-conflict');
assert.equal(current.disposition, 'linked-mrf-header-unmatched');
assert.notEqual(current.disposition, 'verified-current-mrf');
assert.equal(investigation.current_disposition, 'linked-mrf-header-unmatched');
assert.match(investigation.next_action, /Henderson County Community Hospital CCN 440008/);
assert(cohort.includes('441322'), 'Houston County must remain unresolved in the historical 891-member cohort');
assert.equal(roster.summary.category_membership_sum, 891);
assert.equal(roster.summary.unique_ccns, 720);
assert.equal(roster.summary.overlap_ccns, 171);
console.log('Houston County / Henderson cross-facility proof assertions passed.');
