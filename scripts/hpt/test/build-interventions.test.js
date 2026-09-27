'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { INTERVENTIONS, classifyRow, evidenceUrlFor, interventionReason } = require('../build-interventions');

const ev = (fields) => Object.assign({ dns: 'ok', final_status: '', edge: '', error: '', url: 'https://x.test/cms-hpt.txt' }, fields);

test('blocked findings split into edge, origin, and client-signature causes', () => {
  assert.equal(classifyRow({ finding: 'pointer-blocked-to-automation', domain: 'x.test' },
    ev({ final_status: '403', edge: 'cloudflare' })).intervention, 'waf-blocked');
  assert.equal(classifyRow({ finding: 'mrf-blocked-to-automation', mrf_url: 'https://x.test/m.csv' },
    ev({ final_status: '429', cf_mitigated: 'challenge' })).intervention, 'waf-blocked');
  assert.equal(classifyRow({ finding: 'pointer-blocked-to-automation', domain: 'x.test' },
    ev({ final_status: '403' })).intervention, 'server-blocked');
  assert.equal(classifyRow({ finding: 'pointer-blocked-to-automation', domain: 'x.test' },
    ev({ final_status: '406', edge: 'cloudflare' })).intervention, 'client-rejected');
  // No fresh transcript: never guess a cause.
  assert.equal(classifyRow({ finding: 'mrf-blocked-to-automation', mrf_url: 'u' }, null).intervention, 'manual-review');
});

test('unreachable sites split into DNS-dead, connection-dead, and server error', () => {
  assert.equal(classifyRow({ finding: 'not-assessed-site-unreachable', domain: 'x.test' },
    ev({ dns: 'failed' })).intervention, 'dns-dead');
  assert.equal(classifyRow({ finding: 'not-assessed-site-unreachable', domain: 'x.test' },
    ev({ error: 'fetch failed (cause: ECONNREFUSED)' })).intervention, 'connection-dead');
  assert.equal(classifyRow({ finding: 'not-assessed-site-unreachable', domain: 'x.test' },
    ev({ final_status: '503' })).intervention, 'site-server-error');
});

test('no-pointer findings split into file-404, html-soft-block, and file-at-pointer-path', () => {
  assert.equal(classifyRow({ finding: 'no-cms-hpt-txt-published', domain: 'x.test' },
    ev({ final_status: '404' })).intervention, 'file-404');
  assert.equal(classifyRow({ finding: 'no-cms-hpt-txt-published', domain: 'x.test' },
    ev({ final_status: '202', bodyExcerpt: '<!doctype html><html><body>Page Not Found' })).intervention, 'html-soft-block');
  // A 200 whose body is a machine-readable file, not a web page: the site put
  // the charge file itself at the pointer path (observed: Hopedale, CCN 141330).
  assert.equal(classifyRow({ finding: 'no-cms-hpt-txt-published', domain: 'x.test' },
    ev({ final_status: '200', bodyExcerpt: 'hospital_name,last_updated_on,version,location_name' })).intervention,
    'file-at-pointer-path');
  // 200 with no transcript body to read: never guess which of the two it is.
  assert.equal(classifyRow({ finding: 'no-cms-hpt-txt-published', domain: 'x.test' },
    ev({ final_status: '200' })).intervention, 'manual-review');
});

test('MRF failures split into dead link, server error, and unreachable host', () => {
  assert.equal(classifyRow({ finding: 'mrf-url-unreachable', mrf_url: 'u' },
    ev({ final_status: '404' })).intervention, 'mrf-gone');
  assert.equal(classifyRow({ finding: 'mrf-url-unreachable', mrf_url: 'u' },
    ev({ final_status: '500' })).intervention, 'mrf-server-error');
  assert.equal(classifyRow({ finding: 'mrf-url-unreachable', mrf_url: 'u' },
    ev({ error: 'fetch failed (cause: ETIMEDOUT)' })).intervention, 'connection-dead');
});

