'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cheerio = require('cheerio');
const { parsePayload } = require('../lib/recovery-transport');
const { loadReviewedView, applyResolutions } = require('../lib/reviewed-resolutions');

const root = path.resolve(__dirname, '../../..');
const audit = path.join(root, 'data/hpt-audit');
const sha = value => crypto.createHash('sha256').update(value).digest('hex');

test('combined Providence CCN keeps both Southfield and Novi pointer-linked files', async () => {
  const proof = require(path.join(audit, 'reconciliation-providence-two-campus-proof.json'));
  const pointer = fs.readFileSync(path.join(root,
    'cms_data/hpt/pointer-corpus/raw/henryford.com-7f120444c17d.txt'));
  const resolution = require(path.join(audit, 'reviewed-resolutions.json'))
    .find(row => row.ccn === '230019');
  const view = loadReviewedView(audit);
  const manifest = view.manifest.find(row => row.ccn === '230019');
  const standing = view.compliance.find(row => row.ccn === '230019');
  const nationwide = require(path.join(audit, 'nationwide-verification.json')).records
    .find(row => row.ccn === '230019');
  const worklist = require(path.join(audit, 'unresolved-investigation-worklist.json')).records;
  assert.equal(sha(pointer), proof.pointer_sha256);
  assert.deepEqual(proof.records.map(row => row.campus), ['Southfield', 'Novi']);
  assert.match(proof.relationship_observation, /two campuses/);
  assert.match(proof.bylaws_web_reader_observation, /16001 West Nine Mile Road.*47601 Grand River Avenue/);
  for (const record of proof.records) {
    const sample = fs.readFileSync(path.join(root, record.retained_sample));
    const parsed = (await parsePayload(sample, 'text/csv')).parsed.find(row => row.innerKind === 'csv');
    const block = pointer.toString('utf8').split(/\r?\n\s*\r?\n/).find(text =>
      text.includes(`location-name: ${record.pointer_location_name}`));
    assert.ok(block?.includes(`mrf-url: ${record.mrf_url}`));
    assert.equal(sha(sample), record.retained_sha256);
    assert.equal(sample.length, 262144);
    assert.ok(record.file_total_bytes > sample.length);
    assert.equal(parsed.mrfHospitalName, 'Henry Ford Health');
    assert.equal(parsed.mrfLocationName, record.declared_location_name);
    assert.equal(parsed.mrfAddress, record.declared_address);
    assert.equal(parsed.mrfLicenseState, 'MI');
    assert.equal(parsed.declaredLastUpdated, '2026-01-01');
    assert.equal(parsed.cmsVersion, '3.0.0');
  }
  const [southfield, novi] = proof.records;
  const pageRecheck = require(path.join(audit, 'reconciliation-henry-ford-price-page-recheck.json'));
  const pageBytes = fs.readFileSync(path.join(root, pageRecheck.recheck_sample));
  const $page = cheerio.load(pageBytes.toString('utf8'));
  const pageLinks = $page('a[href]').map((_, node) =>
    new URL($page(node).attr('href'), pageRecheck.page_url).href).get();
  assert.equal(sha(pageBytes), pageRecheck.recheck_sha256);
  assert.ok(pageLinks.includes(southfield.mrf_url));
  assert.ok(pageLinks.includes(novi.mrf_url));
  assert.equal(standing.domain, 'henryford.com');
  assert.equal(standing.mrf_url, southfield.mrf_url);
  assert.equal(manifest.extra_mrf_urls, novi.mrf_url);
  assert.equal(resolution.evidence.additionalFiles[0].fileSha256, novi.retained_sha256);
  assert.equal(nationwide.observation_role, 'superseded-retry');
  assert.deepEqual(nationwide.standing_additional_mrf_urls, [novi.mrf_url]);
  assert.equal(worklist.some(row => row.ccn === '230019'), false);

  const html = fs.readFileSync(path.join(root, 'tracker.html'), 'utf8');
  const open = '<script id="tracker-data" type="application/json">';
  const start = html.indexOf(open), end = html.indexOf('</script>', start);
  assert.ok(start >= 0 && end > start);
  const data = JSON.parse(html.slice(start + open.length, end));
  const trackerRow = data.rows.find(row => row[0] === '230019');
  assert.equal(trackerRow[8], southfield.mrf_url);
  assert.deepEqual(data.additionalFiles['230019'], [['Novi campus', novi.mrf_url]]);
  assert.equal(data.primaryFileLabels['230019'], 'Southfield campus');
  assert.equal(data.auditHistory['230019'].mrf_url, '');
  assert.match(data.auditHistory['230019'].evidence, /does not name this hospital/);
  const bad = structuredClone(resolution);
  bad.evidence.additionalFiles[0].declared_license_state = 'CA';
  assert.throws(() => applyResolutions([bad.base], [], [], [bad]), /lacks current, pointer-linked identity/);
});
