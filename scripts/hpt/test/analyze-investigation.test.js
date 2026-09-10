'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { sameUrl, entryNameAgrees, classify, leadsFor } = require('../analyze-investigation');
const { sha } = require('../lib/recovery-transport');

test('pointer and retrieved URLs match despite encoding and redirect variants', () => {
  assert.ok(sameUrl('https://example.org/a/b.csv', 'https://example.org/a/b.csv'));
  assert.ok(sameUrl('https://example.org/a%20b.csv', 'https://example.org/a b.csv'));
  assert.ok(sameUrl('https://example.org/x?ref=abc&sig=1', 'https://example.org/x?ref=abc&sig=1'));
  assert.ok(!sameUrl('https://cdn.example.org/file.csv', 'https://example.org/file.csv'));
  assert.ok(!sameUrl('https://example.org/a.csv', 'https://example.org/b.csv'));
  assert.ok(!sameUrl('', 'https://example.org/a.csv'));
});

test('pointer entry labels agree across campus qualifiers and network brands', () => {
  assert.ok(entryNameAgrees('ALTA BATES SUMMIT MEDICAL CENTER SUMMIT CAMPUS', 'ALTA BATES SUMMIT MEDICAL CENTER'));
  assert.ok(entryNameAgrees('Columbia Memorial Health', 'Columbia Memorial Hospital'));
  assert.ok(entryNameAgrees('Columbia Memorial Hospital', 'COLUMBIA MEMORIAL HOSPITAL'));
  assert.ok(!entryNameAgrees('Glens Falls Hospital', 'Columbia Memorial Hospital'));
  assert.ok(!entryNameAgrees('', 'Example Hospital'));
});

test('unrelated facilities never share a pointer label match', () => {
  assert.ok(!entryNameAgrees('Saratoga Hospital', 'Albany Medical Center'));
  assert.ok(!entryNameAgrees('Memorial Hospital', 'Kennedy Memorial Medical Center'));
});

function fixture() {
  const hospital = { ccn: '161348', name: 'CLARKE COUNTY HOSPITAL', address: '800 S FILLMORE ST', city: 'OSCEOLA', state: 'IA', zip: '50213' };
  const pointer = 'https://example.org/cms-hpt.txt';
  const urls = ['https://example.org/a.csv', 'https://example.org/b.csv'];
  const member = { mrfHospitalName: hospital.name, mrfLocationName: hospital.name, mrfAddress: '800 S Fillmore St, Osceola, IA 50213', mrfLicenseState: 'IA', declaredLastUpdated: '2026-08-01', cmsVersion: '3.0.0' };
  const base = { status: 200, checkedAt: '2026-09-09T12:00:00Z' };
  const observations = [
    { kind: 'document', url: pointer, retrieval: { ...base, url: pointer, entries: [{ locationName: hospital.name, mrfUrls: urls }] } },
    ...urls.map(url => ({ kind: 'mrf', url, retrieval: { ...base, url, parsed: { parsed: [member] } } }))
  ];
  const row = { ccn: hospital.ccn, roster: hospital, previous: { pointer_url: pointer, mrf_url: urls[0] }, evidence: urls.map(url => ({ url, identity: 'corroborated', metadata: 'date-within-365-days-version-3', http_status: 200 })) };
  const run = () => classify(row, [hospital], new Map(observations.map(o => [o.kind + '|' + sha(o.url + '|' + o.kind), o.retrieval])), new Map(), leadsFor(observations, hospital.ccn));
  return { hospital, row, observations, run };
}

test('a blocked competing file cannot silently turn ambiguity into a correction', () => {
  const f = fixture();
  f.observations[2].retrieval.status = 403;
  assert.equal(f.run().disposition, 'unresolved');
  assert.equal(f.run().issue, 'multiple-corroborated-candidates');
  // A second read of the successful file does not resolve the missing competitor.
  f.observations.push({ ...f.observations[1], kind: 'mrf-deep' });
  assert.equal(f.run().disposition, 'unresolved');
});

test('equally matching fresh competitors require adjudication without historical evidence', () => {
  const f = fixture();
  f.row.evidence = [];
  f.observations[2].roles = ['browser-fetch'];
  f.observations[2].ccns = [f.hospital.ccn];
  assert.equal(f.run().issue, 'multiple-corroborated-candidates');
});

test('new publisher pointer and file URLs participate in per-CCN classification', () => {
  const f = fixture();
  f.row.previous = {};
  f.row.evidence = [];
  f.observations.pop();
  for (const o of f.observations) {
    o.roles = ['publisher-response'];
    o.ccns = [f.hospital.ccn];
  }
  assert.equal(f.run().disposition, 'correction-verified');
  assert.deepEqual(leadsFor(f.observations, '999999'), { pointers: [], mrfs: [], homes: [] });
});
