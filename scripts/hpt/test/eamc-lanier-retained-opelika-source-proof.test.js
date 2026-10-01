'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../../..');
const audit = path.join(root, 'data/hpt-audit');
const proof = require(path.join(audit, 'reconciliation-eamc-lanier-official-price-list-retained-source-2026-09-29.json'));

test('retained East Alabama system file is reproducible Opelika evidence, not Lanier coverage', () => {
  const bytes = fs.readFileSync(path.join(audit, proof.retrieval.retained_file));
  assert.equal(bytes.length, proof.retrieval.content_length);
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), proof.retrieval.sha256);
  assert.equal(proof.retrieval.sha256, proof.comparison_to_prior_evidence.prior_zip_sha256);
  assert.equal(proof.archive_review.uncompressed_bytes, 212460800);
  assert.equal(proof.archive_review.uncompressed_sha256, '11b2222c25f4f47046f66cb58bf9e03c84a0c8d6be4efa8880c520e280eabb67');
  assert.equal(proof.archive_review.metadata.hospital_name, 'East Alabama Medical Center');
  assert.equal(proof.archive_review.metadata.location_name, 'East Alabama Medical Center');
  assert.match(proof.archive_review.metadata.hospital_address, /OPELIKA, AL/);
  assert.equal(proof.archive_review.metadata_record_count, 1);
  assert.equal(proof.comparison_to_prior_evidence.ccn_010780_remains_unresolved, true);
  assert.equal(proof.comparison_to_prior_evidence.frozen_891_unresolved_count_effect, 0);

  const observations = require(path.join(audit, 'reconciliation-manual-access-observations.json'));
  const observation = observations.records.find(item => item.ccn === '010780'
    && item.latest_complete_source_retention_recheck_2026_09_29);
  assert.ok(observation, 'manual observation should link the retained-source proof');
  assert.equal(observation.latest_complete_source_retention_recheck_2026_09_29.zip_sha256, proof.retrieval.sha256);

  const cmsScope = require(path.join(audit,
    'reconciliation-eamc-lanier-current-cms-reh-dataset-crosscheck-2026-09-29.json'));
  assert.equal(cmsScope.disposition_changed, false);
  assert.equal(cmsScope.count_effect, 0);
  assert.equal(cmsScope.cms_sources.length, 2);
  assert.equal(cmsScope.cms_sources[0].record.facility_id, '010780');
  assert.equal(cmsScope.cms_sources[0].record.address, '4800 48TH STREET');
  assert.match(cmsScope.next_action, /do not repeat its retrieval/);
  const latestScope = observation.latest_cms_reh_dataset_crosscheck_2026_09_29;
  assert.equal(latestScope.proof_file, cmsScope.audit_id + '.json');
  assert.equal(latestScope.new_mrf_bytes, false);

  const roster = require(path.join(audit, 'reconciliation-891-baseline-member-roster-2026-09-27.json'));
  assert.ok(roster.current_crosswalk_ccns['genuinely-unresolved'].includes('010780'));
});
