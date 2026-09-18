'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { parsePointer } = require('../lib/parse');
const { loadReviewedView } = require('../lib/reviewed-resolutions');

const root = path.resolve(__dirname, '../../..');
const audit = path.join(root, 'data/hpt-audit');
const proof = require(path.join(audit, 'reconciliation-ucsf-community-hospitals-transition-proof.json'));

test('UCSF Hyde and Stanyan have distinct exact-campus pointer targets and JSON samples', () => {
  const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
  const entries = parsePointer(fs.readFileSync(path.join(root, proof.sanitized_pointer_entries), 'utf8')).entries;
  const view = loadReviewedView(audit);
  const ledger = require(path.join(audit, 'reviewed-resolutions.json'));
  assert.equal(entries.length, 2);
  assert.notEqual(proof.records[0].mrf_url, proof.records[1].mrf_url);
  for (const [i, row] of proof.records.entries()) {
    const sample = fs.readFileSync(path.join(root, row.retained_sample));
    assert.equal(entries[i].locationName, row.pointer_location_name);
    assert.equal(entries[i].mrfUrl, row.mrf_url);
    assert.equal(sample.length, 262144);
    assert.equal(sha(sample), row.mrf_sample_sha256);
    assert.ok(sample.toString('utf8', 0, 500).includes(row.declared_address));
    const resolution = ledger.find(item => item.ccn === row.ccn);
    assert.equal(resolution.action, 'replace');
    assert.equal(resolution.evidence.url, row.mrf_url);
    const standing = view.compliance.find(item => item.ccn === row.ccn);
    assert.equal(standing.finding, 'compliant-observed');
    assert.equal(standing.mrf_url, row.mrf_url);
    assert.equal(view.history[row.ccn].finding, 'not-assessed-not-named-in-file');
  }
});
