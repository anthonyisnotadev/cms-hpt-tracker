'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {refsFor}=require('../recovery-run');
const {selectPilot,inputFor}=require('../recovery-pilot');
const {matchMrfHeader}=require('../lib/mrf-header-match');
test('historical duplicates cannot erase fresh pointer provenance',()=>{
 const r={ccn:'010001',hospital_name:'Example Hospital',base:{mrf_url:'https://example.org/mrf.csv'}};
 const refs=refsFor(r,{docs:[{finalUrl:'https://example.org/cms-hpt.txt',checkedAt:'2026-09-09',sha256:'hash',entries:[{location_name:'Example Hospital',urls:[r.base.mrf_url]}],links:[]}]},[{ccn:r.ccn,url:r.base.mrf_url}]);
 assert.equal(refs.length,1);assert.equal(refs[0].pointerSha256,'hash');
});
test('pilot quotas are deterministic, unique, and capped at sixty',()=>{
 const rows=[];for(const status of ['pointer-or-domain-review','identity-or-format-review','file-access-review','metadata-or-pointer-review'])for(let i=0;i<30;i++)rows.push({ccn:status+i,status,base:{domain:status+i+'.example'}});
 const p=selectPilot(rows);assert.equal(p.length,60);assert.equal(new Set(p.map(r=>r.ccn)).size,60);assert.equal(p.filter(r=>r.status==='pointer-or-domain-review').length,20);assert.deepEqual(p,selectPilot([...rows].reverse()));
});
test('model inputs omit emails and retain a conservative byte bound',()=>{
 const r={ccn:'1',hospital_name:'Example',state:'AL',status:'review',roster:{address:'10 Main St',city:'Example',zip:'12345'}};
 const p=inputFor(r,[{finalUrl:'https://example.org',status:200,text:'contact@example.org '+ 'x'.repeat(100000),links:[]}],[],[]);
 assert.ok(Buffer.byteLength(JSON.stringify(p))<24000);assert.ok(!JSON.stringify(p).includes('contact@example.org'));
});
test('a conflicting ZIP blocks identity but a five digit street number is not a ZIP',()=>{
 const h={ccn:'1',name:'Example Hospital',state:'AL',address:'12345 Main Street',city:'Example',zip:'35000'};
 const p={rangeStatus:200,mrfLicenseState:'AL',mrfHospitalName:h.name,mrfAddress:'12345 Main Street, Example, AL 35001'};
 assert.equal(matchMrfHeader({refs:[]},p,[h]).matches.length,0);
 p.mrfAddress='12345 Main Street, Example, AL';assert.equal(matchMrfHeader({refs:[]},p,[h]).matches.length,1);
});
