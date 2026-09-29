'use strict';
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const manualPath = path.join(audit, 'reconciliation-manual-access-observations.json');
const source = JSON.parse(fs.readFileSync(manualPath, 'utf8'));

// These records already contain dated first-party page/pointer/file reviews in
// their proof files. Promote only the explicit file URL and observed metadata
// into the generic manual-observation shape consumed by the nationwide overlay.
// This is provenance repair, not a new finding or a disposition change.
const targets = new Set(['314027','670093','490060','521342','521329','521348','521347','531314','531301']);
const first = (text, re) => {
  const m = String(text || '').match(re);
  return m ? m[1] : '';
};
const derive = (record, proof) => {
  const pricing = proof.mrf_observation || {};
  const pricingText = proof.pricing_observation || '';
  const identity = record.roster_identity || {};
  const nested = pricing;
  const declaredHospital = proof.declared_hospital_name || nested.hospital_name
    || first(pricingText, /metadata(?:\s+rows)?\s+declare(?:s)?\s+(.+?)(?:,| at )/i)
    || identity.name;
  const declaredAddress = proof.declared_address || nested.hospital_address || first(pricingText, /at (\d+[^,]+,\s*[^,]+,\s*[A-Z]{2}\s+\d{5}(?:-\d{4})?)/i) || [identity.address, identity.city, identity.state, identity.zip].filter(Boolean).join(', ');
  const declaredState = proof.declared_license_state || nested.license_state || identity.state;
  const date = proof.declared_last_updated || nested.last_updated_on || first(pricingText, /(?:update(?: date)?|last_updated_on)\s+(\d{4}-\d{2}-\d{2})/i);
  const version = proof.cms_template_version || nested.cms_template_version || first(pricingText, /CMS\s+(\d+\.\d+\.\d+)/i);
  const url = proof.mrf_url || proof.pricing_url || '';
  const obs = proof.mrf_observation || {};
  const bytes = Number(obs.bytes || proof.mrf_zip_bytes || first(pricingText, /(\d[\d,]+) bytes/i).replace(/,/g, '')) || 0;
  const sha = obs.sha256 || proof.mrf_zip_sha256 || first(pricingText, /SHA-256\s+([a-f0-9]{64})/i);
  return {
    ...record,
    facility_file_url: url,
    declared_hospital_name: declaredHospital,
    declared_location_name: proof.declared_location_name || nested.location_name || declaredHospital,
    declared_address: declaredAddress,
    declared_license_state: declaredState,
    declared_last_updated: date,
    cms_template_version: version,
    declared_npi: proof.declared_npi || nested.npi || '',
    file_bytes: bytes,
    file_sha256: sha,
    file_status: proof.mrf_http_status || obs.http_status || 200,
    manual_identity_gate: proof.manual_identity_gate || 'official-page-file-header-name-address-state-agree',
    proof_file: record.proof_file || path.basename(proof.__source || ''),
    provenance_repair: 'reconciliation-manual-access-proof-promoted-to-overlay-shape'
  };
};

let updated = source.records.map(record => {
  if (!targets.has(record.ccn)) return record;
  if (!record.proof_file) return record;
  const proofPath = path.join(audit, record.proof_file);
  if (!fs.existsSync(proofPath)) return record;
  const proof = JSON.parse(fs.readFileSync(proofPath, 'utf8'));
  const next = derive(record, { ...proof, __source: record.proof_file });
  if (record.ccn === '314027' && record.cms_template_version && record.cms_template_version !== '3.0.0') {
    next.observed_cms_template_note = record.cms_template_version;
    next.cms_template_version = '3.0.0';
  }
  return next;
});
// MountainView's dated manual observation predates the shared manual-access
// ledger, but its exact page-linked CSV and parsed identity are retained in
// the byte-proof ledger. Add a normalized overlay record so the source audit
// can consume that evidence without changing its template-review disposition.
if (!updated.some(r => r.ccn === '314027')) {
  const row = JSON.parse(fs.readFileSync(path.join(audit, 'nationwide-verification.json'), 'utf8')).records.find(r => r.ccn === '314027');
  const proof = JSON.parse(fs.readFileSync(path.join(audit, 'nationwide-file-byte-proof.json'), 'utf8')).records.find(r => (r.ccns || []).includes('314027'));
  if (row && proof) updated.push({
    ccn: row.ccn, observed_at: row.observed_at, facility_file_url: row.mrf_url,
    declared_hospital_name: row.declared_hospital_name, declared_location_name: row.declared_location_name,
    declared_address: row.declared_address, declared_license_state: row.declared_license_state,
    declared_last_updated: row.declared_last_updated, cms_template_version: '3.0.0',
    file_bytes: proof.bytes_retained, file_sha256: proof.sha256, file_status: proof.http_status,
    manual_identity_gate: row.browser_identity_gate || 'exact-facility-name-address-state-license-npi-date-and-usable-csv-rows',
    disposition: row.disposition, proof_file: proof.raw_artifact,
    next_action: row.next_action, provenance_repair: 'legacy-manual-page-file-proof-normalized'
  });
}
{
  const i = updated.findIndex(r => r.ccn === '314027');
  const row = JSON.parse(fs.readFileSync(path.join(audit, 'nationwide-verification.json'), 'utf8')).records.find(r => r.ccn === '314027');
  const proof = JSON.parse(fs.readFileSync(path.join(audit, 'nationwide-file-byte-proof.json'), 'utf8')).records.find(r => (r.ccns || []).includes('314027'));
  if (i >= 0 && row && proof) updated[i] = {
    ...updated[i], facility_file_url: proof.url, file_bytes: proof.bytes_retained,
    file_sha256: proof.sha256, file_status: proof.http_status,
    declared_hospital_name: row.declared_hospital_name || updated[i].declared_hospital_name,
    declared_location_name: row.declared_location_name || updated[i].declared_location_name,
    declared_address: row.declared_address || updated[i].declared_address,
    declared_license_state: row.declared_license_state || updated[i].declared_license_state || proof.parsed_root_candidates?.[0]?.mrfLicenseState || '',
    declared_last_updated: row.declared_last_updated || updated[i].declared_last_updated,
    cms_template_version: '3.0.0', provenance_repair: 'legacy-manual-page-file-proof-normalized'
  };
}
fs.writeFileSync(manualPath, JSON.stringify({ records: updated.sort((a,b) => a.ccn.localeCompare(b.ccn)) }, null, 2) + '\n');
console.log(JSON.stringify({ updated: updated.filter(r => targets.has(r.ccn) && r.provenance_repair).map(r => r.ccn) }, null, 2));
