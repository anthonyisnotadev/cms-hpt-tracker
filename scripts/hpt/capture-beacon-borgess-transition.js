'use strict';
const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const { retrieve, parsePayload } = require('./lib/recovery-transport');
const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const pointerUrl = 'https://beaconhealthsystem.org/cms-hpt.txt';
const priceUrl = 'https://www.beaconhealthsystem.org/hospital-chargemaster/';
const transitionUrl = 'https://www.beaconhealthsystem.org/bright-future/';
const cases = [
  { ccn: '230117', name: 'Beacon Kalamazoo', oldName: 'BORGESS MEDICAL CENTER', street: '1521 GULL ROAD', zip: '49048',
    page: 'https://locations.beaconhealthsystem.org/mi/kalamazoo/beacon-kalamazoo-formerly-borgess-hospital',
    url: 'https://www.beaconhealthsystem.org/wp-content/uploads/2026/03/381360526-Beacon-Kalamazoo-Hospital-Standard-Charges.csv?v=2',
    address: '1521 GULL ROAD KALAMAZOO, MI 49048' },
  { ccn: '231315', name: 'Beacon Dowagiac', oldName: 'ASCENSION BORGESS LEE HOSPITAL', street: '420 W HIGH ST', zip: '49047',
    page: 'https://locations.beaconhealthsystem.org/mi/dowagiac/beacon-dowagiac-formerly-borgess-lee-hospital',
    url: 'https://www.beaconhealthsystem.org/wp-content/uploads/2026/03/381490190-Beacon-Dowagiac-Hospital-Standard-Charges.csv?v=2',
    address: '420 WEST HIGH ST DOWAGIAC, MI 49047' },
];
async function main() {
  const roster = JSON.parse(fs.readFileSync(path.join(root, 'cms_data/hpt/roster.json')));
  const nationwide = JSON.parse(fs.readFileSync(path.join(audit, 'nationwide-verification.json'))).records;
  for (const item of cases) {
    const row = roster.find(entry => entry.ccn === item.ccn);
    const observation = nationwide.find(entry => entry.ccn === item.ccn);
    if (row?.name !== item.oldName || row.address !== item.street || row.state !== 'MI' || row.zip !== item.zip
        || observation?.disposition !== 'pointer-facility-match-unresolved')
      throw new Error(`Borgess ${item.ccn} baseline changed`);
  }
  const [pointer, price, transition, ...responses] = await Promise.all([
    retrieve(pointerUrl, 65536, { timeoutMs: 30000 }),
    retrieve(priceUrl, 262144, { timeoutMs: 30000 }),
    retrieve(transitionUrl, 262144, { timeoutMs: 30000 }),
    ...cases.flatMap(item => [
      retrieve(item.page, 262144, { timeoutMs: 30000 }),
      retrieve(item.url, 262144, { timeoutMs: 45000 }),
      retrieve(item.url.replace('v=2', 'v=3'), 262144, { timeoutMs: 45000 }),
    ]),
  ]);
  const raw = fs.readFileSync(path.join(root, 'cms_data/hpt/pointer-corpus/raw/beaconhealthsystem.org-9d5361253689.txt'));
  const transitionText = cheerio.load(transition.body.toString('utf8'))('body').text().replace(/\s+/g, ' ');
  const $price = cheerio.load(price.body.toString('utf8'));
  const pageLinks = $price('a[href]').map((_, node) => new URL($price(node).attr('href'), priceUrl).href).get();
  if (![200, 206].includes(pointer.status) || !pointer.body.equals(raw)
      || pointer.sha256 !== 'eff7de02d98da37ef936370ef5aaa649547d9cec3006e12b29b7a0e4bce6a163'
      || ![200, 206].includes(price.status) || ![200, 206].includes(transition.status)
      || !transitionText.includes('Beacon Kalamazoo') || !transitionText.includes('Beacon Dowagiac')
      || !transitionText.includes('formerly Borgess'))
    throw new Error('Beacon current publisher root/page/transition changed');
  const blocks = pointer.body.toString('utf8').split(/\r?\n\s*\r?\n/);
  const records = [];
  for (const [i, item] of cases.entries()) {
    const facility = responses[3 * i], file = responses[3 * i + 1], pageFile = responses[3 * i + 2];
    const pageUrl = item.url.replace('v=2', 'v=3');
    const facilityText = cheerio.load(facility.body.toString('utf8'))('body').text().replace(/\s+/g, ' ');
    const block = blocks.find(text => text.split(/\r?\n/).some(line => line.trim() === `location-name: ${item.name}`));
    const parsed = (await parsePayload(file.body, file.headers['content-type'] || 'text/csv')).parsed.find(row => row.innerKind === 'csv');
    if (![200, 206].includes(facility.status) || ![200, 206].includes(file.status) || file.body.length !== 262144
        || ![200, 206].includes(pageFile.status) || pageFile.body.length !== 262144
        || !pageFile.body.equals(file.body)
        || !facilityText.includes(item.name) || !facilityText.includes(item.zip)
        || !facilityText.includes(item.ccn === '230117' ? '1521 Gull' : '420 West High')
        || !block?.includes(`mrf-url: ${item.url}`) || !pageLinks.includes(pageUrl)
        || parsed?.mrfHospitalName !== item.name.toUpperCase() || parsed.mrfLocationName !== item.name.toUpperCase()
        || parsed.mrfAddress !== item.address || parsed.mrfLicenseState !== 'MI'
        || parsed.declaredLastUpdated !== '2026-01-01' || parsed.cmsVersion !== '3.0.0')
      throw new Error(`Beacon ${item.ccn} campus/page/pointer/file changed: ${JSON.stringify({facilityStatus:facility.status,fileStatus:file.status,pageFileStatus:pageFile.status,pageLink:pageLinks.includes(pageUrl),parsed})}`);
    records.push({ ccn: item.ccn, roster_name: item.oldName, roster_street: item.street,
      current_location_name: item.name, facility_page_url: item.page, facility_page_sha256: facility.sha256,
      pointer_entry_without_contacts: block.split(/\r?\n/).filter(line => /^(location-name|source-page-url|mrf-url):/.test(line)),
      mrf_url: item.url, mrf_http_status: file.status,
      pricing_page_mrf_url: pageUrl, pricing_page_mrf_http_status: pageFile.status,
      pricing_page_mrf_prefix_sha256: pageFile.sha256, pricing_page_mrf_checked_at: pageFile.checkedAt,
      pricing_page_pointer_prefixes_match: true,
      file_total_bytes: Number((file.headers['content-range'] || '').split('/')[1]) || null,
      retained_sample: `cms_data/hpt/nationwide-verification/file-byte-proof/${file.sha256}.bin`,
      retained_bytes: file.body.length, retained_sha256: file.sha256,
      declared_hospital_name: parsed.mrfHospitalName, declared_location_name: parsed.mrfLocationName,
      declared_address: parsed.mrfAddress, declared_license_state: parsed.mrfLicenseState,
      declared_date: parsed.declaredLastUpdated, declared_version: parsed.cmsVersion,
      observed_at: file.checkedAt, _bytes: file.body });
  }
  const sampleDir = path.join(root, 'cms_data/hpt/nationwide-verification/file-byte-proof');
  fs.mkdirSync(sampleDir, { recursive: true });
  for (const record of records) { fs.writeFileSync(path.join(root, record.retained_sample), record._bytes); delete record._bytes; }
  const proof = { pointer_url: pointerUrl, pointer_sha256: pointer.sha256, pointer_observed_at: pointer.checkedAt,
    source_page_url: priceUrl, source_page_sha256: price.sha256,
    transition_page_url: transitionUrl, transition_page_sha256: transition.sha256,
    records, limitation: 'Two former Ascension/Borgess roster CCNs are matched to separate current Beacon hospital campuses and exact current pointer entries. Each pricing-page URL uses v=3 while its pointer URL uses v=2; the bounded 262,144-byte prefixes match, but complete-file equality is not established. This is file discovery and metadata corroboration, not complete-file validation, an enrollment-transition determination or legal compliance.' };
  fs.writeFileSync(path.join(audit, 'reconciliation-beacon-borgess-transition-proof.json'), JSON.stringify(proof, null, 2) + '\n');
  console.log(JSON.stringify({ pointer_sha256: pointer.sha256, records: records.map(({ccn,retained_sha256}) => ({ccn,retained_sha256})) }));
}
if (require.main === module) main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
