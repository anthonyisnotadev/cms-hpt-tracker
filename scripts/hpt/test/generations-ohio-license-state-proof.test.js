'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { csvToObjects } = require('../lib/util');
const { parsePointer } = require('../lib/parse');
const { parsePayload } = require('../lib/recovery-transport');
const { applyResolutions } = require('../lib/reviewed-resolutions');

const root = path.resolve(__dirname, '../../..');
const proof = require(path.join(root, 'data/hpt-audit/reconciliation-generations-ohio-license-state-proof.json'));
const ledger = require(path.join(root, 'data/hpt-audit/reviewed-resolutions.json'));
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

test('two complete Generations Ohio CSVs retain literal CA license-column conflict separately', async () => {
  assert.equal(proof.records.length, 2);
  assert.deepEqual(proof.records.map(row => row.ccn), ['364054', '364060']);
  const rows = csvToObjects(fs.readFileSync(path.join(root,
    'cms_data/hpt/pointer-corpus/cms_hpt_entries.csv'), 'utf8'));
  const current = rows.filter(row => row.pointer_url === proof.pointer_url
    && row.pointer_sha256 === proof.pointer_sha256);
  assert.equal(current.length, 2);
  const pointer = fs.readFileSync(path.join(root, current[0].raw_file));
  assert.equal(sha(pointer), proof.pointer_sha256);
  assert.equal(parsePointer(pointer.toString('utf8')).entries.length, 2);
  for (const row of proof.records) {
    const resolution = ledger.find(item => item.ccn === row.ccn);
    assert.ok(resolution);
    const bytes = fs.readFileSync(path.join(root, row.retained_file));
    assert.equal(bytes.length, row.file_total_bytes);
    assert.equal(sha(bytes), row.file_sha256);
    assert.ok(bytes.subarray(0, 4096).toString('utf8').includes('license_number|CA'));
    const parsed = (await parsePayload(bytes, 'text/csv')).parsed[0];
    assert.equal(parsed.mrfHospitalName, row.declared_hospital_name);
    assert.equal(parsed.mrfAddress, row.declared_address);
    assert.equal(parsed.mrfLicenseState, 'CA');
    assert.equal(row.roster_state, 'OH');
    assert.equal(resolution.evidence.sourcePageSha256, proof.locations_page_sha256);
    assert.equal(resolution.evidence.pointerSha256, proof.pointer_sha256);
    assert.equal(resolution.evidence.fileSha256, row.file_sha256);
    const match = current.find(item => item.mrf_url === row.mrf_url);
    assert.equal(match?.matched_ccns, row.ccn);
    const effective = applyResolutions([resolution.base], [], [], [resolution]).compliance[0];
    assert.equal(effective.finding, 'mrf-license-state-field-conflicts-facility');
    assert.equal(effective.mrf_url, row.mrf_url);
  }
  assert.equal(proof.records[1].roster_zip, '44504');
  assert.ok(proof.records[1].declared_address.endsWith('44505'));
});
