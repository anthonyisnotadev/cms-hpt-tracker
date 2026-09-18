'use strict';

// Explicit, bounded primary-source snapshot review. This is not part of the
// offline tracker build and never changes a finding based on API absence.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '../..');
const worklistPath = path.join(root, 'data/hpt-audit/unresolved-investigation-worklist.json');
const outputPath = path.join(root, 'data/hpt-audit/priority-one-cms-enrollment-snapshot-review.json');
const version = '3b5eae55-981c-4358-b3f8-7032d053d893';
const curl = process.platform === 'win32' ? 'curl.exe' : 'curl';

function summarize(ccn, rows, url, raw, observedAt) {
  if (!Array.isArray(rows) || rows.some(row => String(row.CCN) !== ccn))
    throw new Error(`Invalid exact-CCN response for ${ccn}`);
  return {
    ccn, observed_at: observedAt, query_url: url,
    response_sha256: crypto.createHash('sha256').update(raw).digest('hex'),
    rows: rows.map(row => ({
      ccn: String(row.CCN),
      organization_name: row['ORGANIZATION NAME'] || '',
      address_line_1: row['ADDRESS LINE 1'] || '',
      city: row.CITY || '', state: row.STATE || '',
      provider_type_text: row['PROVIDER TYPE TEXT'] || '',
      enrollment_id: row['ENROLLMENT ID'] || '',
    })),
  };
}

function main() {
  const sourceBytes = fs.readFileSync(worklistPath);
  const worklist = JSON.parse(sourceBytes);
  const ccns = worklist.records.filter(row => row.investigation_tier === 1).map(row => row.ccn);
  if (!ccns.length || new Set(ccns).size !== ccns.length)
    throw new Error('Priority-one worklist must contain unique CCNs');
  const records = [];
  for (const ccn of ccns) {
    const url = `https://data.cms.gov/data-api/v1/dataset/${version}/data?filter%5BCCN%5D=${ccn}&size=10`;
    const raw = execFileSync(curl, ['-sS', '-L', '--retry', '2', '--retry-delay', '1',
      '--max-time', '30', url], { timeout: 35000 });
    if (!raw.length) throw new Error(`Empty transport response for ${ccn}`);
    const rows = JSON.parse(raw.toString('utf8'));
    records.push(summarize(ccn, rows, url, raw, new Date().toISOString()));
    console.log(`${ccn}: ${rows.length} row(s)`);
  }
  const result = {
    source: 'CMS Hospital Enrollments public Data API',
    dataset_page: 'https://data.cms.gov/provider-characteristics/hospitals-and-other-facilities/hospital-enrollments',
    dataset_version_id: version,
    worklist_sha256: crypto.createHash('sha256').update(sourceBytes).digest('hex'),
    summary: { queried_ccns: ccns.length, ccns_with_rows: records.filter(row => row.rows.length).length,
      ccns_without_rows: records.filter(row => !row.rows.length).length },
    limitation: 'A row corroborates exact-CCN enrollment identity in this dataset version, not a specific MRF or legal compliance. No row is not proof of CCN termination, facility closure, or lack of an MRF. This snapshot does not provide transition effective-date history.',
    records,
  };
  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result.summary));
}

if (require.main === module) main();
module.exports = { summarize };
