'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const { parsePointer } = require('../lib/parse');
const { classify, looksLikePointer } = require('../lib/fetch');
const { csvToObjects } = require('../lib/util');
const {
  fetchKnownPointer, fetchDomainPointer, loadSourceCatalog, runCorpus, toRFC4180,
  applyReviewedLinkCorrections, applyReviewedPrimeLinks, applyReviewedUvmSharedPointerAttribution,
  applyReviewedStamfordPointerAttribution, rebindCurrentCatalogLinks
} = require('../pointer-corpus');

test('Stamford pointer attribution binds only the exact retained pointer row', () => {
  const proof = JSON.parse(fs.readFileSync(path.resolve(__dirname,
    '../../../data/hpt-audit/reconciliation-stamford-pointer-attribution-proof.json'), 'utf8'));
  const rows = [{ record_status: 'ok', pointer_url: proof.pointer_url, pointer_sha256: proof.pointer_sha256,
    location_name: proof.pointer_location_name, source_page_url: proof.source_page_url, mrf_url: proof.mrf_url, matched_ccns: '' },
  { record_status: 'ok', pointer_url: proof.pointer_url, pointer_sha256: proof.pointer_sha256,
    location_name: 'Other Hospital', source_page_url: proof.source_page_url, mrf_url: 'https://example.test/other.csv', matched_ccns: '' }];
  const reviewed = applyReviewedStamfordPointerAttribution(rows, proof);
  assert.equal(reviewed[0].matched_ccns, '070006');
  assert.equal(reviewed[1].matched_ccns, '');
  assert.equal(rows[0].matched_ccns, '');
  assert.throws(() => applyReviewedStamfordPointerAttribution(rows, { ...proof, mrf_url: 'https://example.test/other.csv' }));
});

test('UVM shared root assigns Alice and Champlain only to their own files', () => {
  const proof = JSON.parse(fs.readFileSync(path.resolve(__dirname,
    '../../../data/hpt-audit/reconciliation-uvm-shared-pointer-attribution-proof.json'), 'utf8'));
  const files = [proof.alice.mrf_url, 'https://uvmhealth.org/central.csv', proof.champlain.mrf_url,
    'https://uvmhealth.org/elizabethtown.csv', 'https://uvmhealth.org/porter.csv',
    'https://uvmhealth.org/uvm.csv'];
  const rows = files.map(mrf_url => ({ record_status: 'ok', pointer_url: proof.pointer_url,
    pointer_sha256: proof.pointer_sha256, mrf_url, matched_ccns: '330250|470001' }));
  const reviewed = applyReviewedUvmSharedPointerAttribution(rows, proof);
  assert.equal(reviewed.find(row => row.mrf_url === proof.alice.mrf_url).matched_ccns, '331321|470001');
  assert.equal(reviewed.find(row => row.mrf_url === proof.champlain.mrf_url).matched_ccns, '330250|470001');
  assert.ok(reviewed.filter(row => row.mrf_url !== proof.champlain.mrf_url)
    .every(row => !row.matched_ccns.split('|').includes('330250')));
  assert.equal(rows[0].matched_ccns, '330250|470001');
  assert.throws(() => applyReviewedUvmSharedPointerAttribution(rows, { ...proof, pointer_sha256: 'a'.repeat(64) }));
  const centerProof = JSON.parse(fs.readFileSync(path.resolve(__dirname,
    '../../../data/hpt-audit/reconciliation-uvm-medical-center-alias-proof.json'), 'utf8'));
  const centerRows = files.map((mrf_url, index) => ({ record_status: 'ok', pointer_url: proof.pointer_url,
    pointer_sha256: proof.pointer_sha256,
    mrf_url: index === 5 ? centerProof.mrf_url : mrf_url, matched_ccns: '330250|470003' }));
  const centerReviewed = applyReviewedUvmSharedPointerAttribution(centerRows, proof, centerProof);
  assert.equal(centerReviewed.find(row => row.mrf_url === centerProof.mrf_url).matched_ccns, '470003');
  assert.ok(centerReviewed.filter(row => row.mrf_url !== centerProof.mrf_url)
    .every(row => !row.matched_ccns.split('|').includes('470003')));
  assert.throws(() => applyReviewedUvmSharedPointerAttribution(centerRows, proof,
    { ...centerProof, declared_hospital_name: 'Other Hospital' }));
});

