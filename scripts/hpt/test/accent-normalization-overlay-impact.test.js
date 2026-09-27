'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { csvToObjects } = require('../lib/util');

const root = path.resolve(__dirname, '../../..');
const accent = /[\u00c0-\u024f]/;

test('current nationwide identity-selection inputs have no Latin accents to change a CCN disposition', () => {
  const roster = JSON.parse(fs.readFileSync(path.join(root, 'cms_data/hpt/roster.json'), 'utf8'));
  const headers = csvToObjects(fs.readFileSync(path.join(root,
    'cms_data/hpt/nationwide-verification/mrf-headers.csv'), 'utf8'));
  const browser = JSON.parse(fs.readFileSync(path.join(root,
    'data/hpt-audit/nationwide-browser-reviews.json'), 'utf8')).records;
  // The nationwide builder normalizes roster/header names to break a ranking
  // tie, and browser-declared names/addresses to adjudicate a retrieved file.
  // A newly accented input must trigger a fresh per-CCN review rather than
  // silently inheriting today's no-impact conclusion.
  assert.deepEqual(roster.filter(row => accent.test(`${row.name || ''} ${row.address || ''}`))
    .map(row => row.ccn), []);
  assert.deepEqual(headers.filter(row => accent.test(row.mrf_hospital_name || ''))
    .map(row => row.mrf_url), []);
  // The current browser evidence intentionally contains the official
  // Tséhootsooí Medical Center spelling for Fort Defiance (CCN 030071).
  // Keep that known source input explicit so a future accent change still
  // requires a fresh review instead of silently changing selection.
  assert.deepEqual(browser.filter(row => accent.test(`${row.declared_hospital_name || ''} ${row.declared_location_name || ''} ${row.declared_address || ''}`))
    .map(row => row.ccn || row.target).sort(), ['030071', '400141', 'https://www.fdihb.org/cms-hpt.txt'].sort());
});
