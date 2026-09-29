'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { parsePayload } = require('../lib/recovery-transport');
const { loadReviewedView, applyResolutions } = require('../lib/reviewed-resolutions');
const root = path.resolve(__dirname, '../../..');
const audit = path.join(root, 'data/hpt-audit');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

test('two former Borgess CCNs bind to distinct Beacon campuses and pointer files', async () => {
  const proof = require(path.join(audit, 'reconciliation-beacon-borgess-transition-proof.json'));
  const pointer = fs.readFileSync(path.join(root, 'cms_data/hpt/pointer-corpus/raw/beaconhealthsystem.org-9d5361253689.txt'));
  const resolutions = require(path.join(audit, 'reviewed-resolutions.json'));
  const view = loadReviewedView(audit);
  const nationwide = require(path.join(audit, 'nationwide-verification.json')).records;
  const worklist = require(path.join(audit, 'unresolved-investigation-worklist.json')).records;
  assert.equal(sha(pointer), proof.pointer_sha256);
  assert.deepEqual(proof.records.map(row => row.ccn), ['230117', '231315']);
  assert.equal(new Set(proof.records.map(row => row.mrf_url)).size, 2);
  for (const record of proof.records) {
    const sample = fs.readFileSync(path.join(root, record.retained_sample));
    const parsed = (await parsePayload(sample, 'text/csv')).parsed.find(row => row.innerKind === 'csv');
    const block = pointer.toString('utf8').split(/\r?\n\s*\r?\n/).find(text =>
      text.includes(`location-name: ${record.current_location_name}`));
    const resolution = resolutions.find(row => row.ccn === record.ccn);
    const standing = view.compliance.find(row => row.ccn === record.ccn);
    const current = nationwide.find(row => row.ccn === record.ccn);
    assert.equal(sample.length, 262144);
    assert.equal(sha(sample), record.retained_sha256);
    assert.ok(block?.includes(`mrf-url: ${record.mrf_url}`));
    assert.equal(parsed.mrfHospitalName, record.current_location_name.toUpperCase());
    assert.equal(parsed.mrfAddress, record.declared_address);
    assert.equal(parsed.mrfLicenseState, 'MI');
    assert.equal(parsed.declaredLastUpdated, '2026-01-01');
    assert.equal(parsed.cmsVersion, '3.0.0');
    assert.equal(record.pricing_page_mrf_url, record.mrf_url.replace('v=2', 'v=3'));
    assert.equal(record.pricing_page_mrf_prefix_sha256, record.retained_sha256);
    assert.notEqual(record.pricing_page_mrf_url, record.mrf_url);
    assert.equal(standing.finding, 'compliant-observed');
    assert.equal(standing.domain, 'beaconhealthsystem.org');
    assert.equal(standing.mrf_url, record.mrf_url);
    assert.equal(current.observation_role, 'superseded-retry');
    assert.equal(worklist.some(row => row.ccn === record.ccn), false);
    assert.match(view.history[record.ccn].evidence, /does not name this hospital/);
    const altered = structuredClone(resolution);
    altered.evidence.identity = 'unverified';
    assert.throws(() => applyResolutions([altered.base], [], [], [altered]), /lacks current, pointer-linked identity/);
  }
  const html = fs.readFileSync(path.join(root, 'tracker.html'), 'utf8');
  const open = '<script id="tracker-data" type="application/json">';
  const start = html.indexOf(open), end = html.indexOf('</script>', start);
  const data = JSON.parse(html.slice(start + open.length, end));
  for (const record of proof.records) {
    const row = data.rows.find(item => item[0] === record.ccn);
    assert.equal(row[8], record.mrf_url);
  }
});
