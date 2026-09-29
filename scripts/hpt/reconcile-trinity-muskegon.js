'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { csvToObjects } = require('./lib/util');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const ccn = '230066';
const pointerUrl = 'https://www.trinityhealthmichigan.org/sites/default/files/cms-hpt.txt';
const pageUrl = 'https://www.trinityhealthmichigan.org/location/trinity-health-muskegon-hospital';
const pricesUrl = 'https://www.trinityhealthmichigan.org/tools-and-resources/billing-and-insurance/our-prices';
const mrfUrl = 'https://hpt.trinity-health.org/382589966_mercy-health-hackley-campus_standardcharges.zip';
const sampleRel = 'cms_data/hpt/nationwide-verification/file-byte-proof/trinity-muskegon-230066.bin';

async function getBytes(url, headers = {}) {
  const response = await fetch(url, { headers });
  const bytes = Buffer.from(await response.arrayBuffer());
  return { response, bytes };
}
function sha(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }

(async () => {
  const base = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8')).find(r => r.ccn === ccn);
  if (!base || base.finding !== 'compliant-observed') throw new Error('Unexpected base record for 230066');
  const [pointer, page, prices, file] = await Promise.all([
    getBytes(pointerUrl), getBytes(pageUrl), getBytes(pricesUrl), getBytes(mrfUrl, { Range: 'bytes=0-262143' }),
  ]);
  if (pointer.response.status !== 200 || page.response.status !== 200 || prices.response.status !== 200
      || file.response.status !== 206 || !prices.bytes.toString('utf8').includes(mrfUrl)) {
    throw new Error('Trinity source retrieval did not meet the evidence gate');
  }
  const pageText = page.bytes.toString('utf8');
  if (!pageText.includes('1500 E Sherman Blvd') || !pageText.includes('Muskegon, MI 49444')) {
    throw new Error('Trinity identity page lacks exact address evidence');
  }
  fs.mkdirSync(path.dirname(path.join(root, sampleRel)), { recursive: true });
  fs.writeFileSync(path.join(root, sampleRel), file.bytes);
  const now = new Date().toISOString();
  const nationwide = JSON.parse(fs.readFileSync(path.join(audit, 'nationwide-verification.json'), 'utf8'));
  const record = nationwide.records.find(r => r.ccn === ccn);
  if (!record || record.declared_location_name !== 'Trinity Health Muskegon Hospital'
      || record.declared_address !== '1500 E Sherman Blvd, Muskogen, MI 49444') {
    throw new Error('Existing bounded header observation changed unexpectedly');
  }
  const proof = {
    ccn, roster_name: base.hospital_name, roster_address: base.address, roster_state: base.state,
    pointer_url: pointerUrl, pointer_sha256: sha(pointer.bytes), pointer_http_status: pointer.response.status,
    identity_page_url: pageUrl, identity_page_sha256: sha(page.bytes), identity_page_http_status: page.response.status,
    prices_page_url: pricesUrl, prices_page_sha256: sha(prices.bytes), prices_page_http_status: prices.response.status,
    pointer_mrf_url: mrfUrl, file_http_status: file.response.status, file_sample_bytes: file.bytes.length,
    file_sample_sha256: sha(file.bytes), retained_sample: sampleRel,
    declared_hospital_name: record.declared_hospital_name, declared_location_name: record.declared_location_name,
    declared_address: record.declared_address, declared_license_state: record.declared_license_state,
    declared_date: record.declared_last_updated, version: record.cms_template_version, observed_at: now,
    limitation: 'The first-party identity and pricing pages link the same MRF; the bounded ZIP header names the hospital and exact street/city/state/ZIP except for the typo Muskogen. This is not full-file validation or a legal compliance conclusion.'
  };
  fs.writeFileSync(path.join(audit, 'reconciliation-trinity-muskegon-proof.json'), `${JSON.stringify(proof, null, 2)}\n`);
  const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
  const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  const evidence = {
    identity: 'corroborated',
    identity_basis: 'first-party-identity-page-and-pricing-page-link-exact-campus-address-plus-bounded-pointer-file-header',
    officialDomain: 'trinityhealthmichigan.org', pointerUrl, pointerSha256: sha(pointer.bytes),
    sourcePageUrl: pricesUrl, sourcePageSha256: sha(prices.bytes), identityPageUrl: pageUrl,
    identityPageSha256: sha(page.bytes), url: mrfUrl, fileSha256: sha(file.bytes),
    bytesRetained: file.bytes.length, http_status: file.response.status, checked_at: now,
    date: record.declared_last_updated, version: record.cms_template_version,
    location_name: record.declared_location_name, declared_hospital_name: record.declared_hospital_name,
    declared_address: record.declared_address, declared_license_state: record.declared_license_state,
    observedFinding: 'compliant-observed', typo_normalization: 'Muskogen -> Muskegon'
  };
  const entry = { ccn, base, action: 'replace', evidence,
    evidence_run: 'trinity-muskegon-first-party-campus-header-proof-2026-09-17', reviewed_at: now,
    note: 'Trinity Health Michigan’s current identity page identifies Trinity Health Muskegon Hospital at 1500 E Sherman Blvd, Muskegon, MI 49444. Its current price-transparency page links the same pointer-declared MRF URL. The bounded ZIP header identifies Trinity Health Muskegon Hospital / Mercy Health Hackley Campus at the same address and Michigan license state, with only the typographical city error “Muskogen.” This supports the existing compliant-observed finding and resolves the prior name-without-location review; it is not full-file validation.' };
  const old = ledger.find(r => r.ccn === ccn);
  if (old && (old.evidence_run !== entry.evidence_run || JSON.stringify(old.evidence) !== JSON.stringify(evidence))) throw new Error('Existing nonmatching resolution');
  if (!old) { ledger.push(entry); ledger.sort((a, b) => a.ccn.localeCompare(b.ccn)); fs.writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`); }
  console.log(JSON.stringify({ ccn, applied: !old, pointer_sha256: sha(pointer.bytes), file_sample_sha256: sha(file.bytes) }));
})().catch(err => { console.error(err.stack || err); process.exitCode = 1; });
