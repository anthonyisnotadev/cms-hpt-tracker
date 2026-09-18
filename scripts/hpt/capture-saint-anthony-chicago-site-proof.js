'use strict';

const fs = require('fs');
const path = require('path');
const { retrieve } = require('./lib/recovery-transport');
const { csvToObjects } = require('./lib/util');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const directoryUrl = 'https://healthcarereportcard.illinois.gov/hospital/101200';
const rootPointerUrl = 'https://sahchicago.org/cms-hpt.txt';

async function main() {
  const roster = csvToObjects(fs.readFileSync(path.join(root, 'cms_data/Hospital_General_Information.csv'), 'utf8'))
    .find(row => row['Facility ID'] === '140095');
  const base = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8'))
    .find(row => row.ccn === '140095');
  const priorMercy = fs.readFileSync(path.join(root, 'cms_data/hpt/pointer-corpus/raw/mercy.net-e95ee9266712.txt'), 'utf8');
  if (!roster || roster['Facility Name'] !== 'SAINT ANTHONY HOSPITAL'
      || roster.Address !== '2875 WEST 19TH STREET' || roster['City/Town'] !== 'CHICAGO'
      || roster.State !== 'IL' || roster['ZIP Code'] !== '60623'
      || !base || base.finding !== 'not-assessed-not-named-in-file' || base.domain !== 'mercy.net'
      || base.pointer_url !== 'https://mercy.net/cms-hpt.txt'
      || /chicago|saint anthony|st anthony/i.test(priorMercy))
    throw new Error('Chicago roster, old assignment, or old Mercy pointer changed');
  // Repeat the bounded source reads only to bind this site correction to exact current bytes.
  const [directory, pointer] = await Promise.all([
    retrieve(directoryUrl, 262144, { timeoutMs: 30000 }),
    retrieve(rootPointerUrl, 65536, { timeoutMs: 30000 }),
  ]);
  const directoryText = directory.body.toString('utf8');
  const pointerText = pointer.body.toString('utf8');
  if (directory.status !== 200 || !directoryText.includes('Saint Anthony Hospital')
      || !directoryText.includes('2875 West 19th Street')
      || !directoryText.includes('sahchicago.org')
      || pointer.status !== 202 || !/^text\/html/i.test(pointer.headers['content-type'] || '')
      || !pointerText.includes('/.well-known/sgcaptcha/')
      || /location-name:|mrf-url:/i.test(pointerText))
    throw new Error('State directory or exact hospital-root challenge changed');
  const nextAction = 'The official hospital-domain root returned an HTML security challenge to this client and browser. Recover the current plain-text cms-hpt.txt or an authorized publisher-provided route, then verify its exact MRF target, facility identity, file access, and declared metadata. Do not reuse the unrelated Mercy system pointer or infer file absence from the challenge.';
  const evidence = {
    identityAuthority: 'state-hospital-directory-current',
    identityPageUrl: directoryUrl, identityPageSha256: directory.sha256,
    directoryListedDomain: 'sahchicago.org',
    facilityName: 'Saint Anthony Hospital',
    facilityAddress: '2875 West 19th Street, Chicago, IL 60623',
    rootPointerUrl, rootPointerHttpStatus: pointer.status,
    rootPointerResponseKind: 'html-security-challenge',
    rootPointerSha256: pointer.sha256,
    rootPointerChallengeMarker: '/.well-known/sgcaptcha/',
    browserObservedPageTitle: 'Robot Challenge Screen',
    checked_at: pointer.checkedAt, next_action: nextAction,
  };
  const proof = {
    ccn: '140095', old_assigned_domain: base.domain,
    old_pointer_url: base.pointer_url,
    old_pointer_sha256: 'd1c888725387d9e88d9e236f0632535d0cf73abe91593b52ff9d22a3a5136280',
    old_pointer_has_chicago_hospital: false,
    official_domain: 'sahchicago.org', roster_name: roster['Facility Name'],
    roster_address: roster.Address, roster_city: roster['City/Town'],
    roster_state: roster.State, roster_zip: roster['ZIP Code'],
    first_party_home_url: 'https://sahchicago.org/',
    state_hospital_directory_url: directoryUrl,
    state_hospital_directory_http_status: directory.status,
    state_hospital_directory_sample_sha256: directory.sha256,
    state_hospital_directory_sample_bytes: directory.body.length,
    state_hospital_directory_lists_official_domain: true,
    official_root_pointer_url: rootPointerUrl,
    official_root_pointer_http_status: pointer.status,
    official_root_pointer_response_kind: evidence.rootPointerResponseKind,
    official_root_pointer_sha256: pointer.sha256,
    browser_root_page_title: evidence.browserObservedPageTitle,
    observed_at: pointer.checkedAt, next_action: nextAction,
  };
  const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
  const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  if (ledger.some(row => row.ccn === '140095')) throw new Error('Existing Chicago resolution requires manual review');
  fs.writeFileSync(path.join(audit, 'reconciliation-saint-anthony-chicago-site-proof.json'), JSON.stringify(proof, null, 2) + '\n');
  ledger.push({ ccn: '140095', base, action: 'correct-site', official: { domain: 'sahchicago.org' }, evidence,
    evidence_run: 'saint-anthony-chicago-domain-correction-2026-09-16', reviewed_at: pointer.checkedAt,
    note: 'Illinois current hospital directory and the hospital first-party site identify Saint Anthony Hospital at 2875 West 19th Street, Chicago IL 60623 on sahchicago.org. The old Mercy system pointer has no Chicago or Saint Anthony entry. The correct hospital root returned an HTML security challenge to this client and browser, so pointer and file status remain unverified. Correct only the official domain and retain the old misassigned pointer as history.' });
  ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
  fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
  console.log(JSON.stringify({ ccn: '140095', official_domain: 'sahchicago.org', pointer_status: pointer.status,
    directory_sha256: directory.sha256, pointer_sha256: pointer.sha256 }));
}

if (require.main === module) main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
