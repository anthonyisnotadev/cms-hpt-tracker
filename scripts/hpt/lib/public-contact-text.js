'use strict';
const { encryptValue, decryptValue } = require('./pointer-obfuscation');
// Never inspect ciphertext as plain text: random encoded bytes can resemble
// a phone number or email fragment, and encrypting those corrupts the token.
const TOKEN = /hpt-obf:v1:[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;
const EMAIL = /[A-Za-z0-9._%+*-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const PHONE = /(?<![\w])(?:\+1[ .-]?)?\(?[2-9]\d{2}\)?[ .\u2010-\u2015-]+[2-9]\d{2}[ .\u2010-\u2015-]+\d{4}(?:\s*(?:ext\.?|x)\s*\d{1,6})?(?!\d)/gi;
function mapPlain(text, fn) {
  let out = '', offset = 0;
  for (const match of String(text).matchAll(TOKEN)) {
    out += fn(String(text).slice(offset, match.index)) + match[0];
    offset = match.index + match[0].length;
  }
  return out + fn(String(text).slice(offset));
}
function protectContacts(text, key) {
  let out = String(text).replace(/(^\s*(?:< )?contact(?:[-_ ]?(?:name|email|phone|telephone|fax))?\s*:\s*)([^\r\n]+)/gmi,
    (_, prefix, value) => prefix + encryptValue(value.trim(), key));
  out = mapPlain(out, s => s.replace(EMAIL, value => encryptValue(value, key)));
  out = mapPlain(out, s => s.replace(PHONE, value => encryptValue(value, key)));
  // Compact phone numbers in explicit tel: links are also contacts, not NPIs.
  return mapPlain(out, s => s.replace(/(tel:)(\+?\d{10,15})(?!\d)/gi, (_, prefix, value) => prefix + encryptValue(value, key)));
}
function contactCount(text) {
  let count = 0;
  mapPlain(text, s => { count += [...s.matchAll(EMAIL)].length + [...s.matchAll(PHONE)].length + [...s.matchAll(/tel:\+?\d{10,15}(?!\d)/gi)].length; return s; });
  return count;
}
function revealContacts(text, key) {
  return String(text).replace(TOKEN, token => decryptValue(token, key));
}
module.exports = { protectContacts, contactCount, revealContacts };
