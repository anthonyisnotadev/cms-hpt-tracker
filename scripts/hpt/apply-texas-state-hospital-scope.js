'use strict';

const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const proof = JSON.parse(fs.readFileSync(path.join(audit,
  'reconciliation-texas-state-hospital-scope-proof-2026-09-27.json'), 'utf8'));
// This historical proof establishes Texas state operation and facility identity,
// not CMS's narrower deemed-compliant exception. CMS's FAQ says state-owned or
// operated facilities are in scope except those separately deemed compliant;
// it names state forensic hospitals treating exclusively people in penal custody.
// Refuse to replay the superseded broad state-hospital interpretation.
const cmsDeemedCompliantBasis = proof.facility_dispositions.every(item =>
  item.state_forensic_exclusive_penal_custody === true)
  ? 'state-forensic-hospital-exclusive-penal-custody' : null;
if (cmsDeemedCompliantBasis !== 'state-forensic-hospital-exclusive-penal-custody')
  throw new Error('Refusing Texas scope promotion: the retained proof establishes state-hospital identity only, not exclusive penal-custody operation required by CMS guidance. Keep scope-review-pending until an exact CMS exception is evidenced.');
const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
const compliancePath = path.join(audit, 'compliance.csv');
const { csvToObjects } = require('./lib/util');
const rows = csvToObjects(fs.readFileSync(compliancePath, 'utf8'));
const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
const targetCCNs = ['454000', '454006', '454008', '454009', '454011', '454084', '454088', '454100'];
const byCcn = new Map(rows.map(row => [row.ccn, row]));
const records = targetCCNs.map(ccn => {
  const scope = proof.facility_dispositions.find(item => item.ccn === ccn);
  const base = byCcn.get(ccn);
  if (!scope || !base || scope.basis.startsWith('Not dispositioned')) throw new Error(`Missing safe Texas scope evidence for ${ccn}`);
  const entry = {
    ccn, base, action: 'exempt-state-hospital',
    evidence: {
      facilityName: scope.facility_name,
      facilityUrl: scope.facility_url,
      checked_at: proof.observed_at,
      stateOperatorAuthority: proof.texas_operator_authority,
      stateOperatorSource: proof.texas_operator_source,
      stateHospitalStatuteSource: proof.texas_hospital_statute_source,
      federalRuleSource: proof.federal_rule_source,
      federalRuleSection: proof.federal_rule_section,
      cmsDeemedCompliantBasis,
      penalCustodyOnly: true,
      cmsGuidanceSource: 'https://www.cms.gov/files/document/hospital-price-transparency-frequently-asked-questions.pdf',
      stateHospitalStatuteFacilities: proof.facility_dispositions.filter(item =>
        !item.basis.startsWith('Not dispositioned')).map(item => item.facility_name)
    },
    official: { domain: 'hhs.texas.gov', page: scope.facility_url },
    evidence_run: 'texas-state-hospital-hpt-scope-review-2026-09-27',
    reviewed_at: proof.observed_at,
    note: `${scope.facility_name} is an exact Texas state-hospital facility match under current state-law/HHSC sources. 45 CFR §180.30(b) deems Federal and State hospitals compliant with Part 180. This is a federal scope classification, not a pointer/MRF finding; no file, pricing, metadata, or rates are asserted.`
  };
  return entry;
});
const replaceSet = new Set(targetCCNs);
const next = [...ledger.filter(item => !replaceSet.has(item.ccn)), ...records].sort((a, b) => a.ccn.localeCompare(b.ccn));
fs.writeFileSync(ledgerPath, `${JSON.stringify(next, null, 2)}\n`);
console.log(JSON.stringify({ applied: records.map(item => item.ccn), preservedAddressVariation: ['454088'] }, null, 2));
