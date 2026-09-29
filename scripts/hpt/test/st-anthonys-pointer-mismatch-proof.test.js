'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { parsePayload } = require('../lib/recovery-transport');
const { loadReviewedView } = require('../lib/reviewed-resolutions');

const root = path.resolve(__dirname, '../../..');
const audit = path.join(root, 'data/hpt-audit');

test("St. Anthony's retained ZIP has the reviewed CSV and remains separate from its 404 pointer target", async () => {
  const proof = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-st-anthonys-pointer-mismatch-proof.json'), 'utf8'));
  const archive = fs.readFileSync(path.join(root, proof.retained_archive));
  const parsed = (await parsePayload(archive, 'application/x-zip-compressed', 262144)).parsed;
  const ledger = JSON.parse(fs.readFileSync(path.join(audit, 'reviewed-resolutions.json'), 'utf8'));
  const address = JSON.parse(fs.readFileSync(path.join(audit, 'reviewed-address-equivalences.json'), 'utf8'))
    .records.find(row => row.ccn === '100067');
  const resolution = ledger.find(row => row.ccn === '100067');
  const standing = loadReviewedView(audit).compliance.find(row => row.ccn === '100067');
  assert.equal(archive.length, 7259344);
  assert.equal(crypto.createHash('sha256').update(archive).digest('hex'), proof.current_archive_sha256);
  assert.equal(proof.pointer_mrf_http_status, 404);
  assert.notEqual(proof.pointer_mrf_url, proof.current_mrf_url);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].member, proof.archive_csv_member);
  assert.equal(parsed[0].mrfHospitalName, "St Anthony's Hospital");
  assert.equal(parsed[0].mrfAddress, '1200 7th Avenue St. Petersburg FL 33705');
  assert.equal(address.roster_address, '1200 SEVENTH AVE N, SAINT PETERSBURG FL 33705');
  assert.equal(resolution.evidence.observedFinding, 'pointer-links-unavailable-mrf-source-page-current-file');
  assert.equal(resolution.evidence.file_kind, 'zip');
  assert.equal(standing.finding, resolution.evidence.observedFinding);
  assert.equal(standing.mrf_url, proof.current_mrf_url);
});
