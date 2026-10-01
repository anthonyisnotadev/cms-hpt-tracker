'use strict';

/**
 * Build the manual-intervention overlay: one row per compliance row that says
 * WHY a human is needed and WHAT to do, in operational terms the findings
 * vocabulary deliberately does not express.
 *
 *   finding        = what was observed about compliance (regulatory view)
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
const crypto = require('crypto');

const { csvToObjects, toCSV } = require('./lib/util');

const ROOT = path.join(__dirname, '..', '..');
const COMPLIANCE = path.join(ROOT, 'data', 'hpt-audit', 'compliance.csv');
const CURL_DIR = path.join(ROOT, 'data', 'hpt-audit', 'curl-evidence');
const CURL_INDEX = path.join(CURL_DIR, 'index.csv');
const OUT = path.join(ROOT, 'data', 'hpt-audit', 'interventions.csv');
const WORKLIST = path.join(ROOT, 'data', 'hpt-audit', 'unresolved-investigation-worklist.json');

const COLUMNS = ['ccn', 'hospital_name', 'city', 'state', 'finding', 'intervention',
  'action', 'reason', 'evidence_url', 'transcript', 'checked_at'];

// key, label, plain-English meaning, suggested action. Single source for the
// CSV, the tracker payload, and the tests.
const INTERVENTIONS = {
  'discovery-review': {
    label: 'Discovery evidence review',
    plain: 'Website identity, pointer retrieval, file identity, access, and metadata are assessed separately.',
    action: 'Follow the per-CCN next action in the evidence. Confirm first-party name and address before testing official pointers; do not infer noncompliance from an unfinished review.'
  },
  'identity-review': {
    label: 'File assignment quarantined',
    plain: 'The previous file assignment conflicts with hospital identity and is excluded from the current view.',
    action: 'Verify the official hospital and its location before assigning a replacement file.'
  },
  'file-license-state-conflict': {
    label: 'File license-state field differs',
    plain: 'The pointer-linked file identifies the facility, but its license-number column names another state.',
    action: 'Seek publisher correction or clarification of the exact state field; retain the file, facility identity, and date separately from any legal-compliance conclusion.'
  },
  'file-address-conflict': {
    label: 'File address field differs',
    plain: 'The pointer-linked file identifies the facility, but an address field differs from the independently verified hospital address.',
    action: 'Compare the literal street, city and ZIP with first-party and roster evidence, distinguishing spelling errors from different campuses; seek publisher clarification when needed.'
  },
  'file-address-incomplete': {
    label: 'File address field incomplete',
    plain: 'The pointer-linked file omits a component of the independently verified hospital street address.',
    action: 'Retain the literal publisher value and recheck whether the file address is completed after a publisher update.'
  },
  'waf-blocked': {
    label: 'Access denied through an edge service',
    plain: 'The request was denied or rate-limited by a response associated with an edge service.',
    action: 'Compare a fresh request with a browser check; edge branding alone does not identify the blocking rule.'
  },
  'server-blocked': {
    label: 'Access denied to this client',
    plain: 'The request was denied or rate-limited; the responsible server layer is unverified.',
    action: 'Retry and compare with a browser check before diagnosing the cause.'
  },
  'client-rejected': {
    label: 'Request not accepted (406)',
    plain: 'The checked URL returned HTTP 406 to the client.',
    action: 'Compare browser and automated responses; the status alone does not prove bot filtering.'
  },
  'dns-dead': {
    label: 'DNS lookup failed',
    plain: 'The DNS lookup failed during the check; this does not establish that the site or hospital closed.',
    action: 'Retry DNS and verify the official hostname before investigating a move or closure.'
  },
  'connection-dead': {
    label: 'Connection check failed',
    plain: 'The connection to the checked host failed or timed out, possibly during TLS negotiation.',
    action: 'Retry the exact URL and compare with a browser; verify the domain if failures persist.'
  },
  'site-server-error': {
    label: 'HTTP server error at checked URL',
    plain: 'The checked URL returned a 5xx response during the request.',
    action: 'Recheck later; if it persists, verify in a browser.'
  },
  'file-404': {
    label: 'Pointer URL returned 404/410',
    plain: 'The checked pointer URL returned not found or gone; other hostnames or locations may work.',
    action: 'Verify the official hostname and pointer location before contacting the hospital.'
  },
  'html-soft-block': {
    label: 'HTML returned at pointer URL',
    plain: 'The request received a web page at the checked pointer URL; the cause is unresolved.',
    action: 'Inspect the page and browser response for a challenge, redirect, error page, or alternate link.'
  },
  'file-at-pointer-path': {
    label: 'Charge metadata at pointer URL',
    plain: 'The response resembles charge-file metadata at the checked pointer URL.',
    action: 'Inspect the response and verify the intended pointer location before outreach.'
  },
  'mrf-gone': {
    label: 'MRF URL returned 404/410',
    plain: 'The previously recorded MRF URL returned not found or gone during the check.',
    action: 'Refetch the official pointer for a replacement URL before contacting the hospital.'
  },
  'mrf-server-error': {
    label: 'MRF server error',
    plain: 'The machine-readable file URL errors out on the server side.',
    action: 'Recheck later; if it persists, email the hospital.'
  },
  'format-unusable': {
    label: 'Date not verified',
    plain: 'The bounded file probe did not recover a readable last_updated_on. File validity is unverified.',
    action: 'Inspect the response, compression, and metadata before concluding that a required field is missing.'
  },
  'pointer-mrf-unverified': {
    label: 'MRF link not extracted',
    plain: 'The matched pointer entry yielded no MRF URL in the parser.',
    action: 'Inspect the raw pointer entry and parser output before contacting the hospital about a missing link.'
  },
  'pointer-file-mismatch': {
    label: 'Pointer and pricing-page files differ',
    plain: 'The current official pricing page and root pointer link different machine-readable files.',
    action: 'Retain both dated observations and recheck the root pointer for a publisher correction; do not call the newer file pointer-linked.'
  },
  'pointer-different-facility-file': {
    label: 'Pointer file identifies another facility',
    plain: 'The pointer-linked file declares a different facility address, while the current official pricing page links an identity-matched file.',
    action: 'Keep the page file separate from pointer verification; recheck the root pointer after the publisher clarifies the facility assignment.'
  },
  'pricing-page-older-file': {
    label: 'Pricing page links an older file',
    plain: 'The hospital pricing page links an older identity-matched file than the current root pointer.',
    action: 'Ask the publisher to align the pricing-page download with the newer pointer-declared file, then verify the complete file before any compliance conclusion.'
  },
  'pointer-target-unavailable-page-file': {
    label: 'Pointer target unavailable; pricing-page file found',
    plain: 'The root pointer names an unavailable file, while the hospital pricing page separately links an identity-matched file.',
    action: 'Recheck the exact pointer target after a publisher update; keep the page-linked file and its metadata separate from pointer verification.'
  },
  'pointer-target-dns-unresolved': {
    label: 'Pointer target host unresolved to clients',
    plain: 'The bounded client and browser could not resolve the host named by the root pointer, while the official pricing page links an identity-matched file on the current host.',
    action: 'Retain both exact URLs and the current page-file evidence; recheck the pointer target after DNS or publisher changes without inferring file absence.'
  },
  'pointer-html-intermediary': {
    label: 'Pointer links a pricing page',
    plain: 'The root pointer labels an HTML pricing page as its MRF URL; that page links a separate identity-matched file.',
    action: 'Retain both URLs and file evidence; recheck whether the publisher changes the root pointer to link the file directly.'
  },
  'pointer-portal-not-found': {
    label: 'Pointer portal renders not found',
    plain: 'The root pointer targets an HTML portal that rendered a not-found page; the hospital pricing page separately links an identity-matched file.',
    action: 'Retain the current first-party file evidence and recheck the exact pointer or portal route after the publisher changes it.'
  },
  'pointer-file-renders-not-found': {
    label: 'Pointer file URL renders not found',
    plain: 'The root pointer labels a file URL that rendered an HTML not-found page; the hospital pricing page separately links an identity-matched file.',
    action: 'Retain the current first-party file evidence and recheck the exact pointer-declared URL after the publisher changes it.'
  },
  'official-page-file-pointer-unavailable': {
    label: 'Official-page file found; root pointer unavailable',
    plain: 'The official pricing page links an identity-matched MRF, but the root pointer path did not return a usable plain-text pointer.',
    action: 'Retain the verified file evidence and recheck the root pointer after the source page or file changes.'
  },
  'root-pointer-omits-facility': {
    label: 'Root pointer omits facility; page file found',
    plain: 'The root pointer lists other facilities but not this hospital, while its first-party page links an identity-matched file.',
    action: 'Ask the publisher to add the facility and exact file URL to the root pointer; recheck both before any pointer-linked claim.'
  },
  'root-pointer-html-page-file': {
    label: 'Root pointer path serves HTML',
    plain: 'The root cms-hpt.txt path serves an HTML page with pointer-style text; the official pricing page links an identity-matched file.',
    action: 'Retain the current page/file evidence and recheck whether the publisher serves a plain-text pointer at the root path.'
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
  'file-template-version-review': {
    label: 'File template version declaration needs review',
    plain: 'The pointer-linked file identifies this hospital, but its version field does not match the CMS schema identifier. Complete-file schema validity remains unverified.',
    action: 'Check the publisher-declared version against the current CMS schema, request clarification or a corrected file if needed, and validate the complete file before any compliance conclusion.'
  },
  'file-custom-workbook-review': {
    label: 'Pointer links a custom workbook; CMS metadata unverified',
    plain: 'The pointer-linked object identifies this hospital but is an XLSX workbook behind a CSV-labeled URL. Its generation date is not a declared MRF update date, and it declares no CMS template version.',
    action: 'Recheck the exact pointer target after a publisher update and seek a CMS-template CSV or JSON file with its own last_updated_on and version fields.'
  },
  'name-ambiguous': {
    label: 'Hospital match unresolved',
    plain: 'The matching process did not establish which pointer entry represents this hospital.',
    action: 'Manually adjudicate the pointer entries against the CMS roster.'
  },
  'domain-unknown': {
    label: 'Official domain not verified',
    plain: 'No official domain is assigned in this audit; a working website may exist.',
    action: 'Review candidate websites and verify their relationship to this hospital.'
  },
  'site-pointer-review': {
    label: 'Website candidate observed; pointer unverified',
    plain: 'A candidate homepage matched hospital name and location text, but official pointer and MRF linkage remain unverified.',
    action: 'Verify the facility address on the website, then inspect every permitted cms-hpt.txt location and its declared MRF.'
  },
  'corrected-site-pointer-pending': {
    label: 'Official site corrected; pointer review pending',
    plain: 'Reviewed facility identity evidence corrected the hospital domain, but its current root pointer and charge-file linkage remain unresolved.',
    action: 'Recheck the corrected hospital-domain root pointer after a publisher change; verify its exact file target before promoting a finding.'
  },
  'pointer-identity-review': {
    label: 'Pointer and facility identity need review',
    plain: 'A candidate website returned a pointer, but the facility, pointer entry, or charge-file evidence did not fully agree.',
    action: 'Compare the pointer entry and file header with the hospital name, street address, city or ZIP, and license state.'
  },
  'candidate-domain-review': {
    label: 'Candidate website needs verification',
    plain: 'Search returned candidate websites, but none passed official-domain and pointer/MRF verification.',
    action: 'Review the candidate websites and verify first-party facility identity before assigning a domain.'
  },
  'domain-search-pending': {
    label: 'Website search not completed',
    plain: 'No search request is recorded for this hospital in the preserved search batch.',
    action: 'Run the official-domain search, then verify any result against first-party facility identity before assigning it.'
  },
  'domain-search-retry': {
    label: 'Website search request failed',
    plain: 'The recorded search request failed before returning usable candidate results.',
    action: 'Retry the website search, then verify any result against first-party facility identity.'
  },
  'exempt-federal': {
    label: 'Federal, exempt',
    plain: 'VA/DoD facilities are outside the rule.',
    action: 'No action needed.'
  },
  'exempt-ihs-program': {
    label: 'Indian Health Program scope exception',
    plain: '45 CFR 180.30(b)(2) covers hospitals operated by an Indian Health Program; this does not assess MRF availability or file quality.',
    action: 'Retain the sourced operator/program evidence and revisit if the operator, contract, compact, or program status changes.'
  },
  'exempt-state-hospital': {
    label: 'State hospital scope exception',
    plain: '45 CFR 180.30(b) deems Federal and State hospitals compliant with Part 180; this does not assess MRF availability or file quality.',
    action: 'Retain exact facility/operator evidence and revisit if the CCN, operator, or legal state-hospital status changes.'
  },
  'exempt-closed': {
    label: 'Closed facility',
    plain: 'First-party evidence says the facility ceased hospital operations.',
    action: 'No current HPT retrieval work; retain the closure evidence and revisit only if the facility or roster status changes.'
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
    case 'mrf-license-state-field-conflicts-facility':
    case 'mrf-address-field-conflicts-facility':
    case 'mrf-address-field-incomplete':
    case 'mrf-template-version-noncanonical':
    case 'mrf-custom-workbook-metadata-unverified':
    case 'compliant-date-unverified':
      return row.mrf_url || '';
    case 'pointer-lists-no-mrf-url':
    case 'pointer-links-older-mrf-than-source-page':
    case 'pointer-links-different-facility-mrf-source-page-file':
    case 'pricing-page-links-older-mrf-than-pointer':
    case 'pointer-links-unavailable-mrf-source-page-current-file':
    case 'pointer-target-dns-unresolved-page-file-found':
    case 'pointer-links-html-download-page-with-file':
    case 'pointer-html-portal-not-found-source-page-current-file':
    case 'pointer-file-url-renders-not-found-source-page-current-file':
    case 'official-page-mrf-root-pointer-unavailable':
    case 'root-pointer-omits-facility-page-file-found':
    case 'root-pointer-html-page-with-official-page-file':
    case 'not-assessed-not-named-in-file':
      return row.pointer_url || '';
    case 'pointer-blocked-to-automation':
    case 'not-assessed-site-unreachable':
    case 'not-assessed-site-corrected':
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
  if (String(row.finding).startsWith('not-assessed-nationwide-')) return pick('discovery-review', row.evidence);
  if (String(row.finding).startsWith('not-assessed-discovery-')) return pick('discovery-review', row.evidence);

  function blockReason() {
    if (status === 406) return pick('client-rejected', `checked URL returned HTTP 406 to the client at ${evidence.url}`);
    if (edgeBlock) return pick('waf-blocked', `HTTP ${status} with edge attribution ${edge || 'mitigation header'}; blocking rule unverified`);
    return pick('server-blocked', `checked URL returned HTTP ${status} to the client; responsible server layer unverified`);
  }

  switch (row.finding) {
    case 'not-assessed-identity-conflict':
      return pick('identity-review', row.evidence || 'previous file assignment conflicts with hospital identity');
    case 'not-applicable-federal':
      return pick('exempt-federal', 'federally owned; outside 45 CFR 180');
    case 'not-applicable-indian-health-program':
      return pick('exempt-ihs-program', row.evidence || 'hospital operated by an Indian Health Program under 45 CFR 180.30(b)(2)');
    case 'not-applicable-state-hospital':
      return pick('exempt-state-hospital', row.evidence || 'state hospital deemed compliant under 45 CFR 180.30(b)');
    case 'not-applicable-closed':
      return pick('exempt-closed', row.evidence || 'first-party evidence says the facility ceased hospital operations');
    case 'compliant-observed':
      return pick('none', 'pointer and MRF verified with a readable last_updated_on');
    case 'compliant-date-unverified':
      return pick('format-unusable',
        'bounded MRF probe did not recover last_updated_on; file validity is unverified');
    case 'mrf-license-state-field-conflicts-facility':
      return pick('file-license-state-conflict', 'the MRF license-number column names a different state than the pointer-linked facility');
    case 'mrf-address-field-conflicts-facility':
      return pick('file-address-conflict', 'a pointer-linked MRF address field conflicts with the independently verified hospital address');
    case 'mrf-address-field-incomplete':
      return pick('file-address-incomplete', 'the pointer-linked MRF omits part of the independently verified hospital street');
    case 'mrf-template-version-noncanonical':
      return pick('file-template-version-review', `the pointer-linked MRF declares template version ${row.cms_template_version} rather than CMS schema identifier 3.0.0`);
    case 'mrf-custom-workbook-metadata-unverified':
      return pick('file-custom-workbook-review', 'the pointer-linked object is an XLSX workbook behind a CSV-labeled URL; its generation date is not a verified MRF update date and no CMS template version is declared');
    case 'pointer-lists-no-mrf-url':
      return pick('pointer-mrf-unverified', `no MRF URL was extracted for the matched entry for "${row.hospital_name}"`);
    case 'pointer-links-older-mrf-than-source-page':
      return pick('pointer-file-mismatch', 'the official pricing page links a newer identity-matched MRF than the current root pointer');
    case 'pointer-links-different-facility-mrf-source-page-file':
      return pick('pointer-different-facility-file', 'the root pointer links a readable file declaring another facility, while the official pricing page links this facility’s file');
    case 'pricing-page-links-older-mrf-than-pointer':
      return pick('pricing-page-older-file', 'the hospital pricing page links an older identity-matched file than the current root pointer');
    case 'pointer-links-unavailable-mrf-source-page-current-file':
      return pick('pointer-target-unavailable-page-file', 'the current pointer target returned an HTTP error while the official pricing page links a separate identity-matched file');
    case 'pointer-target-dns-unresolved-page-file-found':
      return pick('pointer-target-dns-unresolved', 'the pointer target host did not resolve in the bounded client or browser, while the official pricing page links a separate identity-matched file');
    case 'pointer-links-html-download-page-with-file':
      return pick('pointer-html-intermediary', 'the root pointer mrf-url resolves to an HTML page that links the identity-matched file');
    case 'pointer-html-portal-not-found-source-page-current-file':
      return pick('pointer-portal-not-found', 'the root pointer HTML portal rendered a not-found page while the official pricing page links a separate identity-matched file');
    case 'pointer-file-url-renders-not-found-source-page-current-file':
      return pick('pointer-file-renders-not-found', 'the root pointer file URL rendered an HTML not-found page while the official pricing page links a separate identity-matched file');
    case 'official-page-mrf-root-pointer-unavailable':
      return pick('official-page-file-pointer-unavailable', 'the official pricing page links an identity-matched MRF but the root cms-hpt.txt path did not return a usable pointer');
    case 'root-pointer-omits-facility-page-file-found':
      return pick('root-pointer-omits-facility', 'the root pointer lists other facilities but no Reno entry, while its first-party page links a complete identity-matched CSV');
    case 'root-pointer-html-page-with-official-page-file':
      return pick('root-pointer-html-page-file', 'the root cms-hpt.txt path serves an HTML page, while the official pricing page links an identity-matched file');
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
    case 'not-assessed-site-observed':
      return pick('site-pointer-review', row.evidence);
    case 'not-assessed-site-corrected':
      return pick('corrected-site-pointer-pending', row.evidence);
    case 'not-assessed-pointer-review':
      return pick('pointer-identity-review', row.evidence);
    case 'not-assessed-domain-candidate':
      return pick('candidate-domain-review', row.evidence);
    case 'not-assessed-domain-search-pending':
      return pick('domain-search-pending', row.evidence);
    case 'not-assessed-domain-search-error':
      return pick('domain-search-retry', row.evidence);
    case 'not-assessed-no-domain-candidate':
      return pick('domain-unknown', row.evidence);
    default:
      return pick('manual-review', `unmapped finding ${row.finding}`);
  }
}

function interventionReason(row, classifiedReason, worklistRow) {
  if (!worklistRow || !String(row.finding).startsWith('not-assessed-nationwide-'))
    return classifiedReason;
  return `Unresolved ${worklistRow.current_disposition}. Next: ${worklistRow.next_action}`;
}

// Hoisted helper kept tiny so classifyRow stays readable above.
function hasEdgeAttribution(edge, evidence) {
  if (EDGE_BLOCKERS.has(edge)) return true;
  const mitigated = String((evidence && (evidence.cf_mitigated || evidence.waf_action)) || '');
  return !!mitigated;
}

async function main() {
  const { compliance } = require('./lib/reviewed-resolutions').loadReviewedView(path.dirname(COMPLIANCE));
  let worklistByCcn = new Map();
  if (fs.existsSync(WORKLIST)) {
    const worklist = JSON.parse(await fsp.readFile(WORKLIST, 'utf8'));
    for (const name of ['nationwide-reconciliation.json', 'nationwide-verification.json']) {
      const source = await fsp.readFile(path.join(path.dirname(COMPLIANCE), name));
      const hash = crypto.createHash('sha256').update(source).digest('hex');
      if (worklist.source_sha256?.[name] !== hash)
        throw new Error(`Unresolved worklist is stale against ${name}; rebuild it before interventions`);
    }
    worklistByCcn = new Map(worklist.records.map(row => [row.ccn, row]));
  }
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
      reason: interventionReason(row, reason, worklistByCcn.get(row.ccn)),
      evidence_url: url,
      transcript: evidence ? `data/hpt-audit/curl-evidence/${String(evidence.transcript || '').replace(/\\/g, '/')}` : '',
      checked_at: evidence ? (evidence.checked_at || '') : (row.checked_at || '')
    });
  }
  if (unknownFindings.size) throw new Error(`Classifier produced unknown interventions: ${[...unknownFindings].join(', ')}`);

  rows.sort((a, b) => a.state.localeCompare(b.state) || a.hospital_name.localeCompare(b.hospital_name));
  // Write beside the destination and replace it atomically. Windows readers
  // (including the local tracker server/indexer) can keep the existing CSV
  // open; writing it in place intermittently raises UNKNOWN sharing errors.
  // A same-directory rename preserves the previous complete artifact until
  // the new bytes are ready and avoids exposing a partial CSV to readers.
  const tmpOut = `${OUT}.tmp-${process.pid}`;
  await fsp.writeFile(tmpOut, toCSV(rows, COLUMNS));
  try {
    await fsp.rename(tmpOut, OUT);
  } catch (error) {
    try { await fsp.unlink(tmpOut); } catch {}
    throw error;
  }

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

module.exports = { INTERVENTIONS, COLUMNS, evidenceUrlFor, classifyRow, interventionReason };
