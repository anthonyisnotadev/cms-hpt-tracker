'use strict';

// Bounded exact-root rechecks for the three stale-index priority-one CCNs.
// Raw pointer bodies remain private; public output omits contact fields.
const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const { retrieve } = require('./lib/recovery-transport');
const { parsePointer } = require('./lib/parse');

const root = path.resolve(__dirname, '../..');
const rawDir = path.join(root, 'cms_data/hpt/pointer-corpus/rechecks');
const output = path.join(root, 'data/hpt-audit/corpus-index-priority-one-rechecks.json');
const ccns = ['310118', '320001', '360098'];

async function main() {
  await fsp.mkdir(rawDir, { recursive: true });
  const resolutions = new Map(JSON.parse(await fsp.readFile(path.join(root,
    'data/hpt-audit/reviewed-resolutions.json'), 'utf8')).map(row => [row.ccn, row]));
  const records = await Promise.all(ccns.map(async ccn => {
    const resolution = resolutions.get(ccn);
    if (!resolution || resolution.action !== 'replace' || !resolution.evidence?.pointerUrl || !resolution.evidence?.url)
      throw new Error(`Missing exact reviewed pointer/file resolution for ${ccn}`);
    const response = await retrieve(resolution.evidence.pointerUrl, 65536, { timeoutMs: 15000 });
    const entries = response.status >= 200 && response.status < 300
      ? parsePointer(response.body.toString('utf8')).entries : [];
    const matching = entries.filter(entry => entry.mrfUrls?.includes(resolution.evidence.url));
    const artifact = response.body.length ? `${response.sha256}.txt` : '';
    if (artifact) await fsp.writeFile(path.join(rawDir, artifact), response.body);
    return { ccn, pointer_url: resolution.evidence.pointerUrl, checked_at: response.checkedAt,
      http_status: response.status, final_host: new URL(response.finalUrl || resolution.evidence.pointerUrl).hostname,
      bytes_retained: response.body.length, sha256: response.body.length ? response.sha256 : '',
      raw_artifact: artifact ? `cms_data/hpt/pointer-corpus/rechecks/${artifact}` : '',
      parsed_entries: entries.length, selected_mrf_url: resolution.evidence.url,
      selected_file_in_pointer: matching.length > 0,
      selected_location_names: matching.map(entry => entry.locationName),
      reviewed_pointer_sha256: resolution.evidence.pointerSha256,
      reviewed_hash_matches: response.sha256 === resolution.evidence.pointerSha256,
      reviewed_observed_at: resolution.evidence.checked_at,
      error: response.error || '',
      next_action: matching.length
        ? 'Keep the older corpus version historical; recheck current file bytes/metadata on the next scheduled crawl and preserve this dated root observation.'
        : 'Do not infer current file linkage; investigate the exact current root entry and file before renewing a verification claim.' };
  }));
  await fsp.writeFile(output, JSON.stringify({ reason: 'Current exact-root rechecks after stale corpus-index priority-one findings; no MRF refetch.', records }, null, 2) + '\n');
  console.log(JSON.stringify({ rechecked: records.length, selected_file_linked: records.filter(row => row.selected_file_in_pointer).length,
    reviewed_hash_unchanged: records.filter(row => row.reviewed_hash_matches).length }));
}

if (require.main === module) main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
module.exports = { main };
