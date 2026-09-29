'use strict';

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const { csvToObjects } = require('./lib/util');
const { retrieve, parsePayload } = require('./lib/recovery-transport');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const ccn = '251308';
const pointerUrl = 'https://www.nmhs.net/cms-hpt.txt';
const identityUrl = 'https://www.nmhs.net/locations/north-mississippi-medical-center-pontotoc';
const sourceUrl = 'https://www.nmhs.net/Patients-and-Visitors/Pricing/Price-Transparency';
const pointerFileUrl = 'https://apps.nmhs.net/files/pt_mrf/640751410_pontotoc-health-services-inc_standardcharges.json';
const pageFileUrl = 'https://apps.nmhs.net/files/pt_mrf/640751410_pontotoc-health-services,-inc-_standardcharges.json';

async function main() {
  const roster = csvToObjects(fs.readFileSync(path.join(root, 'cms_data/Hospital_General_Information.csv'), 'utf8'))
    .find(row => row['Facility ID'] === ccn);
  const base = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8'))
    .find(row => row.ccn === ccn);
  if (!roster || roster['Facility Name'] !== 'PONTOTOC HEALTH SERVICE INC CAH'
      || roster.Address !== '176 SOUTH MAIN STREET' || roster['City/Town'] !== 'PONTOTOC'
      || roster.State !== 'MS' || roster['ZIP Code'] !== '38863'
      || !base || base.finding !== 'not-assessed-domain-unknown' || base.domain)
    throw new Error('Pontotoc roster or base assessment changed');
  const [pointer, identity, source, missing, file] = await Promise.all([
    retrieve(pointerUrl, 65536, { timeoutMs: 30000 }),
    retrieve(identityUrl, 262144, { timeoutMs: 30000 }),
    retrieve(sourceUrl, 262144, { timeoutMs: 30000 }),
    retrieve(pointerFileUrl, 65536, { timeoutMs: 30000 }),
    retrieve(pageFileUrl, 262144, { timeoutMs: 30000 }),
  ]);
  const pointerText = pointer.body.toString('utf8');
  const identityText = cheerio.load(identity.body.toString('utf8')).text().replace(/\s+/g, ' ');
  const $ = cheerio.load(source.body.toString('utf8'));
  const pageLink = $('a').toArray().find(node => $(node).text().includes('Pontotoc Health Services, Inc. Standard Charges'));
  const href = pageLink && $(pageLink).attr('href');
  const header = (await parsePayload(file.body, file.headers['content-type'] || 'application/json'))
    .parsed.find(item => item.innerKind === 'json' && item.mrfHospitalName);
  if (![200, 206].includes(pointer.status)
      || !pointerText.includes('location-name: Pontotoc Health Services, Inc.')
      || !pointerText.includes(`mrf-url: ${pointerFileUrl}`)
      || identity.status !== 200 || !identityText.includes('Pontotoc Health Services, Inc.')
      || !identityText.includes('176 South Main Street') || !identityText.includes('Pontotoc, MS 38863')
      || source.status !== 200 || href !== pageFileUrl
      || missing.status !== 404 || file.status !== 206 || file.body.length !== 262144
      || header?.mrfHospitalName?.trim() !== 'PONTOTOC HEALTH SERVICES, INC'
      || header.mrfLocationName?.trim() !== 'PONTOTOC HEALTH SERVICES, INC'
      || header.mrfAddress !== '176 South Main Street, Pontotoc, MS 38863'
      || header.mrfLicenseState !== 'MS' || header.declaredLastUpdated !== '2026-04-01'
      || header.cmsVersion !== '3.0.0')
    throw new Error('Pontotoc page, pointer, missing target, or file changed: ' + JSON.stringify({
      pointerStatus: pointer.status, identityStatus: identity.status, sourceStatus: source.status,
      pageHref: href, pointerTargetStatus: missing.status, pageFileStatus: file.status,
      pageFileBytes: file.body.length, header,
    }));
  const sampleDir = path.join(root, 'cms_data/hpt/nationwide-verification/file-byte-proof');
  fs.mkdirSync(sampleDir, { recursive: true });
  const samplePath = path.join(sampleDir, `${file.sha256}.bin`);
  fs.writeFileSync(samplePath, file.body);
  const proof = {
    ccn, roster_name: roster['Facility Name'], roster_address: roster.Address,
    roster_city: roster['City/Town'], roster_state: roster.State, roster_zip: roster['ZIP Code'],
    official_domain: 'nmhs.net', identity_url: identityUrl, identity_sha256: identity.sha256,
    source_page_url: sourceUrl, source_page_sha256: source.sha256,
    pointer_url: pointerUrl, pointer_http_status: pointer.status, pointer_sha256: pointer.sha256,
    pointer_location_name: 'Pontotoc Health Services, Inc.', pointer_mrf_url: pointerFileUrl,
    pointer_mrf_http_status: missing.status, pointer_mrf_response_sha256: missing.sha256,
    page_mrf_url: pageFileUrl, page_mrf_http_status: file.status,
    page_mrf_sha256: file.sha256, page_mrf_sample_bytes: file.body.length,
    page_mrf_total_bytes: Number((file.headers['content-range'] || '').split('/')[1]),
    retained_sample: path.relative(root, samplePath).replaceAll('\\', '/'),
    declared_hospital_name: header.mrfHospitalName,
    declared_location_name: header.mrfLocationName,
    declared_address: header.mrfAddress, declared_license_state: header.mrfLicenseState,
    declared_date: header.declaredLastUpdated, version: header.cmsVersion,
    observed_at: file.checkedAt,
    next_action: 'Ask the publisher to reconcile the root pointer with the working pricing-page JSON URL. Recheck the exact pointer target and validate the complete JSON independently before any stronger finding.',
  };
  fs.writeFileSync(path.join(audit, 'reconciliation-pontotoc-pointer-page-proof.json'), JSON.stringify(proof, null, 2) + '\n');
  console.log(JSON.stringify({ ccn, pointer_target: missing.status, page_file: file.status, file_sha256: file.sha256 }));
}

if (require.main === module) main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
