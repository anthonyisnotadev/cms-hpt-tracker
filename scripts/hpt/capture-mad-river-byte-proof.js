'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { retrieve } = require('./lib/recovery-transport');
const root = path.resolve(__dirname, '../..');
const url = 'https://sthpiprd.blob.core.windows.net/machine-readable-files/8531/941698406_american-hospital-management-corporation_standardcharges.csv';
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
async function main() {
  const response = await retrieve(url, 262144, { timeoutMs: 30000 });
  const bytes = response.body;
  const digest = sha(bytes);
  if (!(response.status >= 200 && response.status < 300) || bytes.length !== 262144 || digest !== '53763553c489b1ed485eacbb528bc48d1d670eb6847ed7901ed0961dc97ba327')
    throw new Error(`Mad River file changed: ${response.status} ${bytes.length} ${digest}`);
  const text = bytes.toString('utf8');
  if (!text.includes('Mad River Community Hospital') || !text.includes('3800 Janes Road')) throw new Error('Mad River identity changed');
  const relative = `cms_data/hpt/nationwide-verification/file-byte-proof/${digest}.bin`;
  const artifact = path.join(root, relative); fs.mkdirSync(path.dirname(artifact), { recursive: true });
  if (fs.existsSync(artifact) && sha(fs.readFileSync(artifact)) !== digest) throw new Error('Existing artifact changed');
  if (!fs.existsSync(artifact)) fs.writeFileSync(artifact, bytes);
  const ledgerPath = path.join(root, 'data/hpt-audit/nationwide-file-byte-proof.json');
  const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  ledger.records = ledger.records.filter(row => !(row.ccns || []).includes('050028'));
  ledger.records.push({ url, ccns: ['050028'], checked_at: '2026-09-25T11:15:20Z', final_url: response.finalUrl || url,
    http_status: response.status, requested_range: 'bytes=0-262143', bytes_retained: bytes.length, sha256: digest,
    raw_artifact: relative, content_type: 'text/csv', parsed_root_candidates: [{ member: '', fileKind: 'csv', innerKind: 'csv',
      declaredLastUpdated: '2025-07-22', cmsVersion: '3.0.0', mrfHospitalName: 'American Hospital Management Corporation',
      mrfLocationName: 'Mad River Community Hospital', mrfAddress: '3800 Janes Road, Arcata, CA 95521', mrfLicenseState: 'CA' }],
    error: '', final_host: 'sthpiprd.blob.core.windows.net' });
  ledger.records.sort((a, b) => String(a.url).localeCompare(String(b.url))); fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
  console.log(JSON.stringify({ ccn: '050028', bytes: bytes.length, sha256: digest, artifact: relative }));
}
main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
