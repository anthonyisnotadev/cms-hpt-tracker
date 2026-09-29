'use strict';

// One bounded recheck of exact roots whose crawl-state hash disagrees with
// retained corpus bytes. Never imports an entry or changes a CCN finding.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { curlGet, decode } = require('./lib/recovery-transport');
const { parsePointer } = require('./lib/parse');

const root = path.resolve(__dirname, '../..');
const inventoryFile = path.join(root, 'data/hpt-audit/pointer-provenance-discrepancies.json');
const outputFile = path.join(root, 'data/hpt-audit/pointer-provenance-discrepancy-rechecks.json');
const rawDir = path.join(root, 'cms_data/hpt/nationwide-verification/pointer-provenance-rechecks');
const cap = 131072;
const sha = body => crypto.createHash('sha256').update(body).digest('hex');

async function check(row) {
  const observed_at = new Date().toISOString();
  const response = await curlGet(row.checked_url, cap, 15000, 4, {}, false);
  const basic = { ccn: row.ccn, checked_url: row.checked_url, observed_at,
    prior_verification_sha256: row.verification_sha256,
    prior_corpus_index_sha256s: row.corpus_versions.map(version => version.sha256),
    http_status: response.status, content_type: response.headers['content-type'] || '',
    final_host: (() => { try { return new URL(response.finalUrl).hostname; } catch { return ''; } })(),
    redirect_count: response.redirects.length,
    response_bytes: response.body.length,
    response_sha256: response.body.length ? sha(response.body) : '',
    verification_hash_reproduced: response.body.length > 0 && sha(response.body) === row.verification_sha256,
    request_error: response.error || '' };
  if (response.status !== 200 || response.body.length >= cap) return {
    ...basic, complete_pointer_bytes: false, parsed_location_names: [],
    next_action: response.body.length >= cap ? 'Retry with a larger bounded root-pointer cap; no complete bytes retained.'
      : 'Keep prior hashes historical and investigate this exact root through a permitted route after access changes.'
  };
  const parsed = parsePointer(decode(response.body));
  const names = parsed.entries.map(entry => entry.locationName || '').filter(Boolean);
  if (!parsed.entries.length) return { ...basic, complete_pointer_bytes: true,
    parsed_location_names: [], next_action: 'Inspect the returned root content before treating it as a structured pointer.' };
  fs.mkdirSync(rawDir, { recursive: true });
  const retained = path.join(rawDir, `${basic.response_sha256}.bin`);
  if (fs.existsSync(retained) && sha(fs.readFileSync(retained)) !== basic.response_sha256)
    throw new Error(`Retained pointer hash collision: ${retained}`);
  if (!fs.existsSync(retained)) fs.writeFileSync(retained, response.body);
  return { ...basic, complete_pointer_bytes: true, pointer_format: parsed.format,
    parsed_location_names: names,
    retained_file: path.relative(root, retained).replace(/\\/g, '/'),
    next_action: 'Reconcile this fresh root entry set to the exact CCN and independently verify any intended file before updating the standing finding.' };
}

async function main() {
  const inventory = JSON.parse(fs.readFileSync(inventoryFile, 'utf8'));
  const rows = inventory.unmatched;
  if (!Array.isArray(rows) || rows.length === 0)
    throw new Error(`Expected a non-empty provenance conflict inventory, found ${rows.length}`);
  const results = [];
  for (let start = 0; start < rows.length; start += 3)
    results.push(...await Promise.all(rows.slice(start, start + 3).map(check)));
  results.sort((a, b) => a.ccn.localeCompare(b.ccn));
  const output = { reason: 'Retained crawl-state hashes and corpus-index/raw bytes disagree for the exact requested root at the same recorded timestamp.',
    summary: { attempted: results.length, complete_structured_pointers: results.filter(row => row.retained_file).length,
      verification_hashes_reproduced: results.filter(row => row.verification_hash_reproduced).length,
      http_statuses: results.reduce((map, row) => ((map[row.http_status] = (map[row.http_status] || 0) + 1), map), {}) },
    records: results, source_sha256: { 'pointer-provenance-discrepancies.json': sha(fs.readFileSync(inventoryFile)) } };
  fs.writeFileSync(outputFile, `${JSON.stringify(output, null, 2)}\n`);
  console.log(JSON.stringify(output.summary));
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { check };
