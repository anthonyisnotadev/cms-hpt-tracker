'use strict';

// Retain a complete, hash-bound proof for Tippah County Hospital's current
// first-party pointer -> ClaraPrice page -> CMS v3 JSON chain.
const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const { retrieve, safeUrl, sha } = require('./lib/recovery-transport');

const ROOT = path.resolve(__dirname, '../..');
const AUDIT = path.join(ROOT, 'data/hpt-audit');
const RAW = path.join(ROOT, 'cms_data/hpt/nationwide-verification/file-byte-proof');
const CCN = '251337';
const POINTER_URL = 'https://tippahcountyhospital.com/cms-hpt.txt';
const OFFICIAL_SITE = 'https://www.tippahcountyhospital.com/';
const PRICING_PAGE = 'https://secure.claraprice.net/price-transparency/tippah-county-hospital-ms';
const MRF_URL = 'https://secure.claraprice.net/price-transparency/OBKI-1787257626375/machine-readable/646001350_tippah-county-hospital_standardcharges.json';
const PROOF_NAME = 'reconciliation-tippah-current-pointer-file-proof-2026-09-30.json';
const CAP_PAGE = 262144;
const CAP_FILE = 16 * 1024 * 1024;

function assert(condition, message) { if (!condition) throw new Error(message); }
function pointerFields(body) {
  const out = {};
  for (const line of body.toString('utf8').split(/\r?\n/)) {
    const match = line.match(/^(location-name|source-page-url|mrf-url):\s*(.*)$/i);
    if (match) out[match[1].toLowerCase()] = match[2].trim();
  }
  return out;
}
async function main() {
  const observedAt = new Date().toISOString();
  const [pointer, official, pricing, file] = await Promise.all([
    retrieve(POINTER_URL, CAP_PAGE, { timeoutMs: 20000 }),
    retrieve(OFFICIAL_SITE, CAP_PAGE, { timeoutMs: 20000 }),
    retrieve(PRICING_PAGE, CAP_PAGE, { timeoutMs: 20000 }),
    retrieve(MRF_URL, CAP_FILE, { timeoutMs: 45000 })
  ]);
  const fields = pointerFields(pointer.body);
  assert(pointer.status >= 200 && pointer.status < 300, `pointer HTTP ${pointer.status}`);
  assert(fields['location-name'] === 'Tippah County Hospital', 'pointer facility name changed');
  assert(safeUrl(fields['source-page-url']) === PRICING_PAGE, 'pointer source-page URL changed');
  assert(safeUrl(fields['mrf-url']) === MRF_URL, 'pointer MRF URL changed');
  assert(official.status >= 200 && official.status < 300, `official site HTTP ${official.status}`);
  assert(official.body.toString('utf8').includes('secure.claraprice.net/price-transparency/tippah-county-hospital-ms'), 'official site no longer links to the ClaraPrice page');
  assert(pricing.status >= 200 && pricing.status < 300, `pricing page HTTP ${pricing.status}`);
  assert(file.status === 200, `MRF HTTP ${file.status}`);
  assert(file.body.length > 0 && file.body.length === Number(file.headers['content-length']), 'MRF body was not complete against Content-Length');
  const mrf = JSON.parse(file.body.toString('utf8'));
  const addr = Array.isArray(mrf.hospital_address) ? mrf.hospital_address : [mrf.hospital_address].filter(Boolean);
  const license = mrf.license_information || {};
  assert(mrf.hospital_name === 'Tippah County Hospital', 'MRF hospital name mismatch');
  assert(addr.some(value => /1005 City Avenue North, Ripley, MS 38663/i.test(value)), 'MRF address mismatch');
  assert(license.state === 'MS' && license.license_number, 'MRF Mississippi license metadata missing');
  assert(mrf.last_updated_on === '2026-09-14', 'MRF declared update date changed');
  assert(mrf.version === '3.0.0', 'MRF is not exact CMS version 3.0.0');
  assert(mrf.attestation && mrf.attestation.confirm_attestation === true, 'MRF attestation missing');

  await fsp.mkdir(RAW, { recursive: true });
  const digest = sha(file.body);
  const artifact = path.join(RAW, `${digest}.json`);
  if (fs.existsSync(artifact)) {
    const existing = fs.readFileSync(artifact);
    assert(existing.length === file.body.length && sha(existing) === digest, 'existing raw artifact hash mismatch');
  } else await fsp.writeFile(artifact, file.body, { flag: 'wx' });
  const proof = {
    schema_version: 1,
    ccn: CCN,
    observed_at: observedAt,
    official_domain: 'tippahcountyhospital.com',
    official_site_url: OFFICIAL_SITE,
    official_site_status: official.status,
    official_site_sha256: sha(official.body),
    official_site_linked_pricing_page: PRICING_PAGE,
    official_page_link_label: 'Price Transparency',
    source_page_url: PRICING_PAGE,
    source_page_status: pricing.status,
    source_page_sha256: sha(pricing.body),
    source_page_displayed_published_for_compliance: '2026-09-14',
    source_page_displayed_last_modified: '2026-09-18',
    source_page_link_ui_target: 'https://secure.claraprice.net/price-transparency/OBKI-1787257626375/machine-readable',
    source_page_link_ui_observed_at: observedAt,
    pointer_url: POINTER_URL,
    pointer_status: pointer.status,
    pointer_bytes: pointer.body.length,
    pointer_sha256: sha(pointer.body),
    pointer_location_name: fields['location-name'],
    pointer_source_page_url: fields['source-page-url'],
    mrf_url: MRF_URL,
    mrf_status: file.status,
    mrf_content_length: Number(file.headers['content-length']),
    mrf_total_bytes: file.body.length,
    mrf_sha256: digest,
    mrf_content_type: file.headers['content-type'] || '',
    retained_file: path.relative(ROOT, artifact).replace(/\\/g, '/'),
    file_kind: 'json',
    declared_hospital_name: mrf.hospital_name,
    declared_location_name: Array.isArray(mrf.location_name) ? mrf.location_name.join('; ') : String(mrf.location_name || ''),
    declared_address: addr.join('; '),
    declared_license_number: String(license.license_number),
    declared_license_state: String(license.state),
    declared_npi: Array.isArray(mrf.type_2_npi) ? mrf.type_2_npi.join('; ') : String(mrf.type_2_npi || ''),
    declared_last_updated: mrf.last_updated_on,
    cms_template_version: mrf.version,
    declared_attestation: mrf.attestation.confirm_attestation === true,
    standard_charge_information_groups: Array.isArray(mrf.standard_charge_information) ? mrf.standard_charge_information.length : 0,
    complete_file_retrieval: true,
    complete_json_parse: true,
    complete_file_cms_validator_run: false,
    legal_compliance_conclusion: false,
    transport_attempts: file.attempts.map(({ via, status, bytes, error }) => ({ via, status, bytes, error }))
  };
  const output = path.join(AUDIT, PROOF_NAME);
  const temp = `${output}.partial`;
  await fsp.writeFile(temp, JSON.stringify(proof, null, 2) + '\n');
  await fsp.rename(temp, output);
  console.log(JSON.stringify({ proof: PROOF_NAME, ccn: CCN, mrf_bytes: proof.mrf_total_bytes, mrf_sha256: digest, version: proof.cms_template_version, date: proof.declared_last_updated, official_pointer_chain: true }, null, 2));
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
