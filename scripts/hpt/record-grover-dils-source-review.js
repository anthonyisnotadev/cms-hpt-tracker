'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cheerio = require('cheerio');
const { csvToObjects } = require('./lib/util');
const { retrieve } = require('./lib/recovery-transport');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const ccn = '291312';
const pointerUrl = 'https://gcdmc.org/cms-hpt.txt';
const homeUrl = 'https://gcdmc.org/';
const historyUrl = 'https://gcdmc.org/our-history/';
const sourceUrl = 'https://services.gcdmc.org/pt-machinereadable.html';
const pointerFileUrl = 'https://assets.changehealthcare.com/Shop/PROD/static/LincolnCountyHospital/ein_LincolnCountyHospital_standardcharges.csv.zip';
const homeFileUrl = 'https://gcdmc.org/wp-content/uploads/2023/11/880198997_lincoln-county-hospital-district-standardcharge.csv';
const portalUrl = 'https://rca.elevatepfs.com/ptapp/';
const portalListingUrl = `${portalUrl}#123as5645d21`;
const portalExportUrl = `${portalUrl}api/cdm/export/oneclick?recno=123as5645d21`;
const retainedPath = path.join(root, 'cms_data/hpt/pointer-corpus/raw/gcdmc.org-2ffdb5413d95.txt');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

