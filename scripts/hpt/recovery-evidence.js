'use strict';
const fs=require('fs'),path=require('path'),R=require('./recovery-run');
const {retrieve,sha}=require('./lib/recovery-transport');
const {pooled}=require('./lib/util');
async function main(){
 const proposals=R.read(path.join(R.STAGE,'proposals.json'));
 const pointers=[...new Map(proposals.map(p=>[p.evidence.pointerUrl,p.evidence])).values()];
 await pooled(pointers,{concurrency:6,keyFn:e=>new URL(e.pointerUrl).hostname},async e=>{
  const artifact='pointer-proof-'+e.pointerSha256+'.bin',file=path.join(R.STAGE,artifact);
  if(fs.existsSync(file)&&sha(fs.readFileSync(file))===e.pointerSha256)return;
  const r=await retrieve(e.pointerUrl,524288);R.json(path.join(R.STAGE,'pointer-proof-attempt-'+sha(e.pointerUrl)+'.json'),r.attempts);
  if(sha(r.body)!==e.pointerSha256)throw new Error('Pointer changed since discovery: '+e.pointerUrl);
  fs.writeFileSync(file,r.body);
 });
 const missing=pointers.filter(e=>!fs.existsSync(path.join(R.STAGE,'pointer-proof-'+e.pointerSha256+'.bin')));
 if(missing.length)throw new Error('Pointer raw proof unavailable for '+missing.length+' sources');
 console.log('Retained matching raw pointer evidence for '+pointers.length+' sources');
}
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
