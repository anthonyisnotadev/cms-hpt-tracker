'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { applyResolutions, loadReviewedView } = require('../lib/reviewed-resolutions');
const { reviewedResolutionSupersedes } = require('../lib/reconciliation-precedence');

const audit = path.resolve(__dirname, '../../../data/hpt-audit');

test('Las Encinas correction removes the sibling site and stale file without promoting the page CSV', () => {
  const view = loadReviewedView(audit);
  const row = view.compliance.find(item => item.ccn === '054078');
  assert.equal(row.domain, 'lasencinashospital.com');
  assert.equal(row.finding, 'not-assessed-site-corrected');
  assert.equal(row.assessable, 'no');
  assert.equal(row.pointer_url, '');
  assert.equal(row.mrf_url, '');
  assert.equal(view.manifest.some(item => item.ccn === '054078'), false);
  assert.equal(view.gaps.find(item => item.ccn === '054078')?.remediation, 'corrected-site-follow-up');
  assert.equal(view.history['054078'].domain, 'vistadelmarhospital.com');

  const record = JSON.parse(fs.readFileSync(path.join(audit, 'nationwide-verification.json'), 'utf8'))
    .records.find(item => item.ccn === '054078');
  assert.equal(record.official_domain, 'lasencinashospital.com');
  assert.equal(record.pointer_result, '200');
  assert.equal(record.mrf_url, 'https://www.lasencinashospital.com/wp-content/uploads/2026/07/32-0039155_Aurora-Las-Encinas-LLC_standardcharges_1.csv');
  assert.equal(record.disposition, 'pointer-linked-file-review-pending');
  assert.equal(record.mrf_state, 'linked-file-retrieved-metadata-limited');
  assert.equal(record.evidence.linked_mrf_candidates, 0);
  assert.equal(reviewedResolutionSupersedes({ action: 'correct-site',
    reviewed_at: '2026-09-16T12:35:42.000Z' }, record.observed_at), false);
});

test('site correction is base-guarded and requires first-party evidence', () => {
  const base = { ccn: '054078', finding: 'mrf-url-unreachable', domain: 'vistadelmarhospital.com',
    pointer_url: 'https://www.vistadelmarhospital.com/cms-hpt.txt', mrf_url: 'old.csv',
    checked_at: '2026-09-07T00:33:22.513Z' };
  const correction = { ccn: base.ccn, base: { finding: base.finding, domain: base.domain,
    pointer_url: base.pointer_url, mrf_url: base.mrf_url, checked_at: base.checked_at },
    action: 'correct-site', official: { domain: 'lasencinashospital.com' },
    reviewed_at: '2026-09-16T12:35:42.000Z', evidence: { checked_at: '2026-09-16T12:35:42.000Z',
      identityPageUrl: 'https://www.lasencinashospital.com/contact/', identityPageSha256: 'a'.repeat(64),
      facilityName: 'Las Encinas', facilityAddress: 'Pasadena, CA',
      rootPointerUrl: 'https://www.lasencinashospital.com/cms-hpt.txt', rootPointerHttpStatus: 404 } };
  assert.equal(applyResolutions([{ ...base, checked_at: '2026-09-17T00:00:00Z' }], [], [], [correction])
    .compliance[0].domain, base.domain);
  assert.throws(() => applyResolutions([base], [], [], [{ ...correction,
    evidence: { ...correction.evidence, identityPageSha256: '' } }]));
});
