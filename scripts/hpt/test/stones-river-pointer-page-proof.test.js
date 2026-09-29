'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { loadReviewedView } = require('../lib/reviewed-resolutions');

const root = path.resolve(__dirname, '../../..');
const audit = path.join(root, 'data/hpt-audit');

test('Stones River page file remains distinct from the broken pointer target', () => {
  const ledger = JSON.parse(fs.readFileSync(path.join(audit, 'reviewed-resolutions.json'), 'utf8'));
  const resolution = ledger.find(row => row.ccn === '440200');
  const e = resolution.evidence;
  const pointer = fs.readFileSync(path.join(root,
    'cms_data/hpt/pointer-corpus/raw/healthcare.ascension.org-f895488a5ab3.txt'), 'utf8');
  const stanza = pointer.split(/(?=^location-name:)/m)
    .find(part => part.startsWith(`location-name: ${e.pointerLocationName}`));
  const standing = loadReviewedView(audit).compliance.find(row => row.ccn === '440200');

  assert.equal(crypto.createHash('sha256').update(pointer).digest('hex'), e.pointerSha256);
  assert.ok(stanza);
  assert.match(stanza, /^source-page-url: https:\/\/healthcare\.ascension\.org\/price-transparency$/m);
  assert.equal(stanza.match(/^mrf-url:\s*(.+)$/m)?.[1], e.pointerMrfUrl);
  assert.equal(e.pointerMrfHttpStatus, 404);
  assert.notEqual(e.pointerMrfUrl, e.url);
  assert.equal(e.declared_address, '324 Doolittle Rd Woodbury TN 37190');
  assert.equal(e.declared_license_state, 'TN');
  assert.equal(e.completeFileValidated, false);
  assert.equal(standing.finding, 'pointer-links-unavailable-mrf-source-page-current-file');
  assert.equal(standing.mrf_url, e.url);
  assert.equal(standing.assessable, 'yes');
});
