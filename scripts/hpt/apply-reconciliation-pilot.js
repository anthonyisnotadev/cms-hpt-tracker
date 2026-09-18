'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { parsePointerEntries } = require('./lib/discovery-review');
const { extractDeclared, sniffKind, toISODate } = require('./lib/probe');
const { strongAddressAgreement } = require('./lib/mrf-header-match');
const { applyResolutions } = require('./lib/reviewed-resolutions');
const { csvToObjects } = require('./lib/util');
const root = path.resolve(__dirname, '../..'), audit = path.join(root, 'data/hpt-audit');
const stage = path.join(audit, '.domain-discovery/reconciliation');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const ledger = read(path.join(audit, 'reviewed-resolutions.json'));
const roster = read(path.join(root, 'cms_data/hpt/roster.json'));
const proposals = [];
for (const ccn of ['010023', '051300']) {
  const old = ledger.find(r => r.ccn === ccn);
  if (old?.evidence?.reconciliation_run === 'pilot-2026-09-15') continue;
  if (!old || old.action !== 'quarantine') throw Error(`Unexpected standing resolution ${ccn}`);
  const hospital = roster.find(r => r.ccn === ccn);
  const proof = {};
  for (const kind of ['pointer', 'mrf']) {
    const observation = read(path.join(stage, `${ccn}-${kind}.json`));
    const bytes = fs.readFileSync(path.join(stage, `${ccn}-${kind}.bin`));
    if (crypto.createHash('sha256').update(bytes).digest('hex') !== observation.sha256
        || !/^2\d\d$/.test(String(observation.http_status))) throw Error(`Invalid ${kind} proof ${ccn}`);
    proof[kind] = { observation, bytes };
  }
  const p = proof.pointer.observation, f = proof.mrf.observation;
  const entry = parsePointerEntries(proof.pointer.bytes.toString('utf8')).find(e => e.mrf_url === f.url
    && e.location_name.includes(ccn === '010023' ? 'Baptist Medical Center South' : 'Eastern Plumas'));
  const kind = sniffKind(proof.mrf.bytes, 'text/csv');
  const meta = extractDeclared(proof.mrf.bytes, kind);
  const addresses = String(meta.address || '').split('|');
  if (!entry || kind !== 'csv' || meta.licenseState !== hospital.state
      || !addresses.some(a => strongAddressAgreement(hospital.address, a))) throw Error(`Identity mismatch ${ccn}`);
  if (ccn === '010023' && (!meta.locationName.includes('Baptist Medical Center South') || !meta.address.includes('Montgomery')))
    throw Error('Montgomery campus identity missing');
  if (ccn === '051300' && (!meta.hospitalName.includes('Eastern Plumas') || !meta.address.includes('96122')))
    throw Error('Eastern Plumas identity missing');
  proposals.push({ ...old, action: 'replace', finding: 'compliant-observed',
    superseded_resolutions: [...(old.superseded_resolutions || []), { ...old, superseded_resolutions: undefined }],
    evidence: { identity: 'corroborated', identity_basis: 'reviewed-official-page-pointer-and-file-street-state',
      pointerUrl: p.url, pointerSha256: p.sha256, url: f.url, fileSha256: f.sha256,
      http_status: f.http_status, checked_at: f.checked_at, date: toISODate(meta.raw), version: meta.version,
      file_kind: kind, location_name: entry.location_name, officialDomain: new URL(p.url).hostname,
      sourcePageUrl: entry.source_page_url, reconciliation_run: 'pilot-2026-09-15' },
    reviewed_at: f.checked_at,
    note: ccn === '010023'
      ? 'Reconciled Montgomery campus against the official pricing page and pointer. File lists Baptist Medical Center South at 2105 E South Blvd, Montgomery AL; roster street and state agree, while file ZIP is 36111 and roster ZIP is 36116. Earlier Jacksonville assignment remains superseded. Bounded header review.'
      : 'Reconciled prior manual correction with official pricing page, root pointer and retrieved file. Street 500 First Avenue, CA and ZIP 96122 agree; file city Porola is reconciled with official page Portola. Prior quarantine retained as superseded history. Header review.' });
}
const by = new Map(proposals.map(r => [r.ccn, r]));
const merged = ledger.map(r => by.get(r.ccn) || r);
const table = file => csvToObjects(fs.readFileSync(path.join(audit, file), 'utf8'));
const view = applyResolutions(table('compliance.csv'), table('manifest.csv'), table('gaps.csv'), merged);
if (proposals.some(r => !view.applied.includes(r.ccn))) throw Error('Original crawl guard rejected proposal');
console.log(JSON.stringify({ mode: process.argv.includes('--apply') ? 'apply' : 'preview',
  corrections: proposals.map(r => ({ ccn: r.ccn, finding: r.finding, evidence: r.evidence, note: r.note })) }, null, 2));
if (process.argv.includes('--apply')) fs.writeFileSync(path.join(audit, 'reviewed-resolutions.json'), JSON.stringify(merged, null, 2) + '\n');
