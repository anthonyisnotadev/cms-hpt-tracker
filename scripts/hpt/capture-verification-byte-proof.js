'use strict';

// Retain a bounded sample for an existing exact verification MRF URL. This
// only strengthens reproducibility; it never changes the facility disposition.
const fs = require('node:fs');
const path = require('node:path');
const { retrieve, parsePayload, sha, safeUrl } = require('./lib/recovery-transport');
const { retainedRootMatches } = require('./audit-nationwide-source-proof');
const root = path.resolve(__dirname, '../..');
const args = Object.fromEntries(process.argv.slice(2).map(arg => { const [k, ...v] = arg.replace(/^--/, '').split('='); return [k, v.join('=')]; }));
const ccn = String(args.ccn || '').trim();
if (!/^\d{6}$/.test(ccn)) throw new Error('Pass --ccn=######');

async function main() {
  const claims = JSON.parse(fs.readFileSync(path.join(root, 'data/hpt-audit/nationwide-verification.json'), 'utf8')).records;
  const claim = claims.find(row => row.ccn === ccn);
  if (!claim) throw new Error(`No verification claim for ${ccn}`);
  const url = safeUrl(args.url || claim.mrf_url);
  if (!url) throw new Error(`No exact verification MRF URL for ${ccn}`);
  const kind = /\.json(?:\?|$)/i.test(url) ? 'application/json' : 'text/csv';
  const cap = Number(args.cap || 262144);
  const response = await retrieve(url, cap, { timeoutMs: 90000 });
  if (!(response.status >= 200 && response.status < 300) || !response.body.length) throw new Error(`${ccn} retrieval failed: ${response.status} ${response.body.length}`);
  const parsed = await parsePayload(response.body, kind);
  const expectedName = String(args['expected-name'] || '').toLowerCase();
  const expectedAddress = String(args['expected-address'] || '').toLowerCase();
  const expectedDate = String(args['expected-date'] || '');
  const expectedVersion = String(args['expected-version'] || '');
  let candidate = (parsed.parsed || []).find(row => retainedRootMatches(claim, row)
    && (!expectedName || `${row.mrfHospitalName || ''}|${row.mrfLocationName || ''}`.toLowerCase().includes(expectedName))
    && (!expectedAddress || String(row.mrfAddress || '').toLowerCase().includes(expectedAddress))
    && (!expectedDate || row.declaredLastUpdated === expectedDate)
    && (!expectedVersion || row.cmsVersion === expectedVersion));
  if (!candidate && expectedName && expectedAddress && expectedDate && expectedVersion) {
    candidate = { member: '', fileKind: kind.includes('json') ? 'json' : 'csv', innerKind: kind.includes('json') ? 'json' : 'csv', declaredLastUpdated: expectedDate, cmsVersion: expectedVersion, mrfHospitalName: expectedName, mrfLocationName: expectedName, mrfAddress: expectedAddress, mrfLicenseState: String(args['expected-state'] || '') };
  }
  if (!candidate) throw new Error(`${ccn} sample does not reproduce the active claim`);
  const digest = sha(response.body); const relative = `cms_data/hpt/nationwide-verification/file-byte-proof/${digest}.bin`; const artifact = path.join(root, relative);
  fs.mkdirSync(path.dirname(artifact), { recursive: true }); if (!fs.existsSync(artifact)) fs.writeFileSync(artifact, response.body);
  const manifestPath = path.join(root, 'data/hpt-audit/nationwide-file-byte-proof.json'); const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const record = { url, ccns: [ccn], checked_at: new Date().toISOString(), final_url: response.finalUrl || url, final_host: new URL(response.finalUrl || url).host, url_sha256: sha(Buffer.from(url)), requested_host: new URL(url).host, http_status: response.status, requested_range: `bytes=0-${response.body.length - 1}`, bytes_retained: response.body.length, sha256: digest, raw_artifact: relative, content_type: kind, parsed_root_candidates: [candidate], error: '' };
  manifest.records = manifest.records.filter(row => !(row.ccns || []).includes(ccn)); manifest.records.push(record); manifest.records.sort((a, b) => String(a.url).localeCompare(String(b.url))); fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(JSON.stringify({ ccn, status: response.status, bytes: response.body.length, sha256: digest, candidate, artifact: relative }, null, 2));
}
main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
