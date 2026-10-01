'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const cohort = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-891-baseline-member-roster-2026-09-27.json'), 'utf8'));
const worklist = JSON.parse(fs.readFileSync(path.join(audit, 'unresolved-investigation-worklist.json'), 'utf8'));
const cohortUnresolved = cohort.current_crosswalk_ccns['genuinely-unresolved'];
const ccns = [...new Set([...cohortUnresolved, ...worklist.records.map(record => record.ccn)])].sort();
const datasetId = 'bb342fae-b551-40fd-a738-e2e5878f3bbb';
const endpoint = `https://data.cms.gov/data-api/v1/dataset/${datasetId}/data?filter%5BPRVDR_NUM%5D=`;
const completeOutput = path.join(audit, 'reconciliation-nationwide-qies-q2-unresolved-crosscheck-2026-09-29.json');
const incompleteOutput = path.join(audit, 'reconciliation-nationwide-qies-q2-unresolved-crosscheck-2026-09-29.incomplete.json');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
let cursor = 0;
const results = [];

async function capture(ccn) {
  const url = `${endpoint}${ccn}&size=10`;
  let status = 0;
  let bodyBytes = 0;
  let responseSha256 = '';
  let exactRows = [];
  let error = '';
  for (let attempt = 1; attempt <= 8; attempt += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
      const body = Buffer.from(await response.arrayBuffer());
      status = response.status;
      bodyBytes = body.length;
      responseSha256 = hash(body);
      if (!response.ok) {
        const retryAfter = Number(response.headers.get('retry-after'));
        const retryMs = Number.isFinite(retryAfter) && retryAfter > 0
          ? Math.min(retryAfter * 1000, 60000)
          : Math.min(15000 * (2 ** (attempt - 1)), 60000);
        throw Object.assign(new Error(`HTTP ${response.status}`), {
          retryable: response.status === 429 || response.status >= 500,
          retryMs
        });
      }
      const parsed = JSON.parse(body.toString('utf8'));
      if (!Array.isArray(parsed)) throw new Error('response is not a JSON array');
      if (parsed.some(row => String(row.PRVDR_NUM || '').trim() !== ccn))
        throw new Error('exact filter returned a row for another provider number');
      exactRows = parsed;
      error = '';
      break;
    } catch (cause) {
      error = cause.message;
      if (attempt < 8 && cause.retryable !== false)
        await new Promise(resolve => setTimeout(resolve, cause.retryMs || Math.min(1000 * (2 ** (attempt - 1)), 30000)));
    }
  }
  const fields = exactRows.map(row => ({
    provider_number: String(row.PRVDR_NUM || '').trim(),
    facility_name: row.FAC_NAME || '',
    address: row.ST_ADR || '',
    city: row.CITY_NAME || '',
    state: row.STATE_CD || '',
    provider_category_code: row.PRVDR_CTGRY_CD || '',
    provider_category_subtype_code: row.PRVDR_CTGRY_SBTYP_CD || '',
    compliance_status_code: row.CMPLNC_STUS_CD || '',
    eligibility_switch: row.ELGBLTY_SW || '',
    certification_date: row.CRTFCTN_DT || '',
    original_participation_date: row.ORGNL_PRTCPTN_DT || '',
    program_termination_code: row.PGM_TRMNTN_CD || '',
    termination_or_expiration_date: row.TRMNTN_EXPRTN_DT || '',
    chow_date: row.CHOW_DT || '',
    cross_reference_provider_number: row.CROSS_REF_PROVIDER_NUMBER || ''
  }));
  return {
    ccn,
    query_url: url,
    http_status: status,
    response_bytes: bodyBytes,
    response_sha256: responseSha256,
    exact_provider_rows: fields,
    ...(error ? { error } : {})
  };
}

async function worker() {
  while (cursor < ccns.length) {
    const ccn = ccns[cursor++];
    results.push(await capture(ccn));
  }
}

