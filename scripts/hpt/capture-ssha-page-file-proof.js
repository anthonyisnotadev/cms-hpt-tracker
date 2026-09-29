'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cheerio = require('cheerio');
const { retrieve, parsePayload } = require('./lib/recovery-transport');
const { csvToObjects } = require('./lib/util');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const siteUrl = 'https://ssha.us.com/';
const pointerUrl = 'https://ssha.us.com/cms-hpt.txt';
const pageUrl = 'https://ezcost.info/ssha-pasadena-tx/';
const oldUrl = 'https://machine-readable-files.com/ssha-pasadena-tx/760600805_Surgery-Specialty-Hospitals-of-America_standardcharges.csv';
const currentUrl = 'https://hospitalpricetransparencyfiles.com/vista-community-medical-center-llp/760600805_Vista-Community-Medical-Center-LLP_standardcharges.csv';
const stateRosterUrl = 'https://pfd.hhs.texas.gov/sites/default/files/documents/hospital-svcs/2025/2025-ffy-sda-verif.pdf';

async function main() {
  const [site, pointer, page, oldFile, currentFile] = await Promise.all([
    retrieve(siteUrl, 262144, { timeoutMs: 30000 }),
    retrieve(pointerUrl, 65536, { timeoutMs: 30000 }),
    retrieve(pageUrl, 262144, { timeoutMs: 30000 }),
    retrieve(oldUrl, 65536, { timeoutMs: 30000 }),
    retrieve(currentUrl, 262144, { timeoutMs: 30000 }),
  ]);
  const siteText = cheerio.load(site.body.toString('utf8')).text().replace(/\s+/g, ' ');
  const pointerText = pointer.body.toString('utf8');
  const $ = cheerio.load(page.body.toString('utf8'));
  const pageLinks = $('a[href]').map((_, a) => {
    try { return new URL($(a).attr('href'), pageUrl).href; } catch { return ''; }
  }).get().filter(url => url === currentUrl);
  const header = (await parsePayload(currentFile.body, 'text/csv')).parsed
    .find(item => item.innerKind === 'csv' && item.mrfLocationName === 'Surgery Specialty Hospitals of America');
  const roster = JSON.parse(fs.readFileSync(path.join(root, 'cms_data/hpt/roster.json'), 'utf8'))
    .find(row => row.ccn === '450831');
  const base = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8'))
    .find(row => row.ccn === '450831');
  if (!base || base.finding !== 'mrf-url-unreachable' || base.mrf_url !== oldUrl
      || base.domain !== 'ssha.us.com' || !roster || roster.address !== '4301 B VISTA'
      || roster.city !== 'PASADENA' || roster.state !== 'TX' || roster.zip !== '77504'
      || site.status !== 200 || !siteText.includes('4301 Vista Road Pasadena, TX 77504')
      || !site.body.toString('utf8').includes('ezcost.info/ssha-pasadena-tx')
      || ![200, 206].includes(pointer.status) || page.status !== 200 || oldFile.status !== 404
      || currentFile.status !== 206 || currentFile.body.length !== 79220
      || currentFile.headers?.['content-range'] !== 'bytes 0-79219/79220'
      || !pointerText.includes('location-name: Surgery Specialty Hospitals of America')
      || !pointerText.includes(`mrf-url: ${oldUrl}`) || pageLinks.length !== 1
      || header?.mrfHospitalName !== 'Vista Community Medical Center LLP'
      || header.mrfAddress !== '4301 Vista Road, Pasadena, TX 77504'
      || header.mrfLicenseState !== 'TX' || header.declaredLastUpdated !== '2026-01-22'
      || header.cmsVersion !== '3.0.0') throw new Error('SSHA pointer/page/file proof changed');
  const sampleDir = path.join(root, 'cms_data/hpt/nationwide-verification/file-byte-proof');
  fs.mkdirSync(sampleDir, { recursive: true });
  const samplePath = path.join(sampleDir, `${currentFile.sha256}.bin`);
  fs.writeFileSync(samplePath, currentFile.body);
  const proof = {
    ccn: '450831', official_domain: 'ssha.us.com', identity_page_url: siteUrl,
    identity_page_sha256: site.sha256, state_ccn_roster_url: stateRosterUrl,
    state_ccn_roster_observation: 'Texas HHSC identifies CCN 450831, Vista Community Medical Center LLP - Surgery Specialty Hospital of America SE Houston, at 4301 Vista Rd, Pasadena TX 77504.',
    cms_roster_address: roster.address, roster_address_difference: 'The CMS roster retains an unexplained B between street number and Vista; first-party site, file and Texas HHSC roster use 4301 Vista Road.',
    source_page_url: pageUrl, source_page_sha256: page.sha256,
    pointer_url: pointerUrl, pointer_http_status: pointer.status, pointer_sha256: pointer.sha256,
    pointer_mrf_url: oldUrl, pointer_mrf_http_status: oldFile.status,
    current_mrf_url: currentUrl, current_mrf_http_status: currentFile.status,
    current_mrf_sha256: currentFile.sha256, file_total_bytes: 79220,
    retained_sample: path.relative(root, samplePath).replaceAll('\\', '/'),
    declared_hospital_name: header.mrfHospitalName, declared_location_name: header.mrfLocationName,
    declared_address: header.mrfAddress, declared_state: header.mrfLicenseState,
    declared_date: header.declaredLastUpdated, version: header.cmsVersion,
    observed_at: currentFile.checkedAt,
    next_action: 'Publisher should update the root pointer to the current page-linked Vista Community Medical Center CSV. Reconcile the historical CMS roster B suffix separately and validate the full CSV schema/content; this observation does not establish legal compliance.',
  };
  fs.writeFileSync(path.join(audit, 'reconciliation-ssha-page-file-proof.json'), JSON.stringify(proof, null, 2) + '\n');
  if (crypto.createHash('sha256').update(fs.readFileSync(samplePath)).digest('hex') !== currentFile.sha256)
    throw new Error('SSHA retained file hash mismatch');
  const evidence = {
    identity: 'corroborated',
    identity_basis: 'first-party-site-and-page-file-agree-with-texas-hhsc-exact-ccn-location-name-street-city-zip-state',
    pointerUrl, pointerSha256: pointer.sha256, pointerHttpStatus: pointer.status,
    pointerMrfUrl: oldUrl, pointerMrfHttpStatus: oldFile.status,
    url: currentUrl, fileSha256: currentFile.sha256, http_status: currentFile.status,
    checked_at: currentFile.checkedAt, date: proof.declared_date, version: proof.version,
    officialDomain: 'ssha.us.com', location_name: proof.declared_location_name,
    declared_hospital_name: proof.declared_hospital_name, declared_address: proof.declared_address,
    declared_license_state: proof.declared_state, file_kind: 'csv',
    sourcePageUrl: pageUrl, sourcePageSha256: page.sha256,
    identityPageUrl: siteUrl, identityPageSha256: site.sha256, stateCcnRosterUrl: stateRosterUrl,
    observedFinding: 'pointer-links-unavailable-mrf-source-page-current-file',
    pointerIssue: 'pointer-mrf-http-error-current-source-page-file', next_action: proof.next_action,
  };
  const entry = { ccn: '450831', base, action: 'replace-observation', evidence,
    evidence_run: 'ssha-page-file-2026-09-16', reviewed_at: currentFile.checkedAt,
    note: 'The live SSHA root pointer names a 404 CSV, while the first-party-linked pricing page names a different readable Vista Community Medical Center LLP CSV. Its full 79,220 bytes declare the SSHA location at 4301 Vista Road, Pasadena TX 77504, Texas license state, 2026-01-22 and CMS v3.0.0. Texas HHSC independently assigns that same legal/facility identity and address to CCN 450831. The CMS roster instead says 4301 B VISTA; this discrepancy remains explicit. The current file is not the pointer target, and full schema/content or legal compliance has not been validated.' };
  const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
  const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  const old = ledger.find(row => row.ccn === entry.ccn);
  if (old && (old.evidence_run !== entry.evidence_run
      || JSON.stringify(old.evidence) !== JSON.stringify(entry.evidence)))
    throw new Error('Existing nonmatching SSHA resolution');
  if (!old) {
    ledger.push(entry);
    ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
    fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
  }
  console.log(JSON.stringify({ applied: !old, ccn: entry.ccn, pointer_target_status: oldFile.status,
    page_file_status: currentFile.status, file_bytes: currentFile.body.length, file_sha256: currentFile.sha256 }));
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
