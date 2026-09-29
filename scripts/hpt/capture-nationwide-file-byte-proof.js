'use strict';
// Resumable, bounded byte-proof capture for nationwide verification claims.
// Raw samples remain under cms_data; the public manifest contains hashes and parsed root metadata only.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { retrieve, parsePayload, sha, safeUrl } = require('./lib/recovery-transport');
const { pooled, csvToObjects } = require('./lib/util');

const ROOT = path.resolve(__dirname, '../..');
const RAW = path.join(ROOT, 'cms_data/hpt/nationwide-verification/file-byte-proof');
const OUT = path.join(ROOT, 'data/hpt-audit/nationwide-file-byte-proof.json');
const CAP = 262144;
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const atomic = async (file, value) => {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.partial`;
  await fsp.writeFile(temp, JSON.stringify(value, null, 2) + '\n');
  await fsp.rename(temp, file);
};
const args = Object.fromEntries(process.argv.slice(2).map(arg => {
  const [key, value = 'true'] = arg.replace(/^--/, '').split('='); return [key, value];
}));
function publicRedirect(requested, finalValue) {
  let final; try { final = new URL(finalValue || requested); } catch (_) { return { final_url: '', final_host: '', final_url_withheld: 'invalid-redirect-url' }; }
  const sensitive = final.href.length > 500 || /[?&](?:x-amz-[^=]*|signature|sig|token|auth|key|expires|policy|credential)=/i.test(final.href)
    || /(?:boxcloud|cloudfront)\.net$/i.test(final.hostname);
  return sensitive ? { final_url: '', final_host: final.host, final_url_withheld: 'transient-or-credential-bearing-redirect' }
    : { final_url: final.href, final_host: final.host, final_url_withheld: '' };
}
const sensitiveRequested = value => /[?&](?:x-amz-[^=]*|signature|sig|token|auth|key|expires|policy|credential)=/i.test(value);
const proofKey = value => sensitiveRequested(value) ? `sha256:${sha(value)}` : value;
function publicRequested(value) {
  const parsed = new URL(value);
  return sensitiveRequested(value)
    ? { url: '', url_sha256: sha(value), requested_host: parsed.host, url_withheld: 'credential-bearing-source-url' }
    : { url: value, url_sha256: sha(value), requested_host: parsed.host, url_withheld: '' };
}

function captureSummary({ nationwide, claims, prior, selected, attempted, records, byUrl }) {
  return {
    claims: nationwide.length,
    unique_urls: claims.size,
    previously_recorded: prior.records.length,
    selected_requests: selected.length,
    attempted_requests: attempted,
    stored_successful_http_samples: records.filter(r => r.http_status >= 200 && r.http_status < 300 && r.bytes_retained).length,
    stored_parsed_root_samples: records.filter(r => r.parsed_root_candidates?.length).length,
    stored_unsuccessful_responses: records.filter(r => !r.http_status || r.http_status < 200 || r.http_status >= 300).length,
    remaining_unattempted_urls: [...claims].filter(([url]) => !byUrl.has(proofKey(url))).length
  };
}

async function main() {
  await fsp.mkdir(RAW, { recursive: true });
  const requestedCcns = new Set(String(args.ccn || '').split(',').map(value => value.trim()).filter(Boolean));
  const nationwide = read(path.join(ROOT, 'data/hpt-audit/nationwide-verification.json')).records
    .filter(record => !record.latest_observation_superseded && record.disposition.startsWith('verified-') && record.mrf_url)
    .filter(record => !requestedCcns.size || requestedCcns.has(record.ccn));
  const nationwideByCcn = new Map(nationwide.map(record => [record.ccn, record]));
  const headerRows = csvToObjects(fs.readFileSync(path.join(ROOT, 'cms_data/hpt/nationwide-verification/mrf-headers.csv'), 'utf8'));
  const headerCache = Object.values(read(path.join(ROOT, 'cms_data/hpt/nationwide-verification/mrf-header-cache.json')));
  const cachedFinalByUrl = new Map(headerCache.filter(row => row.ok && row.url && row.finalUrl)
    .map(row => [safeUrl(row.url), safeUrl(row.finalUrl)]));
  const sourcePageByUrl = new Map(headerRows.map(row => [row.mrf_url, String(row.source_page_urls || '').split('|').find(Boolean) || '']));
  const pointerOriginByUrl = new Map(headerRows.map(row => {
    const pointer = String(row.pointer_urls || '').split('|').find(Boolean) || '';
    let origin = ''; try { origin = pointer ? new URL(pointer).origin + '/' : ''; } catch (_) {}
    return [row.mrf_url, origin];
  }));
  const prior = fs.existsSync(OUT) ? read(OUT) : { version: 1, sample_bytes: CAP, records: [] };
  const byUrl = new Map(prior.records.map(record => [record.url ? record.url : `sha256:${record.url_sha256}`, record]));
  const claims = new Map();
  for (const record of nationwide) {
    let url; try { url = safeUrl(record.mrf_url); } catch (_) { continue; }
    if (!claims.has(url)) claims.set(url, []);
    claims.get(url).push(record.ccn);
  }
  const retryFailed = args['retry-failed'] === 'true';
  const retryStatus = args['retry-status'];
  const retryMatches = record => !(record.http_status >= 200 && record.http_status < 300)
    && (retryStatus === undefined || String(record.http_status || 0) === String(retryStatus));
  const pending = [...claims].filter(([url]) => !byUrl.has(proofKey(url)) || (retryFailed && retryMatches(byUrl.get(proofKey(url)))));
  const limit = Math.max(0, Number(args.limit || 25));
  const selected = limit ? pending.slice(0, limit) : pending;
  let completed = 0;
  await pooled(selected, { concurrency: Math.max(1, Number(args.concurrency || 6)), keyFn: ([url]) => new URL(url).hostname,
    onProgress: (done, total) => { completed = done; if (done === total || done % 10 === 0) console.log(`byte proof ${done}/${total}`); } },
  async ([url, ccns]) => {
    const checkedAt = new Date().toISOString();
    try {
      // A prior successful header observation may have resolved a stable export
      // route to the actual file. Reuse that exact cached destination only when
      // explicitly requested; the proof remains keyed to the claimed URL.
      const targetUrl = args['use-cached-final-url'] === 'true' ? cachedFinalByUrl.get(url) || url : url;
      const referer = args.referer === 'source-page' ? sourcePageByUrl.get(url)
        : args.referer === 'pointer-origin' ? pointerOriginByUrl.get(url)
        : args.referer === 'official-domain' && nationwideByCcn.get(ccns[0])?.official_domain
          ? `https://www.${String(nationwideByCcn.get(ccns[0]).official_domain).replace(/^www\./i, '')}/`
        : args.referer === 'origin' ? new URL(url).origin + '/' : '';
      const headers = referer ? { Referer: referer } : {};
      const curlOnStatuses = [
        ...(args['curl-on-403'] === 'true' ? [403] : []),
        ...(args['curl-on-429'] === 'true' ? [429] : [])
      ];
      const response = await retrieve(targetUrl, CAP, { timeoutMs: Math.max(1000, Number(args.timeout || 15000)), headers, curlOnStatuses,
        curlUseRange: args['curl-no-range'] !== 'true' });
      const digest = sha(response.body);
      const artifact = response.body.length ? `${digest}.bin` : '';
      if (artifact) await fsp.writeFile(path.join(RAW, artifact), response.body);
      const parsed = response.status >= 200 && response.status < 300
        ? await parsePayload(response.body, response.headers['content-type'] || '') : { parsed: [] };
      byUrl.set(proofKey(url), { ...publicRequested(url), ccns: [...ccns].sort(), checked_at: checkedAt, ...publicRedirect(url, response.finalUrl || url),
        http_status: response.status || 0, requested_range: `bytes=0-${CAP - 1}`, bytes_retained: response.body.length,
        sha256: response.body.length ? digest : '', raw_artifact: artifact ? `cms_data/hpt/nationwide-verification/file-byte-proof/${artifact}` : '',
        content_type: response.headers['content-type'] || '', parsed_root_candidates: parsed.parsed || [],
        error: response.error || '' });
    } catch (error) {
      byUrl.set(proofKey(url), { ...publicRequested(url), ccns: [...ccns].sort(), checked_at: checkedAt, http_status: 0,
        requested_range: `bytes=0-${CAP - 1}`, bytes_retained: 0, sha256: '', parsed_root_candidates: [],
        error: String(error.code || error.message || error).slice(0, 200) });
    }
    await atomic(OUT, { version: 1, sample_bytes: CAP, records: [...byUrl.values()].sort((a, b) => (a.url || a.url_sha256).localeCompare(b.url || b.url_sha256)) });
  });
  const records = [...byUrl.values()];
  console.log(JSON.stringify(captureSummary({ nationwide, claims, prior, selected, attempted: completed, records, byUrl }), null, 2));
}

if (require.main === module) main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
module.exports = { captureSummary };
