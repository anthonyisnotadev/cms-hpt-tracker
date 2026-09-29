const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.resolve(__dirname, '../../..');
const proof = JSON.parse(fs.readFileSync(path.join(root, 'data/hpt-audit/reconciliation-yukon-kuskokwim-portal-download-recheck-2026-09-20.json'), 'utf8'));
const manual = JSON.parse(fs.readFileSync(path.join(root, 'data/hpt-audit/reconciliation-manual-access-observations.json'), 'utf8'));
const rec = JSON.parse(fs.readFileSync(path.join(root, 'data/hpt-audit/nationwide-reconciliation.json'), 'utf8')).records.find((x) => x.ccn === '020018');

assert.equal(proof.ccn, '020018');
assert.equal(proof.browser_route.page_http_status, 200);
assert.equal(proof.browser_route.standard_charges_control, "DownloadReport('CDMWithoutLabel')");
assert.equal(proof.browser_route.download_url_exposed, false);
assert.equal(proof.disposition, 'official-portal-current-list-confirmed-download-bytes-unresolved-no-promotion');
const entry = manual.records.find((x) => x.ccn === '020018');
assert(entry);
assert.equal(entry.latest_portal_download_recheck.proof_file, 'reconciliation-yukon-kuskokwim-portal-download-recheck-2026-09-20.json');
assert.equal(rec.manual_access_observation.latest_portal_download_recheck.observed_at, '2026-09-20T00:35:00Z');
assert.equal(rec.manual_access_observation.disposition, 'official-portal-current-list-confirmed-download-bytes-unresolved-no-promotion');
console.log('Yukon-Kuskokwim portal download recheck assertions passed.');
