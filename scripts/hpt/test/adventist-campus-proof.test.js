'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.resolve(__dirname, '../../..');
const audit = path.join(root, 'data/hpt-audit');
const proof = require(path.join(audit, 'reconciliation-adventist-campus-proof.json'));
const ledger = require(path.join(audit, 'reviewed-resolutions.json'));
const observations = require(path.join(audit, 'reconciliation-manual-access-observations.json')).records;

test('Simi Valley alias and exact campus file are reviewed independently of Bakersfield', () => {
  assert.match(proof.first_party_legal_alias_source, /adventisthealth\.org/);
  assert.equal(proof.records['050236'].declared_address, '2975 Sycamore Dr Simi Valley CA 93065');
  assert.equal(proof.records['050236'].roster_address, '2975 N SYCAMORE DR');
  assert.equal(proof.records['050455'].declared_address, '3001 Sillect Avenue Bakersfield CA 93308|3001 Sillect Avenue Bakersfield CA 93308');
  assert.equal(proof.records['050455'].roster_address, '2615 CHESTER AVENUE');
  for (const record of Object.values(proof.records)) {
    const bytes = fs.readFileSync(path.join(root, record.retained_sample));
    assert.equal(bytes.length, record.retained_bytes);
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), record.sample_sha256);
  }
  const simi = ledger.find(row => row.ccn === '050236');
  assert.equal(simi.action, 'replace');
  assert.equal(simi.evidence.url, proof.records['050236'].file_url);
  assert.equal(simi.evidence.pointerSha256, proof.pointer_sha256);
  assert.equal(ledger.some(row => row.ccn === '050455'), false);
  const bakersfield = observations.find(row => row.ccn === '050455');
  assert.equal(bakersfield.disposition, 'shared-pointer-entry-file-header-identifies-specialty-campus-not-main-roster-address');
  assert.equal(bakersfield.mrf_sample_sha256, proof.records['050455'].sample_sha256);
  assert.equal(bakersfield.latest_directory_lead.evidence_role, 'third-party lead only; not first-party pointer or file identity evidence');
  assert.match(bakersfield.latest_directory_lead.transport_observation, /timed out/);
});
