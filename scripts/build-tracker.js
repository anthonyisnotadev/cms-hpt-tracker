#!/usr/bin/env node
/**
 * Builds the data block embedded in tracker.html from the three audit CSVs.
 *
 *   node scripts/build-tracker.js [sourceDir] [--out tracker.html]
 *
 * Reads compliance.csv, manifest.csv and gaps.csv from sourceDir (default:
 * ./data/hpt-audit, falling back to ~/Downloads) and rewrites the contents of
 * <script id="tracker-data"> in place. Markup and styles in tracker.html are
 * never touched, so re-running this is how you refresh the snapshot.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { buildReviewedWorkQueue } = require('./hpt/lib/tracker-work-queue');

/* ---------- csv ---------- */

function parseCsv(text) {
  const rows = [];
  let field = '', row = [], quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else { quoted = false; }
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n') { row.push(field); field = ''; rows.push(row); row = []; }
    else if (ch !== '\r') field += ch;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function readTable(file) {
  const rows = parseCsv(fs.readFileSync(file, 'utf8'));
  const header = rows[0];
  return rows.slice(1)
    .filter(r => r.length === header.length)
    .map(r => Object.fromEntries(header.map((k, i) => [k, r[i]])));
}

/* ---------- finding taxonomy ---------- */

// Every CMS finding rolls up into one of five tiers. The tier is what the page
// colours by; the finding is what it explains with.
const FINDINGS = [
  ...Object.entries(require('./hpt/lib/nationwide-verification-view').LABELS).map(([key, label]) => ({
    key: require('./hpt/lib/nationwide-verification-view').finding(key), tier: 'unknown', label,
    blurb: 'A dated nationwide retrieval observation, not a compliance determination. See the separate checks and next action.'
  })),
  ...Object.entries(require('./hpt/lib/discovery-review').LABELS).map(([key, label]) => ({
    key: require('./hpt/lib/discovery-review').finding(key), tier: 'unknown', label,
    blurb: 'A dated discovery observation, not a compliance determination. See the record evidence and next action.'
  })),
  { key: 'not-assessed-identity-conflict', tier: 'unknown', label: 'File assignment quarantined',
    blurb: 'The previous file assignment conflicts with hospital identity. Its links and metadata are excluded pending verification.' },
  { key: 'compliant-observed', tier: 'compliant', label: 'Machine-readable file located',
    blurb: 'A machine-readable standard-charges file opened and reported an update date.' },
  { key: 'compliant-date-unverified', tier: 'compliant', label: 'File located, date unread',
    blurb: 'The bounded probe did not recover a declared update date; file validity is unverified.' },
  { key: 'pointer-lists-no-mrf-url', tier: 'failing', label: 'MRF link not extracted',
    blurb: 'Our parser extracted no MRF URL for the matched pointer entry.' },
  { key: 'pointer-links-older-mrf-than-source-page', tier: 'unknown', label: 'Pointer and pricing-page files differ',
    blurb: 'The official pricing page links a newer identity-matched file, while the current pointer still links an older file.' },
  { key: 'pointer-links-different-facility-mrf-source-page-file', tier: 'unknown', label: 'Pointer names another facility’s file',
    blurb: 'The root pointer links a readable file declaring another facility, while the official pricing page separately links an identity-matched file. The page file is not treated as pointer-linked.' },
  { key: 'pricing-page-links-older-mrf-than-pointer', tier: 'unknown', label: 'Pricing page links an older file',
    blurb: 'The current root pointer links a newer identity-matched file, while the hospital pricing page still links an older file. Complete-file validity and legal compliance are unverified.' },
  { key: 'pointer-links-unavailable-mrf-source-page-current-file', tier: 'unknown', label: 'Pointer file unavailable; pricing-page file found',
    blurb: 'The official pricing page links an identity-matched current file, while the exact file URL declared by the root pointer is unavailable.' },
  { key: 'pointer-target-dns-unresolved-page-file-found', tier: 'unknown', label: 'Pointer host unresolved to clients; pricing-page file found',
    blurb: 'The pointer names a different host that did not resolve in our bounded client or browser. The current official pricing page links a separate identity-matched file; the DNS failures do not prove the pointer file is absent.' },
  { key: 'pointer-http-client-error-page-file-found', tier: 'unknown', label: 'Pointer HTTP URL failed to this client; HTTPS file found',
    blurb: 'The official pointer uses HTTP for the exact file that the pricing page links over HTTPS. Our bounded client received an empty reply from HTTP but read identity-matched CSV bytes over HTTPS. Browser blocking is a client observation, not proof that the pointer target is absent.' },
  { key: 'pointer-links-html-download-page-with-file', tier: 'unknown', label: 'Pointer links a download page instead of the file',
    blurb: 'The root pointer links an HTML portal that exposes an identity-matched file. The file date and version are reported separately without treating the portal as the MRF.' },
  { key: 'pointer-html-portal-not-found-source-page-current-file', tier: 'unknown', label: 'Pointer portal rendered not found; pricing-page file found',
    blurb: 'The root pointer targets an HTML portal that rendered a not-found page in this browser review. The official pricing page separately links a current identity-matched file; that file is not treated as pointer-linked.' },
  { key: 'pointer-file-url-renders-not-found-source-page-current-file', tier: 'unknown', label: 'Pointer file URL rendered not found; pricing-page file found',
    blurb: 'The root pointer labels a file URL that rendered a not-found HTML page in this browser review. The official pricing page separately links an identity-matched current file; that file is not treated as pointer-linked.' },
  { key: 'official-page-mrf-root-pointer-unavailable', tier: 'unknown', label: 'Official-page file found; root pointer unavailable',
    blurb: 'The official pricing page links an identity-matched file, but the root cms-hpt.txt request did not return a usable pointer. File date and version are reported separately.' },
  { key: 'root-pointer-omits-facility-page-file-found', tier: 'unknown', label: 'Root pointer omits facility; page file found',
    blurb: 'The root cms-hpt.txt lists other facilities but no entry for this hospital. Its first-party page links an identity-matched file; that file is not treated as pointer-linked.' },
  { key: 'root-pointer-omits-facility-official-storage-file-found', tier: 'unknown', label: 'Root pointer omits facility; official storage file found',
    blurb: 'The root cms-hpt.txt omits this hospital, but the publisher\'s official storage namespace contains a bounded, identity-matched file observation. The file is not treated as pointer-linked or fully validated.' },
  { key: 'pointer-target-google-sheet-page-file-found', tier: 'unknown', label: 'Pointer targets Google Sheet; page file found',
    blurb: 'The root pointer names the facility but targets a Google Sheets edit page rather than a direct MRF. The official pricing page separately links a complete identity-matched CSV; the two source roles remain distinct.' },
  { key: 'root-pointer-html-page-with-official-page-file', tier: 'unknown', label: 'Root pointer path serves HTML; pricing-page file found',
    blurb: 'The root cms-hpt.txt path served an HTML page containing pointer-style text, not a plain-text pointer document. The official pricing page links an identity-matched file, which is not treated as pointer-linked.' },
  { key: 'mrf-license-state-field-conflicts-facility', tier: 'unknown', label: 'File license-state field conflicts with facility',
    blurb: 'The pointer and file identify the facility, but the state encoded in the file license-number column conflicts with the facility state. The discrepancy remains unresolved.' },
  { key: 'mrf-address-field-conflicts-facility', tier: 'unknown', label: 'File address field differs from hospital address',
    blurb: 'The pointer-linked file identifies the facility, but a declared address field differs from the independently verified hospital address. The difference may be a spelling error or a different location; review the literal field before drawing a conclusion.' },
  { key: 'mrf-address-field-incomplete', tier: 'unknown', label: 'File address field incomplete',
    blurb: 'The pointer and file identify the facility, but the declared address omits a component of the independently verified hospital street.' },
  { key: 'mrf-template-version-noncanonical', tier: 'unknown', label: 'File template version needs review',
    blurb: 'The pointer-linked file identifies the facility and has a current declared date, but its version field differs from the CMS schema identifier. This observation does not validate the complete file.' },
  { key: 'mrf-custom-workbook-metadata-unverified', tier: 'unknown', label: 'Pointer links custom workbook; CMS file metadata unverified',
    blurb: 'The pointer-linked object identifies the facility but is an XLSX workbook served from a CSV-labeled URL. Its generation date is not a verified MRF update date, and no CMS template version was declared.' },
  { key: 'mrf-url-unreachable', tier: 'failing', label: 'MRF request failed',
    blurb: 'Our request to the recorded charge-file URL failed; the cause and current link need verification.' },
  { key: 'mrf-stale-over-365-days', tier: 'failing', label: 'Recorded date over 365 days old',
    blurb: 'The extracted update date was over 365 days old at assessment time.' },
  { key: 'old-template-version', tier: 'failing', label: 'Older template version recorded',
    blurb: 'The extracted version was below the version expected by this audit.' },
  { key: 'no-cms-hpt-txt-published', tier: 'failing', label: 'Pointer not retrieved',
    blurb: 'Our checks did not retrieve a usable pointer from the tested locations.' },
  { key: 'pointer-blocked-to-automation', tier: 'blocked', label: 'Pointer blocked to automation',
    blurb: 'The website refused the automated request for cms-hpt.txt.' },
  { key: 'mrf-blocked-to-automation', tier: 'blocked', label: 'File blocked to automation',
    blurb: 'The charge file refused the automated request.' },
  { key: 'not-assessed-domain-unknown', tier: 'unknown', label: 'Official domain not verified',
    blurb: 'No official domain is assigned in this audit; a working website may exist.' },
  { key: 'not-assessed-site-observed', tier: 'unknown', label: 'Hospital website candidate observed',
    blurb: 'A candidate homepage matched hospital name and location text, but official pointer and MRF linkage remain unverified.' },
  { key: 'not-assessed-site-corrected', tier: 'unknown', label: 'Official website corrected; file review pending',
    blurb: 'A reviewed first-party page corrected the hospital domain; current pointer and charge-file linkage remain unverified.' },
  { key: 'not-assessed-pointer-review', tier: 'unknown', label: 'Pointer and facility match under review',
    blurb: 'A candidate website returned a pointer file, but the hospital, pointer, and charge-file evidence did not fully agree.' },
  { key: 'not-assessed-domain-candidate', tier: 'unknown', label: 'Candidate website found',
    blurb: 'Search returned candidate websites, but none passed official-domain and pointer/MRF verification.' },
  { key: 'not-assessed-domain-search-pending', tier: 'unknown', label: 'Website search not completed',
    blurb: 'No search request is recorded for this hospital in the preserved search batch.' },
  { key: 'not-assessed-domain-search-error', tier: 'unknown', label: 'Website search request failed',
    blurb: 'The recorded search request failed before returning usable candidate results and needs a retry.' },
  { key: 'not-assessed-no-domain-candidate', tier: 'unknown', label: 'No candidate website identified',
    blurb: 'The recorded search returned no usable website candidate; the official domain remains unidentified.' },
  { key: 'not-assessed-site-unreachable', tier: 'unknown', label: 'Website request failed',
    blurb: 'Our request to the recorded website failed during the check.' },
  // This row DOES carry a pointer file, which is why the page can offer a PTR
  // button next to it. The label has to say so, otherwise the badge appears to
  // contradict the button sitting beside it.
  { key: 'not-assessed-not-named-in-file', tier: 'unknown', label: 'Hospital match unresolved',
    blurb: 'The health system’s pointer worked, but this hospital could not be matched to an entry.' },
  { key: 'not-applicable-federal', tier: 'exempt', label: 'Federally owned',
    blurb: 'VA and Department of Defense hospitals sit outside the rule.' },
  { key: 'not-applicable-indian-health-program', tier: 'exempt', label: 'Indian Health Program exception',
    blurb: '45 CFR 180.30(b)(2) covers hospitals operated by an Indian Health Program; this is not an MRF availability or file-quality finding.' },
  { key: 'not-applicable-state-hospital', tier: 'exempt', label: 'State hospital scope exception',
    blurb: '45 CFR 180.30(b) deems Federal and State hospitals compliant with Part 180. This scope classification is not an MRF availability or file-quality finding.' },
  { key: 'not-applicable-closed', tier: 'exempt', label: 'Hospital closed',
    blurb: 'Dated first-party evidence says this facility ceased hospital operations; its retained roster record is historical or stale.' },
];

const TIERS = [
  { key: 'compliant', label: 'File located', short: 'File located',
    note: 'The charge file opened. The prices inside it were not verified.' },
  { key: 'failing', label: 'Issue observed', short: 'Issue observed',
    note: 'A discovery, request, date, or template check needs verification; this is not a legal determination.' },
  { key: 'blocked', label: 'Request denied', short: 'Request denied',
    note: 'Our automated request was denied or rate-limited; browser access may differ.' },
  { key: 'unknown', label: 'Not assessed', short: 'Not assessed',
    note: 'Domain, access, or hospital identity remains unresolved in this audit.' },
  { key: 'exempt', label: 'Exempt', short: 'Exempt',
    note: 'Facilities are outside the active review scope for a documented reason, such as federal ownership or confirmed closure.' },
];

const TIER_OF = Object.fromEntries(FINDINGS.map(f => [f.key, f.tier]));

const STATE_NAMES = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado',
  CT: 'Connecticut', DE: 'Delaware', DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia',
  HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas',
  KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts',
  MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana',
  NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico',
  NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma',
  OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota',
  TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington',
  WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming', PR: 'Puerto Rico',
  VI: 'U.S. Virgin Islands', GU: 'Guam', AS: 'American Samoa', MP: 'Northern Mariana Islands',
};

