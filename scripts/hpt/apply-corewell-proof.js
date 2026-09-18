'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const { csvToObjects } = require('./lib/util');
const { parsePointerEntries } = require('./lib/discovery-review');
const { extractDeclared, toISODate } = require('./lib/probe');
const { strongAddressAgreement } = require('./lib/mrf-header-match');
const { applyResolutions } = require('./lib/reviewed-resolutions');
const root = path.resolve(__dirname, '../..'), dir = path.join(root, 'data/hpt-audit');
const stage = path.join(dir, '.domain-discovery/reconciliation/corewell-manual');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const table = file => csvToObjects(fs.readFileSync(path.join(dir, file), 'utf8'));
const pointer = fs.readFileSync(path.join(root, 'cms_data/hpt/pointer-corpus/raw/corewellhealth.org-3eb06be226c0.txt'));
const pointerHash = 'd68970f23fc4c614a3ec005f87d47895de4bc496cbe40290c0feee7e5e1fe3df';
if (hash(pointer) !== pointerHash) throw Error('Pointer changed');
const entries = parsePointerEntries(pointer.toString('utf8'));
const roster = read(path.join(root, 'cms_data/hpt/roster.json'));
const ledger = read(path.join(dir, 'reviewed-resolutions.json'));
const raw = table('compliance.csv'), proposals = [];
for (const [ccn, campus, pointerCampus] of [
  ['230020', 'Dearborn', 'Dearborn'],
  ['230035', 'Greenville', 'Greenville'], ['230038', 'Butterworth', 'Butterworth Hospital'],
  ['230089', 'Grosse Pointe', 'Gross Pointe'], ['230151', 'Farmington Hills', 'Farmington Hills'],
  ['230269', 'Troy', 'Troy'], ['230270', 'Taylor', 'Taylor']
]) {
  const old = ledger.find(r => r.ccn === ccn);
  if (old?.evidence_run === 'corewell-byte-review-2026-09-15') continue;
  const file = fs.readdirSync(stage).find(f => f.startsWith(ccn + '-') && f.endsWith('.json'));
  const observation = read(path.join(stage, file));
  const bytes = fs.readFileSync(path.join(stage, observation.raw_file));
  if (hash(bytes) !== observation.sha256 || observation.http_status !== 206 || observation.payload_kind !== 'csv') throw Error('Invalid file proof: ' + ccn);
  const metadata = extractDeclared(bytes, 'csv'), facility = roster.find(r => r.ccn === ccn);
  const entry = entries.find(e => e.mrf_url === observation.url && e.location_name === 'Corewell Health ' + pointerCampus);
  if (!entry || !metadata.locationName?.includes(campus) || metadata.licenseState !== facility.state
      || !strongAddressAgreement(facility.address, metadata.address)) throw Error('Identity gate rejected ' + ccn);
  const note = 'Reconciled saved manual file correction with exact structured pointer URL and retrieved CSV location name ' + metadata.locationName.trim()
    + ', roster street and MI state. File declares ' + toISODate(metadata.raw) + ', version ' + metadata.version
    + '. Corewell branding differs from the historical roster name; campus address is independently corroborated.'
    + (['230020', '230151'].includes(ccn) ? ' The publisher wrapped the URL onto the immediate line after an empty mrf-url field; the conservative pointer parser now preserves that exact linkage.' : '')
    + (ccn === '230089' ? ' Pointer label spells Gross Pointe and shares this URL with Royal Oak; only the Grosse Pointe file address is corroborated here. No Royal Oak finding is inferred.' : '');
  proposals.push({ ccn, base: old?.base || raw.find(r => r.ccn === ccn), action: 'replace', finding: 'compliant-observed',
    evidence: { identity: 'corroborated', identity_basis: 'exact-pointer-campus-and-file-location-street-state',
      pointerUrl: 'https://corewellhealth.org/cms-hpt.txt', pointerSha256: pointerHash, url: observation.url,
      fileSha256: observation.sha256, http_status: observation.http_status, checked_at: observation.observed_at,
      date: toISODate(metadata.raw), version: metadata.version, file_kind: 'csv', location_name: metadata.locationName.trim(),
      sourcePageUrl: entry.source_page_url, officialDomain: 'corewellhealth.org' },
    reviewed_at: observation.observed_at, evidence_run: 'corewell-byte-review-2026-09-15', note,
    ...(old ? { superseded_resolutions: [...(old.superseded_resolutions || []), { ...old, superseded_resolutions: undefined }] } : {}) });
}
const replacements = new Map(proposals.map(r => [r.ccn, r]));
const merged = ledger.map(r => replacements.get(r.ccn) || r).concat(proposals.filter(r => !ledger.some(old => old.ccn === r.ccn)));
const view = applyResolutions(raw, table('manifest.csv'), table('gaps.csv'), merged);
if (proposals.some(r => !view.applied.includes(r.ccn))) throw Error('Original crawl guard rejected correction');
console.log(JSON.stringify({ mode: process.argv.includes('--apply') ? 'apply' : 'preview', proposals: proposals.map(r => ({ ccn: r.ccn, finding: r.finding, note: r.note })) }, null, 2));
if (process.argv.includes('--apply')) fs.writeFileSync(path.join(dir, 'reviewed-resolutions.json'), JSON.stringify(merged, null, 2) + '\n');
