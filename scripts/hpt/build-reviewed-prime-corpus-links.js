'use strict';

// One-time, source-bound review of the 28 exact Prime September pointer links.
// Lake Huron 230031 is intentionally excluded pending independent root access.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { csvToObjects } = require('./lib/util');
const { parsePointer } = require('./lib/parse');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const corpus = path.join(root, 'cms_data/hpt/pointer-corpus/cms_hpt_entries.csv');
const headers = path.join(root, 'cms_data/hpt/nationwide-verification/mrf-headers.csv');
const input = path.join(audit, 'template-version-discrepancies.json');
const output = path.join(audit, 'reviewed-prime-corpus-links.json');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const split = value => String(value || '').split('|').filter(Boolean);
const assert = (condition, message) => { if (!condition) throw new Error(message); };

function main() {
  const sourceBytes = fs.readFileSync(input);
  const inventory = JSON.parse(sourceBytes);
  const rows = csvToObjects(fs.readFileSync(corpus, 'utf8'));
  const byUrl = new Map(csvToObjects(fs.readFileSync(headers, 'utf8')).map(row => [row.mrf_url, row]));
  const roster = new Map(JSON.parse(fs.readFileSync(path.join(root, 'cms_data/hpt/roster.json'), 'utf8'))
    .map(row => [row.ccn, row]));
  const candidates = inventory.records.filter(row => [
    '1-different-file-pointer-match-unresolved',
    '2-different-file-replaced-with-exact-pointer-proof'
  ].includes(row.review_priority) && row.ccn !== '230031');
  assert(candidates.length === 28, `Expected the 28 previously exact-linked Prime cases, got ${candidates.length}`);
  const records = candidates.map(row => {
    const header = byUrl.get(row.observed_mrf_url);
    const source = rows.find(item => item.mrf_url === row.observed_mrf_url
      && item.pointer_sha256 === row.pointer_corpus_sha256
      && item.pointer_url === row.pointer_corpus_checked_url);
    const hospital = roster.get(row.ccn);
    assert(source && source.record_status === 'ok', `${row.ccn}: exact pointer entry absent`);
    assert(header && split(header.header_matched_ccns).includes(row.ccn)
      && ['file-name-and-address', 'exact-pointer-ccn-file-street-license-state-agree']
        .includes(header.identity_gate), `${row.ccn}: exact header identity absent`);
    assert(header.mrf_license_state === row.state && hospital?.state === row.state,
      `${row.ccn}: license/roster state mismatch`);
    assert(header.mrf_cms_version === '3.0' && header.mrf_last_updated === row.declared_last_updated
      && Number(header.mrf_range_status) >= 200 && Number(header.mrf_range_status) < 300,
      `${row.ccn}: bounded file metadata changed`);
    assert(split(header.pointer_sha256s).includes(source.pointer_sha256)
      && row.pointer_corpus_raw_integrity === 'hash-corroborated', `${row.ccn}: header/pointer hash mismatch`);
    const raw = fs.readFileSync(path.join(root, source.raw_file));
    assert(sha(raw) === source.pointer_sha256 && raw.length === Number(source.raw_bytes),
      `${row.ccn}: retained pointer bytes mismatch`);
    assert(parsePointer(raw.toString('utf8')).entries.some(entry => entry.mrfUrls?.includes(row.observed_mrf_url)),
      `${row.ccn}: selected MRF not in pointer bytes`);
    assert(row.standing_mrf_url !== row.observed_mrf_url && row.matched_mrf_candidates === 1,
      `${row.ccn}: not a unique replacement candidate`);
    return { ccn: row.ccn, hospital_name: row.hospital_name, state: row.state,
      pointer_url: source.pointer_url, pointer_sha256: source.pointer_sha256,
      pointer_raw_file: source.raw_file, mrf_url: row.observed_mrf_url,
      displaced_mrf_url: row.standing_mrf_url, mrf_declared_address: header.mrf_address,
      mrf_hospital_name: header.mrf_hospital_name, mrf_location_name: header.mrf_location_name,
      mrf_license_state: header.mrf_license_state, mrf_last_updated: header.mrf_last_updated,
      mrf_cms_version: header.mrf_cms_version, mrf_header_observed_at: header.checked_at,
      identity_gate: header.identity_gate };
  }).sort((a, b) => a.ccn.localeCompare(b.ccn));
  const report = { reason: 'Restore 28 previously exact-linked Prime September files after cache-only corpus replay; not a fresh retrieval or whole-file assessment.',
    excluded_ccn: '230031', source_inventory_sha256: sha(sourceBytes), records };
  fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ reviewed_links: records.length, excluded_ccn: report.excluded_ccn,
    source_inventory_sha256: report.source_inventory_sha256 }));
}

if (require.main === module) main();
module.exports = { main };
