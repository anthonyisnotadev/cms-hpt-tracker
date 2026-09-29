'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { loadReviewedView } = require('../lib/reviewed-resolutions');

const root = path.resolve(__dirname, '../../..');
const audit = path.join(root, 'data/hpt-audit');

test('Bayamon correction uses its exact pointer entry and keeps URL spellings distinct', () => {
  const ledger = JSON.parse(fs.readFileSync(path.join(audit, 'reviewed-resolutions.json'), 'utf8'));
  const resolution = ledger.find(row => row.ccn === '400102');
  const e = resolution.evidence;
  const pointer = fs.readFileSync(path.join(root,
    'cms_data/hpt/pointer-corpus/raw/doctorscenterhospital.com-7b0b5067a9a9.txt'), 'utf8');
  const stanza = pointer.split(/(?=^location-name:)/m)
    .find(part => part.startsWith(`location-name: ${e.pointerLocationName}`));
  const standing = loadReviewedView(audit).compliance.find(row => row.ccn === '400102');

  assert.equal(crypto.createHash('sha256').update(pointer).digest('hex'), e.pointerSha256);
  assert.ok(stanza);
  assert.equal(stanza.match(/^mrf-url:\s*(.+)$/m)?.[1], e.url);
  assert.equal(stanza.match(/^source-page-url:\s*(.+)$/m)?.[1], e.pointerSourcePageUrl);
  assert.notEqual(e.sourcePageFileUrl, e.url);
  assert.equal(e.sourcePageFileSha256, e.fileSha256);
  assert.equal(e.fullFileBytes, 4387852);
  assert.equal(e.fullFileJsonParsed, true);
  assert.equal(e.rateSchemaValidated, false);
  assert.equal(e.declared_license_state, 'PR');
  assert.match(e.declared_address, /Calle J #9.*Bayamon, PR 00960/);
  assert.equal(standing.finding, 'compliant-observed');
  assert.equal(standing.mrf_url, e.url);
});
