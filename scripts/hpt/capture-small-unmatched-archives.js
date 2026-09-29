'use strict';
const fs = require('fs');
const path = require('path');
const { retrieve, sha } = require('./lib/recovery-transport');
const { pooled } = require('./lib/util');
const root = path.resolve(__dirname, '../..');
const rawDir = path.join(root, 'cms_data/hpt/nationwide-verification/file-byte-proof');
const out = path.join(root, 'data/hpt-audit/reconciliation-small-unmatched-archives.json');
const cases = [
  ['261327', 'https://rayhealthcare.org/wp-content/uploads/2022/09/PRICE_TRANSPARENCY.xlsx'],
  ['450489', 'https://s3.amazonaws.com/ycubaa-production-marlin-1-charge-management-public/facilities/741f735f-d6cc-4802-8169-175329ceb889/95-3999999_MedicalArtsHospital_StandardCharges_120723.xlsx'],
  ['171357', 'https://www.hillsborohospital.com/docs/Hillsboro_CDM_List_5.15.2023.xlsx'],
  ['450465', 'https://www.matagordaregional.org/documents/746025069_Matagorda-Regional-Medical-Center_standardcharges.zip'],
  ['490075', 'https://www.sovahhealth.com/docs/ahsovahhealthlibraries/hcl/mrf3q262/202028539_sovah-health-martinsville_standardcharges.csv.zip'],
  ['281322', 'https://www.stmaryrehabilitationhospital.com/docs/irfstmaryrehabilitationhospitallibraries/mar2026/273938747_st-mary-rehabilitation-hospital_standardcharges.csv.zip'],
  ['010126', 'https://www.troymedicalcenter.com/wp-content/uploads/2024/08/TRMC_300_shoppable_hospital_services_web-file-7-1-2024-a-1.xlsx']
];
async function main() {
  fs.mkdirSync(rawDir, { recursive: true });
  const records = [];
  await pooled(cases, { concurrency: 3, keyFn: item => new URL(item[1]).hostname }, async ([ccn, url]) => {
    const response = await retrieve(url, 2097152, { timeoutMs: 30000, curlOnStatuses: [403, 429, 500, 502, 503, 504] });
    const total = Number(String(response.headers['content-range'] || '').match(/\/(\d+)$/)?.[1] || response.body.length);
    const complete = response.status >= 200 && response.status < 300 && response.body.length === total && total <= 2097152;
    const digest = response.body.length ? sha(response.body) : '';
    const extension = response.body.subarray(0, 2).toString('hex') === '504b' ? '.zip' : '.bin';
    const artifact = digest ? path.join(rawDir, `${digest}${extension}`) : '';
    if (artifact) fs.writeFileSync(artifact, response.body);
    records.push({ ccn, url, checked_at: response.checkedAt, http_status: response.status, content_type: response.headers['content-type'] || '',
      expected_bytes: total, bytes_retained: response.body.length, complete, sha256: digest,
      raw_artifact: artifact ? path.relative(root, artifact).replaceAll('\\', '/') : '', error: response.error || '' });
  });
  records.sort((a, b) => a.ccn.localeCompare(b.ccn));
  fs.writeFileSync(out, JSON.stringify({ generated_at: new Date().toISOString(), cap_bytes: 2097152, records }, null, 2) + '\n');
  console.log(JSON.stringify(records, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
