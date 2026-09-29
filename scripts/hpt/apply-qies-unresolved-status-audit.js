'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data', 'hpt-audit');
const proofName = 'reconciliation-qies-unresolved-status-audit-2026-09-27.json';
const proofPath = path.join(audit, proofName);
const source = {
  dataset: 'CMS Provider of Services File - Quality Improvement and Evaluation System (QIES)',
  dataset_url: 'https://data.cms.gov/provider-characteristics/hospitals-and-other-facilities/provider-of-services-file-quality-improvement-and-evaluation-system',
  release: 'Q1 2026',
  dataset_version_id: 'bb342fae-b551-40fd-a738-e2e5878f3bbb',
  query_api: 'https://data.cms.gov/data-api/v1/dataset/bb342fae-b551-40fd-a738-e2e5878f3bbb/data?size=10000&column=PRVDR_NUM%2CFAC_NAME%2CCITY_NAME%2CSTATE_CD%2CST_ADR%2CPGM_TRMNTN_CD%2CTRMNTN_EXPRTN_DT%2CPRVDR_CTGRY_SBTYP_CD%2CORGNL_PRTCPTN_DT%2CCRTFCTN_ACTN_TYPE_CD',
  columns: ['PRVDR_NUM', 'FAC_NAME', 'CITY_NAME', 'STATE_CD', 'ST_ADR', 'PGM_TRMNTN_CD', 'TRMNTN_EXPRTN_DT', 'PRVDR_CTGRY_SBTYP_CD', 'ORGNL_PRTCPTN_DT', 'CRTFCTN_ACTN_TYPE_CD']
};

const transitions = [
  {
    ccn: '010110', role: 'historical-acute-care-ccn', related_ccn: '010779',
    interpretation: 'QIES records acute-care CCN 010110 terminated 2024-04-30 (status-change code 07) and same-name/address REH CCN 010779 with original participation date 2024-05-01. The adjacent dates corroborate the first-party conversion date; they do not establish historical HPT-file publication or resolve the old CCN file review.',
    next_action: 'Retain 010110 in the historical accountability baseline. Inspect only dated pre-conversion pointer/MRF evidence for the acute-care period through 2024-04-30; do not assign the 010779 REH pointer or MRF to this CCN.'
  },
  {
    ccn: '010779', role: 'active-rural-emergency-hospital-ccn', related_ccn: '010110',
    interpretation: 'QIES records REH subtype 28, active status, and original participation date 2024-05-01 at the same name/address as former acute-care CCN 010110. This aligns with the current first-party REH page. Existing price-file evidence remains dated/stale and is not made current by this status crosswalk.',
    next_action: 'Keep the active REH record separate from historical 010110. Obtain a current CMS 3.0.0 replacement MRF for 010779; retain the identity-matched older file as historical evidence.'
  },
  {
    ccn: '010125', role: 'historical-acute-care-ccn', related_ccn: '011311',
    interpretation: 'QIES records acute-care CCN 010125 terminated 2025-11-13 (status-change code 07) and same-name/address CAH CCN 011311 active with original participation date 2025-11-14. The one-day boundary and current first-party CAH description support separate historical/current scopes, but do not by themselves prove MRF assignment or historical HPT coverage.',
    next_action: 'Retain 010125 in the historical accountability baseline. Check for dated acute-care pointer/MRF evidence through 2025-11-13; do not assign 011311 CAH files or records to this retired acute-care CCN.'
  },
  {
    ccn: '011311', role: 'active-critical-access-hospital-ccn', related_ccn: '010125',
    interpretation: 'QIES records CAH subtype 11, active status, and original participation date 2025-11-14 at the same name/address as acute-care CCN 010125. The current first-party site describes Lakeland as a CAH. The current hospital MRF remains unverified; the crosswalk does not change the 404 pointer or older PDF observations.',
    next_action: 'Keep active CAH CCN 011311 distinct from historical acute-care 010125. Resolve the current first-party pointer/MRF route for 011311 and verify its own CSV/JSON bytes and metadata; do not transfer the 010125 evidence.'
  },
  {
    ccn: '050785', role: 'terminated-ccn-rebuild-scope-pending', related_ccn: '',
    interpretation: 'QIES records DOCS Surgical Hospital with termination code 01 and date 2025-01-01. The prior first-party notice calls the closure temporary for replacement construction, and the current first-party page describes the new hospital as projected to open in 2026. CMS termination plus a temporary-rebuild statement does not establish the replacement facility CCN, reopening date, or HPT file assignment.',
    next_action: 'Keep 050785 historical and unresolved. Determine whether the replacement hospital reopened, its effective CMS CCN/status, and its current first-party CMS-template MRF; do not infer permanent closure, exemption, or reuse of 050785.'
  }
];

