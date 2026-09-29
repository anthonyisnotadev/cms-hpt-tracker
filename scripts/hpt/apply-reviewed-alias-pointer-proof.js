'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { csvToObjects } = require('./lib/util');

const ROOT = path.resolve(__dirname, '../..');
const AUDIT = path.join(ROOT, 'data/hpt-audit');
const proof = JSON.parse(fs.readFileSync(path.join(AUDIT, 'reconciliation-reviewed-alias-pointer-proof.json'), 'utf8')).records;
const base = new Map(csvToObjects(fs.readFileSync(path.join(AUDIT, 'compliance.csv'), 'utf8')).map(row => [row.ccn, row]));
const ledgerPath = path.join(AUDIT, 'reviewed-resolutions.json');
const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const run = 'reviewed-alias-pointer-byte-proof-2026-09-16';
const sameBase = (left, right) => ['ccn', 'finding', 'domain', 'pointer_url', 'mrf_url', 'checked_at']
  .every(key => String(left?.[key] || '') === String(right?.[key] || ''));

for (const row of proof) {
  const prior = base.get(row.ccn);
  const samplePath = path.join(ROOT, row.retained_sample);
  const pointerPath = path.join(ROOT, row.pointer_file);
  const conflict = row.finding === 'mrf-license-state-field-conflicts-facility';
  const addressConflict = row.finding === 'mrf-address-field-conflicts-facility';
  const oldTemplate = row.finding === 'old-template-version';
  const stale = row.finding === 'mrf-stale-over-365-days';
  if (!prior || prior.finding !== (row.expected_base_finding || 'not-assessed-domain-unknown')
      || !['compliant-observed', 'old-template-version', 'mrf-stale-over-365-days', 'mrf-license-state-field-conflicts-facility', 'mrf-address-field-conflicts-facility'].includes(row.finding)
      || (row.finding === 'compliant-observed' && row.version !== '3.0.0')
      || (oldTemplate && row.version === '3.0.0')
      || (stale && Math.floor((Date.parse(row.observed_at) - Date.parse(row.declared_date)) / 86400000) <= 365)
      || (!conflict && row.declared_license_state !== row.roster_state)
      || (conflict && row.declared_license_state === row.roster_state)
      || row.bytes_retained < (row.minimum_bytes || 65536) || (row.minimum_bytes && row.minimum_bytes < 16384)
      || !fs.existsSync(samplePath) || digest(fs.readFileSync(samplePath)) !== row.retained_sha256
      || !fs.existsSync(pointerPath) || digest(fs.readFileSync(pointerPath)) !== row.pointer_sha256)
    throw new Error(`Incomplete alias proof or changed base for ${row.ccn}`);
  const evidence = {
    identity: 'corroborated',
    identity_basis: row.identity_authority === 'state-regulator-current-facility-profile'
      ? 'state-regulator-profile-links-current-facility-and-roster-domain-exact-pointer-location-and-byte-backed-file-address-state'
      : row.identity_authority === 'state-government-current-facility-profile'
        ? 'state-government-profile-exact-facility-address-state-auditor-relationship-exact-pointer-location-and-byte-backed-file-address-state'
        : row.identity_authority === 'first-party-and-sec-dba-chain'
          ? 'current-first-party-brand-chain-exact-address-sec-legal-dba-exact-pointer-location-and-byte-backed-file-address-state'
        : row.identity_authority === 'state-regulator-fid-continuity'
          ? 'state-regulator-stable-facility-id-old-dba-current-name-exact-address-pointer-and-byte-backed-file'
        : row.identity_authority === 'first-party-campus-address-conflict'
          ? 'first-party-distinguishes-hospital-and-legacy-campus-addresses-exact-pointer-and-byte-backed-file'
        : row.identity_authority === 'first-party-current-facility-and-price-file'
          ? 'current-first-party-facility-address-and-price-page-exact-file-link-with-byte-backed-file-identity'
        : row.identity_authority === 'first-party-rename-and-street-address'
          ? 'first-party-rename-and-street-address-exact-pointer-and-byte-backed-file-identity-with-roster-zip-difference-retained'
        : 'first-party-documented-alias-exact-pointer-location-and-byte-backed-file-address-state',
    pointerUrl: row.pointer_url, pointerSha256: row.pointer_sha256, sourcePageUrl: row.source_page_url,
    identityPageUrl: row.identity_url, identityPageSha256: row.identity_sha256,
    url: row.mrf_url, finalUrl: row.mrf_final_url, fileSha256: row.retained_sha256,
    bytesRetained: row.bytes_retained, http_status: row.mrf_http_status, checked_at: row.observed_at,
    date: row.declared_date, version: row.version, location_name: row.declared_location_name,
    declared_hospital_name: row.declared_hospital_name, declared_address: row.declared_address,
    declared_license_state: row.declared_license_state, observedFinding: row.finding
  };
  if (row.identity_transport) {
    evidence.identityTransport = row.identity_transport;
    evidence.identityPageTitle = row.identity_page_title;
    evidence.identityExcerpt = row.identity_excerpt;
  }
  if (row.relationship_url) {
    evidence.relationshipPageUrl = row.relationship_url;
    evidence.relationshipPageSha256 = row.relationship_sha256;
    if (row.relationship_scripted_http_status != null) evidence.relationshipScriptedHttpStatus = row.relationship_scripted_http_status;
    if (row.relationship_transport) evidence.relationshipTransport = row.relationship_transport;
    if (row.relationship_page_title) evidence.relationshipPageTitle = row.relationship_page_title;
    if (row.relationship_page) evidence.relationshipPageNumber = row.relationship_page;
    if (row.relationship_excerpt) evidence.relationshipExcerpt = row.relationship_excerpt;
  }
  if (conflict) evidence.facility_state = row.roster_state;
  if (addressConflict) evidence.facility_address = row.roster_address;
  const entry = { ccn: row.ccn, base: prior, action: (conflict || addressConflict || oldTemplate || stale) ? 'replace-observation' : 'replace', evidence, evidence_run: run,
    reviewed_at: row.observed_at,
    note: conflict
      ? `The current first-party page, exact root pointer and retained CMS ${row.version} file identify the same facility and address. The file nevertheless labels its license-number field ${row.declared_license_state} while the facility is in ${row.roster_state}; that publisher-field conflict remains explicit and is not interpreted as an equivalent state or a legal verdict.`
      : addressConflict
        ? `The current first-party site explicitly identifies the hospital building at ${row.roster_address} and the adjacent legacy/clinic building at ${row.declared_address}. The exact root pointer and retained current CMS ${row.version} file identify the same hospital but declare the legacy/clinic address. That publisher address-field conflict remains explicit and is not normalized into agreement or treated as a legal verdict.`
      : oldTemplate
        ? `The current first-party page, exact root pointer and retained file identify the same facility and address, but the file declares CMS template ${row.version}. The older template remains explicit and is not promoted as current CMS 3.0.0 compliance.`
        : stale
          ? `The official hospital site identifies ${row.pointer_location_name} at the roster address, and its hash-bound bylaws identify the roster legal entity and its Langdon hospital. The exact root pointer and retained file agree on the facility address and state, but the declared ${row.declared_date} date is over 365 days old and the file uses CMS template ${row.version}; both limitations remain explicit.`
        : row.identity_authority === 'state-government-current-facility-profile'
          ? `The current state government facility profile identifies ${row.hospital_name} at the exact roster address and links its hospital domain. A hash-bound state-auditor report documents that ${row.pointer_location_name} operates Weatherford Regional Hospital and that the roster-named corporation has substantially the same governing body and is its blended component unit. The exact root pointer and retained current CMS 3.0.0 file agree on the facility address and state. The earlier unresolved matcher result remains in history.`
        : row.identity_authority === 'first-party-and-sec-dba-chain'
          ? `The current first-party hospital page uses both the roster brand and ${row.pointer_location_name} at the exact roster campus, while the SEC filing explicitly identifies the roster legal entity as doing business under that pointer name. The exact current root pointer and retained CMS 3.0.0 file independently agree on the legal entity, facility address, state and current declared date. The historical filing is used only for the name relationship, and the earlier unresolved matcher result remains in history.`
        : row.identity_authority === 'state-regulator-fid-continuity'
          ? `North Carolina's current regulator record identifies Carolina Dunes Behavioral Health at the exact roster address under the same facility ID that its hash-bound decision used for Strategic Behavioral Center-Leland and SBH-Wilmington, LLC d/b/a Strategic Behavioral Center Leland. The exact root pointer and retained current CMS 3.0.0 file agree on SBH-Wilmington, the Carolina Dunes location, address, state and current declared date. The historical decision is used only for facility and legal-name continuity, and the earlier unresolved matcher result remains in history.`
        : row.identity_authority === 'first-party-current-facility-and-price-file'
          ? `The current first-party facility page identifies ${row.declared_hospital_name} at the roster campus, while the current first-party price-transparency page directly links this exact facility-specific file. The exact root pointer and retained current CMS 3.0.0 file independently agree on the hospital identity, campus address, state and declared date. The newer generic identity-unresolved observation remains in history as superseded rather than erasing the stronger evidence.`
        : row.identity_authority === 'first-party-rename-and-street-address'
          ? `Memorial Health's first-party pages identify Springfield Memorial Hospital as formerly Memorial Medical Center at 701 N. First St., Springfield IL. The exact system pointer has a separate Springfield entry, and its retained current CMS 3.0.0 CSV header names Memorial Medical Center dba Springfield Memorial Hospital at 701 N 1st Street, Illinois. The current page shows ZIP 62781 while the roster says 62702; that postal difference is retained, not normalized away. This is a bounded header observation, not complete-file or legal compliance validation.`
        : row.relationship_url
          ? `The hospital's first-party history documents the roster name relationship to ${row.pointer_location_name}; the Puerto Rico Department of Health directory, exact official pointer and retained current CMS 3.0.0 file agree on the facility address and state. The file's city spelling is retained verbatim rather than silently normalized. The earlier unresolved matcher result remains in history.`
        : row.identity_authority === 'state-regulator-current-facility-profile'
          ? `The current state regulator profile identifies ${row.pointer_location_name} at the exact roster address and links the roster-branded hospital domain. The exact root pointer and retained current CMS 3.0.0 file agree on the facility address, state and current declared date. The earlier unresolved matcher result remains in history.`
        : `First-party evidence documents the roster name relationship to ${row.pointer_location_name}; the exact official pointer and retained current CMS 3.0.0 file agree on the facility city, address, state and current declared date. The earlier unresolved matcher result remains in history.` };
  const old = ledger.find(item => item.ccn === row.ccn);
  if (old) {
    if (old.evidence_run === run && JSON.stringify(old.evidence) === JSON.stringify(evidence)) {
      old.action = entry.action;
      old.note = entry.note;
    } else if (row.identity_authority === 'first-party-current-facility-and-price-file'
        && sameBase(old.base, entry.base)
        && Date.parse(entry.reviewed_at) > Date.parse(old.reviewed_at)) {
      const earlierHistory = old.superseded_resolutions || [];
      const priorResolution = { ...old };
      delete priorResolution.superseded_resolutions;
      Object.assign(old, entry, { superseded_resolutions: [priorResolution, ...earlierHistory] });
    } else throw new Error(`Existing nonmatching resolution for ${row.ccn}`);
  } else ledger.push(entry);
}
ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
console.log(JSON.stringify({ applied: proof.map(row => row.ccn), run }, null, 2));
