'use strict';

// Derive a reproducible, change-gated ledger for verification claims whose
// parsed browser observations still lack retained file bytes after the bounded
// alternate-route pass. This records transport evidence; it never changes a
// hospital finding.
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '../..');
const read = relative => JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));
const output = path.join(root, 'data/hpt-audit/reconciliation-browser-byte-proof-retries.json');
const nationwide = new Map(read('data/hpt-audit/nationwide-verification.json').records.map(record => [record.ccn, record]));
const browser = read('data/hpt-audit/nationwide-browser-reviews.json').records;
const proof = read('data/hpt-audit/nationwide-file-byte-proof.json').records;
const reconciliation = read('data/hpt-audit/nationwide-reconciliation.json').records;
const prior = fs.existsSync(output) ? read('data/hpt-audit/reconciliation-browser-byte-proof-retries.json').records : [];
const priorByCcn = new Map(prior.map(record => [record.ccn, record]));
const proofByCcn = new Map();
for (const record of proof) for (const ccn of record.ccns || []) proofByCcn.set(ccn, record);

const records = reconciliation
  .filter(record => record.workstream === 'verification-proof-gap')
  .map(record => {
    const verification = nationwide.get(record.ccn) || {};
    const target = verification.mrf_url || record.standing_mrf_url || record.candidate_mrf_url;
    const browserRecord = browser.find(item => item.kind === 'mrf' && item.target === target && item.status === 'retrieved');
    const proofRecord = proofByCcn.get(record.ccn) || {};
    const existing = priorByCcn.get(record.ccn);
    const routes = [...(existing?.routes || [])];
    if (!routes.some(route => route.client === 'bounded-source-page-referer-curl-no-range')) {
      routes.push({ client: 'bounded-source-page-referer-curl-no-range', result: proofRecord.http_status ? `HTTP ${proofRecord.http_status}` : (proofRecord.error || 'no-response') });
    }
    return {
      ccn: record.ccn,
      target,
      prior_observation: browserRecord
        ? `A ${browserRecord.bytes_read || 'bounded'}-byte browser response was parsed on ${browserRecord.observed_at} but the response bytes were not retained as an auditable sample.`
        : 'The nationwide verification claim relies on parsed browser metadata without a retained auditable byte sample.',
      attempted_at: proofRecord.checked_at || existing?.attempted_at || '',
      routes,
      disposition: 'retained-byte-proof-still-pending',
      next_action: 'Preserve the parsed browser observation and standing finding. Retry the exact URL only after a publisher or access-control change, or through a demonstrably different download-capable route; do not infer file absence or downgrade the standing result from the recorded transport blocks.'
    };
  })
  .sort((a, b) => a.ccn.localeCompare(b.ccn));

fs.writeFileSync(output, JSON.stringify({
  generated_at: new Date().toISOString(),
  reason: 'Change-gated inventory for parsed browser verification claims still lacking retained byte samples after a source-page-referer plus bounded no-Range curl retry.',
  records
}, null, 2) + '\n');
console.log(JSON.stringify({ records: records.length, routes: records.reduce((sum, record) => sum + record.routes.length, 0) }, null, 2));
