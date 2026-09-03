'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

const {
  PREFIX,
  obfuscatePointerText,
  deobfuscatePointerText,
  inspectPointerText
} = require('../lib/pointer-obfuscation');

test('pointer contact obfuscation is exact, authenticated, and idempotent for text pointers', () => {
  const key = crypto.randomBytes(32);
  const source = '# retained\r\nlocation-name: Example Hospital\r\n' +
    'contact-name: Pat Example  \r\ncontact: Alex Example\r\n' +
    'contact email: pat@example.test\r\n' +
    'mrf-url: https://example.test/mrf.csv\r\n';
  const protectedDoc = obfuscatePointerText(source, key);
  assert.equal(protectedDoc.fields, 3);
  assert.equal(protectedDoc.changed, 3);
  assert.match(protectedDoc.text, new RegExp(PREFIX));
  assert.doesNotMatch(protectedDoc.text, /Pat Example|Alex Example|pat@example\.test/);
  assert.equal(deobfuscatePointerText(protectedDoc.text, key).text, source);
  assert.equal(obfuscatePointerText(protectedDoc.text, key).text, protectedDoc.text);
  assert.deepEqual(inspectPointerText(protectedDoc.text), {
    fields: 3, protected: 3, plaintext: 0, format: 'txt'
  });
});

test('pointer contact obfuscation supports JSON aliases without changing non-contact data', () => {
  const key = crypto.randomBytes(32);
  const source = JSON.stringify({ locations: [{
    location_name: 'Example Hospital',
    contact_name: ['Pat Example', 'Alex Example'],
    contact_email: 'billing@example.test',
    mrf_url: 'https://example.test/mrf.csv'
  }] }) + '\n';
  const protectedDoc = obfuscatePointerText(source, key);
  assert.equal(protectedDoc.fields, 3);
  assert.doesNotMatch(protectedDoc.text, /Pat Example|Alex Example|billing@example\.test/);
  assert.deepEqual(
    JSON.parse(deobfuscatePointerText(protectedDoc.text, key).text),
    JSON.parse(source)
  );
  assert.equal(JSON.parse(protectedDoc.text).locations[0].location_name, 'Example Hospital');
});

test('pointer contact obfuscation refuses the wrong key', () => {
  const source = 'contact-email: pat@example.test\n';
  const protectedDoc = obfuscatePointerText(source, crypto.randomBytes(32)).text;
  assert.throws(() => deobfuscatePointerText(protectedDoc, crypto.randomBytes(32)), /key is missing or incorrect/);
});