async function main() {
  await Promise.all(Array.from({ length: 2 }, worker));
  results.sort((a, b) => a.ccn.localeCompare(b.ccn));
  const rows = results.flatMap(result => result.exact_provider_rows);
  const withTerminationDate = rows.filter(row => row.termination_or_expiration_date);
  const byTerminationCode = {};
  for (const row of rows) {
    const code = row.program_termination_code || '(blank)';
    byTerminationCode[code] = (byTerminationCode[code] || 0) + 1;
  }
  const proof = {
    audit_id: 'reconciliation-nationwide-qies-q2-unresolved-crosscheck-2026-09-29',
    observed_at: new Date().toISOString(),
    ccn_scope: {
      historical_891_unresolved_ccns: cohortUnresolved.length,
      nationwide_unresolved_ccns: worklist.records.length,
      union_ccns: ccns.length,
      worklist_extra_ccns: worklist.records.map(record => record.ccn).filter(ccn => !cohortUnresolved.includes(ccn))
    },
    source: {
      dataset_landing_page: 'https://data.cms.gov/provider-characteristics/hospitals-and-other-facilities/provider-of-services-file-quality-improvement-and-evaluation-system',
      dataset_catalog: 'https://catalog.data.gov/dataset/provider-of-services-file-quality-improvement-and-evaluation-system',
      dataset_version_title: 'Provider of Services File - Quality Improvement and Evaluation System : 2026-04-01 (Q2 2026)',
      temporal_coverage_end: '2026-06-30',
      dataset_id: datasetId,
      csv_distribution: 'https://data.cms.gov/sites/default/files/2026-07/7780b4e3-4c4b-4811-8884-65ca23b7a4e8/Hospital_and_other.DATA.Q2_2026.csv',
      code_layout_url: 'https://data.cms.gov/sites/default/files/2023-07/0ca58d5d-7914-4532-b22d-41741d3e6151/P.QWB.POSQ.OTHER.LAYOUT.MAR23.pdf',
      code_meaning: 'CMS POS layout defines PGM_TRMNTN_CD 00 as ACTIVE PROVIDER and TRMNTN_EXPRTN_DT as the date the provider was terminated.',
      catalog_caveat: 'CMS landing page displayed Q1 2026 as latest when checked; the CMS distribution catalog lists the versioned Q2 2026 API/CSV and temporal coverage through 2026-06-30.'
    },
    summary: {
      attempted_exact_ccns: ccns.length,
      successful_http_200: results.filter(result => result.http_status === 200 && !result.error).length,
      exact_provider_rows: rows.length,
      no_exact_provider_row: results.filter(result => result.http_status === 200 && !result.error && result.exact_provider_rows.length === 0).length,
      failed_or_invalid_responses: results.filter(result => result.error).length,
      rows_with_termination_date: withTerminationDate.length,
      rows_with_non_00_termination_code: rows.filter(row => row.program_termination_code && row.program_termination_code !== '00').length,
      termination_code_counts: byTerminationCode,
      records_with_termination_date: results.filter(result => result.exact_provider_rows.some(row => row.termination_or_expiration_date)).map(result => result.ccn),
      no_row_ccns: results.filter(result => result.http_status === 200 && !result.error && result.exact_provider_rows.length === 0).map(result => result.ccn),
      failure_ccns: results.filter(result => result.error).map(result => ({ ccn: result.ccn, error: result.error }))
    },
    interpretation: 'Exact QIES rows provide dated certification-status context only. A no-row API result is not a termination finding. A termination row does not by itself determine HPT MRF coverage, historical compliance, or scope-exemption eligibility; each case still requires exact per-CCN review.',
    records: results
  };
  const output = proof.summary.failed_or_invalid_responses ? incompleteOutput : completeOutput;
  fs.writeFileSync(output, `${JSON.stringify(proof, null, 2)}\n`);
  console.log(JSON.stringify({ output: path.relative(root, output), observed_at: proof.observed_at, ccn_scope: proof.ccn_scope, summary: proof.summary }));
  if (proof.summary.failed_or_invalid_responses) process.exitCode = 1;
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
