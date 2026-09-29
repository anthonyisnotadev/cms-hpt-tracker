'use strict';
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const proofName = 'reconciliation-eureka-springs-current-full-zip-recheck-proof-2026-09-25.json';
const proof = JSON.parse(fs.readFileSync(path.join(audit, proofName), 'utf8'));
const manualPath = path.join(audit, 'reconciliation-manual-access-observations.json');
const manual = JSON.parse(fs.readFileSync(manualPath, 'utf8'));
const index = manual.records.findIndex((record) => record.ccn === proof.ccn);
if (index < 0) throw new Error(`missing manual observation for ${proof.ccn}`);
const prior = manual.records[index];
manual.records[index] = {
  ...prior,
  observed_at: proof.observed_at,
  proof_file: proofName,
  official_pricing_page: proof.official_pricing_page,
  pricing_resource_url: proof.page_mrf_url,
  pricing_resource_status: proof.retrieval.status,
  archive_member: proof.retrieval.archive_member,
  archive_member_bytes: proof.retrieval.member_bytes,
  archive_member_sha256: proof.retrieval.member_sha256,
  archive_bytes: proof.retrieval.zip_bytes,
  archive_sha256: proof.retrieval.zip_sha256,
  metadata_result: proof.retrieval.metadata_result,
  disposition: proof.disposition,
  next_action: proof.next_action,
  prior_observation: {
    observed_at: prior.observed_at,
    disposition: prior.disposition,
    next_action: prior.next_action,
  },
};
manual.records.sort((a, b) => a.ccn.localeCompare(b.ccn));
fs.writeFileSync(manualPath, JSON.stringify(manual, null, 2) + '\n');
console.log(JSON.stringify({ updated: proof.ccn, observed_at: proof.observed_at, disposition: proof.disposition }, null, 2));
