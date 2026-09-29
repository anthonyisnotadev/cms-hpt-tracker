'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { csvToObjects } = require('./lib/util');
const { parsePointerEntries } = require('./lib/discovery-review');
const { extractDeclared, decompressHead, toISODate } = require('./lib/probe');
const { strongAddressAgreement } = require('./lib/mrf-header-match');
const { applyResolutions } = require('./lib/reviewed-resolutions');
const root = path.resolve(__dirname, '../..'), dir = path.join(root, 'data/hpt-audit');
const stage = path.join(dir, '.domain-discovery/reconciliation/missing-address');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
async function main() {
  const pointer = fs.readFileSync(path.join(root, 'cms_data/hpt/pointer-corpus/raw/medcenterhealth.org-b118dd91fe1e.txt'));
  const pointerHash = 'a753f92586c31eb01a3422d8c8a51543ca3c23399dfc942d4719f3164ca3b9e2';
  if (hash(pointer) !== pointerHash) throw Error('Pointer bytes changed');
  const entries = parsePointerEntries(pointer.toString('utf8'));
  const table = file => csvToObjects(fs.readFileSync(path.join(dir, file), 'utf8'));
  const raw = table('compliance.csv');
  const roster = read(path.join(root, 'cms_data/hpt/roster.json'));
  const ledger = read(path.join(dir, 'reviewed-resolutions.json'));
  const proposals = [];
  for (const [ccn, campus] of [['181318', 'Franklin'], ['181324', 'Scottsville'], ['181333', 'Albany']]) {
    const existing = ledger.find(r => r.ccn === ccn);
    if (existing?.evidence_run === 'medcenter-byte-review-2026-09-15') continue;
    const file = fs.readdirSync(stage).find(f => f.startsWith(ccn + '-') && f.endsWith('.json'));
    if (!file) throw Error('No saved retrieval: ' + ccn);
    const observation = read(path.join(stage, file));
    const bytes = fs.readFileSync(path.join(stage, observation.raw_file));
    if (hash(bytes) !== observation.sha256 || observation.http_status !== 206) throw Error('Invalid file proof: ' + ccn);
    const payload = await decompressHead(bytes, 'zip');
    if (!payload || hash(payload) !== observation.payload_sha256) throw Error('Inflated bytes changed: ' + ccn);
    const meta = extractDeclared(payload, 'json');
    const entry = entries.find(e => e.mrf_url === observation.url && e.location_name === 'The Medical Center at ' + campus);
    if (!entry) throw Error('Pointer linkage missing: ' + ccn);
    const facility = roster.find(r => r.ccn === ccn);
    const note = ccn === '181318'
      ? 'Bounded ZIP expansion: archive member filename says Franklin, but the JSON header names The Medical Center at Caverna at 1501 S. Dixie St., Horse Cave KY 42749. Franklin roster and official location page identify 1100 Brookhaven Road, Franklin KY 42134. Filename alone cannot corroborate this assignment. Quarantined pending publisher clarification or a corroborated Franklin file.'
      : 'Bounded ZIP expansion corroborates the pointer-named ' + campus + ' facility against the file hospital name, roster street and KY license state; declared update ' + toISODate(meta.raw) + ', template ' + meta.version + '. Preserved compressed and inflated byte hashes.';
    if (ccn === '181318') {
      if (!meta.hospitalName?.includes('Caverna') || !meta.address?.includes('1501 S. Dixie') || strongAddressAgreement(facility.address, meta.address)) throw Error('Expected conflict not reproduced');
    } else if (!meta.hospitalName?.includes(campus) || meta.licenseState !== facility.state || !strongAddressAgreement(facility.address, meta.address)) throw Error('Identity not corroborated: ' + ccn);
    const proposal = {
      ccn, base: existing?.base || raw.find(r => r.ccn === ccn),
      action: ccn === '181318' ? 'quarantine' : ccn === '181333' ? 'replace-observation' : 'replace',
      finding: ccn === '181318' ? 'not-assessed-identity-conflict' : ccn === '181333' ? 'mrf-stale-over-365-days' : 'compliant-observed',
      evidence: ccn === '181318' ? null : { identity: 'corroborated', identity_basis: 'pointer-name-and-expanded-file-name-street-state',
        pointerUrl: 'https://medcenterhealth.org/cms-hpt.txt', pointerSha256: pointerHash, url: observation.url,
        fileSha256: observation.sha256, payloadSha256: observation.payload_sha256, http_status: observation.http_status,
        checked_at: observation.observed_at, date: toISODate(meta.raw), version: meta.version, file_kind: 'zip',
        location_name: entry.location_name, sourcePageUrl: entry.source_page_url, officialDomain: 'medcenterhealth.org',
        ...(ccn === '181333' ? { observedFinding: 'mrf-stale-over-365-days' } : {}) },
      evidence_run: 'medcenter-byte-review-2026-09-15', reviewed_at: observation.observed_at, note,
      proof: { file_sha256: observation.sha256, payload_sha256: observation.payload_sha256, pointer_sha256: pointerHash,
        observed_hospital_name: meta.hospitalName, observed_address: meta.address,
        official_sources: ccn === '181318' ? ['https://medcenterhealth.org/location/the-medical-center-at-franklin/', 'https://medcenterhealth.org/location/the-medical-center-at-caverna/'] : [] },
      ...(existing ? { superseded_resolutions: [...(existing.superseded_resolutions || []), { ...existing, superseded_resolutions: undefined }] } : {})
    };
    proposals.push(proposal);
  }
  const replacements = new Map(proposals.map(r => [r.ccn, r]));
  const merged = ledger.map(r => replacements.get(r.ccn) || r).concat(proposals.filter(r => !ledger.some(old => old.ccn === r.ccn)));
  const view = applyResolutions(raw, table('manifest.csv'), table('gaps.csv'), merged);
  if (proposals.some(r => !view.applied.includes(r.ccn))) throw Error('Base guard rejected correction');
  console.log(JSON.stringify({ mode: process.argv.includes('--apply') ? 'apply' : 'preview', proposals: proposals.map(r => ({ ccn: r.ccn, action: r.action, finding: r.finding, note: r.note })) }, null, 2));
  if (process.argv.includes('--apply')) fs.writeFileSync(path.join(dir, 'reviewed-resolutions.json'), JSON.stringify(merged, null, 2) + '\n');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
