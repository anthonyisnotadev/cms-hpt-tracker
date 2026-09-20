'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  metadataState, effectiveDispositionCategory, selectedFileEvidence, headerEvidenceForSelection, qualifyBrowserIdentity, choose, buildTargetIndexes, indexedPointerObservation, pointerRetainedBytesStatus, pointerCorpusProvenance, applyBrowserPointerObservation, disposition
} = require('../build-nationwide-verification');

test('retained pointer bytes are checked against both crawl hash and length', () => {
  const state = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../cms_data/hpt/pointer-corpus/crawl-state.json')));
  const target = Object.values(state.targets).find(item => item.status === 'ok' && item.rawFile && item.sha256);
  const root = path.resolve(__dirname, '../../..');
  assert.equal(pointerRetainedBytesStatus(target, root, new Map()), 'hash-corroborated');
  assert.equal(pointerRetainedBytesStatus({ ...target, sha256: '0'.repeat(64) }, root, new Map()), 'hash-conflict');
  assert.equal(pointerRetainedBytesStatus({ ...target, bytes: Number(target.bytes) + 1 }, root, new Map()), 'hash-conflict');
  assert.equal(pointerRetainedBytesStatus({ ...target, rawFile: '../outside.txt' }, root, new Map()), 'raw-file-unavailable');
});

test('failed retry retains prior pointer bytes only as dated historical provenance', () => {
  const state = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../cms_data/hpt/pointer-corpus/crawl-state.json')));
  const target = state.targets['url:https://cvrmc.org/cms-hpt.txt'];
  const provenance = pointerCorpusProvenance(target);
  assert.equal(target.status, 'failed');
  assert.equal(provenance.corpus_sha256, undefined);
  assert.equal(provenance.historical_sha256, target.sha256);
  assert.equal(provenance.historical_observed_at, '2026-09-07T00:03:06.067Z');
  assert.equal(provenance.historical_raw_integrity, 'hash-corroborated');
  const versioned = pointerCorpusProvenance({ status: 'failed', input: target.input,
    lastSuccessful: { rawFile: target.rawFile, sha256: target.sha256, bytes: target.bytes,
      acceptedUrl: target.acceptedUrl, finalUrl: target.finalUrl,
      fetchedAt: '2026-09-07T00:03:06.067Z' } });
  assert.equal(versioned.historical_sha256, target.sha256);
  assert.equal(versioned.historical_raw_integrity, 'hash-corroborated');
});

test('effective disposition categories are exclusive and precedence-aware', () => {
  assert.equal(effectiveDispositionCategory({ disposition: 'verified-current-mrf', latest_observation_superseded: true }), 'superseded-by-reviewed-resolution');
  assert.equal(effectiveDispositionCategory({ disposition: 'mrf-verification-pending', standing_evidence_retained: true }), 'standing-evidence-retained');
  assert.equal(effectiveDispositionCategory({ disposition: 'linked-mrf-header-unmatched', supported_identity_uncertainty: true }), 'supported-identity-uncertainty');
  assert.equal(effectiveDispositionCategory({ disposition: 'verified-stale-mrf' }), 'active-verification-claim');
  assert.equal(effectiveDispositionCategory({ disposition: 'scope-exempt-federal' }), 'scope-exempt');
  assert.equal(effectiveDispositionCategory({ disposition: 'pointer-not-retrieved' }), 'genuinely-unresolved');
});

test('browser-rendered HTML does not supersede retained HTML pointer bytes', () => {
  const url = 'https://hospital.test/cms-hpt.txt';
  const pointer = { state: 'not-retrieved-from-checked-locations', reason: 'html-body-not-pointer', result: 'invalid' };
  const review = { status: 'retrieved', detail: 'Rendered pointer labels', observed_at: '2026-01-02T00:00:00Z' };
  const result = applyBrowserPointerObservation(pointer, { pointer_url: url }, new Map([[url, review]]));
  assert.equal(result.state, pointer.state);
  assert.equal(result.browser, review);
  assert.match(result.reason, /HTML page/);
});

