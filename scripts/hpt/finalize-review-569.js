'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { csvToObjects } = require('./lib/util');
const { extractDeclared, sniffKind, toISODate } = require('./lib/probe');
const { matchMrfHeader, strongAddressAgreement } = require('./lib/mrf-header-match');
const { metadataStatus } = require('./recheck-interventions');
const { parsePointerEntries } = require('./lib/discovery-review');
const { applyResolutions } = require('./lib/reviewed-resolutions');

const ROOT = path.resolve(__dirname, '..', '..');
const BASE = path.join(ROOT, 'data', 'hpt-audit');
const STAGE = path.join(BASE, '.domain-discovery', 'review-569');
const PUBLIC_REPORT = path.join(BASE, 'discovery-review-recoveries.json');
const LEDGER = path.join(BASE, 'reviewed-resolutions.json');

const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
// review-domain-cohort hashes serialized JSON values so text evidence remains
// stable after the private observation file is parsed again.
const evidenceHash = value => sha(JSON.stringify(value));
const canonical = value => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
};
const baseDigest = row => sha(JSON.stringify(canonical(row)));

function findPointerProof(mrf, official) {
  const attempt = (official.attempts || []).find(item => item.url === mrf.entry.pointer_url
    && item.usable && Number(item.http_status) >= 200 && Number(item.http_status) < 300);
  if (!attempt || !attempt.body) throw new Error(`Pointer body missing for ${mrf.ccn}`);
  if (sha(attempt.body) !== attempt.body_sha256) throw new Error(`Pointer hash mismatch for ${mrf.ccn}`);
  const entry = parsePointerEntries(attempt.body).find(item => item.location_name === mrf.entry.location_name
    && item.mrf_url === mrf.entry.mrf_url);
  if (!entry) throw new Error(`Pointer entry mismatch for ${mrf.ccn}`);
  return { attempt, entry };
}

function inspectFileProof(mrf) {
  const deepPath = path.join(STAGE, 'deep-mrf', `${mrf.ccn}.json`);
  if (fs.existsSync(deepPath)) {
    const deep = read(deepPath);
    for (const observation of [...(deep.observations || [])].reverse()) {
      const candidate = (observation.candidates || []).find(item => item.declaredLastUpdated
        && item.cmsVersion && item.mrfHospitalName && item.mrfAddress && item.mrfLicenseState);
      if (!candidate || !observation.artifact) continue;
      const artifact = path.join(STAGE, observation.artifact);
      if (!fs.existsSync(artifact)) throw new Error(`Deep MRF artifact missing for ${mrf.ccn}`);
      const body = fs.readFileSync(artifact);
      if (sha(body) !== observation.body_sha256) throw new Error(`Deep MRF artifact hash mismatch for ${mrf.ccn}`);
      return { kind: candidate.innerKind || candidate.fileKind, date: candidate.declaredLastUpdated,
        version: candidate.cmsVersion, hospitalName: candidate.mrfHospitalName,
        locationName: candidate.mrfLocationName, address: candidate.mrfAddress,
        licenseState: candidate.mrfLicenseState, bodySha256: observation.body_sha256,
        evidenceBytes: observation.body_bytes,
        attempt: { http_status: observation.http_status, checked_at: observation.checked_at,
          body_sha256: observation.body_sha256, bytes_read: observation.body_bytes } };
    }
  }
  const attempt = mrf.file_attempt;
  if (!attempt || Number(attempt.http_status) < 200 || Number(attempt.http_status) >= 300 || !attempt.body_prefix)
    throw new Error(`Successful MRF prefix missing for ${mrf.ccn}`);
  const bodyText = attempt.body_prefix;
  if (evidenceHash(bodyText) !== attempt.body_sha256) throw new Error(`MRF prefix hash mismatch for ${mrf.ccn}`);
  const body = Buffer.from(bodyText);
  const kind = sniffKind(body, attempt.content_type || '');
  const declared = extractDeclared(body, kind);
  return {
    kind,
    date: toISODate(declared.raw),
    version: declared.version,
    hospitalName: declared.hospitalName,
    locationName: declared.locationName,
    address: declared.address,
    licenseState: declared.licenseState, bodySha256: attempt.body_sha256,
    evidenceBytes: attempt.bytes_read,
    attempt
  };
}

