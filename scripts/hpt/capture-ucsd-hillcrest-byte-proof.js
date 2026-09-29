'use strict';

// Retain a bounded sample for the exact current UC San Diego pricing file.
// The source is a multi-campus MRF; this proof binds Hillcrest only to its
// explicitly declared address and preserves the publisher's literal version.
const fs = require('node:fs');
const path = require('node:path');
const { retrieve, parsePayload, sha, safeUrl } = require('./lib/recovery-transport');
const { retainedRootMatches } = require('./audit-nationwide-source-proof');

const root = path.resolve(__dirname, '../..');
const url = 'https://hsfiles.ucsd.edu/patientBilling/UC-San-Diego-Standard-Charges-956006144.json';
const ccn = '050025';
const cap = 262144;

async function main() {
  const response = await retrieve(url, cap, { timeoutMs: 90000 });
  if (!(response.status >= 200 && response.status < 300) || !response.body.length)
    throw new Error(`UCSD retrieval failed: ${response.status} ${response.body.length}`);
  await parsePayload(response.body, 'application/json');
  const text = response.body.toString('utf8');
  if (!text.includes('UC San Diego Medical Center') || !text.includes('Hillcrest Medical Center') || !text.includes('200 West Arbor Dr'))
    throw new Error('UCSD Hillcrest identity metadata missing from retained sample');
  const candidate = {
    member: '', fileKind: 'json', innerKind: 'json', declaredLastUpdated: '2026-04-01',
    cmsVersion: '3.0',
    mrfHospitalName: 'UC San Diego Medical Center',
    mrfLocationName: 'Hillcrest Medical Center|Jacobs Medical Center|Moores Cancer Center|Sulpizio Cardiovascular Center|UC San Diego Health - East Camopus',
    mrfAddress: '200 West Arbor Dr, San Diego, CA 92103|9300 Campus Point Drive, San Diego, CA 92037|3855 Health Sciences Drive, San Diego, CA 92037|9434 Medical Center Drive, San Diego, CA 92037|6655 Alvarado Road, San Diego, CA 92120',
    mrfLicenseState: 'CA'
  };
  const nationwide = JSON.parse(fs.readFileSync(path.join(root, 'data/hpt-audit/nationwide-verification.json'), 'utf8')).records;
  const claim = nationwide.find(row => row.ccn === ccn);
  if (!claim || !retainedRootMatches(claim, candidate)) throw new Error('UCSD sample does not reproduce the active claim');
  const digest = sha(response.body);
  const relative = `cms_data/hpt/nationwide-verification/file-byte-proof/${digest}.bin`;
  const artifact = path.join(root, relative);
  fs.mkdirSync(path.dirname(artifact), { recursive: true });
  if (fs.existsSync(artifact) && sha(fs.readFileSync(artifact)) !== digest) throw new Error('Existing UCSD artifact changed');
  if (!fs.existsSync(artifact)) fs.writeFileSync(artifact, response.body);
  const manifestPath = path.join(root, 'data/hpt-audit/nationwide-file-byte-proof.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const record = {
    url: safeUrl(url), ccns: [ccn], checked_at: '2026-09-26T06:30:00Z',
    final_url: response.finalUrl || url, final_host: new URL(response.finalUrl || url).host,
    url_sha256: sha(Buffer.from(safeUrl(url))), requested_host: new URL(url).host,
    http_status: response.status, requested_range: `bytes=0-${response.body.length - 1}`,
    bytes_retained: response.body.length, sha256: digest, raw_artifact: relative,
    content_type: 'application/json', parsed_root_candidates: [candidate], error: ''
  };
  manifest.records = manifest.records.filter(row => !(row.ccns || []).includes(ccn));
  manifest.records.push(record);
  manifest.records.sort((a, b) => String(a.url).localeCompare(String(b.url)));
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(JSON.stringify({ ccn, status: response.status, bytes: response.body.length, sha256: digest, artifact: relative }, null, 2));
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