test('reviewed Prime link requires exact pointer bytes and leaves Lake Huron excluded', () => {
  const link = { ccn: '050739', pointer_url: 'https://centinelamed.com/cms-hpt.txt',
    pointer_sha256: 'a'.repeat(64), mrf_url: 'https://centinelamed.com/september.json' };
  const rows = [{ record_status: 'ok', pointer_url: link.pointer_url, pointer_sha256: link.pointer_sha256,
    mrf_url: link.mrf_url, matched_ccns: '' }];
  const reviewed = applyReviewedPrimeLinks(rows, { excluded_ccn: '230031', records: [link] });
  assert.equal(reviewed[0].matched_ccns, '050739');
  assert.equal(rows[0].matched_ccns, '');
  assert.throws(() => applyReviewedPrimeLinks(rows, { excluded_ccn: '', records: [link] }));
  assert.throws(() => applyReviewedPrimeLinks(rows, { excluded_ccn: '230031', records: [
    { ...link, ccn: '230031' }
  ] }));
  assert.throws(() => applyReviewedPrimeLinks(rows, { excluded_ccn: '230031', records: [
    { ...link, pointer_sha256: 'b'.repeat(64) }
  ] }));
});

test('cached pointer replay rebinds a reviewed exact file link from current catalog', () => {
  const root = 'https://hospital.example/cms-hpt.txt';
  const file = 'https://hospital.example/september.json';
  const info = { datasets: new Set(), domains: new Set(), ccns: new Set(),
    links: new Map(), observedUrls: new Set([root]) };
  const doc = { acceptedUrl: root, finalUrl: root, info };
  const current = { ...info, links: new Map([[file, new Set(['050739'])]]) };
  rebindCurrentCatalogLinks(new Map([[root, doc]]), {
    urls: new Map([[root, current]]), domains: new Map()
  });
  assert.deepEqual([...doc.info.links.get(file)], ['050739']);
});

test('reviewed different-campus correction repairs links without rewriting historical pointer hashes', () => {
  const wrongUrl = 'https://other.example/wrong.json';
  const rightUrl = 'https://hospital.example/right.json';
  const hash = 'a'.repeat(64);
  const rows = [
    { record_status: 'ok', pointer_sha256: 'b'.repeat(64), mrf_url: wrongUrl, matched_ccns: '050191|050300' },
    { record_status: 'ok', pointer_sha256: hash, mrf_url: rightUrl, matched_ccns: '050300' }
  ];
  const resolution = { ccn: '050191', action: 'replace', base: { mrf_url: wrongUrl }, evidence: {
    corpusLinkCorrection: 'different-campus', pointerSha256: hash, url: rightUrl
  } };
  const result = applyReviewedLinkCorrections(rows, [resolution]);
  assert.equal(result[0].matched_ccns, '050300');
  assert.equal(result[1].matched_ccns, '050191|050300');
  assert.equal(result[0].pointer_sha256, rows[0].pointer_sha256);
  assert.equal(rows[0].matched_ccns, '050191|050300');
});

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

test('HTML with embedded pointer labels is a page, not a pointer', () => {
  const html = '<!DOCTYPE html><html><head><meta name="description" content="mrf-url: https://hospital.test/rates.csv"></head></html>';
  assert.equal(looksLikePointer(html), false);
  assert.equal(classify(200, html), 'html');
  assert.equal(classify(200, 'location-name: Hospital\nmrf-url: https://hospital.test/rates.csv\n'), 'ok');
});