/* ---------- remediation queue ---------- */

const QUEUE = [
  { key: 'exa-domain-lookup', label: 'Find the website',
    action: 'Find the right website, then check it again.',
    why: 'The audit has no verified official domain assigned for these hospitals.' },
  { key: 'name-match-review', label: 'Review the name match',
    action: 'Match each hospital to the right entry by hand.',
    why: 'The pointer was retrieved, but hospital identity remains unresolved.' },
  { key: 'corrected-site-follow-up', label: 'Review the corrected site',
    action: 'Follow the source-specific next step before assigning a current file.',
    why: 'The earlier site attribution was corrected, but current pointer or file evidence still needs a separate review.' },
  { key: 'unblocker', label: 'Route around the block',
    action: 'Open the site in a browser or ask the hospital for access.',
    why: 'Our automated request was denied; browser access has not necessarily been checked.' },
  { key: 'exempt-federal', label: 'Close as exempt',
    action: 'No work required. Record the exemption and move on.',
    why: 'Federally owned hospitals are outside the rule and will never publish under it.' },
  { key: 'exempt-ihs-program', label: 'Indian Health Program exception',
    action: 'Retain the sourced operator/program evidence and revisit if the operator or program status changes.',
    why: '45 CFR 180.30(b)(2) covers hospitals operated by an Indian Health Program.' },
  { key: 'exempt-closed', label: 'Closed facility',
    action: 'No current HPT retrieval work. Retain the dated closure evidence and recheck only if the facility reopens or the roster changes.',
    why: 'First-party evidence says the facility ceased hospital operations.' },
];

