'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { csvToObjects } = require('./lib/util');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const proof = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-guthrie-lourdes-transition-proof.json'), 'utf8'));
const base = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8')).find(row => row.ccn === '330011');
const sample = fs.readFileSync(path.join(root, proof.retained_sample));
const httpUrl = 'http://rca.elevatepfs.com/ptapp/api/cdm/export/oneclick?recno=151e59cbd2694c13781019a3d8b1498b7b19d03390dd0d09f12c47078097ecad';
const httpsUrl = httpUrl.replace(/^http:/, 'https:');
if (!base || base.finding !== 'not-assessed-not-named-in-file'
    || proof.ccn !== '330011' || proof.roster_name !== 'OUR LADY OF LOURDES MEMORIAL HOSPITAL, INC'
    || proof.roster_address !== '169 RIVERSIDE DRIVE' || proof.roster_city !== 'BINGHAMTON'
    || proof.roster_state !== 'NY' || proof.roster_zip !== '13905'
    || proof.former_official_domain !== 'healthcare.ascension.org'
    || proof.current_official_domain !== 'guthrie.org'
    || proof.identity_page_url !== 'https://www.guthrie.org/lourdes'
    || !/^[a-f0-9]{64}$/.test(proof.identity_page_sha256)
    || proof.transition_page_url !== 'https://www.guthrie.org/news/guthrie-acquire-our-lady-lourdes-memorial-hospital-and-affiliates'
    || !/^[a-f0-9]{64}$/.test(proof.transition_page_sha256)
    || proof.transition_names_prior_operator !== true
    || proof.pointer_url !== 'https://www.guthrie.org/cms-hpt.txt'
    || proof.pointer_sha256 !== 'c1098e8bb054e288e386c86020d26b744d20371abcef91e589ab00488ae3a93e'
    || proof.pointer_entry_count !== 6 || proof.pointer_location_name !== 'Guthrie Lourdes Hospital'
    || proof.pointer_mrf_url !== httpUrl || proof.pointer_mrf_http_status !== 0
    || !/curl: \(52\) Empty reply from server/i.test(proof.pointer_mrf_transport_error)
    || proof.pointer_mrf_browser_error !== 'net::ERR_BLOCKED_BY_CLIENT'
    || proof.pricing_page_url !== 'https://www.guthrie.org/about-us/hospital-price-transparency'
    || !/^[a-f0-9]{64}$/.test(proof.pricing_page_sha256)
    || proof.pricing_page_label !== 'Lourdes Hospital' || proof.pricing_page_mrf_url !== httpsUrl
    || proof.pricing_file_http_status !== 200 || proof.pricing_file_sample_bytes !== 262144
    || sample.length !== 262144
    || crypto.createHash('sha256').update(sample).digest('hex') !== proof.pricing_file_sample_sha256
    || proof.declared_hospital_name.trim() !== 'OUR LADY OF LOURDES MEMORIAL HOSPITAL INC. Doing Business As: LOURDES'
    || proof.declared_location_name !== 'Guthrie Lourdes Hospital'
    || proof.declared_address !== '169 Riverside Drive, Binghamton, NY 13905'
    || proof.declared_license_state !== 'NY' || proof.declared_date !== '2026-03-31'
    || proof.version !== '3.0.0' || !Number.isFinite(Date.parse(proof.observed_at)))
  throw new Error('Guthrie Lourdes transition proof or base changed; manual review required');

const evidence = {
  identity: 'corroborated',
  identity_basis: 'first-party-guthrie-acquisition-and-exact-binghamton-campus-current-pointer-pricing-page-and-https-csv-header',
  pointerUrl: proof.pointer_url, pointerSha256: proof.pointer_sha256,
  pointerMrfUrl: proof.pointer_mrf_url, pointerMrfHttpStatus: proof.pointer_mrf_http_status,
  pointerMrfTransportError: proof.pointer_mrf_transport_error,
  browserTargetErrorCode: 'ERR_BLOCKED_BY_CLIENT',
  pointerIssue: 'pointer-http-url-client-empty-reply',
  url: proof.pricing_page_mrf_url, fileSha256: proof.pricing_file_sample_sha256,
  bytesRetained: proof.pricing_file_sample_bytes,
  http_status: proof.pricing_file_http_status, checked_at: proof.observed_at,
  date: proof.declared_date, version: proof.version, officialDomain: proof.current_official_domain,
  location_name: proof.pointer_location_name,
  declared_hospital_name: proof.declared_hospital_name,
  declared_location_name: proof.declared_location_name,
  declared_address: proof.declared_address,
  declared_license_state: proof.declared_license_state, file_kind: 'csv',
  identityPageUrl: proof.identity_page_url, identityPageSha256: proof.identity_page_sha256,
  transitionPageUrl: proof.transition_page_url, transitionPageSha256: proof.transition_page_sha256,
  sourcePageUrl: proof.pricing_page_url, sourcePageSha256: proof.pricing_page_sha256,
  observedFinding: 'pointer-http-client-error-page-file-found', next_action: proof.next_action,
};
const entry = { ccn: '330011', base, action: 'replace-observation', evidence,
  evidence_run: 'guthrie-lourdes-operator-pointer-scheme-page-file-2026-09-17', reviewed_at: proof.observed_at,
  note: 'Guthrie documents its acquisition of Our Lady of Lourdes Memorial Hospital from Ascension and names the current Guthrie Lourdes Hospital at 169 Riverside Drive. The current Guthrie root pointer names Lourdes but uses an HTTP export URL; our bounded client received an empty reply and the in-app browser blocked that exact URL. Guthrie’s pricing page links the same export identifier over HTTPS, and its bounded CSV header identifies Our Lady of Lourdes/Guthrie Lourdes at the roster address, NY, 2026-03-31/v3.0.0. The working HTTPS bytes are page-linked, not treated as a proven working HTTP pointer target; no full-file or legal compliance verdict is made. The earlier Ascension observation remains historical.' };
const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
const existing = ledger.find(row => row.ccn === entry.ccn);
if (existing && (existing.evidence_run !== entry.evidence_run || JSON.stringify(existing.evidence) !== JSON.stringify(entry.evidence)))
  throw new Error('Existing nonmatching Guthrie Lourdes resolution');
if (!existing) {
  ledger.push(entry);
  ledger.sort((left, right) => left.ccn.localeCompare(right.ccn));
  fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
}
console.log(JSON.stringify({ applied: !existing, ccn: entry.ccn, finding: evidence.observedFinding }));
