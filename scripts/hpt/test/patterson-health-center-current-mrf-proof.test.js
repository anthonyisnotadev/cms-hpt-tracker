'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { parseCSV, csvToObjects } = require('../lib/util');
const { extractDeclared } = require('../lib/probe');

const root = path.resolve(__dirname, '../../..');
const audit = path.join(root, 'data/hpt-audit');
const proofFile = 'reconciliation-patterson-health-center-current-mrf-proof-2026-09-29.json';

test('Patterson CCN 171346 uses the corrected live pointer key and a complete identity-matched current MRF', () => {
  const proof = JSON.parse(fs.readFileSync(path.join(audit, proofFile), 'utf8'));
  assert.equal(proof.ccn, '171346');
  assert.equal(proof.official_root_pointer.status, 200);
  assert.equal(proof.official_root_pointer.parsed_location_name, 'Patterson Health Center');
  assert.match(proof.official_root_pointer.parsed_mrf_url, /dbName=dbAMCANTHONYKS/);
  assert.equal(proof.publisher_pricing_page.browser_observation.includes('dbName=hospital'), true);
  assert.equal(proof.mrf.status, 200);
  assert.equal(proof.mrf.bytes, 8536635);
  assert.equal(proof.mrf.sha256, '0c5091ecfb5d8b505f38cee638f554ade512af1a2fa2dbdc1e826ba775068cbc');
  assert.equal(proof.mrf.declared_hospital_name, 'HOSPITAL DISTRICT NO 6 OF HARPER COUNTY KANSAS');
  assert.equal(proof.mrf.declared_address, '485 KS-2 Hwy 2 Anthony KS 67003');
  assert.equal(proof.mrf.declared_license_state, 'KS');
  assert.equal(proof.mrf.declared_npi, '1467427674');
  assert.equal(proof.mrf.declared_last_updated, '2026-02-10');
  assert.equal(proof.mrf.cms_template_version, '3.0.0');
  assert.equal(proof.mrf.declared_attestation, true);

  const retainedPath = path.join(audit, proof.mrf.retained_file);
  const bytes = fs.readFileSync(retainedPath);
  assert.equal(bytes.length, proof.mrf.bytes);
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), proof.mrf.sha256);
  const metadata = extractDeclared(bytes, 'csv');
  assert.equal(metadata.raw, '2026-02-10');
  assert.equal(metadata.version, '3.0.0');
  assert.equal(metadata.hospitalName, 'HOSPITAL DISTRICT NO 6 OF HARPER COUNTY KANSAS');
  assert.equal(metadata.address, '485 KS-2 Hwy 2 Anthony KS 67003');
  assert.equal(metadata.licenseState, 'KS');
  const rows = parseCSV(bytes.toString('utf8'));
  assert.equal(rows.length - 3, 26408);
  assert.equal(rows[2].length, 28);
  assert.ok(rows.slice(3).every(row => row.length === 28));

  const cms = proof.cms_provider_record.record;
  assert.equal(cms.facility_id, proof.ccn);
  assert.equal(cms.facility_name, 'HOSPITAL DISTRICT #6 PATTERSON HEALTH CENTER');
  assert.equal(cms.city, 'ANTHONY');
  assert.equal(cms.state, 'KS');
  assert.equal(proof.cms_npi_registry_record.record.npi, proof.mrf.declared_npi);
  assert.equal(proof.cms_npi_registry_record.record.organization_name, proof.mrf.declared_hospital_name);
  assert.equal(proof.cms_npi_registry_record.record.doing_business_as, 'PATTERSON HEALTH CENTER');
  assert.equal(proof.disposition, 'verified-current-mrf');
  assert.match(proof.interpretation, /not a legal compliance determination/);

  const ledger = JSON.parse(fs.readFileSync(path.join(audit, 'reviewed-resolutions.json'), 'utf8'));
  const resolution = ledger.find(row => row.ccn === proof.ccn);
  assert.ok(resolution);
  assert.equal(resolution.finding, 'verified-current-mrf');
  assert.equal(resolution.evidence.pointerSha256, proof.official_root_pointer.response_sha256);
  assert.equal(resolution.evidence.fileSha256, proof.mrf.sha256);

  const manual = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-manual-access-observations.json'), 'utf8'));
  assert.ok(manual.records.some(row => row.ccn === proof.ccn && row.proof_file === proofFile
    && row.disposition === 'verified-current-mrf'));
  const browser = JSON.parse(fs.readFileSync(path.join(audit, 'nationwide-browser-reviews.json'), 'utf8'));
  assert.ok(browser.records.some(row => row.ccn === proof.ccn && row.proof_file === proofFile
    && row.file_sha256 === proof.mrf.sha256));
  const byteProof = JSON.parse(fs.readFileSync(path.join(audit, 'nationwide-file-byte-proof.json'), 'utf8'));
  assert.ok(byteProof.records.some(row => (row.ccns || []).includes(proof.ccn)
    && row.sha256 === proof.mrf.sha256 && row.bytes_retained === proof.mrf.bytes));

  const search = JSON.parse(fs.readFileSync(path.join(audit, 'nationwide-search-reviews.json'), 'utf8'));
  const searchRecord = search.records.find(row => row.ccn === proof.ccn);
  assert.equal(searchRecord.status, 'official');
  assert.equal(searchRecord.domain, 'pattersonhc.org');
  assert.equal(searchRecord.query, 'site:pattersonhc.org price transparency CMS MRF Patterson Health Center');
  const discovery = JSON.parse(fs.readFileSync(path.join(audit, 'discovery-review.json'), 'utf8'));
  const historicalDiscovery = discovery.records.find(row => row.ccn === proof.ccn);
  assert.equal(historicalDiscovery.observed_at, '2026-09-15T02:56:12.605Z');
  assert.equal(historicalDiscovery.disposition, 'pointer-not-retrieved',
    'retain the earlier 403 discovery result as dated history, distinct from the newer pointer proof');
  const raw = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8'))
    .find(row => row.ccn === proof.ccn);
  assert.equal(raw.finding, 'not-assessed-domain-unknown', 'do not rewrite the original crawl row');

  const verification = JSON.parse(fs.readFileSync(path.join(audit, 'nationwide-verification.json'), 'utf8'));
  const row = verification.records.find(item => item.ccn === proof.ccn);
  assert.ok(row);
  assert.equal(row.disposition, 'verified-current-mrf');
  assert.equal(row.mrf_url, proof.mrf.url);
  const cohort = JSON.parse(fs.readFileSync(path.join(audit,
    'reconciliation-891-baseline-member-roster-2026-09-27.json'), 'utf8'));
  assert.ok(cohort.current_crosswalk_ccns['superseded-by-reviewed-resolution'].includes(proof.ccn));
  assert.equal(cohort.summary.current_effective_categories['genuinely-unresolved'], 541);
  assert.equal(cohort.summary.current_effective_categories['active-verification-claim'], 21);
  assert.equal(cohort.summary.current_effective_categories['superseded-by-reviewed-resolution'], 29);
});