test('unassigned retrieved pointers retain source provenance without becoming facility links', () => {
  const report = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../data/hpt-audit/nationwide-verification.json')));
  const rows = report.records.filter(row => row.pointer_state === 'retrieved-facility-match-unresolved' && !row.pointer_url);
  assert.ok(rows.length > 0);
  assert.ok(rows.every(row => /^https?:\/\//.test(row.pointer_corpus_checked_url)
    && /^[a-f0-9]{64}$/.test(row.pointer_corpus_sha256) && row.pointer_corpus_observed_at));
  for (const ccn of ['214002', '214004', '214012', '214018']) {
    const row = rows.find(item => item.ccn === ccn);
    assert.equal(row.pointer_corpus_final_url, 'https://health.maryland.gov/wmhc/Pages/cms-hpt.txt');
    assert.equal(row.pointer_corpus_sha256, '459258c8920912eff1380ca2b337fe705a22dcb40095e995dc75a3d97c5e2e50');
  }
});

test('a dated manual pointer recheck is displayed without promoting exact-file usability', () => {
  const report = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../data/hpt-audit/nationwide-verification.json')));
  const row = report.records.find(item => item.ccn === '070006');
  assert.equal(row.pointer_state, 'retrieved-facility-linked-manual-review');
  assert.equal(row.pointer_url, 'https://www.stamfordhealth.org/cms-hpt.txt');
  assert.equal(row.pointer_url, row.pointer_corpus_checked_url);
  assert.equal(row.mrf_state, 'linked-file-transport-unresolved');
  assert.equal(row.disposition, 'pointer-linked-file-review-pending');
  assert.equal(row.declared_location_name, 'Stamford Hospital');
  assert.equal(row.declared_last_updated, '2026-04-01');
});

test('browser identity claims require per-facility file evidence rather than archive filenames', () => {
  const hospital = { name: 'THE MEDICAL CENTER AT FRANKLIN', address: '1100 BROOKHAVEN ROAD', state: 'KY' };
  const review = { identity: 'corroborated', status: 'retrieved', declared_hospital_name: 'The Medical Center at Franklin' };
  assert.equal(qualifyBrowserIdentity(review, hospital).identity_gate, 'file-address-not-recorded');
  assert.equal(qualifyBrowserIdentity({ ...review, declared_address: '1100 Brookhaven Rd Franklin KY 42134' }, hospital).identity, 'corroborated');
  assert.equal(qualifyBrowserIdentity({ ...review, declared_address: '1100_Brookhaven_Rd_Franklin_KY_42134' }, hospital).identity, 'corroborated');
  assert.equal(qualifyBrowserIdentity({ ...review, declared_address: '1501 S Dixie St Horse Cave KY 42749' }, hospital).identity, 'unverified');
  assert.equal(qualifyBrowserIdentity({ ...review, declared_address: '1100 Brookhaven Rd Franklin TN 42134' }, hospital).identity, 'unverified');
  assert.equal(qualifyBrowserIdentity(review, undefined).identity, 'unverified');
  assert.equal(review.identity, 'corroborated');
});

test('unsuccessful browser retrievals do not acquire file identity gates', () => {
  const review = { status: 'navigation-failed', identity: 'unresolved', observed_at: '2026-09-15T00:00:00Z' };
  const result = qualifyBrowserIdentity(review, { ccn: '010001', name: 'EXAMPLE HOSPITAL', address: '1 MAIN ST', state: 'AL' });
  assert.equal(result.identity_gate, undefined);
  assert.equal(result.status, 'navigation-failed');
  assert.equal(result.identity, 'unresolved');
});

test('a matched header keeps coherent metadata and date despite a browser observation', () => {
  const header = { mrf_address: '1009 W Green St, Hastings, MI 49058', mrf_last_updated: '2026-04-01', checked_at: '2026-09-15T09:29:56Z' };
  const selected = { best: header, review: [], linked: [header] };
  const result = selectedFileEvidence(selected, header, { status: 'retrieved', identity: 'corroborated',
    declared_address: 'different browser text', declared_last_updated: '2025-01-01', observed_at: '2026-09-16' });
  assert.equal(result.declared_address, header.mrf_address);
  assert.equal(result.declared_last_updated, header.mrf_last_updated);
  assert.equal(result.observed_at, header.checked_at);
});

