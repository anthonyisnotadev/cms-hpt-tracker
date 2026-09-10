'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');

const { loadKey, decryptValue } = require('../lib/pointer-obfuscation');
const {
  sanitizeBodyText, renderableHeaders, renderTranscript, urlsForRow
} = require('../curl-evidence');

// A throwaway key keeps the real repo key out of the test fixtures. Production
// callers omit keyFile and hit the tracked key; the code path is identical.
function makeKeyDir() {
  return fsp.mkdtemp(path.join(os.tmpdir(), 'hpt-curl-')).then(async dir => {
    const keyFile = path.join(dir, 'key');
    const key = loadKey({ keyFile, create: true });
    return { dir, keyFile, key };
  });
}

test('sanitizeBodyText encrypts contact fields, wrapped contacts, and bare emails', async () => {
  const { keyFile, key } = await makeKeyDir();
  const source = [
    'location-name: Example General',
    'contact-name: Pat Example',
    'contact-email: pat@example.test',
    '<p>contact-name: Robin Example</p>',
    'send to info@example.org or mailto:billing@example.net',
    'no contacts in this line'
  ].join('\n');
  const out = sanitizeBodyText(source, { keyFile });
  assert.doesNotMatch(out, /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
  assert.doesNotMatch(out, /Pat Example|Robin Example/);
  assert.match(out, /location-name: Example General/);
  const tokens = out.match(/hpt-obf:v1:[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g);
  assert.ok(tokens.length >= 5, 'every contact and email form is tokenized');
  assert.equal(decryptValue(tokens[0], key), 'Pat Example');
});

test('sanitizeBodyText leaves already-protected values untouched', async () => {
  const { keyFile, key } = await makeKeyDir();
  const once = sanitizeBodyText('contact-email: pat@example.test', { keyFile });
  const twice = sanitizeBodyText(once, { keyFile });
  assert.equal(once, twice);
  assert.equal(decryptValue(once.match(/hpt-obf:v1:[\w.-]+/)[0], key), 'pat@example.test');
});

test('renderTranscript strips set-cookie, keeps evidence headers, and sanitizes bodies', async () => {
  const { keyFile } = await makeKeyDir();
  const evidence = {
    url: 'https://example.test/cms-hpt.txt',
    dns: ['192.0.2.10'],
    hops: [{ url: 'https://example.test/', status: 301, headers: { location: '/cms-hpt.txt', 'set-cookie': '__cf_bm=secret; Path=/' }, location: '/cms-hpt.txt' }],
    final: {
      url: 'https://example.test/cms-hpt.txt', status: 403,
      headers: { server: 'cloudflare', 'cf-ray': 'abc123', 'set-cookie': 'session=token' },
      body: { text: 'contact-email: pat@example.test\nblocked', read: 100, truncated: false }
    },
    fallback: null, error: null, ms: 120
  };
  const text = renderTranscript(evidence, [{ ccn: '1', name: 'Example', state: 'TX', finding: 'pointer-blocked-to-automation' }], { keyFile });
  assert.doesNotMatch(text, /set-cookie|__cf_bm|session=token/i);
  assert.match(text, /< server: cloudflare/);
  assert.match(text, /< cf-ray: abc123/);
  assert.match(text, /< HTTP 403/);
  assert.doesNotMatch(text, /pat@example\.test/);
  assert.match(text, /# record: 1 \| Example \| TX \| finding: pointer-blocked-to-automation/);
});

test('renderableHeaders drops cookie material only', () => {
  const out = renderableHeaders({ 'content-type': 'text/plain', 'set-cookie': 'a=b', 'Set-Cookie2': 'c=d', server: 'Apache' });
  assert.deepEqual(out, { 'content-type': 'text/plain', server: 'Apache' });
});

test('urlsForRow targets the URL that shows each finding', () => {
  const domain = 'example.test';
  assert.deepEqual(
    urlsForRow({ finding: 'mrf-url-unreachable', domain, mrf_url: 'https://cdn.example/mrf.json' }),
    ['https://cdn.example/mrf.json']);
  assert.deepEqual(
    urlsForRow({ finding: 'pointer-blocked-to-automation', domain }),
    [`https://${domain}/cms-hpt.txt`, `https://${domain}/`]);
  assert.deepEqual(
    urlsForRow({ finding: 'not-assessed-domain-unknown', domain: '' }), []);
});
