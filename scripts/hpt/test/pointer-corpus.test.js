'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const { parsePointer } = require('../lib/parse');
const { csvToObjects } = require('../lib/util');
const {
  fetchKnownPointer, fetchDomainPointer, loadSourceCatalog, runCorpus, toRFC4180
} = require('../pointer-corpus');

function response(body, status = 200, finalUrl = '') {
  const res = new Response(body, { status, headers: { 'content-type': 'text/plain' } });
  if (finalUrl) Object.defineProperty(res, 'url', { value: finalUrl });
  return res;
}

async function tempRoot(t) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'hpt-corpus-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  await fsp.mkdir(path.join(root, 'data', 'hpt-audit'), { recursive: true });
  await fsp.mkdir(path.join(root, 'cms_data', 'hpt'), { recursive: true });
  return root;
}

test('pointer parser preserves aliases, repeated URLs, JSON arrays, and unknown fields', () => {
  const text = parsePointer('\uFEFF# comment\nlocation_name: Example, Hospital\n' +
    'source_page_url: https://example.test/pricing\n' +
    'mrf-url: https://files.test/a.csv\nmrf_url: https://files.test/b.json\n' +
    'contact_email: billing@example.test\ncustom-field: first\ncustom-field: second\n');
  assert.equal(text.format, 'txt');
  assert.deepEqual(text.entries[0].mrfUrls, ['https://files.test/a.csv', 'https://files.test/b.json']);
  assert.equal(text.entries[0].contactEmail, 'billing@example.test');
  assert.deepEqual(text.entries[0].extraFields['custom-field'], ['first', 'second']);

  const json = parsePointer(JSON.stringify({ locations: [{
    location_name: 'JSON\nHospital',
    mrf_url: ['https://files.test/c.csv', 'https://files.test/d.csv'],
    custom: { preserved: true }
  }] }));
  assert.equal(json.format, 'json');
  assert.deepEqual(json.entries[0].mrfUrls, ['https://files.test/c.csv', 'https://files.test/d.csv']);
  assert.deepEqual(json.entries[0].extraFields.custom, { preserved: true });
});

test('known URL fetch follows redirects, enforces a byte cap, and never follows MRF links', async () => {
  const calls = [];
  const pointer = 'location-name: Example\nmrf-url: https://files.test/never-requested.csv\n';
  const ok = await fetchKnownPointer('https://alias.test/cms-hpt.txt', {
    timeoutMs: 1000, maxBytes: 1024,
    fetchImpl: async url => { calls.push(String(url)); return response(pointer, 200, 'https://canonical.test/cms-hpt.txt'); }
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.finalUrl, 'https://canonical.test/cms-hpt.txt');
  assert.deepEqual(calls, ['https://alias.test/cms-hpt.txt']);

  const capped = await fetchKnownPointer('https://large.test/cms-hpt.txt', {
    timeoutMs: 1000, maxBytes: 5, fetchImpl: async () => response(pointer)
  });
  assert.equal(capped.ok, false);
  assert.equal(capped.reason, 'too-large');
});

test('domain fetch tries the permitted locations without using an unblocker', async () => {
  const calls = [];
  const pointer = 'location-name: Well Known\nmrf-url: https://files.test/well-known.csv\n';
  const result = await fetchDomainPointer('fallback.test', {
    timeoutMs: 1000, maxBytes: 1024,
    fetchImpl: async url => {
      calls.push(String(url));
      if (String(url) === 'https://fallback.test/.well-known/cms-hpt.txt') return response(pointer);
      return response('', 404);
    }
  });
  assert.equal(result.ok, true);
  assert.equal(result.acceptedUrl, 'https://fallback.test/.well-known/cms-hpt.txt');
  assert.deepEqual(calls, [
    'https://fallback.test/cms-hpt.txt',
    'https://www.fallback.test/cms-hpt.txt',
    'https://fallback.test/.well-known/cms-hpt.txt'
  ]);

  const blockedCalls = [];
  const blocked = await fetchDomainPointer('blocked.test', {
    timeoutMs: 1000, maxBytes: 1024,
    fetchImpl: async url => { blockedCalls.push(String(url)); return response('', 403); }
  });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.reason, 'blocked');
  assert.equal(blockedCalls.length, 5);
  assert.equal(blockedCalls.every(url => new URL(url).hostname.endsWith('blocked.test')), true);
});

test('root-only domain fetch requests just the canonical cms-hpt.txt location', async () => {
  const calls = [];
  const result = await fetchDomainPointer('single.test', {
    rootOnly: true, timeoutMs: 1000, maxBytes: 1024,
    fetchImpl: async url => {
      calls.push(String(url));
      return response('location-name: Single Hospital\nmrf-url: https://files.test/single.csv\n');
    }
  });
  assert.equal(result.ok, true);
  assert.deepEqual(calls, ['https://single.test/cms-hpt.txt']);
});

