'use strict';

const crypto = require('crypto');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const {
  hostOf, normalizeName, nameSimilarity, strictSimilarity, pooled, toCSV
} = require('./util');
const { parsePointer, isPlausibleMrfUrl } = require('./parse');
const { probeMrf } = require('./probe');
const { normalizeUrl } = require('../pointer-corpus');

const HEADER_COLUMNS = [
  'mrf_url', 'pointer_domains', 'pointer_location_names', 'pointer_files',
  'source_page_urls', 'mrf_http_status', 'mrf_range_status', 'mrf_file_kind',
  'mrf_license_state', 'mrf_hospital_name', 'mrf_location_name', 'mrf_address',
  'mrf_last_updated', 'mrf_cms_version', 'bytes_read', 'checked_at', 'error'
];

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function splitMrfUrls(entry) {
  return unique([entry && entry.mrfUrl, ...((entry && entry.mrfUrls) || [])]
    .map(normalizeUrl).filter(url => url && isPlausibleMrfUrl(url)));
}

function loadPointerTasks(pointerDir, manifestRows = []) {
  const represented = new Set(manifestRows.map(row =>
    `${normalizeUrl(row.mrf_url)}|${normalizeName(row.location_name)}`));
  const tasks = new Map();
  if (!fs.existsSync(pointerDir)) return [];
  for (const fileName of fs.readdirSync(pointerDir).filter(name => name.endsWith('.txt')).sort()) {
    const domain = fileName.slice(0, -4).toLowerCase();
    const file = path.join(pointerDir, fileName);
    let parsed;
    try { parsed = parsePointer(fs.readFileSync(file, 'utf8')); }
    catch (_error) { continue; }
    for (const entry of parsed.entries || []) {
      const locationName = String(entry.locationName || '').trim();
      for (const mrfUrl of splitMrfUrls(entry)) {
        if (represented.has(`${mrfUrl}|${normalizeName(locationName)}`)) continue;
        if (!tasks.has(mrfUrl)) tasks.set(mrfUrl, { mrfUrl, refs: [] });
        tasks.get(mrfUrl).refs.push({
          domain,
          pointerUrl: `https://${domain}/cms-hpt.txt`,
          locationName,
          sourcePageUrl: entry.sourcePageUrl || '',
          pointerFile: file.replace(/\\/g, '/')
        });
      }
    }
  }
  return [...tasks.values()].map(task => ({
    ...task,
    refs: task.refs.filter((ref, index, rows) => rows.findIndex(other =>
      [other.domain, other.locationName, other.sourcePageUrl].join('|')
      === [ref.domain, ref.locationName, ref.sourcePageUrl].join('|')) === index)
  })).sort((a, b) => a.mrfUrl.localeCompare(b.mrfUrl));
}

function cacheKey(url) {
  return crypto.createHash('sha256').update(String(url)).digest('hex');
}

