'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { csvToObjects } = require('./lib/util');
const { parsePointer } = require('./lib/parse');
const { extractDeclared, toISODate } = require('./lib/probe');
const { retrieve } = require('./lib/recovery-transport');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const stage = path.join(audit, '.domain-discovery/reconciliation/omh-shared');
const pointerUrl = 'https://omh.ny.gov/cms-hpt.txt';
const fileUrl = 'https://omh.ny.gov/omhweb/adults/141663311_nysomh_standardcharges.csv';
const directoryUrl = 'https://omh.ny.gov/omhweb/aboutomh/omh_facility.html';
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const targets = [
  ['334003', 'St Lawrence', 'St. Lawrence Psychiatric Center'],
  ['334004', 'Creedmoor', 'Creedmoor Psychiatric Center'],
  ['334013', 'Pilgrim', 'Pilgrim Psychiatric Center'],
  ['334015', 'Rockland', 'Rockland Psychiatric Center'],
  ['334021', 'Mohawk Valley', 'Mohawk Valley Psychiatric Center'],
  ['334043', 'South Beach', 'South Beach Psychiatric Center'],
  ['334045', 'Elmira', 'Elmira Psychiatric Center'],
  ['334046', 'Capital District', 'Capital District Psychiatric Center'],
  ['334052', 'Buffalo', 'Buffalo Psychiatric Center'],
  ['334053', 'Bronx', 'Bronx Psychiatric Center'],
  ['334060', '', 'Kirby Forensic Psychiatric Center'],
  ['334061', '', 'Mid-Hudson Forensic Psychiatric Center'],
  ['334064', "Sagamore Children's", "Sagamore Children's Psychiatric Center"],
  ['334065', "Western New York Children's", "Western NY Children's Psychiatric Center"],
];

