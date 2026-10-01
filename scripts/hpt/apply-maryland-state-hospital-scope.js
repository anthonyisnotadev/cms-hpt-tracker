'use strict';

const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const proof = JSON.parse(fs.readFileSync(path.join(audit,
  'reconciliation-maryland-state-hospital-scope-proof-2026-09-27.json'), 'utf8'));
const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
const compliancePath = path.join(audit, 'compliance.csv');
const observationsPath = path.join(audit, 'reconciliation-manual-access-observations.json');
const { csvToObjects } = require('./lib/util');
const rows = csvToObjects(fs.readFileSync(compliancePath, 'utf8'));
const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
const observations = JSON.parse(fs.readFileSync(observationsPath, 'utf8'));
const targets = proof.facility_dispositions.map(scope => scope.ccn);
const byCcn = new Map(rows.map(row => [row.ccn, row]));
const cmsByCcn = new Map(proof.cms_enrollment_dataset.records.map(record => [record.ccn, record]));

const records = targets.map(ccn => {
  const scope = proof.facility_dispositions.find(item => item.ccn === ccn);
  const cms = cmsByCcn.get(ccn);
  const base = byCcn.get(ccn);
  if (!scope || !cms || !base || cms.row_count !== 1 || cms.organization_name !== 'COMPTROLLER OF MARYLAND CENTRAL PAYROLL BUREAU'
      || cms.doing_business_as !== scope.facility_name || !cms.response_sha256 || !cms.source_url)
    throw new Error(`Missing exact CMS/MDH state-hospital scope evidence for ${ccn}`);
  return {
    ccn,
    base,
    action: 'exempt-state-hospital',
    evidence: {
      facilityName: scope.facility_name,
      facilityUrl: scope.facility_url,
      checked_at: proof.observed_at,
      cmsEnrollmentDataset: proof.cms_enrollment_dataset.dataset_page,
      cmsEnrollmentDatasetVersion: proof.cms_enrollment_dataset.dataset_version_id,
      cmsEnrollmentQuery: `${proof.cms_enrollment_dataset.query_template.replace('{CCN}', ccn)}`,
      cmsEnrollmentResponseSha256: cms.response_sha256,
      cmsEnrollmentResponseBytes: cms.response_bytes,
      cmsEnrollmentId: cms.enrollment_id,
      cmsEnrollmentOrganization: cms.organization_name,
      cmsEnrollmentDoingBusinessAs: cms.doing_business_as,
      cmsEnrollmentAddress: cms.address,
      cmsProviderType: cms.provider_type,
      mdhFacilityRoster: proof.state_operator_sources.mdh_facility_roster,
      mdhOperatorPage: scope.facility_url,
      federalRuleSource: proof.federal_rule.source,
      federalRuleSection: proof.federal_rule.section,
      cmsGuidanceSource: proof.federal_rule.cms_guidance
    },
    official: { domain: 'health.maryland.gov', page: scope.facility_url },
    evidence_run: 'maryland-state-hospital-hpt-scope-review-2026-09-27',
    reviewed_at: proof.observed_at,
    note: `${scope.facility_name} has an exact CMS Hospital Enrollments row naming the Maryland Comptroller and the exact hospital DBA/address, aligned with MDH's inpatient psychiatric hospital roster. 45 CFR §180.30(b) deems State hospitals compliant with Part 180. This is a federal scope classification, not a pointer/MRF finding; no file, pricing, metadata, or rates are asserted.`
  };
});

const targetSet = new Set(targets);
const nextLedger = [...ledger.filter(item => !targetSet.has(item.ccn)), ...records]
  .sort((a, b) => a.ccn.localeCompare(b.ccn));
fs.writeFileSync(ledgerPath, `${JSON.stringify(nextLedger, null, 2)}\n`);

for (const ccn of targets) {
  const item = observations.records.find(record => record.ccn === ccn);
  const scope = proof.facility_dispositions.find(record => record.ccn === ccn);
  const cms = cmsByCcn.get(ccn);
  if (!item) throw new Error(`Missing manual-access record for ${ccn}`);
  item.latest_scope_review = {
    observed_at: proof.observed_at,
    proof_file: 'reconciliation-maryland-state-hospital-scope-proof-2026-09-27.json',
    cms_enrollment_response_sha256: cms.response_sha256,
    cms_enrollment_id: cms.enrollment_id,
    cms_enrollment_name_address_match: true,
    state_hospital_scope: 'deemed-compliant-under-45-CFR-180.30(b)',
    pointer_mrf_status: 'unresolved-not-asserted-by-this-scope-classification',
    interpretation: `${scope.facility_name} is scope-classified as a Maryland state hospital using the exact CMS enrollment identity and MDH facility/operator evidence. No MRF or pricing claim is made; sibling state files remain excluded.`,
    next_action: proof.next_action
  };
}
fs.writeFileSync(observationsPath, `${JSON.stringify(observations, null, 2)}\n`);

console.log(JSON.stringify({ applied: targets, excludedSiblingFiles: true, pricingClaims: 0 }, null, 2));
