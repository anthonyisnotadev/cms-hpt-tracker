'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { csvToObjects } = require('./lib/util');
const { retrieve } = require('./lib/recovery-transport');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const ccn = '250036';
const pointerUrl = 'https://georgeregional.com/cms-hpt.txt';
const pricingUrl = 'https://georgeregional.com/price-insurance-and-billing/';
const contactUrl = 'https://georgeregional.com/contact/';
const pointerFileUrl = 'https://georgeregional.com/wp-content/uploads/2025/12/64-6001398_George-Regional-Hospital_standardcharges.csv';
const pageFileUrl = 'https://georgeregional.com/wp-content/uploads/2026/08/64-6001398_George-Regional-Hospital_standardcharges-5.csv';
const browserObservedAt = '2026-09-17T06:43:26.000Z';
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

async function main() {
  const roster = csvToObjects(fs.readFileSync(path.join(root, 'cms_data/Hospital_General_Information.csv'), 'utf8'))
    .find(row => row['Facility ID'] === ccn);
  const base = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8'))
    .find(row => row.ccn === ccn);
  const retainedPath = path.join(root, 'cms_data/hpt/pointer-corpus/raw/georgeregional.com-d817dd66b43c.txt');
  const retainedPointer = fs.readFileSync(retainedPath);
  const pointerText = retainedPointer.toString('utf8');
  if (!roster || roster['Facility Name'] !== 'GEORGE REGIONAL HEALTH SYSTEM'
      || roster.Address !== '859 WINTER STREET' || roster['City/Town'] !== 'LUCEDALE'
      || roster.State !== 'MS' || roster['ZIP Code'] !== '39452'
      || !base || base.domain !== 'georgeregional.com'
      || !pointerText.includes('location-name: George Regional Hospital')
      || !pointerText.includes(`source-page-url: ${pricingUrl}`)
      || !pointerText.includes(`mrf-url: ${pointerFileUrl}`)
      || pointerText.includes(pageFileUrl))
    throw new Error('George Regional roster or retained pointer changed');

  const [pointer, pointerFile, pageFile] = await Promise.all([
    retrieve(pointerUrl, 65536, { timeoutMs: 30000 }),
    retrieve(pointerFileUrl, 65536, { timeoutMs: 30000 }),
    retrieve(pageFileUrl, 65536, { timeoutMs: 30000 }),
  ]);
  const challenged = response => response.status === 202
    && /^text\/html/i.test(response.headers['content-type'] || '')
    && response.body.toString('utf8').includes('/.well-known/sgcaptcha/');
  if (![pointer, pointerFile, pageFile].every(challenged))
    throw new Error('Expected dated client challenge changed; review current responses manually');

  const nextAction = 'After publisher access changes or through an authorized route, re-read the exact George Regional root pointer and both distinct CSV URLs. Confirm which URL the root declares, which file the first-party price page links, then inspect bounded file bytes for the Lucedale hospital name/address/state, update date and CMS version. Do not infer file absence or currency from the current challenges or URL path dates.';
  const proof = {
    ccn, roster_name: roster['Facility Name'], roster_address: roster.Address,
    roster_city: roster['City/Town'], roster_state: roster.State, roster_zip: roster['ZIP Code'],
    first_party_contact_url: contactUrl,
    contact_page_web_reader_observation: 'George Regional Hospital at 859 Winter St, Lucedale, MS 39452',
    first_party_pricing_page_url: pricingUrl,
    price_page_web_reader_download_url: pageFileUrl,
    web_reader_observed_at: browserObservedAt,
    retained_pointer_artifact: path.relative(root, retainedPath).replaceAll('\\', '/'),
    retained_pointer_sha256: sha(retainedPointer), retained_pointer_mrf_url: pointerFileUrl,
    current_pointer_url: pointerUrl,
    current_pointer_client: { status: pointer.status, content_type: pointer.headers['content-type'],
      response_sha256: pointer.sha256, observed_at: pointer.checkedAt,
      response_kind: 'html-security-challenge' },
    pointer_file_client: { url: pointerFileUrl, status: pointerFile.status,
      response_sha256: pointerFile.sha256, observed_at: pointerFile.checkedAt,
      response_kind: 'html-security-challenge' },
    page_file_client: { url: pageFileUrl, status: pageFile.status,
      response_sha256: pageFile.sha256, observed_at: pageFile.checkedAt,
      response_kind: 'html-security-challenge' },
    browser_pointer_result: 'Robot Challenge Screen at /.well-known/sgcaptcha/',
    browser_pointer_file_result: 'Robot Challenge Screen at /.well-known/sgcaptcha/',
    browser_page_file_result: 'not tested',
    byte_readable_file_verified: false,
    next_action: nextAction,
  };
  const proofPath = path.join(audit, 'reconciliation-george-regional-access-review.json');
  fs.writeFileSync(proofPath, JSON.stringify(proof, null, 2) + '\n');
  const manualPath = path.join(audit, 'reconciliation-manual-access-observations.json');
  const manual = JSON.parse(fs.readFileSync(manualPath, 'utf8'));
  if (manual.records.some(row => row.ccn === ccn))
    throw new Error('Existing George Regional manual review requires manual reconciliation');
  manual.records.push({ ccn, observed_at: browserObservedAt,
    proof_file: path.basename(proofPath), official_identity_url: contactUrl,
    official_pricing_page: pricingUrl, pointer_url: pointerUrl,
    pointer_retained_mrf_url: pointerFileUrl, page_linked_mrf_url: pageFileUrl,
    current_root_pointer_client_status: pointer.status,
    pointer_file_client_status: pointerFile.status,
    page_file_client_status: pageFile.status,
    browser_pointer_result: proof.browser_pointer_result,
    disposition: 'first-party-price-page-file-differs-from-retained-pointer-access-challenged',
    next_action: nextAction });
  manual.records.sort((a, b) => a.ccn.localeCompare(b.ccn));
  fs.writeFileSync(manualPath, JSON.stringify(manual, null, 2) + '\n');
  console.log(JSON.stringify({ ccn, pointer_status: pointer.status,
    pointer_file_status: pointerFile.status, page_file_status: pageFile.status,
    retained_pointer_sha256: sha(retainedPointer) }));
}

if (require.main === module) main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
