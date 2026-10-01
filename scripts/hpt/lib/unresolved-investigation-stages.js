'use strict';

// Shared by the reconciliation inventory and its actionable worklist so a
// current unresolved disposition cannot carry an outdated verified instruction.
const stages = {
  'verified-template-review': {
    tier: 2, gate: 'publisher-corrected-cms-version-3.0.0',
    action: 'Request a corrected exact linked file declaring CMS template version 3.0.0; preserve the validator version alert and do not label the current 3.0 file verified-current.',
  },
  'mrf-facility-identity-unresolved': {
    tier: 1, gate: 'file-identity',
    action: 'Compare the exact pointer-linked file header with the roster and current first-party facility page; quarantine a sibling or conflicting file.',
  },
  'linked-mrf-header-unmatched': {
    tier: 1, gate: 'file-header',
    action: 'Retain bounded bytes from the exact pointer-declared file and adjudicate its declared hospital, location, address, state, date and version.',
  },
  'pointer-linked-file-not-probed': {
    tier: 1, gate: 'file-header',
    action: 'Retrieve bounded bytes from the exact pointer-declared file, then check facility identity and declared metadata before any verification claim.',
  },
  'pointer-linked-file-review-pending': {
    tier: 2, gate: 'pointer-file-page-reconciliation',
    action: 'Reconcile the reviewed pointer-linked file and current pricing-page download leads, including complete access and declared metadata, before a current-file finding.',
  },
  'file-custom-workbook-review': {
    tier: 2, gate: 'custom-workbook-identity-and-format',
    action: 'Determine whether the official workbook is an exact facility MRF and whether a CMS CSV/JSON replacement exists; do not assign a broader system workbook to this CCN.',
  },
  'mrf-request-unsuccessful': {
    tier: 1, gate: 'file-access',
    action: 'Retry the exact pointer-declared file using a materially different permitted client; preserve transport failure separately from file validity.',
  },
  'pointer-facility-match-unresolved': {
    tier: 2, gate: 'pointer-facility-match',
    action: 'Compare every root-pointer location entry against this CCN and first-party campus name/address; do not assign a shared-system sibling file.',
  },
  'pointer-access-denied-to-client': {
    tier: 3, gate: 'pointer-access',
    action: 'Open the exact official-domain root pointer in a materially different browser/client and record bytes, status and final URL; do not infer absence from access denial.',
  },
  'pointer-not-retrieved': {
    tier: 3, gate: 'pointer-retrieval',
    action: 'Inspect the first-party pricing page and its linked host, then retrieve that host’s root pointer with a bounded client.',
  },
  'pointer-discovery-incomplete': {
    tier: 4, gate: 'pointer-discovery',
    action: 'Confirm the hospital-owned site and pricing page, then test the exact root pointer and any page-linked file; preserve request failures as observations.',
  },
  'official-website-not-identified-completed-search': {
    tier: 5, gate: 'official-site-identity',
    action: 'Resolve the current legal/operator name and first-party site for the roster address before testing any pointer or file.',
  },
  'candidate-website-identity-unverified': {
    tier: 4, gate: 'official-site-identity',
    action: 'Verify the candidate against first-party hospital name and address evidence; only then test its pricing page, root pointer and facility-linked MRF.',
  },
};

const STALE_VERIFIED_ACTION = 'Retain as verified current MRF and recheck on the next pointer update.';

function requiresDispositionAction(manualObservation, proposedDisposition) {
  return manualObservation?.next_action === STALE_VERIFIED_ACTION
    && proposedDisposition !== 'verified-current-mrf';
}

module.exports = { STALE_VERIFIED_ACTION, requiresDispositionAction, stages };
