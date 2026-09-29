'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { csvToObjects } = require('./lib/util');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const proofs = JSON.parse(fs.readFileSync(path.join(audit, 'claraprice-complete-metadata-2026-09-16.json'))).records;
const bases = new Map(csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8')).map(row => [row.ccn, row]));
const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
const ledger = JSON.parse(fs.readFileSync(ledgerPath));
const selected = ['061327', '170103', '271311', '281306', '281313', '281334', '281349', '281350', '451373', '671300', '671303', '450508', '471306'];
const applied = [];

for (const ccn of selected) {
  const proof = proofs.find(row => row.ccn === ccn);
  const base = bases.get(ccn);
  const identity = proof?.identity_review;
  if (!proof || !identity || !base || base.finding !== 'compliant-date-unverified'
      || base.pointer_url !== identity.pointer_url || base.mrf_url !== proof.url
      || proof.http_status !== 200 || proof.bytes < 1_000_000 || proof.charge_count < 1
      || proof.license_state !== ({ '061327': 'CO', '170103': 'KS', '271311': 'MT', '281306': 'NE', '281313': 'NE', '281334': 'NE', '281349': 'NE', '281350': 'NE', '451373': 'TX', '671300': 'TX', '671303': 'TX', '450508': 'TX', '471306': 'VT' })[ccn]
      || proof.version !== '3.0.0' || !proof.hospital_address?.[0]
      || !proof.location_name?.[0] || !/^[a-f0-9]{64}$/.test(proof.file_sha256)
      || !/^[a-f0-9]{64}$/.test(identity.pointer_sha256)
      || !/^[a-f0-9]{64}$/.test(identity.identity_page_sha256)
      || identity.pointer_http_status !== 200 || identity.identity_page_http_status !== 200
      || !(proof.url.startsWith('https://secure.claraprice.net/')
        || (ccn === '450508' && new URL(proof.url).hostname === 'linkprotect.cudasvc.com'))
      || !identity.pointer_url.startsWith(`https://${base.domain}/`)
      || new URL(identity.identity_page_url).hostname.replace(/^www\./, '') !== base.domain
      || Date.parse(proof.observed_at) - Date.parse(`${proof.last_updated_on}T00:00:00Z`) <= 365 * 86_400_000) {
    throw new Error(`Incomplete or incompatible complete-file proof for ${ccn}`);
  }
  const evidence = {
    identity: 'corroborated',
    identity_basis: 'exact-current-root-pointer-complete-json-location-address-state-and-first-party-hospital-page',
    pointerUrl: identity.pointer_url, pointerFinalUrl: identity.pointer_final_url,
    pointerSha256: identity.pointer_sha256, url: proof.url,
    fileSha256: proof.file_sha256, fullFileBytes: proof.bytes, http_status: proof.http_status,
    checked_at: proof.observed_at, date: proof.last_updated_on, version: proof.version,
    officialDomain: base.domain, location_name: proof.location_name[0],
    declared_hospital_name: proof.hospital_name, declared_address: proof.hospital_address[0],
    declared_license_state: proof.license_state, file_kind: 'json',
    identityPageUrl: identity.identity_page_url, identityPageSha256: identity.identity_page_sha256,
    observedFinding: 'mrf-stale-over-365-days'
  };
  const entry = {
    ccn, base, action: 'replace-observation', evidence,
    evidence_run: 'claraprice-complete-metadata-review-2026-09-16', reviewed_at: proof.observed_at,
    note: `A current first-party hospital page, current root pointer and complete SHA-256-bound JSON identify the exact campus. The file declares update ${proof.last_updated_on}, over 365 days before retrieval. This records the dated publisher field; it does not claim whole-file CMS structural validation or legal noncompliance. ${identity.identity_basis}`
  };
  const old = ledger.find(row => row.ccn === ccn);
  if (old) {
    if (old.evidence_run !== entry.evidence_run || JSON.stringify(old.evidence) !== JSON.stringify(evidence))
      throw new Error(`Existing nonmatching resolution for ${ccn}`);
    continue;
  }
  ledger.push(entry);
  applied.push(ccn);
}

if (applied.length) {
  ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
  fs.writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);
}
console.log(JSON.stringify({ applied, already_present: selected.filter(ccn => !applied.includes(ccn)) }, null, 2));
