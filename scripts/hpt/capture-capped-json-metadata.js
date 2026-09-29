'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const ccn = process.argv[2];
const maxBytes = Number(process.argv[3] || 25_000_000);
if (!/^\d{6}$/.test(ccn || '') || !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 100_000_000) {
  throw new Error('Usage: node scripts/hpt/capture-capped-json-metadata.js CCN [maxBytes <= 100000000]');
}
const queue = JSON.parse(fs.readFileSync(path.join(root, 'data/hpt-audit/retained-identity-review-queue.json')));
const record = queue.records.find(row => row.ccn === ccn);
if (!record || record.priority !== '4-metadata-not-observed-in-sample') throw new Error('CCN is not in the sample-limited identity queue');
const nationwide = JSON.parse(fs.readFileSync(path.join(root, 'data/hpt-audit/nationwide-verification.json')));
const row = nationwide.records.find(item => item.ccn === ccn);
const url = row?.standing_mrf_url;
// URL serialization encodes Unicode path characters (for example Manatí)
// without changing the target. Compare canonical URLs, not raw spellings.
if (!url || !row.mrf_url || new URL(url).href !== new URL(row.mrf_url).href
    || new URL(url).protocol !== 'https:') throw new Error('Standing and observed MRF URL must match and use HTTPS');

async function run() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), maxBytes > 50_000_000 ? 120_000 : 60_000);
  let response;
  let bytes = 0;
  try {
    response = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': 'cms-hpt-tracker/metadata-review' } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const length = Number(response.headers.get('content-length') || 0);
    if (length > maxBytes) throw new Error(`Content-Length ${length} exceeds cap ${maxBytes}`);
    const chunks = [];
    const hash = crypto.createHash('sha256');
    for await (const chunk of response.body) {
      bytes += chunk.length;
      if (bytes > maxBytes) {
        controller.abort();
        throw new Error(`Stream exceeded byte cap ${maxBytes}`);
      }
      chunks.push(chunk);
      hash.update(chunk);
    }
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const fields = {
      hospital_name: parsed.hospital_name || '',
      location_name: parsed.location_name || '',
      hospital_address: parsed.hospital_address || '',
      license_state: parsed.license_information?.state || '',
      last_updated_on: parsed.last_updated_on || '',
      version: parsed.version || '',
      charge_count: Array.isArray(parsed.standard_charge_information) ? parsed.standard_charge_information.length : null,
    };
    console.log(JSON.stringify({ ccn, url, observed_at: new Date().toISOString(), http_status: response.status, bytes, file_sha256: hash.digest('hex'), fields }, null, 2));
  } catch (error) {
    console.log(JSON.stringify({ ccn, url, observed_at: new Date().toISOString(), http_status: response?.status || 0, bytes, cap_bytes: maxBytes, error: error.message }, null, 2));
    process.exitCode = 1;
  } finally {
    clearTimeout(timeout);
    controller.abort();
  }
}

run();