async function main() {
  const roster = csvToObjects(fs.readFileSync(path.join(root, 'cms_data/Hospital_General_Information.csv'), 'utf8'))
    .find(row => row['Facility ID'] === ccn);
  const base = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8'))
    .find(row => row.ccn === ccn);
  const retained = fs.readFileSync(retainedPath);
  const pointerText = retained.toString('utf8');
  if (!roster || roster['Facility Name'] !== 'GROVER C DILS MEDICAL CENTER'
      || roster.Address !== '700 N SPRING ST, BOX 1010-C-ADM BLDG'
      || roster['City/Town'] !== 'CALIENTE' || roster.State !== 'NV' || roster['ZIP Code'] !== '89008'
      || !base || base.finding !== 'not-assessed-domain-unknown' || base.domain
      || sha(retained) !== 'a169679cee15b2b0100ed8cb3985785bf6677c6e601e922a5bc7a16362b757c5'
      || !pointerText.includes('location-name: Lincoln County Hospital District')
      || !pointerText.includes(`source-page-url: ${sourceUrl}`)
      || !pointerText.includes(`mrf-url: ${pointerFileUrl}`))
    throw new Error('Grover Dils roster, base, or retained pointer changed');
  const [pointer, home, history, source, pointerFile, homeFile, portal, portalExport] = await Promise.all([
    retrieve(pointerUrl, 65536, { timeoutMs: 30000 }),
    retrieve(homeUrl, 262144, { timeoutMs: 30000 }),
    retrieve(historyUrl, 131072, { timeoutMs: 30000 }),
    retrieve(sourceUrl, 65536, { timeoutMs: 30000 }),
    retrieve(pointerFileUrl, 65536, { timeoutMs: 30000 }),
    retrieve(homeFileUrl, 262144, { timeoutMs: 30000 }),
    retrieve(portalUrl, 65536, { timeoutMs: 30000 }),
    retrieve(portalExportUrl, 65536, { timeoutMs: 30000 }),
  ]);
  const $ = cheerio.load(home.body.toString('utf8'));
  const homeLinks = $('a[href]').toArray().map(node => $(node).attr('href'));
  const historyText = cheerio.load(history.body.toString('utf8')).text().replace(/\s+/g, ' ');
  const fileText = homeFile.body.toString('utf8').replace(/^\uFEFF/, '');
  if (pointer.status !== 206 || pointer.sha256 !== sha(retained)
      || home.status !== 200 || !homeLinks.includes(homeFileUrl.replace(/^https:/, 'http:'))
      || !homeLinks.includes(portalListingUrl) || !homeLinks.includes(portalExportUrl)
      || history.status !== 200
      || !historyText.includes('Lincoln County Hospital District dba Grover C. Dils Medical')
      || source.status !== 0 || pointerFile.status !== 0
      || !/timed out/i.test(source.error || '')
      || !/resolving timed out/i.test(pointerFile.error || '')
      || homeFile.status !== 206 || homeFile.body.length !== 262144
      || !fileText.startsWith('hospital_name:,Lincoln County Hospital District')
      || !fileText.includes('hospital_location:,"700 N Spring Street, Caliente NV 89008"')
      || !fileText.includes('last_updated_on:,11/6/2023')
      || portal.status !== 206 || !/^text\/html/i.test(portal.headers['content-type'] || '')
      || portalExport.status !== 204 || portalExport.body.length !== 0)
    throw new Error('Grover Dils current source observations changed: ' + JSON.stringify({
      pointerStatus: pointer.status, pointerSha: pointer.sha256,
      homeFileLinked: homeLinks.includes(homeFileUrl.replace(/^https:/, 'http:')),
      portalLinked: homeLinks.includes(portalListingUrl), portalExportLinked: homeLinks.includes(portalExportUrl),
      aliasStatement: historyText.includes('Lincoln County Hospital District dba Grover C. Dils Medical'),
      oldFileName: fileText.startsWith('hospital_name:,Lincoln County Hospital District'),
      oldFileAddress: fileText.includes('hospital_location:,"700 N Spring Street, Caliente NV 89008"'),
      oldFileDate: fileText.includes('last_updated_on:,11/6/2023'),
      homeStatus: home.status, historyStatus: history.status, sourceStatus: source.status,
      sourceError: source.error, pointerFileStatus: pointerFile.status,
      pointerFileError: pointerFile.error, homeFileStatus: homeFile.status,
      homeFileBytes: homeFile.body.length, portalStatus: portal.status,
      portalExportStatus: portalExport.status,
    }));
  const sampleDir = path.join(root, 'cms_data/hpt/nationwide-verification/file-byte-proof');
  fs.mkdirSync(sampleDir, { recursive: true });
  const samplePath = path.join(sampleDir, `${homeFile.sha256}.bin`);
  fs.writeFileSync(samplePath, homeFile.body);
  const nextAction = 'Resolve the current pointer-declared Change Healthcare ZIP host and source-page route through an authorized publisher path, then inspect bounded archive members for Grover C. Dils/Lincoln County Hospital District, 700 North Spring Street Caliente NV, NV license-state field, declared date and template version. Keep the readable November 2023 homepage CSV and separate pricing portal as distinct leads; neither verifies the current pointer ZIP.';
  const proof = {
    ccn, roster_name: roster['Facility Name'], roster_address: roster.Address,
    roster_city: roster['City/Town'], roster_state: roster.State, roster_zip: roster['ZIP Code'],
    official_domain: 'gcdmc.org', home_url: homeUrl, home_sha256: home.sha256,
    history_url: historyUrl, history_sha256: history.sha256,
    first_party_alias_statement: 'Lincoln County Hospital District dba Grover C. Dils Medical was established in 1935.',
    pointer_url: pointerUrl, pointer_http_status: pointer.status, pointer_sha256: pointer.sha256,
    retained_pointer_artifact: path.relative(root, retainedPath).replaceAll('\\', '/'),
    pointer_location_name: 'Lincoln County Hospital District',
    pointer_source_page_url: sourceUrl, pointer_mrf_url: pointerFileUrl,
    pointer_source_client_status: source.status, pointer_source_client_error: source.error,
    pointer_file_client_status: pointerFile.status, pointer_file_client_error: pointerFile.error,
    pointer_file_browser_error_code: 'ERR_NAME_NOT_RESOLVED',
    pointer_file_browser_observed_on: '2026-09-17',
    home_file_url: homeFileUrl, home_file_http_status: homeFile.status,
    home_file_sample_sha256: homeFile.sha256, home_file_sample_bytes: homeFile.body.length,
    home_file_total_bytes: Number((homeFile.headers['content-range'] || '').split('/')[1]),
    retained_home_file_sample: path.relative(root, samplePath).replaceAll('\\', '/'),
    home_file_declared_hospital_name: 'Lincoln County Hospital District',
    home_file_declared_address: '700 N Spring Street, Caliente NV 89008',
    home_file_declared_date: '2023-11-06', home_file_cms_version_observed: false,
    home_pricing_portal_url: portalListingUrl, portal_shell_http_status: portal.status,
    portal_shell_sha256: portal.sha256, home_portal_export_url: portalExportUrl,
    home_portal_export_http_status: portalExport.status,
    home_portal_export_response_sha256: portalExport.sha256,
    current_pointer_file_bytes_verified: false,
    observed_at: homeFile.checkedAt, next_action: nextAction,
  };
  const proofPath = path.join(audit, 'reconciliation-grover-dils-source-review.json');
  fs.writeFileSync(proofPath, JSON.stringify(proof, null, 2) + '\n');
  const manualPath = path.join(audit, 'reconciliation-manual-access-observations.json');
  const manual = JSON.parse(fs.readFileSync(manualPath, 'utf8'));
  if (manual.records.some(row => row.ccn === ccn))
    throw new Error('Existing Grover Dils manual review requires manual reconciliation');
  manual.records.push({ ccn, observed_at: proof.observed_at, proof_file: path.basename(proofPath),
    official_identity_url: historyUrl, official_pricing_page: sourceUrl,
    pointer_url: pointerUrl, pointer_retained_mrf_url: pointerFileUrl,
    page_linked_mrf_url: homeFileUrl, current_root_pointer_client_status: pointer.status,
    pointer_file_client_status: pointerFile.status, page_file_client_status: homeFile.status,
    browser_pointer_file_result: proof.pointer_file_browser_error_code,
    disposition: 'first-party-alias-pointer-zip-unresolved-homepage-legacy-csv-readable',
    next_action: nextAction });
  manual.records.sort((a, b) => a.ccn.localeCompare(b.ccn));
  fs.writeFileSync(manualPath, JSON.stringify(manual, null, 2) + '\n');
  console.log(JSON.stringify({ ccn, pointer_unchanged: true,
    pointer_file_status: pointerFile.status, legacy_file_status: homeFile.status }));
}

if (require.main === module) main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
