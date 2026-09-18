'use strict';

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const { retrieve, parsePayload } = require('./lib/recovery-transport');
const { csvToObjects } = require('./lib/util');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const cases = [
  {
    ccn: '450674', name: 'WOMANS HOSPITAL OF TEXAS,THE', address: '7600 FANNIN', zip: '77054',
    pointerName: "WOMAN'S HOSPITAL OF TEXAS", fileName: 'THE WOMANS HOSPITAL OF TEXAS',
    fileAddress: '7600 FANNIN STREET, HOUSTON, TX, 77054',
    domain: 'womanshospital.com',
    facilityUrl: 'https://www.womanshospital.com/locations',
    pageUrl: 'https://www.womanshospital.com/patient-resources/patient-financial-resources/pricing-transparency-cms-required-file-of-standard-charges',
    pointerUrl: 'https://womanshospital.com/cms-hpt.txt',
  },
  {
    ccn: '450804', name: 'TEXAS ORTHOPEDIC HOSPITAL', address: '7401 SOUTH MAIN STREET', zip: '77030',
    pointerName: 'TEXAS ORTHOPEDIC HOSPITAL', fileName: 'TEXAS ORTHOPEDIC HOSPITAL',
    fileAddress: '7401 SOUTH MAIN STREET, HOUSTON, TX, 77030',
    domain: 'texasorthopedic.com',
    facilityUrl: 'https://www.texasorthopedic.com/locations',
    pageUrl: 'https://www.texasorthopedic.com/patient-resources/patient-financial-resources/pricing-transparency-cms-required-file-of-standard-charges',
    pointerUrl: 'https://texasorthopedic.com/cms-hpt.txt',
  },
];

async function capture(config, roster, base) {
  const [facility, page, pointer] = await Promise.all([
    retrieve(config.facilityUrl, 262144, { timeoutMs: 30000 }),
    retrieve(config.pageUrl, 262144, { timeoutMs: 30000 }),
    retrieve(config.pointerUrl, 65536, { timeoutMs: 30000 }),
  ]);
  const facilityText = cheerio.load(facility.body.toString('utf8'))('body').text().replace(/\s+/g, ' ');
  const $ = cheerio.load(page.body.toString('utf8'));
  const pointerText = pointer.body.toString('utf8');
  const pointerFileUrl = pointerText.match(/^mrf-url:\s*(\S+)/im)?.[1];
  const pointerSourceUrl = pointerText.match(/^source-page-url:\s*(\S+)/im)?.[1];
  const pageFileUrls = $('a[href]').map((_, el) => {
    try { return new URL($(el).attr('href'), config.pageUrl).href; } catch { return ''; }
  }).get().filter(url => url && pointerFileUrl && new URL(url).pathname === new URL(pointerFileUrl).pathname);
  if ([facility, page, pointer].some(result => ![200, 206].includes(result.status))
      || !facilityText.toLowerCase().includes(config.fileName.toLowerCase().replace('the womans', "the woman's"))
      || !facilityText.includes(config.zip) || !facilityText.includes(config.address.split(' ')[0])
      || !pointerText.includes(`location-name: ${config.pointerName}`)
      || pointerFileUrl !== base.mrf_url || pageFileUrls.length !== 1
      || pageFileUrls[0] === pointerFileUrl || !pointerSourceUrl)
    throw new Error(`${config.ccn} facility, pointer, or signed pricing-page link changed`);
  const pageFileUrl = pageFileUrls[0];
  const [pointerFile, pageFile, pointerSource] = await Promise.all([
    retrieve(pointerFileUrl, 65536, { timeoutMs: 30000 }),
    retrieve(pageFileUrl, 262144, { timeoutMs: 30000 }),
    retrieve(pointerSourceUrl, 65536, { timeoutMs: 30000 }),
  ]);
  const parsed = (await parsePayload(pageFile.body, pageFile.headers['content-type'] || 'application/octet-stream'))
    .parsed.find(item => item.innerKind === 'json');
  const totalBytes = Number((pageFile.headers['content-range'] || '').split('/')[1]) || null;
  const differentSignedFields = ['si', 'sv', 'sig'].every(key =>
    new URL(pointerFileUrl).searchParams.get(key) !== new URL(pageFileUrl).searchParams.get(key));
  if (pointerFile.status !== 403 || !/AuthenticationFailed/.test(pointerFile.body.toString('utf8'))
      || ![200, 206].includes(pageFile.status) || pageFile.body.length !== 262144
      || !totalBytes || totalBytes <= pageFile.body.length
      || !differentSignedFields || ![200, 206].includes(pointerSource.status)
      || new URL(pointerSource.finalUrl || pointerSourceUrl).pathname !== new URL(config.pageUrl).pathname
      || parsed?.mrfHospitalName !== config.fileName
      || parsed.mrfLocationName !== config.fileName
      || parsed.mrfAddress !== config.fileAddress
      || parsed.mrfLicenseState !== 'TX' || parsed.declaredLastUpdated !== '2026-05-14'
      || parsed.cmsVersion !== '3.0.0')
    throw new Error(`${config.ccn} stale pointer signature or current file proof changed`);
  const sampleDir = path.join(root, 'cms_data/hpt/nationwide-verification/file-byte-proof');
  fs.mkdirSync(sampleDir, { recursive: true });
  const samplePath = path.join(sampleDir, `${pageFile.sha256}.bin`);
  fs.writeFileSync(samplePath, pageFile.body);
  const nextAction = 'Publisher should update the root pointer mrf-url to the currently accessible pricing-page signed URL. Then recheck exact pointer/file equality and validate the complete JSON; do not infer file absence from the stale signature.';
  const proof = {
    ccn: config.ccn, roster_name: roster['Facility Name'], roster_address: roster.Address,
    roster_city: roster['City/Town'], roster_state: roster.State, roster_zip: roster['ZIP Code'],
    first_party_facility_url: config.facilityUrl, first_party_facility_http_status: facility.status,
    first_party_facility_sha256: facility.sha256,
    first_party_pricing_url: config.pageUrl, first_party_pricing_http_status: page.status,
    first_party_pricing_sha256: page.sha256,
    pointer_url: config.pointerUrl, pointer_http_status: pointer.status, pointer_sha256: pointer.sha256,
    pointer_location_name: config.pointerName, pointer_source_page_url: pointerSourceUrl,
    pointer_source_page_redirects_to_current_page: true,
    pointer_mrf_url: pointerFileUrl, pointer_mrf_http_status: pointerFile.status,
    pointer_mrf_error_code: 'AuthenticationFailed',
    page_mrf_url: pageFileUrl, page_mrf_http_status: pageFile.status,
    page_mrf_total_bytes: totalBytes, retained_bytes: pageFile.body.length,
    retained_sample: path.relative(root, samplePath).replaceAll('\\', '/'),
    page_mrf_sample_sha256: pageFile.sha256,
    signed_query_fields_changed: ['si', 'sv', 'sig'],
    declared_hospital_name: parsed.mrfHospitalName, declared_location_name: parsed.mrfLocationName,
    declared_address: parsed.mrfAddress, declared_license_state: parsed.mrfLicenseState,
    declared_date: parsed.declaredLastUpdated, declared_version: parsed.cmsVersion,
    observed_at: pageFile.checkedAt,
    limitation: `The root pointer's signed URL currently returns HTTP 403 AuthenticationFailed; the first-party pricing-page link to the same blob path uses a different public signature and yields a ${totalBytes}-byte JSON. Only its first 262,144 bytes were retained. This is not a working pointer-linked file or complete-file/legal validation. The public signed URLs are credential-bearing and need an outgoing-content review before publication.`,
    next_action: nextAction,
  };
  const evidence = {
    identity: 'corroborated',
    identity_basis: 'first-party-location-pricing-page-and-current-page-file-header-exact-hospital-address-state',
    officialDomain: config.domain, identityPageUrl: config.facilityUrl,
    pointerUrl: config.pointerUrl, pointerSha256: pointer.sha256, pointerHttpStatus: pointer.status,
    pointerMrfUrl: pointerFileUrl, pointerMrfHttpStatus: pointerFile.status,
    pointerIssue: 'pointer-mrf-http-error-current-source-page-file',
    url: pageFileUrl, fileSha256: pageFile.sha256, http_status: pageFile.status,
    checked_at: pageFile.checkedAt, date: parsed.declaredLastUpdated, version: parsed.cmsVersion,
    location_name: parsed.mrfLocationName, declared_hospital_name: parsed.mrfHospitalName,
    declared_address: parsed.mrfAddress, declared_license_state: parsed.mrfLicenseState,
    facility_state: roster.State, file_kind: 'json', sourcePageUrl: config.pageUrl,
    sourcePageSha256: page.sha256,
    observedFinding: 'pointer-links-unavailable-mrf-source-page-current-file',
    next_action: nextAction,
  };
  const note = `The current ${config.fileName} first-party location and pricing pages identify the exact roster campus. Its root pointer links a signed blob URL that now returns HTTP 403 AuthenticationFailed; the pointer source-page URL redirects to the current pricing page. That page links the same blob path with a different public signature and returns bounded JSON bytes declaring the hospital, exact address, Texas license state, 2026-05-14 and v3.0.0. This is a factual pointer-versus-page access mismatch, not an absent file, complete-file validation, or legal verdict.`;
  return { proof, evidence, note };
}

