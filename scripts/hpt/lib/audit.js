'use strict';
/**
 * Self-consistency audit of the pipeline's outputs.
 *
 * Every check asks one question: does a row assert something its own fields
 * refute? That is detectable mechanically, needs no domain knowledge, and is
 * how the real bugs here were found - a hospital reported as having no domain
 * while holding a pointer URL, rows called compliant with no file link, a
 * stale flag disagreeing with its own day count.
 *
 * Exits non-zero when anything contradicts, so it works in CI.
 */
const fs = require('fs');
const path = require('path');
const { csvToObjects } = require('./util.js');

const DATA_DIR = path.join(__dirname, '..', '..', '..', 'cms_data', 'hpt');

/**
 * Load the outputs. Returns null with an explanation rather than throwing: on
 * a fresh checkout there is simply nothing to audit yet, and a bare ENOENT
 * reads like a broken install.
 */
function load() {
  const at = f => path.join(DATA_DIR, f);
  const required = ['compliance.csv', 'manifest.json', 'pointers.json', 'roster.json'];
  const missing = required.filter(f => !fs.existsSync(at(f)));
  if (missing.length) {
    console.error(`Nothing to audit yet - missing ${missing.join(', ')} in ${DATA_DIR}.`);
    console.error('Run the pipeline first, e.g.  node scripts/hpt/run.js seed && ... && compliance');
    return null;
  }
  const readJson = f => JSON.parse(fs.readFileSync(at(f), 'utf8'));
  let dates = {};
  try { dates = readJson('mrf_dates.json'); } catch (_e) { /* optional */ }
  return {
    comp: csvToObjects(fs.readFileSync(at('compliance.csv'), 'utf8')),
    man: readJson('manifest.json'),
    pt: readJson('pointers.json'),
    roster: readJson('roster.json'),
    dates
  };
}

/** Labels that claim nothing was found; holding a URL contradicts them. */
const DENIES_EVIDENCE = new Set([
  'not-assessed-domain-unknown',
  'not-assessed-site-unreachable'
]);

function buildChecks({ comp, man, pt, roster }) {
  const manBy = new Map(man.map(r => [r.ccn, r]));
  const rosterCcn = new Set(roster.map(h => h.ccn));
  const checks = [];
  const add = (name, rows, why) => checks.push({ name, n: rows.length, why, sample: rows.slice(0, 3) });

  // Not every unassessable row holding a URL is wrong: "not-named-in-file"
  // openly says a file was fetched that does not mention this hospital, which
  // is an honest description of real evidence. Only flag labels that deny it.
  add('label denies evidence the row actually has',
    comp.filter(r => DENIES_EVIDENCE.has(r.finding) && (r.pointer_url || r.mrf_url)),
    'the UI would show FILE/PTR buttons while the status says nothing was found');

  add('marked compliant but no MRF URL',
    comp.filter(r => r.finding === 'compliant-observed' && !r.mrf_url),
    'cannot call a hospital compliant with no price-file link');

  add('marked compliant but no last-updated date',
    comp.filter(r => r.finding === 'compliant-observed' && !r.mrf_last_updated),
    'that is compliant-date-unverified, a weaker claim');

  add('marked "publishes no cms-hpt.txt" but a pointer file is cached for its domain',
    comp.filter(r => r.finding === 'no-cms-hpt-txt-published' && r.domain && pt[r.domain] && pt[r.domain].ok),
    'we hold a working pointer file for the very domain we say has none');

  add('marked site-unreachable but its domain served a pointer file',
    comp.filter(r => r.finding === 'not-assessed-site-unreachable' && r.domain && pt[r.domain] && pt[r.domain].ok),
    'we reached the site well enough to fetch its file');

  add('marked pointer-blocked but a pointer file is cached for its domain',
    comp.filter(r => r.finding === 'pointer-blocked-to-automation' && r.domain && pt[r.domain] && pt[r.domain].ok),
    'blocked and fetched cannot both be true');

  add('in manifest but compliance shows no domain',
    comp.filter(r => manBy.has(r.ccn) && !r.domain),
    'the manifest concluded a domain; compliance lost it');

  add('in manifest but compliance dropped its MRF URL',
    comp.filter(r => { const m = manBy.get(r.ccn); return m && m.mrf_url && !r.mrf_url; }),
    'evidence present upstream, missing downstream');

  add('stale label disagrees with the day count',
    comp.filter(r => {
      const d = Number(r.mrf_days_since_update);
      if (!r.mrf_days_since_update || isNaN(d)) return false;
      const isStaleLabel = r.finding === 'mrf-stale-over-365-days';
      if (r.finding !== 'compliant-observed' && !isStaleLabel) return false;
      return (d > 365) !== isStaleLabel;
    }),
    'the >365 day rule applied inconsistently');

  add('compliance row not in the CMS roster',
    comp.filter(r => !rosterCcn.has(r.ccn)),
    'phantom hospital');

  const seen = new Set();
  const dupes = [];
  for (const r of comp) { if (seen.has(r.ccn)) dupes.push(r); seen.add(r.ccn); }
  add('duplicate CCN in compliance', dupes, 'a hospital counted twice');

  add('roster hospital missing from compliance',
    roster.filter(h => !seen.has(h.ccn)).map(h => ({ ccn: h.ccn, hospital_name: h.name })),
    'a hospital silently dropped from the report');

  add('date present but not sourced from file metadata',
    comp.filter(r => {
      const m = manBy.get(r.ccn);
      return r.mrf_last_updated && m && m.mrf_date_source !== 'file-metadata';
    }),
    'an HTTP timestamp leaked into the date of record');

  return checks;
}

function runAudit() {
  const loaded = load();
  if (!loaded) return 0;
  const checks = buildChecks(loaded);

  console.log(`CONSISTENCY AUDIT  (${loaded.comp.length} compliance rows, ${loaded.man.length} manifest rows)`);
  console.log('='.repeat(78));
  let bad = 0;
  for (const c of checks) {
    if (c.n) bad++;
    console.log(`${c.n ? 'FAIL' : 'ok  '} ${String(c.n).padStart(5)}  ${c.name}`);
    if (!c.n) continue;
    console.log(`         why: ${c.why}`);
    for (const s of c.sample) {
      console.log(`         e.g. ${s.ccn} ${String(s.hospital_name || '').slice(0, 34)} [${s.finding || ''}] ${String(s.domain || '').slice(0, 28)}`);
    }
  }
  console.log('='.repeat(78));
  console.log(bad ? `${bad} inconsistency class(es) found` : 'all consistent');
  return bad;
}

module.exports = { runAudit };
if (require.main === module) process.exitCode = runAudit() ? 1 : 0;
