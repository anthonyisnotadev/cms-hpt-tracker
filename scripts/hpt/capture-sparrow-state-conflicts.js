'use strict';
const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const { retrieve, parsePayload } = require('./lib/recovery-transport');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const pointerUrl = 'https://uofmhealthsparrow.org/cms-hpt.txt';
const priceUrl = 'https://www.uofmhealthsparrow.org/patient-resources/financial-resources/standard-charges';
const cases = [
  { ccn: '230208', slug: 'carson', name: 'University of Michigan Health-Sparrow Carson', street: '406 E', zip: '48811', version: '3.1.0' },
  { ccn: '231326', slug: 'clinton', name: 'University of Michigan Health-Sparrow Clinton', street: '805 S', zip: '48879', version: '3.1.0' },
  { ccn: '231327', slug: 'eaton', name: 'University of Michigan Health-Sparrow Eaton', street: '321 E', zip: '48813', version: '3.1.0' },
  { ccn: '231331', slug: 'ionia', name: 'University of Michigan Health-Sparrow Ionia', street: '3565 S', zip: '48846', version: '4.1.0' },
];
const fileUrl = slug => `https://www.uofmhealthsparrow.org/sites/default/files/2026-03/um-health-sparrow-${slug}-machine-readable-file-03-31-2026.csv`;
const facilityUrl = slug => `https://www.uofmhealthsparrow.org/our-hospitals-services/um-health-sparrow-hospitals/${slug}`;

async function main() {
  const roster = JSON.parse(fs.readFileSync(path.join(root, 'cms_data/hpt/roster.json')));
  const nationwide = JSON.parse(fs.readFileSync(path.join(audit, 'nationwide-verification.json'))).records;
  for (const item of cases) {
    const facility = roster.find(row => row.ccn === item.ccn);
    const observation = nationwide.find(row => row.ccn === item.ccn);
    if (facility?.state !== 'MI' || facility.zip !== item.zip ||
        observation?.disposition !== 'pointer-facility-match-unresolved')
      throw new Error(`Sparrow ${item.ccn} baseline changed`);
  }
  const [pointer, price, ...responses] = await Promise.all([
    retrieve(pointerUrl, 65536, { timeoutMs: 30000 }),
    retrieve(priceUrl, 262144, { timeoutMs: 30000 }),
    ...cases.flatMap(item => [
      retrieve(facilityUrl(item.slug), 262144, { timeoutMs: 30000 }),
      retrieve(fileUrl(item.slug), 262144, { timeoutMs: 35000 }),
    ]),
  ]);
  const priorRaw = fs.readFileSync(path.join(root, 'cms_data/hpt/pointer-corpus/raw/uofmhealthsparrow.org-2e87ccdc4596.txt'));
  if (pointer.status !== 200 || pointer.sha256 !== '84324065af2b59be2d901a4d5709efd06a19a0b67b1c8e475ee438339689c43b'
      || !pointer.body.equals(priorRaw) || ![200, 206].includes(price.status))
    throw new Error('Sparrow root or pricing page changed');
  const blocks = pointer.body.toString('utf8').split(/\r?\n\s*\r?\n/);
  const $ = cheerio.load(price.body.toString('utf8'));
  const pageLinks = $('a[href]').map((_, node) => new URL($(node).attr('href'), priceUrl).href).get();
  const records = [];
  for (const [i, item] of cases.entries()) {
    const facility = responses[2 * i], file = responses[2 * i + 1];
    const url = fileUrl(item.slug);
    const block = blocks.find(text => text.split(/\r?\n/).some(line => line.trim() === `location-name: ${item.name}`));
    const parsed = (await parsePayload(file.body, file.headers['content-type'] || 'text/csv')).parsed
      .find(row => row.innerKind === 'csv');
    const facilityText = cheerio.load(facility.body.toString('utf8'))('body').text().replace(/\s+/g, ' ');
    if (![200, 206].includes(facility.status) || file.status !== 206 || file.body.length !== 262144
        || !block?.includes(`mrf-url: ${url}`) || !pageLinks.includes(url)
        || !facilityText.includes(item.street) || !facilityText.includes(item.zip)
        || parsed?.mrfHospitalName.trim() !== item.name || parsed.mrfLocationName.trim() !== item.name
        || !parsed.mrfAddress.includes(item.street) || !parsed.mrfAddress.includes(item.zip)
        || parsed.mrfLicenseState !== 'CA' || parsed.declaredLastUpdated !== '2026-04-01'
        || parsed.cmsVersion !== item.version)
      throw new Error(`Sparrow ${item.ccn} current identity or metadata changed: ${JSON.stringify({facilityStatus:facility.status,fileStatus:file.status,parsed})}`);
    const retained = `cms_data/hpt/nationwide-verification/file-byte-proof/${file.sha256}.bin`;
    records.push({ ccn: item.ccn, facility_page_url: facilityUrl(item.slug), facility_page_sha256: facility.sha256,
      pointer_location_name: item.name, mrf_url: url, source_page_url: priceUrl,
      mrf_http_status: file.status, file_total_bytes: Number((file.headers['content-range'] || '').split('/')[1]) || null,
      retained_sample: retained, retained_bytes: file.body.length, retained_sha256: file.sha256,
      declared_hospital_name: parsed.mrfHospitalName, declared_location_name: parsed.mrfLocationName,
      declared_address: parsed.mrfAddress, declared_license_state: parsed.mrfLicenseState,
      facility_state: 'MI', declared_date: parsed.declaredLastUpdated, declared_version: parsed.cmsVersion,
      observed_at: file.checkedAt, _bytes: file.body });
  }
  const sampleDir = path.join(root, 'cms_data/hpt/nationwide-verification/file-byte-proof');
  fs.mkdirSync(sampleDir, { recursive: true });
  for (const record of records) { fs.writeFileSync(path.join(root, record.retained_sample), record._bytes); delete record._bytes; }
  const proof = { pointer_url: pointerUrl, pointer_sha256: pointer.sha256, pointer_observed_at: pointer.checkedAt,
    source_page_url: priceUrl, source_page_sha256: price.sha256, source_page_observed_at: price.checkedAt,
    records, limitation: 'Four independently identified Michigan campuses have current exact pointer/page-linked CSV prefixes whose license_number state is CA. This is a specific publisher metadata conflict, not proof about all rows or legal compliance. Versions and Clinton address spelling are preserved literally.' };
  fs.writeFileSync(path.join(audit, 'reconciliation-sparrow-state-conflicts.json'), JSON.stringify(proof, null, 2) + '\n');
  console.log(JSON.stringify({ pointer_sha256: pointer.sha256, records: records.map(({ccn,retained_sha256}) => ({ccn,retained_sha256})) }));
}
if (require.main === module) main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