test('reviewed address equivalence is bound to exact CCN, roster, file and observation', () => {
  const hospital = { ccn: '330100', name: 'NEW YORK EYE AND EAR INFIRMARY', address: '230 SECOND AVE', state: 'NY' };
  const review = { status: 'retrieved', identity: 'unresolved', declared_hospital_name: hospital.name, declared_address: '310 East 14th Street New York NY 10003',
    target: 'https://example.org/file.json', observed_at: '2026-09-15T09:00:00Z' };
  const address = { ccn: hospital.ccn, state: 'NY', roster_address: hospital.address, file_address: review.declared_address,
    mrf_url: review.target, browser_observed_at: review.observed_at, reviewed_on: '2026-09-15', source_url: 'https://example.org/contact', basis: 'Official mailing address and lobby.' };
  assert.equal(qualifyBrowserIdentity(review, hospital, address).identity, 'corroborated');
  assert.equal(qualifyBrowserIdentity(review, hospital, address).identity_gate, 'reviewed-file-address-equivalence');
  assert.equal(qualifyBrowserIdentity({ ...review, identity: 'conflicting' }, hospital, address).identity, 'conflicting');
  for (const change of [{ ccn: '330101' }, { state: 'NJ' }, { roster_address: 'OTHER' }, { file_address: 'OTHER' },
    { mrf_url: 'https://example.org/other.json' }, { browser_observed_at: '2026-09-14' }, { reviewed_on: '2026-09-14' }]) {
    assert.equal(qualifyBrowserIdentity(review, hospital, { ...address, ...change }).identity, 'unverified');
  }
});

test('browser-backed metadata cannot borrow missing fields from an unsuccessful header', () => {
  const header = { mrf_license_state: 'NY', mrf_last_updated: '2024-01-01' };
  const result = selectedFileEvidence({ best: null, review: [], linked: [header] }, header,
    { status: 'retrieved', identity: 'corroborated', declared_last_updated: '2026-04-01', observed_at: '2026-09-15' });
  assert.equal(result.metadata_source, 'reviewed-browser');
  assert.equal(result.declared_license_state, '');
  assert.equal(result.declared_last_updated, '2026-04-01');
});

test('target indexes reconcile accepted URLs, domains, and exact CCNs', () => {
  const target = {
    input: 'https://www.example.org/cms-hpt.txt',
    acceptedUrl: 'https://example.org/.well-known/cms-hpt.txt',
    finalUrl: 'https://example.org/other-hospital/cms-hpt.txt',
    sha256: 'a'.repeat(64),
    sourceDomains: ['www.example.org'], relatedCcns: ['010001'], status: 'ok', fetchedAt: '2026-09-15T00:00:00Z'
  };
  const indexes = buildTargetIndexes({ targets: { 'url:https://www.example.org/cms-hpt.txt': target } });
  assert.equal(indexes.urls.get('https://example.org/.well-known/cms-hpt.txt'), target);
  assert.equal(indexes.domains.get('example.org'), target);
  assert.equal(indexes.ccns.get('010001'), target);
  const observed = indexedPointerObservation({ ccn: '010001', domain: 'example.org', pointer_url: '' }, indexes, []);
  assert.equal(observed.state, 'retrieved-facility-match-unresolved');
  assert.equal(observed.corpus_checked_url, target.input);
  assert.equal(observed.corpus_final_url, target.finalUrl);
  assert.equal(observed.corpus_sha256, target.sha256);
  assert.equal(observed.corpus_observed_at, target.fetchedAt);
  const laterBrowser = applyBrowserPointerObservation(observed, { domain: 'example.org', pointer_url: target.input },
    new Map([[target.input, { status: 'retrieved', observed_at: '2026-09-16T00:00:00Z' }]]));
  assert.equal(laterBrowser.observed_at, '2026-09-16T00:00:00Z');
  assert.equal(laterBrowser.corpus_observed_at, target.fetchedAt);
  assert.equal(laterBrowser.corpus_sha256, target.sha256);
  const domainTarget = { ...target, input: 'example.org', acceptedUrl: 'https://example.org/cms-hpt.txt' };
  const domainIndexes = buildTargetIndexes({ targets: { 'domain:example.org': domainTarget } });
  assert.equal(indexedPointerObservation({ ccn: '010001', domain: 'example.org' }, domainIndexes, [])
    .corpus_checked_url, domainTarget.acceptedUrl);
});

