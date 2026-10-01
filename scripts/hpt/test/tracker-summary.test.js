'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { summarize, mrfCheck } = require('../../../js/tracker-summary');
function fixture() {
  const row = (ccn, state, finding, date, bytes, intervention) => [ccn, ccn, 'Town', state, 0, finding, null, '', 'https://example.org/' + ccn, '', '', bytes ? 'csv' : '', bytes, date, null, null, 0, '2026-09-29', '', intervention];
  return {
    tiers: ['compliant', 'failing', 'blocked', 'unknown', 'exempt'].map(key => ({ key, label: key, n: 999 })),
    findings: [{key:'found',tier:'compliant',n:999},{key:'unresolved',tier:'unknown',n:999}],
    interventions: [{key:'none',label:'None',n:999},{key:'review',label:'Review',n:999}],
    states:[{code:'NY',name:'New York'},{code:'NJ',name:'New Jersey'}],
    dict:{states:['NY','NJ'],types:['Acute'],findings:['found','unresolved'],interventions:['none','review']},
    freshness:[{lo:0,hi:90},{lo:91,hi:180},{lo:181,hi:365},{lo:366,hi:null}],
    queue:[{key:'genuinely-unresolved-investigation',n:999},{key:'standing-evidence-follow-up',n:999}],
    investigationNextSteps:{b:{stream:'genuinely-unresolved-investigation'},a:{stream:'standing-evidence-follow-up'}},
    rows:[row('a',0,0,'2026-09-01',100,0),row('b',0,1,'',null,1),row('c',1,0,'2025-01-01',200,0)]
  };
}
test('derives every rollup from rows instead of stale aggregate counts', () => {
  const data=fixture(), before=JSON.stringify(data), result=summarize(data,{},'2026-09-29');
  assert.equal(result.totals.hospitals,3);
  assert.equal(result.totals.filesRead,2);
  assert.equal(result.totals.terabytes,300/1e12);
  assert.equal(result.tiers.find(t=>t.key==='compliant').n,2);
  assert.equal(result.states[0].rate,1);
  assert.equal(result.states[0].coverage,.5);
  assert.equal(result.totals.agesCounted,2);
  assert.equal(result.freshness.reduce((n,b)=>n+b.n,0),2);
  assert.equal(result.findings.reduce((n,f)=>n+f.n,0),3);
  assert.equal(result.interventions.reduce((n,f)=>n+f.n,0),3);
  assert.equal(result.queue.reduce((n,q)=>n+q.n,0),2);
  assert.equal(JSON.stringify(data),before);
});
test('corrections update tiers, categories, ages, state rates and unresolved work together', () => {
  const result=summarize(fixture(),{b:{verdict:'compliant',mrfUrl:'https://new.org/b',lastUpdatedOn:'2026-09-10',templateVersion:'3.0.0'}},'2026-09-29');
  assert.equal(result.tiers.find(t=>t.key==='compliant').n,3);
  assert.equal(result.states[0].coverage,1);
  assert.equal(result.records.b.age,19);
  assert.equal(result.findings.find(f=>f.key==='manual-compliant').n,1);
  assert.equal(result.interventions.find(f=>f.key==='manual-compliant').n,1);
  assert.equal(result.queue.find(q=>q.key==='genuinely-unresolved-investigation').n,0);
  assert.equal(result.queue.find(q=>q.key==='standing-evidence-follow-up').n,1);
  assert.equal(result.totals.filesRead,3);
});
test('a replacement file does not inherit old dates, versions or byte measurements', () => {
  const data=fixture();data.rows[0][7]='2.0.0';
  const result=summarize(data,{a:{mrfUrl:'https://new.org/a'}},'2026-09-29');
  assert.equal(result.records.a.age,null);
  assert.equal(result.records.a.version,'');
  assert.equal(result.totals.terabytes,200/1e12);
  assert.equal(result.totals.agesCounted,1);
  assert.equal(result.totals.filesRead,1);
});
test('older corrections cannot override a newer reviewed record, and empty measurements stay unknown', () => {
  const data=fixture(); data.reviewedAt={a:'2026-09-29'};
  const result=summarize(data,{a:{verdict:'unknown',checkedOn:'2026-09-01'}},'2026-09-29');
  assert.equal(result.records.a.tier,'compliant');
  assert.equal(result.totals.corrections,0);
  data.rows=[];
  const empty=summarize(data,{},'2026-09-29');
  assert.equal(empty.totals.medianAge,null);
  assert.equal(empty.states[0].rate,null);
});
test('file ages advance with the current day without changing recorded verdicts', () => {
  const data=fixture();
  const first=summarize(data,{},'2026-09-29'), next=summarize(data,{},'2026-09-30');
  assert.equal(next.records.a.age,first.records.a.age+1);
  assert.equal(next.records.a.tier,first.records.a.tier);
});

