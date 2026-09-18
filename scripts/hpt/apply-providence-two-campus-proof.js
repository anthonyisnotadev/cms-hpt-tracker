'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { csvToObjects } = require('./lib/util');
const { parsePayload } = require('./lib/recovery-transport');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const proof = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-providence-two-campus-proof.json'), 'utf8'));
const base = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8'))
  .find(row => row.ccn === '230019');
const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
const sha = value => crypto.createHash('sha256').update(value).digest('hex');

async function main() {
  const pointer = fs.readFileSync(path.join(root, 'cms_data/hpt/pointer-corpus/raw/henryford.com-7f120444c17d.txt'));
  const [southfield, novi] = proof.records;
  if (proof.ccn !== '230019' || proof.records.length !== 2
      || proof.primary_campus !== 'Southfield'
      || proof.roster_name !== 'ASCENSION PROVIDENCE HOSPITAL, SOUTHFIELD AND NOVI'
      || proof.roster_address !== '16001 W NINE MILE RD' || proof.roster_state !== 'MI'
      || proof.pointer_url !== 'https://henryford.com/cms-hpt.txt'
      || sha(pointer) !== proof.pointer_sha256
      || !proof.relationship_observation.includes('two campuses')
      || !proof.bylaws_web_reader_observation.includes('47601 Grand River Avenue')
      || southfield?.campus !== 'Southfield' || novi?.campus !== 'Novi'
      || southfield.declared_address !== '16001 W Nine Mile Rd Southfield MI 48075'
      || novi.declared_address !== '47601 Grand River Ave Novi MI 48374'
      || base?.finding !== 'not-assessed-not-named-in-file'
      || base.domain !== 'healthcare.ascension.org' || base.mrf_url
      || ledger.some(row => row.ccn === proof.ccn))
    throw new Error('Providence combined-campus linkage, baseline or root changed');
  for (const row of proof.records) {
    const sample = fs.readFileSync(path.join(root, row.retained_sample));
    const parsed = (await parsePayload(sample, 'text/csv')).parsed.find(item => item.innerKind === 'csv');
    if (!row.facility_page_text_identity || row.mrf_http_status !== 206
        || row.retained_bytes !== 262144 || row.file_total_bytes <= row.retained_bytes
        || sha(sample) !== row.retained_sha256
        || !row.pointer_entry_without_contacts.includes(`location-name: ${row.pointer_location_name}`)
        || !row.pointer_entry_without_contacts.includes(`mrf-url: ${row.mrf_url}`)
        || parsed?.mrfHospitalName !== 'Henry Ford Health'
        || parsed.mrfLocationName !== row.declared_location_name
        || parsed.mrfAddress !== row.declared_address
        || parsed.mrfLicenseState !== 'MI' || parsed.declaredLastUpdated !== '2026-01-01'
        || parsed.cmsVersion !== '3.0.0')
      throw new Error(`Providence ${row.campus} file proof changed`);
  }
  const evidence = {
    identity: 'corroborated',
    identity_basis: 'first-party-providence-two-campus-relationship-bylaws-and-two-exact-current-pointer-page-file-chains',
    identityPageUrl: southfield.facility_page_url, identityPageSha256: southfield.facility_page_sha256,
    relationshipPageUrl: proof.relationship_url, relationshipPageSha256: proof.relationship_sha256,
    bylawsUrl: proof.bylaws_url, bylawsObservation: proof.bylaws_web_reader_observation,
    sourcePageUrl: proof.pricing_page_url, sourcePageSha256: proof.pricing_page_sha256,
    officialDomain: 'henryford.com', pointerUrl: proof.pointer_url, pointerSha256: proof.pointer_sha256,
    url: southfield.mrf_url, fileSha256: southfield.retained_sha256,
    bytesRetained: southfield.retained_bytes, http_status: southfield.mrf_http_status,
    checked_at: southfield.observed_at, date: southfield.declared_date,
    version: southfield.declared_version, location_name: southfield.declared_location_name,
    declared_hospital_name: southfield.declared_hospital_name,
    declared_address: southfield.declared_address, declared_license_state: southfield.declared_license_state,
    primaryCampusLabel: 'Southfield campus', file_kind: 'csv',
    additionalFiles: [{ url: novi.mrf_url, location_name: 'Novi campus',
      fileSha256: novi.retained_sha256, bytesRetained: novi.retained_bytes,
      http_status: novi.mrf_http_status, checked_at: novi.observed_at,
      date: novi.declared_date, version: novi.declared_version,
      declared_address: novi.declared_address, declared_license_state: novi.declared_license_state }],
  };
  ledger.push({ ccn: proof.ccn, base, action: 'replace', evidence,
    evidence_run: 'providence-two-campus-2026-09-17',
    reviewed_at: proof.records.map(row => row.observed_at).sort().at(-1),
    note: 'The roster-named Ascension Providence Hospital is one Southfield-and-Novi hospital in current Henry Ford first-party teaching material and published medical-staff bylaws. The current Henry Ford root and price page name two separate CSVs: Southfield matches the roster/home-base address; Novi matches its separately documented campus. Both bounded headers declare Michigan, 2026-01-01 and CMS 3.0.0. Retain both file links. Neither prefix establishes complete-file validity or a legal compliance verdict.' });
  ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
  fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
  console.log(JSON.stringify({ applied: proof.ccn, primary: 'Southfield', additional: 'Novi' }));
}

if (require.main === module) main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
