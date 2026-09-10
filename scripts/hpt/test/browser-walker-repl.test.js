'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const filename = require.resolve('../browser-walker-repl');
const source = fs.readFileSync(filename, 'utf8');
const localRequire = createRequire(filename);
const fileBody = JSON.stringify({ hospital_name: 'Example Hospital', hospital_address: ['1 Main St'], last_updated_on: '2026-08-01', version: '3.0.0' });

async function walk(status, body, downloadBody = fileBody) {
  const writes = new Map(), logs = [], visits = [], clicks = [];
  const bytes = Buffer.from(downloadBody);
  const fakeFs = {
    existsSync: p => p.endsWith('/fixture.csv'),
    readFileSync: () => JSON.stringify([{ ccn: '000001', domain: 'example.org', mrf_url: 'https://example.org/old.csv' }]),
    writeFileSync: (p, value) => writes.set(p, JSON.parse(value)),
    appendFileSync: (p, value) => logs.push(JSON.parse(value)),
    readdirSync: () => [],
    statSync: () => ({ size: bytes.length }),
    openSync: () => 1,
    readSync: (fd, buf) => bytes.copy(buf),
    closeSync: () => {}
  };
  const mod = { exports: {} };
  vm.runInNewContext(source, { module: mod, __dirname: require('node:path').dirname(filename), require: name => name === 'node:fs' ? fakeFs : localRequire(name), process, Buffer, setTimeout, clearTimeout }, { filename });
  let currentUrl = '';
  const tab = {
    goto: async url => { currentUrl = url; visits.push(url); },
    url: async () => currentUrl,
    close: async () => {},
    playwright: {
      waitForLoadState: async () => {},
      evaluate: async (fn, arg) => {
        const page = {
          document: { querySelectorAll: () => currentUrl.endsWith('/pricing')
            ? [{ href: 'https://example.org/download.csv', textContent: 'Download' }]
            : [{ href: 'https://example.org/pricing', textContent: 'Price transparency' }] },
          fetch: async url => new Response(url.endsWith('/pricing') ? '<html>Download via the button</html>' : body, { status: url.endsWith('/pricing') ? 200 : status }),
          AbortController, setTimeout, clearTimeout, btoa, arg
        };
        // Browser callbacks cannot see the walker's module variables.
        return vm.runInNewContext('(' + fn.toString() + ')(arg)', page);
      },
      locator: selector => ({ count: async () => 1, click: async () => clicks.push(selector) }),
      waitForEvent: async () => ({ suggestedFilename: async () => 'fixture.csv' })
    }
  };
  const result = await mod.exports.runWalk(1, { tabs: { new: async () => tab } });
  return { result, logs, visits, clicks, observations: [...writes].find(([p]) => p.endsWith('/w4-000001.json'))?.[1], done: [...writes].find(([p]) => p.endsWith('/walk4-done.json'))?.[1] };
}

for (const [label, status, body] of [
  ['403', 403, 'Access denied'],
  ['404', 404, 'Not found'],
  ['HTML challenge', 200, '<html><body>Verify you are human</body></html>'],
  ['empty response', 200, '']
]) {
  test(`${label} preserves evidence and reaches the click-download fallback`, async () => {
    const r = await walk(status, body);
    assert.equal(r.clicks.length, 1);
    assert.equal(r.observations.length, 2);
    assert.equal(r.observations[0].status, status);
    assert.equal(r.observations[1].url, 'https://example.org/download.csv');
    assert.equal(r.result.totalDone, 1);
    assert.equal(r.result.remaining, 0);
    assert.ok(!r.logs.some(l => l.err));
  });
}

test('a usable fetched file completes without unnecessary fallback', async () => {
  const r = await walk(200, fileBody);
  assert.equal(r.clicks.length, 0);
  assert.equal(r.result.totalDone, 1);
});

test('an unsuccessful walk remains eligible for retry', async () => {
  const r = await walk(403, 'Access denied', '<html>No file</html>');
  assert.equal(r.result.totalDone, 0);
  assert.equal(r.result.remaining, 1);
  assert.deepEqual(r.done, []);
});
