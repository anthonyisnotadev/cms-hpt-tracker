'use strict';

/**
 * Build the manual-intervention overlay: one row per compliance row that says
 * WHY a human is needed and WHAT to do, in operational terms the findings
 * vocabulary deliberately does not express.
 *
 *   finding        = what we observed about compliance (regulatory view)
 *   intervention   = why it is unresolved and who has to act (operational view)
 *
 * "They block automated tools", "the data comes back unusable", "the page does
 * not exist", "the site is gone" are different jobs: unblocker/browser, an
 * email about file format, an email about a missing file, and a hunt for a new
 * domain. The classifier separates them by joining compliance.csv with the raw
 * curl-evidence index (final status, DNS result, edge attribution, transport
 * error) - both tracked artifacts, so this stage is fully reproducible offline.
 *
 *   node scripts/hpt/build-interventions.js
 *   -> data/hpt-audit/interventions.csv
 */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const { csvToObjects, toCSV } = require('./lib/util');

const ROOT = path.join(__dirname, '..', '..');
const COMPLIANCE = path.join(ROOT, 'data', 'hpt-audit', 'compliance.csv');
const CURL_DIR = path.join(ROOT, 'data', 'hpt-audit', 'curl-evidence');
const CURL_INDEX = path.join(CURL_DIR, 'index.csv');
const OUT = path.join(ROOT, 'data', 'hpt-audit', 'interventions.csv');

const COLUMNS = ['ccn', 'hospital_name', 'city', 'state', 'finding', 'intervention',
  'action', 'reason', 'evidence_url', 'transcript', 'checked_at'];

// key, label, plain-English meaning, suggested action. Single source for the
// CSV, the tracker payload, and the tests.
const INTERVENTIONS = {
  'identity-review': {
    label: 'File assignment quarantined',
    plain: 'The previous file assignment conflicts with hospital identity and is excluded from the current view.',
    action: 'Verify the official hospital and its location before assigning a replacement file.'
  },
  'waf-blocked': {
    label: 'Access denied through an edge service',
    plain: 'Our request was denied or rate-limited by a response associated with an edge service.',
    action: 'Compare a fresh request with a browser check; edge branding alone does not identify the blocking rule.'
  },
  'server-blocked': {
    label: 'Access denied to this client',
    plain: 'Our request was denied or rate-limited; the responsible server layer is unverified.',
    action: 'Retry and compare with a browser check before diagnosing the cause.'
  },
  'client-rejected': {
    label: 'Request not accepted (406)',
    plain: 'The checked URL returned HTTP 406 to our client.',
    action: 'Compare browser and automated responses; the status alone does not prove bot filtering.'
  },
  'dns-dead': {
    label: 'DNS lookup failed',
    plain: 'Our DNS lookup failed during the check; this does not establish that the site or hospital closed.',
    action: 'Retry DNS and verify the official hostname before investigating a move or closure.'
  },
  'connection-dead': {
    label: 'Connection check failed',
    plain: 'Our connection to the checked host failed or timed out, possibly during TLS negotiation.',
    action: 'Retry the exact URL and compare with a browser; verify the domain if failures persist.'
  },
  'site-server-error': {
    label: 'HTTP server error at checked URL',
    plain: 'The checked URL returned a 5xx response during our request.',
    action: 'Recheck later; if it persists, verify in a browser.'
  },
  'file-404': {
    label: 'Pointer URL returned 404/410',
    plain: 'The checked pointer URL returned not found or gone; other hostnames or locations may work.',
    action: 'Verify the official hostname and pointer location before contacting the hospital.'
  },
  'html-soft-block': {
    label: 'HTML returned at pointer URL',
    plain: 'Our request received a web page at the checked pointer URL; the cause is unresolved.',
    action: 'Inspect the page and browser response for a challenge, redirect, error page, or alternate link.'
  },
  'file-at-pointer-path': {
    label: 'Charge metadata at pointer URL',
    plain: 'The response resembles charge-file metadata at the checked pointer URL.',
    action: 'Inspect the response and verify the intended pointer location before outreach.'
  },
  'mrf-gone': {
    label: 'MRF URL returned 404/410',
    plain: 'The previously recorded MRF URL returned not found or gone during our check.',
    action: 'Refetch the official pointer for a replacement URL before contacting the hospital.'
  },
  'mrf-server-error': {
    label: 'MRF server error',
    plain: 'The machine-readable file URL errors out on the server side.',
    action: 'Recheck later; if it persists, email the hospital.'
  },
  'format-unusable': {
    label: 'Date not verified',
    plain: 'Our bounded file probe did not recover a readable last_updated_on. File validity is unverified.',
    action: 'Inspect the response, compression, and metadata before concluding that a required field is missing.'
  },
  'pointer-mrf-unverified': {
    label: 'MRF link not extracted',
    plain: 'The matched pointer entry yielded no MRF URL in our parser.',
    action: 'Inspect the raw pointer entry and parser output before contacting the hospital about a missing link.'
  },
  'stale-file': {
    label: 'Recorded update date over 365 days old',
    plain: 'The extracted update date was over 365 days old at assessment time.',
    action: 'Refetch the official pointer and confirm the current file date and hospital identity before outreach.'
  },
  'old-template': {
    label: 'Older template version recorded',
    plain: 'The extracted template version was below the version expected by this audit.',
    action: 'Verify the current file, declared version, and applicable CMS requirements before outreach.'
  },
  'name-ambiguous': {
    label: 'Hospital match unresolved',
    plain: 'Our matching process did not establish which pointer entry represents this hospital.',
    action: 'Manually adjudicate the pointer entries against the CMS roster.'
  },
  'domain-unknown': {
    label: 'Official domain not verified',
    plain: 'No official domain is assigned in this audit; a working website may exist.',
    action: 'Review candidate websites and verify their relationship to this hospital.'
  },
  'exempt-federal': {
    label: 'Federal, exempt',
    plain: 'VA/DoD facilities are outside the rule.',
    action: 'No action needed.'
  },
  none: {
    label: 'No issue observed by these checks',
    plain: 'The audit observed a matched pointer and readable file date; this is not full-file validation.',
    action: 'No action needed.'
  },
  'manual-review': {
    label: 'Evidence inconclusive',
    plain: 'Evidence does not settle a cause.',
    action: 'Read the raw transcript and decide.'
  }
};

