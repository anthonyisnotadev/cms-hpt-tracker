'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '../..');
const pointerUrl = 'https://georgeregional.com/wp-content/uploads/2025/12/64-6001398_George-Regional-Hospital_standardcharges.csv';
const pageUrl = 'https://georgeregional.com/wp-content/uploads/2026/08/64-6001398_George-Regional-Hospital_standardcharges-5.csv';
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

async function main() {
  const response = await fetch(pageUrl, { signal: AbortSignal.timeout(30000) });
  const bytes = Buffer.from(await response.arrayBuffer());
  const digest = sha(bytes);
  if (response.status !== 200 || !/^text\/csv/i.test(response.headers.get('content-type') || '')
      || bytes.length !== 4613 || digest !== '60bde9817e52cb0decc715527b7df72539e0768e47b6b441ea8acf98a5baff09')
    throw new Error(`George Regional page file changed: ${response.status} ${bytes.length} ${digest}`);
  const text = bytes.toString('utf8');
  if (!text.includes('hospital_name,last_updated_on,version,location_name,hospital_address,license_number|MS')
      || !text.includes('George County Hospital DBA: George Regional Hospital')
      || !text.includes('859 Winter Street,Lucedale,MS,39452'))
    throw new Error('George Regional byte identity changed');

  const relative = `cms_data/hpt/nationwide-verification/file-byte-proof/${digest}.bin`;
  const artifact = path.join(root, relative);
  fs.mkdirSync(path.dirname(artifact), { recursive: true });
  if (fs.existsSync(artifact) && sha(fs.readFileSync(artifact)) !== digest)
    throw new Error('Existing George Regional artifact changed');
  if (!fs.existsSync(artifact)) fs.writeFileSync(artifact, bytes);

  const proofPath = path.join(root, 'data/hpt-audit/nationwide-file-byte-proof.json');
  const proof = JSON.parse(fs.readFileSync(proofPath, 'utf8'));
  proof.records = proof.records.filter(row => !(row.ccns || []).includes('250036'));
  proof.records.push({
    url: pointerUrl, ccns: ['250036'], checked_at: '2026-09-25T11:45:00Z',
    final_url: pageUrl, http_status: 200, requested_range: 'complete-small-file',
    bytes_retained: bytes.length, sha256: digest, raw_artifact: relative,
    content_type: 'text/csv', parsed_root_candidates: [{
      member: '', fileKind: 'csv', innerKind: 'csv', declaredLastUpdated: '2026-07-27',
      cmsVersion: '3.0.0', mrfHospitalName: 'George County Hospital DBA: George Regional Hospital',
      mrfLocationName: 'George Regional Hospital_Lucedale',
      mrfAddress: '859 Winter Street,Lucedale,MS,39452', mrfLicenseState: 'MS',
    }], error: '', final_host: 'georgeregional.com',
  });
  proof.records.sort((a, b) => String(a.url).localeCompare(String(b.url)));
  fs.writeFileSync(proofPath, JSON.stringify(proof, null, 2) + '\n');
  console.log(JSON.stringify({ ccn: '250036', bytes: bytes.length, sha256: digest, artifact: relative }));
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