test('MRF badges distinguish checked requirements from full compliance and unresolved evidence', () => {
  const base = { tier: 'compliant', finding: 'compliant-observed', mrf: 'https://example.org/file.csv', version: '3.0.0', age: 175 };
  assert.equal(mrfCheck(base).state, 'met');
  assert.equal(mrfCheck({ ...base, mrf: '' }).state, 'met');
  assert.match(mrfCheck(base).detail, /not checked/);
  assert.equal(mrfCheck({ ...base, finding: 'old-template-version', tier: 'failing', version: '2.0.0' }).state, 'issue');
  assert.equal(mrfCheck({ ...base, finding: 'mrf-stale-over-365-days', tier: 'failing', age: 400 }).state, 'issue');
  assert.equal(mrfCheck({ ...base, age: 400 }).state, 'review');
  assert.equal(mrfCheck({ ...base, version: '' }).state, 'review');
  assert.equal(mrfCheck({ ...base, tier: 'failing', finding: 'mrf-url-unreachable' }).state, 'review');
  assert.equal(mrfCheck({ ...base, tier: 'unknown', finding: 'not-assessed-domain-unknown', mrf: '' }).state, 'unverified');
  assert.equal(mrfCheck({ ...base, tier: 'exempt' }).state, 'scope');
});

test('a retained finding does not silently close its unresolved evidence task', () => {
  const data=fixture();data.rows[1][5]=0;
  const result=summarize(data,{},'2026-09-29');
  assert.equal(result.queue.find(q=>q.key==='genuinely-unresolved-investigation').n,1);
});
test('reconciliation flags keep browser queue counts aligned with the generated queue', () => {
  const data=fixture();
  data.reconciliationByCcn={
    b:{latest_observation_superseded:true,standing_evidence_retained:false},
    a:{latest_observation_superseded:false,standing_evidence_retained:true}
  };
  const result=summarize(data,{},'2026-09-29');
  assert.equal(result.queue.find(q=>q.key==='genuinely-unresolved-investigation').n,0);
  assert.equal(result.queue.find(q=>q.key==='standing-evidence-follow-up').n,1);
});
test('corrected metadata replaces outdated audit categories even when the tier is unchanged', () => {
  const result=summarize(fixture(),{a:{verdict:'compliant',lastUpdatedOn:'2026-09-29',templateVersion:'3.0.0'}},'2026-09-29');
  assert.equal(result.records.a.finding,'manual-compliant');
  assert.equal(result.records.a.intervention,'manual-compliant');
  assert.equal(result.records.a.age,0);
});

test('an issue correction preserves unresolved evidence work', () => {
  const result=summarize(fixture(),{b:{verdict:'failing'}},'2026-09-29');
  assert.equal(result.queue.find(q=>q.key==='genuinely-unresolved-investigation').n,1);
});
test('the full tracker keeps all 5,419 hospitals and its reviewed work queue', () => {
  const html=require('fs').readFileSync(require('path').resolve(__dirname,'../../../tracker.html'),'utf8');
  const data=JSON.parse(html.match(/<script id="tracker-data"[^>]*>([\s\S]*?)<\/script>/)[1]);
  const result=summarize(data,{},'2026-09-29');
  assert.equal(result.totals.hospitals,5419);
  assert.deepEqual(result.queue,data.queue.map(q => q.key === 'genuinely-unresolved-investigation'
    ? Object.assign({},q,{n:581}) : q));
  assert.equal(result.states.reduce((n,s)=>n+s.total,0),5419);
  assert.equal(result.types.reduce((n,s)=>n+s.total,0),5419);
  assert.equal(result.findings.reduce((n,s)=>n+s.n,0),5419);
  assert.equal(result.interventions.reduce((n,s)=>n+s.n,0),5419);
});