test('reindex invalidates a previously accepted HTML snapshot without losing its bytes', async t => {
  const root = await tempRoot(t);
  const outputDir = path.join(root, 'cms_data', 'hpt', 'pointer-corpus');
  const rawDir = path.join(outputDir, 'raw');
  await fsp.mkdir(rawDir, { recursive: true });
  const url = 'https://hospital.test/cms-hpt.txt';
  const body = '<!DOCTYPE html><html><head><meta content="mrf-url: https://hospital.test/rates.csv"></head></html>';
  const hash = crypto.createHash('sha256').update(body).digest('hex');
  const rawFile = path.relative(root, path.join(rawDir, 'hospital.txt'));
  await fsp.writeFile(path.join(root, rawFile), body);
  await fsp.writeFile(path.join(outputDir, 'crawl-state.json'), JSON.stringify({ schemaVersion: 1, targets: {
    [`url:${url}`]: { kind: 'url', input: url, status: 'ok', acceptedUrl: url, finalUrl: url,
      rawFile, sha256: hash, bytes: Buffer.byteLength(body), fetchedAt: '2026-01-01T00:00:00Z',
      exactMrfLinks: { 'https://hospital.test/rates.csv': ['111111'] }, history: [] }
  } }));
  const result = await runCorpus({ 'reindex-only': true }, { root, outputDir,
    fetchImpl: async () => { throw new Error('must not fetch'); }, log: () => {} });
  assert.equal(result.rows.length, 0);
  const invalid = result.state.targets[`url:${url}`];
  assert.equal(invalid.status, 'invalid');
  assert.equal(invalid.reason, 'html-body-not-pointer');
  assert.equal(invalid.invalidatedSnapshot.sha256, hash);
  assert.equal(await fsp.readFile(path.join(root, rawFile), 'utf8'), body);
  assert.equal(invalid.lastSuccessful, undefined);
});

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

test('pointer parser separates collapsed adjacent fields from an MRF URL', () => {
  const parsed = parsePointer('location-name: Corewell Health Pennock\n' +
    'mrf-url: https://assets.example.test/pennock_standardcharges.csv     contact-name: HPT Team');
  assert.equal(parsed.entries[0].mrfUrl, 'https://assets.example.test/pennock_standardcharges.csv');
  assert.equal(parsed.entries[0].contactName, 'HPT Team');
});