const EDGE_BLOCKERS = new Set(['cloudflare', 'akamai', 'aws-waf', 'cloudfront']);
const CONNECTION_DEAD = /econnrefused|etimedout|timeout|econnreset|cert|tls|und_err|ehostunreach|enetunreach|fetch failed/i;
const BODY_LOOKS_HTML = /<!doctype|<html|<head|<body|<div|<script|<title/i;

/** The URL whose transcript best shows this row's problem, by finding. */
function evidenceUrlFor(row) {
  const domain = String(row.domain || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '').toLowerCase();
  switch (row.finding) {
    case 'mrf-blocked-to-automation':
    case 'mrf-url-unreachable':
    case 'mrf-stale-over-365-days':
    case 'old-template-version':
    case 'compliant-date-unverified':
      return row.mrf_url || '';
    case 'pointer-lists-no-mrf-url':
    case 'not-assessed-not-named-in-file':
      return row.pointer_url || '';
    case 'pointer-blocked-to-automation':
    case 'not-assessed-site-unreachable':
    case 'no-cms-hpt-txt-published':
      return domain ? `https://${domain}/cms-hpt.txt` : '';
    default:
      return '';
  }
}

/**
 * Classify one compliance row. `evidence` is the curl-evidence index row for
 * the row's evidence URL (or null when none was collected). Pure: no I/O.
 */
