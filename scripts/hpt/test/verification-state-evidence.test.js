'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { verificationStateEvidence } = require('../lib/verification-state-evidence');

test('uses an agreeing license-state field when present', () => {
  assert.deepEqual(verificationStateEvidence('ca', 'CA'), {
    status: 'corroborated', basis: 'license-state-field'
  });
});

test('does not hide a conflicting license-state field behind address evidence', () => {
  assert.deepEqual(verificationStateEvidence('NV', 'CA', 'recorded-file-name-street-state-agree'), {
    status: 'conflict', basis: 'license-state-field', declared_state: 'NV', roster_state: 'CA'
  });
});

test('accepts independently gated state evidence when the separate field is absent', () => {
  assert.deepEqual(verificationStateEvidence('', 'CA', 'recorded-file-name-street-state-agree'), {
    status: 'corroborated', basis: 'state-in-file-address'
  });
  assert.deepEqual(verificationStateEvidence('', 'CA', 'reviewed-file-address-equivalence'), {
    status: 'corroborated', basis: 'reviewed-address-state'
  });
});

test('keeps a missing state unresolved without an accepted identity gate', () => {
  assert.deepEqual(verificationStateEvidence('', 'CA', 'file-address-reconciliation-required'), {
    status: 'missing', basis: 'none'
  });
});
