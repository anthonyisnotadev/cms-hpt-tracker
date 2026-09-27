'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { retrieve } = require('./lib/recovery-transport');
const root = path.resolve(__dirname, '../..');
const url = 'https://secure.claraprice.net/price-transparency/NTWZ-1713817372531/machine-readable/470421272_community-medical-center_standardcharges.json';
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
async function main() {
  const response = await retrieve(url, 12000000, { timeoutMs: 60000 });
  const bytes = response.body;
  const digest = sha(bytes);
  if (response.status !== 200 || bytes.length !== 6805201 || digest !== 'ba6bacec039348ee75ca5871412e2b0271703d6d3a41bad5acfe0729f9b31c86')
    throw new Error(`Community Medical Center file changed: ${response.status} ${bytes.length} ${digest}`);
  const text = bytes.toString('utf8');
  if (!text.includes('Community Medical Center') || !text.includes('Falls City')) throw new Error('Community Medical Center identity changed');
  const relative = `cms_data/hpt/nationwide-verification/file-byte-proof/${digest}.bin`;
  const artifact = path.join(root, relative);
  fs.mkdirSync(path.dirname(artifact), { recursive: true });
  if (fs.existsSync(artifact) && sha(fs.readFileSync(artifact)) !== digest) throw new Error('Existing artifact changed');
  if (!fs.existsSync(artifact)) fs.writeFileSync(artifact, bytes);
  const ledgerPath = path.join(root, 'data/hpt-audit/nationwide-file-byte-proof.json');
  const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  ledger.records = ledger.records.filter(row => !(row.ccns || []).includes('281352'));
  ledger.records.push({ url, ccns: ['281352'], checked_at: '2026-09-25T10:46:39Z', final_url: url,
    http_status: 200, requested_range: 'complete-file', bytes_retained: bytes.length, sha256: digest,
    raw_artifact: relative, content_type: 'application/json', parsed_root_candidates: [{
      member: '', fileKind: 'json', innerKind: 'json', declaredLastUpdated: '2026-06-22', cmsVersion: '3.0.0',
      mrfHospitalName: 'Community Medical Center', mrfLocationName: 'Community Medical Center',
      mrfAddress: '3307 Barada Street, Falls City, NE 68355', mrfLicenseState: 'NE',
    }], error: '', final_host: 'secure.claraprice.net' });
  ledger.records.sort((a, b) => String(a.url).localeCompare(String(b.url)));
  fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
  console.log(JSON.stringify({ ccn: '281352', bytes: bytes.length, sha256: digest, artifact: relative }));
}
main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
