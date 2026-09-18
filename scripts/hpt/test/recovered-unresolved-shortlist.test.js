'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '../../..');
const audit = path.join(root, 'data/hpt-audit');

test('recovered unresolved shortlist is current, CCN-scoped and withholds signed URLs', () => {
  const shortlist = JSON.parse(fs.readFileSync(path.join(audit, 'recovered-unresolved-shortlist.json'), 'utf8'));
  const inputs = {
    queue: path.join(audit, 'nationwide-reconciliation-queue.json'),
    recovery: path.join(audit, 'rechecks/2026-09-09/recovery-856/file-evidence.csv'),
    compliance: path.join(audit, 'compliance.csv'),
  };
  for (const [key, file] of Object.entries(inputs)) {
    assert.equal(shortlist.source_sha256[key], crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'));
  }
  const queue = JSON.parse(fs.readFileSync(inputs.queue, 'utf8'));
  const unresolved = new Map(queue.filter(row => row.workstream === 'genuinely-unresolved-investigation')
    .map(row => [row.ccn, row]));
  assert.equal(new Set(shortlist.records.map(row => row.ccn)).size, shortlist.records.length);
  for (const row of shortlist.records) {
    assert.ok(unresolved.has(row.ccn));
    assert.ok(row.recovery_file_sha256);
    assert.equal(row.next_action, unresolved.get(row.ccn).next_action);
    assert.doesNotMatch(row.candidate_url, /[?&](?:sig|token|key|secret)=/i);
    assert.doesNotMatch(row.source_page_url, /[?&](?:sig|token|key|secret)=/i);
    if (row.candidate_url_withheld) assert.equal(row.candidate_url, '');
  }
});
