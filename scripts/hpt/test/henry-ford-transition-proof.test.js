'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cheerio = require('cheerio');
const { parsePayload } = require('../lib/recovery-transport');
const { loadReviewedView } = require('../lib/reviewed-resolutions');

const root = path.resolve(__dirname, '../../..');
const audit = path.join(root, 'data/hpt-audit');
const sha = value => crypto.createHash('sha256').update(value).digest('hex');

test('three former Ascension Michigan campuses bind to distinct current Henry Ford pointer files', async () => {
  const proof = require(path.join(audit, 'reconciliation-henry-ford-transition-proof.json'));
  const recheck = require(path.join(audit, 'reconciliation-henry-ford-price-page-recheck.json'));
  const rawPointer = fs.readFileSync(path.join(root,
    'cms_data/hpt/pointer-corpus/raw/henryford.com-7f120444c17d.txt'));
  const pageSample = fs.readFileSync(path.join(root, recheck.recheck_sample));
  const $page = cheerio.load(pageSample.toString('utf8'));
  const pageLinks = $page('a[href]').map((_, node) =>
    new URL($page(node).attr('href'), recheck.page_url).href).get();
  const resolutions = require(path.join(audit, 'reviewed-resolutions.json'));
  const manual = require(path.join(audit, 'reconciliation-manual-access-observations.json')).records;
  const nationwide = require(path.join(audit, 'nationwide-verification.json')).records;
  const compliance = loadReviewedView(audit).compliance;
  assert.equal(sha(rawPointer), proof.pointer_sha256);
  assert.equal(sha(pageSample), recheck.recheck_sha256);
  assert.notEqual(recheck.recheck_sha256, recheck.reviewed_page_sha256);
  assert.deepEqual(recheck.exact_file_links_present_for_ccns, ['230197', '230241', '230254']);
  assert.deepEqual(proof.records.map(row => row.ccn), ['230197', '230241', '230254']);
  assert.equal(new Set(proof.records.map(row => row.mrf_url)).size, 3);
  for (const row of proof.records) {
    const sample = fs.readFileSync(path.join(root, row.retained_sample));
    const parsed = (await parsePayload(sample, 'text/csv')).parsed.find(item => item.innerKind === 'csv');
    const resolution = resolutions.find(item => item.ccn === row.ccn);
    const standing = compliance.find(item => item.ccn === row.ccn);
    const current = nationwide.find(item => item.ccn === row.ccn);
    const observation = manual.find(item => item.ccn === row.ccn);
    assert.equal(sample.length, 262144);
    assert.ok(row.file_total_bytes > sample.length);
    assert.equal(sha(sample), row.retained_sha256);
    assert.equal(parsed.mrfHospitalName, 'Henry Ford Health');
    assert.equal(parsed.mrfLocationName, row.facility_name);
    assert.equal(parsed.mrfAddress, row.declared_address);
    assert.equal(parsed.mrfLicenseState, 'MI');
    assert.equal(parsed.declaredLastUpdated, '2026-01-01');
    assert.equal(parsed.cmsVersion, '3.0.0');
    assert.ok(row.pointer_entry_without_contacts.includes(`mrf-url: ${row.mrf_url}`));
    assert.ok(pageLinks.includes(row.mrf_url));
    assert.equal(resolution.evidence.pointerSha256, proof.pointer_sha256);
    assert.equal(resolution.evidence.fileSha256, row.retained_sha256);
    assert.equal(resolution.evidence.url, row.mrf_url);
    assert.equal(standing.domain, 'henryford.com');
    assert.equal(standing.mrf_url, row.mrf_url);
    assert.equal(current.observation_role, 'superseded-retry');
    assert.equal(observation.current_mrf_sample_sha256, row.retained_sha256);
  }
  const river = proof.records.find(row => row.ccn === '230241');
  assert.equal(river.facility_page_bounded_text_identity, false);
  assert.match(river.facility_page_web_reader_identity, /4100 River Rd/);
  const providence = compliance.find(item => item.ccn === '230019');
  const providenceManifest = loadReviewedView(audit).manifest.find(item => item.ccn === '230019');
  assert.equal(providence.finding, 'compliant-observed');
  assert.equal(providence.mrf_url.includes('providence-southfield-hospital'), true);
  assert.equal(providenceManifest.extra_mrf_urls.includes('providence-novi-hospital'), true);
});
