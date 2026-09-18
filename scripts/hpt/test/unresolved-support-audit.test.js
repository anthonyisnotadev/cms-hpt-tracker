'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');

test('every unresolved CCN has dated support and a specific next action',()=>{
  const root=path.resolve(__dirname,'../../..');
  const audit=path.join(root,'data/hpt-audit');
  const source=fs.readFileSync(path.join(audit,'nationwide-reconciliation.json'));
  const report=JSON.parse(fs.readFileSync(path.join(audit,'unresolved-support-audit.json')));
  const reconciliation=JSON.parse(source);
  const unresolved=reconciliation.records.filter(row=>row.workstream==='genuinely-unresolved-investigation');
  assert.equal(report.source_sha256,crypto.createHash('sha256').update(source).digest('hex'));
  assert.equal(report.unresolved_ccns,unresolved.length);
  assert.equal(report.supported_ccns,unresolved.length);
  assert.equal(report.missing_support_count,0);
  assert.deepEqual(report.missing,[]);
});