/* ---------- coordinates ---------- */

// Written once by scripts/hpt/geocode.js. The map in the outreach drawer needs
// a point per hospital, and CMS supplies a postal address and nothing else, so
// the geocoding happens here rather than in the browser. Absent file means no
// maps, which is a smaller failure than refusing to build the tracker.
function readCoords() {
  const file = path.join(__dirname, '..', 'cms_data', 'hpt', 'coords.json');
  if (!fs.existsSync(file)) {
    console.warn('cms_data/hpt/coords.json missing - building without hospital maps.\n'
      + '  Run `node scripts/hpt/geocode.js` to create it.');
    return {};
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

// Always three columns, so every row stays the same shape: longitude, latitude,
// and 1 when the point is a ZIP centroid rather than the address itself.
function place(c) {
  if (!c) return [null, null, 0];
  return [c[0], c[1], c[2] ? 1 : 0];
}

/* ---------- build ---------- */

function resolveDir(explicit) {
  const candidates = [
    explicit,
    path.join(__dirname, '..', 'data', 'hpt-audit'),
    path.join(os.homedir(), 'Downloads'),
  ].filter(Boolean);
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'compliance.csv'))) return dir;
  }
  throw new Error('compliance.csv not found. Looked in:\n  ' + candidates.join('\n  '));
}

