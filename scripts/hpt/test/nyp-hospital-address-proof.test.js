'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { zipEntries } = require('../lib/recovery-transport');
const { applyResolutions } = require('../lib/reviewed-resolutions');

const root = path.resolve(__dirname, '../../..');
const proof = require(path.join(root, 'data/hpt-audit/reconciliation-nyp-hospital-address-proof.json'));
const resolution = require(path.join(root, 'data/hpt-audit/reviewed-resolutions.json'))
  .find(row => row.ccn === '330101');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

test('NewYork-Presbyterian shared file retains the literal Weill Cornell ZIP conflict', () => {
  assert.ok(resolution);
  assert.equal(resolution.evidence.pointerSha256, proof.pointer_sha256);
  assert.equal(resolution.evidence.sourcePageSha256, proof.source_page_sha256);
  assert.equal(resolution.evidence.identityPageSha256, proof.identity_page_sha256);
  const bytes = fs.readFileSync(path.join(root, proof.retained_file));
  assert.equal(bytes.length, proof.file_total_bytes);
  assert.equal(sha(bytes), proof.file_sha256);
  const members = zipEntries(bytes);
  assert.equal(members.length, 1);
  const member = zlib.inflateRawSync(bytes.subarray(members[0].start, members[0].start + members[0].size));
  assert.equal(sha(member), proof.member_sha256);
  const json = JSON.parse(member.toString('utf8'));
  assert.equal(json.standard_charge_information.length, proof.standard_charge_information_entries);
  assert.ok(json.hospital_address.includes(proof.declared_address));
  assert.equal(proof.declared_address, '525 East 68th Street New York NY 10021');
  assert.equal(proof.identity_page_address, '525 East 68th Street New York NY 10065');
  assert.equal(resolution.evidence.declared_address, proof.declared_address);
  assert.equal(resolution.evidence.facility_address, proof.identity_page_address);
  const view = applyResolutions([resolution.base], [], [], [resolution]);
  assert.equal(view.compliance[0].finding, 'mrf-address-field-conflicts-facility');
  assert.equal(view.compliance[0].mrf_url, proof.file_url);
});
