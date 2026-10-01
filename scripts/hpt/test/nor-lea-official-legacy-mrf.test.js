'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { csvToObjects } = require('../lib/util');

const root = path.resolve(__dirname, '../../..');
const audit = path.join(root, 'data/hpt-audit');

test('Nor-Lea first-party 2025 file is retained as historical evidence without replacing the 2026 conflict', () => {
  const proof = JSON.parse(fs.readFileSync(path.join(audit,
    'reconciliation-nor-lea-official-legacy-mrf-2026-09-29.json'), 'utf8'));
  const artifactPath = path.join(root, proof.retained_artifact);
  const bytes = fs.readFileSync(artifactPath);
  const hash = crypto.createHash('sha256').update(bytes).digest('hex');
  const rows = csvToObjects(bytes.toString('utf8'));
  assert.equal(proof.ccn, '321305');
  assert.equal(proof.first_party_source_page.url, 'https://nor-lea.org/resources');
  assert.equal(proof.first_party_source_page.source_link, 'https://nor-lea.org/s/Standard-Charges');
  assert.equal(proof.retrieval.complete_response, true);
  assert.equal(proof.retrieval.total_bytes, 5543873);
  assert.equal(proof.retrieval.sha256, hash);
  assert.equal(proof.declared_metadata.address, '1600 North Main Avenue, Lovington, NM 88260');
  assert.equal(proof.declared_metadata.last_updated_on, '2025-01-01');
  assert.equal(proof.declared_metadata.cms_template_version, '2.0.0');
  assert.equal(proof.declared_metadata.parsed_rows, 24307);
  assert.equal(rows.length, 24307);
  assert.equal(rows[0].hospital_name, 'Nor-Lea District Hospital');
  assert.equal(proof.comparison.newer_declared_address, '1900 North Main Avenue, Lovington, NM 88260-2813');
  assert.equal(proof.disposition_effect, 'none; retain CCN 321305 unresolved for the current 2026 MRF address conflict and pointer linkage; add this older first-party file as dated historical evidence only.');
  const manual = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-manual-access-observations.json'), 'utf8'))
    .records.find(row => row.ccn === '321305');
  assert.equal(manual.latest_official_publisher_downloaded_legacy_mrf_2026_09_29.file_sha256, hash);
  assert.equal(manual.disposition, 'mrf-address-field-conflicts-facility');
});