test('usable-data, outreach, and lookup classes pass through with actions', () => {
  assert.equal(classifyRow({ finding: 'compliant-date-unverified' }, null).intervention, 'format-unusable');
  assert.equal(classifyRow({ finding: 'pointer-lists-no-mrf-url', hospital_name: 'X' }, null).intervention, 'pointer-mrf-unverified');
  assert.equal(classifyRow({ finding: 'pointer-links-older-mrf-than-source-page', hospital_name: 'X' }, null).intervention, 'pointer-file-mismatch');
  assert.equal(classifyRow({ finding: 'pointer-links-different-facility-mrf-source-page-file', hospital_name: 'X' }, null).intervention, 'pointer-different-facility-file');
  assert.equal(classifyRow({ finding: 'pointer-links-unavailable-mrf-source-page-current-file', hospital_name: 'X' }, null).intervention, 'pointer-target-unavailable-page-file');
  assert.equal(evidenceUrlFor({ finding: 'pointer-links-unavailable-mrf-source-page-current-file', pointer_url: 'https://x.test/cms-hpt.txt' }), 'https://x.test/cms-hpt.txt');
  assert.equal(classifyRow({ finding: 'pointer-links-html-download-page-with-file', hospital_name: 'X' }, null).intervention, 'pointer-html-intermediary');
  assert.equal(classifyRow({ finding: 'pointer-html-portal-not-found-source-page-current-file', hospital_name: 'X' }, null).intervention, 'pointer-portal-not-found');
  assert.equal(classifyRow({ finding: 'pointer-file-url-renders-not-found-source-page-current-file', hospital_name: 'X' }, null).intervention, 'pointer-file-renders-not-found');
  assert.equal(classifyRow({ finding: 'official-page-mrf-root-pointer-unavailable', hospital_name: 'X' }, null).intervention, 'official-page-file-pointer-unavailable');
  assert.equal(classifyRow({ finding: 'root-pointer-html-page-with-official-page-file', hospital_name: 'X' }, null).intervention, 'root-pointer-html-page-file');
  assert.equal(classifyRow({ finding: 'mrf-stale-over-365-days', mrf_last_updated: '2024-01-01', mrf_days_since_update: '600' }, null).intervention, 'stale-file');
  assert.equal(classifyRow({ finding: 'old-template-version', cms_template_version: '2.1.0' }, null).intervention, 'old-template');
  assert.equal(classifyRow({ finding: 'mrf-custom-workbook-metadata-unverified', cms_template_version: '' }, null).intervention, 'file-custom-workbook-review');
  assert.equal(classifyRow({ finding: 'mrf-license-state-field-conflicts-facility' }, null).intervention, 'file-license-state-conflict');
  assert.equal(classifyRow({ finding: 'mrf-address-field-conflicts-facility' }, null).intervention, 'file-address-conflict');
  assert.equal(classifyRow({ finding: 'not-assessed-not-named-in-file', domain: 'x.test' }, null).intervention, 'name-ambiguous');
  assert.equal(classifyRow({ finding: 'not-assessed-domain-unknown' }, null).intervention, 'domain-unknown');
  assert.equal(classifyRow({ finding: 'not-assessed-site-corrected', domain: 'x.test' }, null).intervention, 'corrected-site-pointer-pending');
  assert.equal(evidenceUrlFor({ finding: 'not-assessed-site-corrected', domain: 'x.test' }), 'https://x.test/cms-hpt.txt');
  assert.equal(classifyRow({ finding: 'not-assessed-site-observed', evidence: 'site lead' }, null).intervention, 'site-pointer-review');
  assert.equal(classifyRow({ finding: 'not-assessed-pointer-review', evidence: 'pointer lead' }, null).intervention, 'pointer-identity-review');
  assert.equal(classifyRow({ finding: 'not-assessed-domain-candidate', evidence: 'candidate lead' }, null).intervention, 'candidate-domain-review');
  assert.equal(classifyRow({ finding: 'not-assessed-domain-search-pending', evidence: 'not searched' }, null).intervention, 'domain-search-pending');
  assert.equal(classifyRow({ finding: 'not-assessed-domain-search-error', evidence: 'search failed' }, null).intervention, 'domain-search-retry');
  assert.equal(classifyRow({ finding: 'not-assessed-no-domain-candidate', evidence: 'no result' }, null).intervention, 'domain-unknown');
  assert.equal(classifyRow({ finding: 'not-applicable-federal' }, null).intervention, 'exempt-federal');
  assert.equal(classifyRow({ finding: 'not-applicable-indian-health-program', evidence: '638 compact proof' }, null).intervention,
    'exempt-ihs-program');
  assert.equal(classifyRow({ finding: 'not-applicable-state-hospital', evidence: '45 CFR 180.30(b) state hospital proof' }, null).intervention,
    'exempt-state-hospital');
  assert.equal(classifyRow({ finding: 'not-applicable-closed', evidence: 'Closed August 2025.' }, null).intervention, 'exempt-closed');
  assert.equal(classifyRow({ finding: 'compliant-observed' }, null).intervention, 'none');
  // Every branch must carry human-readable metadata for the tracker payload.
  for (const key of ['format-unusable', 'stale-file', 'old-template', 'name-ambiguous', 'domain-unknown', 'none', 'exempt-ihs-program']) {
    const meta = INTERVENTIONS[key];
    assert.ok(meta.label && meta.plain && meta.action, `${key} has label, plain, action`);
  }
});

