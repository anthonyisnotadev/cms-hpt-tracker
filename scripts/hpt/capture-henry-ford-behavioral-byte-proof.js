'use strict';
const fs = require('node:fs'); const path = require('node:path'); const crypto = require('node:crypto');
const { retrieve } = require('./lib/recovery-transport');
const root = path.resolve(__dirname, '../..');
const url = 'https://www.henryfordbhh.com/wp-content/uploads/pricing/2026/580/87-2121325_HFHS-Acadia-Joint-Venture-LLC_standardcharges.csv';
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
async function main() {
  const response = await retrieve(url, 4627119, { timeoutMs: 60000 }); const bytes = response.body; const digest = sha(bytes);
  if (!((response.status === 200 || response.status === 206) && bytes.length === 4627119) || digest !== '6232c4277826a84bdaa5b412346a651720b5d45b6c01e563e14b5526ed7a57de') throw new Error(`Henry Ford file changed: ${response.status} ${bytes.length} ${digest}`);
  const text = bytes.toString('utf8'); if (!text.includes('Henry Ford Health Behavioral Health Hospital') || !text.includes('7100 Berryhill')) throw new Error('Henry Ford identity changed');
  const relative = `cms_data/hpt/nationwide-verification/file-byte-proof/${digest}.bin`; const artifact = path.join(root, relative); fs.mkdirSync(path.dirname(artifact), { recursive: true });
  if (fs.existsSync(artifact) && sha(fs.readFileSync(artifact)) !== digest) throw new Error('Existing artifact changed'); if (!fs.existsSync(artifact)) fs.writeFileSync(artifact, bytes);
  const ledgerPath = path.join(root, 'data/hpt-audit/nationwide-file-byte-proof.json'); const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8')); ledger.records = ledger.records.filter(row => !(row.ccns || []).includes('234011'));
  ledger.records.push({ url, ccns: ['234011'], checked_at: '2026-09-25T15:00:00Z', final_url: response.finalUrl || url, http_status: response.status, requested_range: 'complete-file', bytes_retained: bytes.length, sha256: digest, raw_artifact: relative, content_type: 'text/csv', parsed_root_candidates: [{ member: '', fileKind: 'csv', innerKind: 'csv', declaredLastUpdated: '2025-12-31', cmsVersion: '3.0.0', mrfHospitalName: 'HFHS-Acadia Joint Venture, LLC', mrfLocationName: 'Henry Ford Health Behavioral Health Hospital', mrfAddress: '7100 Berryhill, West Bloomfield, MI 48322', mrfLicenseState: 'MI' }], error: '', final_host: 'www.henryfordbhh.com' });
  ledger.records.sort((a, b) => String(a.url).localeCompare(String(b.url))); fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n'); console.log(JSON.stringify({ ccn: '234011', bytes: bytes.length, sha256: digest, artifact: relative }));
}
main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
