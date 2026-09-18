'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..', '..');
const AUDIT = path.join(ROOT, 'data', 'hpt-audit');
const PRIVATE = path.join(ROOT, 'cms_data', 'hpt', 'nationwide-verification');

function group(records, keyFn) {
  const by = new Map();
  for (const record of records) {
    const key = keyFn(record);
    if (!key) continue;
    if (!by.has(key)) by.set(key, { target: key, ccns: [], hospitals: [], dispositions: new Set() });
    const item = by.get(key);
    item.ccns.push(record.ccn);
    item.hospitals.push(`${record.hospital_name} (${record.city}, ${record.state})`);
    item.dispositions.add(record.disposition);
  }
  return [...by.values()].map(item => ({ ...item, ccns: [...new Set(item.ccns)].sort(),
    hospitals: [...new Set(item.hospitals)].sort(), dispositions: [...item.dispositions].sort(), status: 'pending' }));
}

function buildQueues(nationwide, discoveryRecords = [], searchReviewRecords = [], browserRecords = [], reviewedExclusions = []) {
  // A later applied resolution closes the older probe as an active work item.
  // Keep that probe in nationwide history, but never requeue its obsolete URL.
  const current = nationwide.records.filter(record => !record.latest_observation_superseded);
  const discovery = new Map(discoveryRecords.map(record => [record.ccn, record]));
  const searchReviews = new Map(searchReviewRecords.map(record => [record.ccn, record]));
  const searchLabels = new Set(['official-website-search-pending', 'candidate-website-identity-unverified', 'official-website-not-identified-completed-search']);
  const search = current.filter(record => searchLabels.has(record.disposition)).map(record => {
    const prior = discovery.get(record.ccn);
    const reviewed = searchReviews.get(record.ccn);
    const completed = record.disposition === 'official-website-not-identified-completed-search'
      || reviewed?.status === 'completed-no-official'
      || prior?.disposition === 'search-completed-no-official';
    return { ccn: record.ccn, hospital_name: record.hospital_name, city: record.city, state: record.state,
      prior_search_disposition: prior?.disposition || '', prior_search_reason: prior?.reason || '',
      status: completed ? 'completed-no-supported-official-site' : 'pending',
      next_query: `\"${record.hospital_name}\" ${record.city} ${record.state} official hospital` };
  });
  const pointerLabels = new Set(['pointer-access-denied-to-client', 'pointer-discovery-incomplete', 'pointer-facility-match-unresolved']);
  const browserByTarget = new Map(browserRecords.map(record => [record.kind + ':' + record.target, record]));
  const markObserved = (items, kind) => items.map(item => {
    const observation = browserByTarget.get(`${kind}:${item.target}`);
    return observation ? { ...item, status: `browser-observed-${observation.status}`, observed_at: observation.observed_at } : item;
  });
  const pointer = markObserved(group(current.filter(record => pointerLabels.has(record.disposition)), record =>
    record.pointer_url || (record.official_domain ? `https://${record.official_domain}/cms-hpt.txt` : '')), 'pointer');
  const mrf = markObserved(group(current.filter(record => record.disposition === 'mrf-request-unsuccessful'), record => record.mrf_url), 'mrf')
    .map(item => {
      if (item.status !== 'pending') return item;
      const targetHash = crypto.createHash('sha256').update(item.target).digest('hex');
      const covered = item.ccns.map(ccn => reviewedExclusions.find(record => record.ccn === ccn
        && record.current_pointer_mrf_url_sha256 === targetHash
        && record.browser_result === 'ERR_BLOCKED_BY_CLIENT'
        && record.browser_bytes_retained === 0 && record.browser_attempt_at));
      return covered.length && covered.every(Boolean)
        ? { ...item, status: 'browser-observed-client-blocked', observed_at: covered.map(row => row.browser_attempt_at).sort().at(-1),
          observation_source: 'reviewed-file-attribution-exclusions' }
        : item;
    });
  return { search, pointer, mrf };
}

function main() {
  const nationwide = JSON.parse(fs.readFileSync(path.join(AUDIT, 'nationwide-verification.json'), 'utf8'));
  const discoveryFile = path.join(AUDIT, 'discovery-review.json');
  const discovery = fs.existsSync(discoveryFile) ? JSON.parse(fs.readFileSync(discoveryFile, 'utf8')).records || [] : [];
  const searchReviewFile = path.join(AUDIT, 'nationwide-search-reviews.json');
  const searchReviews = fs.existsSync(searchReviewFile) ? JSON.parse(fs.readFileSync(searchReviewFile, 'utf8')).records || [] : [];
  const browserFile = path.join(AUDIT, 'nationwide-browser-reviews.json');
  const browserRecords = fs.existsSync(browserFile) ? JSON.parse(fs.readFileSync(browserFile, 'utf8')).records || [] : [];
  const exclusions = JSON.parse(fs.readFileSync(path.join(AUDIT, 'reviewed-file-attribution-exclusions.json'), 'utf8')).records;
  const queues = buildQueues(nationwide, discovery, searchReviews, browserRecords, exclusions);
  fs.mkdirSync(PRIVATE, { recursive: true });
  for (const [name, records] of Object.entries(queues)) fs.writeFileSync(path.join(PRIVATE, `${name}-queue.json`), JSON.stringify(records, null, 2) + '\n');
  const summary = {
    generated_at: nationwide.summary.generated_at,
    search_hospitals: queues.search.length,
    search_already_completed: queues.search.filter(row => row.status !== 'pending').length,
    search_pending: queues.search.filter(row => row.status === 'pending').length,
    pointer_browser_targets: queues.pointer.length,
    pointer_browser_pending: queues.pointer.filter(row => row.status === 'pending').length,
    pointer_browser_hospitals: queues.pointer.reduce((sum, row) => sum + row.ccns.length, 0),
    mrf_browser_targets: queues.mrf.length,
    mrf_browser_pending: queues.mrf.filter(row => row.status === 'pending').length,
    mrf_browser_hospitals: queues.mrf.reduce((sum, row) => sum + row.ccns.length, 0)
  };
  fs.writeFileSync(path.join(PRIVATE, 'queue-summary.json'), JSON.stringify(summary, null, 2) + '\n');
  console.log(JSON.stringify(summary, null, 2));
}

if (require.main === module) main();
module.exports = { group, buildQueues };