async function main() {
  const queue = JSON.parse(fs.readFileSync(path.join(audit, 'unresolved-investigation-worklist.json'), 'utf8'));
  const roster = new Map(csvToObjects(fs.readFileSync(path.join(root, 'cms_data/Hospital_General_Information.csv'), 'utf8'))
    .map(row => [row['Facility ID'], row]));
  const previous = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-omh-shared-proof.json'), 'utf8'));
  const pointerBytes = fs.readFileSync(path.join(stage, 'pointer.txt'));
  const fileBytes = fs.readFileSync(path.join(stage, 'file.bin'));
  const pointerSha = sha(pointerBytes), fileSha = sha(fileBytes);
  const entries = parsePointer(pointerBytes.toString('utf8')).entries;
  const declared = extractDeclared(fileBytes, 'csv');
  if (pointerSha !== 'c5bc8d36dae15caaa62f821228bcdeba7baf3c48c4ce0ac0e0c585a41d073de1'
      || fileSha !== '84f14403ad89386a0fb9e470d2e3fe371454eef40ca32b86d31fe313a0fd0911'
      || fileBytes.length !== 929041 || entries.length !== 20
      || entries.some(entry => entry.mrfUrl !== fileUrl)
      || previous.records.length !== 6 || previous.records.some(record => record.pointer_sha256 !== pointerSha
        || record.file_sha256 !== fileSha)
      || declared.hospitalName !== 'Greater Binghamton Mental Health Facility'
      || declared.locationName !== 'Greater Binghamton'
      || declared.address !== '425 Robinson St, Binghamton, NY 13904'
      || declared.licenseState != null || toISODate(declared.raw) !== '2026-05-28'
      || declared.version !== '3.0.0')
    throw new Error('Retained OMH pointer/file proof changed; manual review required');
  const [pointerRecheck, directory] = await Promise.all([
    retrieve(pointerUrl, 16384, { timeoutMs: 30000 }),
    retrieve(directoryUrl, 65536, { timeoutMs: 30000 }),
  ]);
  if (pointerRecheck.status < 200 || pointerRecheck.status >= 300 || pointerRecheck.sha256 !== pointerSha
      || directory.status !== 200 || directory.body.length < 10000)
    throw new Error('Current OMH root or facility directory changed; manual review required');
  const directoryText = directory.body.toString('utf8');
  const queueBy = new Map(queue.records.map(row => [row.ccn, row]));
  const records = targets.map(([ccn, pointerName, directoryName]) => {
    const hospital = roster.get(ccn), work = queueBy.get(ccn);
    if (!hospital || !work || work.investigation_tier !== 2
        || work.official_domain !== 'omh.ny.gov' || !directoryText.includes(directoryName))
      throw new Error(`OMH queue, roster, or directory changed for ${ccn}`);
    const matched = pointerName ? entries.filter(entry => entry.locationName === pointerName) : [];
    if (matched.length !== (pointerName ? 1 : 0)) throw new Error(`OMH pointer entry changed for ${ccn}`);
    const absentNames = pointerName ? [] : entries.filter(entry =>
      entry.locationName.toLowerCase().includes(ccn === '334060' ? 'kirby' : 'mid-hudson'));
    if (absentNames.length) throw new Error(`Forensic pointer entry appeared for ${ccn}`);
    const present = Boolean(pointerName);
    return {
      ccn, roster_hospital_name: hospital['Facility Name'], roster_address: hospital.Address,
      roster_city: hospital['City/Town'], roster_state: hospital.State,
      directory_url: directoryUrl, directory_name: directoryName,
      directory_sha256: directory.sha256, directory_http_status: directory.status,
      directory_observed_at: directory.checkedAt,
      pointer_url: pointerUrl, pointer_sha256: pointerSha,
      pointer_retained_at: previous.records[0].observed_at,
      pointer_recheck_http_status: pointerRecheck.status, pointer_rechecked_at: pointerRecheck.checkedAt,
      pointer_entry_count: entries.length,
      pointer_entry_name: pointerName, pointer_entry_status: present ? 'named-entry-shared-file' : 'no-matching-entry-in-retained-root',
      pointer_mrf_url: present ? fileUrl : '',
      shared_file_sha256: fileSha, shared_file_bytes: fileBytes.length,
      shared_file_observed_at: previous.records[0].observed_at,
      shared_file_declared_name: declared.hospitalName,
      shared_file_declared_address: declared.address,
      shared_file_declared_license_state: declared.licenseState,
      shared_file_declared_date: toISODate(declared.raw), shared_file_declared_version: declared.version,
      disposition: present ? 'named-pointer-entry-shares-binghamton-only-root-metadata'
        : 'official-omh-forensic-facility-not-named-in-retained-root',
      observed_at: pointerRecheck.checkedAt,
      next_action: present
        ? 'Seek publisher clarification or updated file root metadata naming this facility before attributing the shared statewide CSV; preserve its named pointer entry and do not infer absence or compliance failure.'
        : 'Ask whether this forensic center is covered by the current root pointer or has a separate first-party standard-charges file; verify an exact entry and facility-specific file identity before attribution.',
    };
  });
  const retainedDirectory = path.join(stage, 'facility-directory.html');
  fs.writeFileSync(retainedDirectory, directory.body);
  const proof = { source_queue_sha256: sha(fs.readFileSync(path.join(audit, 'unresolved-investigation-worklist.json'))),
    pointer_url: pointerUrl, pointer_sha256: pointerSha,
    pointer_recheck_http_status: pointerRecheck.status, pointer_rechecked_at: pointerRecheck.checkedAt,
    shared_file_url: fileUrl, shared_file_sha256: fileSha, shared_file_retained_at: previous.records[0].observed_at,
    directory_url: directoryUrl, directory_sha256: directory.sha256, directory_http_status: directory.status,
    directory_retained_file: path.relative(root, retainedDirectory).replaceAll('\\', '/'),
    observed_at: pointerRecheck.checkedAt, records };
  fs.writeFileSync(path.join(audit, 'reconciliation-omh-unreviewed-cohort-proof.json'), JSON.stringify(proof, null, 2) + '\n');
  console.log(JSON.stringify({ records: records.length, named_shared_file: records.filter(row => row.pointer_entry_name).length,
    forensic_without_entry: records.filter(row => !row.pointer_entry_name).length,
    pointer_sha256: pointerSha, directory_sha256: directory.sha256 }));
}

if (require.main === module) main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
