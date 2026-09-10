'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('zlib');
const { safeUrl, decode, retrieve, parsePayload, progressiveProbe } = require('../lib/recovery-transport');
const json = JSON.stringify({ hospital_name: 'Test Hospital', hospital_address: ['10 Main St Test AL 12345'], license_information: { state: 'AL' }, last_updated_on: '2026-09-01', version: '3.0.0' });
test('URL normalization preserves signed query and encodes path', () => {
  assert.equal(safeUrl('https://example.org/file name.csv?sig=a%2Fb+z&x=%20'), 'https://example.org/file%20name.csv?sig=a%2Fb+z&x=%20');
  assert.throws(() => safeUrl('file:///secret'));
});
test('UTF16 metadata and late root properties are decoded', async () => {
  const b = Buffer.concat([Buffer.from([255,254]), Buffer.from(json,'utf16le')]);
  assert.equal(decode(b),json);
  const p = await parsePayload(b, 'application/json'); assert.equal(p.parsed[0].mrfLicenseState,'AL');
  const late = await parsePayload(Buffer.from('{"standard_charge_information":['+' '.repeat(300000)+'], '+json.slice(1)));
  assert.equal(late.parsed[0].declaredLastUpdated, '2026-09-01');
});
test('ZIP skips readme and inspects a later charge member', async () => {
  function member(name, body) { const n=Buffer.from(name), b=Buffer.from(body), h=Buffer.alloc(30);h.writeUInt32LE(0x04034b50);h.writeUInt32LE(b.length,18);h.writeUInt16LE(n.length,26);return Buffer.concat([h,n,b]); }
  const p=await parsePayload(Buffer.concat([member('README.txt','readme'),member('charges.json',json)]));
  assert.equal(p.parsed[0].member,'charges.json'); assert.equal(p.parsed[0].cmsVersion,'3.0.0');
});
test('gzip expansion is bounded and HTML overrides MIME', async () => {
  const p=await parsePayload(zlib.gzipSync(Buffer.alloc(1000000,32)), '', 1024); assert.equal(p.inflatedBytes,1024);
  const h=await parsePayload(Buffer.from('<html>challenge</html>'),'application/json');assert.equal(h.parsed[0].innerKind,'html');assert.equal(h.parsed[0].cmsVersion,null);
});
test('transport failure falls back to curl but local permission failure does not',async()=>{
  let calls=0;const curl=async()=>{calls++;return {status:200,body:Buffer.from(json),headers:{},via:'curl'}};
  const r=await retrieve('https://example.org',1000,{native:async()=>{throw new Error('socket hang up')},curl});assert.equal(r.via,'curl');assert.equal(r.attempts.length,2);
  await assert.rejects(()=>retrieve('https://example.org',1000,{native:async()=>{throw new Error('EACCES')},curl}));assert.equal(calls,1);
});
test('progressive reads stop on sufficient metadata without HEAD',async()=>{
  let calls=0;const p=await progressiveProbe('https://example.org',async()=>{calls++;return {status:206,body:Buffer.from(json),headers:{},checkedAt:'2026-09-09',attempts:[{bytes:json.length}]}});
  assert.equal(calls,1);assert.equal(p.candidates[0].cmsVersion,'3.0.0');
});
test('legacy model recovery cannot accept state-only or date-only evidence',()=>{
  const {corroborate}=require('../lib/recover-llm');
  assert.equal(corroborate({rangeStatus:200,mrfLicenseState:'AL'},[{state:'AL',name:'Test'}]).accepted,false);
  assert.equal(corroborate({declaredLastUpdated:'2026-09-01'},[{state:'AL',name:'Test'}]).accepted,false);
});
