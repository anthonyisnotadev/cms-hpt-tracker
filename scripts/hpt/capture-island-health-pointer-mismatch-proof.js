'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cheerio = require('cheerio');
const { retrieve, parsePayload } = require('./lib/recovery-transport');
const { csvToObjects } = require('./lib/util');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const pointerUrl = 'https://islandhospital.org/cms-hpt.txt';
const pageUrl = 'https://islandhealth.org/pricing/';
const oldUrl = 'https://mrfs.hyvehealthcare.com/IslandHealthSystem/910729255_island-health_standardcharges.csv';
const currentUrl = 'https://mrfs.hyvehealthcare.com/IslandHealthSystem/910729255_public-hospital-district-no-2-skagit-county-washington_standardcharges.csv';

async function main() {
  const [pointer, page, oldFile, currentFile] = await Promise.all([
    retrieve(pointerUrl, 65536, { timeoutMs: 30000 }),
    retrieve(pageUrl, 262144, { timeoutMs: 30000 }),
    retrieve(oldUrl, 65536, { timeoutMs: 30000, curlOnStatuses: [404] }),
    retrieve(currentUrl, 262144, { timeoutMs: 30000 }),
  ]);
  const pointerText = pointer.body.toString('utf8');
  const $ = cheerio.load(page.body.toString('utf8'));
  const pageLinks = $('a[href]').map((_, a) => {
    try { return new URL($(a).attr('href'), pageUrl).href; } catch { return ''; }
  }).get().filter(url => url === currentUrl);
  const header = (await parsePayload(currentFile.body, 'text/csv')).parsed
    .find(item => item.innerKind === 'csv' && item.mrfLocationName === 'Island Health');
  const rosterRaw = JSON.parse(fs.readFileSync(path.join(root, 'cms_data/hpt/roster.json'), 'utf8'));
  const roster = (Array.isArray(rosterRaw) ? rosterRaw : rosterRaw.records || rosterRaw.hospitals || [])
    .find(row => row.ccn === '500007');
  const base = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8'))
    .find(row => row.ccn === '500007');
  if (!base || base.finding !== 'mrf-url-unreachable' || base.mrf_url !== oldUrl
      || base.domain !== 'islandhospital.org' || !roster || roster.address !== '1211  24TH STREET'
      || roster.city !== 'ANACORTES' || roster.state !== 'WA' || roster.zip !== '98221'
      || pointer.status !== 200 || page.status !== 200 || oldFile.status !== 404
      || currentFile.status !== 206 || currentFile.body.length !== 262144
      || !pointerText.includes('location-name: Island Health')
      || !pointerText.includes(`mrf-url: ${oldUrl}`) || pageLinks.length !== 1
      || header?.mrfHospitalName !== 'Public Hospital District NO 2 Skagit County Washington'
      || header.mrfAddress !== '1211 24th St, Anacortes, WA 98221'
      || header.mrfLicenseState !== 'WA' || header.declaredLastUpdated !== '2026-06-04'
      || header.cmsVersion !== '3.0.0') throw new Error('Island Health pointer/page/file proof changed');
  const sampleDir = path.join(root, 'cms_data/hpt/nationwide-verification/file-byte-proof');
  fs.mkdirSync(sampleDir, { recursive: true });
  const samplePath = path.join(sampleDir, `${currentFile.sha256}.bin`);
  fs.writeFileSync(samplePath, currentFile.body);
  const proof = {
    ccn: '500007', official_domain: 'islandhealth.org', pointer_domain: 'islandhospital.org',
    source_page_url: pageUrl, source_page_sha256: page.sha256,
    pointer_url: pointerUrl, pointer_http_status: pointer.status, pointer_sha256: pointer.sha256,
    pointer_mrf_url: oldUrl, pointer_mrf_http_status: oldFile.status,
    current_mrf_url: currentUrl, current_mrf_http_status: currentFile.status,
    current_mrf_sha256: currentFile.sha256, retained_bytes: currentFile.body.length,
    retained_sample: path.relative(root, samplePath).replaceAll('\\', '/'),
    declared_hospital_name: header.mrfHospitalName, declared_location_name: header.mrfLocationName,
    declared_address: header.mrfAddress, declared_state: header.mrfLicenseState,
    declared_date: header.declaredLastUpdated, version: header.cmsVersion,
    observed_at: currentFile.checkedAt,
    next_action: 'Confirm that the publisher updates the root pointer to the current page-linked Island Health CSV. Separately validate the complete file; the retained sample establishes root identity and metadata, not full-file validity.',
  };
  fs.writeFileSync(path.join(audit, 'reconciliation-island-health-pointer-mismatch-proof.json'),
    JSON.stringify(proof, null, 2) + '\n');
  const sample = fs.readFileSync(samplePath);
  if (sample.length !== proof.retained_bytes
      || crypto.createHash('sha256').update(sample).digest('hex') !== proof.current_mrf_sha256)
    throw new Error('Island Health retained sample hash mismatch');
  const evidence = {
    identity: 'corroborated',
    identity_basis: 'current-first-party-pricing-page-and-retained-file-location-address-state-with-exact-roster-address',
    pointerUrl, pointerSha256: pointer.sha256, pointerHttpStatus: pointer.status,
    pointerMrfUrl: oldUrl, pointerMrfHttpStatus: oldFile.status,
    url: currentUrl, fileSha256: currentFile.sha256, http_status: currentFile.status,
    checked_at: currentFile.checkedAt, date: proof.declared_date, version: proof.version,
    officialDomain: 'islandhealth.org', location_name: proof.declared_location_name,
    declared_hospital_name: proof.declared_hospital_name, declared_address: proof.declared_address,
    declared_license_state: proof.declared_state, file_kind: 'csv',
    sourcePageUrl: pageUrl, sourcePageSha256: page.sha256,
    observedFinding: 'pointer-links-unavailable-mrf-source-page-current-file',
    pointerIssue: 'pointer-mrf-http-error-current-source-page-file', next_action: proof.next_action,
  };
  const entry = { ccn: '500007', base, action: 'replace-observation', evidence,
    evidence_run: 'island-health-pointer-page-mismatch-2026-09-16', reviewed_at: currentFile.checkedAt,
    note: 'The live Island Health root pointer names a 404 CSV. The first-party pricing page links a different 2026 CSV whose retained 262,144-byte header declares Public Hospital District No. 2, Island Health at the exact Anacortes roster address, Washington license state and CMS v3.0.0. The publisher naming difference is preserved. The page file is not the current pointer target and has not been validated end to end.' };
  const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
  const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  const old = ledger.find(row => row.ccn === entry.ccn);
  if (old && (old.evidence_run !== entry.evidence_run
      || JSON.stringify(old.evidence) !== JSON.stringify(entry.evidence)))
    throw new Error('Existing nonmatching Island Health resolution');
  if (!old) {
    ledger.push(entry);
    ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
    fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
  }
  console.log(JSON.stringify({ applied: !old, ccn: entry.ccn, pointer_target_status: oldFile.status,
    page_file_status: currentFile.status, sample_sha256: currentFile.sha256 }));
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
