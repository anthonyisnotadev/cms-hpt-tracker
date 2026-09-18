'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { csvToObjects } = require('./lib/util');
const { retrieve } = require('./lib/recovery-transport');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const ccn = '250042';
const officialDomain = 'nwmrmc.org';
const identityUrl = 'https://nwmrmc.org/nw-contact.php';
const pricingUrl = 'https://nwmrmc.org/price.html';
const rootPointerUrl = 'https://nwmrmc.org/cms-hpt.txt';
const pageFileUrl = 'https://nwmrmc.org/646001574_NORTHWEST-MISS-REGIONAL-MEDICAL-CENTER_standardcharges.csv';
const linkedTxtUrl = 'https://nwmrmc.org/price_3_1389799598.txt';
const linkedTxtFileUrl = 'https://nwmrmc.org/646001574%20northwest-miss-regional-medical-center_standardcharges.csv';
const formerOperatorSource = 'https://www.deltahealthsystem.org/news/2023/may/delta-health-system-announcement/';
const webReaderObservedOn = '2026-09-17';
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

async function main() {
  const roster = csvToObjects(fs.readFileSync(path.join(root, 'cms_data/Hospital_General_Information.csv'), 'utf8'))
    .find(row => row['Facility ID'] === ccn);
  const base = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8'))
    .find(row => row.ccn === ccn);
  const oldPath = path.join(root, 'cms_data/hpt/pointer-corpus/raw/deltahealthsystem.org-bf8e5dadc594.txt');
  const oldPointer = fs.readFileSync(oldPath);
  if (!roster || roster['Facility Name'] !== 'NORTHWEST MISSISSISSIPPI REGIONAL MEDICAL CENTER'
      || roster.Address !== '1970 HOSPITAL DRIVE' || roster['City/Town'] !== 'CLARKSDALE'
      || roster.State !== 'MS' || roster['ZIP Code'] !== '38614'
      || !base || base.finding !== 'not-assessed-not-named-in-file'
      || base.domain !== 'deltahealthsystem.org'
      || /Northwest|Clarksdale|1970 Hospital/i.test(oldPointer.toString('utf8')))
    throw new Error('Northwest roster, Delta pointer, or base changed');
  const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
  const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  if (ledger.some(row => row.ccn === ccn)) throw new Error('Existing Northwest resolution requires manual review');
  const urls = [identityUrl, pricingUrl, rootPointerUrl, pageFileUrl, linkedTxtUrl, linkedTxtFileUrl];
  const responses = await Promise.all(urls.map(url => retrieve(url, 65536, { timeoutMs: 30000 })));
  const checks = Object.fromEntries(urls.map((url, index) => [url, responses[index]]));
  for (const response of responses) {
    if (response.status !== 202 || !/^text\/html/i.test(response.headers['content-type'] || '')
        || !response.body.toString('utf8').includes('/.well-known/sgcaptcha/'))
      throw new Error('Northwest current site access changed; inspect before recording challenge');
  }
  const observedAt = responses[2].checkedAt;
  const nextAction = 'Recover the current Northwest Mississippi Regional Medical Center root cms-hpt.txt after authorized access changes. Compare its exact MRF URL with the first-party price-page CSV and separately linked TXT candidate; then read bounded bytes from the selected file to verify the Clarksdale hospital name, 1970 Hospital Drive address, MS state field, declared date and CMS version. Do not reuse the former Delta pointer or infer file absence from security challenges.';
  const proof = {
    ccn, roster_name: roster['Facility Name'], roster_address: roster.Address,
    roster_city: roster['City/Town'], roster_state: roster.State, roster_zip: roster['ZIP Code'],
    former_assigned_domain: base.domain,
    former_pointer_artifact: path.relative(root, oldPath).replaceAll('\\', '/'),
    former_pointer_sha256: sha(oldPointer), former_pointer_names_northwest: false,
    former_operator_transition_url: formerOperatorSource,
    former_operator_web_reader_observation: 'Delta Health System stated that Northwest Regional operations transferred to the Northwest Regional Medical Center Board of Trustees beginning May 1, 2023.',
    official_domain: officialDomain, identity_page_url: identityUrl,
    identity_web_reader_observation: 'Current Northwest Mississippi Regional Medical Center contact page lists 1970 Hospital Dr., Clarksdale, MS 38614.',
    pricing_page_url: pricingUrl,
    pricing_page_web_reader_observation: 'First-party price page links the underscored Northwest CSV and a separate TXT file.',
    price_page_file_url: pageFileUrl, linked_txt_url: linkedTxtUrl,
    linked_txt_declared_file_url: linkedTxtFileUrl,
    web_reader_observed_on: webReaderObservedOn,
    current_site_requests: urls.map(url => ({ url, http_status: checks[url].status,
      response_kind: 'html-security-challenge', response_sha256: checks[url].sha256,
      observed_at: checks[url].checkedAt })),
    browser_price_page_result: 'Robot Challenge Screen at /.well-known/sgcaptcha/',
    pointer_and_file_bytes_verified: false, observed_at: observedAt,
    next_action: nextAction,
  };
  const proofPath = path.join(audit, 'reconciliation-northwest-ms-transition-proof.json');
  const note = 'The former Delta operator announced Northwest Regional operations transferred to the Northwest Regional Medical Center Board of Trustees in 2023. The current Northwest first-party site identifies the exact Clarksdale campus and lists a price-page CSV plus a separate TXT candidate. Current client requests to the hospital root, pages and both file URLs returned HTML security challenges, and the browser price page displayed a Robot Challenge Screen. The old Delta pointer is not evidence for this CCN. Correct site identity only; current root-pointer linkage, file bytes and metadata remain unverified.';
  ledger.push({ ccn, base, action: 'quarantine', official: { domain: officialDomain },
    evidence: proof, evidence_run: 'northwest-ms-operator-transition-2026-09-17',
    reviewed_at: observedAt, note });
  ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
  fs.writeFileSync(proofPath, JSON.stringify(proof, null, 2) + '\n');
  fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
  console.log(JSON.stringify({ ccn, official_domain: officialDomain,
    challenged_requests: responses.length, old_pointer_sha256: sha(oldPointer) }));
}

if (require.main === module) main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
