'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { retrieve } = require('./lib/recovery-transport');
const root = path.resolve(__dirname, '../..');
const url = 'https://jeffersonhosp.com/wp-content/uploads/2025/01/581309961_JeffersonHospital_StandardCharges.csv';
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
async function main() {
  const response = await retrieve(url, 131072, { timeoutMs: 30000 });
  const bytes = response.body;
  const digest = sha(bytes);
  if (!((response.status === 206 || response.status === 200) && bytes.length === 131072 && digest === 'd29f446b916b8ced5fd67dcb5e073de92a06e4cc4381a401888cfe1d4682564f'))
    throw new Error(`Jefferson file changed: ${response.status} ${bytes.length} ${digest}`);
  const text = bytes.toString('utf8');
  if (!text.includes('Hospital Authority of Jefferson County') || !text.includes('1067 Peachtree Street')) throw new Error('Jefferson identity changed');
  const relative = `cms_data/hpt/nationwide-verification/file-byte-proof/${digest}.bin`;
  const artifact = path.join(root, relative); fs.mkdirSync(path.dirname(artifact), { recursive: true });
  if (fs.existsSync(artifact) && sha(fs.readFileSync(artifact)) !== digest) throw new Error('Existing artifact changed');
  if (!fs.existsSync(artifact)) fs.writeFileSync(artifact, bytes);
  const ledgerPath = path.join(root, 'data/hpt-audit/nationwide-file-byte-proof.json');
  const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  ledger.records = ledger.records.filter(row => !(row.ccns || []).includes('110100'));
  ledger.records.push({ url, ccns: ['110100'], checked_at: '2026-09-21T22:45:00Z', final_url: url,
    http_status: response.status, requested_range: 'bytes=0-131071', bytes_retained: bytes.length, sha256: digest,
    raw_artifact: relative, content_type: 'text/csv', parsed_root_candidates: [{ member: '', fileKind: 'csv', innerKind: 'csv',
      declaredLastUpdated: '2024-11-01', cmsVersion: '2.0.0',
      mrfHospitalName: 'Hospital Authority of Jefferson County and the City of Louisville dba', mrfLocationName: 'Jefferson Hospital',
      mrfAddress: '1067 Peachtree Street, Louisville, Georgia 30434', mrfLicenseState: 'CA' }], error: '', final_host: 'jeffersonhosp.com' });
  ledger.records.sort((a, b) => String(a.url).localeCompare(String(b.url))); fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
  console.log(JSON.stringify({ ccn: '110100', bytes: bytes.length, sha256: digest, artifact: relative }));
}
main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