async function buildProof() {
  const worklistPath = path.join(audit, 'unresolved-investigation-worklist.json');
  const worklistBytes = fs.readFileSync(worklistPath);
  const worklist = JSON.parse(worklistBytes.toString('utf8'));
  let response;
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      response = await fetch(source.query_api, { signal: AbortSignal.timeout(45000) });
      if (response.ok) break;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    if (attempt < 3) await new Promise(resolve => setTimeout(resolve, attempt * 1500));
  }
  if (!response?.ok) throw new Error(`CMS QIES request failed after retries: ${lastError?.stack || lastError?.message}`);
  const responseText = await response.text();
  const rows = JSON.parse(responseText);
  if (!Array.isArray(rows) || rows.length < 5000) throw new Error(`Unexpected QIES row count: ${rows?.length}`);

  const ccnSet = new Set(worklist.records.map(record => String(record.ccn)));
  if (ccnSet.size !== worklist.records.length) throw new Error('Unresolved worklist CCNs are not unique');
  const selected = rows.map(row => ({
    ccn: String(row.PRVDR_NUM),
    facility_name: row.FAC_NAME,
    address: row.ST_ADR,
    city: row.CITY_NAME,
    state: row.STATE_CD,
    provider_category_subtype_code: row.PRVDR_CTGRY_SBTYP_CD,
    termination_code: row.PGM_TRMNTN_CD,
    termination_date: row.TRMNTN_EXPRTN_DT,
    original_participation_date: row.ORGNL_PRTCPTN_DT,
    certification_action_code: row.CRTFCTN_ACTN_TYPE_CD
  }));
  const matchedRows = selected.filter(row => ccnSet.has(row.ccn));
  const matchedCcns = new Set(matchedRows.map(row => row.ccn));
  if (matchedCcns.size !== matchedRows.length) throw new Error('CMS QIES exact-CCN rows are not unique');
  const crosswalkRows = selected.filter(row => ['010110', '010779', '010125', '011311', '050785'].includes(row.ccn));
  for (const id of ['010110', '010779', '010125', '011311', '050785']) {
    if (!crosswalkRows.some(row => row.ccn === id)) throw new Error(`Expected exact CCN ${id} missing from QIES source`);
  }

  const statusCounts = {};
  for (const row of matchedRows) statusCounts[row.termination_code] = (statusCounts[row.termination_code] || 0) + 1;
  const proof = {
    observed_at: new Date().toISOString(),
    source,
    cohort: {
      worklist_file: 'unresolved-investigation-worklist.json',
      worklist_sha256: crypto.createHash('sha256').update(worklistBytes).digest('hex'),
      unresolved_ccn_count: worklist.records.length,
      source_row_count: rows.length,
      exact_ccn_match_count: matchedRows.length,
      no_exact_row_count: worklist.records.length - matchedRows.length,
      no_exact_row_ccns: [...ccnSet].filter(ccn => !matchedCcns.has(ccn)).sort()
    },
    source_response_sha256: crypto.createHash('sha256').update(Buffer.from(responseText, 'utf8')).digest('hex'),
    source_response_bytes: Buffer.byteLength(responseText, 'utf8'),
    matched_status_counts: statusCounts,
    matched_non_active_rows: matchedRows.filter(row => row.termination_code !== '00'),
    matched_rows: matchedRows,
    selected_transition_crosswalk_rows: crosswalkRows,
    selected_transition_reviews: transitions,
    field_interpretation: {
      termination_code_00: 'Active provider',
      termination_code_01: 'Voluntary merger or closure',
      termination_code_07: 'Other provider status change',
      termination_date: 'CMS POS record layout defines this as the date the provider was terminated',
      subtype_01: 'Short Term',
      subtype_11: 'Critical Access Hospital',
      subtype_28: 'Rural Emergency Hospital',
      limitation: 'This CMS certification-status join is not an HPT compliance determination. No exact row is not evidence of closure or non-applicability. Even an exact status transition does not assign a shared-campus MRF to a CCN or resolve historical HPT evidence.'
    },
    unresolved_count_change: 0
  };
  fs.writeFileSync(proofPath, `${JSON.stringify(proof, null, 2)}\n`);
  return proof;
}

