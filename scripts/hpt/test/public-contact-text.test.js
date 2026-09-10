'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { protectContacts, revealContacts, contactCount } = require('../lib/public-contact-text');
const { protectDocument } = require('../../protect-public-contacts');
const { csvToObjects } = require('../lib/util');
const key = crypto.randomBytes(32);

test('free-text contacts round-trip, including masked emails, phones and tel links', () => {
  const source = 'Call (212) 555-0123 ext. 12 or +1 202-555-0144; a***@example.test; tel:+12125550123. NPI 1234567890; CCN 010079; 2026-09-09';
  const stored = protectContacts(source, key);
  assert.equal(contactCount(stored), 0);
  assert.equal(revealContacts(stored, key), source);
  assert.equal(protectContacts(stored, key), stored);
  assert.match(stored, /NPI 1234567890; CCN 010079; 2026-09-09/);
});

test('contact fields in CSV and nested JSON are protected without changing hospital identity', () => {
  const csv = 'name,contact_name,phone,notes\n"Example, Hospital",Pat Example,2125550123,"Email pat@example.test\nfor details"\n';
  const stored = protectDocument(csv, '.csv', key);
  const rows = csvToObjects(stored);
  assert.equal(rows[0].name, 'Example, Hospital');
  for (const field of ['contact_name', 'phone', 'notes']) assert.equal(revealContacts(rows[0][field], key), csvToObjects(csv)[0][field]);
  assert.doesNotMatch(stored, /Pat Example|2125550123|pat@example.test/);
  assert.equal(protectDocument(stored, '.csv', key), stored);
  const json = JSON.stringify({ name: 'Example Hospital', contact: { name: 'Pat Example', email: 'pat@example.test' }, phone: '2125550123' });
  const protectedJson = protectDocument(json, '.json', key);
  assert.doesNotMatch(protectedJson, /Pat Example|2125550123|pat@example.test/);
  assert.deepEqual(JSON.parse(protectedJson, (_k, v) => typeof v === 'string' ? revealContacts(v, key) : v), JSON.parse(json));
});

test('transcript contact names are encrypted and existing ciphertext stays intact', () => {
  const stored = protectContacts('< contact-name: Pat Example\n< location-name: Example Hospital', key);
  assert.doesNotMatch(stored, /Pat Example/);
  assert.match(stored, /location-name: Example Hospital/);
  assert.equal(protectContacts(stored, key), stored);
});

test('discovery compares protected hospital phone numbers using the local key', () => {
  const { loadKey, encryptValue } = require('../lib/pointer-obfuscation');
  const { normalizePhone } = require('../lib/domain-discovery');
  assert.equal(normalizePhone(encryptValue('(212) 555-0123', loadKey())), '2125550123');
});

test('transcript publishing fails closed without its encryption key', () => {
  const { sanitizeBodyText } = require('../curl-evidence');
  assert.throws(() => sanitizeBodyText('Call (212) 555-0123', { keyFile: require('node:path').join(__dirname, 'missing-key') }), /ENOENT/);
});

test('outreach regeneration protects free text and reuses unchanged ciphertext', t => {
  const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
  const { generate } = require('../../outreach-redact');
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'hpt-public-contact-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const src = path.join(folder, 'private.json'), dst = path.join(folder, 'public.json');
  fs.writeFileSync(src, JSON.stringify({ '010000': { entries: [{ text: 'Call 212-555-0123 or pat@example.test' }] } }));
  generate(src, dst);
  const once = fs.readFileSync(dst, 'utf8');
  assert.equal(contactCount(once), 0);
  generate(src, dst);
  assert.equal(fs.readFileSync(dst, 'utf8'), once);
});
