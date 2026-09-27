const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const auditDir = path.resolve(__dirname, '../../../data/hpt-audit');
const proof = JSON.parse(fs.readFileSync(path.join(auditDir, 'reconciliation-nor-lea-current-enrollment-crosswalk-proof-2026-09-27.json'), 'utf8'));
const observations = JSON.parse(fs.readFileSync(path.join(auditDir, 'reconciliation-manual-access-observations.json'), 'utf8')).records;
const worklistData = JSON.parse(fs.readFileSync(path.join(auditDir, 'unresolved-investigation-worklist.json'), 'utf8'));
const worklist = Array.isArray(worklistData) ? worklistData : worklistData.records;
const record = observations.find(item => item.ccn === '321305');
const queued = worklist.find(item => item.ccn === '321305');

assert.equal(proof.ccn, '321305');
assert.equal(proof.source.row['NPI'], '1881630036');
assert.equal(proof.source.row['ADDRESS LINE 1'], '1600 N MAIN AVE');
assert.equal(proof.follow_up_source_review.nppes_api.location_address, '1600 NORTH MAIN, LOVINGTON, NM 88260-2813');
assert.match(proof.follow_up_source_review.cms_field_definition, /physical addresses/);
assert.match(proof.crosswalk_result, /1900 North Main Avenue/);
assert.match(proof.interpretation, /material publisher-metadata conflict/);
assert.equal(record.latest_cms_enrollment_crosswalk_2026_09_27.proof_file, 'reconciliation-nor-lea-current-enrollment-crosswalk-proof-2026-09-27.json');
assert.match(record.next_action, /1900 North Main/);
assert.ok(queued, 'Nor-Lea remains in the actionable unresolved worklist');
assert.match(queued.next_action, /1900 North Main/);
