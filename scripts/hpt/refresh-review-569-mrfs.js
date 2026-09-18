'use strict';

const fs = require('fs');
const path = require('path');
const { retrieve, parsePayload, sha } = require('./lib/recovery-transport');

const ROOT = path.resolve(__dirname, '..', '..');
const BASE = path.join(ROOT, 'data', 'hpt-audit');
const STAGE = path.join(BASE, '.domain-discovery', 'review-569');
const OUT = path.join(STAGE, 'deep-mrf');
const ARTIFACTS = path.join(OUT, 'artifacts');
const FULL_JSON_CAP = 40 * 1048576;
const FULL_JSON_CCNS = new Set(['050030', '340143']);
fs.mkdirSync(ARTIFACTS, { recursive: true });

const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const sufficient = row => row.declaredLastUpdated && row.cmsVersion && row.mrfHospitalName && row.mrfAddress && row.mrfLicenseState;

function sanitizedAttempt(attempt) {
  return { method: attempt.method, transport: attempt.via, requested_url: attempt.url,
    final_url: attempt.finalUrl, checked_at: attempt.checkedAt, http_status: attempt.status,
    error: attempt.error || '', bytes: attempt.bytes, sha256: attempt.sha256,
    redirects: attempt.redirects || [] };
}

async function inspect(job) {
  const output = path.join(OUT, `${job.ccn}.json`);
  const existing = fs.existsSync(output) ? read(output) : null;
  const observations = existing?.observations || [];
  const hasSufficient = observations.some(observation => observation.candidates?.some(sufficient));
  const hasFullJsonAttempt = observations.some(observation => observation.cap === FULL_JSON_CAP);
  if (hasSufficient || (existing && (!FULL_JSON_CCNS.has(job.ccn) || hasFullJsonAttempt))) return existing;
  const caps = existing ? [FULL_JSON_CAP] : [4 * 1048576, 26 * 1048576];
  for (const cap of caps) {
    const response = await retrieve(job.url, cap, { timeoutMs: 45000 });
    let artifact = '';
    if (response.body.length) {
      artifact = path.join('deep-mrf', 'artifacts', `${response.sha256}.bin`).replace(/\\/g, '/');
      const absolute = path.join(STAGE, artifact);
      if (!fs.existsSync(absolute)) fs.writeFileSync(absolute, response.body);
    }
    const parsed = response.status >= 200 && response.status < 300
      ? await parsePayload(response.body, response.headers?.['content-type'] || '', cap)
      : { parsed: [], inflatedBytes: 0, archive: false };
    observations.push({ cap, checked_at: response.checkedAt, requested_url: job.url,
      final_url: response.finalUrl || job.url, http_status: response.status, error: response.error || '',
      body_bytes: response.body.length, body_sha256: response.sha256, artifact,
      attempts: response.attempts.map(sanitizedAttempt), inflated_bytes: parsed.inflatedBytes,
      archive: parsed.archive, candidates: parsed.parsed });
    if (parsed.parsed.some(sufficient) || response.status < 200 || response.status >= 300 || response.body.length < cap) break;
  }
  const result = { ccn: job.ccn, mrf_url: job.url, observations };
  fs.writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
  return result;
}

async function main() {
  const discovery = read(path.join(BASE, 'discovery-review.json'));
  const jobs = discovery.records.filter(record => ['mrf-verification-pending', 'mrf-request-failed'].includes(record.disposition)).flatMap(record => {
    const mrf = read(path.join(STAGE, 'mrf', `${record.ccn}.json`));
    const prefix = mrf.file_attempt?.body_prefix || '';
    const incomplete = !/last_updated_on/i.test(prefix.slice(0, 1048576)) || !/hospital_address|license_information|license_number/i.test(prefix.slice(0, 1048576));
    return (record.disposition === 'mrf-request-failed' || incomplete) && mrf.entry?.mrf_url
      ? [{ ccn: record.ccn, url: mrf.entry.mrf_url }] : [];
  });
  let cursor = 0, completed = 0;
  async function worker() {
    while (cursor < jobs.length) {
      const job = jobs[cursor++];
      const result = await inspect(job);
      completed++;
      console.log(`${completed}/${jobs.length} ${job.ccn} ${result.observations.at(-1)?.http_status || 0}`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(2, jobs.length) }, worker));
  console.log(JSON.stringify({ jobs: jobs.length, completed }, null, 2));
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });

module.exports = { inspect, sufficient };
