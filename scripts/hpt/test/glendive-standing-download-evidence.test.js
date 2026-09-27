'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../../..');
const audit = path.join(root, 'data/hpt-audit');
const manual = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-manual-access-observations.json'), 'utf8'));
const worklist = JSON.parse(fs.readFileSync(path.join(audit, 'unresolved-investigation-worklist.json'), 'utf8'));
const record = manual.records.find(item => item.ccn === '271332');
const queue = worklist.records.find(item => item.ccn === '271332');
const standing = record.standing_observation;

assert.equal(standing.proof_file, 'reconciliation-glendive-current-fy27-browser-download-proof-2026-09-25.json');
assert.equal(standing.file_bytes, 1414938);
assert.equal(standing.file_sha256, '191ffde6e68a4fbb7b489cf6da361b0990b381b9a8f98de7a143cea39437b4f2');
assert.equal(standing.schema_status, 'custom-chargemaster-no-CMS-name-address-date-version-fields');
assert.match(record.interpretation, /completely retrieved and independently hash-rechecked/);
assert.match(record.next_action, /Do not repeat the same page-file request/);
assert.ok(queue, 'Glendive remains in the actionable unresolved worklist');
assert.match(queue.next_action, /complete 1,414,938-byte custom chargemaster/);
assert.match(queue.next_action, /distinct pointer-declared Azure MRF/);
