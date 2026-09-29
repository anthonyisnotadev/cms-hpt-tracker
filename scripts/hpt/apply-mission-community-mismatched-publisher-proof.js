'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { csvToObjects } = require('./lib/util');
const { parsePointer } = require('./lib/parse');
const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const p = require(path.join(audit, 'reconciliation-mission-community-mismatched-publisher-proof.json'));
const base = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8')).find(row => row.ccn === p.ccn);
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const entry = parsePointer(fs.readFileSync(path.join(root, p.sanitized_pointer_entry), 'utf8')).entries[0];
const sample = fs.readFileSync(path.join(root, p.retained_sample));
const prefix = sample.toString('utf8', 0, 1300);
if (!base || p.ccn !== '050704' || base.finding !== 'not-assessed-not-named-in-file'
  || base.domain !== 'missionhealth.org' || base.pointer_url !== 'https://missionhealth.org/cms-hpt.txt'
  || p.roster_address !== '14850 ROSCOE BLVD' || p.roster_state !== 'CA' || p.roster_zip !== '91402'
  || p.state_facility_address !== '14850 Roscoe Boulevard, Panorama City, CA 91402'
  || p.state_facility_status !== 'Open' || p.pointer_http_status !== 200
  || p.pointer_sha256 !== 'f575c1b3abe9decc01b87ff254046504e166d49bbc8382b4d2ba8173f81a070d'
  || entry.locationName !== p.pointer_location_name || entry.mrfUrl !== p.mrf_url
  || p.mrf_http_status !== 206 || sample.length !== 262144 || sha(sample) !== p.mrf_sample_sha256
  || !prefix.startsWith('{"hospital_name":"Mission Community Hospital","last_updated_on":"2024-12-19","version":"1.0","hospital_location":["Mission Community Hospital"],"hospital_address":["14850 Roscoe Blvd. Panorama City CA, 91402"],"license_information":{"license_number":"050704","state":"CA"}')
  || p.declared_license_state !== p.roster_state)
  throw new Error('Mission Community proof or base changed; manual review required');
const evidence = {
  identity: 'corroborated', identity_basis: 'state-open-facility-record-and-current-MCH-pointer-exact-file-and-bounded-JSON-campus-metadata',
  pointerUrl: p.pointer_url, pointerSha256: p.pointer_sha256, pointerLocationName: p.pointer_location_name,
  sourcePageUrl: p.price_page_url, identityPageUrl: p.state_facility_url,
  url: p.mrf_url, fileSha256: p.mrf_sample_sha256, bytesRetained: p.mrf_sample_bytes, fileTotalBytes: p.mrf_total_bytes,
  http_status: p.mrf_http_status, checked_at: p.observed_at, date: p.declared_date, version: p.declared_version,
  officialDomain: p.publisher_domain, file_kind: 'json', location_name: p.declared_location_name,
  declared_hospital_name: p.declared_hospital_name, declared_address: p.declared_address,
  declared_license_state: p.declared_license_state, observedFinding: 'mrf-stale-over-365-days', next_action: p.next_action,
};
const resolution = { ccn:p.ccn, base, action:'replace-observation', evidence,
  evidence_run:'mission-community-current-pointer-stale-json-2026-09-17', reviewed_at:p.observed_at,
  note:'The old missionhealth.org pointer is a different publisher/facility chain. California HCAI identifies Mission Community Hospital - Panorama Campus as open at 14850 Roscoe Boulevard. Its MCH pointer links an exact Mission Community JSON, whose fresh bounded metadata declares the same campus and CA state but 2024-12-19/version 1.0. The located file is retained as stale; neither complete-file validity nor legal compliance is established.' };
const ledgerPath=path.join(audit,'reviewed-resolutions.json'); const ledger=JSON.parse(fs.readFileSync(ledgerPath,'utf8')); const old=ledger.find(x=>x.ccn===p.ccn);
if(old && (old.evidence_run!==resolution.evidence_run || JSON.stringify(old.evidence)!==JSON.stringify(resolution.evidence))) throw new Error('Existing nonmatching Mission Community resolution');
if(!old){ledger.push(resolution);ledger.sort((a,b)=>a.ccn.localeCompare(b.ccn));fs.writeFileSync(ledgerPath,JSON.stringify(ledger,null,2)+'\n');}
console.log(JSON.stringify({applied:!old,ccn:p.ccn,finding:evidence.observedFinding}));
