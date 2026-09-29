'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../..');
const url = 'https://img1.wsimg.com/blobby/go/066f994d-06ce-4416-b595-b6f6d5954a20/downloads/58f9cd4e-a33d-49e8-a582-cf58d2fbd03d/471528432_MountainView-Behavioral-Hospital_sta.csv?ver=1783007504297';
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
async function main() {
  const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
  const bytes = Buffer.from(await response.arrayBuffer());
  const digest = sha(bytes);
  if (response.status !== 200 || bytes.length !== 6829 || digest !== 'f0de0ad99743081eea06b2ee9e0d4785422f207c2c9307a6ca9ecd088e740c2d')
    throw new Error(`MountainView file changed: ${response.status} ${bytes.length} ${digest}`);
  const text = bytes.toString('utf8');
  if (!text.includes('MountainView Behavioral Hospital') || !text.includes('Berkeley Heights')) throw new Error('MountainView identity changed');
  const relative = `cms_data/hpt/nationwide-verification/file-byte-proof/${digest}.bin`;
  const artifact = path.join(root, relative);
  fs.mkdirSync(path.dirname(artifact), { recursive: true });
  if (fs.existsSync(artifact) && sha(fs.readFileSync(artifact)) !== digest) throw new Error('Existing artifact changed');
  if (!fs.existsSync(artifact)) fs.writeFileSync(artifact, bytes);
  const ledgerPath = path.join(root, 'data/hpt-audit/nationwide-file-byte-proof.json');
  const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  ledger.records = ledger.records.filter(row => !(row.ccns || []).includes('314027'));
  ledger.records.push({ url, ccns: ['314027'], checked_at: '2026-09-21T14:35:00Z', final_url: url,
    http_status: 200, requested_range: 'complete-small-file', bytes_retained: bytes.length, sha256: digest,
    raw_artifact: relative, content_type: 'text/csv', parsed_root_candidates: [{
      member: '', fileKind: 'csv', innerKind: 'csv', declaredLastUpdated: '2026-02-02', cmsVersion: '3.0.0',
      mrfHospitalName: 'MountainView Behavioral Hospital', mrfLocationName: 'MountainView Behavioral Hospital',
      mrfAddress: '40 Watchung Way Berkeley Heights, NJ 07922', mrfLicenseState: 'NJ',
    }], error: '', final_host: 'img1.wsimg.com' });
  ledger.records.sort((a, b) => String(a.url).localeCompare(String(b.url)));
  fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
  console.log(JSON.stringify({ ccn: '314027', bytes: bytes.length, sha256: digest, artifact: relative }));
}
main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