function evaluateRecord(record, roster, complianceByCcn) {
  const mrfPath = path.join(STAGE, 'mrf', `${record.ccn}.json`);
  const officialPath = path.join(STAGE, 'official', `${record.ccn}.json`);
  const base = complianceByCcn.get(record.ccn);
  if (!base || baseDigest(base) !== record.base_sha256 || base.finding !== 'not-assessed-domain-unknown')
    return { ccn: record.ccn, outcome: 'base-changed', reason: 'The frozen crawl row no longer matches.' };
  if (!fs.existsSync(mrfPath) || !fs.existsSync(officialPath))
    return { ccn: record.ccn, outcome: 'evidence-missing', reason: 'The private pointer or MRF evidence file is missing.' };
  const mrf = read(mrfPath), official = read(officialPath);
  if (!mrf.facility_matched || !mrf.entry) return { ccn: record.ccn, outcome: 'pointer-match-unresolved', reason: 'No facility-matched pointer entry is retained.' };
  let pointer, file;
  try { pointer = findPointerProof(mrf, official); file = inspectFileProof(mrf); }
  catch (error) {
    if (/^Successful MRF prefix missing/.test(error.message)) {
      const deepPath = path.join(STAGE, 'deep-mrf', `${mrf.ccn}.json`);
      const latest = fs.existsSync(deepPath) ? read(deepPath).observations?.at(-1) : null;
      const attempt = latest || mrf.file_attempt || {};
      const status = Number(attempt.http_status || 0);
      const detail = status ? `returned HTTP ${status}` : `did not complete at the request/tool layer (${attempt.error || 'no response'})`;
      return { ccn: record.ccn, hospital_name: record.hospital_name,
        pointer_url: mrf.entry.pointer_url, mrf_url: mrf.entry.mrf_url,
        checked_at: attempt.checked_at || '', http_status: status,
        transport_error: status ? '' : attempt.error || 'no response',
        outcome: 'not-ready', reason: `The pointer-declared MRF request ${detail}; no usable MRF bytes were verified.` };
    }
    return { ccn: record.ccn, hospital_name: record.hospital_name,
      outcome: 'proof-invalid', reason: error.message };
  }
  const task = { refs: [{ location_name: mrf.entry.location_name }] };
  const probe = { rangeStatus: file.attempt.http_status, mrfHospitalName: file.hospitalName,
    mrfLocationName: file.locationName, mrfAddress: file.address, mrfLicenseState: file.licenseState };
  const match = matchMrfHeader(task, probe, roster);
  let facility = match.matches.find(item => item.hospital.ccn === record.ccn);
  // Some files use a legal entity or current campus name that differs from the
  // roster. The already-matched official pointer plus a unique exact street
  // assignment in the declared license state is still facility-specific.
  if (!facility && file.address && String(file.licenseState || '').toUpperCase() === String(base.state || '').toUpperCase()) {
    const addressMatches = roster.filter(hospital => hospital.state === base.state
      && strongAddressAgreement(hospital.address, file.address));
    if (addressMatches.length === 1 && addressMatches[0].ccn === record.ccn)
      facility = { hospital: addressMatches[0], identityBasis: 'matched-official-pointer-and-unique-file-address' };
  }
  const manualPath = path.join(STAGE, 'manual-mrf-identities.json');
  const manual = fs.existsSync(manualPath) ? read(manualPath).find(item => item.ccn === record.ccn) : null;
  if (!facility && manual?.decision === 'corroborated' && manual.mrf_url === mrf.entry.mrf_url
      && manual.declared_address === file.address && manual.source_url && manual.observed_at && manual.basis
      && String(file.licenseState || '').toUpperCase() === String(base.state || '').toUpperCase()) {
    facility = { hospital: roster.find(item => item.ccn === record.ccn),
      identityBasis: 'reviewed-first-party-address-reconciliation', manual };
  }
  const metadata = metadataStatus({ declared_date: file.date, version: file.version }, Date.parse(file.attempt.checked_at));
  const common = { ccn: record.ccn, hospital_name: record.hospital_name, pointer_url: pointer.attempt.url,
    mrf_url: mrf.entry.mrf_url, checked_at: file.attempt.checked_at, file_kind: file.kind,
    declared_date: file.date || '', cms_version: file.version || '', mrf_hospital_name: file.hospitalName || '',
    mrf_location_name: file.locationName || '', mrf_address: file.address || '',
    mrf_license_state: file.licenseState || '', pointer_sha256: pointer.attempt.body_sha256,
    file_prefix_sha256: file.bodySha256, file_prefix_bytes: file.evidenceBytes,
    metadata_status: metadata, identity_status: facility ? 'corroborated' : match.status,
    identity_reason: facility ? facility.identityBasis || match.reason : match.reason || 'unresolved',
    ...(facility?.manual ? { identity_evidence_url: facility.manual.source_url,
      identity_evidence_observed_at: facility.manual.observed_at,
      identity_evidence_basis: facility.manual.basis } : {}) };
  if (!facility) {
    const conflictsPath = path.join(STAGE, 'manual-mrf-conflicts.json');
    const conflict = fs.existsSync(conflictsPath) ? read(conflictsPath).find(item => item.ccn === record.ccn) : null;
    if (conflict?.mrf_url === mrf.entry.mrf_url && conflict.observed_at && conflict.basis) return { ...common,
      outcome: 'verified-identity-conflict', reason: conflict.basis,
      resolution: { ccn: record.ccn, base, action: 'quarantine', evidence: null,
        finding: 'not-assessed-identity-conflict', note: conflict.basis,
        official: { domain: record.website.domain, page: record.website.name_evidence },
        reviewed_at: conflict.observed_at } };
    return { ...common, outcome: 'not-ready', reason: `Facility identity unresolved: ${match.reason}.` };
  }
  const observedFinding = metadata === 'date-over-365-days' ? 'mrf-stale-over-365-days'
    : metadata === 'date-within-365-days-older-version' ? 'old-template-version' : '';
  if (metadata !== 'date-within-365-days-version-3' && !observedFinding)
    return { ...common, outcome: 'not-ready', reason: `Metadata status is ${metadata}.` };
  const publisherObservation = !!observedFinding;
  return { ...common, outcome: publisherObservation ? 'verified-publisher-observation' : 'verified-recovery',
    reason: publisherObservation
      ? `Official pointer and facility-specific MRF identity agree; declared metadata supports ${observedFinding}.`
      : 'Official pointer, facility-specific MRF header, address/state, current declared date, and version 3 agree.',
    resolution: {
      ccn: record.ccn,
      base,
      action: publisherObservation ? 'replace-observation' : 'replace',
      evidence: {
        identity: 'corroborated', identity_basis: facility.identityBasis,
        pointerUrl: pointer.attempt.url, pointerSha256: pointer.attempt.body_sha256,
        url: mrf.entry.mrf_url, fileSha256: file.bodySha256,
        http_status: file.attempt.http_status, checked_at: file.attempt.checked_at,
        date: file.date, version: file.version, file_kind: file.kind,
        location_name: mrf.entry.location_name, officialDomain: record.website.domain,
        sourcePageUrl: mrf.entry.source_page_url || '',
        ...(publisherObservation ? { observedFinding } : {})
      },
      finding: publisherObservation ? observedFinding : 'compliant-observed',
      note: publisherObservation
        ? 'Verified publisher observation from the reviewed 569-record discovery cohort using hash-checked official pointer and bounded MRF header evidence.'
        : 'Recovered from the reviewed 569-record discovery cohort using hash-checked official pointer and bounded MRF header evidence.',
      reviewed_at: new Date().toISOString()
    }
  };
}

