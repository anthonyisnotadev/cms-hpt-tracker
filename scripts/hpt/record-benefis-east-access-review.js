'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { csvToObjects } = require('./lib/util');
const { retrieve } = require('./lib/recovery-transport');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const ccn = '270012';
const pointerUrl = 'https://benefis.org/cms-hpt.txt';
const identityUrl = 'https://www.benefis.org/locations/profile/benefis-east-campus/';
const pricingUrl = 'https://www.benefis.org/patients-visitors/billing-financial-assistance/price-transparency/';
const fileUrl = 'https://www.benefis.org/app/files/public/ecc68e09-9516-4e98-9c6a-e892ac1d14f0/810232122_BenefisHospitalsInc_standardcharges.csv';
const retainedPath = path.join(root, 'cms_data/hpt/pointer-corpus/raw/benefis.org-a53c2033a555.txt');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

async function main() {
  const roster = csvToObjects(fs.readFileSync(path.join(root, 'cms_data/Hospital_General_Information.csv'), 'utf8'))
    .find(row => row['Facility ID'] === ccn);
  const base = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8'))
    .find(row => row.ccn === ccn);
  const retained = fs.readFileSync(retainedPath);
  const text = retained.toString('utf8');
  if (!roster || roster['Facility Name'] !== 'BENEFIS HOSPITALS INC'
      || roster.Address !== '1101 26TH ST S' || roster['City/Town'] !== 'GREAT FALLS'
      || roster.State !== 'MT' || roster['ZIP Code'] !== '59405'
      || !base || base.finding !== 'not-assessed-not-named-in-file'
      || base.domain !== 'benefis.org' || base.pointer_url !== pointerUrl
      || sha(retained) !== '6b21177686c8e2aeaf71efe43bcdb18e01c7d8b90f59af0da5a5137d9671bb4d'
      || !text.includes('location-name: Benefis Hospitals Inc - East Campus')
      || !text.includes('location-name: Benefis Hospitals Inc - West Campus')
      || text.split(`mrf-url: ${fileUrl}`).length !== 3
      || !text.includes(`source-page-url: ${pricingUrl}`))
    throw new Error('Benefis roster, base assessment, or retained pointer changed');
  const [pointer, identity, pricing, file] = await Promise.all([
    retrieve(pointerUrl, 65536, { timeoutMs: 30000, curlOnStatuses: [403] }),
    retrieve(identityUrl, 65536, { timeoutMs: 30000, curlOnStatuses: [403] }),
    retrieve(pricingUrl, 65536, { timeoutMs: 30000, curlOnStatuses: [403] }),
    retrieve(fileUrl, 65536, { timeoutMs: 30000, curlOnStatuses: [403] }),
  ]);
  const denied = r => r.status === 403 && /^text\/html/i.test(r.headers['content-type'] || '')
    && /Access Denied/i.test(r.body.toString('utf8'));
  if (![pointer, identity, pricing, file].every(denied))
    throw new Error('Benefis current access state changed; inspect responses before recording: ' + JSON.stringify(
      [pointer, identity, pricing, file].map(r => ({ status: r.status, type: r.headers['content-type'], sha: r.sha256 }))));
  const nextAction = 'Use an authorized publisher-access route or wait for Benefis access to change, then re-read the current root pointer and its shared East/West CSV. Verify that the file header identifies the 1101 26th Street South Great Falls campus, MT license-state field, date and template version before assigning the MRF to CCN 270012. Do not infer file absence or compliance from the current Akamai access denials.';
  const proof = {
    ccn, roster_name: roster['Facility Name'], roster_address: roster.Address,
    roster_city: roster['City/Town'], roster_state: roster.State, roster_zip: roster['ZIP Code'],
    official_domain: 'benefis.org', first_party_east_campus_url: identityUrl,
    web_reader_east_campus_observation: 'Benefis East Campus, 1101 26th Street South, Great Falls MT 59405',
    first_party_pricing_url: pricingUrl,
    web_reader_pricing_observation: 'The current price page lists Benefis Hospitals Inc - East Campus and West Campus as links to the same CSV.',
    web_reader_observed_on: '2026-09-17',
    retained_pointer_artifact: path.relative(root, retainedPath).replaceAll('\\', '/'),
    retained_pointer_sha256: sha(retained), pointer_url: pointerUrl,
    pointer_east_location_name: 'Benefis Hospitals Inc - East Campus',
    pointer_west_location_name: 'Benefis Hospitals Inc - West Campus',
    pointer_shared_mrf_url: fileUrl,
    direct_requests: [
      ['pointer', pointerUrl, pointer], ['east-campus', identityUrl, identity],
      ['price-page', pricingUrl, pricing], ['shared-csv', fileUrl, file],
    ].map(([role, url, r]) => ({ role, url, http_status: r.status,
      response_sha256: r.sha256, response_kind: 'html-access-denied', observed_at: r.checkedAt })),
    browser_price_page_result: 'Access Denied', browser_file_result: 'Access Denied',
    browser_observed_on: '2026-09-17', file_bytes_verified: false,
    observed_at: file.checkedAt, next_action: nextAction,
  };
  const proofPath = path.join(audit, 'reconciliation-benefis-east-access-review.json');
  fs.writeFileSync(proofPath, JSON.stringify(proof, null, 2) + '\n');
  const manualPath = path.join(audit, 'reconciliation-manual-access-observations.json');
  const manual = JSON.parse(fs.readFileSync(manualPath, 'utf8'));
  if (manual.records.some(row => row.ccn === ccn))
    throw new Error('Existing Benefis East manual review requires manual reconciliation');
  manual.records.push({ ccn, observed_at: proof.observed_at, proof_file: path.basename(proofPath),
    official_identity_url: identityUrl, official_pricing_page: pricingUrl,
    pointer_url: pointerUrl, pointer_retained_mrf_url: fileUrl,
    current_root_pointer_client_status: pointer.status, pointer_file_client_status: file.status,
    browser_pointer_result: 'not tested', browser_file_result: proof.browser_file_result,
    disposition: 'first-party-east-campus-shared-pointer-file-access-denied', next_action: nextAction });
  manual.records.sort((a, b) => a.ccn.localeCompare(b.ccn));
  fs.writeFileSync(manualPath, JSON.stringify(manual, null, 2) + '\n');
  console.log(JSON.stringify({ ccn, pointer_status: pointer.status, file_status: file.status,
    retained_pointer_sha256: proof.retained_pointer_sha256 }));
}

if (require.main === module) main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
