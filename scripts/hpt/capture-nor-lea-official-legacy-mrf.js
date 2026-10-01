'use strict';

// Retain the exact downloadable standard-charges CSV currently linked from
// Nor-Lea's own public-information resource page. This is a historical v2
// file: it corroborates the 1600 address but does not establish a current
// CMS-template MRF or resolve the distinct 2026 page-linked 1900 address.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { retrieve, parsePayload } = require('./lib/recovery-transport');
const { csvToObjects } = require('./lib/util');

const root = path.resolve(__dirname, '../..');
const auditDir = path.join(root, 'data/hpt-audit');
const url = 'https://nor-lea.org/s/Standard-Charges';
const expected = {
  bytes: 5543873,
  sha256: '2fc6f2a1e17ea971031701dd2293450308426f022261a7ebbe7c789c9fc557fc',
  range: 'bytes 0-5543872/5543873',
};
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

async function main() {
  const response = await retrieve(url, 6000000, { timeoutMs: 60000 });
  const bytes = Buffer.from(response.body || '');
  if (response.status !== 206 || bytes.length !== expected.bytes
      || sha(bytes) !== expected.sha256 || response.headers?.['content-range'] !== expected.range
      || response.headers?.['content-type'] !== 'text/csv')
    throw new Error(`Nor-Lea official CSV changed or was incomplete: ${response.status}, ${bytes.length}, ${sha(bytes)}, ${response.headers?.['content-range']}`);
  const parsed = (await parsePayload(bytes, response.headers['content-type'])).parsed;
  const header = parsed.find(item => item.innerKind === 'csv');
  if (!header || header.mrfHospitalName !== 'Nor-Lea District Hospital'
      || header.mrfAddress !== '1600 North Main Avenue, Lovington, NM 88260'
      || header.mrfLicenseState !== 'NM' || header.cmsVersion !== '2.0.0'
      || header.declaredLastUpdated !== '2025-01-01')
    throw new Error(`Nor-Lea official CSV header changed: ${JSON.stringify(header)}`);
  const dataRows = csvToObjects(bytes.toString('utf8'));
  if (dataRows.length !== 24307 || dataRows[0]?.hospital_name !== 'Nor-Lea District Hospital'
      || dataRows[1]?.hospital_name !== 'description')
    throw new Error(`Nor-Lea official CSV row structure changed: ${dataRows.length}`);

  const observedAt = new Date().toISOString();
  const artifact = 'data/hpt-audit/retained-source-documents/nor-lea-official-standard-charges-2025-v2.csv';
  const artifactPath = path.join(root, artifact);
  fs.mkdirSync(path.dirname(artifactPath), { recursive: true });
  if (fs.existsSync(artifactPath)) {
    const existing = fs.readFileSync(artifactPath);
    if (sha(existing) !== expected.sha256) throw new Error('Existing Nor-Lea retained source artifact has a different hash');
  } else fs.writeFileSync(artifactPath, bytes);

  const proofName = 'reconciliation-nor-lea-official-legacy-mrf-2026-09-29.json';
  const proof = {
    audit_id: 'reconciliation-nor-lea-official-legacy-mrf-2026-09-29',
    ccn: '321305',
    facility: 'Nor-Lea Hospital District',
    observed_at: observedAt,
    purpose: 'Recover the separate Standard Charges download directly linked from Nor-Lea Hospital District’s own public-information page and compare its declared facility/address/version with the already-retained 2026 CSV hosted by hospitalpricetransparencyfiles.com.',
    first_party_source_page: {
      url: 'https://nor-lea.org/resources',
      observed_via: 'public web page open and direct link inspection',
      link_label: 'CMS - Nor-Lea Hospital District Downloadable Standard Charges',
      source_link: url,
      redirect_target: response.finalUrl,
    },
    retrieval: {
      status: response.status,
      requested_range: 'bytes=0-5999999',
      content_range: response.headers['content-range'],
      total_bytes: bytes.length,
      sha256: expected.sha256,
      content_type: response.headers['content-type'],
      complete_response: true,
      redirects: response.attempts?.[0]?.redirects || [],
    },
    retained_artifact: artifact,
    declared_metadata: {
      hospital_name: header.mrfHospitalName,
      location_name: header.mrfLocationName,
      address: header.mrfAddress,
      license_state: header.mrfLicenseState,
      last_updated_on: header.declaredLastUpdated,
      cms_template_version: header.cmsVersion,
      parsed_rows: dataRows.length,
      row_schema: Object.keys(dataRows[0] || {}),
    },
    comparison: {
      newer_2026_page_linked_file: 'reconciliation-nor-lea-address-conflict-proof-2026-09-25.json',
      newer_file_url: 'https://hospitalpricetransparencyfiles.com/nor-lea-district-hospital/850278235_Nor-Lea-Hospital-District_standardcharges.csv',
      newer_file_sha256: '549aeebd73a2ec8cb6ba28c75e1af7b31380db81b6597d042c8b0a821dcc151e',
      newer_declared_address: '1900 North Main Avenue, Lovington, NM 88260-2813',
      interpretation: 'The first-party downloadable file is a complete historical CMS v2 CSV that names Nor-Lea and declares the official 1600 North Main address. It is dated 2025-01-01 and does not establish a current 2026 MRF. Its distinct metadata conflicts with the newer 2026 file’s 1900 value; this supports preserving the address discrepancy, not treating the 2025 file as a correction or reassigning the 2026 file.',
    },
    disposition_effect: 'none; retain CCN 321305 unresolved for the current 2026 MRF address conflict and pointer linkage; add this older first-party file as dated historical evidence only.',
    next_action: 'Keep the two files and their hashes separate. Obtain a dated publisher correction or authoritative facility-specific evidence explaining the 1900 North Main value and verify an explicit current cms-hpt.txt mrf-url before any promotion. Do not use the 2025 v2 file as current 2026 coverage.',
  };
  fs.writeFileSync(path.join(auditDir, proofName), `${JSON.stringify(proof, null, 2)}\n`);

  const manualPath = path.join(auditDir, 'reconciliation-manual-access-observations.json');
  const manual = JSON.parse(fs.readFileSync(manualPath, 'utf8'));
  const row = manual.records.find(item => item.ccn === '321305');
  if (!row) throw new Error('Nor-Lea manual observation row is missing');
  const field = 'latest_official_publisher_downloaded_legacy_mrf_2026_09_29';
  if (row[field] && row[field].proof_file !== proofName)
    throw new Error('Nor-Lea legacy-MRF manual observation already has a conflicting proof reference');
  row[field] = {
    observed_at: observedAt,
    proof_file: proofName,
    source_page_url: proof.first_party_source_page.url,
    source_link: url,
    file_sha256: expected.sha256,
    file_bytes: bytes.length,
    declared_address: header.mrfAddress,
    declared_last_updated: header.declaredLastUpdated,
    cms_template_version: header.cmsVersion,
    status: 'historical-first-party-file-retained; current-conflicting-file-unresolved',
    disposition_effect: 'none',
    next_action: proof.next_action,
  };
  fs.writeFileSync(manualPath, `${JSON.stringify(manual, null, 2)}\n`);
  console.log(JSON.stringify({ ccn: proof.ccn, bytes: bytes.length, sha256: expected.sha256,
    version: header.cmsVersion, declaredAddress: header.mrfAddress, proof: proofName, artifact }, null, 2));
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
