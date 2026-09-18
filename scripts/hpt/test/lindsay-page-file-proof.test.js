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

test('Lindsay retains old finding as history and current HTML-root/page-file uncertainty', () => {
  const proof = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-lindsay-page-file-proof.json')));
  const bytes = role => fs.readFileSync(path.join(root, proof[role].retained_sample));
  const sha = value => crypto.createHash('sha256').update(value).digest('hex');
  assert.equal(sha(bytes('pointer')), proof.pointer.sha256);
  assert.equal(sha(bytes('source_page')), proof.source_page.sha256);
  assert.equal(sha(bytes('file')), proof.file.sample_sha256);
  assert.match(proof.pointer.content_type, /^text\/html/i);
  assert.ok(bytes('source_page').includes(Buffer.from(proof.file.url)));
  assert.ok(bytes('source_page').includes(Buffer.from('308 W. Cherokee')));
  assert.equal(extractDeclared(bytes('file'), 'csv').address, '1305 W Cherokee, Lindsay, OK, 73052');
  const view = loadReviewedView(audit);
  assert.equal(view.history[proof.ccn].finding, 'compliant-observed');
  assert.equal(view.compliance.find(row => row.ccn === proof.ccn).finding,
    'root-pointer-html-page-with-official-page-file');
  const nationwide = JSON.parse(fs.readFileSync(path.join(audit, 'nationwide-verification.json'))).records
    .find(row => row.ccn === proof.ccn);
  assert.equal(nationwide.observation_role, 'superseded-retry');
  assert.equal(nationwide.standing_mrf_url, proof.file.url);
  const followUps = JSON.parse(fs.readFileSync(path.join(audit, 'standing-evidence-followup-worklist.json'))).records;
  assert.ok(followUps.some(row => row.ccn === proof.ccn && row.reviewed_follow_up));
});
