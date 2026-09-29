'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { parsePointer } = require('../lib/parse');
const { parsePayload } = require('../lib/recovery-transport');
const { normalizeName } = require('../lib/util');
const { strongAddressAgreement } = require('../lib/mrf-header-match');
const { loadReviewedView } = require('../lib/reviewed-resolutions');
const { pageSupportsCampus } = require('../capture-prime-unmatched-pointer-file-proofs');

const root = path.resolve(__dirname, '../../..');
const audit = path.join(root, 'data/hpt-audit');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

test('seven formerly unassigned Prime pointers have distinct, retained page/pointer/file proof', async () => {
  const proof = require(path.join(audit, 'reconciliation-prime-unmatched-pointer-file-proofs.json'));
  assert.deepEqual(proof.successful_ccns, ['050580', '050709', '050764', '150183', '170009', '290009', '450855']);
  assert.deepEqual(proof.rejected, []);
  assert.equal(new Set(proof.records.map(row => row.ccn)).size, 7);
  const ledger = require(path.join(audit, 'reviewed-resolutions.json'));
  const view = loadReviewedView(audit);
  const byCcn = new Map(view.compliance.map(row => [row.ccn, row]));
  for (const row of proof.records) {
    const page = fs.readFileSync(path.join(root, row.identity_page_retained_file));
    const pointer = fs.readFileSync(path.join(root, row.pointer_retained_file));
    const sample = fs.readFileSync(path.join(root, row.file_retained_sample));
    assert.equal(sha(page), row.identity_page_sha256);
    assert.equal(sha(pointer), row.pointer_sha256);
    assert.equal(sha(sample), row.file_sample_sha256);
    assert.ok(sample.length >= 65536);
    assert.ok(pageSupportsCampus(page.toString('utf8'), row.roster_name === 'SAINT MARY\'S REGIONAL MEDICAL CENTER'
      ? 'Saint Mary' : row.roster_name.replaceAll('MEDICAL CENTER', 'Medical Center'),
    row.roster_address.match(/\d+/)[0], row.roster_city, row.roster_zip));
    assert.ok(parsePointer(pointer.toString('utf8')).entries.some(entry =>
      normalizeName(entry.locationName) === normalizeName(row.roster_name)
        && entry.mrfUrls?.includes(row.pointer_mrf_url)));
    const parsed = (await parsePayload(sample, 'application/json')).parsed.find(item => item.innerKind === 'json');
    assert.equal(normalizeName(parsed.mrfHospitalName), normalizeName(row.roster_name));
    assert.ok(strongAddressAgreement(row.roster_address, parsed.mrfAddress));
    assert.equal(parsed.mrfLicenseState, row.roster_state);
    assert.equal(parsed.cmsVersion, '3.0');
    const resolution = ledger.find(item => item.ccn === row.ccn);
    assert.equal(resolution.evidence.url, row.pointer_mrf_url);
    assert.equal(resolution.evidence.observedFinding, 'mrf-template-version-noncanonical');
    assert.equal(byCcn.get(row.ccn).mrf_url, row.pointer_mrf_url);
    assert.equal(byCcn.get(row.ccn).finding, 'mrf-template-version-noncanonical');
    assert.equal(view.history[row.ccn].mrf_url, row.displaced_file_url);
  }
});
