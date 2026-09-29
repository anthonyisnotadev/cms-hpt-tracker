'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { classify, reconcile, digest, applyDiscoveryReviews, LABELS, parsePointerEntries, matchPointerEntry } = require('../lib/discovery-review');
const reviewed = fields => ({ reviewed_at: '2026-09-14T00:00:00Z', reason: 'Observed evidence', next_action: 'Verify next stage', sources: ['fixture'], ...fields });
const website = { identity: 'corroborated', domain: 'hospital.test', name_evidence: 'first-party name', address_evidence: 'first-party street and city' };

test('cross-run reconciliation deduplicates cached objects regardless of property order and preserves conflicts', () => {
  const rows = reconcile([
    { observation: { ccn: '1', status: '200', checked_at: '2026-09-01' }, sources: ['run1'] },
    { observation: { status: '200', checked_at: '2026-09-01', ccn: '1' }, sources: ['run2', 'run1'] },
    { observation: { ccn: '1', status: '403', checked_at: '2026-09-02' }, sources: ['run3'] }
  ]);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.find(r => r.observation.status === '200').sources, ['run1', 'run2']);
});
test('missing coverage is pending, not a completed empty search', () => {
  assert.equal(classify(null), 'review-pending');
  assert.equal(classify(reviewed({ search: { completed: true } })), 'review-pending');
  assert.equal(classify(reviewed({ search: { completed: true, results_adjudicated: true } })), 'search-completed-no-official');
});
test('API failures remain failures; unrelated candidate pointer denial cannot establish official denial', () => {
  assert.equal(classify(reviewed({ search: { completed: true, error: 'HTTP400' } })), 'request-tool-failure');
  assert.equal(classify(reviewed({ website: { plausible: true }, pointer: { attempts: [{ official_location: false, http_status: 403 }] } })), 'candidate-identity-unverified');
});
test('official identity requires name and address, including a shared-system website', () => {
  assert.throws(() => classify(reviewed({ website: { identity: 'corroborated', domain: 'system.test', name_evidence: 'system name' } })), /name and address/);
  assert.equal(classify(reviewed({ website: { identity: 'conflict', plausible: true } })), 'candidate-identity-unverified');
  assert.throws(() => classify(reviewed({ website: { identity: 'conflict' }, file: { facility_linked: true } })), /Conflicting/);
});
test('transport failures never become HTTP denials or pointer absence', () => {
  assert.equal(classify(reviewed({ website, pointer: { locations_complete: true, attempts: [{ official_location: true, http_status: 0, error: 'timeout', usable: false }] } })), 'request-tool-failure');
  assert.equal(classify(reviewed({ website, pointer: { attempts: [{ url: 'https://hospital.test/cms-hpt.txt', official_location: true, http_status: 403 }] } })), 'official-hpt-pending');
  assert.equal(classify(reviewed({ website, pointer: { confirmed_url: 'https://hospital.test/cms-hpt.txt', attempts: [{ url: 'https://hospital.test/cms-hpt.txt', official_location: true, http_status: 403 }] } })), 'pointer-client-denied');
  assert.equal(classify(reviewed({ website, pointer: { locations_complete: true, attempts: [{ official_location: true, http_status: 404, usable: false }] } })), 'pointer-not-retrieved');
});
test('pointer and file evidence stay separate and cannot promote to compliance', () => {
  assert.equal(classify(reviewed({ website, pointer: { retrieved: true } })), 'pointer-match-unresolved');
  assert.throws(() => classify(reviewed({ website, file: { facility_linked: true } })), /matched official pointer/);
  assert.equal(classify(reviewed({ website, pointer: { facility_matched: true }, file: { facility_linked: true, attempted: true, error: 'timeout' } })), 'mrf-request-failed');
  assert.equal(classify(reviewed({ website, pointer: { facility_matched: true }, file: { facility_linked: true, retrieved: true } })), 'mrf-verification-pending');
});
test('pointer parsing rejects HTML and matches only a supported facility entry', () => {
  const entries = parsePointerEntries('location-name: Other Hospital\nmrf-url: https://x.test/other.csv\n\nlocation-name: Quincy Valley Medical Center\nsource-page-url: https://x.test/pricing\nmrf-url: https://x.test/quincy.csv');
  assert.equal(entries.length, 2);
  assert.equal(matchPointerEntry('QUINCY VALLEY MEDICAL CENTER', entries).entry.mrf_url, 'https://x.test/quincy.csv');
  assert.equal(matchPointerEntry('Unrelated Facility', entries), null);
  assert.deepEqual(parsePointerEntries('<!doctype html><p>location-name: Fake</p><p>mrf-url: x</p>'), []);
});
test('pointer parsing accepts only an immediate standalone URL after an empty mrf-url', () => {
  assert.deepEqual(parsePointerEntries('location-name: Dearborn\nsource-page-url: https://x.test/pricing\nmrf-url:\nhttps://x.test/dearborn.csv\ncontact-name: Team'), [{
    location_name: 'Dearborn', source_page_url: 'https://x.test/pricing', mrf_url: 'https://x.test/dearborn.csv'
  }]);
  assert.deepEqual(parsePointerEntries('location-name: Other\nmrf-url:\nnot a url\nhttps://x.test/wrong.csv'), []);
  assert.deepEqual(parsePointerEntries('location-name: Other\nmrf-url:\ncontact-email: https://x.test/not-a-file'), []);
});
test('discovery pointer parser accepts CR-only publisher line endings', () => {
  assert.deepEqual(parsePointerEntries('location-name: Montefiore New Rochelle\rsource-page-url: https://x.test/pricing\rmrf-url: https://x.test/new-rochelle.csv\r'), [{
    location_name: 'Montefiore New Rochelle', source_page_url: 'https://x.test/pricing', mrf_url: 'https://x.test/new-rochelle.csv'
  }]);
});
test('stale overlays cannot override a changed crawl or reviewed resolution', () => {
  const base = { ccn: '1', finding: 'not-assessed-domain-unknown', domain: '', checked_at: '' };
  const r = { ccn: '1', base_sha256: digest(base), disposition: 'official-hpt-pending', reason: 'verified identity', next_action: 'inspect pricing', observed_at: '2026-09-14' };
  assert.equal(applyDiscoveryReviews([base], [r])[0].assessable, 'no');
  for (const changed of [{ ...base, domain: 'new.test' }, { ...base, checked_at: '2026-09-15' }, { ...base, finding: 'compliant-observed' }, { ...base, evidence: 'new crawl' }])
    assert.deepEqual(applyDiscoveryReviews([changed], [r]), [changed]);
  assert.throws(() => applyDiscoveryReviews([base], [r, r]), /Duplicate/);
});
test('all discovery labels have tracker, intervention and outreach coverage', () => {
  const fs = require('fs'), path = require('path');
  const js = fs.readFileSync(path.join(__dirname, '../../../js/tracker.js'), 'utf8');
  const { classifyRow } = require('../build-interventions');
  for (const key of Object.keys(LABELS)) {
    const finding = 'not-assessed-discovery-' + key;
    assert.ok(js.includes("'" + finding + "'"));
    assert.equal(classifyRow({ finding, evidence: 'next step' }).intervention, 'discovery-review');
  }
});
test('a stale new overlay cannot fall through to the older single-batch labels', () => {
  const fs = require('fs'), os = require('os'), path = require('path');
  const { loadReviewedView } = require('../lib/reviewed-resolutions');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'discovery-review-test-'));
  try {
    fs.writeFileSync(path.join(dir, 'compliance.csv'), 'ccn,finding,evidence\n1,not-assessed-domain-unknown,new crawl\n');
    fs.writeFileSync(path.join(dir, 'manifest.csv'), 'ccn\n');
    fs.writeFileSync(path.join(dir, 'gaps.csv'), 'ccn\n');
    fs.writeFileSync(path.join(dir, 'domain-observations.csv'), 'ccn,observation\n1,candidate-found\n');
    fs.writeFileSync(path.join(dir, 'discovery-review.json'), JSON.stringify({ records: [{ ccn: '1', base_sha256: 'stale', disposition: 'review-pending' }] }));
    assert.equal(loadReviewedView(dir).compliance[0].finding, 'not-assessed-domain-unknown');
  } finally {
    for (const file of fs.readdirSync(dir)) fs.unlinkSync(path.join(dir, file));
    fs.rmdirSync(dir);
  }
});
