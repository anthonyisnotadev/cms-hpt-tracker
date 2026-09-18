'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { csvToObjects } = require('./lib/util');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const ccn = '244015';
const observedAt = '2026-09-17T06:28:41.000Z';
const officialPage = 'https://mn.gov/dct/adult-services/inpatient-care/community-behavioral-health-hospitals/';
const hash = value => crypto.createHash('sha256').update(value).digest('hex');

const roster = csvToObjects(fs.readFileSync(path.join(root, 'cms_data/Hospital_General_Information.csv'), 'utf8'))
  .find(row => row['Facility ID'] === ccn);
const base = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8'))
  .find(row => row.ccn === ccn);
if (!roster || roster['Facility Name'] !== 'COMMUNITY BEHAVIORAL HEALTH HOSPITAL - BAXTER'
    || roster.Address !== '14241 GRAND OAKS DRIVE' || roster['City/Town'] !== 'BAXTER'
    || roster.State !== 'MN' || roster['ZIP Code'] !== '56425'
    || !base || base.finding !== 'not-assessed-not-named-in-file'
    || base.domain !== 'ecommunity.com' || base.pointer_url !== 'https://ecommunity.com/cms-hpt.txt')
  throw new Error('Baxter roster or source assignment changed; review manually');

const pointerPath = path.join(root, 'cms_data/hpt/pointer-corpus/raw/ecommunity.com-84e6d7ac6985.txt');
const pointer = fs.readFileSync(pointerPath);
const pointerText = pointer.toString('utf8');
if (!pointerText.includes('Community Hospital Anderson')
    || !pointerText.includes('Community Hospital East')
    || /Baxter|Grand Oaks|Minnesota/i.test(pointerText))
  throw new Error('Retained Indiana pointer changed; review manually');

const note = 'The current Minnesota Direct Care and Treatment CBHH locations page identifies Baxter at 14241 Grand Oaks Drive, Baxter, MN 56425. The assigned ecommunity.com pointer lists other Community hospitals and does not name Baxter. The wrong-site pointer is excluded from this CCN; no conclusion is drawn about Baxter’s own pointer or MRF availability.';
const proof = {
  ccn, roster_name: roster['Facility Name'], roster_address: roster.Address,
  roster_city: roster['City/Town'], roster_state: roster.State, roster_zip: roster['ZIP Code'],
  previous_assigned_domain: base.domain, previous_pointer_url: base.pointer_url,
  previous_pointer_artifact: 'cms_data/hpt/pointer-corpus/raw/ecommunity.com-84e6d7ac6985.txt',
  previous_pointer_sha256: hash(pointer), previous_pointer_names_baxter: false,
  first_party_facility_page_url: officialPage,
  browser_observation: 'DCT page loaded in in-app browser and listed Baxter at 14241 Grand Oaks Drive, Baxter, MN 56425',
  browser_observed_at: observedAt, correct_site_domain: 'mn.gov',
  correct_site_root_pointer_status: 'unverified: this client received a redirect to HTML',
  next_action: 'Investigate a facility-appropriate first-party pointer and MRF; do not infer absence from an HTML redirect or reuse the unrelated Indiana pointer.',
};
const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
if (ledger.some(row => row.ccn === ccn)) throw new Error('Existing Baxter resolution requires manual review');
ledger.push({ ccn, base, action: 'quarantine', official: { domain: 'mn.gov' },
  evidence: proof, evidence_run: 'baxter-wrong-site-identity-2026-09-17',
  reviewed_at: observedAt, note });
ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
fs.writeFileSync(path.join(audit, 'reconciliation-baxter-wrong-site-proof.json'), JSON.stringify(proof, null, 2) + '\n');
fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
console.log(JSON.stringify({ ccn, correct_site_domain: 'mn.gov', previous_pointer_sha256: hash(pointer) }));
