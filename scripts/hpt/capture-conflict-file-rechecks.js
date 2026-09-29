'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const proofPath = path.join(audit, 'nationwide-file-byte-proof.json');
const artifactDir = path.join(root, 'cms_data/hpt/nationwide-verification/file-byte-proof');
fs.mkdirSync(artifactDir, { recursive: true });

const targets = [
  '050581', // UCI Lakewood: retained address conflict
  '090004', // MedStar Georgetown: retained license-state conflict
  '100157'  // Lakeland Regional: retained license/address conflict
];
const nationwide = JSON.parse(fs.readFileSync(path.join(audit, 'nationwide-verification.json'), 'utf8')).records;
const manual = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-manual-access-observations.json'), 'utf8')).records;
const getUrl = ccn => {
  const m = manual.find(r => r.ccn === ccn) || {};
  const n = nationwide.find(r => r.ccn === ccn) || {};
  return m.facility_file_url || m.mrf_url || n.mrf_url || '';
};
const fetchRange = url => new Promise((resolve, reject) => {
  const req = https.get(url, { headers: { Range: 'bytes=0-262143', Accept: '*/*' } }, res => {
    const chunks = [];
    res.on('data', chunk => chunks.push(chunk));
    res.on('end', () => resolve({ status: res.statusCode || 0, headers: res.headers, bytes: Buffer.concat(chunks) }));
  });
  req.on('error', reject);
  req.setTimeout(45000, () => req.destroy(new Error('timeout')));
});

(async () => {
  const ledger = JSON.parse(fs.readFileSync(proofPath, 'utf8'));
  const results = [];
  for (const ccn of targets) {
    const url = getUrl(ccn);
    if (!url) { results.push({ ccn, status: 'no-url' }); continue; }
    try {
      const response = await fetchRange(url);
      const sha = crypto.createHash('sha256').update(response.bytes).digest('hex');
      const artifact = `cms_data/hpt/nationwide-verification/file-byte-proof/${sha}.bin`;
      fs.writeFileSync(path.join(root, artifact), response.bytes);
      const existing = ledger.records.filter(r => r.url === url && r.ccns?.includes(ccn));
      const record = {
        url, ccns: [ccn], checked_at: new Date().toISOString(), final_url: url,
        http_status: response.status, requested_range: 'header-sample-262144',
        bytes_retained: response.bytes.length, sha256: sha, raw_artifact: artifact,
        content_type: response.headers['content-type'] || '', parsed_root_candidates: [],
        recheck_reason: 'priority-1 conflict-file current-hash recheck',
        prior_proof_count: existing.length
      };
      ledger.records = ledger.records.filter(r => !(r.url === url && r.ccns?.includes(ccn)));
      ledger.records.push(record);
      results.push({ ccn, status: response.status, bytes: response.bytes.length, sha256: sha, prior_proof_count: existing.length });
    } catch (error) {
      results.push({ ccn, status: 'error', error: error.message });
    }
  }
  ledger.records.sort((a,b) => String(a.url).localeCompare(String(b.url)) || String(a.ccns?.[0] || '').localeCompare(String(b.ccns?.[0] || '')));
  fs.writeFileSync(proofPath, JSON.stringify(ledger, null, 2) + '\n');
  console.log(JSON.stringify({ results }, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
