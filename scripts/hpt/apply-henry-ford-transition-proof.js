'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { csvToObjects } = require('./lib/util');
const { parsePayload } = require('./lib/recovery-transport');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const proof = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-henry-ford-transition-proof.json'), 'utf8'));
const rawPointer = fs.readFileSync(path.join(root, 'cms_data/hpt/pointer-corpus/raw/henryford.com-7f120444c17d.txt'));
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const base = new Map(csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8'))
  .map(row => [row.ccn, row]));
const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
const expected = {
  '230197': { address: 'ONE GENESYS PARKWAY', name: 'Henry Ford Genesys Hospital' },
  '230241': { address: '4100 RIVER RD', name: 'Henry Ford River District Hospital' },
  '230254': { address: '1101 W UNIVERSITY DRIVE', name: 'Henry Ford Rochester Hospital' },
};

async function main() {
  if (proof.records.length !== 3 || new Set(proof.records.map(row => row.ccn)).size !== 3
      || sha(rawPointer) !== proof.pointer_sha256 || proof.pointer_url !== 'https://henryford.com/cms-hpt.txt')
    throw new Error('Henry Ford source proof or pointer bytes changed');
  const newEntries = [];
  for (const row of proof.records) {
    const prior = base.get(row.ccn), want = expected[row.ccn];
    const sample = fs.readFileSync(path.join(root, row.retained_sample));
    const parsed = (await parsePayload(sample, 'text/csv')).parsed.find(item => item.innerKind === 'csv');
    if (!want || prior?.finding !== 'not-assessed-not-named-in-file'
        || prior.domain !== 'healthcare.ascension.org' || prior.mrf_url
        || ledger.some(item => item.ccn === row.ccn)
        || row.roster_address !== want.address || row.facility_name !== want.name
        || row.roster_state !== 'MI' || !row.facility_page_url.startsWith('https://www.henryford.com/locations/')
        || !['200', '206'].includes(String(row.facility_page_http_status))
        || !/^[a-f0-9]{64}$/.test(row.facility_page_sha256)
        || (!row.facility_page_bounded_text_identity && !row.facility_page_web_reader_identity)
        || !row.pointer_entry_without_contacts.includes(`location-name: ${row.facility_name}`)
        || !row.pointer_entry_without_contacts.includes(`mrf-url: ${row.mrf_url}`)
        || row.file_http_status !== 206 || row.retained_bytes !== 262144
        || row.file_total_bytes <= row.retained_bytes || sha(sample) !== row.retained_sha256
        || parsed?.mrfHospitalName !== 'Henry Ford Health'
        || parsed.mrfLocationName !== row.facility_name
        || parsed.mrfAddress !== row.declared_address
        || parsed.mrfLicenseState !== 'MI' || parsed.declaredLastUpdated !== '2026-01-01'
        || parsed.cmsVersion !== '3.0.0')
      throw new Error(`Incomplete Henry Ford transition proof for ${row.ccn}`);
    const evidence = {
      identity: 'corroborated',
      identity_basis: 'first-party-current-henry-ford-campus-exact-roster-street-current-root-entry-price-page-link-and-byte-backed-file-address-state',
      identityPageUrl: row.facility_page_url, identityPageSha256: row.facility_page_sha256,
      identityTransport: row.facility_page_bounded_text_identity ? 'bounded-first-party-html'
        : 'web-reader-observation-direct-html-prefix-omits-facility-text',
      ...(row.facility_page_web_reader_identity ? { identityExcerpt: row.facility_page_web_reader_identity } : {}),
      sourcePageUrl: proof.pricing_page_url, sourcePageSha256: proof.pricing_page_sha256,
      officialDomain: 'henryford.com', pointerUrl: proof.pointer_url, pointerSha256: proof.pointer_sha256,
      url: row.mrf_url, fileSha256: row.retained_sha256, bytesRetained: row.retained_bytes,
      http_status: row.file_http_status, checked_at: row.observed_at,
      date: row.declared_date, version: row.declared_version,
      location_name: row.declared_location_name, declared_hospital_name: row.declared_hospital_name,
      declared_address: row.declared_address, declared_license_state: row.declared_license_state,
      file_kind: 'csv',
    };
    newEntries.push({ ccn: row.ccn, base: prior, action: 'replace', evidence,
      evidence_run: 'henry-ford-transition-2026-09-17', reviewed_at: row.observed_at,
      note: `The roster's former Ascension name and the current ${row.facility_name} name refer to the same ${row.roster_address} campus. Henry Ford's current first-party facility and price pages, root pointer and retained 262144-byte CSV header agree on that campus, Michigan license state, 2026-01-01 declared date and CMS 3.0.0 template. This is observed pointer/header evidence, not complete-file validation or a legal compliance verdict.` });
  }
  ledger.push(...newEntries);
  ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
  fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
  console.log(JSON.stringify({ applied: newEntries.map(row => row.ccn) }));
}

if (require.main === module) main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
