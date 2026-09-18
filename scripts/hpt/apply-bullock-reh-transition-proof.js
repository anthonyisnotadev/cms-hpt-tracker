'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '../..');
const proof = require(path.join(root, 'data/hpt-audit/reconciliation-bullock-reh-transition-proof.json')).record;
const observationPath = path.join(root, 'data/hpt-audit/reconciliation-manual-access-observations.json');
const observations = JSON.parse(fs.readFileSync(observationPath, 'utf8'));
if (proof.ccn_current_rural_emergency_hospital !== '010779'
    || proof.ccn_earlier_acute_care_hospital !== '010110'
    || proof.pointer_location_name !== 'Bullock County Rural Emergency Hospital'
    || proof.declared_license_state !== 'CA'
    || proof.declared_address !== '102 Conecuh Avenue West, Union Springs, AL 36089'
    || proof.file_retained_bytes !== 262144 || !fs.existsSync(path.join(root, proof.file_retained_sample))) {
  throw new Error('Bullock proof did not pass identity and state-conflict gates');
}
let applied = 0;
for (const [ccn, role, nextAction] of [
  ['010779', 'current-rural-emergency-hospital',
    'Resolve the explicit license_number|CA CSV header against the Alabama facility with corrected file or publisher evidence. The root pointer names this REH but the conflicting declared state prevents promotion; do not apply the same file to the historical acute-care CCN.'],
  ['010110', 'historical-acute-care-hospital',
    'Keep the acute-care CCN separate: the first-party page says the site converted to a Rural Emergency Hospital on 2024-05-01 and the current root pointer names the REH. Verify any historical acute-care file and period independently; do not assign the current REH pointer/file to this CCN.'],
]) {
  const entry = {
    ccn, observed_at: proof.observed_at,
    proof_file: 'reconciliation-bullock-reh-transition-proof.json',
    facility_role: role,
    official_pricing_page: proof.source_page_url,
    pointer_url: proof.pointer_url,
    pointer_location_name: proof.pointer_location_name,
    pointer_file_url: proof.pointer_mrf_url,
    pointer_file_sample_sha256: proof.file_sample_sha256,
    declared_file_name: proof.declared_hospital_name,
    declared_file_address: proof.declared_address,
    declared_license_state: proof.declared_license_state,
    expected_facility_state: 'AL',
    disposition: proof.disposition,
    next_action: nextAction,
  };
  const old = observations.records.find(item => item.ccn === ccn);
  if (old) {
    if (JSON.stringify(old) !== JSON.stringify(entry)) throw new Error(`Nonmatching existing Bullock observation for ${ccn}`);
  } else {
    observations.records.push(entry);
    applied++;
  }
}
if (applied) fs.writeFileSync(observationPath, `${JSON.stringify(observations, null, 2)}\n`);
console.log(JSON.stringify({ applied, ccns: ['010110', '010779'] }));
