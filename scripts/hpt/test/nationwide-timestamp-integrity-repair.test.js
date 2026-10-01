'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../../..');
const audit = path.join(root, 'data/hpt-audit');
const read = name => JSON.parse(fs.readFileSync(path.join(audit, name), 'utf8'));

test('future-dated Sep 29 review times remain rejected history, not effective observations', () => {
  const corrections = [
    {
      ccn: '010780',
      proof: 'reconciliation-eamc-lanier-current-cms-reh-dataset-crosscheck-2026-09-29.json',
      prior: '2026-09-29T11:44:00Z',
    },
    {
      ccn: '050455',
      proof: 'reconciliation-adventist-bakersfield-public-directory-crosscheck-2026-09-29.json',
      prior: '2026-09-29T11:06:00Z',
    },
    {
      ccn: '140228',
      proof: 'reconciliation-uw-swedishamerican-campus-scope-crosscheck-2026-09-29.json',
      prior: '2026-09-29T10:34:00Z',
    },
  ];
  const browser = read('nationwide-browser-reviews.json');
  const manual = read('reconciliation-manual-access-observations.json');

  for (const item of corrections) {
    const proof = read(item.proof);
    assert.equal(proof.original_recorded_observed_at, item.prior);
    assert.equal(proof.observed_at, '2026-09-29T10:16:55Z');
    assert.equal(proof.timestamp_integrity_review.checked_at_utc, proof.observed_at);
    assert.match(proof.timestamp_integrity_review.original_recorded_timestamp_status, /future-dated/);

    const browserRecord = browser.records.find(record => record.ccn === item.ccn
      && record.proof_file === item.proof);
    assert.ok(browserRecord, `browser ledger must retain ${item.ccn}`);
    assert.equal(browserRecord.observed_at, proof.observed_at);

    const manualRecord = manual.records.find(record => record.ccn === item.ccn
      && record[item.ccn === '010780'
        ? 'latest_cms_reh_dataset_crosscheck_2026_09_29'
        : item.ccn === '050455'
          ? 'latest_public_directory_crosscheck_2026_09_29'
          : 'proof_file']
      && (item.ccn !== '140228' || record.proof_file === item.proof));
    assert.ok(manualRecord, `manual ledger must retain ${item.ccn}`);
    if (item.ccn === '140228') {
      assert.equal(manualRecord.observed_at, '2026-09-29T10:46:29Z',
        'preserve the later live page-pointer crosscheck independently of the earlier timestamp-corrected proof');
      assert.equal(manualRecord.latest_live_price_page_pointer_url_crosscheck.observed_at, manualRecord.observed_at);
      assert.equal(manualRecord.latest_live_price_page_pointer_url_crosscheck.proof_file,
        'reconciliation-uw-health-belvidere-current-price-page-pointer-url-crosscheck-2026-09-29.json');
    } else {
      const nested = manualRecord[item.ccn === '010780'
        ? 'latest_cms_reh_dataset_crosscheck_2026_09_29'
        : 'latest_public_directory_crosscheck_2026_09_29'];
      assert.equal(nested.original_recorded_observed_at, item.prior);
      assert.equal(nested.observed_at, proof.observed_at);
    }
  }
});
