'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..', '..');
const proofPath = path.join(root, 'data/hpt-audit/reconciliation-valley-community-hospital-closure-scope-proof-2026-09-23.json');
const endpoint = 'https://data.cms.gov/data-api/v1/dataset/f6f6505c-e8b0-4d57-b258-e2b94133aaf2/data?filter%5BCCN%5D=370243&size=20&offset=0';

async function main() {
  const ps = "$ErrorActionPreference='Stop';$r=Invoke-WebRequest -UseBasicParsing -Uri '" + endpoint
    + "' -Headers @{Accept='application/json'} -TimeoutSec 30;[Console]::Out.Write((@{status=[int]$r.StatusCode;contentType=[string]$r.Headers['Content-Type'];body=[string]$r.Content}|ConvertTo-Json -Compress -Depth 3))";
  const envelope = JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 2 * 1024 * 1024
  }));
  const raw = envelope.body;
  if (envelope.status !== 200) throw new Error(`CMS Hospital Enrollments returned HTTP ${envelope.status}`);
  const rows = JSON.parse(raw);
  if (!Array.isArray(rows) || rows.length !== 1) throw new Error(`Expected one exact-CCN result, got ${rows?.length}`);
  const row = rows[0];
  const expected = {
    CCN: '370243',
    NPI: '1053997338',
    'ENROLLMENT STATE': 'OK',
    'PROVIDER TYPE TEXT': 'PART A PROVIDER - HOSPITAL',
    'ORGANIZATION NAME': 'SOUTHERN PLAINS MEDICAL CENTER OF GARVIN COUNTY LLC',
    'DOING BUSINESS AS NAME': 'VALLEY COMMUNITY HOSPITAL',
    'ADDRESS LINE 1': '100 VALLEY DR',
    CITY: 'PAULS VALLEY',
    STATE: 'OK',
    'ZIP CODE': '730756613',
    'SUBGROUP - ACUTE CARE': 'Y',
    'SUBGROUP - SHORT-TERM': 'Y',
    'SUBGROUP - SWING-BED APPROVED': 'Y'
  };
  for (const [key, value] of Object.entries(expected)) {
    if (row[key] !== value) throw new Error(`CMS row changed at ${key}: ${JSON.stringify(row[key])}`);
  }

  const proof = JSON.parse(fs.readFileSync(proofPath, 'utf8'));
  proof.cms_current_enrollment_recheck_2026_09_29 = {
    observed_at: new Date().toISOString(),
    dataset_release: 'May 2026',
    dataset_page_url: 'https://data.cms.gov/provider-characteristics/hospitals-and-other-facilities/hospital-enrollments',
    dataset_description: 'CMS says this monthly PECOS-derived dataset contains hospitals currently enrolled in Medicare; latest release shown on the source page is May 2026.',
    query_url: endpoint,
    http_status: envelope.status,
    content_type: envelope.contentType,
    response_bytes: Buffer.byteLength(raw),
    response_sha256: crypto.createHash('sha256').update(raw).digest('hex'),
    exact_result_count: rows.length,
    selected_fields: Object.fromEntries(Object.keys(expected).map(key => [key, row[key]])),
    interpretation: 'New primary CMS enrollment evidence supports active CCN 370243 through the May 2026 release and corroborates the state-listed facility identity/address. It does not establish status after the release cutoff, recover a CMS price-transparency pointer/MRF, or resolve HPT publication. The January 2025 closure report is not evidence of current termination by itself.',
    disposition_changed: false,
    next_action: 'Obtain a publisher-confirmed current official domain and price-transparency route, or a corrected CMS pointer, then verify complete current file bytes, CCN/facility identity, Oklahoma location/state, declared metadata and usability. Do not treat the January 2025 closure report as current termination without effective-dated CMS or state evidence.'
  };
  proof.interpretation = 'The 2025 closure report conflicts with the April 2026 Oklahoma licensed-hospital directory, the CMS FY 2026 swing-bed list, and now the CMS Hospital Enrollments May 2026 exact-CCN record. The newer official state/CMS records support that CCN 370243 remained licensed/enrolled through their stated dates; post-May CMS status and the current HPT pointer/MRF remain unresolved.';
  proof.next_action = proof.cms_current_enrollment_recheck_2026_09_29.next_action;
  fs.writeFileSync(proofPath, `${JSON.stringify(proof, null, 2)}\n`);
  console.log(JSON.stringify({ ccn: proof.ccn, observed_at: proof.cms_current_enrollment_recheck_2026_09_29.observed_at,
    http_status: envelope.status, response_bytes: proof.cms_current_enrollment_recheck_2026_09_29.response_bytes,
    response_sha256: proof.cms_current_enrollment_recheck_2026_09_29.response_sha256,
    dataset_release: proof.cms_current_enrollment_recheck_2026_09_29.dataset_release,
    disposition_changed: false, selected_fields: proof.cms_current_enrollment_recheck_2026_09_29.selected_fields }, null, 2));
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
