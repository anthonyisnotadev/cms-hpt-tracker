'use strict';

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const { retrieve } = require('./lib/recovery-transport');
const { csvToObjects } = require('./lib/util');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const facilityUrl = 'https://www.hss.edu/locations/ny/main-campus';
const pageUrl = 'https://www.hss.edu/patient-care/paying-for-care/price-transparency';
const pointerUrl = 'https://hss.edu/cms-hpt.txt';

async function main() {
  const roster = csvToObjects(fs.readFileSync(path.join(root, 'cms_data/Hospital_General_Information.csv'), 'utf8'))
    .find(row => row['Facility ID'] === '330270');
  const base = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8'))
    .find(row => row.ccn === '330270');
  if (!roster || roster['Facility Name'] !== 'HOSPITAL FOR SPECIAL SURGERY'
      || roster.Address !== '535 EAST 70TH STREET' || roster['City/Town'] !== 'NEW YORK'
      || roster.State !== 'NY' || roster['ZIP Code'] !== '10021'
      || !base || base.finding !== 'mrf-blocked-to-automation' || base.pointer_url !== pointerUrl)
    throw new Error('HSS roster or prior access observation changed');
  const [facility, page, pointer] = await Promise.all([
    retrieve(facilityUrl, 262144, { timeoutMs: 30000 }),
    retrieve(pageUrl, 262144, { timeoutMs: 30000 }),
    retrieve(pointerUrl, 262144, { timeoutMs: 30000 }),
  ]);
  const facilityText = cheerio.load(facility.body.toString('utf8'))('body').text().replace(/\s+/g, ' ');
  const $ = cheerio.load(page.body.toString('utf8'));
  const pointerText = pointer.body.toString('utf8');
  const pointerFileUrl = pointerText.split(/\r?\n/).find(line => /^mrf-url:/i.test(line))?.replace(/^mrf-url:\s*/i, '');
  const links = $('a[href]').map((_, element) => {
    try { return new URL($(element).attr('href'), pageUrl).href; } catch { return ''; }
  }).get();
  if ([facility, page, pointer].some(result => ![200, 206].includes(result.status))
      || !facilityText.includes('Hospital for Special Surgery')
      || !facilityText.includes('535 East 70th Street')
      || !pointerText.includes('location-name: Hospital for Special Surgery')
      || pointerFileUrl !== base.mrf_url || !links.includes(pointerFileUrl))
    throw new Error('HSS exact page/pointer route changed');
  const observation = {
    ccn: '330270', observed_at: page.checkedAt,
    facility_page_url: facilityUrl, facility_page_sha256: facility.sha256,
    facility_address: '535 East 70th Street, New York, NY 10021',
    pricing_page_url: pageUrl, pricing_page_sha256: page.sha256,
    pointer_url: pointerUrl, pointer_sha256: pointer.sha256,
    pointer_and_first_party_page_link_same_file: true,
    pointer_file_url: pointerFileUrl,
    prior_browser_file_status: 'http-denied', prior_browser_observed_at: '2026-09-15T09:26:27.032Z',
    disposition: 'current-first-party-page-and-pointer-agree-but-exact-file-remains-client-denied',
    next_action: 'Seek a publisher-enabled or materially different authorized download route for the exact HSS Main Hospital JSON, then verify bounded bytes and declared campus metadata. The existing browser HTTP denial is a client observation, not proof of file absence; do not repeat the same client request without changed access conditions.',
  };
  const target = path.join(audit, 'reconciliation-manual-access-observations.json');
  const data = JSON.parse(fs.readFileSync(target, 'utf8'));
  if (data.records.some(row => row.ccn === '330270')) throw new Error('Existing HSS manual observation requires review');
  data.records.push(observation);
  data.records.sort((a, b) => a.ccn.localeCompare(b.ccn));
  fs.writeFileSync(target, JSON.stringify(data, null, 2) + '\n');
  console.log(JSON.stringify({ ccn: observation.ccn, page_sha256: page.sha256,
    pointer_sha256: pointer.sha256, page_pointer_same_file: true }));
}

if (require.main === module) main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