test('selected file pointer provenance comes from its exact CCN entry, not a standing sibling pointer', () => {
  const wrongUrl = 'https://washington.example/cms-hpt.txt';
  const rightUrl = 'https://missouri.example/cms-hpt.txt';
  const fileUrl = 'https://missouri.example/current.json';
  const wrong = { input: wrongUrl, acceptedUrl: wrongUrl, finalUrl: wrongUrl,
    status: 'ok', fetchedAt: '2026-09-16', sha256: 'a'.repeat(64), relatedCcns: ['260085'] };
  const right = { input: rightUrl, acceptedUrl: rightUrl, finalUrl: rightUrl,
    status: 'ok', fetchedAt: '2026-09-15', sha256: 'b'.repeat(64), relatedCcns: ['260085'] };
  const indexes = buildTargetIndexes({ targets: { [`url:${wrongUrl}`]: wrong, [`url:${rightUrl}`]: right } });
  const row = { ccn: '260085', domain: 'washington.example', pointer_url: wrongUrl };
  const entries = [{ matched_ccns: '260085', pointer_url: rightUrl, mrf_url: fileUrl,
    pointer_sha256: right.sha256, record_status: 'ok' }];
  const observed = indexedPointerObservation(row, indexes, entries, fileUrl);
  assert.equal(observed.state, 'retrieved-facility-linked');
  assert.equal(observed.corpus_checked_url, rightUrl);
  assert.equal(observed.corpus_sha256, right.sha256);
  assert.equal(indexedPointerObservation(row, indexes, entries, 'https://other.example/file.json').state,
    'retrieved-facility-match-unresolved');
});

test('target indexes select newer successful pointer bytes, not insertion order or a later failed retry', () => {
  const url = 'https://example.org/cms-hpt.txt';
  const newer = { input: url, acceptedUrl: url, status: 'ok', fetchedAt: '2026-09-15T09:00:00Z',
    sha256: 'b'.repeat(64), sourceDomains: ['example.org'], relatedCcns: ['010001'] };
  const older = { ...newer, fetchedAt: '2026-09-07T09:00:00Z', sha256: 'a'.repeat(64) };
  const failed = { ...newer, status: 'failed', fetchedAt: '2026-09-16T09:00:00Z', sha256: '' };
  const indexes = buildTargetIndexes({ targets: {
    [`url:${url}`]: newer,
    'domain:example.org': older,
    'url:https://example.org/alternate-check': failed,
  } });
  for (const index of [indexes.urls.get(url), indexes.domains.get('example.org'), indexes.ccns.get('010001')]) {
    assert.equal(index.sha256, newer.sha256);
    assert.equal(index.fetchedAt, newer.fetchedAt);
  }
});

test('same-byte pointer aliases retain exact CCN attribution', () => {
  const root = 'https://providence.org/cms-hpt.txt';
  const alias = 'https://www.swedish.org/cms-hpt.txt';
  const file = 'https://files.example/st-mary.json';
  const hash = 'a'.repeat(64);
  const target = url => ({ input: url, acceptedUrl: url, finalUrl: url, status: 'ok', sha256: hash,
    fetchedAt: '2026-09-15T09:00:00Z' });
  const indexes = buildTargetIndexes({ targets: { [`url:${root}`]: target(root), [`url:${alias}`]: target(alias) } });
  const rows = [root, alias].map(pointer_url => ({ matched_ccns: '050300', pointer_url,
    pointer_sha256: hash, mrf_url: file, record_status: 'ok' }));
  const result = indexedPointerObservation({ ccn: '050300', domain: 'providence.org', pointer_url: root }, indexes, rows, file);
  assert.equal(result.state, 'retrieved-facility-linked');
  assert.equal(result.corpus_checked_url, root);
  assert.equal(result.corpus_sha256, hash);
});

