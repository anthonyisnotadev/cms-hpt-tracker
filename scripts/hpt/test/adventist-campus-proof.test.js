'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.resolve(__dirname, '../../..');
const audit = path.join(root, 'data/hpt-audit');
const proof = require(path.join(audit, 'reconciliation-adventist-campus-proof.json'));
const routeProof = require(path.join(audit, 'reconciliation-adventist-bakersfield-current-portal-header-proof-2026-09-27.json'));
const stateCrosscheck = require(path.join(audit, 'reconciliation-adventist-bakersfield-state-address-crosscheck-2026-09-27.json'));
const ledger = require(path.join(audit, 'reviewed-resolutions.json'));
const observations = require(path.join(audit, 'reconciliation-manual-access-observations.json')).records;

test('Simi Valley alias and exact campus file are reviewed independently of Bakersfield', () => {
  assert.match(proof.first_party_legal_alias_source, /adventisthealth\.org/);
  assert.equal(proof.records['050236'].declared_address, '2975 Sycamore Dr Simi Valley CA 93065');
  assert.equal(proof.records['050236'].roster_address, '2975 N SYCAMORE DR');
  assert.equal(proof.records['050455'].declared_address, '3001 Sillect Avenue Bakersfield CA 93308|3001 Sillect Avenue Bakersfield CA 93308');
  assert.equal(proof.records['050455'].roster_address, '2615 CHESTER AVENUE');
  assert.equal(routeProof.current_portal_route_recheck.direct_target_recheck.sample_sha256,
    proof.records['050455'].sample_sha256);
  assert.equal(routeProof.current_portal_route_recheck.direct_target_recheck.sample_matches_retained_2026_09_25_sample, true);
  assert.match(routeProof.current_portal_route_recheck.route_logic, /hospital and mainDBName, map to dbAHBBAKERSFIELDCA/);
  assert.match(routeProof.unbound_partial_header_disposition, /exact final URL and sample hash were not retained/i);
  assert.match(routeProof.next_action, /request the source URL\/hash/);
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
  assert.equal(stateCrosscheck.observed_at, '2026-09-27T18:24:00Z');
  assert.match(stateCrosscheck.sources.find(source => source.kind.includes('Specialty')).observation, /HCAI ID 106154101/);
  assert.match(stateCrosscheck.sources.find(source => source.kind.includes('corporate')).observation,
    /2615 Chester Avenue.*3001 Sillect Avenue/);
  assert.equal(stateCrosscheck.disposition, 'unresolved-current-pointer-file-address-conflict');
  assert.match(stateCrosscheck.no_change, /not new MRF bytes and not resolution credit/);
  assert.equal(bakersfield.latest_directory_lead.evidence_role, 'third-party lead only; not first-party pointer or file identity evidence');
  assert.match(bakersfield.latest_directory_lead.transport_observation, /timed out/);
});
