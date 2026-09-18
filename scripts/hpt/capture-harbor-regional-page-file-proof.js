'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cheerio = require('cheerio');
const { retrieve, parsePayload } = require('./lib/recovery-transport');
const { csvToObjects } = require('./lib/util');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const identityUrl = 'https://www.ghcares.org/contact-us/';
const pointerUrl = 'https://ghcares.org/cms-hpt.txt';
const pageUrl = 'https://www.ezcost.info/Grays-Harbor-Community-Hospital';
const oldUrl = 'http://machine-readable-files.com/harbor-regional-health/910568304_Harbor-Regional-Health_standardcharges.csv';
const currentUrl = 'https://hospitalpricetransparencyfiles.com/grays-harbor-community-hospital/910568304_Grays-Harbor-Community-Hospital_standardcharges.csv';

async function main() {
  const [identityPage, pointer, page, oldFile, currentFile] = await Promise.all([
    retrieve(identityUrl, 262144, { timeoutMs: 30000 }),
    retrieve(pointerUrl, 65536, { timeoutMs: 30000 }),
    retrieve(pageUrl, 262144, { timeoutMs: 30000 }),
    retrieve(oldUrl, 65536, { timeoutMs: 30000 }),
    retrieve(currentUrl, 262144, { timeoutMs: 30000 }),
  ]);
  const identityText = cheerio.load(identityPage.body.toString('utf8')).text().replace(/\s+/g, ' ');
  const pointerText = pointer.body.toString('utf8');
  const $ = cheerio.load(page.body.toString('utf8'));
  const pageLinks = $('a[href]').map((_, a) => {
    try { return new URL($(a).attr('href'), pageUrl).href; } catch { return ''; }
  }).get().filter(url => url === currentUrl);
  const header = (await parsePayload(currentFile.body, 'text/csv')).parsed
    .find(item => item.innerKind === 'csv' && item.mrfLocationName === 'Harbor Regional Health');
  const roster = JSON.parse(fs.readFileSync(path.join(root, 'cms_data/hpt/roster.json'), 'utf8'))
    .find(row => row.ccn === '500031');
  const base = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8'))
    .find(row => row.ccn === '500031');
  if (!base || base.finding !== 'mrf-url-unreachable' || base.mrf_url !== oldUrl
      || base.domain !== 'ghcares.org' || !roster || roster.address !== '915 ANDERSON DRIVE'
      || roster.city !== 'ABERDEEN' || roster.state !== 'WA' || roster.zip !== '98520'
      || ![200, 206].includes(identityPage.status) || !identityText.includes('Harbor Regional Health Community Hospital')
      || !identityText.includes('915 Anderson Dr.') || !identityText.includes('Aberdeen, WA 98520')
      || ![200, 206].includes(pointer.status) || page.status !== 200 || oldFile.status !== 404
      || currentFile.status !== 206 || currentFile.body.length !== 262144
      || !pointerText.includes('location-name: Grays Harbor Community Hospital - dba Harbor Regional Health')
      || !pointerText.includes(`source-page-url: ${pageUrl}`)
      || !pointerText.includes(`mrf-url: ${oldUrl}`) || pageLinks.length !== 1
      || header?.mrfHospitalName !== 'Grays Harbor Community Hospital'
      || header.mrfAddress !== '915 Anderson Drive, Aberdeen, WA 98520'
      || header.mrfLicenseState !== 'WA' || header.declaredLastUpdated !== '2025-11-21'
      || header.cmsVersion !== '3.0.0') throw new Error('Harbor pointer/page/file proof changed');
  const sampleDir = path.join(root, 'cms_data/hpt/nationwide-verification/file-byte-proof');
  fs.mkdirSync(sampleDir, { recursive: true });
  const samplePath = path.join(sampleDir, `${currentFile.sha256}.bin`);
  fs.writeFileSync(samplePath, currentFile.body);
  const proof = {
    ccn: '500031', official_domain: 'ghcares.org', identity_page_url: identityUrl,
    identity_page_sha256: identityPage.sha256, source_page_url: pageUrl,
    source_page_sha256: page.sha256, pointer_url: pointerUrl,
    pointer_http_status: pointer.status, pointer_sha256: pointer.sha256,
    pointer_mrf_url: oldUrl, pointer_mrf_http_status: oldFile.status,
    current_mrf_url: currentUrl, current_mrf_http_status: currentFile.status,
    current_mrf_sha256: currentFile.sha256, retained_bytes: currentFile.body.length,
    file_total_bytes: 7912828, retained_sample: path.relative(root, samplePath).replaceAll('\\', '/'),
    declared_hospital_name: header.mrfHospitalName, declared_location_name: header.mrfLocationName,
    declared_address: header.mrfAddress, declared_state: header.mrfLicenseState,
    declared_date: header.declaredLastUpdated, version: header.cmsVersion,
    observed_at: currentFile.checkedAt,
    next_action: 'Publisher should replace the 404 root-pointer target with the current page-linked Grays Harbor CSV. Independently validate the complete file; the retained header establishes identity and metadata only.',
  };
  fs.writeFileSync(path.join(audit, 'reconciliation-harbor-regional-page-file-proof.json'), JSON.stringify(proof, null, 2) + '\n');
  if (crypto.createHash('sha256').update(fs.readFileSync(samplePath)).digest('hex') !== currentFile.sha256)
    throw new Error('Harbor retained sample hash mismatch');
  const evidence = {
    identity: 'corroborated',
    identity_basis: 'first-party-contact-page-and-pointer-source-page-file-agree-with-exact-roster-street-city-zip-state',
    pointerUrl, pointerSha256: pointer.sha256, pointerHttpStatus: pointer.status,
    pointerMrfUrl: oldUrl, pointerMrfHttpStatus: oldFile.status,
    url: currentUrl, fileSha256: currentFile.sha256, http_status: currentFile.status,
    checked_at: currentFile.checkedAt, date: proof.declared_date, version: proof.version,
    officialDomain: 'ghcares.org', location_name: proof.declared_location_name,
    declared_hospital_name: proof.declared_hospital_name, declared_address: proof.declared_address,
    declared_license_state: proof.declared_state, file_kind: 'csv',
    sourcePageUrl: pageUrl, sourcePageSha256: page.sha256,
    identityPageUrl: identityUrl, identityPageSha256: identityPage.sha256,
    observedFinding: 'pointer-links-unavailable-mrf-source-page-current-file',
    pointerIssue: 'pointer-mrf-http-error-current-source-page-file', next_action: proof.next_action,
  };
  const entry = { ccn: '500031', base, action: 'replace-observation', evidence,
    evidence_run: 'harbor-regional-page-file-2026-09-16', reviewed_at: currentFile.checkedAt,
    note: 'The live Grays Harbor/Harbor Regional root pointer names a 404 CSV. Its declared EZCOST page instead links a different readable CSV whose retained 262,144-byte header declares Grays Harbor Community Hospital/Harbor Regional Health at the exact Aberdeen roster address, Washington state, 2025-11-21 and CMS v3.0.0. The first-party contact page confirms the address and current Harbor brand. The page file is not the working pointer target; complete-file validity and legal compliance have not been established.' };
  const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
  const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  const old = ledger.find(row => row.ccn === entry.ccn);
  if (old && (old.evidence_run !== entry.evidence_run
      || JSON.stringify(old.evidence) !== JSON.stringify(entry.evidence)))
    throw new Error('Existing nonmatching Harbor resolution');
  if (!old) {
    ledger.push(entry);
    ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
    fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
  }
  console.log(JSON.stringify({ applied: !old, ccn: entry.ccn, pointer_target_status: oldFile.status,
    page_file_status: currentFile.status, sample_sha256: currentFile.sha256 }));
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