async function main() {
  const proof = fs.existsSync(proofPath)
    ? JSON.parse(fs.readFileSync(proofPath, 'utf8'))
    : await buildProof();
  const manualPath = path.join(audit, 'reconciliation-manual-access-observations.json');
  const manual = JSON.parse(fs.readFileSync(manualPath, 'utf8'));
  const records = transitions.map(item => {
    const cmsRow = proof.selected_transition_crosswalk_rows.find(row => row.ccn === item.ccn);
    if (!cmsRow) throw new Error(`Proof has no exact row for ${item.ccn}`);
    const prior = (manual.records || [])
      .filter(record => record.ccn === item.ccn && record.proof_file !== path.basename(proofPath))
      .sort((a, b) => String(a.observed_at).localeCompare(String(b.observed_at)))
      .at(-1);
    if (!prior?.disposition) throw new Error(`Cannot preserve prior disposition for ${item.ccn}`);
    return {
      ...prior,
      ccn: item.ccn,
      observed_at: proof.observed_at,
      proof_file: path.basename(proofPath),
      disposition: prior.disposition,
      manual_disposition: prior.manual_disposition,
      observation_type: 'supplemental-cms-qies-status-crosswalk',
      source: proof.source,
      cohort_audit: {
        unresolved_count: proof.cohort.unresolved_ccn_count,
        exact_ccn_matches: proof.cohort.exact_ccn_match_count,
        no_exact_row_count: proof.cohort.no_exact_row_count,
        source_response_sha256: proof.source_response_sha256
      },
      cms_status_record: cmsRow,
      record_role: item.role,
      related_ccn: item.related_ccn,
      interpretation: item.interpretation,
      unresolved_count_change: 0,
      next_action: item.next_action
    };
  });
  const appliedIds = new Set(records.map(record => record.ccn));
  manual.records = (manual.records || []).filter(record =>
    !(record.proof_file === path.basename(proofPath) && appliedIds.has(record.ccn))
  ).concat(records).sort((a, b) => a.ccn.localeCompare(b.ccn)
    || String(a.observed_at).localeCompare(String(b.observed_at)));
  fs.writeFileSync(manualPath, `${JSON.stringify(manual, null, 2)}\n`);
  console.log(JSON.stringify({
    proof_file: path.basename(proofPath),
    unresolved_ccns: proof.cohort.unresolved_ccn_count,
    exact_ccn_matches: proof.cohort.exact_ccn_match_count,
    no_exact_row_count: proof.cohort.no_exact_row_count,
    matched_status_counts: proof.matched_status_counts,
    observations_added: records.map(record => record.ccn),
    unresolved_count_change: proof.unresolved_count_change
  }, null, 2));
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