function main() {
  const argv = process.argv.slice(2);
  const outIdx = argv.indexOf('--out');
  const outFile = outIdx >= 0 ? argv[outIdx + 1] : path.join(__dirname, '..', 'tracker.html');
  const srcDir = resolveDir(argv.find(a => !a.startsWith('--') && a !== outFile));

  const reviewed = require('./hpt/lib/reviewed-resolutions').loadReviewedView(srcDir);
  const { compliance, manifest, gaps } = reviewed;
  const reviewedResolutionByCcn = new Map(JSON.parse(fs.readFileSync(path.join(srcDir, 'reviewed-resolutions.json'), 'utf8'))
    .map(row => [row.ccn, row]));
  // Operational overlay: why each hospital is unresolved and what to do about
  // it. Generated from compliance + curl-evidence by scripts/hpt/build-interventions.js.
  const { INTERVENTIONS } = require('./hpt/build-interventions');
  const interventionKeys = Object.keys(INTERVENTIONS);
  const interventionsFile = path.join(srcDir, 'interventions.csv');
  if (!fs.existsSync(interventionsFile)) {
    throw new Error(
      `interventions.csv not found in ${srcDir}.\n` +
      'Run `node scripts/hpt/build-interventions.js` before building the tracker.');
  }
  const interventions = readTable(interventionsFile);
  const interventionByCcn = new Map(interventions.map(r => [r.ccn, r]));
  const reconciliationQueueFile = path.join(srcDir, 'nationwide-reconciliation-queue.json');
  if (!fs.existsSync(reconciliationQueueFile)) {
    throw new Error('nationwide-reconciliation-queue.json is missing; rebuild reconciliation before the tracker');
  }
  const reconciliationQueue = JSON.parse(fs.readFileSync(reconciliationQueueFile, 'utf8'));
  const investigationWorklistFile = path.join(srcDir, 'unresolved-investigation-worklist.json');
  let investigationNextSteps = {};
  const standingWorklistFile = path.join(srcDir, 'standing-evidence-followup-worklist.json');
  if (fs.existsSync(standingWorklistFile)) {
    const worklist = JSON.parse(fs.readFileSync(standingWorklistFile, 'utf8'));
    for (const name of ['nationwide-reconciliation.json', 'nationwide-verification.json']) {
      const sourceFile = path.join(srcDir, name);
      if (!fs.existsSync(sourceFile) || worklist.source_sha256?.[name] !== crypto.createHash('sha256')
        .update(fs.readFileSync(sourceFile)).digest('hex'))
        throw new Error(`Standing evidence follow-up worklist is stale against ${name}`);
    }
    investigationNextSteps = Object.fromEntries(worklist.records.map(row => [row.ccn, {
      stream: 'standing-evidence-follow-up', gate: row.current_disposition,
      nextAction: row.next_action, latestObservedAt: row.latest_observed_at,
      standingCheckedAt: row.standing_checked_at,
      browserFileStatus: row.browser_file_status, browserFileObservedAt: row.browser_file_observed_at,
    }]));
  }
  if (fs.existsSync(investigationWorklistFile)) {
    const worklist = JSON.parse(fs.readFileSync(investigationWorklistFile, 'utf8'));
    for (const name of ['nationwide-reconciliation.json', 'nationwide-verification.json']) {
      const sourceFile = path.join(srcDir, name);
      if (!fs.existsSync(sourceFile) || worklist.source_sha256?.[name] !== crypto.createHash('sha256')
        .update(fs.readFileSync(sourceFile)).digest('hex'))
        throw new Error(`Unresolved investigation worklist is stale against ${name}`);
    }
    Object.assign(investigationNextSteps, Object.fromEntries(worklist.records.map(row => [row.ccn, {
      stream: 'genuinely-unresolved-investigation',
      gate: row.evidence_gate, nextAction: row.next_action,
      browserFileStatus: row.last_browser_file_status,
      browserFileObservedAt: row.last_browser_file_observed_at,
    }])));
  }
  const supportedWorklistFile = path.join(srcDir, 'supported-uncertainty-followup-worklist.json');
  if (!fs.existsSync(supportedWorklistFile))
    throw new Error('supported-uncertainty-followup-worklist.json is missing; rebuild the supported uncertainty worklist before the tracker');
  const supportedWorklist = JSON.parse(fs.readFileSync(supportedWorklistFile, 'utf8'));
  for (const name of ['nationwide-reconciliation.json', 'reviewed-resolutions.json',
    'reconciliation-browser-file-address-conflicts.json']) {
    const sourceFile = path.join(srcDir, name);
    if (!fs.existsSync(sourceFile) || supportedWorklist.source_sha256?.[name] !== crypto.createHash('sha256')
      .update(fs.readFileSync(sourceFile)).digest('hex'))
      throw new Error(`Supported uncertainty worklist is stale against ${name}`);
  }
  for (const row of supportedWorklist.records) {
    if (investigationNextSteps[row.ccn]) throw new Error(`Duplicate investigation next step ${row.ccn}`);
    investigationNextSteps[row.ccn] = {
      stream: 'supported-uncertainty-monitor', gate: row.evidence_gate,
      nextAction: row.next_action, latestObservedAt: row.latest_observed_at,
      standingCheckedAt: row.reviewed_at,
    };
  }
  // Identity quarantines are intentionally excluded from the generic
  // unresolved worklist, but they still require an explicit, source-bound
  // operational next step. Keep them visible as their own queue stream so a
  // quarantine cannot disappear merely because the rejected assignment was
  // removed from the presentation view.
  const identityWorklistFile = path.join(srcDir, 'identity-quarantine-worklist.json');
  if (!fs.existsSync(identityWorklistFile))
    throw new Error('identity-quarantine-worklist.json is missing; build it from nationwide-reconciliation.json first');
  const identityWorklist = JSON.parse(fs.readFileSync(identityWorklistFile, 'utf8'));
  const reconciliationPath = path.join(srcDir, 'nationwide-reconciliation.json');
  if (identityWorklist.source_sha256?.['nationwide-reconciliation.json'] !== crypto.createHash('sha256')
    .update(fs.readFileSync(reconciliationPath)).digest('hex'))
    throw new Error('Identity quarantine worklist is stale against nationwide-reconciliation.json');
  for (const row of identityWorklist.records) {
    if (investigationNextSteps[row.ccn]) throw new Error(`Duplicate investigation next step ${row.ccn}`);
    investigationNextSteps[row.ccn] = {
      stream: 'identity-quarantine', gate: row.proposed_disposition,
      nextAction: row.next_action, latestObservedAt: row.latest_observed_at,
      standingCheckedAt: row.standing_checked_at,
    };
  }
  const sameCampusWorklistFile = path.join(srcDir, 'same-campus-ccn-transition-worklist.json');
  if (!fs.existsSync(sameCampusWorklistFile))
    throw new Error('same-campus-ccn-transition-worklist.json is missing; rebuild the same-campus worklist before the tracker');
  const sameCampusWorklist = JSON.parse(fs.readFileSync(sameCampusWorklistFile, 'utf8'));
  for (const [name, sourceFile] of [
    ['cms_data/hpt/roster.json', path.join(__dirname, '..', 'cms_data/hpt/roster.json')],
    ['data/hpt-audit/nationwide-reconciliation.json', path.join(srcDir, 'nationwide-reconciliation.json')],
    ['data/hpt-audit/same-campus-cms-enrollment-snapshot-review.json', path.join(srcDir, 'same-campus-cms-enrollment-snapshot-review.json')],
  ]) {
    if (sameCampusWorklist.source_sha256?.[name] !== crypto.createHash('sha256')
      .update(fs.readFileSync(sourceFile)).digest('hex'))
      throw new Error(`Same-campus CCN worklist is stale against ${name}`);
  }
  for (const group of sameCampusWorklist.groups) {
    for (const ccn of group.ccns) {
      const existing = investigationNextSteps[ccn];
      if (existing) {
        if (!existing.nextAction.includes('CMS enrollment/status'))
          existing.nextAction += ' Same-campus CCN scope: ' + group.next_action;
        existing.sameCampusCcns = group.ccns;
      } else {
        investigationNextSteps[ccn] = {
          stream: 'same-campus-ccn-review', gate: 'enrollment-scope',
          nextAction: group.next_action, sameCampusCcns: group.ccns,
        };
      }
    }
  }
  // Reconciliation workstreams not represented by a dedicated generated
  // queue still need an explicit tracker next step. In particular, standing
  // discrepancies and metadata-only follow-ups must not disappear between
  // the reconciliation report and the presentation queues.
  const reconciliationRecords = JSON.parse(fs.readFileSync(reconciliationPath, 'utf8')).records || [];
  for (const row of reconciliationRecords.filter(r => r.workstream !== 'consistent'
    && r.workstream !== 'verification-proof-gap')) {
    if (investigationNextSteps[row.ccn]) continue;
    investigationNextSteps[row.ccn] = {
      stream: row.workstream,
      gate: row.proposed_disposition || row.standing_finding || '',
      nextAction: row.next_action || 'Reconcile the newer observation against the retained standing finding.',
      latestObservedAt: row.latest_observed_at || '',
      standingCheckedAt: row.standing_checked_at || '',
    };
  }
  const reviewedFollowups = Object.fromEntries(reconciliationQueue
    .filter(r => r.workstream === 'genuinely-unresolved-investigation'
      && r.manual_access_observation?.next_action
      && r.manual_access_observation?.observed_at
      && Date.parse(r.manual_access_observation.observed_at) >= Date.parse(r.standing_checked_at || '1970-01-01'))
    .map(r => [r.ccn, {
      observedAt: r.manual_access_observation.observed_at,
      disposition: r.manual_access_observation.disposition || '',
      nextAction: r.manual_access_observation.next_action,
    }]));
  // Raw HTTP evidence per CCN, from the curl-evidence index: [url, status, edge, transcript].
  const evidenceFile = path.join(srcDir, 'curl-evidence', 'index.csv');
  const evidenceByCcn = new Map();
  if (fs.existsSync(evidenceFile)) {
    for (const r of readTable(evidenceFile)) {
      if (!r.ccn || !r.transcript) continue;
      if (!evidenceByCcn.has(r.ccn)) evidenceByCcn.set(r.ccn, []);
      evidenceByCcn.get(r.ccn).push([r.url, r.final_status || 'no response', r.edge || '', 'curl-evidence/' + String(r.transcript).replace(/\\/g, '/')]);
    }
  }
  const outreachFile = path.join(__dirname, '..', 'cms_data', 'outreach.public.json');
  const outreach = fs.existsSync(outreachFile)
    ? JSON.parse(fs.readFileSync(outreachFile, 'utf8'))
    : {};

  const byCcn = new Map(manifest.map(r => [r.ccn, r]));
  // Page-linked file proofs may be newer than the pointer manifest and need
  // not be represented as root-pointer rows. Preserve their official source
  // page in the tracker only when the exact page-file URL matches the MRF
  // selected for that CCN; this prevents borrowing a sibling or stale page.
  const manualAccessPath = path.join(srcDir, 'reconciliation-manual-access-observations.json');
  const manualAccessRecords = fs.existsSync(manualAccessPath)
    ? (JSON.parse(fs.readFileSync(manualAccessPath, 'utf8')).records || []) : [];
  const manualPageFileByCcn = new Map();
  for (const observation of manualAccessRecords) {
    const fileUrl = observation.facility_file_url || observation.page_file_url
      || observation.publisher_file_url || '';
    const pageUrl = observation.official_pricing_page || observation.official_page_url || '';
    if (!fileUrl || !pageUrl || !observation.ccn) continue;
    const prior = manualPageFileByCcn.get(observation.ccn);
    if (!prior || String(observation.observed_at || '') > String(prior.observed_at || '')) {
      manualPageFileByCcn.set(observation.ccn, { fileUrl, pageUrl, observed_at: observation.observed_at || '' });
    }
  }
  const coords = readCoords();

  const types = [...new Set(compliance.map(r => r.type))].sort();
  const states = [...new Set(compliance.map(r => r.state))].sort();
  const findingKeys = FINDINGS.map(f => f.key);

  const num = v => { const n = Number(v); return Number.isFinite(n) && v !== '' ? n : null; };

  // One row per hospital, positional to keep the payload small.
  const rows = compliance.map(r => {
    const m = byCcn.get(r.ccn) || {};
    const manualPageFile = manualPageFileByCcn.get(r.ccn);
    const sourcePageUrl = m.source_page_url
      || (manualPageFile?.fileUrl === r.mrf_url ? manualPageFile.pageUrl : '');
    const iv = interventionByCcn.get(r.ccn) || {};
    return [
      r.ccn,
      r.hospital_name,
      r.city,
      states.indexOf(r.state),
      types.indexOf(r.type),
      findingKeys.indexOf(r.finding),
      num(r.mrf_days_since_update),
      r.cms_template_version || '',
      r.mrf_url || '',
      r.pointer_url || '',
      r.evidence || '',
      m.mrf_format && m.mrf_format !== 'unknown' ? m.mrf_format : '',
      num(m.mrf_bytes),
      m.mrf_last_updated || '',
      // Where the hospital is, and how sure we are. A 1 in the last column
      // means the point is its ZIP code's centre rather than its front door,
      // which the drawer says out loud instead of drawing a false precision.
      ...place(coords[r.ccn]),
      // Kept per hospital so its finding can sit at the right point in the
      // drawer history. `generated` is only the latest date in the crawl.
      (r.checked_at || '').slice(0, 10),
      // Human-facing transparency/discovery page. This matters for direct-MRF
      // evidence where there is intentionally no cms-hpt.txt pointer URL.
      sourcePageUrl,
      // Why this hospital is unresolved and what a human should do, when it is.
      interventionKeys.indexOf(iv.intervention),
    ];
  });
  const additionalFiles = Object.fromEntries(compliance.flatMap(row => {
    const resolution = reviewedResolutionByCcn.get(row.ccn);
    const files = resolution?.evidence?.additionalFiles;
    if (!reviewed.applied.includes(row.ccn) || row.mrf_url !== resolution?.evidence?.url
        || !Array.isArray(files) || !files.length) return [];
    return [[row.ccn, files.map(file => [file.location_name, file.url])]];
  }));
  const primaryFileLabels = Object.fromEntries(compliance.flatMap(row => {
    if (!additionalFiles[row.ccn]) return [];
    const label = reviewedResolutionByCcn.get(row.ccn)?.evidence?.primaryCampusLabel;
    return label ? [[row.ccn, label]] : [];
  }));

  const tally = (list, pick) => {
    const map = new Map();
    for (const item of list) { const k = pick(item); map.set(k, (map.get(k) || 0) + 1); }
    return map;
  };

  // Fail loudly on a finding the taxonomy does not know. Otherwise TIER_OF
  // returns undefined, the increment lands on tierCounts[undefined], and those
  // hospitals silently disappear from every tier total while the page still
  // renders a plausible-looking summary.
  const unknownFindings = [...new Set(compliance.map(r => r.finding))].filter(k => !TIER_OF[k]);
  if (unknownFindings.length) {
    throw new Error(
      `compliance.csv contains finding(s) missing from the FINDINGS taxonomy: ${unknownFindings.join(', ')}.\n` +
      'Add them to FINDINGS in this file (and a template in js/tracker.js) before rebuilding.');
  }

  // Same discipline for the intervention overlay: a missing or unknown key
  // would silently blank the new filter and section, so fail the build instead.
  const missingInterventions = compliance.filter(r => !interventionByCcn.get(r.ccn));
  if (missingInterventions.length) {
    throw new Error(
      `interventions.csv is missing ${missingInterventions.length} compliance row(s) ` +
      `(first: ${missingInterventions[0].ccn}). Re-run scripts/hpt/build-interventions.js.`);
  }
  const unknownInterventions = [...new Set(interventions.map(r => r.intervention))].filter(k => !INTERVENTIONS[k]);
  if (unknownInterventions.length) {
    throw new Error(
      `interventions.csv contains unknown intervention(s): ${unknownInterventions.join(', ')}.\n` +
      'Add them to INTERVENTIONS in scripts/hpt/build-interventions.js.');
  }
  const orphanRows = rows.filter(r => r[19] < 0);
  if (orphanRows.length) {
    throw new Error(`interventions.csv has rows whose key is not in INTERVENTIONS (${orphanRows.length}); rebuild the overlay.`);
  }

  const findingCounts = tally(compliance, r => r.finding);
  const tierCounts = Object.fromEntries(TIERS.map(t => [t.key, 0]));
  for (const r of compliance) tierCounts[TIER_OF[r.finding]]++;

  // State rollup. `verifiable` is the honest denominator: hospitals we could
  // actually reach and judge. Exempt and never-assessed are excluded from it.
  const byState = new Map(states.map(s => [s, []]));
  for (const r of compliance) byState.get(r.state).push(r);

  const stateRows = states.map(code => {
    const subset = byState.get(code);
    const counts = Object.fromEntries(TIERS.map(t => [t.key, 0]));
    for (const r of subset) counts[TIER_OF[r.finding]]++;
    const verifiable = counts.compliant + counts.failing + counts.blocked;
    return {
      code,
      name: STATE_NAMES[code] || code,
      total: subset.length,
      verifiable,
      rate: verifiable ? counts.compliant / verifiable : null,
      coverage: subset.length ? verifiable / subset.length : 0,
      ...counts,
    };
  }).sort((a, b) => b.total - a.total);

  const typeRows = types.map(name => {
    const subset = compliance.filter(r => r.type === name);
    const counts = Object.fromEntries(TIERS.map(t => [t.key, 0]));
    for (const r of subset) counts[TIER_OF[r.finding]]++;
    const verifiable = counts.compliant + counts.failing + counts.blocked;
    return { name, total: subset.length, verifiable, rate: verifiable ? counts.compliant / verifiable : null, ...counts };
  }).sort((a, b) => b.total - a.total);

  // Freshness, measured only on files we actually read.
  const ages = manifest.filter(r => r.mrf_last_updated && String(r.mrf_days_since_update ?? '').trim() !== '')
    .map(r => Number(r.mrf_days_since_update))
    .filter(n => Number.isFinite(n) && n >= 0)
    .sort((a, b) => a - b);
  const at = q => ages[Math.min(ages.length - 1, Math.floor(ages.length * q))];
  const FRESH_BINS = [
    { label: 'Under 90 days', short: '0-90d', lo: 0, hi: 90 },
    { label: '90 days to 6 months', short: '90-180d', lo: 91, hi: 180 },
    { label: '6 months to a year', short: '180-365d', lo: 181, hi: 365 },
    { label: 'Over a year', short: '365d+', lo: 366, hi: null },
  ].map(b => ({ ...b, n: ages.filter(d => d >= b.lo && d <= (b.hi === null ? 1e9 : b.hi)).length }));

  const queue = buildReviewedWorkQueue(investigationNextSteps, reviewed.nationwide.records);

  const gapRows = gaps.map(g => [
    g.ccn, g.hospital_name, g.city,
    states.indexOf(g.state),
    QUEUE.findIndex(q => q.key === g.remediation),
    g.seeded_domain || '',
    g.pointer_status || '',
    g.reason || '',
  ]).filter(r => r[4] >= 0 && r[3] >= 0);

  const topList = (map, limit) => [...map.entries()]
    .filter(([k]) => k !== '')
    .sort((a, b) => b[1] - a[1]).slice(0, limit)
    .map(([label, n]) => ({ label, n }));

  const bytes = manifest.map(r => Number(r.mrf_bytes)).filter(n => Number.isFinite(n) && n > 0);
  const checked = compliance.map(r => r.checked_at).filter(Boolean).sort();

  // CMS template versions come in as free text; fold the obvious spellings.
  const normVersion = v => {
    const m = String(v).match(/(\d+)(?:[.,](\d+))?/);
    if (!m) return null;
    return m[1] + '.' + (m[2] === undefined ? 'x' : Number(m[2]));
  };
  const versions = new Map();
  for (const r of manifest) {
    const v = normVersion(r.mrf_cms_version);
    if (v) versions.set(v, (versions.get(v) || 0) + 1);
  }

  const interventionCounts = tally(interventions, r => r.intervention);

  const data = {
    additionalFiles,
    primaryFileLabels,
    reviewedFollowups,
    investigationNextSteps,
    auditHistory: reviewed.history,
    reviewedCcns: reviewed.applied,
    reviewedAt: require('./hpt/lib/manual-reconciliation').authoritativeDates(compliance),
    ...require('./hpt/lib/assessment-history').buildAssessmentHistory(
      ['rechecks/2026-09-09/resolution/assessments.csv', 'rechecks/2026-09-09/recovery-856/assessments.csv']
        .flatMap(file => fs.existsSync(path.join(srcDir, file)) ? readTable(path.join(srcDir, file)) : []),
      (reviewed.nationwide && reviewed.nationwide.records) || [],
      JSON.parse(fs.readFileSync(path.join(srcDir, 'reviewed-resolutions.json'), 'utf8')),
      reviewed.applied,
      reviewed.parserCorrections
    ),
    // The dateline is the snapshot's latest observation. The full first/last
    // crawl interval remains available in `window` for provenance.
    generated: (checked[checked.length - 1] || '').slice(0, 10),
    window: [checked[0] || null, checked[checked.length - 1] || null],
    tiers: TIERS.map(t => ({ ...t, n: tierCounts[t.key] })),
    findings: FINDINGS.map(f => ({ ...f, n: findingCounts.get(f.key) || 0 })),
    interventions: interventionKeys
      .map(key => ({ key, ...INTERVENTIONS[key], n: interventionCounts.get(key) || 0 }))
      .sort((a, b) => b.n - a.n),
    totals: {
      hospitals: compliance.length,
      states: states.length,
      filesRead: manifest.length,
      terabytes: bytes.reduce((a, b) => a + b, 0) / 1e12,
      medianAge: at(0.5),
      p90Age: at(0.9),
      maxAge: ages[ages.length - 1],
      agesCounted: ages.length,
    },
    freshness: FRESH_BINS,
    states: stateRows,
    types: typeRows,
    versions: [...versions.entries()].sort((a, b) => b[1] - a[1]).map(([label, n]) => ({ label, n })),
    formats: topList(tally(manifest, r => (r.mrf_format === 'unknown' ? '' : r.mrf_format)), 6),
    http: topList(tally(manifest, r => r.mrf_http_status), 8),
    queue,
    dict: { states, types, findings: findingKeys, interventions: interventionKeys, queue: QUEUE.map(q => q.key) },
    rows,
    gapRows,
    // ccn -> [[url, final status, edge, transcript path], ...] for every hospital
    // with raw HTTP evidence. Only unresolved classes are collected, so this
    // stays small while giving the drawer and the EVID button exact links.
    evidence: Object.fromEntries(Array.from(evidenceByCcn.entries(), ([ccn, list]) =>
      [ccn, list.slice().sort((a, b) => String(b[1]).localeCompare(String(a[1])))])),
    outreach,
  };

  // Keep em dashes out of the public page without altering the source CSVs.
  const json = JSON.stringify(require('./hpt/lib/public-url-safety').protectPublicUrls(data)).replace(/\u2014/g, '-');
  const html = fs.readFileSync(outFile, 'utf8');
  const re = /(<script id="tracker-data" type="application\/json">)[\s\S]*?(<\/script>)/;
  if (!re.test(html)) throw new Error('no <script id="tracker-data"> block in ' + outFile);
  let built = html.replace(re, (_, open, close) => open + json + close);

  // Keep the social-preview summary tied to the same reconciled tier counts
  // embedded above. A hand-written snapshot here silently drifted from the
  // tracker data after nationwide overlays changed the effective view.
  const summaryAlt = `Observed results for ${(tierCounts.compliant + tierCounts.failing + tierCounts.blocked + tierCounts.unknown + tierCounts.exempt).toLocaleString('en-US')} US hospitals: ${tierCounts.compliant.toLocaleString('en-US')} categorized as file located; file contents were not verified. ${tierCounts.failing.toLocaleString('en-US')} have observed file problems, ${tierCounts.unknown.toLocaleString('en-US')} are unresolved, and ${tierCounts.exempt.toLocaleString('en-US')} are exempt or closed.`;
  built = built.replace(
    /(<meta property="og:image:alt" content=")[^"]*("\s*\/>)/,
    (_, open, close) => open + summaryAlt + close
  );

  // Inline the stylesheets. The explainer pages <link> css/docs.css, but this
  // file ships as one self-contained artifact, so its CSS has to travel inside
  // the document. Injecting it here means there is exactly one copy of every
  // rule on disk instead of a hand-synced duplicate that drifts.
  //
  // Order matters: docs.css defines the tokens and the shared components,
  // css/tracker.css adds this page's own and overrides where the two touch.
  const cssFiles = ['docs.css', 'tracker.css'];
  const cssRe = /(<style id="tracker-css">)[\s\S]*?(<\/style>)/;
  if (!cssRe.test(built)) throw new Error('no <style id="tracker-css"> block in ' + outFile);
  const css = cssFiles
    .map(name => {
      const file = path.join(__dirname, '..', 'css', name);
      if (!fs.existsSync(file)) throw new Error('missing css/' + name);
      return '/* ---- css/' + name + ' ---- */\n' + fs.readFileSync(file, 'utf8').trim();
    })
    .join('\n\n');
  built = built.replace(cssRe, (_, open, close) =>
    open + '\n/* GENERATED by scripts/build-tracker.js from ' + cssFiles.map(n => 'css/' + n).join(' + ')
    + '.\n   Do not edit this block, edit those files and run `npm run build`. */\n'
    + css + '\n' + close);

  // Stamp each page script with a hash of its contents. Browsers hold on to
  // js/tracker.js across edits otherwise, and a tracker serving last week's
  // rendering code against this week's data is worse than no cache at all.
  built = built.replace(
    /<script src="js\/([a-z-]+\.js)(?:\?v=[0-9a-f]+)?" defer><\/script>/g,
    (whole, name) => {
      const file = path.join(__dirname, '..', 'js', name);
      if (!fs.existsSync(file)) return whole;
      const hash = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0, 10);
      return `<script src="js/${name}?v=${hash}" defer></script>`;
    }
  );
  // Write through a sibling temporary file first. On Windows, a transient
  // reader/antivirus handle can make direct replacement of the large tracker
  // fail with an opaque UNKNOWN error; the completed temp write keeps the
  // existing artifact intact until the final copy succeeds.
  const tempOut = outFile + `.tmp-${process.pid}`;
  try {
    fs.writeFileSync(tempOut, built);
    try {
      fs.copyFileSync(tempOut, outFile);
    } catch (copyError) {
      // Some Windows file providers reject CopyFile while permitting a
      // remove-and-rename replacement. Keep the completed temp output while
      // trying that path before the direct-write fallback.
      try {
        fs.rmSync(outFile, { force: true });
        fs.renameSync(tempOut, outFile);
      } catch (replaceError) {
        // Preserve the completed temp output and retry a normal write as the
        // final fallback for providers that reject rename as well.
        fs.writeFileSync(outFile, built);
      }
    }
  } finally {
    try { fs.unlinkSync(tempOut); } catch {}
  }

  console.log(path.basename(outFile) + ': ' + data.rows.length + ' hospitals, '
    + data.queue.reduce((sum, row) => sum + row.n, 0) + ' reviewed follow-ups, '
    + (json.length / 1e6).toFixed(2) + ' MB of data');
  console.log('tiers: ' + data.tiers.map(t => t.key + ' ' + t.n).join('  '));

  // Optional single-file copy with js/tracker.js folded in, for sharing or
  // hosting somewhere without the rest of the repo.
  // Fold every page script into the document, in the order the page lists them.
  const PAGE_SCRIPTS = ['motion.js', 'outreach.js', 'tracker-summary.js', 'tracker.js'];
  const inlineScript = () => {
    let out = built;
    for (const name of PAGE_SCRIPTS) {
      // Tolerate the ?v= cache-busting stamp added just above.
      const tag = new RegExp('<script src="js/' + name.replace('.', '\\.')
        + '(?:\\?v=[0-9a-f]+)?" defer></script>');
      if (!tag.test(out)) throw new Error(`tracker.html no longer loads js/${name}`);
      const code = fs.readFileSync(path.join(__dirname, '..', 'js', name), 'utf8');
      out = out.replace(tag, '<script>\n' + code + '</script>');
    }
    return out;
  };
  const write = (dest, text, label) => {
    fs.mkdirSync(path.dirname(path.resolve(dest)), { recursive: true });
    fs.writeFileSync(dest, text);
    console.log(label + ': ' + dest + ' (' + (text.length / 1e6).toFixed(2) + ' MB)');
  };

  // The masthead links to the explainer pages (mrf.html, rules.html,
  // pointer.html) by relative path. Both outputs below travel without them, so
  // both drop those links rather than shipping four dead ones. The GitHub link
  // is an absolute URL and survives. The theme toggle lives in .masthead-util
  // outside this nav, so it is left alone, rebuilding it here would ship two
  // controls with the same id.
  const dropSiblingLinks = html => html.replace(
    /<nav class="masthead-links"[^>]*>[\s\S]*?<\/nav>/,
    '<nav class="masthead-links" aria-label="Site">\n'
    + '      <a href="https://github.com/anthonyisnotadev" target="_blank" rel="noopener noreferrer">GitHub</a>\n'
    + '    </nav>');

  // The section bar points at ids inside this document, so it survives both
  // outputs intact, but its search field is wired by js/tracker.js, which is
  // inlined below, so nothing here needs stripping.

  const standaloneIdx = argv.indexOf('--standalone');
  if (standaloneIdx >= 0) {
    if (!argv[standaloneIdx + 1]) throw new Error('--standalone needs an output path');
    write(argv[standaloneIdx + 1], dropSiblingLinks(inlineScript()), 'standalone');
  }

  // Artifact hosts supply their own document skeleton, so strip that too.
  const artifactIdx = argv.indexOf('--artifact');
  if (artifactIdx >= 0) {
    if (!argv[artifactIdx + 1]) throw new Error('--artifact needs an output path');
    const frag = dropSiblingLinks(inlineScript())
      .replace(/^<!doctype html>\s*/i, '')
      .replace(/<html[^>]*>\s*/i, '')
      .replace(/<\/?head>\s*/gi, '')
      .replace(/<body>\s*/i, '')
      .replace(/\s*<\/body>\s*<\/html>\s*$/i, '\n')
      .replace(/<meta charset[^>]*>\s*/i, '')
      .replace(/<meta name="viewport"[^>]*>\s*/i, '');
    write(argv[artifactIdx + 1], frag, 'artifact');
  }
}

main();
