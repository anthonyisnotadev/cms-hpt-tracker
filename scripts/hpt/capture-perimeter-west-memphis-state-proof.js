'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cheerio = require('cheerio');
const { retrieve, parsePayload } = require('./lib/recovery-transport');
const { csvToObjects } = require('./lib/util');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const pointerUrl = 'https://www.perimeterhealthcare.com/cms-hpt.txt';
const identityUrl = 'https://www.perimeterhealthcare.com/west-memphis';
const fileUrl = 'https://www.perimeterhealthcare.com/west-memphis/461030276_Woodridge-of-West-Memphis-LLC_standardcharges.csv';
const arkansasSource = 'https://cdm16039.contentdm.oclc.org/digital/api/collection/p266101coll7/id/70649/download';

async function main() {
  const [pointer, page, file] = await Promise.all([
    retrieve(pointerUrl, 65536, { timeoutMs: 30000 }),
    retrieve(identityUrl, 262144, { timeoutMs: 30000 }),
    retrieve(fileUrl, 65536, { timeoutMs: 30000 }),
  ]);
  const pointerText = pointer.body.toString('utf8');
  const pageText = cheerio.load(page.body.toString('utf8'))('body').text().replace(/\s+/g, ' ');
  const header = (await parsePayload(file.body, 'text/csv')).parsed.find(item => item.innerKind === 'csv');
  const roster = JSON.parse(fs.readFileSync(path.join(root, 'cms_data/hpt/roster.json'), 'utf8'))
    .find(row => row.ccn === '044021');
  const base = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8'))
    .find(row => row.ccn === '044021');
  if (!base || base.finding !== 'not-assessed-not-named-in-file'
      || base.pointer_url !== 'https://perimeterhealthcare.com/cms-hpt.txt'
      || !roster || roster.address !== '600 NORTH 7TH STREET' || roster.city !== 'WEST MEMPHIS'
      || roster.state !== 'AR' || roster.zip !== '72301'
      || ![200, 206].includes(pointer.status) || ![200, 206].includes(page.status)
      || file.status !== 206 || file.body.length !== 4029
      || !pointerText.includes('location-name: Woodridge of West Memphis LLC')
      || !pointerText.includes(`mrf-url: ${fileUrl}`)
      || !/Perimeter Behavioral (?:Hospital )?of West Memphis/i.test(pageText)
      || !/600 North 7th St/i.test(pageText)
      || header?.mrfHospitalName !== 'Woodridge of West Memphis LLC'
      || header.mrfLocationName !== 'West Memphis AR'
      || header.mrfAddress !== '600 North 7th Street, West Memphis 72301'
      || header.mrfLicenseState !== 'TX' || header.declaredLastUpdated !== '2026-03-30'
      || header.cmsVersion !== '3.0.0')
    throw new Error('West Memphis pointer, first-party page, roster or CSV proof changed');
  const sampleDir = path.join(root, 'cms_data/hpt/nationwide-verification/file-byte-proof');
  fs.mkdirSync(sampleDir, { recursive: true });
  const samplePath = path.join(sampleDir, `${file.sha256}.bin`);
  fs.writeFileSync(samplePath, file.body);
  if (crypto.createHash('sha256').update(fs.readFileSync(samplePath)).digest('hex') !== file.sha256)
    throw new Error('Retained West Memphis file hash mismatch');
  const proof = {
    ccn: '044021', official_domain: 'perimeterhealthcare.com',
    identity_page_url: identityUrl, identity_page_sha256: page.sha256,
    independent_arkansas_entity_alias_source_url: arkansasSource,
    pointer_url: pointerUrl, pointer_sha256: pointer.sha256, pointer_http_status: pointer.status,
    pointer_location_name: 'Woodridge of West Memphis LLC',
    file_url: fileUrl, file_sha256: file.sha256, file_http_status: file.status,
    retained_bytes: file.body.length, retained_complete_file: path.relative(root, samplePath).replaceAll('\\', '/'),
    declared_hospital_name: header.mrfHospitalName, declared_location_name: header.mrfLocationName,
    declared_address: header.mrfAddress, declared_license_state: header.mrfLicenseState,
    facility_state: roster.state, declared_date: header.declaredLastUpdated, version: header.cmsVersion,
    observed_at: file.checkedAt,
    next_action: 'Publisher should correct or explain the TX license-state field for this Arkansas hospital. Independently validate the complete CSV content; retain the exact pointer-linked file and do not infer a legal compliance verdict from this field conflict.',
  };
  fs.writeFileSync(path.join(audit, 'reconciliation-perimeter-west-memphis-state-proof.json'),
    JSON.stringify(proof, null, 2) + '\n');
  const evidence = {
    identity: 'corroborated',
    identity_basis: 'pointer-entry-and-complete-file-name-address-match-roster-first-party-page-and-independent-arkansas-entity-alias',
    pointerUrl, pointerSha256: pointer.sha256, pointerHttpStatus: pointer.status,
    url: fileUrl, fileSha256: file.sha256, http_status: file.status,
    checked_at: file.checkedAt, date: proof.declared_date, version: proof.version,
    officialDomain: 'perimeterhealthcare.com', location_name: header.mrfLocationName,
    declared_hospital_name: header.mrfHospitalName, declared_address: header.mrfAddress,
    declared_license_state: header.mrfLicenseState, facility_state: roster.state,
    file_kind: 'csv', identityPageUrl: identityUrl, identityPageSha256: page.sha256,
    sourcePageUrl: identityUrl, sourcePageSha256: page.sha256,
    observedFinding: 'mrf-license-state-field-conflicts-facility', next_action: proof.next_action,
  };
  const entry = { ccn: '044021', base, action: 'replace-observation', evidence,
    evidence_run: 'perimeter-west-memphis-license-state-2026-09-16', reviewed_at: file.checkedAt,
    note: 'The live Perimeter root pointer links the complete 4,029-byte Woodridge of West Memphis CSV. Its name and 600 North 7th Street address agree with the first-party West Memphis page, roster, and independent Arkansas legal-name/DBA source. The file explicitly labels its license-number column TX while the facility is in Arkansas. This is a factual publisher-field conflict, not a missing-file or legal-compliance conclusion.' };
  const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
  const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  const old = ledger.find(row => row.ccn === entry.ccn);
  if (old && (old.evidence_run !== entry.evidence_run || JSON.stringify(old.evidence) !== JSON.stringify(entry.evidence)))
    throw new Error('Existing nonmatching West Memphis resolution');
  if (!old) {
    ledger.push(entry);
    ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
    fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
  }
  console.log(JSON.stringify({ applied: !old, ccn: entry.ccn, file_sha256: file.sha256,
    retained_bytes: file.body.length, declared_state: header.mrfLicenseState, facility_state: roster.state }));
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
