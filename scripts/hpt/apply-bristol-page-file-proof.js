'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { csvToObjects } = require('./lib/util');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const pointerUrl = 'https://bristolhealth.org/cms-hpt.txt';
const pointerFileUrl = 'https://sthpiprd.blob.core.windows.net/machine-readable-files/7807/060646559_bristol-hospital,-inc_standardcharges.csv';
const pageFileUrl = 'https://sthpiprd.blob.core.windows.net/machine-readable-files/7807/060646559_bristol-hospital-inc_standardcharges.csv';
const sourcePageUrl = 'https://search.hospitalpriceindex.com/hpi2/machineReadable/BristolHospital/7807';
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

async function main() {
  const base = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8'))
    .find(row => row.ccn === '070029');
  if (!base || base.finding !== 'not-assessed-domain-unknown') throw new Error('Bristol base changed');

  const pointerResponse = await fetch(pointerUrl, { signal: AbortSignal.timeout(20000) });
  const pointer = Buffer.from(await pointerResponse.arrayBuffer());
  if (pointerResponse.status !== 200 || pointerResponse.headers.get('content-type')?.includes('text/plain') !== true
      || sha(pointer) !== '1008abf8547aae287218e6dd8dc85c10d9c0211792c0a33a26c8a9a3b01dedf0'
      || !pointer.toString('utf8').includes(`mrf-url: ${pointerFileUrl}`)
      || !pointer.toString('utf8').includes(`source-page-url: ${sourcePageUrl}`))
    throw new Error('Bristol root pointer changed; manual review required');

  const oldResponse = await fetch(pointerFileUrl, { method: 'HEAD', signal: AbortSignal.timeout(20000) });
  if (oldResponse.status !== 404) throw new Error('Bristol pointer target status changed');
  const fileResponse = await fetch(pageFileUrl, {
    headers: { Range: 'bytes=0-262143' }, signal: AbortSignal.timeout(30000),
  });
  const bytes = Buffer.from(await fileResponse.arrayBuffer());
  if (fileResponse.status !== 206 || fileResponse.headers.get('content-range') !== 'bytes 0-262143/51435986'
      || bytes.length !== 262144) throw new Error('Bristol bounded file request changed');
  const prefix = bytes.toString('utf8', 0, 2000);
  if (!prefix.includes('hospital_name,last_updated_on,version,location_name,hospital_address,license_number|CT')
      || !prefix.includes('"Bristol Hospital, Inc",2026-08-27,3.0.0,Bristol Hospital,"41 Brewster Rd, Bristol, CT 06010"'))
    throw new Error('Bristol file identity/metadata changed');

  const sampleHash = sha(bytes);
  const sampleRelative = `cms_data/hpt/nationwide-verification/file-byte-proof/${sampleHash}.bin`;
  const samplePath = path.join(root, sampleRelative);
  fs.mkdirSync(path.dirname(samplePath), { recursive: true });
  if (fs.existsSync(samplePath) && sha(fs.readFileSync(samplePath)) !== sampleHash)
    throw new Error('Existing Bristol byte sample changed');
  if (!fs.existsSync(samplePath)) fs.writeFileSync(samplePath, bytes);

  const observedAt = new Date().toISOString();
  const proof = {
    ccn: '070029', roster_name: 'BRISTOL HOSPITAL', roster_address: '41 BREWSTER RD',
    roster_city: 'BRISTOL', roster_state: 'CT', roster_zip: '06010',
    official_domain: 'bristolhealth.org',
    identity_url: 'https://www.bristolhealth.org/about-us/bristol-hospital',
    pointer_url: pointerUrl, pointer_final_url: pointerResponse.url,
    pointer_http_status: pointerResponse.status, pointer_sha256: sha(pointer),
    pointer_mrf_url: pointerFileUrl, pointer_mrf_http_status: oldResponse.status,
    source_page_url: sourcePageUrl,
    rendered_source_url: 'https://search.hospitalpriceindex.com/hpi2/machineReadable/bristolhospital/7807or',
    rendered_source_heading: 'Bristol Hospital', rendered_source_update: '2026-08-27',
    rendered_source_download_url: pageFileUrl,
    current_mrf_url: pageFileUrl, current_mrf_http_status: fileResponse.status,
    current_mrf_content_range: fileResponse.headers.get('content-range'),
    current_mrf_sha256: sampleHash, retained_bytes: bytes.length, retained_sample: sampleRelative,
    declared_hospital_name: 'Bristol Hospital, Inc', declared_location_name: 'Bristol Hospital',
    declared_address: '41 Brewster Rd, Bristol, CT 06010', declared_state: 'CT',
    declared_date: '2026-08-27', version: '3.0.0', observed_at: observedAt,
    next_action: 'Ask the publisher to update the Bristol root pointer to the working page CSV; then recheck the exact pointer target and validate the complete CSV structure and rates.',
  };
  const evidence = {
    identity: 'corroborated', identity_basis: 'first-party-Bristol-campus-root-pointer-rendered-source-page-and-retained-file-header',
    pointerUrl, pointerSha256: proof.pointer_sha256, pointerHttpStatus: 200,
    pointerMrfUrl: pointerFileUrl, pointerMrfHttpStatus: 404,
    url: pageFileUrl, fileSha256: sampleHash, bytesRetained: bytes.length,
    http_status: 206, checked_at: observedAt, date: proof.declared_date, version: proof.version,
    officialDomain: proof.official_domain, location_name: proof.declared_location_name,
    declared_hospital_name: proof.declared_hospital_name, declared_address: proof.declared_address,
    declared_license_state: 'CT', file_kind: 'csv', identityPageUrl: proof.identity_url,
    sourcePageUrl, browserSourceHeading: proof.rendered_source_heading,
    browserSourceObservedAt: observedAt,
    observedFinding: 'pointer-links-unavailable-mrf-source-page-current-file',
    pointerIssue: 'pointer-mrf-http-error-current-source-page-file', next_action: proof.next_action,
  };
  const entry = {
    ccn: '070029', base, action: 'replace-observation', evidence,
    evidence_run: 'bristol-hpi-pointer-page-mismatch-2026-09-17', reviewed_at: observedAt,
    note: 'Bristol first-party hospital page identifies the 41 Brewster Road CT campus. The current root pointer names Bristol Hospital but its comma-containing CSV URL returns 404. The rendered source page links a different readable CSV; its retained bounded header declares the matching Bristol campus, CT, 2026-08-27 and v3.0.0. The page CSV is not a working pointer target. Complete-file structure, rate values, and legal compliance are not established.',
  };
  const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
  const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  if (ledger.some(row => row.ccn === '070029')) throw new Error('Bristol already has a reviewed resolution');
  fs.writeFileSync(path.join(audit, 'reconciliation-bristol-page-file-proof.json'), JSON.stringify(proof, null, 2) + '\n');
  ledger.push(entry);
  ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
  fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
  console.log(JSON.stringify({ ccn: '070029', sampleHash, finding: evidence.observedFinding }));
}

main().catch(error => { console.error(error); process.exitCode = 1; });
