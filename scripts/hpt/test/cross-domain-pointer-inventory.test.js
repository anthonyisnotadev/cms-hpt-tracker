'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../../..');
test('cross-domain inventory is derived from every differing official and standing pointer host',()=>{
  const verification=JSON.parse(fs.readFileSync(path.join(root,'data/hpt-audit/nationwide-verification.json'),'utf8'));
  const inventory=JSON.parse(fs.readFileSync(path.join(root,'data/hpt-audit/cross-domain-pointer-inventory.json'),'utf8'));
  const host=url=>{try{return new URL(url).hostname.toLowerCase().replace(/^www\./,'')}catch{return ''}};
  const expected=verification.records.filter(r=>{const o=String(r.official_domain||'').toLowerCase().replace(/^www\./,'');const p=host(r.standing_pointer_url);return o&&p&&o!==p;});
  assert.equal(inventory.summary.total,expected.length);
  assert.equal(inventory.records.length,expected.length);
  assert.ok(inventory.records.every(r=>['cross-domain-unresolved-review','cross-domain-verified-or-superseded-review'].includes(r.review_class)));
  assert.ok(!inventory.records.some(r=>r.ccn==='040153'));
  assert.ok(!inventory.records.some(r=>r.ccn==='030011'&&r.review_class==='cross-domain-unresolved-review'));
});
