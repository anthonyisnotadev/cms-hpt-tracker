'use strict';

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const { retrieve, parsePayload } = require('./lib/recovery-transport');
const { csvToObjects } = require('./lib/util');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const domain = 'saintmaryofnazarethhospital.com';
const pointerUrl = `https://${domain}/cms-hpt.txt`;
const pricingUrl = `https://${domain}/price-transparency/`;
const fileUrl = `https://${domain}/wp-content/uploads/2026/09/0006513_SaintMaryOfNazarethHospital_StandardCharges.json`;
const identityUrl = `https://${domain}/wp-content/uploads/2025/09/Saint-Mary-of-Nazareth-Hospital_FAP-Policy-9-4-25.pdf`;

async function main() {
  const roster = csvToObjects(fs.readFileSync(path.join(root, 'cms_data/Hospital_General_Information.csv'), 'utf8'))
    .find(row => row['Facility ID'] === '140180');
  const base = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8'))
    .find(row => row.ccn === '140180');
  if (!roster || roster.Address !== '2233 W DIVISION ST' || roster['City/Town'] !== 'CHICAGO'
      || roster.State !== 'IL' || roster['ZIP Code'] !== '60622'
      || !base || base.domain !== 'healthcare.ascension.org'
      || base.finding !== 'not-assessed-not-named-in-file')
    throw new Error('Saint Mary roster or previous assignment changed');
  const [pointer, pricing, file] = await Promise.all([
    retrieve(pointerUrl, 4096, { timeoutMs: 25000 }),
    retrieve(pricingUrl, 262144, { timeoutMs: 25000 }),
    retrieve(fileUrl, 262144, { timeoutMs: 30000 }),
  ]);
  const pointerText = pointer.body.toString('utf8');
  const $pricing = cheerio.load(pricing.body.toString('utf8'));
  const links = $pricing('a').map((_, element) => $pricing(element).attr('href')).get();
  const parsed = (await parsePayload(file.body, file.headers['content-type'] || 'application/json'))
    .parsed.find(item => item.innerKind === 'json');
  if (![200, 206].includes(pointer.status) || !pointerText.includes('location-name: Saint Mary of Nazareth Hospital')
      || !pointerText.includes(`source-page-url: ${pricingUrl}`)
      || !pointerText.includes(`mrf-url: ${fileUrl}`)
      || ![200, 206].includes(pricing.status)
      || !links.some(href => href === fileUrl || href === new URL(fileUrl).pathname)
      || ![200, 206].includes(file.status) || file.body.length !== 262144
      || parsed?.mrfHospitalName !== 'Saint Mary of Nazareth Hospital'
      || parsed.mrfLocationName !== 'Saint Mary of Nazareth Hospital'
      || parsed.mrfAddress !== '2233 W. Division St., Chicago, Illinois 60622'
      || parsed.mrfLicenseState !== 'IL' || parsed.declaredLastUpdated !== '2026-09-01'
      || parsed.cmsVersion !== '3.0')
    throw new Error('Saint Mary pointer, pricing link, or JSON metadata changed');
  const sampleDir = path.join(root, 'cms_data/hpt/nationwide-verification/file-byte-proof');
  fs.mkdirSync(sampleDir, { recursive: true });
  const samplePath = path.join(sampleDir, `${file.sha256}.bin`);
  fs.writeFileSync(samplePath, file.body);
  const proof = {
    ccn: '140180', roster_name: roster['Facility Name'], roster_address: roster.Address,
    roster_city: roster['City/Town'], roster_state: roster.State, roster_zip: roster['ZIP Code'],
    prior_assigned_domain: base.domain, current_operator_domain: domain,
    first_party_identity_url: identityUrl,
    pointer_url: pointerUrl, pointer_http_status: pointer.status, pointer_sha256: pointer.sha256,
    pointer_location_name: 'Saint Mary of Nazareth Hospital',
    first_party_pricing_url: pricingUrl, first_party_pricing_sha256: pricing.sha256,
    file_url: fileUrl, file_http_status: file.status, retained_bytes: file.body.length,
    retained_sample: path.relative(root, samplePath).replaceAll('\\', '/'), sample_sha256: file.sha256,
    declared_hospital_name: parsed.mrfHospitalName, declared_location_name: parsed.mrfLocationName,
    declared_address: parsed.mrfAddress, declared_license_state: parsed.mrfLicenseState,
    declared_date: parsed.declaredLastUpdated, declared_version_literal: parsed.cmsVersion,
    cms_json_schema_identifier: '3.0.0',
    cms_json_schema_source: 'https://github.com/CMSgov/hospital-price-transparency/blob/master/documentation/JSON/schemas/README.md',
    observed_at: file.checkedAt,
    limitation: 'Only 262,144 JSON bytes were retained. The literal version differs from the CMS v3.0.0 JSON schema identifier; complete-file validity and legal compliance were not determined.',
  };
  const evidence = {
    identity: 'corroborated', identity_basis: 'current-prime-first-party-pointer-pricing-json-exact-street-state',
    officialDomain: domain, identityPageUrl: identityUrl,
    sourcePageUrl: pricingUrl, sourcePageSha256: pricing.sha256,
    pointerUrl, pointerSha256: pointer.sha256, pointerHttpStatus: pointer.status,
    url: fileUrl, fileSha256: file.sha256, http_status: file.status,
    checked_at: file.checkedAt, date: parsed.declaredLastUpdated,
    version: parsed.cmsVersion, expected_version: '3.0.0',
    location_name: parsed.mrfLocationName, declared_hospital_name: parsed.mrfHospitalName,
    declared_address: parsed.mrfAddress, declared_license_state: parsed.mrfLicenseState,
    facility_state: roster.State, file_kind: 'json',
    observedFinding: 'mrf-template-version-noncanonical',
    next_action: 'Ask the current publisher to clarify or correct the literal 3.0 version field against the CMS v3.0.0 JSON schema identifier. Validate the complete current file before any legal or schema-compliance conclusion; do not substitute an Ascension sibling file.',
  };
  const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
  const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  if (ledger.some(row => row.ccn === '140180')) throw new Error('Existing Saint Mary resolution requires manual review');
  fs.writeFileSync(path.join(audit, 'reconciliation-saint-mary-nazareth-proof.json'), JSON.stringify(proof, null, 2) + '\n');
  ledger.push({ ccn: '140180', base, action: 'replace-observation', evidence,
    evidence_run: 'saint-mary-nazareth-prime-version-review-2026-09-16', reviewed_at: file.checkedAt,
    note: 'The former Presence/Ascension roster campus at 2233 W Division now operates as Prime Saint Mary of Nazareth. Its current first-party root pointer and pricing page link a JSON whose bounded header matches the exact address and Illinois. The literal version is 3.0 rather than the CMS JSON schema identifier 3.0.0. The Ascension pointer remains historical; this is a version-field review, not a complete-file or legal verdict.' });
  ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
  fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
  console.log(JSON.stringify({ ccn: '140180', pointer_sha256: pointer.sha256,
    sample_sha256: file.sha256, declared_version: parsed.cmsVersion }));
}

if (require.main === module) main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
