'use strict';

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const { retrieve, parsePayload } = require('./lib/recovery-transport');

const root = path.resolve(__dirname, '../..');
const pointerUrl = 'https://www.wth.org/cms-hpt.txt';
const pageUrl = 'https://www.wth.org/financial-assistance-billing/hospital-charges/';
const identityUrl = 'https://www.wth.org/locations/west-tennessee-healthcare-milan-hospital/';
const fileUrl = 'https://www.wth.org/wp-content/uploads/standard-charges/62-1753289_MH_Standard_Charges.csv';
const rawAddress = '4039 Highland StreetMilan, TN 3, Milan, TN 8358-3493';

async function main() {
  const [pointer, page, identity, file] = await Promise.all([
    retrieve(pointerUrl, 65536, { timeoutMs: 30000 }),
    retrieve(pageUrl, 1048576, { timeoutMs: 30000 }),
    retrieve(identityUrl, 1048576, { timeoutMs: 30000 }),
    retrieve(fileUrl, 262144, { timeoutMs: 30000 }),
  ]);
  const $ = cheerio.load(page.body.toString('utf8'));
  const links = $('a').map((_, a) => ({ text: $(a).text().trim(), href: $(a).attr('href') })).get()
    .filter(link => link.href === fileUrl);
  const identityText = cheerio.load(identity.body.toString('utf8'))('body').text()
    .replace(/\s+/g, ' ').toLowerCase();
  const header = (await parsePayload(file.body, file.headers['content-type'] || '')).parsed
    .find(item => item.innerKind === 'csv' && item.mrfHospitalName);
  if (pointer.status !== 404 || page.status !== 200 || identity.status !== 200
      || file.status !== 206 || file.body.length !== 262144
      || links.length !== 1 || links[0].text !== 'Standard Charges'
      || !identityText.includes('west tennessee healthcare milan hospital')
      || !identityText.includes('4039 highland st') || !identityText.includes('milan, tn 38358')
      || !header || header.mrfHospitalName !== 'West Tennessee Healthcare Milan Hospital'
      || header.mrfLocationName !== 'West Tennessee Healthcare Milan Hospital'
      || header.mrfAddress !== rawAddress || header.mrfLicenseState !== 'TN'
      || header.declaredLastUpdated !== '2026-06-02' || header.cmsVersion !== '3.0.0') {
    throw new Error('WTH Milan page/identity/root/file proof changed');
  }
  const sampleDir = path.join(root, 'cms_data/hpt/nationwide-verification/file-byte-proof');
  fs.mkdirSync(sampleDir, { recursive: true });
  const samplePath = path.join(sampleDir, `${file.sha256}.bin`);
  fs.writeFileSync(samplePath, file.body);
  const record = {
    ccn: '440060', official_domain: 'wth.org', pointer_url: pointerUrl,
    pointer_http_status: pointer.status, pointer_sha256: pointer.sha256,
    source_page_url: pageUrl, source_page_sha256: page.sha256,
    official_identity_url: identityUrl, official_identity_sha256: identity.sha256,
    current_mrf_url: fileUrl, current_mrf_http_status: file.status,
    current_mrf_sha256: file.sha256, retained_bytes: file.body.length,
    retained_sample: path.relative(root, samplePath).replaceAll('\\', '/'),
    declared_hospital_name: header.mrfHospitalName,
    declared_location_name: header.mrfLocationName, declared_address: header.mrfAddress,
    declared_state: header.mrfLicenseState, declared_date: header.declaredLastUpdated,
    version: header.cmsVersion, observed_at: file.checkedAt,
    address_disposition: 'declared-address-malformed-street-city-state-match',
    next_action: 'Recheck the root cms-hpt.txt and the malformed hospital_address field after a publisher correction. Retain the current page-linked Milan CSV and independent campus address without treating the CSV as pointer-linked or repairing its declared address silently.',
  };
  fs.writeFileSync(path.join(root, 'data/hpt-audit/reconciliation-wth-milan-page-file-proof.json'),
    `${JSON.stringify({ disposition: 'official-page-file-root-404-malformed-address', record }, null, 2)}\n`);
  console.log(JSON.stringify({ ccn: record.ccn, root: record.pointer_http_status,
    sample_sha256: record.current_mrf_sha256, address_disposition: record.address_disposition }));
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
