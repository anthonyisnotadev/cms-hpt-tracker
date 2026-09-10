'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path');
const R=require('../recovery-run'),{sha,PARSER_VERSION}=require('../lib/recovery-transport');
const {verifyProposal}=require('../recovery-finalize');
test('application rejects modified raw pointer or file evidence',t=>{
 const original=R.STAGE,dir=fs.mkdtempSync(path.join(os.tmpdir(),'hpt-proof-'));R.STAGE=dir;
 t.after(()=>{R.STAGE=original;fs.rmSync(dir,{recursive:true,force:true});});
 const pointer=Buffer.from('location-name: Test Hospital\nmrf-url: https://example.org/file.csv'),body=Buffer.from('test response');
 const e={url:'https://example.org/file.csv',pointerUrl:'https://example.org/cms-hpt.txt',pointerSha256:sha(pointer),fileSha256:sha(body),location_name:'Test Hospital',member:'',date:'2026-08-01',version:'3.0.0'};
 const c={member:'',declaredLastUpdated:e.date,cmsVersion:e.version,rangeStatus:200,mrfHospitalName:'Test Hospital',mrfLocationName:'Test Hospital',mrfAddress:'100 Main Street, Town, CA 90001',mrfLicenseState:'CA'};
 const p={candidates:[c],attempts:[{method:'GET',status:200,artifact:'body.bin',sha256:sha(body)}]};
 fs.writeFileSync(path.join(dir,'probe-'+PARSER_VERSION+'-'+sha(e.url)+'.json'),JSON.stringify(p));
 const pointerPath=path.join(dir,'pointer-proof-'+e.pointerSha256+'.bin');fs.writeFileSync(pointerPath,pointer);fs.writeFileSync(path.join(dir,'body.bin'),body);
 const index=new Map([[e.pointerUrl+'|'+e.pointerSha256,{entries:[{location_name:e.location_name,urls:[e.url]}]}]]);
 const roster=[{ccn:'000001',name:'Test Hospital',state:'CA',address:'100 Main Street',city:'Town',zip:'90001'}];
 assert.equal(verifyProposal({ccn:'000001',evidence:e},roster,index),true);
 fs.writeFileSync(path.join(dir,'body.bin'),'changed');assert.throws(()=>verifyProposal({ccn:'000001',evidence:e},roster,index),/Raw file proof mismatch/);
 fs.writeFileSync(path.join(dir,'body.bin'),body);fs.writeFileSync(pointerPath,'changed');assert.throws(()=>verifyProposal({ccn:'000001',evidence:e},roster,index),/Raw pointer proof/);
});