test('browser observations keep rendered absence distinct from client blocking', () => {
  const row = { pointer_url: 'https://example.org/cms-hpt.txt' };
  const base = { state: 'request-or-tool-failure', observed_at: '2026-09-14', result: 'failed', reason: 'neterr' };
  const missing = applyBrowserPointerObservation(base, row, new Map([['https://example.org/cms-hpt.txt', {
    status: 'http-not-found', observed_at: '2026-09-15', title: '404 Not Found'
  }]]));
  assert.equal(missing.state, 'not-retrieved-from-checked-locations');
  assert.equal(missing.browser.status, 'http-not-found');
  const blocked = applyBrowserPointerObservation(base, row, new Map([['https://example.org/cms-hpt.txt', {
    status: 'browser-client-blocked', observed_at: '2026-09-15'
  }]]));
  assert.equal(blocked.state, 'request-or-tool-failure');
});

test('later browser blocking cannot erase hash-corroborated structured pointer bytes', () => {
  const url = 'https://example.org/cms-hpt.txt';
  const pointer = { state: 'retrieved-facility-match-unresolved', observed_at: '2026-09-15T09:00:00Z',
    result: 'ok', corpus_raw_integrity: 'hash-corroborated', corpus_sha256: 'a'.repeat(64) };
  const blocked = applyBrowserPointerObservation(pointer, { pointer_url: url }, new Map([[url, {
    status: 'browser-client-blocked', observed_at: '2026-09-15T12:00:00Z'
  }]]));
  assert.equal(blocked.state, pointer.state);
  assert.equal(blocked.observed_at, pointer.observed_at);
  assert.equal(blocked.corpus_sha256, pointer.corpus_sha256);
  assert.equal(blocked.browser.status, 'browser-client-blocked');
});

test('verified metadata states remain distinct from access and identity states', () => {
  const selected = { best: { pointer_sha256s: 'a'.repeat(64), mrf_last_updated: '2026-03-04',
    mrf_days_since_update: '197', mrf_cms_version: '3.0.0' }, review: [], linked: [] };
  const newerPointer = { corpus_raw_integrity: 'hash-corroborated', corpus_sha256: 'b'.repeat(64) };
  assert.equal(disposition({}, newerPointer, selected)[0], 'selected-file-only-in-earlier-pointer-version');
  assert.equal(disposition({}, newerPointer, selected, null, true)[0], 'verified-current-mrf');
  assert.equal(metadataState({ mrf_last_updated: '2026-01-01', mrf_days_since_update: '20', mrf_cms_version: '3.0.0' }), 'verified-current-v3');
  for (const version of ['3', '3.0', '3.0,0', '3.0.1', '3.00', '3.0.2']) {
    assert.equal(metadataState({ mrf_last_updated: '2026-01-01', mrf_days_since_update: '20', mrf_cms_version: version }), 'verified-older-or-unresolved-template');
  }
  assert.equal(metadataState({ mrf_last_updated: '2024-01-01', mrf_days_since_update: '600', mrf_cms_version: '3.0' }), 'verified-stale-date');
  assert.equal(metadataState({ mrf_last_updated: '2026-01-01', mrf_days_since_update: '20', mrf_cms_version: '2.0' }), 'verified-older-or-unresolved-template');
  assert.equal(metadataState({ mrf_last_updated: '', mrf_days_since_update: '', mrf_cms_version: '2' }), 'verified-older-or-unresolved-template');
  assert.equal(metadataState({ mrf_last_updated: '', mrf_days_since_update: '', mrf_cms_version: '' }), 'metadata-unresolved');
  assert.equal(disposition({}, { state: 'access-denied-or-rate-limited-to-client' }, { best: null, review: [], linked: [] })[0],
    'pointer-access-denied-to-client');
  assert.equal(disposition({ website_review: 'candidate' }, { state: 'not-assessed-no-official-domain' }, { best: null, review: [], linked: [] })[0],
    'candidate-website-identity-unverified');
  assert.equal(disposition({ website_review: 'completed-no-official' }, { state: 'not-assessed-no-official-domain' }, { best: null, review: [], linked: [] })[0],
    'official-website-not-identified-completed-search');
  assert.equal(disposition({}, { state: 'retrieved-facility-linked' }, {
    best: null, review: [], linked: [{ mrf_range_status: '' }]
  }, { status: 'retrieved' })[0], 'mrf-verification-pending');
  assert.equal(disposition({}, { state: 'retrieved-facility-linked' }, {
    best: null, review: [], linked: [{ mrf_range_status: '' }]
  }, {
    status: 'retrieved', identity: 'corroborated',
    declared_last_updated: '2026-07-20', cms_template_version: '3.0.0'
  })[0], 'verified-current-mrf');
  assert.equal(disposition({}, { state: 'retrieved-facility-linked' }, {
    best: null, review: [], linked: [{ mrf_range_status: '' }]
  }, { status: 'navigation-failed', identity: 'conflicting' })[0], 'mrf-facility-identity-unresolved');
});

