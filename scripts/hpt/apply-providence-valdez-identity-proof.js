'use strict';
const fs = require('fs');
const path = require('path');
const { csvToObjects } = require('./lib/util');
const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const proof = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-providence-valdez-identity-proof.json'), 'utf8'));
const base = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8')).find(row => row.ccn === proof.ccn);
if (!base) throw new Error('Missing Providence Valdez compliance base');
const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
const evidence = {
  identity: 'corroborated', identity_basis: proof.identity_basis,
  pointerUrl: 'https://providence.org/cms-hpt.txt',
  pointerSha256: 'b8eac725ab54836f3bfaa189bf44ac848c2dc87f23a56133a3454bdf6bd2a5d5',
  url: proof.mrf_url, http_status: 206, checked_at: proof.observed_at, date: proof.mrf_declared_date,
  version: proof.mrf_version, officialDomain: 'providence.org',
  location_name: proof.mrf_location_name, declared_hospital_name: proof.mrf_declared_hospital_name,
  declared_address: proof.mrf_declared_address, declared_license_state: proof.mrf_declared_license_state,
  file_kind: 'json', sourcePageUrl: proof.official_facility_page,
  sourcePageSha256: proof.official_facility_page_sha256,
  identityPageUrl: proof.official_contact_page, identityPageSha256: proof.official_contact_page_sha256,
  ownershipBridgeUrl: proof.ownership_bridge_url, ownershipBridgeExcerpt: proof.ownership_bridge_excerpt,
  observedFinding: 'compliant-observed'
};
const entry = { ccn: proof.ccn, base, action: 'replace', evidence,
  evidence_run: 'providence-valdez-city-owner-operator-bridge-2026-09-17', reviewed_at: proof.observed_at,
  note: proof.note };
const oldIndex = ledger.findIndex(row => row.ccn === proof.ccn);
if (oldIndex >= 0) ledger[oldIndex] = entry; else ledger.push(entry);
ledger.sort((a,b)=>a.ccn.localeCompare(b.ccn));
fs.writeFileSync(ledgerPath, `${JSON.stringify(ledger,null,2)}\n`);
console.log(JSON.stringify({applied: proof.ccn, finding: 'compliant-observed'}, null, 2));
