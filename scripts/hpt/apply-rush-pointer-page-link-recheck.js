'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const proofFile = 'reconciliation-rush-university-pointer-page-recheck-proof-2026-09-30.json';
const proof = JSON.parse(fs.readFileSync(path.join(audit, proofFile), 'utf8'));
const manualPath = path.join(audit, 'reconciliation-manual-access-observations.json');
const manual = JSON.parse(fs.readFileSync(manualPath, 'utf8'));

const target = proof.pointer?.matching_entry?.mrf_url;
const absoluteTarget = target && `https://${target.replace(/^https?:\/\//i, '')}`;
if (proof.ccn !== '140119'
  || proof.pointer?.matched_retained_pointer_hash !== true
  || proof.pointer?.matching_entry?.location_name !== 'Rush University Medical Center'
  || proof.first_party_page?.url !== 'https://www.rush.edu/patients-visitors/billing/cost-care'
  || proof.file_retrieval?.exact_url !== absoluteTarget
  || !/extracted absolute CSV URL exactly matches the root-pointer target/i.test(proof.first_party_page?.browser_observation || '')
  || proof.file_retrieval?.bytes_retrieved !== 0
  || proof.file_retrieval?.sha256 !== null
  || proof.evidence_accounting?.disposition_change !== false
  || proof.evidence_accounting?.count_change !== false) {
  throw new Error('Rush page/pointer proof failed exact target or no-file-evidence checks');
}
if (manual.records.some(record => record.ccn === proof.ccn))
  throw new Error('A manual observation already exists for Rush; review instead of duplicating');

const record = {
  ccn: proof.ccn,
  hospital_name: proof.hospital_name,
  observed_at: proof.observed_at,
  proof_file: proofFile,
  disposition: 'current-pointer-and-page-target-confirmed-file-bytes-unavailable-address-follow-up',
  pointer_url: proof.pointer.url,
  pointer_sha256: proof.pointer.sha256,
  pointer_location_name: proof.pointer.matching_entry.location_name,
  pointer_mrf_url: proof.pointer.matching_entry.mrf_url,
  official_pricing_page: proof.first_party_page.url,
  page_file_url: absoluteTarget,
  file_retrieval: {
    bounded_fetch: proof.file_retrieval.bounded_node_fetch,
    browser_navigation: proof.file_retrieval.browser_navigation,
    bytes_retained: 0,
    sha256: null,
    metadata_or_schema_reviewed: false
  },
  identity_address_follow_up: {
    cms_ccn_name_address: proof.identity_and_address.cms_ccn_name_address,
    cms_source: proof.identity_and_address.cms_source,
    current_first_party_location_address: proof.identity_and_address.rush_current_location_page_address,
    first_party_source: proof.identity_and_address.rush_source,
    interpretation: proof.identity_and_address.interpretation
  },
  evidence_accounting: proof.evidence_accounting,
  disposition_effect: proof.disposition_effect,
  next_action: proof.next_action
};
manual.records.push(record);
manual.records.sort((a, b) => a.ccn.localeCompare(b.ccn));
fs.writeFileSync(manualPath, `${JSON.stringify(manual, null, 2)}\n`);
console.log(JSON.stringify({ ccn: record.ccn, observation: record.disposition, next_action: record.next_action }));
