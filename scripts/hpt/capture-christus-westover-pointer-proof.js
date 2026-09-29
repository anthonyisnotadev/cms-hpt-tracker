'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cheerio = require('cheerio');
const { retrieve, parsePayload } = require('./lib/recovery-transport');
const { csvToObjects } = require('./lib/util');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const pointerUrl = 'https://christushealth.org/cms-hpt.txt';
const sourcePageUrl = 'https://www.christushealth.org/plan-care/bill-pay/pricing-transparency';
const identityPageUrl = 'https://www.christushealth.org/locations/santa-rosa-hospital-westover-hills';
const oldUrl = 'https://www.christushealth.org/-/media/christus-health/plan-care/files/bill-pay/machine-readable-files/741109665_santarosahospitalmedicalcenter_standardcharges.json';
const currentUrl = 'https://www.christushealth.org/-/media/christus-health/plan-care/files/bill-pay/machine-readable-files/741109665_santarosahospitalwestoverhills_standardcharges.json';
const pageUrl = currentUrl.replace(/\.json$/, '.ashx');

async function main() {
  const [pointer, sourcePage, identityPage, oldFile, currentFile, pageFile] = await Promise.all([
    retrieve(pointerUrl, 65536, { timeoutMs: 30000 }),
    retrieve(sourcePageUrl, 262144, { timeoutMs: 30000 }),
    retrieve(identityPageUrl, 262144, { timeoutMs: 30000 }),
    retrieve(oldUrl, 65536, { timeoutMs: 30000 }),
    retrieve(currentUrl, 262144, { timeoutMs: 30000 }),
    retrieve(pageUrl, 262144, { timeoutMs: 30000 }),
  ]);
  const pointerText = pointer.body.toString('utf8');
  const identityText = cheerio.load(identityPage.body.toString('utf8'))('body').text().replace(/\s+/g, ' ');
  const $ = cheerio.load(sourcePage.body.toString('utf8'));
  const pageLinks = $('a[href]').map((_, a) => {
    try { return new URL($(a).attr('href'), sourcePageUrl).href; } catch { return ''; }
  }).get().filter(url => url === pageUrl);
  const header = (await parsePayload(currentFile.body, 'application/json')).parsed
    .find(item => item.innerKind === 'json' && item.mrfLocationName === 'Santa Rosa Hospital - Westover Hills');
  const rosterRaw = JSON.parse(fs.readFileSync(path.join(root, 'cms_data/hpt/roster.json'), 'utf8'));
  const roster = (Array.isArray(rosterRaw) ? rosterRaw : rosterRaw.records || rosterRaw.hospitals || [])
    .find(row => row.ccn === '450237');
  const base = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8'))
    .find(row => row.ccn === '450237');
  if (!base || base.finding !== 'mrf-url-unreachable' || base.mrf_url !== oldUrl
      || !roster || roster.address !== '11212 State Hwy 151' || roster.city !== 'SAN ANTONIO'
      || roster.state !== 'TX' || roster.zip !== '78251'
      || ![200, 206].includes(pointer.status) || ![200, 206].includes(sourcePage.status)
      || ![200, 206].includes(identityPage.status) || oldFile.status !== 404
      || currentFile.status !== 206 || pageFile.status !== 206
      || currentFile.body.length !== 262144 || pageFile.body.length !== 262144
      || currentFile.sha256 !== pageFile.sha256 || pageLinks.length !== 1
      || !pointerText.includes('location-name: CHRISTUS Santa Rosa Hospital - Westover Hills')
      || !pointerText.includes(`mrf-url: ${currentUrl}`)
      || !pointerText.includes('location-name: CHRISTUS Santa Rosa Hospital - Medical Center')
      || !pointerText.includes(`mrf-url: ${oldUrl}`)
      || !identityText.includes('11212 State Highway 151')
      || header?.mrfHospitalName !== 'Santa Rosa Hospital - Westover Hills'
      || header.mrfAddress !== '11212 TX-151, San Antonio, TX 78251'
      || header.mrfLicenseState !== 'TX' || header.declaredLastUpdated !== '2026-01-13'
      || header.cmsVersion !== '3.0.0') throw new Error('CHRISTUS Westover pointer/file identity proof changed');
  const sampleDir = path.join(root, 'cms_data/hpt/nationwide-verification/file-byte-proof');
  fs.mkdirSync(sampleDir, { recursive: true });
  const samplePath = path.join(sampleDir, `${currentFile.sha256}.bin`);
  fs.writeFileSync(samplePath, currentFile.body);
  const sample = fs.readFileSync(samplePath);
  if (crypto.createHash('sha256').update(sample).digest('hex') !== currentFile.sha256)
    throw new Error('CHRISTUS Westover sample hash mismatch');
  const proof = {
    ccn: '450237', pointer_url: pointerUrl, pointer_sha256: pointer.sha256,
    pointer_http_status: pointer.status, source_page_url: sourcePageUrl,
    source_page_sha256: sourcePage.sha256, identity_page_url: identityPageUrl,
    identity_page_sha256: identityPage.sha256, previous_assigned_mrf_url: oldUrl,
    previous_assigned_mrf_http_status: oldFile.status,
    current_pointer_entry_location_name: 'CHRISTUS Santa Rosa Hospital - Westover Hills',
    current_mrf_url: currentUrl, current_mrf_http_status: currentFile.status,
    current_mrf_sha256: currentFile.sha256, source_page_file_url: pageUrl,
    source_page_file_sha256: pageFile.sha256, retained_bytes: currentFile.body.length,
    retained_sample: path.relative(root, samplePath).replaceAll('\\', '/'),
    declared_hospital_name: header.mrfHospitalName, declared_location_name: header.mrfLocationName,
    declared_address: header.mrfAddress, declared_state: header.mrfLicenseState,
    declared_date: header.declaredLastUpdated, version: header.cmsVersion,
    observed_at: currentFile.checkedAt,
    closure_context: 'CHRISTUS reported that its separate 2827 Babcock Medical Center campus closed in April 2025; the CCN 450237 roster address and current live facility evidence identify Westover Hills at 11212 State Highway 151. Do not treat the entire CCN as closed.',
    next_action: 'Retain the Babcock closure as campus history, verify any future publisher pointer changes, and separately validate the complete Westover Hills MRF; the retained header proves current pointer linkage and facility metadata, not full-file validity.',
  };
  fs.writeFileSync(path.join(audit, 'reconciliation-christus-westover-pointer-proof.json'),
    JSON.stringify(proof, null, 2) + '\n');
  const evidence = {
    identity: 'corroborated', identity_basis: 'live-pointer-Westover-entry-retained-file-header-exact-roster-address-and-first-party-location-page',
    pointerUrl, pointerSha256: pointer.sha256, pointerHttpStatus: pointer.status,
    url: currentUrl, fileSha256: currentFile.sha256, http_status: currentFile.status,
    checked_at: currentFile.checkedAt, date: proof.declared_date, version: proof.version,
    officialDomain: 'christushealth.org', location_name: proof.declared_location_name,
    declared_hospital_name: proof.declared_hospital_name, declared_address: proof.declared_address,
    declared_license_state: proof.declared_state, file_kind: 'json',
    sourcePageUrl, sourcePageSha256: sourcePage.sha256,
    identityPageUrl, identityPageSha256: identityPage.sha256,
    previousAssignedUrl: oldUrl, previousAssignedHttpStatus: oldFile.status,
    sourcePageFileUrl: pageUrl, sourcePageFileSha256: pageFile.sha256,
    next_action: proof.next_action,
  };
  const entry = { ccn: '450237', base, action: 'replace', evidence,
    evidence_run: 'christus-westover-pointer-identity-2026-09-16', reviewed_at: currentFile.checkedAt,
    note: 'The old generic assignment selected the closed Babcock Medical Center entry by name despite the CCN roster address at 11212 State Highway 151. The same current root pointer has a distinct Westover Hills entry whose directly retrieved JSON matches the roster address, Texas state, 2026-01-13 and CMS v3.0.0; the first-party pricing-page .ashx variant returned an identical bounded header sample. This is a current pointer-linked Westover observation, not a complete-file or legal compliance validation.' };
  const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
  const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  const existing = ledger.find(row => row.ccn === entry.ccn);
  if (existing && (existing.evidence_run !== entry.evidence_run
      || JSON.stringify(existing.evidence) !== JSON.stringify(entry.evidence)))
    throw new Error('Existing nonmatching CHRISTUS Westover resolution');
  if (!existing) {
    ledger.push(entry);
    ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
    fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
  }
  console.log(JSON.stringify({ applied: !existing, ccn: entry.ccn,
    former_assigned_status: oldFile.status, current_status: currentFile.status,
    current_sha256: currentFile.sha256 }));
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
