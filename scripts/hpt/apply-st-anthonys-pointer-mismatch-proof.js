'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { csvToObjects } = require('./lib/util');
const { parsePayload } = require('./lib/recovery-transport');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const proof = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-st-anthonys-pointer-mismatch-proof.json'), 'utf8'));
const base = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8'))
  .find(row => row.ccn === '100067');
const roster = JSON.parse(fs.readFileSync(path.join(root, 'cms_data/hpt/roster.json'), 'utf8'))
  .find(row => row.ccn === '100067');
const addressReview = JSON.parse(fs.readFileSync(path.join(audit, 'reviewed-address-equivalences.json'), 'utf8'))
  .records.find(row => row.ccn === '100067');
const archive = fs.readFileSync(path.join(root, proof.retained_archive));

async function main() {
  const parsed = (await parsePayload(archive, 'application/x-zip-compressed', 262144)).parsed;
  const header = parsed.find(row => row.member === proof.archive_csv_member);
  if (proof.ccn !== '100067' || !base || base.finding !== 'mrf-url-unreachable'
      || base.domain !== proof.official_domain || base.mrf_url !== proof.pointer_mrf_url
      || proof.pointer_mrf_http_status !== 404 || proof.current_mrf_http_status !== 206
      || proof.pointer_mrf_url === proof.current_mrf_url || archive.length !== proof.current_archive_bytes
      || crypto.createHash('sha256').update(archive).digest('hex') !== proof.current_archive_sha256
      || proof.bounded_inflated_bytes !== 262144 || parsed.length !== 1
      || header?.innerKind !== 'csv' || header.mrfHospitalName !== "St Anthony's Hospital"
      || header.mrfAddress !== '1200 7th Avenue St. Petersburg FL 33705'
      || header.mrfLicenseState !== 'FL' || header.declaredLastUpdated !== '2026-01-01'
      || header.cmsVersion !== '3.0.0' || roster?.address !== '1200 SEVENTH AVE N'
      || roster.zip !== '33705' || addressReview?.mrf_url !== proof.current_mrf_url)
    throw new Error("Incomplete St. Anthony's proof or changed base");
  const evidence = {
    identity: 'corroborated',
    identity_basis: 'current-first-party-billing-and-facility-pages-plus-retained-zip-csv-header-with-reviewed-direction-omission',
    pointerUrl: proof.pointer_url, pointerSha256: proof.pointer_sha256,
    pointerHttpStatus: proof.pointer_http_status, pointerMrfUrl: proof.pointer_mrf_url,
    pointerMrfHttpStatus: proof.pointer_mrf_http_status,
    url: proof.current_mrf_url, fileSha256: proof.current_archive_sha256,
    http_status: proof.current_mrf_http_status, checked_at: proof.observed_at,
    date: proof.declared_date, version: proof.version, officialDomain: proof.official_domain,
    location_name: proof.declared_location_name, declared_hospital_name: proof.declared_hospital_name,
    declared_address: proof.declared_address, declared_license_state: proof.declared_state,
    file_kind: 'zip', sourcePageUrl: proof.source_page_url, sourcePageSha256: proof.source_page_sha256,
    observedFinding: 'pointer-links-unavailable-mrf-source-page-current-file',
    pointerIssue: 'pointer-mrf-http-error-current-source-page-file', next_action: proof.next_action,
  };
  const entry = { ccn: proof.ccn, base, action: 'replace-observation', evidence,
    evidence_run: 'st-anthonys-pointer-page-archive-mismatch-2026-09-16', reviewed_at: proof.observed_at,
    note: "BayCare's current root pointer names a ZIP URL returning HTTP 404, while its first-party billing page separately links a readable ZIP. The retained 7,259,344-byte archive contains one CSV whose bounded root metadata identifies St Anthony's Hospital, 1200 7th Avenue, St. Petersburg FL 33705, Florida license state, 2026-01-01 and CMS v3.0.0. The first-party facility page and roster include the N street direction omitted in the CSV; this difference is explicitly reviewed. The page-linked archive is not a working pointer target or a full-file validation." };
  const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
  const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  const old = ledger.find(row => row.ccn === entry.ccn);
  if (old && (old.evidence_run !== entry.evidence_run || JSON.stringify(old.evidence) !== JSON.stringify(entry.evidence)))
    throw new Error("Existing nonmatching St. Anthony's resolution");
  if (!old) {
    ledger.push(entry);
    ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
    fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
  }
  console.log(JSON.stringify({ applied: !old, ccn: entry.ccn, finding: evidence.observedFinding }));
}

main().catch(error => { console.error(error); process.exitCode = 1; });
