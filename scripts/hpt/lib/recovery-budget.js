'use strict';
const fs=require('fs');
class Budget {
  constructor(file,limit=10){this.file=file;this.state=fs.existsSync(file)?JSON.parse(fs.readFileSync(file)): {limit,entries:[]};if(this.state.limit!==limit)throw new Error('Budget limit mismatch');}
  save(){fs.writeFileSync(this.file+'.partial',JSON.stringify(this.state,null,2));fs.renameSync(this.file+'.partial',this.file);}
  get committed(){return this.state.entries.reduce((s,e)=>s+(e.actual??e.reserved),0);}
  reserve(id,kind,amount){
    if(this.state.entries.some(e=>e.id===id))throw new Error('Attempt already reserved; inspect its result before retrying');
    if(this.state.entries.some(e=>e.status==='unknown'))throw new Error('Accounting unavailable; paid stage halted');
    if(!Number.isFinite(amount)||amount<=0||this.committed+amount>this.state.limit)throw new Error('Paid budget exhausted or invalid price');
    this.state.entries.push({id,kind,reserved:amount,status:'reserved',at:new Date().toISOString()});this.save();
  }
  settle(id,actual,details={}){const e=this.state.entries.find(e=>e.id===id);if(!e)throw new Error('Unknown reservation');
    if(!Number.isFinite(actual)||actual<0||actual>e.reserved){e.status='unknown';this.save();throw new Error('Accounting unavailable or price exceeded reservation');}
    Object.assign(e,{actual,status:'settled',...details});this.save();
  }
  uncertain(id){const e=this.state.entries.find(e=>e.id===id);if(e&&e.status!=='settled'){e.status='unknown';this.save();}}
}
function validateDecision(value,evidenceIds){
  if(!value||!['visit','search','review','stop'].includes(value.action)||typeof value.explanation!=='string'||!Array.isArray(value.evidence_ids)
    ||value.evidence_ids.some(id=>!evidenceIds.includes(id))||value.explanation.length>4000)throw new Error('Invalid model decision');
  if(value.action==='visit')value.url=require('./recovery-transport').safeUrl(value.url);
  if(value.action==='search'&&(typeof value.query!=='string'||!value.query.trim()||value.query.length>300))throw new Error('Invalid search query');
  if(value.proposed_relationship!==undefined&&!['same_facility','provider_only','unrelated','unknown'].includes(value.proposed_relationship))throw new Error('Invalid proposed relationship');
  return value;
}
function acquireRunLock(file){
  let fd;
  try{fd=fs.openSync(file,'wx');}catch(e){
    if(e.code!=='EEXIST')throw e;
    const previous=JSON.parse(fs.readFileSync(file,'utf8'));let running=true;
    try{process.kill(previous.pid,0);}catch(error){if(error.code==='ESRCH')running=false;}
    if(running)throw new Error('A paid pilot process already holds the run lock');
    fs.unlinkSync(file);fd=fs.openSync(file,'wx');
  }
  fs.writeFileSync(fd,JSON.stringify({pid:process.pid,startedAt:new Date().toISOString()}));fs.closeSync(fd);
  return ()=>fs.unlinkSync(file);
}
module.exports={Budget,validateDecision,acquireRunLock};