async function readJson(file, fallback = {}) {
  try { return JSON.parse(await fsp.readFile(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
}

async function writeAtomic(file, value) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp`;
  await fsp.writeFile(temporary, value);
  await fsp.rename(temporary, file);
}

function normalizedZip(value) {
  const match = String(value || '').match(/\b\d{5}/);
  return match ? match[0] : '';
}

function streetNumber(value) {
  const match = String(value || '').match(/\b\d{1,6}[A-Za-z]?\b/);
  return match ? match[0].toLowerCase() : '';
}

function addressTokens(value) {
  return new Set(normalizeName(value).split(' ').filter(token => token.length > 2));
}

function addressAgreement(leftValue, rightValue) {
  const left = addressTokens(leftValue);
  const right = addressTokens(rightValue);
  if (!left.size || !right.size) return false;
  const leftNumber = streetNumber(leftValue);
  const rightNumber = streetNumber(rightValue);
  if (!leftNumber || leftNumber !== rightNumber) return false;
  let common = 0;
  for (const token of left) if (right.has(token)) common++;
  return common >= 2 && common / Math.max(left.size, right.size) >= 0.30;
}

function bestName(names, hospitalName) {
  return unique(names).map(value => ({
    value,
    score: nameSimilarity(value, hospitalName),
    strictScore: strictSimilarity(value, hospitalName)
  })).sort((a, b) => b.score - a.score || b.strictScore - a.strictScore)[0]
    || { value: '', score: 0, strictScore: 0 };
}

function headerRow(task, result) {
  return {
    mrf_url: task.mrfUrl,
    pointer_domains: unique(task.refs.map(ref => ref.domain)).join('|'),
    pointer_location_names: unique(task.refs.map(ref => ref.locationName)).join('|'),
    pointer_files: unique(task.refs.map(ref => ref.pointerFile)).join('|'),
    source_page_urls: unique(task.refs.map(ref => ref.sourcePageUrl)).join('|'),
    mrf_http_status: result && result.httpStatus || '',
    mrf_range_status: result && result.rangeStatus || '',
    mrf_file_kind: result && (result.innerKind || result.fileKind) || '',
    mrf_license_state: result && result.mrfLicenseState || '',
    mrf_hospital_name: result && result.mrfHospitalName || '',
    mrf_location_name: result && result.mrfLocationName || '',
    mrf_address: result && result.mrfAddress || '',
    mrf_last_updated: result && result.declaredLastUpdated || '',
    mrf_cms_version: result && result.cmsVersion || '',
    bytes_read: result && result.bytesRead || result && result.bytes || '',
    checked_at: result && result.checkedAt || '',
    error: result && (result.rangeError || result.headError || result.error) || ''
  };
}

function candidateLeads(tasks, results, jobs) {
  const jobsByState = new Map();
  for (const job of jobs) {
    if (!jobsByState.has(job.state)) jobsByState.set(job.state, []);
    jobsByState.get(job.state).push(job);
  }
  const leads = [];
  for (let index = 0; index < tasks.length; index++) {
    const task = tasks[index];
    const result = results[index] || {};
    if (Number(result.rangeStatus || 0) < 200 || Number(result.rangeStatus || 0) >= 300) continue;
    const jobsInState = jobsByState.get(String(result.mrfLicenseState || '').toUpperCase()) || [];
    if (!jobsInState.length) continue;
    const names = [result.mrfHospitalName, result.mrfLocationName,
      ...task.refs.map(ref => ref.locationName)].filter(Boolean);
    for (const job of jobsInState) {
      const best = bestName(names, job.hospital_name);
      const addressHit = addressAgreement(job.address, result.mrfAddress);
      const rosterZip = normalizedZip(job.zip);
      const headerZip = normalizedZip(result.mrfAddress);
      const zipHit = !!rosterZip && rosterZip === headerZip;
      const eligible = (addressHit && (zipHit || best.score >= 0.15))
        || (zipHit && best.score >= 0.45)
        || (best.score >= 0.75 && best.strictScore >= 0.55);
      if (!eligible) continue;
      for (const ref of task.refs) {
        if (!ref.domain) continue;
        leads.push({
          job,
          domain: ref.domain,
          evidence: {
            source_record_url: ref.pointerFile,
            source_name: unique([ref.locationName, result.mrfHospitalName, result.mrfLocationName]).join('|'),
            source_address: result.mrfAddress || '',
            source_mrf_url: task.mrfUrl,
            name_score: Number(best.score.toFixed(3)),
            strict_name_score: Number(best.strictScore.toFixed(3)),
            address_match: addressHit ? 'yes' : 'no',
            candidate_score: Number(((addressHit ? 55 : 0) + (zipHit ? 25 : 0)
              + best.score * 20 + best.strictScore * 10).toFixed(3))
          },
          mrfUrl: task.mrfUrl
        });
      }
    }
  }
  return leads;
}

async function runInverseDiscovery(options) {
  const tasksAll = loadPointerTasks(options.pointerDir, options.manifestRows || []);
  const tasks = options.limit ? tasksAll.slice(0, Number(options.limit)) : tasksAll;
  const cacheFile = path.resolve(options.cacheFile || path.join(options.stageDir, 'inverse-mrf-cache.json'));
  const cache = await readJson(cacheFile, {});
  let requests = 0;
  let cacheHits = 0;
  let completedSinceSave = 0;
  let saveChain = Promise.resolve();
  const save = () => {
    saveChain = saveChain.then(() => writeAtomic(cacheFile, JSON.stringify(cache, null, 1) + '\n'));
    return saveChain;
  };
  const results = await pooled(tasks, {
    concurrency: Number(options.concurrency || 16),
    keyFn: task => hostOf(task.mrfUrl),
    onProgress: (done, total) => {
      if (done === total || done % 25 === 0) (options.log || console.log)(`Inverse MRF headers ${done}/${total}`);
    }
  }, async task => {
    const key = cacheKey(task.mrfUrl);
    if (!options.refresh && cache[key]) {
      cacheHits++;
      return cache[key];
    }
    requests++;
    let result;
    try {
      result = await (options.probeImpl || probeMrf)(task.mrfUrl, {
        timeoutMs: Number(options.timeoutMs || 45000), useUnblocker: false
      });
    } catch (error) {
      result = { checkedAt: new Date().toISOString(), error: String(error && error.message || error).slice(0, 180) };
    }
    cache[key] = result;
    if (++completedSinceSave % 20 === 0) await save();
    return result;
  });
  await save();
  const headers = tasks.map((task, index) => headerRow(task, results[index]));
  await writeAtomic(path.join(options.stageDir, 'inverse_headers.csv'), toCSV(headers, HEADER_COLUMNS));
  return {
    tasks: tasks.length,
    totalTasks: tasksAll.length,
    requests,
    cacheHits,
    headers,
    leads: candidateLeads(tasks, results, options.jobs || [])
  };
}

module.exports = {
  HEADER_COLUMNS, splitMrfUrls, loadPointerTasks, addressAgreement, bestName,
  headerRow, candidateLeads, runInverseDiscovery
};
