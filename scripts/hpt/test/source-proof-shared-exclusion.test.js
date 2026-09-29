'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const root = path.resolve(__dirname, '../../..');

test('shared-campus exclusions are classified separately from missing identity sources', () => {
  const audit = require(path.join(root, 'data/hpt-audit/nationwide-source-proof-audit.json'));
  const byCcn = new Map(audit.records.map(record => [record.ccn, record]));
  for (const ccn of ['331303', '370779', '370780']) {
    const record = byCcn.get(ccn);
    assert.ok(record, `missing source-proof record for ${ccn}`);
    assert.ok(record.issues.includes('shared-file-identity-excluded'), ccn);
    assert.ok(!record.issues.includes('claimed-identity-source-not-found'), ccn);
    assert.equal(record.identity_source, 'excluded');
  }
  for (const ccn of ['110100', '340123']) {
    const record = byCcn.get(ccn);
    assert.ok(record.issues.includes('identity-source-metadata-conflict'), ccn);
    assert.ok(!record.issues.includes('claimed-identity-source-not-found'), ccn);
    assert.equal(record.identity_source, 'metadata-conflict');
  }
});
