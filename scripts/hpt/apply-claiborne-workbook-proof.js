'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { csvToObjects } = require('./lib/util');
const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const proof = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-claiborne-workbook-proof.json'), 'utf8'));
const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
const base = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8')).find(row => row.ccn === proof.ccn);
const artifactPath = path.join(root, proof.raw_artifact);
if (!base || proof.ccn !== '190114' || proof.bytes_retained !== 1018292
  || !fs.existsSync(artifactPath) || fs.statSync(artifactPath).size !== proof.bytes_retained
  || crypto.createHash('sha256').update(fs.readFileSync(artifactPath)).digest('hex') !== proof.sha256)
  throw new Error('Incomplete Claiborne workbook proof');
const evidence = {
  identity: 'corroborated', identity_basis: 'current-official-address-exact-pointer-label-and-complete-workbook-facility-name',
  pointerUrl: proof.pointer_url, pointerSha256: proof.pointer_sha256, url: proof.mrf_url,
  fileSha256: proof.sha256, bytesRetained: proof.bytes_retained,
  http_status: proof.http_status, checked_at: proof.observed_at, date: '',
  generation_date: proof.declared_generation_date, version: '', file_kind: 'xlsx', schema_status: proof.schema_status,
  observedFinding: 'mrf-custom-workbook-metadata-unverified', officialDomain: 'claibornemedical.com',
  location_name: proof.pointer_location_name, declared_hospital_name: proof.declared_facility_name,
  declared_address: proof.official_identity, declared_license_state: 'LA',
  sourcePageUrl: 'https://claibornemedical.com/price-transparency/'
};
const note = 'The current official contact page independently matches the CMS roster name, 620 East College address, Homer locality and Louisiana state. The exact official pointer names Claiborne Memorial Medical Center and links the retained 1,018,292-byte object. The object is an XLSX workbook despite its .csv URL; it names the facility and generation date 2026-03-26 but uses a custom 11-column shoppable-services schema and declares no CMS template version or last_updated_on. The generation date is not treated as the MRF update date; identity is corroborated while CMS template status remains unresolved.';
const existing = ledger.find(row => row.ccn === proof.ccn);
if (existing) {
  if (!(existing.action === 'replace-observation' && existing.evidence_run === 'claiborne-workbook-review-2026-09-15'
    && Object.entries(evidence).every(([key, value]) => existing.evidence?.[key] === value)
    && existing.note === note && existing.finding === evidence.observedFinding)) throw new Error('Existing nonmatching Claiborne resolution');
} else ledger.push({ ccn: proof.ccn, base, action: 'replace-observation', evidence,
  evidence_run: 'claiborne-workbook-review-2026-09-15', reviewed_at: proof.observed_at, note });
ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
console.log(JSON.stringify({ applied: proof.ccn, finding: evidence.observedFinding }, null, 2));
