const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const observedAt = '2026-10-01T14:32:59.260Z';
const ccn = '231319';
const proofFile = 'reconciliation-aspirus-231319-current-pointer-recheck-proof-2026-10-01.json';
const mrfUrl = 'https://www.aspirus.org/Uploads/Public/Documents/PriceEstimate/TransparencyFY27/381443361_1326115569_aspirus-keweenaw-hospital_standardcharges.json';
const proof = {
  ccn,
  observed_at: observedAt,
  official_domain: 'https://www.aspirus.org/',
  pointer_url: 'https://www.aspirus.org/cms-hpt.txt',
  pointer_status: 200,
  pointer_byte_count: 5768,
  pointer_declared_mrf_url: mrfUrl,
  mrf_url: mrfUrl,
  mrf_status: 206,
  mrf_sample_bytes: 8192,
  mrf_sample_sha256: 'aec47f6f79665b50634f43f54537be026ad738b7cba6b4dbedf3d601463b5f80',
  declared_hospital_name: 'Aspirus Keweenaw Hospital',
  declared_location_name: 'Aspirus Keweenaw Hospital',
  declared_address: '205 Osceola, Laurium, MI 49913',
  declared_license_state: 'MI',
  declared_last_updated: '2026-04-01',
  cms_template_version: '3.0.0',
  attestation: true,
  file_kind: 'json',
  identity_basis: '2026-10-01 recheck: the current FY27 root pointer still names Aspirus Keweenaw Hospital exactly (no shared-system sibling) and the bounded JSON header again agrees on facility name, exact address, license state MI, 2026-04-01 date (within 365 days), CMS 3.0.0, and attestation. Sample hash covers bytes 0-8191 only.',
  next_action: 'Retain as verified current MRF and recheck on the next pointer update.'
};
const manualPath = path.join(audit, 'reconciliation-manual-access-observations.json');
const manual = JSON.parse(fs.readFileSync(manualPath, 'utf8'));
const existing = manual.records.find(r => r.ccn === ccn && r.observed_at === observedAt);
if (!existing) {
  manual.records.push({
    ...proof,
    proof_file: proofFile,
    manual_disposition: 'verified-current-mrf',
    disposition: 'verified-current-mrf',
    manual_identity_gate: 'official-pointer-current-fy27-json-exact-name-address-state-date-template-attestation-agree-recheck-2026-10-01'
  });
  manual.records.sort((a, b) => a.ccn.localeCompare(b.ccn));
  fs.writeFileSync(manualPath, JSON.stringify(manual, null, 2) + '\n');
}
console.log(JSON.stringify({ applied: [ccn], changed: !existing }, null, 2));