async function main() {
  const rosters = csvToObjects(fs.readFileSync(path.join(root, 'cms_data/Hospital_General_Information.csv'), 'utf8'));
  const bases = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8'));
  const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
  const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  const results = [];
  for (const config of cases) {
    const roster = rosters.find(row => row['Facility ID'] === config.ccn);
    const base = bases.find(row => row.ccn === config.ccn);
    if (!roster || roster['Facility Name'] !== config.name || roster.Address !== config.address
        || roster['City/Town'] !== 'HOUSTON' || roster.State !== 'TX' || roster['ZIP Code'] !== config.zip
        || !base || base.finding !== 'mrf-blocked-to-automation'
        || base.pointer_url !== config.pointerUrl || ledger.some(row => row.ccn === config.ccn))
      throw new Error(`${config.ccn} roster, base, or prior resolution changed`);
    results.push({ config, base, ...(await capture(config, roster, base)) });
  }
  for (const { config, base, proof, evidence, note } of results) {
    fs.writeFileSync(path.join(audit, `reconciliation-texas-signed-url-${config.ccn}-proof.json`), JSON.stringify(proof, null, 2) + '\n');
    ledger.push({ ccn: config.ccn, base, action: 'replace-observation', evidence,
      evidence_run: `texas-stale-pointer-signature-${config.ccn}-2026-09-16`, reviewed_at: proof.observed_at, note });
  }
  ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
  fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
  console.log(JSON.stringify(results.map(({ proof }) => ({ ccn: proof.ccn,
    pointer_status: proof.pointer_mrf_http_status, page_status: proof.page_mrf_http_status,
    sample_sha256: proof.page_mrf_sample_sha256 }))));
}

if (require.main === module) main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
