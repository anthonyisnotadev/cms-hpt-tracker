const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../../..');
const audit = path.join(root, 'data', 'hpt-audit');
const proof = JSON.parse(fs.readFileSync(path.join(audit,
  'reconciliation-pih-downey-first-party-browser-link-crosscheck-2026-09-28.json'), 'utf8'));
const manual = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-manual-access-observations.json'), 'utf8'))
  .records.find(row => row.ccn === '050393');
const browser = JSON.parse(fs.readFileSync(path.join(audit, 'nationwide-browser-reviews.json'), 'utf8'))
  .records.find(row => row.ccn === '050393');
const nationwide = JSON.parse(fs.readFileSync(path.join(audit, 'nationwide-verification.json'), 'utf8'))
  .records.find(row => row.ccn === '050393');

assert.equal(proof.official_pricing_page.status, 'rendered');
assert.equal(proof.official_file_link.label, 'Hospital Payer Payments');
assert.equal(proof.official_file_link.first_party_link_confirmed, true);
assert.equal(manual.latest_first_party_browser_link_crosscheck_2026_09_28.proof_file,
  'reconciliation-pih-downey-first-party-browser-link-crosscheck-2026-09-28.json');
assert.equal(manual.disposition, 'official-page-file-link-confirmed-file-access-denied');
assert.equal(manual.candidate_file_status, '403-access-denied');
assert.equal(browser.proof_file, 'reconciliation-pih-downey-first-party-browser-link-crosscheck-2026-09-28.json');
assert.equal(browser.file_sha256, '');
assert.equal(nationwide.ccn, '050393');
assert.ok(!/^verified-|^scope-exempt/.test(nationwide.disposition));
assert.match(proof.next_action, /Do not repeat the same direct request/);

console.log('PIH Downey official page-to-file attribution is recorded; blocked file bytes and unresolved CCN status are preserved.');
