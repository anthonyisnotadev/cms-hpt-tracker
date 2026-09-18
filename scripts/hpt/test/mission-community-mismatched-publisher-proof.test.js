'use strict';
const test=require('node:test'); const assert=require('node:assert/strict'); const fs=require('node:fs'); const path=require('node:path'); const crypto=require('node:crypto');
const { parsePointer }=require('../lib/parse'); const { loadReviewedView }=require('../lib/reviewed-resolutions');
const root=path.resolve(__dirname,'../../..'), audit=path.join(root,'data/hpt-audit'); const p=require(path.join(audit,'reconciliation-mission-community-mismatched-publisher-proof.json'));
test('Mission Community replaces unrelated Mission Health attribution with its own stale JSON',()=>{
 const sample=fs.readFileSync(path.join(root,p.retained_sample)); const sha=crypto.createHash('sha256').update(sample).digest('hex'); const pointer=parsePointer(fs.readFileSync(path.join(root,p.sanitized_pointer_entry),'utf8')).entries[0];
 assert.equal(sha,p.mrf_sample_sha256); assert.equal(pointer.mrfUrl,p.mrf_url); assert.match(sample.toString('utf8',0,700),/Mission Community Hospital/); assert.match(sample.toString('utf8',0,700),/14850 Roscoe Blvd\. Panorama City CA, 91402/);
 const ledger=require(path.join(audit,'reviewed-resolutions.json')); const resolution=ledger.find(x=>x.ccn===p.ccn); assert.equal(resolution.action,'replace-observation'); assert.equal(resolution.evidence.observedFinding,'mrf-stale-over-365-days');
 const view=loadReviewedView(audit); const standing=view.compliance.find(x=>x.ccn===p.ccn); assert.equal(standing.finding,'mrf-stale-over-365-days'); assert.equal(standing.domain,'mchonline.org'); assert.equal(view.history[p.ccn].domain,'missionhealth.org');
});
