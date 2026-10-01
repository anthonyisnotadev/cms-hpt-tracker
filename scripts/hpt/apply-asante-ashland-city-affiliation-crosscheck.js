'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const proofName = 'reconciliation-asante-ashland-city-affiliation-termination-crosscheck-2026-09-29.json';
const proof = JSON.parse(fs.readFileSync(path.join(audit, proofName), 'utf8'));
const manualPath = path.join(audit, 'reconciliation-manual-access-observations.json');
const manual = JSON.parse(fs.readFileSync(manualPath, 'utf8'));
const row = manual.records.find(record => record.ccn === proof.ccn);
if (!row) throw new Error(`Missing manual-access record for ${proof.ccn}`);
if (row.latest_city_affiliation_termination_crosscheck_2026_09_29)
  throw new Error('Asante Ashland City affiliation cross-check is already applied');
row.latest_city_affiliation_termination_crosscheck_2026_09_29 = {
  observed_at: proof.observed_at,
  proof_file: proofName,
  source_url: proof.source.url,
  publication_date: proof.source.published_at,
  agreement_termination_effective_date: proof.transition_timeline.municipal_affiliation_agreement_termination_effective_date,
  result: 'new independent municipal source corroborates satellite transition and City-Asante agreement end; no CMS CCN status or MRF scope determination',
  disposition_effect: proof.disposition_effect,
  count_effect: proof.count_effect,
  next_action: proof.next_action
};
fs.writeFileSync(manualPath, JSON.stringify(manual, null, 2) + '\n');

const browserPath = path.join(audit, 'nationwide-browser-reviews.json');
const browser = JSON.parse(fs.readFileSync(browserPath, 'utf8'));
if (browser.records.some(record => record.proof_file === proofName))
  throw new Error('Asante Ashland City browser observation is already applied');
browser.records.push({
  kind: 'official-municipal-transition-crosscheck',
  ccn: proof.ccn,
  target: proof.source.url,
  final_url: proof.source.url,
  status: 'city-confirms-satellite-transition-and-ends-affiliation-agreement',
  title: proof.source.title,
  detail: proof.interpretation,
  browser: 'web-browser-official-municipal-archive',
  http_status: 200,
  bytes_read: 0,
  identity: proof.evidence_classification,
  declared_hospital_name: 'Ashland Community Hospital',
  declared_location_name: 'Ashland Community Hospital / Rogue Regional satellite campus',
  declared_address: '',
  declared_license_state: 'OR',
  declared_last_updated: proof.source.published_at,
  cms_template_version: '',
  observed_at: proof.observed_at,
  proof_file: proofName,
  source_page_url: proof.source.url,
  pointer_url: 'https://www.asante.org/cms-hpt.txt',
  mrf_url: 'https://www.asante.org/app/files/public/361f9b00-187a-4091-ba37-1c3308bed5eb/AsanteRogueRegionalMedicalCenter_StandardCharges.zip',
  file_sha256: '',
  next_action: proof.next_action
});
fs.writeFileSync(browserPath, JSON.stringify(browser, null, 2) + '\n');

console.log(JSON.stringify({ applied_ccn: proof.ccn, proof: proofName, disposition_effect: proof.disposition_effect }, null, 2));
