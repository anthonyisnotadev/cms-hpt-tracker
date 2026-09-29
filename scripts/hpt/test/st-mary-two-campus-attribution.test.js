'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { parsePointer } = require('../lib/parse');
const { csvToObjects } = require('../lib/util');
const { loadReviewedView } = require('../lib/reviewed-resolutions');

const root = path.resolve(__dirname, '../../..');
const audit = path.join(root, 'data/hpt-audit');
const headers = csvToObjects(fs.readFileSync(path.join(root, 'cms_data/hpt/nationwide-verification/mrf-headers.csv'), 'utf8'));
const roster = new Map(JSON.parse(fs.readFileSync(path.join(root, 'cms_data/hpt/roster.json'), 'utf8')).map(row => [row.ccn, row]));
const resolutions = new Map(JSON.parse(fs.readFileSync(path.join(audit, 'reviewed-resolutions.json'), 'utf8')).map(row => [row.ccn, row]));
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

for (const item of [
  { ccn: '050191', city: 'LONG BEACH', street: '1050 LINDEN',
    raw: 'cms_data/hpt/pointer-corpus/raw/commonspirit.org-33ecdc735565.txt',
    displacedCity: 'Apple Valley' },
  { ccn: '050300', city: 'APPLE VALLEY', street: '18300 HIGHWAY 18',
    raw: 'cms_data/hpt/pointer-corpus/raw/providence.org-9c11a85b0400.txt',
    displacedCity: 'Long Beach' }
]) {
  test(`${item.ccn} selected St Mary file belongs to its exact campus`, () => {
    const resolution = resolutions.get(item.ccn);
    const evidence = resolution.evidence;
    const bytes = fs.readFileSync(path.join(root, item.raw));
    assert.equal(sha(bytes), evidence.pointerSha256);
    assert.ok(parsePointer(bytes.toString('utf8')).entries.some(entry =>
      entry.mrfUrls?.includes(evidence.url)), 'selected file is listed in retained pointer bytes');
    const header = headers.find(row => row.mrf_url === evidence.url);
    assert.ok(header, 'selected file has a bounded header observation');
    assert.equal(header.mrf_last_updated, evidence.date);
    assert.equal(header.mrf_cms_version, evidence.version);
    assert.equal(header.mrf_license_state, 'CA');
    assert.ok(header.mrf_address.toUpperCase().includes(item.city));
    assert.ok(header.mrf_address.toUpperCase().includes(item.street));
    assert.equal(roster.get(item.ccn).city, item.city);
    assert.ok(roster.get(item.ccn).address.includes(item.street));
    assert.ok(resolution.base.mrf_url !== evidence.url);
    const view = loadReviewedView(audit, { nationwide: false });
    const current = view.compliance.find(row => row.ccn === item.ccn);
    assert.equal(current.pointer_url, evidence.pointerUrl);
    assert.equal(current.mrf_url, evidence.url);
    assert.ok(view.history[item.ccn].mrf_url.includes(item.displacedCity === 'Long Beach' ? 'dignity-health' : 'providence-st-mary'));
  });
}