test('dated closed-facility status remains a distinct scope exemption', () => {
  assert.deepEqual(disposition({ finding: 'not-applicable-closed' }, {}, { best: null, review: [], linked: [] }), [
    'scope-exempt-closed',
    'Hospital closure is supported by dated official evidence; recheck only if hospital operations resume.'
  ]);
});

test('choose never promotes a merely linked or review candidate to verified', () => {
  const linked = { existing_matched_ccns: '010001', review_ccns: '', header_matched_ccns: '', checked_at: '2026-09-15' };
  const review = { existing_matched_ccns: '010001', review_ccns: '010001', header_matched_ccns: '', checked_at: '2026-09-15' };
  const selected = choose([linked, review], '010001');
  assert.equal(selected.best, null);
  assert.equal(selected.review.length, 1);
  assert.equal(selected.linked.length, 2);
});

test('same-date exact facility name beats a later-probed address-only sibling', () => {
  const henderson = { header_matched_ccns: '440008', mrf_hospital_name: 'Henderson County Community Hospital',
    mrf_last_updated: '2026-06-30', mrf_days_since_update: '77', mrf_cms_version: '3.0.0',
    checked_at: '2026-09-15T04:35:30Z' };
  const houston = { ...henderson, mrf_hospital_name: 'Houston County Community Hospital',
    checked_at: '2026-09-15T04:37:20Z' };
  assert.equal(choose([houston, henderson], '440008', 'HENDERSON COUNTY COMMUNITY HOSPITAL').best, henderson);
  assert.equal(choose([houston, henderson], '440008').best, houston);
});

test('linked files cannot lend another facility identity gate to the current CCN', () => {
  const linked = { existing_matched_ccns: '010001', header_matched_ccns: '010002',
    identity_gate: 'exact-pointer-ccn-file-address-agree', match_reason: 'mrf-header-identity-and-location-agree' };
  assert.deepEqual(headerEvidenceForSelection({ best: null, review: [], linked: [linked] }, linked, '010001'), {
    identity_gate: '', match_reason: 'linked-file-matched-different-facility'
  });
  const unreachable = { existing_matched_ccns: '010001', header_matched_ccns: '', match_reason: 'mrf-header-unreachable' };
  assert.deepEqual(headerEvidenceForSelection({ best: null, review: [], linked: [unreachable] }, unreachable, '010001'), {
    identity_gate: '', match_reason: 'mrf-header-unreachable'
  });
  assert.deepEqual(headerEvidenceForSelection({ best: linked, review: [], linked: [linked] }, linked, '010002'), {
    identity_gate: 'exact-pointer-ccn-file-address-agree', match_reason: 'mrf-header-identity-and-location-agree'
  });
});
