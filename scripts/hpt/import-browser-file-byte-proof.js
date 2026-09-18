'use strict';
// Import a bounded root sample from a browser-downloaded MRF. The full download
// remains outside the repository and is never copied into the evidence store.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { parsePayload, sha, safeUrl } = require('./lib/recovery-transport');
const { retainedRootMatches } = require('./audit-nationwide-source-proof');

const ROOT = path.resolve(__dirname, '../..');
const RAW = path.join(ROOT, 'cms_data/hpt/nationwide-verification/file-byte-proof');
const OUT = path.join(ROOT, 'data/hpt-audit/nationwide-file-byte-proof.json');
const CAP = 262144;
const args = Object.fromEntries(process.argv.slice(2).map(arg => {
  const [key, ...rest] = arg.replace(/^--/, '').split('=');
  return [key, rest.join('=')];
}));
function isVersionedDocumentAlias(claimUrl, sourceUrl) {
  if (!sourceUrl) return false;
  const claimed = new URL(safeUrl(claimUrl));
  const source = new URL(safeUrl(sourceUrl));
  const basePath = claimed.pathname.replace(/\/$/, '');
  return source.origin === claimed.origin && source.pathname.startsWith(basePath + '/')
    && /^\d+$/.test(source.pathname.slice(basePath.length + 1));
}
function isCaseOnlyDocumentAlias(claimUrl, sourceUrl) {
  if (!sourceUrl) return false;
  const claimed = new URL(safeUrl(claimUrl));
  const source = new URL(safeUrl(sourceUrl));
  return source.origin === claimed.origin
    && source.pathname !== claimed.pathname
    && source.pathname.toLowerCase() === claimed.pathname.toLowerCase()
    && source.search === claimed.search;
}
function isClaimedSourceUrl(claimUrl, sourceUrl) {
  return !!sourceUrl && (safeUrl(claimUrl) === safeUrl(sourceUrl)
    || isVersionedDocumentAlias(claimUrl, sourceUrl)
    || isCaseOnlyDocumentAlias(claimUrl, sourceUrl));
}

async function main() {
  const ccn = String(args.ccn || '').trim();
  const input = path.resolve(String(args.input || ''));
  if (!/^\d{6}$/.test(ccn)) throw new Error('Pass one six-digit --ccn');
  if (!args.input || !fs.statSync(input).isFile()) throw new Error('Pass an existing --input file');
  const nationwide = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/hpt-audit/nationwide-verification.json'), 'utf8')).records;
  const claim = nationwide.find(record => record.ccn === ccn && !record.latest_observation_superseded
    && record.disposition.startsWith('verified-') && record.mrf_url);
  if (!claim) throw new Error(`No active verification claim for ${ccn}`);
  const expectedName = decodeURIComponent(new URL(claim.mrf_url).pathname.split('/').pop());
  const sourceUrl = args['source-url'] ? safeUrl(args['source-url']) : '';
  const claimedSourceUrl = isClaimedSourceUrl(claim.mrf_url, sourceUrl);
  if (path.basename(input) !== expectedName && !claimedSourceUrl)
    throw new Error(`Downloaded filename does not match claimed URL: expected ${expectedName}`);

  const handle = await fs.promises.open(input, 'r');
  const buffer = Buffer.alloc(CAP);
  let bytesRead;
  try { ({ bytesRead } = await handle.read(buffer, 0, CAP, 0)); } finally { await handle.close(); }
  const sample = buffer.subarray(0, bytesRead);
  const parsed = await parsePayload(sample, 'text/csv');
  if (!parsed.parsed?.some(candidate => retainedRootMatches(claim, candidate)))
    throw new Error('Downloaded root metadata does not reproduce the active verification claim');

  const digest = sha(sample);
  const artifact = `${digest}.bin`;
  await fs.promises.mkdir(RAW, { recursive: true });
  await fs.promises.writeFile(path.join(RAW, artifact), sample);
  const manifest = JSON.parse(fs.readFileSync(OUT, 'utf8'));
  const normalizedUrl = safeUrl(claim.mrf_url);
  const record = {
    url: normalizedUrl,
    ccns: [ccn],
    checked_at: new Date().toISOString(),
    final_url: sourceUrl || normalizedUrl,
    final_host: new URL(sourceUrl || normalizedUrl).host,
    final_url_withheld: '',
    url_sha256: crypto.createHash('sha256').update(normalizedUrl).digest('hex'),
    requested_host: new URL(normalizedUrl).host,
    url_withheld: '',
    http_status: 200,
    requested_range: `browser-download:bytes=0-${bytesRead - 1}`,
    bytes_retained: bytesRead,
    sha256: digest,
    raw_artifact: `cms_data/hpt/nationwide-verification/file-byte-proof/${artifact}`,
    content_type: 'text/csv',
    parsed_root_candidates: parsed.parsed,
    error: ''
  };
  const key = value => value.url && safeUrl(value.url) === normalizedUrl;
  const index = manifest.records.findIndex(key);
  if (index >= 0) manifest.records[index] = record; else manifest.records.push(record);
  manifest.records.sort((a, b) => (a.url || a.url_sha256).localeCompare(b.url || b.url_sha256));
  const temp = `${OUT}.partial`;
  await fs.promises.writeFile(temp, JSON.stringify(manifest, null, 2) + '\n');
  await fs.promises.rename(temp, OUT);
  console.log(JSON.stringify({ ccn, downloaded_bytes: fs.statSync(input).size, retained_bytes: bytesRead,
    sha256: digest, parsed_root_candidates: parsed.parsed }, null, 2));
}

if (require.main === module) main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
module.exports = { isVersionedDocumentAlias, isCaseOnlyDocumentAlias, isClaimedSourceUrl };