test('RFC4180 writer quotes embedded commas, quotes, and newlines', () => {
  const csv = toRFC4180([{ a: 'one,two', b: 'say "yes"\nnext' }], ['a', 'b']);
  assert.equal(csv, 'a,b\r\n"one,two","say ""yes""\nnext"\r\n');
  const parsed = csvToObjects(csv);
  assert.equal(parsed[0].a, 'one,two');
  assert.equal(parsed[0].b, 'say "yes"\nnext');
});

test('external-only catalog loads candidate domains and related CCNs from CSV', async t => {
  const root = await tempRoot(t);
  const candidates = path.join(root, 'external.csv');
  await fsp.writeFile(candidates,
    'ccn,domain\n010001,one.test\n010002,one.test\n020001,two.test\n');
  const catalog = await loadSourceCatalog(root, {
    externalOnly: true, domainCsv: candidates, dataset: 'external-links'
  });
  assert.equal(catalog.urls.size, 0);
  assert.equal(catalog.domains.size, 2);
  assert.deepEqual([...catalog.domains.get('one.test').ccns].sort(), ['010001', '010002']);
  assert.equal(catalog.inputRows['external-links'], 3);
});

test('corpus preserves raw files, links exact CCNs, and resumes deterministically', async t => {
  const root = await tempRoot(t);
  const outputDir = path.join(root, 'cms_data', 'hpt', 'pointer-corpus');
  await fsp.writeFile(path.join(root, 'data', 'hpt-audit', 'manifest.csv'),
    'ccn,domain,pointer_url,mrf_url\n' +
    '111111,current.test,https://current.test/cms-hpt.txt,https://files.test/current-a.csv\n' +
    '111112,current.test,https://alias-current.test/cms-hpt.txt,https://files.test/current-b.csv\n');
  await fsp.writeFile(path.join(root, 'cms_data', 'hpt', 'domains.json'), JSON.stringify({
    'fallback.test': { domain: 'fallback.test', ccns: ['333333'], source: 'open-data' }
  }));

  const bodies = {
    'https://current.test/cms-hpt.txt':
      'location-name: Current Hospital\nsource-page-url: https://current.test/pricing\n' +
      'mrf-url: https://files.test/current-a.csv\nmrf-url: https://files.test/current-b.csv\ncustom: retained\n',
    'https://fallback.test/.well-known/cms-hpt.txt':
      'location-name: Missing URL Hospital\nsource-page-url: https://fallback.test/pricing\ncontact-name: Pat Example\n'
  };
  const calls = [];
  const fetchImpl = async url => {
    calls.push(String(url));
    if (String(url) === 'https://alias-current.test/cms-hpt.txt') {
      return response(bodies['https://current.test/cms-hpt.txt'], 200, 'https://current.test/cms-hpt.txt');
    }
    return Object.hasOwn(bodies, String(url)) ? response(bodies[String(url)]) : response('', 404);
  };

  const catalog = await loadSourceCatalog(root);
  assert.equal(catalog.urls.size, 2);
  assert.equal(catalog.domains.size, 2);

  const first = await runCorpus({ concurrency: 2, timeout: 1000 }, { root, outputDir, fetchImpl, log: () => {} });
  assert.equal(first.summary.pointerDocuments, 2);
  assert.equal(first.summary.csvRows, 3);
  assert.equal(first.summary.uniqueMrfUrls, 2);
  assert.equal(calls.some(url => url.startsWith('https://files.test/')), false);
  assert.deepEqual(first.rows.filter(row => row.pointer_host === 'current.test').map(row => row.mrf_url_index), [1, 2]);

  const csvText = await fsp.readFile(first.csvFile, 'utf8');
  const rows = csvToObjects(csvText);
  assert.equal(rows.find(row => row.mrf_url === 'https://files.test/current-a.csv').matched_ccns, '111111');
  assert.equal(rows.find(row => row.mrf_url === 'https://files.test/current-b.csv').matched_ccns, '111112');
  assert.match(rows.find(row => row.mrf_url === 'https://files.test/current-a.csv').observed_pointer_urls, /alias-current\.test/);
  assert.equal(rows.find(row => row.record_status === 'missing-mrf-url').related_ccns, '333333');
  assert.equal(rows.find(row => row.mrf_url === 'https://files.test/current-b.csv').extra_fields_json, '{"custom":"retained"}');

  for (const row of rows) {
    const raw = await fsp.readFile(path.join(root, row.raw_file));
    assert.equal(crypto.createHash('sha256').update(raw).digest('hex'), row.pointer_sha256);
  }

  const before = await fsp.readFile(first.csvFile, 'utf8');
  const second = await runCorpus({}, {
    root, outputDir,
    fetchImpl: async url => { throw new Error(`unexpected resumed request: ${url}`); },
    log: () => {}
  });
  assert.equal(await fsp.readFile(second.csvFile, 'utf8'), before);
});
