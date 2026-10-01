'use strict';

// Capture a source-bound CMS Hospital Change of Ownership cross-check for
// CCN 450653. Do not retain the full dataset response; it includes personal
// owner information unrelated to this exact-CCN review.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const proofName = 'reconciliation-scenic-mountain-cms-chow-crosscheck-2026-09-29.json';
const apiUrl = 'https://data.cms.gov/data-api/v1/dataset/c04031db-54ce-461c-85d1-d2613d71f167/data';
const expected = {
  bytes: 718332,
  sha256: '76f2a3fdfa7f69b78363e59189e0ec4f10e602c8c8b95b8e0d44bf7c496ae33f',
  rows: 772,
  matchedRows: 1,
  lastModified: 'Mon, 28 Sep 2026 20:53:36 GMT'
};

function sha(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function selectRelevant(rows) {
  return rows.filter(row => row['CCN - BUYER'] === '450653'
    || row['CCN - SELLER'] === '450653'
    || row['NPI - BUYER'] === '1497606438'
    || row['NPI - SELLER'] === '1497606438');
}

function main() {
  fetch(apiUrl).then(async response => {
    const bytes = Buffer.from(await response.arrayBuffer());
    const bodyHash = sha(bytes);
    const lastModified = response.headers.get('last-modified') || '';
    if (!response.ok || bytes.length > 2 * 1024 * 1024
        || bytes.length !== expected.bytes || bodyHash !== expected.sha256
        || lastModified !== expected.lastModified)
      throw new Error(`CMS CHOW snapshot changed or incomplete: HTTP ${response.status}, ${bytes.length} bytes, ${bodyHash}, ${lastModified}`);

    const rows = JSON.parse(bytes.toString('utf8'));
    const relevant = selectRelevant(rows);
    const row = relevant[0];
    if (rows.length !== expected.rows || relevant.length !== expected.matchedRows
        || !row || row['CCN - BUYER'] !== '450653' || row['CCN - SELLER'] !== '450653'
        || row['NPI - BUYER'] !== '1336976034' || row['NPI - SELLER'] !== '1285191452'
        || row['ORGANIZATION NAME - BUYER'] !== 'BIG SPRING TEXAS HOSPITAL COMPANY LLC'
        || row['DOING BUSINESS AS NAME - BUYER'] !== 'SCENIC MOUNTAIN MEDICAL CENTER'
        || row['CHOW TYPE TEXT'] !== 'CHANGE OF OWNERSHIP'
        || row['EFFECTIVE DATE'] !== '2024-10-17'
        || relevant.some(item => item['NPI - BUYER'] === '1497606438' || item['NPI - SELLER'] === '1497606438'))
      throw new Error('CMS CHOW exact-CCN/NPI row selection did not match the reviewed result');

    const observedAt = new Date().toISOString();
    const proof = {
      ccn: '450653',
      observed_at: observedAt,
      purpose: 'Check the current CMS Hospital Change of Ownership feed for effective-dated continuity between Scenic Mountain CCN 450653 and Shannon NPI 1497606438 after the reported 2026 operating transition.',
      source: {
        publisher: 'Centers for Medicare & Medicaid Services',
        dataset: 'Hospital Change of Ownership',
        dataset_id: 'c04031db-54ce-461c-85d1-d2613d71f167',
        dataset_release: '2026-06-01',
        dataset_temporal_end: '2026-06-30',
        catalog_last_updated: '2026-08-19',
        catalog_url: 'https://catalog.data.gov/dataset/hospital-change-of-ownership',
        dataset_url: 'https://data.cms.gov/provider-characteristics/hospitals-and-other-facilities/hospital-change-of-ownership',
        api_url: apiUrl,
        http_status: response.status,
        content_type: response.headers.get('content-type') || '',
        last_modified: lastModified,
        response_bytes: bytes.length,
        response_sha256: bodyHash
      },
      query: {
        method: 'Fetch complete current public dataset (bounded to 2 MiB), parse in memory, select every row whose buyer/seller CCN is 450653 or buyer/seller NPI is 1497606438.',
        response_rows: rows.length,
        exact_ccn_or_npi_match_rows: relevant.length,
        full_dataset_retained: false,
        retention_reason: 'Full response includes unrelated personal-owner fields; this proof retains the exact relevant organization transaction row only.'
      },
      relevant_transaction_rows: relevant,
      comparison: {
        enrollment_proof_file: 'reconciliation-scenic-mountain-cms-enrollment-recheck-proof-2026-09-25.json',
        current_cms_ccn_npi_at_last_enrollment_snapshot: '1336976034',
        shannon_big_spring_file_npi: '1497606438',
        shannon_npi_match_in_this_chow_response: false,
        scope_interpretation: 'The current published CMS CHOW response contains only the 2024-10-17 change to Big Spring Texas Hospital Company LLC / Scenic Mountain for CCN 450653; it contains no buyer/seller match for Shannon NPI 1497606438. CMS describes this dataset as ownership changes reported through PECOS and self-reported by entities. This absence does not establish that no operational transition, enrollment update, or CCN continuity occurred after the dataset temporal end.'
      },
      disposition: 'current-operator-same-campus-pointer-file-ccn-continuity-unresolved',
      cohort_count_effect: 0,
      next_action: 'Do not repeat those unchanged snapshots or this unchanged CMS CHOW snapshot. Keep CCN 450653 and the Shannon file scope separate. Seek a post-transition CMS certification/enrollment record, later CHOW release, or published authoritative Shannon/CMS record explicitly mapping NPI 1497606438 to CCN 450653; do not infer the mapping from name, address, or operational ownership alone.'
    };

    fs.writeFileSync(path.join(audit, proofName), `${JSON.stringify(proof, null, 2)}\n`);
    const manualPath = path.join(audit, 'reconciliation-manual-access-observations.json');
    const manual = JSON.parse(fs.readFileSync(manualPath, 'utf8'));
    const observation = manual.records.find(item => item.ccn === '450653');
    if (!observation) throw new Error('Manual observation for CCN 450653 is missing');
    observation.latest_cms_chow_recheck = {
      observed_at: observedAt,
      proof_file: proofName,
      dataset_release: proof.source.dataset_release,
      dataset_temporal_end: proof.source.dataset_temporal_end,
      response_bytes: bytes.length,
      response_sha256: bodyHash,
      matching_rows: relevant.length,
      ccn_transaction_effective_date: row['EFFECTIVE DATE'],
      buyer_name: row['ORGANIZATION NAME - BUYER'],
      buyer_dba: row['DOING BUSINESS AS NAME - BUYER'],
      buyer_npi: row['NPI - BUYER'],
      seller_name: row['ORGANIZATION NAME - SELLER'],
      seller_npi: row['NPI - SELLER'],
      shannon_npi_match: false,
      interpretation: 'The latest CMS CHOW response available in this check still shows only the 2024-10-17 transaction; its June 2026 temporal end does not establish whether the later Shannon operational transition changed Medicare CCN continuity.'
    };
    observation.observed_at = observedAt;
    observation.next_action = proof.next_action;
    fs.writeFileSync(manualPath, `${JSON.stringify(manual, null, 2)}\n`);
    console.log(JSON.stringify({ proof: proofName, observedAt, responseBytes: bytes.length,
      responseSha256: bodyHash, responseRows: rows.length, matchingRows: relevant.length,
      ccnDispositionUnchanged: true }));
  }).catch(error => {
    console.error(error.stack || error);
    process.exitCode = 1;
  });
}

if (require.main === module) main();
module.exports = { selectRelevant };