function evaluate() {
  const discovery = read(path.join(BASE, 'discovery-review.json'));
  const roster = read(path.join(ROOT, 'cms_data', 'hpt', 'roster.json'));
  const compliance = csvToObjects(fs.readFileSync(path.join(BASE, 'compliance.csv'), 'utf8'));
  const complianceByCcn = new Map(compliance.map(row => [row.ccn, row]));
  const appliedCcns = new Set(read(LEDGER).map(row => row.ccn));
  const records = discovery.records.filter(record => ['mrf-verification-pending', 'mrf-request-failed'].includes(record.disposition));
  const results = records.map(record => {
    const result = evaluateRecord(record, roster, complianceByCcn);
    if (result.resolution && appliedCcns.has(record.ccn)) return { ...result, outcome: 'already-applied', resolution: undefined,
      reason: 'This hash-checked recovery is already present in the reviewed-resolution ledger.' };
    return result;
  });
  const counts = results.reduce((out, row) => ((out[row.outcome] = (out[row.outcome] || 0) + 1), out), {});
  const report = { generated_at: new Date().toISOString(), cohort: records.length, counts,
    records: results.map(({ resolution, ...row }) => row) };
  fs.writeFileSync(PUBLIC_REPORT, JSON.stringify(report, null, 2) + '\n');
  fs.writeFileSync(path.join(STAGE, 'verified-recovery-proposals.json'), JSON.stringify(results.filter(row => row.resolution).map(row => row.resolution), null, 2) + '\n');
  console.log(JSON.stringify({ report: path.relative(ROOT, PUBLIC_REPORT), cohort: records.length, counts }, null, 2));
  return results;
}

function apply() {
  const results = evaluate();
  const proposals = results.filter(row => row.resolution).map(row => row.resolution);
  const ledger = read(LEDGER), byCcn = new Map(ledger.map(row => [row.ccn, row]));
  for (const proposal of proposals) {
    if (byCcn.has(proposal.ccn)) throw new Error(`Reviewed-resolution ledger already contains ${proposal.ccn}`);
    byCcn.set(proposal.ccn, proposal);
  }
  const compliance = csvToObjects(fs.readFileSync(path.join(BASE, 'compliance.csv'), 'utf8'));
  const manifest = csvToObjects(fs.readFileSync(path.join(BASE, 'manifest.csv'), 'utf8'));
  const gaps = csvToObjects(fs.readFileSync(path.join(BASE, 'gaps.csv'), 'utf8'));
  const checked = applyResolutions(compliance, manifest, gaps, [...byCcn.values()]);
  const expected = new Set(proposals.map(row => row.ccn));
  if ([...expected].some(ccn => !checked.applied.includes(ccn))) throw new Error('A proposed recovery conflicts with the current crawl.');
  fs.writeFileSync(LEDGER, JSON.stringify([...byCcn.values()], null, 2) + '\n');
  console.log(JSON.stringify({ applied: proposals.length, ledger_entries: byCcn.size }, null, 2));
}

if (require.main === module) {
  try { process.argv.includes('--apply') ? apply() : evaluate(); }
  catch (error) { console.error(error); process.exitCode = 1; }
}

module.exports = { baseDigest, evaluateRecord, findPointerProof, inspectFileProof };
