'use strict';

const fs = require('fs');
const path = require('path');
const { retrieve, parsePayload } = require('./lib/recovery-transport');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const sampleDir = path.join(root, 'cms_data/hpt/nationwide-verification/file-byte-proof');
const pageUrl = 'https://whitfieldregionalhospital.com/price-transparency/';
const pointerUrl = 'https://whitfieldregionalhospital.com/cms-hpt.txt';
const fileUrl = 'https://whitfield.pt.panaceainc.com/MRFDownload/whitfield/whitfield';

async function main() {
  const [page, pointer, file] = await Promise.all([
    retrieve(pageUrl, 262144, { timeoutMs: 30000 }),
    retrieve(pointerUrl, 65536, { timeoutMs: 30000 }),
    retrieve(fileUrl, 262144, { timeoutMs: 30000 }),
  ]);
  const pageText = page.body.toString('utf8');
  if (page.status !== 200 || !pageText.includes(fileUrl)
      || !/Whitfield Regional Hospital/i.test(pageText)
      || !/105 Highway 80 East/i.test(pageText)
      || !/Demopolis/i.test(pageText)) throw new Error('Whitfield official page identity/file link changed');
  if (pointer.status !== 404 || !/Page not found - Whitfield Hospital/i.test(pointer.body.toString('utf8'))) {
    throw new Error('Whitfield current root pointer response changed');
  }
  const parsed = await parsePayload(file.body, file.headers['content-type'] || '');
  const header = parsed.parsed.find(item => item.innerKind === 'csv' && item.mrfLocationName && item.mrfAddress);
  if (file.status !== 200 || file.body.length < 65536 || !header
      || !/Whitfield Regional Hospital/i.test(header.mrfLocationName)
      || !/105 US Highway 80 E, Demopolis AL 36732/i.test(header.mrfAddress)
      || header.mrfLicenseState !== 'AL' || header.declaredLastUpdated !== '2026-04-01'
      || header.cmsVersion !== '3.0.0') throw new Error('Whitfield file identity/metadata proof incomplete');
  fs.mkdirSync(sampleDir, { recursive: true });
  const samplePath = path.join(sampleDir, `${file.sha256}.bin`);
  fs.writeFileSync(samplePath, file.body);
  const proof = {
    ccn: '010112', disposition: 'official-page-current-file-root-pointer-404',
    official_domain: 'whitfieldregionalhospital.com', official_page_url: pageUrl,
    official_page_sha256: page.sha256, official_page_http_status: page.status,
    pointer_url: pointerUrl, pointer_http_status: pointer.status, pointer_sha256: pointer.sha256,
    current_mrf_url: fileUrl, current_mrf_final_url: file.finalUrl,
    current_mrf_http_status: file.status, current_mrf_sha256: file.sha256,
    retained_bytes: file.body.length, retained_sample: path.relative(root, samplePath).replaceAll('\\', '/'),
    declared_hospital_name: header.mrfHospitalName, declared_location_name: header.mrfLocationName,
    declared_address: header.mrfAddress, declared_state: header.mrfLicenseState,
    declared_date: header.declaredLastUpdated, version: header.cmsVersion,
    observed_at: file.checkedAt,
    next_action: 'Retain the current official-page file evidence without calling it pointer-linked. Recheck the exact root pointer after a publisher change; keep the older bwwmh.com domain assignment as superseded history.',
  };
  const out = path.join(audit, 'reconciliation-whitfield-official-page-file-proof.json');
  fs.writeFileSync(out, `${JSON.stringify(proof, null, 2)}\n`);
  console.log(JSON.stringify({ ccn: proof.ccn, page: page.status, pointer: pointer.status,
    file: file.status, sample_sha256: file.sha256, date: proof.declared_date, version: proof.version }));
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
