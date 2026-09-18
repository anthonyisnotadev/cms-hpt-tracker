'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { loadReviewedView } = require('../lib/reviewed-resolutions');
const { extractDeclared } = require('../lib/probe');

const root = path.resolve(__dirname, '../../..');
const audit = path.join(root, 'data/hpt-audit');

test('Grand Lake page-linked file is retained without promoting HTML root to pointer', () => {
  const proof = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-grand-lake-page-file-proof.json')));
  const bytes = role => fs.readFileSync(path.join(root, proof[role].retained_sample));
  const sha = value => crypto.createHash('sha256').update(value).digest('hex');
  assert.equal(sha(bytes('pointer')), proof.pointer.sha256);
  assert.equal(sha(bytes('source_page')), proof.source_page.sha256);
  assert.equal(sha(bytes('file')), proof.file.sample_sha256);
  assert.match(proof.pointer.content_type, /^text\/html/i);
  assert.ok(bytes('source_page').includes(Buffer.from(proof.file.url)));
  assert.equal(proof.file.retained_bytes, 262144);
  assert.equal(extractDeclared(bytes('file'), 'csv').address,
    '200 Saint Clair Street, Saint Marys, OH 45885');
  const resolution = JSON.parse(fs.readFileSync(path.join(audit, 'reviewed-resolutions.json')))
    .find(row => row.ccn === proof.ccn);
  assert.equal(resolution.action, 'replace-observation');
  assert.equal(resolution.evidence.observedFinding, 'root-pointer-html-page-with-official-page-file');
  const view = loadReviewedView(audit);
  assert.equal(view.compliance.find(row => row.ccn === proof.ccn).finding,
    'root-pointer-html-page-with-official-page-file');
  assert.equal(view.history[proof.ccn].finding, 'not-assessed-domain-unknown');
  const followUps = JSON.parse(fs.readFileSync(path.join(audit, 'standing-evidence-followup-worklist.json'))).records;
  for (const ccn of ['041313', '141338', '360032']) {
    const queued = followUps.find(row => row.ccn === ccn);
    assert.ok(queued, `HTML root pointer follow-up missing for ${ccn}`);
    assert.equal(queued.reviewed_follow_up, true);
    assert.match(queued.next_action, /pointer|cms-hpt/i);
  }
});
