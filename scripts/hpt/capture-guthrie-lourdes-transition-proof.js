'use strict';

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const { csvToObjects } = require('./lib/util');
const { parsePointer } = require('./lib/parse');
const { retrieve, parsePayload } = require('./lib/recovery-transport');

const root = path.resolve(__dirname, '../..');
const pointerUrl = 'https://www.guthrie.org/cms-hpt.txt';
const identityUrl = 'https://www.guthrie.org/lourdes';
const transitionUrl = 'https://www.guthrie.org/news/guthrie-acquire-our-lady-lourdes-memorial-hospital-and-affiliates';
const pricingUrl = 'https://www.guthrie.org/about-us/hospital-price-transparency';
const httpsFileUrl = 'https://rca.elevatepfs.com/ptapp/api/cdm/export/oneclick?recno=151e59cbd2694c13781019a3d8b1498b7b19d03390dd0d09f12c47078097ecad';
const httpFileUrl = httpsFileUrl.replace(/^https:/, 'http:');

async function main() {
  const roster = csvToObjects(fs.readFileSync(path.join(root, 'cms_data/Hospital_General_Information.csv'), 'utf8'))
    .find(row => row['Facility ID'] === '330011');
  const base = csvToObjects(fs.readFileSync(path.join(root, 'data/hpt-audit/compliance.csv'), 'utf8'))
    .find(row => row.ccn === '330011');
  if (!roster || roster['Facility Name'] !== 'OUR LADY OF LOURDES MEMORIAL HOSPITAL, INC'
      || roster.Address !== '169 RIVERSIDE DRIVE' || roster['City/Town'] !== 'BINGHAMTON'
      || roster.State !== 'NY' || roster['ZIP Code'] !== '13905'
      || !base || base.finding !== 'not-assessed-not-named-in-file')
    throw new Error('Lourdes roster or base changed');
  const [pointer, identity, transition, pricing, httpFile, httpsFile] = await Promise.all([
    retrieve(pointerUrl, 65536, { timeoutMs: 30000 }),
    retrieve(identityUrl, 262144, { timeoutMs: 30000 }),
    retrieve(transitionUrl, 262144, { timeoutMs: 30000 }),
    retrieve(pricingUrl, 262144, { timeoutMs: 30000 }),
    retrieve(httpFileUrl, 262144, { timeoutMs: 30000 }),
    retrieve(httpsFileUrl, 262144, { timeoutMs: 30000 }),
  ]);
  const entries = parsePointer(pointer.body.toString('utf8')).entries;
  const entry = entries.find(item => item.locationName === 'Guthrie Lourdes Hospital');
  const identityText = cheerio.load(identity.body.toString('utf8')).text().replace(/\s+/g, ' ');
  const transitionText = cheerio.load(transition.body.toString('utf8')).text().replace(/\s+/g, ' ');
  const $ = cheerio.load(pricing.body.toString('utf8'));
  const pricingLinks = $('a[href]').toArray().map(node => ({
    text: $(node).text().replace(/\s+/g, ' ').trim(),
    href: new URL($(node).attr('href'), pricingUrl).href,
  }));
  const header = (await parsePayload(httpsFile.body, httpsFile.headers['content-type'] || 'application/octet-stream'))
    .parsed.find(item => item.innerKind === 'csv' && item.mrfHospitalName);
  if (pointer.status !== 206 || pointer.body.length !== 2018 || entries.length !== 6
      || entry?.mrfUrl !== httpFileUrl
      || identity.status !== 200 || !identityText.includes('Guthrie Lourdes Hospital')
      || !identityText.includes('169 Riverside Drive') || !identityText.includes('Binghamton')
      || transition.status !== 200
      || !transitionText.includes('Our Lady of Lourdes Memorial Hospital')
      || !transitionText.includes('Ascension') || !transitionText.includes('Guthrie')
      || pricing.status !== 200
      || !pricingLinks.some(link => link.text === 'Lourdes Hospital' && link.href === httpsFileUrl)
      || httpFile.status !== 0 || !/Empty reply from server/i.test(httpFile.error || '')
      || httpsFile.status !== 200 || httpsFile.body.length !== 262144
      || header?.mrfHospitalName.trim() !== 'OUR LADY OF LOURDES MEMORIAL HOSPITAL INC. Doing Business As: LOURDES'
      || header.mrfLocationName !== 'Guthrie Lourdes Hospital'
      || header.mrfAddress !== '169 Riverside Drive, Binghamton, NY 13905'
      || header.mrfLicenseState !== 'NY' || header.declaredLastUpdated !== '2026-03-31'
      || header.cmsVersion !== '3.0.0')
    throw new Error('Lourdes transition, pointer URL role, or page file changed: ' + JSON.stringify({
      pointerStatus: pointer.status, pointerBytes: pointer.body.length, entries: entries.length,
      pointerFile: entry?.mrfUrl, identityStatus: identity.status, transitionStatus: transition.status,
      pricingStatus: pricing.status, pageLink: pricingLinks.some(link => link.text === 'Lourdes Hospital' && link.href === httpsFileUrl),
      httpStatus: httpFile.status, httpError: httpFile.error,
      httpsStatus: httpsFile.status, httpsBytes: httpsFile.body.length, header,
    }));
  const sampleDir = path.join(root, 'cms_data/hpt/nationwide-verification/file-byte-proof');
  fs.mkdirSync(sampleDir, { recursive: true });
  const samplePath = path.join(sampleDir, `${httpsFile.sha256}.bin`);
  fs.writeFileSync(samplePath, httpsFile.body);
  const proof = {
    ccn: '330011', roster_name: roster['Facility Name'], roster_address: roster.Address,
    roster_city: roster['City/Town'], roster_state: roster.State, roster_zip: roster['ZIP Code'],
    former_official_domain: 'healthcare.ascension.org', current_official_domain: 'guthrie.org',
    identity_page_url: identityUrl, identity_page_sha256: identity.sha256,
    transition_page_url: transitionUrl, transition_page_sha256: transition.sha256,
    transition_names_prior_operator: true,
    pointer_url: pointerUrl, pointer_sha256: pointer.sha256,
    pointer_bytes: pointer.body.length, pointer_entry_count: entries.length,
    pointer_location_name: entry.locationName, pointer_mrf_url: httpFileUrl,
    pointer_mrf_http_status: httpFile.status,
    pointer_mrf_transport_error: httpFile.error,
    pointer_mrf_browser_error: 'net::ERR_BLOCKED_BY_CLIENT',
    pointer_mrf_browser_observed_on: '2026-09-17',
    pricing_page_url: pricingUrl, pricing_page_sha256: pricing.sha256,
    pricing_page_label: 'Lourdes Hospital', pricing_page_mrf_url: httpsFileUrl,
    pricing_file_http_status: httpsFile.status,
    pricing_file_sample_sha256: httpsFile.sha256,
    pricing_file_sample_bytes: httpsFile.body.length,
    retained_sample: path.relative(root, samplePath).replaceAll('\\', '/'),
    declared_hospital_name: header.mrfHospitalName,
    declared_location_name: header.mrfLocationName,
    declared_address: header.mrfAddress,
    declared_license_state: header.mrfLicenseState,
    declared_date: header.declaredLastUpdated, version: header.cmsVersion,
    observed_at: httpsFile.checkedAt,
    next_action: 'Ask the publisher to use a tested HTTPS mrf-url in the current root pointer, or verify an authorized HTTP redirect. Recheck exact pointer access after a material change; separately validate the complete page-linked CSV. Do not treat client/browser blocking of HTTP as proof of file absence.',
  };
  fs.writeFileSync(path.join(root, 'data/hpt-audit/reconciliation-guthrie-lourdes-transition-proof.json'),
    JSON.stringify(proof, null, 2) + '\n');
  console.log(JSON.stringify({ ccn: proof.ccn, pointer_sha256: proof.pointer_sha256,
    page_file_sample_sha256: proof.pricing_file_sample_sha256,
    http_target_status: proof.pointer_mrf_http_status }));
}

if (require.main === module) main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
