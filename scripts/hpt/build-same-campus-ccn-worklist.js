'use strict';

// Exact duplicate roster identities are leads for enrollment-transition review.
// A shared campus and file never proves that two different CCNs are simultaneously
// covered by one current MRF.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { normalizeName } = require('./lib/util');

const root = path.resolve(__dirname, '../..');
const sourcePaths = {
  roster: 'cms_data/hpt/roster.json',
  reconciliation: 'data/hpt-audit/nationwide-reconciliation.json',
  cmsEnrollmentReview: 'data/hpt-audit/same-campus-cms-enrollment-snapshot-review.json',
  manualObservations: 'data/hpt-audit/reconciliation-manual-access-observations.json',
};

function build(roster, reconciliation, cmsEnrollmentReview, manualObservations = { records: [] }) {
  const byCcn = new Map(reconciliation.records.map(row => [row.ccn, row]));
  const enrollmentByCcn = new Map((cmsEnrollmentReview?.records || []).map(row => [row.ccn, row]));
  const historicalProofsByCcn = new Map();
  const collectProofFiles = (value, proofs = new Set()) => {
    if (!value || typeof value !== 'object') return proofs;
    if (Array.isArray(value)) {
      for (const item of value) collectProofFiles(item, proofs);
      return proofs;
    }
    if (typeof value.proof_file === 'string') proofs.add(value.proof_file);
    for (const item of Object.values(value)) collectProofFiles(item, proofs);
    return proofs;
  };
  for (const record of manualObservations?.records || []) {
    const proofs = historicalProofsByCcn.get(record.ccn) || new Set();
    collectProofFiles(record, proofs);
    historicalProofsByCcn.set(record.ccn, proofs);
  }
  const byIdentity = new Map();
  for (const facility of roster) {
    const key = [facility.name, facility.address, facility.city, facility.state, facility.zip]
      .map(normalizeName).join('|');
    const group = byIdentity.get(key) || [];
    group.push(facility);
    byIdentity.set(key, group);
  }
  const groups = [...byIdentity.values()]
    .filter(group => group.length > 1 && new Set(group.map(item => item.type)).size > 1)
    .map(group => {
      const facilities = group.sort((a, b) => a.ccn.localeCompare(b.ccn));
      const records = facilities.map(facility => {
        const review = byCcn.get(facility.ccn);
        if (!review) throw new Error(`Missing reconciled CCN ${facility.ccn}`);
        return {
          ccn: facility.ccn,
          roster_type: facility.type,
          standing_finding: review.standing_finding,
          current_disposition: review.proposed_disposition,
          workstream: review.workstream,
          standing_mrf_url: review.standing_mrf_url || '',
          candidate_mrf_url: review.candidate_mrf_url || '',
          reviewed_at: review.manual_access_observation?.observed_at || '',
          manual_proof_file: review.manual_access_observation?.proof_file || '',
          historical_manual_proof_files: [...(historicalProofsByCcn.get(facility.ccn) || [])].sort(),
          existing_next_action: review.manual_access_observation?.next_action
            || review.reviewed_header_disposition?.next_action || '',
          cms_enrollment_snapshot: enrollmentByCcn.get(facility.ccn) || null,
        };
      });
      const links = records.map(record => record.standing_mrf_url).filter(Boolean);
      const sharedStandingFile = links.length === records.length && new Set(links).size === 1;
      const ccns = records.map(record => record.ccn);
      const clintonTransitionReviewed = ccns.join(',') === '370245,370784'
        && records.every(record => record.manual_proof_file === 'reconciliation-clinton-reh-transition-proof.json');
      const qiesTransitionReviewed = ['010110,010779', '010125,011311'].includes(ccns.join(','))
        && records.every(record => record.historical_manual_proof_files
          .includes('reconciliation-qies-unresolved-status-audit-2026-09-27.json'));
      const neshobaTransitionReviewed = ccns.join(',') === '250043,251340'
        && records.every(record => record.historical_manual_proof_files
          .includes('reconciliation-neshoba-ccn-transition-proof.json'))
        && records.some(record => record.historical_manual_proof_files
          .includes('reconciliation-neshoba-cms-pos-transition-proof-2026-09-27.json'));
      const neshobaTransitionAction = 'CMS QIES Q1 2026 records acute-care CCN 250043 with a 2025-12-31 termination date and active CAH CCN 251340 from 2026-01-01. Preserve 250043 as historical and inspect only its pre-termination HPT evidence; do not seek a current 250043 file or assign the June 2026 campus MRF to it. Keep the active CAH file-to-CCN assignment unresolved until a current root pointer or publisher statement binds the exact MRF to 251340. The bulk-vs-exact QIES query discrepancy also needs a raw-body refresh when CMS access permits.';
      const qiesTransitionAction = ccns.join(',') === '010110,010779'
        ? 'CMS QIES Q1 2026 records acute-care CCN 010110 terminated 2024-04-30 and REH CCN 010779 began participation 2024-05-01 at the same name/address, matching the first-party conversion date. Preserve 010110 as historical and inspect its pre-conversion HPT evidence independently. Keep 010779 separate and obtain a current CMS 3.0.0 replacement; do not transfer the REH MRF to 010110.'
        : 'CMS QIES Q1 2026 records acute-care CCN 010125 terminated 2025-11-13 and CAH CCN 011311 began participation 2025-11-14 at the same name/address. Preserve 010125 as historical and inspect its pre-termination HPT evidence independently. Keep 011311 separate and resolve its own current pointer/MRF; do not transfer files or evidence between these CCNs.';
      return {
        ccns,
        name: facilities[0].name,
        address: facilities[0].address,
        city: facilities[0].city,
        state: facilities[0].state,
        zip: facilities[0].zip,
        records,
        shared_standing_file_url: sharedStandingFile ? links[0] : '',
        priority: clintonTransitionReviewed || qiesTransitionReviewed || neshobaTransitionReviewed ? 2
          : sharedStandingFile || records.some(record => record.workstream === 'consistent') ? 1 : 2,
        disposition: neshobaTransitionReviewed
          ? 'same-campus-acute-to-cah-transition-recorded-historical-and-current-file-scope-pending'
          : qiesTransitionReviewed
          ? 'same-campus-qies-effective-dated-transition-recorded-mrf-scope-pending'
          : clintonTransitionReviewed
          ? 'same-campus-cms-confirmed-reh-transition-scope-reviewed'
          : 'same-campus-distinct-ccn-enrollment-scope-review',
        next_action: neshobaTransitionReviewed
          ? neshobaTransitionAction
          : qiesTransitionReviewed
          ? qiesTransitionAction
          : clintonTransitionReviewed
          ? 'CMS enrollment confirms 370784 converted from former hospital CCN 370245 on 2025-12-02. The current pointer-linked JSON matches the REH NPI, address and state and has been promoted only for 370784. Preserve 370245 as a separate historical record, with no current-file inheritance or inferred historical file; recheck the REH only on publisher change.'
          : `Confirm primary CMS enrollment/status and effective dates for CCNs ${ccns.join(' and ')}${records.some(record => record.cms_enrollment_snapshot) ? '; the sampled CMS Hospital Enrollments snapshot is not a transition-date history' : ''}. Determine whether the current publisher file covers one enrollment, both explicitly, or a historical period; do not infer CCN scope from identical hospital name and street address. Preserve each CCN's standing history and investigate any file or pointer access issue independently.`,
      };
    }).sort((a, b) => a.priority - b.priority || a.ccns[0].localeCompare(b.ccns[0]));
  return {
    summary: {
      groups: groups.length,
      ccns: groups.reduce((count, group) => count + group.ccns.length, 0),
      shared_standing_file_groups: groups.filter(group => group.shared_standing_file_url).length,
      priority_one_groups: groups.filter(group => group.priority === 1).length,
    },
    groups,
    limitation: 'Exact same-name, street, city, state and ZIP roster rows with different facility types are an enrollment-scope lead, not evidence that either CCN is currently active or that a shared MRF covers both. Confirm effective dates from a primary enrollment source before changing a CCN-specific verification claim.',
  };
}

function main() {
  const bytes = Object.fromEntries(Object.entries(sourcePaths).map(([key, relative]) =>
    [key, fs.readFileSync(path.join(root, relative))]));
  const result = build(JSON.parse(bytes.roster), JSON.parse(bytes.reconciliation),
    JSON.parse(bytes.cmsEnrollmentReview), JSON.parse(bytes.manualObservations));
  result.source_sha256 = Object.fromEntries(Object.entries(sourcePaths).map(([key, relative]) =>
    [relative, crypto.createHash('sha256').update(bytes[key]).digest('hex')]));
  const output = path.join(root, 'data/hpt-audit/same-campus-ccn-transition-worklist.json');
  fs.writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result.summary));
}

if (require.main === module) main();
module.exports = { build };
