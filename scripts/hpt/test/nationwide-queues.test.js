'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildQueues } = require('../build-nationwide-queues');

test('queues deduplicate shared pointer and MRF targets without losing CCNs', () => {
  const records = [
    { ccn: '1', hospital_name: 'One', city: 'A', state: 'AL', disposition: 'pointer-access-denied-to-client', pointer_url: 'https://system.test/cms-hpt.txt' },
    { ccn: '2', hospital_name: 'Two', city: 'B', state: 'AL', disposition: 'pointer-access-denied-to-client', pointer_url: 'https://system.test/cms-hpt.txt' },
    { ccn: '3', hospital_name: 'Three', city: 'C', state: 'AK', disposition: 'mrf-request-unsuccessful', mrf_url: 'https://files.test/all.csv' },
    { ccn: '4', hospital_name: 'Four', city: 'D', state: 'AK', disposition: 'mrf-request-unsuccessful', mrf_url: 'https://files.test/all.csv' }
  ];
  const queues = buildQueues({ records }, []);
  assert.deepEqual(queues.pointer[0].ccns, ['1', '2']);
  assert.deepEqual(queues.mrf[0].ccns, ['3', '4']);
});

test('completed searches stay distinct from pending website discovery', () => {
  const nationwide = { records: [
    { ccn: '1', hospital_name: 'One', city: 'A', state: 'AL', disposition: 'official-website-not-identified-completed-search' },
    { ccn: '2', hospital_name: 'Two', city: 'B', state: 'AL', disposition: 'official-website-search-pending' }
  ] };
  const queues = buildQueues(nationwide, [{ ccn: '1', disposition: 'search-completed-no-official', reason: 'No first-party result.' }]);
  assert.equal(queues.search.find(row => row.ccn === '1').status, 'completed-no-supported-official-site');
  assert.equal(queues.search.find(row => row.ccn === '2').status, 'pending');
});

test('latest reviewed completed search closes a stale pending discovery record', () => {
  const nationwide = { records: [
    { ccn: '1', hospital_name: 'One', city: 'A', state: 'AL', disposition: 'official-website-not-identified-completed-search' },
    { ccn: '2', hospital_name: 'Two', city: 'B', state: 'AL', disposition: 'candidate-website-identity-unverified' }
  ] };
  const discovery = [
    { ccn: '1', disposition: 'candidate-identity-unverified' },
    { ccn: '2', disposition: 'candidate-identity-unverified' }
  ];
  const reviews = [
    { ccn: '1', status: 'completed-no-official' },
    { ccn: '2', status: 'candidate' }
  ];
  const queues = buildQueues(nationwide, discovery, reviews);
  assert.equal(queues.search.find(row => row.ccn === '1').status, 'completed-no-supported-official-site');
  assert.equal(queues.search.find(row => row.ccn === '2').status, 'pending');
});

test('browser-observed targets remain auditable without returning to the pending queue', () => {
  const nationwide = { records: [
    { ccn: '1', hospital_name: 'One', city: 'A', state: 'AL', disposition: 'pointer-access-denied-to-client', pointer_url: 'https://example.org/cms-hpt.txt' }
  ] };
  const queues = buildQueues(nationwide, [], [], [{
    kind: 'pointer', target: 'https://example.org/cms-hpt.txt', status: 'challenge', observed_at: '2026-09-15'
  }]);
  assert.equal(queues.pointer[0].status, 'browser-observed-challenge');
  assert.equal(queues.pointer[0].observed_at, '2026-09-15');
});

test('later reviewed resolutions remove obsolete nationwide targets without dropping shared live targets', () => {
  const nationwide = { records: [
    { ccn: '1', hospital_name: 'Old', city: 'A', state: 'AL', disposition: 'pointer-discovery-incomplete',
      pointer_url: 'https://old.test/cms-hpt.txt', latest_observation_superseded: true },
    { ccn: '2', hospital_name: 'Live', city: 'B', state: 'AL', disposition: 'pointer-discovery-incomplete',
      pointer_url: 'https://old.test/cms-hpt.txt', latest_observation_superseded: false },
    { ccn: '3', hospital_name: 'Old file', city: 'C', state: 'AK', disposition: 'mrf-request-unsuccessful',
      mrf_url: 'https://files.test/all.csv', latest_observation_superseded: true },
    { ccn: '4', hospital_name: 'Old search', city: 'D', state: 'AK', disposition: 'official-website-search-pending',
      latest_observation_superseded: true }
  ] };
  const queues = buildQueues(nationwide);
  assert.deepEqual(queues.pointer[0].ccns, ['2']);
  assert.equal(queues.mrf.length, 0);
  assert.equal(queues.search.length, 0);
});
