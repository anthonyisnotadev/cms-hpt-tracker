'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { csvToObjects } = require('./lib/util');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const proof = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-christus-alamogordo-alias-proof.json'), 'utf8'));
const base = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8'))
  .find(row => row.ccn === '320004');
const sample = fs.readFileSync(path.join(root, proof.retained_sample));
if (proof.ccn !== '320004' || !base || base.finding !== 'not-assessed-domain-unknown'
    || proof.roster_name !== 'CHRISTUS SOUTHERN NEW MEXICO'
    || proof.roster_address !== '2669 SCENIC DRIVE' || proof.roster_city !== 'ALAMOGORDO'
    || proof.roster_state !== 'NM' || proof.roster_zip !== '88310'
    || proof.official_domain !== 'christushealth.org'
    || proof.identity_page_url !== 'https://www.christushealth.org/locations/alamogordo-hospital'
    || !/^[a-f0-9]{64}$/.test(proof.identity_page_sha256)
    || proof.identity_page_current_name !== 'CHRISTUS Southern New Mexico'
    || proof.identity_page_former_name !== 'Gerald Champion'
    || proof.identity_page_address !== '2669 N. Scenic Dr., Alamogordo, NM 88310'
    || proof.pricing_page_url !== 'https://www.christushealth.org/plan-care/bill-pay/pricing-transparency'
    || proof.pricing_page_sha256 !== '8cbfb140aeca8de03f9a24ddd75d558f31ed40143e1f5d9a726307aaffcf3ef3'
    || proof.pricing_page_names_former_facility !== true || proof.pricing_page_links_file !== true
    || proof.pointer_url !== 'https://www.christushealth.org/cms-hpt.txt'
    || proof.pointer_sha256 !== '549263ce2336f948998e057beb9fe3b9cf461ae701ba913dbb55085c1af6f26d'
    || proof.pointer_bytes !== 16906
    || proof.pointer_location_name !== 'Gerald Champion Regional Medical Center'
    || proof.pointer_mrf_url !== 'https://www.christushealth.org/-/media/christus-health/plan-care/files/bill-pay/machine-readable-files/850138775_geraldchampionregionalmedicalcenter_standardcharges.ashx'
    || proof.file_http_status !== 206 || proof.file_sample_bytes !== 262144
    || proof.file_total_bytes !== 123728509 || sample.length !== 262144
    || crypto.createHash('sha256').update(sample).digest('hex') !== proof.file_sample_sha256
    || proof.declared_hospital_name !== 'Gerald Champion Regional Medical Center'
    || proof.declared_location_name !== 'Gerald Champion Regional Medical Center'
    || proof.declared_address !== '2669 N Scenic Dr, Alamogordo, NM 88310'
    || proof.declared_license_state !== 'NM' || proof.declared_date !== '2026-01-12'
    || proof.version !== '3.0.0' || !Number.isFinite(Date.parse(proof.observed_at)))
  throw new Error('CHRISTUS Alamogordo proof or base changed; manual review required');

const evidence = {
  identity: 'corroborated',
  identity_basis: 'current-first-party-page-documents-southern-new-mexico-and-gerald-champion-alias-at-exact-alamogordo-campus-with-pointer-page-file-header',
  pointerUrl: proof.pointer_url, pointerSha256: proof.pointer_sha256,
  url: proof.pointer_mrf_url, fileSha256: proof.file_sample_sha256,
  bytesRetained: proof.file_sample_bytes, fileTotalBytes: proof.file_total_bytes,
  http_status: proof.file_http_status, checked_at: proof.observed_at,
  date: proof.declared_date, version: proof.version,
  officialDomain: proof.official_domain, location_name: proof.pointer_location_name,
  declared_hospital_name: proof.declared_hospital_name,
  declared_location_name: proof.declared_location_name,
  declared_address: proof.declared_address,
  declared_license_state: proof.declared_license_state,
  file_kind: 'json', identityPageUrl: proof.identity_page_url,
  identityPageSha256: proof.identity_page_sha256,
  sourcePageUrl: proof.pricing_page_url, sourcePageSha256: proof.pricing_page_sha256,
  observedFinding: 'compliant-observed', next_action: proof.next_action,
};
const entry = { ccn: '320004', base, action: 'replace', evidence,
  evidence_run: 'christus-alamogordo-alias-pointer-header-2026-09-17', reviewed_at: proof.observed_at,
  note: 'The current first-party Alamogordo hospital page names CHRISTUS Southern New Mexico and also refers to Gerald Champion at the same 2669 Scenic Drive campus as the roster. The current root pointer and pricing page name Gerald Champion Regional Medical Center and link the same JSON. Its retained 262,144-byte prefix of a 123,728,509-byte response declares Gerald Champion Regional Medical Center at 2669 N Scenic Dr, Alamogordo NM 88310, NM license-state field, 2026-01-12 and v3.0.0. This is a current pointer/page/file/header identity recovery with a documented former-name alias, not full-file validation or a legal compliance determination. The earlier domain-unknown result remains historical.' };
const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
const existing = ledger.find(row => row.ccn === entry.ccn);
if (existing && (existing.evidence_run !== entry.evidence_run || JSON.stringify(existing.evidence) !== JSON.stringify(entry.evidence)))
  throw new Error('Existing nonmatching CHRISTUS Alamogordo resolution');
if (!existing) {
  ledger.push(entry);
  ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
  fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
}
console.log(JSON.stringify({ applied: !existing, ccn: entry.ccn,
  finding: 'compliant-observed', sample_sha256: proof.file_sample_sha256 }));
