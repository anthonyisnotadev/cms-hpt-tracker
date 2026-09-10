'use strict';
// Resolve the frozen 990-record review cohort using explicit, separate evidence
// dimensions. Network responses stay in ignored staging. This script writes
// reviewed proposals; applying them is a separate deterministic local step.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cheerio = require('cheerio');
const { csvToObjects, toCSV, pooled, hostOf, nameSimilarity } = require('./lib/util');
const { requestCapped, probeMrf } = require('./lib/probe');
const { BROWSER_HEADERS } = require('./lib/fetch');
const { parsePointer, isPlausibleMrfUrl } = require('./lib/parse');
const { matchMrfHeader } = require('./lib/mrf-header-match');
const { metadataStatus } = require('./recheck-interventions');
const ROOT = path.resolve(__dirname, '../..');
const BASE = path.join(ROOT, 'data/hpt-audit');
const PRIOR = path.join(BASE, '.domain-discovery/intervention-recheck-20260909');
const STAGE = path.join(BASE, '.domain-discovery/intervention-resolution-20260909');
const OUT = path.join(BASE, 'rechecks/2026-09-09/resolution');
const hash = text => crypto.createHash('sha256').update(text).digest('hex');
const good = value => Number(value) >= 200 && Number(value) < 300;
const csv = file => csvToObjects(fs.readFileSync(file, 'utf8'));
const official = {
  '010023': { domain: 'www.baptistfirst.org', page: 'https://www.baptistfirst.org/patients-visitors/before-your-visit/get-a-price-estimate' },
  '051300': { domain: 'www.ephc.org', page: 'https://www.ephc.org/price-transparency.php' },
  '110124': { domain: 'wmhweb.com', page: 'https://wmhweb.com/sb-505/', provenance: 'https://dch.georgia.gov/hospital-transparency-information' },
  '140166': { domain: 'www.hshs.org', page: 'https://www.hshs.org/patients/billing/price', provenance: 'https://www.hshs.org/st-marys-decatur/patients-guests/patient-financial-services' }
};
const excluded = new Set(['010023', '051300', '110124', '140166', '100167']);
async function cached(kind, url, worker) {
  const file = path.join(STAGE, `${kind}-${hash(url)}.json`);
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file));
  if (process.argv.includes('--report-only')) throw new Error(`Uncached ${kind}: ${url}`);
  let value;
  try { value = await worker(); } catch (e) { value = { url, checkedAt: new Date().toISOString(), error: e.message || String(e) }; }
  if (/EACCES/.test(value.error || value.rangeError || '')) throw new Error('Local network permission error; stop the run');
  fs.writeFileSync(file, JSON.stringify(value));
  return value;
}
async function document(url) {
  return cached('doc', url, async () => {
    const r = await requestCapped(url, { timeoutMs: 10000, cap: 524288, headers: BROWSER_HEADERS });
    const body = r.body.toString('utf8');
    const html = /<!doctype\s+html|<html\b|<body\b/i.test(body.slice(0, 2000));
    const entries = good(r.status) && !html ? parsePointer(body).entries.filter(e => e.locationName || e.mrfUrl) : [];
    const links = [];
    if (good(r.status) && html) {
      const $ = cheerio.load(body);
      $('a[href]').each((_i, a) => {
        const label = $(a).text().trim().replace(/\s+/g, ' '), href = $(a).attr('href');
        if (!/price|pricing|transparency|standard.?charges|machine.?readable|cms-hpt|chargemaster/i.test(label + ' ' + href)) return;
        try { const link = new URL(href, r.finalUrl).toString(); if (isPlausibleMrfUrl(link)) links.push({ url: link, label }); } catch (_) {}
      });
    }
    return { url, finalUrl: r.finalUrl, status: r.status, checkedAt: new Date().toISOString(), html,
      sha256: hash(r.body), entries: entries.map(e => ({ locationName: e.locationName || '', sourcePageUrl: e.sourcePageUrl || '', mrfUrls: (e.mrfUrls || [e.mrfUrl]).filter(isPlausibleMrfUrl) })), links };
  });
}
const isFileLink = link => /\.(?:csv|json|zip|gz)(?:[?#]|$)|MRFDownload|fileType=|standardcharges|machine-readable|\/charges\/mrf/i.test(link.url);
async function main() {
  fs.mkdirSync(STAGE, { recursive: true }); fs.mkdirSync(OUT, { recursive: true });
  const cohort = JSON.parse(fs.readFileSync(path.join(PRIOR, 'cohort.json')));
  const roster = JSON.parse(fs.readFileSync(path.join(ROOT, 'cms_data/hpt/roster.json')));
  const existing = new Map(csv(path.join(BASE, 'rechecks/2026-09-09/intervention-recheck.csv')).map(r => [r.ccn, r]));
  if (!process.argv.includes('--report-only')) await requestCapped('https://www.cms.gov/', { cap: 512, timeoutMs: 15000 });
  const domains = new Map();
  for (const r of cohort) {
    const d = official[r.ccn]?.domain || r.domain;
    if (!domains.has(d)) domains.set(d, []);
    domains.get(d).push(r);
  }
  const discovered = new Map();
  await pooled([...domains], { concurrency: 16, keyFn: ([d]) => d,
    onProgress: (d,t) => { if (d % 25 === 0 || d === t) console.log(`discovery ${d}/${t}`); }
  }, async ([domain, hospitals]) => {
    const pointerUrls = new Set(hospitals.map(r => official[r.ccn] ? `https://${domain}/cms-hpt.txt` : (r.pointer_url || `https://${domain}/cms-hpt.txt`)));
    const docs = [];
    for (const u of pointerUrls) docs.push(await document(u));
    if (!docs.some(d => d.entries?.some(e => e.mrfUrls.length))) {
      // One canonical alternate location, then follow links from actual pages.
      docs.push(await document(`https://${domain}/.well-known/cms-hpt.txt`));
    }
    const pages = [];
    if (!docs.some(d => d.entries?.some(e => e.mrfUrls.length))) {
      pages.push(await document(`https://${domain}/`));
      const fromHome = pages.flatMap(p => p.links || []).filter(l => !isFileLink(l)).slice(0, 2);
      for (const l of fromHome) pages.push(await document(l.url));
    }
    for (const r of hospitals) if (official[r.ccn]?.page) pages.push(await document(official[r.ccn].page));
    // Follow explicit pointer links found on the pricing pages.
    for (const l of pages.flatMap(p => p.links || []).filter(l => /cms-hpt\.txt/i.test(l.url))) docs.push(await document(l.url));
    discovered.set(domain, { docs, pages });
  });
  if (discovered.size !== domains.size) throw new Error('Incomplete discovery run; resume before reporting');
  const refsByCcn = new Map(), tasks = new Map();
  for (const r of cohort) {
    const domain = official[r.ccn]?.domain || r.domain;
    const discovery = discovered.get(domain);
    const refs = [];
    for (const doc of discovery.docs) for (const entry of doc.entries || []) for (const url of entry.mrfUrls) {
      refs.push({ url, pointerUrl: doc.finalUrl, sourcePageUrl: entry.sourcePageUrl, location_name: entry.locationName,
        pointerCheckedAt: doc.checkedAt, pointerSha256: doc.sha256, score: nameSimilarity(entry.locationName, r.hospital_name) });
    }
    refs.sort((a,b) => b.score - a.score);
    const selected = refs.filter(ref => ref.url === existing.get(r.ccn)?.verified_mrf_url || ref.url === r.mrf_url || ref.score >= 0.65);
    if (!selected.length) selected.push(...refs.slice(0, 3));
    // Page-discovered links are tracked separately; they cannot satisfy the
    // pointer gate even if their file identity and metadata are correct.
    if (!selected.length) for (const page of discovery.pages) {
      for (const l of (page.links || []).filter(isFileLink).slice(0, 4)) selected.push({ url: l.url, sourcePageUrl: page.finalUrl, pointerUrl: '', location_name: l.label, score: 0 });
    }
    if (r.mrf_url && !excluded.has(r.ccn) && !selected.some(ref => ref.url === r.mrf_url)) selected.push({ url: r.mrf_url, pointerUrl: '', sourcePageUrl: '', location_name: '', score: 0 });
    const dedup = [...new Map(selected.map(ref => [ref.url, ref])).values()];
    refsByCcn.set(r.ccn, dedup);
    for (const ref of dedup) tasks.set(ref.url, ref.url);
  }
  console.log(`Selected ${tasks.size} file URLs for refreshed metadata`);
  const probes = new Map();
  await pooled([...tasks.keys()].map((url,i) => ({ url, lane: i % 4 })), { concurrency: 16,
    keyFn: t => `${hostOf(t.url)}:${t.lane}`, onProgress: (d,t) => { if (d % 25 === 0 || d === t) console.log(`metadata ${d}/${t}`); }
  }, async ({ url }) => {
    const p = await cached('mrf-v2', url, async () => {
      const value = await probeMrf(url, { timeoutMs: 10000, useUnblocker: false, headerBytes: 262144 });
      return value;
    });
    probes.set(url, p);
  });
  if (probes.size !== tasks.size) throw new Error('Incomplete file run; resume before reporting');
  const assessments = [], evidence = [], resolutions = [];
  for (const r of cohort) {
    const discovery = discovered.get(official[r.ccn]?.domain || r.domain);
    const files = [];
    for (const ref of refsByCcn.get(r.ccn)) {
      const p = probes.get(ref.url);
      const match = matchMrfHeader({ refs: [ref] }, p, roster);
      const hit = match.matches.find(m => m.hospital.ccn === r.ccn);
      const metadata = metadataStatus({ declared_date: p.declaredLastUpdated, version: p.cmsVersion }, Date.parse(p.checkedAt));
      const file = { ccn: r.ccn, hospital_name: r.hospital_name, ...ref, http_status: p.rangeStatus || '',
        file_kind: p.innerKind || p.fileKind || '', header_name: p.mrfHospitalName || '', header_location: p.mrfLocationName || '',
        header_address: p.mrfAddress || '', header_state: p.mrfLicenseState || '',
        identity: hit ? 'corroborated' : match.reason, identity_basis: hit?.identityBasis || '',
        date: p.declaredLastUpdated || '', version: p.cmsVersion || '', metadata, checked_at: p.checkedAt || '', error: p.rangeError || p.error || '' };
      files.push(file); evidence.push(file);
    }
    const verified = files.filter(f => f.pointerUrl && f.identity === 'corroborated');
    const current = verified.filter(f => f.metadata === 'date-within-365-days-version-3');
    const chosen = current.length === 1 ? current[0] : (verified.length === 1 ? verified[0] : null);
    const pointer = discovery.docs.find(d => d.entries?.some(e => e.mrfUrls.length));
    const home = discovery.pages.find(d => new URL(d.url).pathname === '/');
    const status = current.length === 1 && verified.length === 1 ? 'correction-verified'
      : chosen?.metadata === 'date-over-365-days' ? 'publisher-date-review'
      : chosen?.metadata === 'date-within-365-days-older-version' ? 'publisher-template-review'
      : excluded.has(r.ccn) ? 'identity-quarantined'
      : files.some(f => f.identity === 'corroborated') ? 'metadata-or-pointer-review'
      : files.some(f => good(f.http_status)) ? 'identity-or-format-review'
      : pointer ? 'file-access-review' : 'pointer-or-domain-review';
    assessments.push({ ccn: r.ccn, hospital_name: r.hospital_name, state: r.state, old_finding: r.finding, status,
      website: home ? `HTTP ${home.status || home.error}` : pointer ? 'host returned pointer' : 'not separately verified',
      pointer: pointer ? 'entries retrieved' : 'not retrieved', identity: chosen ? 'corroborated' : 'unresolved',
      file_access: files.some(f => good(f.http_status)) ? 'response received' : 'unresolved',
      metadata: chosen?.metadata || 'unverified', pointer_url: chosen?.pointerUrl || pointer?.finalUrl || '',
      mrf_url: chosen?.url || '', date: chosen?.date || '', version: chosen?.version || '',
      source_page: official[r.ccn]?.page || chosen?.sourcePageUrl || '', checked_at: chosen?.checked_at || discovery.docs[0]?.checkedAt || '' });
    if (status === 'correction-verified') resolutions.push({ ccn: r.ccn, base: r, action: 'replace', evidence: chosen,
      finding: 'compliant-observed', note: 'Refreshed official pointer and file header agree on facility identity, location, current date and template version 3.' });
    else if (excluded.has(r.ccn)) resolutions.push({ ccn: r.ccn, base: r, action: 'quarantine', evidence: chosen || null,
      finding: 'not-assessed-not-named-in-file', note: 'The previous file assignment conflicts with hospital identity. Its URL and metadata are excluded from the current view pending a corroborated replacement.', official: official[r.ccn] || null });
  }
  const write = (name, rows) => fs.writeFileSync(path.join(OUT, name), toCSV(rows, Object.keys(rows[0] || {})));
  write('assessments.csv', assessments); write('file-evidence.csv', evidence);
  write('publisher-review.csv', assessments.filter(r => /^publisher-/.test(r.status)));
  fs.writeFileSync(path.join(OUT, 'resolutions.json'), JSON.stringify(resolutions, null, 2));
  const counts = assessments.reduce((o,r) => (o[r.status] = (o[r.status] || 0) + 1, o), {});
  fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify({ hospitals: cohort.length, domains: domains.size, files: tasks.size, counts }, null, 2));
  console.log(JSON.stringify(counts));
}
if (require.main === module) main().catch(e => { console.error(e); process.exitCode = 1; });
