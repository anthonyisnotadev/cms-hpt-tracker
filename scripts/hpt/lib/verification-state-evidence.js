'use strict';

const ACCEPTED_ADDRESS_STATE_GATES = new Map([
  ['recorded-file-name-street-state-agree', 'state-in-file-address'],
  ['reviewed-file-address-equivalence', 'reviewed-address-state']
]);

function verificationStateEvidence(declaredLicenseState, rosterState, identityGate = '') {
  const declared = String(declaredLicenseState || '').trim().toUpperCase();
  const roster = String(rosterState || '').trim().toUpperCase();
  if (declared) return declared === roster
    ? { status: 'corroborated', basis: 'license-state-field' }
    : { status: 'conflict', basis: 'license-state-field', declared_state: declared, roster_state: roster };
  const basis = ACCEPTED_ADDRESS_STATE_GATES.get(identityGate);
  return basis ? { status: 'corroborated', basis } : { status: 'missing', basis: 'none' };
}

module.exports = { ACCEPTED_ADDRESS_STATE_GATES, verificationStateEvidence };
