'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { csvToObjects } = require('./lib/util');
const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const proof = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-sparrow-state-conflicts.json')));
const pointer = fs.readFileSync(path.join(root, 'cms_data/hpt/pointer-corpus/raw/uofmhealthsparrow.org-2e87ccdc4596.txt'));
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const bases = new Map(csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8')).map(row => [row.ccn, row]));
const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
if (sha(pointer) !== proof.pointer_sha256 || proof.records.length !== 4)
  throw new Error('Sparrow root proof changed');
const applied = [];
for (const record of proof.records) {
  const base = bases.get(record.ccn);
  const sample = fs.readFileSync(path.join(root, record.retained_sample));
  if (!base || base.finding !== 'not-assessed-not-named-in-file' || base.state !== 'MI'
      || record.facility_state !== 'MI' || record.declared_license_state !== 'CA'
      || sha(sample) !== record.retained_sha256 || sample.length !== 262144
      || !pointer.toString('utf8').includes(`mrf-url: ${record.mrf_url}`)
      || record.declared_date !== '2026-04-01'
      || !['3.1.0', '4.1.0'].includes(record.declared_version))
    throw new Error(`Sparrow ${record.ccn} source/base conflict`);
  const evidence = { identity: 'corroborated',
    identity_basis: 'exact-first-party-sparrow-campus-page-root-pointer-pricing-page-and-file-header-with-license-state-conflict',
    officialDomain: 'uofmhealthsparrow.org', identityPageUrl: record.facility_page_url,
    identityPageSha256: record.facility_page_sha256, sourcePageUrl: proof.source_page_url,
    sourcePageSha256: proof.source_page_sha256, pointerUrl: proof.pointer_url,
    pointerSha256: proof.pointer_sha256, url: record.mrf_url, fileSha256: record.retained_sha256,
    http_status: record.mrf_http_status, checked_at: record.observed_at,
    date: record.declared_date, version: record.declared_version,
    location_name: record.pointer_location_name, declared_hospital_name: record.declared_hospital_name,
    declared_address: record.declared_address, declared_license_state: record.declared_license_state,
    facility_state: record.facility_state, file_kind: 'csv',
    observedFinding: 'mrf-license-state-field-conflicts-facility',
    next_action: `Ask the publisher to confirm or correct the CA license-number field for this Michigan campus; separately review declared version ${record.declared_version}${record.ccn === '231326' ? ' and the file address spelling' : ''}, then validate the complete CSV before any clean-file or legal-compliance conclusion.` };
  const entry = { ccn: record.ccn, base, action: 'replace-observation', evidence,
    evidence_run: 'sparrow-four-campus-license-state-conflicts-2026-09-17', reviewed_at: record.observed_at,
    note: `The current first-party campus page, root pointer, pricing-page link and sampled CSV identify ${record.pointer_location_name} in Michigan. The CSV nevertheless labels its license-number column CA, while the campus is in MI; its declared version is literally ${record.declared_version}.${record.ccn === '231326' ? ' The address also spells Oakland as Streen.' : ''} This is a bounded metadata conflict, not complete-file validation or a legal compliance verdict.` };
  const old = ledger.find(row => row.ccn === record.ccn);
  if (old) { if (old.evidence_run !== entry.evidence_run || JSON.stringify(old.evidence) !== JSON.stringify(evidence)) throw new Error(`Existing nonmatching ${record.ccn} resolution`); continue; }
  ledger.push(entry); applied.push(record.ccn);
}
ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
console.log(JSON.stringify({ applied }));
