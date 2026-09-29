'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cheerio = require('cheerio');
const { retrieve, parsePayload } = require('./lib/recovery-transport');
const { csvToObjects } = require('./lib/util');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const pointerUrl = 'https://olympiafieldshospital.com/cms-hpt.txt';
const contactUrl = 'https://olympiafieldshospital.com/contact-us/';
const pricingUrl = 'https://olympiafieldshospital.com/price-transparency/';
const transitionUrl = 'https://olympiafieldshospital.com/news/';
const fileUrl = 'https://olympiafieldshospital.com/wp-content/uploads/2026/07/0005074_OlympiaFieldsHospital_StandardCharges.JSON';
const bodyText = bytes => cheerio.load(bytes.toString('utf8'))('body').text().replace(/\s+/g, ' ');

async function main() {
  const roster = csvToObjects(fs.readFileSync(path.join(root, 'cms_data/Hospital_General_Information.csv'), 'utf8'))
    .find(row => row['Facility ID'] === '140172');
  const base = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8'))
    .find(row => row.ccn === '140172');
  if (!roster || roster.Address !== '20201 S CRAWFORD AVENUE' || roster['City/Town'] !== 'OLYMPIA FIELDS'
      || roster.State !== 'IL' || roster['ZIP Code'] !== '60461'
      || !base || base.finding !== 'not-assessed-not-named-in-file'
      || base.domain !== 'franciscanhealth.org'
      || base.pointer_url !== 'https://franciscanhealth.org/cms-hpt.txt')
    throw new Error('Olympia Fields roster or original Franciscan assignment changed');
  const [pointer, contact, pricing, transition, file] = await Promise.all([
    retrieve(pointerUrl, 4096, { timeoutMs: 25000 }),
    retrieve(contactUrl, 262144, { timeoutMs: 25000 }),
    retrieve(pricingUrl, 262144, { timeoutMs: 25000 }),
    retrieve(transitionUrl, 262144, { timeoutMs: 25000 }),
    retrieve(fileUrl, 262144, { timeoutMs: 30000 }),
  ]);
  const pointerText = pointer.body.toString('utf8');
  const contactText = bodyText(contact.body), transitionText = bodyText(transition.body);
  const $pricing = cheerio.load(pricing.body.toString('utf8'));
  const pricingLinks = $pricing('a').map((_, element) => $pricing(element).attr('href')).get();
  const parsed = (await parsePayload(file.body, file.headers['content-type'] || 'application/json')).parsed.find(item => item.innerKind === 'json');
  if (![200, 206].includes(pointer.status) || !pointerText.includes('location-name: Olympia Fields Hospital')
      || !pointerText.includes(`source-page-url: ${pricingUrl}`) || !pointerText.includes(`mrf-url: ${fileUrl}`)
      || ![200, 206].includes(contact.status) || !/20201 South Crawford Avenue/i.test(contactText)
      || !/Olympia Fields, IL 60461/i.test(contactText)
      || ![200, 206].includes(pricing.status)
      || !pricingLinks.some(href => href === new URL(fileUrl).pathname || href === fileUrl)
      || ![200, 206].includes(transition.status)
      || !/completed the acquisition of Franciscan Health Olympia Fields/i.test(transitionText)
      || ![200, 206].includes(file.status) || file.body.length !== 262144
      || parsed?.mrfHospitalName !== 'OLYMPIA FIELDS HOSPITAL'
      || parsed.mrfLocationName !== 'OLYMPIA FIELDS HOSPITAL'
      || parsed.mrfAddress !== '20201 South Crawford Ave, Olympia Fields, IL 60461'
      || parsed.mrfLicenseState !== 'IL' || parsed.declaredLastUpdated !== '2026-07-24'
      || parsed.cmsVersion !== '3.0')
    throw new Error('New-operator identity, pointer/page chain, or JSON header changed');
  const sampleDir = path.join(root, 'cms_data/hpt/nationwide-verification/file-byte-proof');
  fs.mkdirSync(sampleDir, { recursive: true });
  const samplePath = path.join(sampleDir, `${file.sha256}.bin`);
  fs.writeFileSync(samplePath, file.body);
  if (crypto.createHash('sha256').update(fs.readFileSync(samplePath)).digest('hex') !== file.sha256)
    throw new Error('Retained Olympia Fields sample hash mismatch');
  const proof = {
    ccn: '140172', roster_name: roster['Facility Name'], roster_address: roster.Address,
    roster_city: roster['City/Town'], roster_state: roster.State, roster_zip: roster['ZIP Code'],
    prior_assigned_domain: base.domain, current_operator_domain: 'olympiafieldshospital.com',
    first_party_transition_url: transitionUrl, first_party_transition_sha256: transition.sha256,
    first_party_contact_url: contactUrl, first_party_contact_sha256: contact.sha256,
    first_party_pricing_url: pricingUrl, first_party_pricing_sha256: pricing.sha256,
    pointer_url: pointerUrl, pointer_http_status: pointer.status, pointer_sha256: pointer.sha256,
    pointer_location_name: 'Olympia Fields Hospital', file_url: fileUrl,
    file_http_status: file.status, retained_bytes: file.body.length,
    retained_sample: path.relative(root, samplePath).replaceAll('\\', '/'), sample_sha256: file.sha256,
    declared_hospital_name: parsed.mrfHospitalName, declared_location_name: parsed.mrfLocationName,
    declared_address: parsed.mrfAddress, declared_license_state: parsed.mrfLicenseState,
    declared_date: parsed.declaredLastUpdated, declared_version_literal: parsed.cmsVersion,
    cms_json_schema_identifier: '3.0.0',
    cms_json_schema_source: 'https://github.com/CMSgov/hospital-price-transparency/blob/master/documentation/JSON/schemas/README.md',
    observed_at: file.checkedAt,
    limitation: 'Only 262,144 file bytes were retained. The literal 3.0 version field differs from the CMS v3.0.0 JSON schema identifier; complete-file schema validity and legal compliance were not determined.',
  };
  const evidence = {
    identity: 'corroborated',
    identity_basis: 'current-prime-operated-first-party-campus-and-acquisition-exact-pointer-page-json-address-state',
    officialDomain: 'olympiafieldshospital.com', identityPageUrl: contactUrl,
    identityPageSha256: contact.sha256, sourcePageUrl: pricingUrl,
    sourcePageSha256: pricing.sha256, operatorTransitionUrl: transitionUrl,
    operatorTransitionSha256: transition.sha256, pointerUrl,
    pointerSha256: pointer.sha256, pointerHttpStatus: pointer.status,
    url: fileUrl, fileSha256: file.sha256, http_status: file.status,
    checked_at: file.checkedAt, date: parsed.declaredLastUpdated,
    version: parsed.cmsVersion, expected_version: '3.0.0',
    location_name: parsed.mrfLocationName, declared_hospital_name: parsed.mrfHospitalName,
    declared_address: parsed.mrfAddress, declared_license_state: parsed.mrfLicenseState,
    facility_state: roster.State, file_kind: 'json',
    observedFinding: 'mrf-template-version-noncanonical',
    next_action: 'Ask the current publisher to clarify or correct the literal 3.0 version field against the CMS v3.0.0 JSON schema identifier. Validate the complete current file before any legal or schema-compliance conclusion; do not revert to the prior Franciscan pointer after the Prime transition.',
  };
  const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
  const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  if (ledger.some(row => row.ccn === '140172')) throw new Error('Existing Olympia Fields resolution requires manual review');
  fs.writeFileSync(path.join(audit, 'reconciliation-olympia-fields-transition-proof.json'), JSON.stringify(proof, null, 2) + '\n');
  ledger.push({ ccn: '140172', base, action: 'replace-observation', evidence,
    evidence_run: 'olympia-fields-new-operator-version-review-2026-09-16', reviewed_at: file.checkedAt,
    note: 'Prime completed the acquisition of Franciscan Health Olympia Fields in May 2026. Its current hospital site identifies the exact 20201 South Crawford Avenue campus; the new root pointer and price page link the same readable JSON. The bounded header declares Olympia Fields Hospital, Illinois, 2026-07-24, but version literally 3.0 rather than the CMS JSON schema identifier 3.0.0. The old Franciscan pointer remains history, not current assignment. This is a factual version-field review, not a complete-file or legal verdict.' });
  ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
  fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
  console.log(JSON.stringify({ ccn: '140172', current_domain: 'olympiafieldshospital.com', pointer_sha256: pointer.sha256,
    sample_sha256: file.sha256, declared_version: parsed.cmsVersion }));
}

if (require.main === module) main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
