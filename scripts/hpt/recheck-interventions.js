'use strict';

// Independent, resumable verification of a frozen intervention cohort.
// Parsed responses stay in ignored staging; no audit findings are auto-promoted.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { csvToObjects, toCSV, pooled, hostOf, nameSimilarity } = require('./lib/util');
const { requestCapped, probeMrf, sniffKind, extractDeclared, toISODate } = require('./lib/probe');
const { BROWSER_HEADERS } = require('./lib/fetch');
const { parsePointer, isPlausibleMrfUrl } = require('./lib/parse');
const { matchMrfHeader } = require('./lib/mrf-header-match');
const ROOT = path.resolve(__dirname, '../..');
const STAGE = path.join(ROOT, 'data/hpt-audit/.domain-discovery/intervention-recheck-20260909');
const OUT = path.join(ROOT, 'data/hpt-audit/rechecks/2026-09-09');
const readCsv = file => csvToObjects(fs.readFileSync(file, 'utf8'));
const good = status => status >= 200 && status < 300;
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const cacheFile = (kind, url) => path.join(STAGE, `live-${kind}-${hash(url)}.json`);
async function cached(kind, url, worker) {
  const file = cacheFile(kind, url);
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file));
  if (process.argv.includes('--report-only')) throw new Error(`Missing cached evidence for ${url}`);
  let result;
  try { result = await worker(); } catch (e) { result = { url, checkedAt: new Date().toISOString(), error: e.message }; }
  fs.writeFileSync(file, JSON.stringify(result));
  return result;
}
async function pointer(url) {
  return cached('pointer', url, async () => {
    const r = await requestCapped(url, { cap: 262144, timeoutMs: 15000, headers: BROWSER_HEADERS });
    const body = r.body.toString('utf8');
    const html = /<!doctype\s+html|<html[\s>]|<body[\s>]/i.test(body.slice(0, 2000));
    const parsed = good(r.status) && !html ? parsePointer(body) : { entries: [] };
    return { url, checkedAt: new Date().toISOString(), finalUrl: r.finalUrl, status: r.status,
      html, bodySha256: hash(r.body), capped: r.body.length >= 262144,
      entries: parsed.entries.map(e => ({ locationName: e.locationName || '', mrfUrls: (e.mrfUrls || [e.mrfUrl]).filter(isPlausibleMrfUrl) })) };
  });
}
async function mrf(url) {
  return cached('mrf', url, async () => {
    const result = await probeMrf(url, { timeoutMs: 15000, useUnblocker: false });
    // A small header probe can miss metadata. Try a bounded wider GET before
    // reporting an unreadable date; this is still not full schema validation.
    if (good(result.rangeStatus) && !result.declaredLastUpdated) {
      try {
        const r = await requestCapped(url, { cap: 1048576, timeoutMs: 20000, headers: BROWSER_HEADERS });
        result.wideStatus = r.status;
        if (good(r.status)) {
          const kind = sniffKind(r.body, r.headers['content-type']);
          result.wideKind = kind;
          result.wideSha256 = hash(r.body);
          result.html = /<!doctype\s+html|<html[\s>]|<body[\s>]/i.test(r.body.toString('utf8', 0, 2000));
          const meta = extractDeclared(r.body, kind);
          if (meta.raw) {
            result.declaredRaw = meta.raw;
            result.declaredLastUpdated = toISODate(meta.raw);
            result.cmsVersion = meta.version;
            result.mrfHospitalName = meta.hospitalName;
            result.mrfLocationName = meta.locationName;
            result.mrfAddress = meta.address;
            result.mrfLicenseState = meta.licenseState;
            result.recoveredByWiderRead = true;
          }
        }
      } catch (e) { result.wideError = e.message; }
    }
    return result;
  });
}
async function main() {
  // Fail closed if this process cannot make outbound HTTPS requests. Local
  // sandbox errors must never be recorded as hospital failures.
  if (!process.argv.includes('--report-only')) {
    const control = await requestCapped('https://www.cms.gov/', { cap: 1024, timeoutMs: 15000 });
    if (!control.status) throw new Error('Network control returned no HTTP response');
  }
  fs.mkdirSync(STAGE, { recursive: true });
  fs.mkdirSync(OUT, { recursive: true });
  const cohortFile = path.join(STAGE, 'cohort.json');
  let cohort;
  if (fs.existsSync(cohortFile)) cohort = JSON.parse(fs.readFileSync(cohortFile));
  else {
    const interventions = new Map(readCsv(path.join(ROOT, 'data/hpt-audit/interventions.csv')).map(r => [r.ccn, r]));
    cohort = readCsv(path.join(ROOT, 'data/hpt-audit/compliance.csv'))
      .filter(r => !['none', 'exempt-federal', 'domain-unknown'].includes(interventions.get(r.ccn)?.intervention))
      .map(r => ({ ...r, old_intervention: interventions.get(r.ccn).intervention }));
    fs.writeFileSync(cohortFile, JSON.stringify(cohort));
  }
  const roster = JSON.parse(fs.readFileSync(path.join(ROOT, 'cms_data/hpt/roster.json')));
  const rosterByCcn = new Map(roster.map(h => [h.ccn, h]));
  const pointers = new Map();
  const pointerUrl = row => row.pointer_url || `https://${row.domain}/cms-hpt.txt`;
  const urls = [...new Set(cohort.map(pointerUrl))];
  console.log(`Frozen cohort: ${cohort.length} hospitals; ${urls.length} pointer URLs`);
  await pooled(urls, { concurrency: 16, keyFn: hostOf, onProgress: (d,t) => { if (d % 25 === 0 || d === t) console.log(`pointers ${d}/${t}`); } }, async url => {
    const attempts = [await pointer(url)];
    if (!attempts[0].entries?.some(e => e.mrfUrls.length)) {
      const alt = new URL(url);
      alt.hostname = alt.hostname.startsWith('www.') ? alt.hostname.slice(4) : `www.${alt.hostname}`;
      if (alt.pathname === '/cms-hpt.txt') attempts.push(await pointer(alt.toString()));
    }
    pointers.set(url, attempts);
  });
  if (process.argv.includes('--homepages-only')) {
    const homes = [...new Set(urls.filter(url => !(pointers.get(url) || []).some(p => p.entries?.some(e => e.mrfUrls.length)))
      .map(url => new URL(url).origin + '/'))];
    await pooled(homes, { concurrency: 16, keyFn: hostOf, onProgress: (d,t) => { if (d % 25 === 0 || d === t) console.log(`homepages ${d}/${t}`); } }, pointer);
    return;
  }
  const candidates = new Map();
  for (const row of cohort) {
    const refs = [];
    for (const p of pointers.get(pointerUrl(row)) || []) {
      for (const e of p.entries || []) {
        // Include every entry for unresolved identity, plus plausible entries
        // for existing matches. Header identity remains a separate gate.
        if (row.finding === 'not-assessed-not-named-in-file' || nameSimilarity(e.locationName, row.hospital_name) >= 0.45 || p.entries.length === 1) {
          for (const url of e.mrfUrls) refs.push({ url, pointer: p.finalUrl, location_name: e.locationName });
        }
        if (e.mrfUrls.includes(row.mrf_url)) refs.push({ url: row.mrf_url, pointer: p.finalUrl, location_name: e.locationName });
      }
    }
    if (row.mrf_url && !refs.some(r => r.url === row.mrf_url)) refs.push({ url: row.mrf_url, pointer: '', location_name: '' });
    candidates.set(row.ccn, [...new Map(refs.map(r => [r.url, r])).values()]);
  }
  const mrfUrls = [...new Set([...candidates.values()].flat().map(r => r.url))];
  if (process.argv.includes('--plan-only')) {
    fs.writeFileSync(path.join(STAGE, 'mrf-tasks.json'), JSON.stringify(mrfUrls));
    return;
  }
  const probes = new Map();
  console.log(`MRF URLs to check: ${mrfUrls.length}`);
  // At most four requests in flight per host, matching the corpus probe's
  // existing per-host budget. Cached results are reused on resume.
  await pooled(mrfUrls.map((url, i) => ({ url, lane: i % 4 })), {
    concurrency: 16, keyFn: task => `${hostOf(task.url)}:${task.lane}`,
    onProgress: (d,t) => { if (d % 25 === 0 || d === t) console.log(`MRFs ${d}/${t}`); }
  }, async ({ url }) => probes.set(url, await mrf(url)));
  if (pointers.size !== urls.length || probes.size !== mrfUrls.length) throw new Error('Incomplete recheck: at least one URL has no recorded result');
  const details = [], rows = [];
  for (const row of cohort) {
    const ps = pointers.get(pointerUrl(row)) || [];
    const homeFile = cacheFile('pointer', new URL(pointerUrl(row)).origin + '/');
    const home = fs.existsSync(homeFile) ? JSON.parse(fs.readFileSync(homeFile)) : null;
    const checked = [];
    for (const ref of candidates.get(row.ccn)) {
      const p = probes.get(ref.url) || {};
      const identity = matchMrfHeader({ refs: [ref] }, p, roster);
      const matched = identity.matches.some(m => (m.ccn || m.hospital?.ccn) === row.ccn);
      const item = { ccn: row.ccn, hospital_name: row.hospital_name, old_intervention: row.old_intervention,
        roster_state: row.state, roster_city: row.city, roster_address: rosterByCcn.get(row.ccn)?.address || '',
        pointer_url: ref.pointer, mrf_url: ref.url, http_status: p.rangeStatus || '',
        declared_date: p.declaredLastUpdated || '', version: p.cmsVersion || '',
        header_hospital: p.mrfHospitalName || '', header_state: p.mrfLicenseState || '',
        header_address: p.mrfAddress || '', header_location: p.mrfLocationName || '',
        identity: matched ? 'matched' : (identity.matches.length ? 'header-matches-other-roster-hospital' : identity.reason),
        header_matched_ccns: identity.matches.map(m => m.hospital.ccn).join('|'),
        checked_at: p.checkedAt || '',
        wider_read_recovered: p.recoveredByWiderRead ? 'yes' : '',
        error: p.rangeError || p.error || '', html: p.html ? 'yes' : '' };
      details.push(item); checked.push(item);
    }
    const corroborated = checked.filter(p => p.pointer_url && p.identity === 'matched' && p.declared_date);
    const verified = corroborated.find(p => p.mrf_url === row.mrf_url) || corroborated[0];
    const old = checked.find(p => p.mrf_url === row.mrf_url);
    let result = 'review-required';
    if (verified) result = 'pointer-and-identity-verified';
    else if (checked.some(p => good(Number(p.http_status)))) result = 'mrf-reachable-review-required';
    else if (ps.some(p => p.entries?.some(e => e.mrfUrls.length))) result = 'pointer-readable-review-required';
    else result = 'access-or-discovery-unresolved';
    rows.push({ ccn: row.ccn, hospital_name: row.hospital_name, state: row.state,
      old_intervention: row.old_intervention, old_finding: row.finding, result,
      corroborated_files: corroborated.length,
      pointer_attempts: ps.map(p => `${p.url} [${p.status || p.error || 'no response'}]`).join(' | '),
      pointer_entries: Math.max(0, ...ps.map(p => p.entries?.length || 0)),
      homepage_url: home?.url || '', homepage_status: home?.status || '', homepage_error: home?.error || '',
      candidates_checked: checked.length, prior_mrf_status: old?.http_status || '',
      verified_mrf_url: verified?.mrf_url || '', fresh_date: (verified || old)?.declared_date || '',
      verified_pointer_url: verified?.pointer_url || '',
      fresh_metadata: metadataStatus(verified || old),
      fresh_version: (verified || old)?.version || '', old_date: row.mrf_last_updated,
      old_version: row.cms_template_version, checked_at: new Date().toISOString() });
  }
  fs.writeFileSync(path.join(OUT, 'intervention-recheck.csv'), toCSV(rows, Object.keys(rows[0])));
  fs.writeFileSync(path.join(OUT, 'intervention-mrf-evidence.csv'), toCSV(details, Object.keys(details[0] || {})));
  const counts = rows.reduce((o,r) => (o[r.result] = (o[r.result] || 0) + 1, o), {});
  fs.writeFileSync(path.join(OUT, 'intervention-summary.json'), JSON.stringify({ checkedAt: new Date().toISOString(), hospitals: cohort.length, pointerUrls: urls.length, mrfUrls: mrfUrls.length, counts, note: 'Automated bounded recheck, not full-file validation or a browser adjudication. Original findings retained; parsed resumable evidence is in ignored staging.' }, null, 2));
  console.log(JSON.stringify(counts));
}
if (require.main === module) main().catch(e => { console.error(e); process.exitCode = 1; });

function metadataStatus(file, now = Date.now()) {
  if (!file?.declared_date) return 'date-unverified';
  const timestamp = Date.parse(file.declared_date + 'T00:00:00Z');
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== file.declared_date) return 'date-invalid';
  const days = Math.floor((now - timestamp) / 86400000);
  if (days < 0) return 'future-date-review';
  if (days > 365) return 'date-over-365-days';
  if (/^3(?:\.|$)/.test(file.version || '')) return 'date-within-365-days-version-3';
  if (/^[12](?:\.|$)/.test(file.version || '')) return 'date-within-365-days-older-version';
  return 'date-within-365-days-version-unverified';
}
module.exports = { metadataStatus };
