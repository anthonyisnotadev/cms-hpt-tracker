'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');

const { csvToObjects } = require('../lib/util');
const { toRFC4180 } = require('../pointer-corpus');
const { groupCorpusRows, runHeaderCorpus } = require('../probe-pointer-corpus');

async function tempRoot(t) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'hpt-header-corpus-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  await fsp.mkdir(path.join(root, 'cms_data', 'hpt'), { recursive: true });
  return root;
}

test('groupCorpusRows deduplicates MRF URLs and preserves pointer provenance', () => {
  const tasks = groupCorpusRows([
    {
      mrf_url: 'HTTPS://files.test/a.csv#fragment', source_domains: 'one.test',
      final_url: 'https://one.test/cms-hpt.txt', pointer_sha256: 'aaa', raw_file: 'raw/one.txt',
      source_datasets: 'external-links', related_ccns: '010001', matched_ccns: '010001',
      location_name: 'One Hospital', source_page_url: 'https://one.test/prices'
    },
    {
      mrf_url: 'https://files.test/a.csv', source_domains: 'two.test',
      final_url: 'https://two.test/cms-hpt.txt', pointer_sha256: 'bbb', raw_file: 'raw/two.txt',
      source_datasets: 'external-links', related_ccns: '020001', matched_ccns: '',
      location_name: 'Two Hospital', source_page_url: 'https://two.test/prices'
    }
  ]);
  assert.equal(tasks.length, 1);
  assert.deepEqual([...tasks[0].pointerDomains].sort(), ['one.test', 'two.test']);
  assert.deepEqual([...tasks[0].pointerSha256s].sort(), ['aaa', 'bbb']);
  assert.deepEqual([...tasks[0].relatedCcns].sort(), ['010001', '020001']);
  assert.equal(tasks[0].refs.length, 2);
});

test('runHeaderCorpus probes each unique MRF once and exports conservative match fields', async t => {
  const root = await tempRoot(t);
  const input = path.join(root, 'cms_data', 'hpt', 'entries.csv');
  const output = path.join(root, 'cms_data', 'hpt', 'headers.csv');
  const cache = path.join(root, 'cms_data', 'hpt', 'cache.json');
  const roster = path.join(root, 'cms_data', 'hpt', 'roster.json');
  await fsp.writeFile(input, toRFC4180([
    {
      record_status: 'mrf-url', pointer_url: 'https://one.test/cms-hpt.txt', final_url: 'https://one.test/cms-hpt.txt',
      pointer_host: 'one.test', pointer_sha256: 'aaa', raw_file: 'raw/one.txt', source_datasets: 'external-links',
      source_domains: 'one.test', location_name: 'One Hospital', source_page_url: 'https://one.test/prices',
      mrf_url: 'https://files.test/a.csv', matched_ccns: '', related_ccns: '010001'
    },
    {
      record_status: 'mrf-url', pointer_url: 'https://two.test/cms-hpt.txt', final_url: 'https://two.test/cms-hpt.txt',
      pointer_host: 'two.test', pointer_sha256: 'bbb', raw_file: 'raw/two.txt', source_datasets: 'external-links',
      source_domains: 'two.test', location_name: 'One Hospital', source_page_url: '',
      mrf_url: 'https://files.test/a.csv#ignored', matched_ccns: '', related_ccns: '010001'
    }
  ]));
  await fsp.writeFile(roster, JSON.stringify([
    { ccn: '010001', name: 'ONE HOSPITAL', address: '10 MAIN ST', city: 'DOTHAN', state: 'AL', zip: '36301' }
  ]));
  let calls = 0;
  const probeImpl = async url => {
    calls++;
    return {
      url, checkedAt: '2026-09-02T00:00:00.000Z', httpStatus: 200, rangeStatus: 206,
      fileKind: 'csv', contentType: 'text/csv', bytes: 1000, mrfLicenseState: 'AL',
      mrfHospitalName: 'One Hospital', mrfLocationName: 'One Hospital',
      mrfAddress: '10 Main St, Dothan, AL 36301', declaredRaw: '2026-09-01',
      declaredLastUpdated: '2026-09-01', dateSource: 'declared', cmsVersion: '3.0.0'
    };
  };
  const result = await runHeaderCorpus({ input, out: output, cache, roster, concurrency: 2 }, {
    root, probeImpl, now: new Date('2026-09-02T12:00:00Z'), log: () => {}
  });
  assert.equal(calls, 1);
  assert.equal(result.summary.uniqueMrfUrls, 1);
  const rows = csvToObjects(await fsp.readFile(output, 'utf8'));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].header_status, 'matched');
  assert.equal(rows[0].header_matched_ccns, '010001');
  assert.equal(rows[0].mrf_days_since_update, '1');
  assert.equal(rows[0].mrf_stale_over_365, 'false');
  assert.match(rows[0].pointer_domains, /one\.test/);
  assert.match(rows[0].pointer_domains, /two\.test/);

  await runHeaderCorpus({ input, out: output, cache, roster, concurrency: 2 }, {
    root,
    probeImpl: async () => { throw new Error('cache should avoid a second probe'); },
    now: new Date('2026-09-02T12:00:00Z'), log: () => {}
  });
});
