'use strict';
const fs = require('fs');
const path = require('path');
const { csvToObjects } = require('./lib/util');
const { retrieve, parsePayload, sha } = require('./lib/recovery-transport');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const headerPath = path.join(root, 'cms_data/hpt/nationwide-verification/mrf-headers.csv');
const outputPath = path.join(audit, 'reconciliation-winchester-wadley-proof.json');
const sampleDir = path.join(root, 'cms_data/hpt/nationwide-verification/file-byte-proof');
const headers = csvToObjects(fs.readFileSync(headerPath, 'utf8'));

const cases = [
  {
    ccn: '440058', roster_name: 'SOUTHERN TENNESSEE REGIONAL HEALTH SYSTEM WINCHEST',
    roster_address: '185 HOSPITAL ROAD, WINCHESTER, TN 37398', marker: '621762535_strhs-winchester',
    pointer_location_name: 'Highpoint Health - Winchester with Ascension Saint Thomas',
    pointer_url: 'https://highpointhealthsystem.com/cms-hpt.txt', official_domain: 'highpointhealthsystem.com',
    official_facility_url: 'https://www.highpointhealthsystem.com/winchester',
    official_transition_url: 'https://www.highpointhealthsystem.com/news/2025/11/11/community-gathers-to-celebrate-new-location-names-and-signage-at-highpoint-health---sewanee-and-highpoint-health---winchester',
    government_identity_url: 'https://www.tn.gov/content/dam/tn/health/healthprofboards/hcf/Hospital-Full-Beds-Report.pdf'
  },
  {
    ccn: '450200', roster_name: 'WADLEY REGIONAL MEDICAL CENTER',
    roster_address: '1000 PINE STREET, TEXARKANA, TX 75501', marker: '752796815_pinestreettexarkana',
    pointer_location_name: 'CHRISTUS Health - Pine Street Hospital',
    pointer_url: 'https://christushealth.org/cms-hpt.txt', official_domain: 'christushealth.org',
    official_facility_url: 'https://www.christushealth.org/locations/texarkana-pine-street',
    official_transition_url: 'https://www.christushealth.org/connect/news/expands-in-texarkana'
  }
];

async function main() {
  fs.mkdirSync(sampleDir, { recursive: true });
  const records = [];
  for (const item of cases) {
    const row = headers.find(r => r.mrf_url.includes(item.marker));
    if (!row || row.header_status !== 'unmatched') throw new Error(`Expected unmatched header for ${item.ccn}`);
    if (!row.related_ccns.split('|').includes(item.ccn)) throw new Error(`CCN not related to pointer corpus row ${item.ccn}`);
    if (row.pointer_location_names.split('|').includes(item.pointer_location_name) === false) throw new Error(`Pointer location mismatch ${item.ccn}`);
    if (!row.pointer_urls.split('|').includes(item.pointer_url)) throw new Error(`Pointer URL missing ${item.ccn}`);
    const rawCandidates = row.raw_files.split('|').map(file => ({ file, path: path.join(root, file) }))
      .map(candidate => ({ ...candidate, body: fs.readFileSync(candidate.path) }));
    const selected = rawCandidates.find(candidate => {
      const text = candidate.body.toString('utf8');
      return text.includes(`location-name: ${item.pointer_location_name}`) && text.includes(`mrf-url: ${row.mrf_url}`);
    });
    if (!selected) throw new Error(`Exact pointer entry missing ${item.ccn}`);
    const rawPath = selected.path, raw = selected.body;
    if (!row.pointer_sha256s.split('|').includes(sha(raw))) throw new Error(`Pointer hash mismatch ${item.ccn}`);

    const response = await retrieve(row.mrf_url, 262144, { timeoutMs: 30000, curlOnStatuses: [403, 429, 500, 502, 503, 504] });
    if (response.status < 200 || response.status >= 300 || response.body.length === 0) throw new Error(`MRF retrieval failed ${item.ccn}: ${response.status} ${response.error || ''}`);
    const parsed = await parsePayload(response.body, response.headers['content-type'] || '');
    const candidate = parsed.parsed.find(p => p.cmsVersion && p.mrfHospitalName && p.mrfAddress && p.mrfLicenseState);
    if (!candidate || candidate.cmsVersion !== '3.0.0' || candidate.mrfLicenseState !== item.roster_address.split(', ')[2].slice(0, 2)) {
      throw new Error(`Incomplete or wrong-state MRF metadata ${item.ccn}`);
    }
    const samplePath = path.join(sampleDir, `${response.sha256}.bin`);
    fs.writeFileSync(samplePath, response.body);
    records.push({
      ...item, source_page_url: row.source_page_urls, pointer_sha256: sha(raw), pointer_raw_file: path.relative(root, rawPath).replaceAll('\\', '/'),
      pointer_mrf_url: row.mrf_url, mrf_http_status: response.status, mrf_final_url: response.finalUrl || row.mrf_url,
      mrf_sha256: response.sha256, retained_bytes: response.body.length,
      retained_sample: path.relative(root, samplePath).replaceAll('\\', '/'), file_kind: candidate.innerKind || candidate.fileKind,
      declared_hospital_name: candidate.mrfHospitalName, declared_location_name: candidate.mrfLocationName,
      declared_address: candidate.mrfAddress, declared_state: candidate.mrfLicenseState,
      declared_date: candidate.declaredLastUpdated, version: candidate.cmsVersion, observed_at: response.checkedAt,
      disposition: 'verified-current-mrf-after-first-party-identity-transition-review'
    });
  }
  fs.writeFileSync(outputPath, JSON.stringify({ generated_at: new Date().toISOString(), records }, null, 2) + '\n');
  console.log(JSON.stringify({ output: path.relative(root, outputPath), records: records.map(r => ({ ccn: r.ccn, status: r.mrf_http_status, bytes: r.retained_bytes, sha256: r.mrf_sha256 })) }, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