test('pointer parser accepts CR-only publisher line endings without merging fields', () => {
  const body = 'location-name: Montefiore New Rochelle\r'
    + 'source-page-url: https://example.test/pricing\r'
    + 'mrf-url: https://example.test/new-rochelle.csv\r'
    + 'contact-name: Redacted\r';
  const parsed = parsePointer(body);
  assert.equal(parsed.entries.length, 1);
  assert.equal(parsed.entries[0].locationName, 'Montefiore New Rochelle');
  assert.equal(parsed.entries[0].sourcePageUrl, 'https://example.test/pricing');
  assert.equal(parsed.entries[0].mrfUrl, 'https://example.test/new-rochelle.csv');
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

test('changed pointer bytes keep distinct raw snapshots and a corrupt cache is refetched', async t => {
  const root = await tempRoot(t);
  const outputDir = path.join(root, 'cms_data', 'hpt', 'pointer-corpus');
  const url = 'https://changing.test/cms-hpt.txt';
  await fsp.writeFile(path.join(root, 'data', 'hpt-audit', 'manifest.csv'),
    `ccn,domain,pointer_url,mrf_url\n111111,changing.test,${url},\n`);
  const a = 'location-name: First Hospital\nsource-page-url: https://changing.test/pricing\nmrf-url: https://changing.test/a.csv\n';
  const b = 'location-name: Second Hospital\nsource-page-url: https://changing.test/pricing\nmrf-url: https://changing.test/b.csv\n';
  const first = await runCorpus({ concurrency: 1 }, { root, outputDir,
    fetchImpl: async () => response(a), log: () => {} });
  const firstRow = first.rows[0];
  const firstRaw = path.join(root, firstRow.raw_file);
  assert.equal(await fsp.readFile(firstRaw, 'utf8'), a);

  const second = await runCorpus({ refresh: true, concurrency: 1 }, { root, outputDir,
    fetchImpl: async () => response(b), log: () => {} });
  const secondRaw = path.join(root, second.rows[0].raw_file);
  assert.notEqual(secondRaw, firstRaw);
  assert.equal(await fsp.readFile(firstRaw, 'utf8'), a);
  assert.equal(await fsp.readFile(secondRaw, 'utf8'), b);

  await fsp.writeFile(secondRaw, a);
  let refetches = 0;
  const third = await runCorpus({ concurrency: 1 }, { root, outputDir,
    fetchImpl: async () => { refetches++; return response(b); }, log: () => {} });
  assert.ok(refetches > 0);
  assert.equal(third.rows[0].pointer_sha256, crypto.createHash('sha256').update(b).digest('hex'));
});

test('targeted refresh fetches only catalog-listed pointer URLs and preserves older bytes', async t => {
  const root = await tempRoot(t);
  const outputDir = path.join(root, 'cms_data', 'hpt', 'pointer-corpus');
  const target = 'https://target.test/cms-hpt.txt';
  const other = 'https://other.test/cms-hpt.txt';
  await fsp.writeFile(path.join(root, 'data', 'hpt-audit', 'manifest.csv'),
    `ccn,domain,pointer_url,mrf_url\n111111,target.test,${target},\n222222,other.test,${other},\n`);
  const old = 'location-name: Target\nmrf-url: https://files.test/old.csv\n';
  const newer = 'location-name: Target\nmrf-url: https://files.test/new.csv\n';
  const otherBody = 'location-name: Other\nmrf-url: https://files.test/other.csv\n';
  const first = await runCorpus({}, { root, outputDir,
    fetchImpl: async url => response(String(url) === target ? old : otherBody), log: () => {} });
  const oldRaw = path.join(root, first.rows.find(row => row.pointer_url === target).raw_file);
  const stateFile = path.join(outputDir, 'crawl-state.json');
  const state = JSON.parse(await fsp.readFile(stateFile, 'utf8'));
  state.targets['domain:target.test'] = { ...state.targets[`url:${target}`],
    kind: 'domain', input: 'target.test', via: 'cache-current' };
  await fsp.writeFile(stateFile, JSON.stringify(state));
  const calls = [];
  const second = await runCorpus({ 'refresh-url': target }, { root, outputDir,
    fetchImpl: async url => { calls.push(String(url)); return response(newer, 200,
      'https://target.test/new-pointer.txt'); }, log: () => {} });
  assert.deepEqual(calls, [target]);
  assert.equal(await fsp.readFile(oldRaw, 'utf8'), old);
  assert.equal(second.state.targets['domain:target.test'].status, 'superseded');
  assert.equal(second.state.targets['domain:target.test'].lastSuccessful.sha256,
    crypto.createHash('sha256').update(old).digest('hex'));
  assert.ok(second.rows.some(row => row.mrf_url === 'https://files.test/new.csv'));
  assert.ok(!second.rows.some(row => row.mrf_url === 'https://files.test/old.csv'));
  assert.ok(second.rows.some(row => row.mrf_url === 'https://files.test/other.csv'));
  await assert.rejects(runCorpus({ 'refresh-url': 'https://not-cataloged.test/cms-hpt.txt' },
    { root, outputDir, fetchImpl: async () => { throw new Error('must not fetch'); }, log: () => {} }));
});

test('failed refresh keeps the old pointer only as a versioned last success', async t => {
  const root = await tempRoot(t);
  const outputDir = path.join(root, 'cms_data', 'hpt', 'pointer-corpus');
  const url = 'https://retry.test/cms-hpt.txt';
  await fsp.writeFile(path.join(root, 'data', 'hpt-audit', 'manifest.csv'),
    `ccn,domain,pointer_url,mrf_url\n111111,retry.test,${url},https://retry.test/rates.csv\n`);
  const body = 'location-name: Retry Hospital\nmrf-url: https://retry.test/rates.csv\n';
  const first = await runCorpus({ concurrency: 1 }, { root, outputDir,
    fetchImpl: async () => response(body), log: () => {} });
  const firstTarget = first.state.targets[`url:${url}`];
  const second = await runCorpus({ refresh: true, concurrency: 1 }, { root, outputDir,
    fetchImpl: async () => response('', 403), log: () => {} });
  assert.equal(second.rows.length, 0, 'failed refresh must not emit the earlier capture as a current corpus row');
  const state = JSON.parse(await fsp.readFile(path.join(outputDir, 'crawl-state.json'), 'utf8'));
  const failed = state.targets[`url:${url}`];
  assert.equal(failed.status, 'failed');
  assert.equal(failed.reason, 'blocked');
  for (const field of ['rawFile', 'sha256', 'bytes', 'exactMrfLinks', 'acceptedUrl', 'finalUrl'])
    assert.equal(failed[field], undefined);
  assert.equal(failed.lastSuccessful.sha256, firstTarget.sha256);
  assert.equal(failed.lastSuccessful.fetchedAt, firstTarget.fetchedAt);
  assert.equal(await fsp.readFile(path.join(root, failed.lastSuccessful.rawFile), 'utf8'), body);
  await runCorpus({ retryFailed: true, concurrency: 1 }, { root, outputDir,
    fetchImpl: async () => response('', 403), log: () => {} });
  const retried = JSON.parse(await fsp.readFile(path.join(outputDir, 'crawl-state.json'), 'utf8'))
    .targets[`url:${url}`];
  assert.equal(retried.sha256, undefined);
  assert.deepEqual(retried.lastSuccessful, failed.lastSuccessful);
  assert.ok(retried.history.length > failed.history.length);
});

test('shared redirect keeps a successful alias without borrowing failed sibling links', async t => {
  const root = await tempRoot(t);
  const outputDir = path.join(root, 'cms_data', 'hpt', 'pointer-corpus');
  const alias = 'https://alias.test/cms-hpt.txt';
  const sibling = 'https://sibling.test/cms-hpt.txt';
  const finalUrl = 'https://shared.test/cms-hpt.txt';
  await fsp.writeFile(path.join(root, 'data', 'hpt-audit', 'manifest.csv'),
    'ccn,domain,pointer_url,mrf_url\n' +
    `111111,alias.test,${alias},https://shared.test/a.csv\n` +
    `222222,sibling.test,${sibling},https://shared.test/b.csv\n`);
  const body = 'location-name: Shared Hospital\nmrf-url: https://shared.test/a.csv\n' +
    'location-name: Other Hospital\nmrf-url: https://shared.test/b.csv\n';
  const fetchImpl = async url => response(body, 200, finalUrl);
  await runCorpus({ concurrency: 1 }, { root, outputDir, fetchImpl, log: () => {} });
  const second = await runCorpus({ refresh: true, concurrency: 1 }, { root, outputDir,
    fetchImpl: async url => String(url) === alias ? response(body, 200, finalUrl) : response('', 403),
    log: () => {} });
  assert.equal(second.summary.pointerDocuments, 1);
  assert.equal(second.state.targets[`url:${alias}`].status, 'ok');
  assert.equal(second.state.targets[`url:${sibling}`].status, 'failed');
  assert.equal(second.rows.find(row => row.mrf_url === 'https://shared.test/a.csv').matched_ccns, '111111');
  assert.equal(second.rows.find(row => row.mrf_url === 'https://shared.test/b.csv').matched_ccns, '');
});