function classifyRow(row, evidence) {
  const domain = String(row.domain || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '').toLowerCase();
  const status = Number(evidence && evidence.final_status) || 0;
  const edge = String((evidence && evidence.edge) || '');
  const edgeBlock = hasEdgeAttribution(edge, evidence);
  const dnsFailed = evidence && evidence.dns === 'failed';
  const transportError = String((evidence && evidence.error) || '');

  const pick = (intervention, reason) => ({ intervention, reason });

  function blockReason() {
    if (status === 406) return pick('client-rejected', `checked URL returned HTTP 406 to our client at ${evidence.url}`);
    if (edgeBlock) return pick('waf-blocked', `HTTP ${status} with edge attribution ${edge || 'mitigation header'}; blocking rule unverified`);
    return pick('server-blocked', `checked URL returned HTTP ${status} to our client; responsible server layer unverified`);
  }

  switch (row.finding) {
    case 'not-assessed-identity-conflict':
      return pick('identity-review', row.evidence || 'previous file assignment conflicts with hospital identity');
    case 'not-applicable-federal':
      return pick('exempt-federal', 'federally owned; outside 45 CFR 180');
    case 'compliant-observed':
      return pick('none', 'pointer and MRF verified with a readable last_updated_on');
    case 'compliant-date-unverified':
      return pick('format-unusable',
        'bounded MRF probe did not recover last_updated_on; file validity is unverified');
    case 'pointer-lists-no-mrf-url':
      return pick('pointer-mrf-unverified', `no MRF URL was extracted for the matched entry for "${row.hospital_name}"`);
    case 'mrf-stale-over-365-days':
      return pick('stale-file', `last_updated_on ${row.mrf_last_updated} is ${row.mrf_days_since_update} days old`);
    case 'old-template-version':
      return pick('old-template', `file declares CMS template version ${row.cms_template_version}`);
    case 'mrf-blocked-to-automation':
      if (evidence && (status === 403 || status === 429 || status === 406)) return blockReason();
      return pick('manual-review', 'MRF refused automated access but no fresh transcript settled the cause');
    case 'mrf-url-unreachable':
      if (status === 404 || status === 410) return pick('mrf-gone', `recorded MRF URL returned HTTP ${status}; current pointer needs verification`);
      if (status >= 500 && status < 600) return pick('mrf-server-error', `MRF URL returns HTTP ${status}`);
      if (status === 403 || status === 429 || status === 406) return blockReason();
      if (evidence && !status && CONNECTION_DEAD.test(transportError)) return pick('connection-dead', `MRF host unreachable (${transportError})`);
      return pick('manual-review', `MRF URL failed (${row.evidence || 'cause unknown'}; no fresh transcript settled it)`);
    case 'pointer-blocked-to-automation':
      if (evidence && (status === 403 || status === 429 || status === 406)) return blockReason();
      return pick('manual-review', 'pointer refused automated access but no fresh transcript settled the cause');
    case 'not-assessed-site-unreachable':
      if (dnsFailed && !status) return pick('dns-dead', `DNS lookup failed for ${domain} during the check`);
      if (evidence && (status === 403 || status === 429 || status === 406)) return blockReason();
      if (status >= 500 && status < 600) return pick('site-server-error', `site answers with HTTP ${status}`);
      if (evidence && (!status || CONNECTION_DEAD.test(transportError)))
        return pick('connection-dead', `connection check failed (${transportError || 'no response'})`);
      return pick('manual-review', 'site unreachable; fresh evidence did not settle the cause');
    case 'no-cms-hpt-txt-published':
      if (status === 404 || status === 410) return pick('file-404', `checked pointer URL returned HTTP ${status}; other locations unverified`);
      if (status === 200 || status === 202) {
        // "Something answered at the file path" is not automatically a soft
        // block: a few sites serve the machine-readable charge file itself at
        // /cms-hpt.txt. The transcript body settles which one it is; without
        // it the honest answer is the web-page reading only when the body is
        // actually HTML, and manual review otherwise.
        const body = String((evidence && evidence.bodyExcerpt) || '');
        if (body) {
          if (BODY_LOOKS_HTML.test(body.slice(0, 2000)))
            return pick('html-soft-block', `/cms-hpt.txt answers HTTP ${status} with a web page instead of the file`);
          if (/(?:^|[\s"{,])hospital_name["\s,:]|"standard_charge_information"/i.test(body)
              && /last_updated_on|standard_charge_information/i.test(body))
            return pick('file-at-pointer-path', `checked pointer URL returned HTTP ${status} with charge-file metadata`);
          return pick('manual-review', `checked pointer URL returned HTTP ${status}; non-HTML content is not proof of a charge file`);
        }
        return pick('manual-review', `/cms-hpt.txt answers HTTP ${status}; no transcript body to tell a soft block from a wrong file`);
      }
      if (evidence && (status === 403 || status === 429 || status === 406)) return blockReason();
      return pick('manual-review', 'no cms-hpt.txt found; fresh evidence did not settle the cause');
    case 'not-assessed-not-named-in-file':
      return pick('name-ambiguous', `matching did not establish a pointer entry for this hospital on ${domain}`);
    case 'not-assessed-domain-unknown':
      return pick('domain-unknown', 'no verified official domain is assigned in this audit');
    default:
      return pick('manual-review', `unmapped finding ${row.finding}`);
  }
}

// Hoisted helper kept tiny so classifyRow stays readable above.
function hasEdgeAttribution(edge, evidence) {
  if (EDGE_BLOCKERS.has(edge)) return true;
  const mitigated = String((evidence && (evidence.cf_mitigated || evidence.waf_action)) || '');
  return !!mitigated;
}

async function main() {
  const { compliance } = require('./lib/reviewed-resolutions').loadReviewedView(path.dirname(COMPLIANCE));
  let curlIndex = [];
  try {
    curlIndex = await csvToObjects((await fsp.readFile(CURL_INDEX, 'utf8')).replace(/^\uFEFF/, ''));
  } catch (_e) {
    console.log('No curl-evidence index found; blocked/unreachable rows fall back to manual-review.');
  }
  const byUrl = new Map();
  for (const r of curlIndex) if (r.url) byUrl.set(r.url, r);

  // "Something answered HTTP 200/202 at /cms-hpt.txt" needs the transcript body
  // to separate a web page from a charge file served at the wrong path. Only
  // those rows pay for a file read; everything else stays CSV-pure.
  const bodyCache = new Map();
  const bodyExcerptOf = async evidence => {
    if (!evidence || !evidence.transcript) return '';
    if (bodyCache.has(evidence.url)) return bodyCache.get(evidence.url);
    let excerpt = '';
    try {
      const text = await fsp.readFile(path.join(CURL_DIR, String(evidence.transcript).replace(/\\/g, '/')), 'utf8');
      excerpt = String(text.split('< --- body')[1] || '').slice(0, 4000);
      evidence.checked_at = (text.match(/^# fetched (\S+)/m) || [])[1] || '';
    } catch (_e) { /* unreadable transcript: classifier falls back honestly */ }
    bodyCache.set(evidence.url, excerpt);
    return excerpt;
  };

  const rows = [];
  const unknownFindings = new Set();
  for (const row of compliance) {
    const url = evidenceUrlFor(row);
    const evidence = url ? (byUrl.get(url) || null) : null;
    if (evidence) await bodyExcerptOf(evidence);
    if (row.finding === 'no-cms-hpt-txt-published' && evidence
        && (evidence.final_status === '200' || evidence.final_status === '202')) {
      evidence.bodyExcerpt = await bodyExcerptOf(evidence);
    }
    const { intervention, reason } = classifyRow(row, evidence);
    if (!INTERVENTIONS[intervention]) unknownFindings.add(intervention);
    rows.push({
      ccn: row.ccn, hospital_name: row.hospital_name, city: row.city, state: row.state,
      finding: row.finding, intervention,
      action: (INTERVENTIONS[intervention] || INTERVENTIONS['manual-review']).action,
      reason,
      evidence_url: url,
      transcript: evidence ? `data/hpt-audit/curl-evidence/${String(evidence.transcript || '').replace(/\\/g, '/')}` : '',
      checked_at: evidence ? (evidence.checked_at || '') : (row.checked_at || '')
    });
  }
  if (unknownFindings.size) throw new Error(`Classifier produced unknown interventions: ${[...unknownFindings].join(', ')}`);

  rows.sort((a, b) => a.state.localeCompare(b.state) || a.hospital_name.localeCompare(b.hospital_name));
  await fsp.writeFile(OUT, toCSV(rows, COLUMNS));

  const counts = {};
  for (const r of rows) counts[r.intervention] = (counts[r.intervention] || 0) + 1;
  console.log(`=== manual-intervention overlay: ${rows.length} hospitals ===`);
  for (const [key, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
    console.log(`${String(n).padStart(6)}  ${key.padEnd(18)} ${INTERVENTIONS[key].plain}`);
  }
  const withTranscripts = rows.filter(r => r.transcript).length;
  console.log(`\nrows with a raw transcript: ${withTranscripts}`);
  console.log(`-> ${path.relative(ROOT, OUT)}`);
}

if (require.main === module) {
  main().catch(e => { console.error(e && e.stack || e); process.exitCode = 1; });
}

module.exports = { INTERVENTIONS, COLUMNS, evidenceUrlFor, classifyRow };
