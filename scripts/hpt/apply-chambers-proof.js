'use strict';
const fs = require('fs');
const path = require('path');
const { csvToObjects } = require('./lib/util');
const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
const bases = new Map(csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8')).map(row => [row.ccn, row]));
const p = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-chambers-proof.json'), 'utf8'));
const bad = p.incorrect_standing_assignment, good = p.correct_official_candidate;
if (p.ccn !== '040011' || bad.declared_state !== 'TX' || good.declared_state !== 'AR'
    || bad.mrf_http_status !== 200 || good.mrf_http_status !== 200 || !bad.mrf_sha256 || !good.mrf_sha256)
  throw new Error('Incomplete Chambers identity-conflict proof');
const note = 'The standing chambershealth.org pointer and ClaraPrice JSON belong to Chambers Health in Anahuac, Texas, not CCN 040011 in Danville, Arkansas. The correct first-party chambershospital.com homepage links a PARA page and a current CMS v3 CSV whose name, 719 Detroit address and Arkansas state match the roster, but its root pointer returned a bot challenge without pointer fields. Quarantine the Texas assignment; retain the Arkansas CSV as a candidate pending exact pointer linkage.';
const record = {
  ccn: p.ccn, base: bases.get(p.ccn), action: 'quarantine', evidence: null,
  finding: 'not-assessed-identity-conflict', note,
  official: { domain: good.domain, page: good.official_homepage_url },
  reviewed_at: p.observed_at, evidence_run: 'chambers-domain-identity-review-2026-09-15',
  proof: {
    pointer_sha256: bad.pointer_sha256, payload_sha256: bad.mrf_sha256,
    observed_hospital_name: bad.declared_hospital_name, observed_address: bad.declared_address,
    observed_license_state: bad.declared_state, roster_state: p.roster.state,
    incorrect_pointer_url: bad.pointer_url, incorrect_pointer_sha256: bad.pointer_sha256,
    incorrect_mrf_url: bad.mrf_url, incorrect_file_sha256: bad.mrf_sha256,
    incorrect_identity: `${bad.declared_hospital_name}; ${bad.declared_address}; ${bad.declared_state}`,
    candidate_source_page_url: good.pricing_page_url, candidate_mrf_url: good.mrf_url,
    candidate_file_sha256: good.mrf_sha256, candidate_http_status: good.mrf_http_status,
    candidate_identity: `${good.declared_hospital_name}; ${good.declared_address}; ${good.declared_state}`,
    candidate_date: good.declared_date, candidate_version: good.version,
    correct_pointer_url: good.pointer_url, correct_pointer_status: good.pointer_direct_status,
    observed_at: p.observed_at, next_action: p.next_action
  }
};
const existing = ledger.find(row => row.ccn === p.ccn);
if (existing) {
  if (!(existing.action === record.action && existing.evidence_run === record.evidence_run))
    throw new Error(`Existing nonmatching resolution ${p.ccn}`);
  if (JSON.stringify(existing.proof) !== JSON.stringify(record.proof)) {
    Object.assign(existing, record);
    fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
  }
} else {
  ledger.push(record); ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
  fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
}
console.log(JSON.stringify({ applied: p.ccn, action: record.action, removed: bad.mrf_url, candidate: good.mrf_url }, null, 2));