test('uncertain observations do not become claims of invalid files or closed sites', () => {
  assert.equal(classifyRow({ finding: 'no-cms-hpt-txt-published' },
    ev({ final_status: '200', bodyExcerpt: 'location-name: Example\nmrf-url: https://example.org/data.csv' })).intervention, 'manual-review');
  assert.equal(classifyRow({ finding: 'no-cms-hpt-txt-published' },
    ev({ final_status: '200', bodyExcerpt: 'Please try again later.' })).intervention, 'manual-review');
  assert.equal(classifyRow({ finding: 'not-assessed-site-unreachable' },
    ev({ dns: 'failed', final_status: '403' })).intervention, 'server-blocked');
  assert.match(classifyRow({ finding: 'compliant-date-unverified' }, null).reason, /validity is unverified/);
  assert.match(classifyRow({ finding: 'not-assessed-not-named-in-file' }, null).reason, /matching did not establish/);
});

test('unmapped or ambiguous findings fall to manual-review, never a guess', () => {
  assert.equal(classifyRow({ finding: 'something-new' }, null).intervention, 'manual-review');
  assert.equal(classifyRow({ finding: 'not-assessed-site-unreachable', domain: 'x.test' }, null).intervention, 'manual-review');
});

test('evidenceUrlFor picks the URL whose transcript shows the problem', () => {
  assert.equal(evidenceUrlFor({ finding: 'mrf-blocked-to-automation', mrf_url: 'https://cdn/m.csv' }), 'https://cdn/m.csv');
  assert.equal(evidenceUrlFor({ finding: 'pointer-lists-no-mrf-url', pointer_url: 'https://x.test/cms-hpt.txt' }), 'https://x.test/cms-hpt.txt');
  assert.equal(evidenceUrlFor({ finding: 'pointer-links-older-mrf-than-source-page', pointer_url: 'https://x.test/cms-hpt.txt' }), 'https://x.test/cms-hpt.txt');
  assert.equal(evidenceUrlFor({ finding: 'pointer-links-different-facility-mrf-source-page-file', pointer_url: 'https://x.test/cms-hpt.txt' }), 'https://x.test/cms-hpt.txt');
  assert.equal(evidenceUrlFor({ finding: 'pointer-links-html-download-page-with-file', pointer_url: 'https://x.test/cms-hpt.txt' }), 'https://x.test/cms-hpt.txt');
  assert.equal(evidenceUrlFor({ finding: 'pointer-html-portal-not-found-source-page-current-file', pointer_url: 'https://x.test/cms-hpt.txt' }), 'https://x.test/cms-hpt.txt');
  assert.equal(evidenceUrlFor({ finding: 'official-page-mrf-root-pointer-unavailable', pointer_url: 'https://x.test/cms-hpt.txt' }), 'https://x.test/cms-hpt.txt');
  assert.equal(evidenceUrlFor({ finding: 'no-cms-hpt-txt-published', domain: 'x.test' }), 'https://x.test/cms-hpt.txt');
  assert.equal(evidenceUrlFor({ finding: 'not-assessed-domain-unknown', domain: '' }), '');
});

test('unresolved nationwide intervention reason uses the current worklist action', () => {
  const worklist = { current_disposition: 'mrf-request-unsuccessful',
    next_action: 'Seek a corrected publisher route after the browser denial.' };
  assert.equal(interventionReason({ finding: 'not-assessed-nationwide-mrf-request-unsuccessful' },
    'Stale browser retry', worklist),
  'Unresolved mrf-request-unsuccessful. Next: Seek a corrected publisher route after the browser denial.');
  assert.equal(interventionReason({ finding: 'compliant-observed' }, 'Original reason', worklist), 'Original reason');
  assert.equal(interventionReason({ finding: 'not-assessed-nationwide-mrf-request-unsuccessful' },
    'Original reason', null), 'Original reason');
});

test('identity-matched file field conflicts get specific operational follow-ups', () => {
  assert.equal(classifyRow({ finding: 'mrf-license-state-field-conflicts-facility' }, null).intervention,
    'file-license-state-conflict');
  assert.equal(classifyRow({ finding: 'mrf-address-field-conflicts-facility' }, null).intervention,
    'file-address-conflict');
  assert.equal(classifyRow({ finding: 'mrf-address-field-incomplete' }, null).intervention,
    'file-address-incomplete');
  assert.match(INTERVENTIONS['file-license-state-conflict'].action, /publisher correction/);
  assert.match(INTERVENTIONS['file-address-conflict'].action, /distinguishing spelling errors from different campuses/);
});
