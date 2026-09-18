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
const proof = require(path.join(root, 'data/hpt-audit/reconciliation-multicare-deaconess-alias-proof.json'));
const resolution = require(path.join(root, 'data/hpt-audit/reviewed-resolutions.json'))
  .find(row => row.ccn === '500044');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

test('Deaconess legacy CCN maps to current MultiCare pointer and physical campus file', async () => {
  assert.ok(resolution);
  assert.equal(resolution.evidence.pointerSha256, proof.pointer_sha256);
  assert.equal(resolution.evidence.fileSha256, proof.file_sample_sha256);
  assert.equal(resolution.evidence.cmsLegacyNamePageSha256, proof.cms_legacy_name_page_sha256);
  assert.equal(resolution.evidence.dohCurrentCampusPageSha256, proof.doh_current_campus_page_sha256);
  const sample = fs.readFileSync(path.join(root, proof.retained_sample));
  assert.equal(sample.length, proof.file_sample_bytes);
  assert.equal(sha(sample), proof.file_sample_sha256);
  const parsed = (await parsePayload(sample, 'text/csv')).parsed[0];
  assert.equal(parsed.mrfHospitalName, 'MultiCare Deaconess Hospital');
  assert.ok(parsed.mrfAddress.includes(proof.declared_primary_address));
  assert.equal(parsed.mrfLicenseState, 'WA');
  const rows = csvToObjects(fs.readFileSync(path.join(root,
    'cms_data/hpt/pointer-corpus/cms_hpt_entries.csv'), 'utf8'));
  const current = rows.filter(row => row.pointer_url === proof.pointer_url
    && row.pointer_sha256 === proof.pointer_sha256 && row.mrf_url === proof.mrf_url);
  assert.equal(current.length, 2);
  assert.ok(current.every(row => row.matched_ccns.split('|').includes('500044')));
  const pointer = fs.readFileSync(path.join(root, current[0].raw_file));
  assert.equal(sha(pointer), proof.pointer_sha256);
  assert.equal(parsePointer(pointer.toString('utf8')).entries
    .filter(entry => entry.mrfUrl === proof.mrf_url).length, 2);
  const view = applyResolutions([resolution.base], [], [], [resolution]);
  assert.equal(view.compliance[0].mrf_url, proof.mrf_url);
  assert.equal(view.compliance[0].finding, 'compliant-observed');
  assert.equal(proof.roster_zip, '99210');
  assert.equal(proof.declared_primary_address, '800 West Fifth Avenue, Spokane, WA 99204');
});
