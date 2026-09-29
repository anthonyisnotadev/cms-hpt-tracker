'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildObservations } = require('../export-domain-observations');

const compliance = ccn => ({ ccn, finding: 'not-assessed-domain-unknown' });
const evidence = (ccn, fields = {}) => ({ ccn, candidate_domain: 'candidate.test', checked_at: '2026-09-03T00:00:00Z', ...fields });

test('domain observation export uses the strongest cautious observation per CCN', () => {
  const rows = buildObservations(
    ['1', '2', '3', '4'].map(compliance),
    [evidence('1', { status: 'site-found' }), evidence('1', { status: 'blocked' }),
      evidence('2', { status: 'rejected', pointer_url: 'https://candidate.test/cms-hpt.txt' }),
      evidence('3', { status: 'blocked' }),
      evidence('4', { status: 'none', candidate_domain: '' })],
    [{ ccn: '4', checked_at: '2026-09-03T00:00:00Z', error: '' }]
  );
  assert.deepEqual(rows.map(row => row.observation),
    ['site-observed', 'pointer-review', 'candidate-found', 'no-candidate']);
  assert.equal(rows[0].candidate_count, 2);
  assert.equal(rows[0].blocked_count, 1);
});

test('domain observation export separates unsearched, failed, and empty searches', () => {
  const rows = buildObservations(
    ['1', '2', '3'].map(compliance),
    ['1', '2', '3'].map(ccn => evidence(ccn, { status: 'none', candidate_domain: '' })),
    [{ ccn: '2', checked_at: '2026-09-03T00:00:00Z', error: 'serper http 400' },
      { ccn: '3', checked_at: '2026-09-03T00:00:00Z', error: '' }]
  );
  assert.deepEqual(rows.map(row => row.observation), ['search-not-run', 'search-error', 'no-candidate']);
  assert.deepEqual(rows.map(row => row.search_request_recorded), ['no', 'yes', 'yes']);
});

test('domain observation export fails rather than silently calling an unsearched row unknown', () => {
  assert.throws(() => buildObservations([compliance('1')], []), /missing 1 current CCNs/);
});
