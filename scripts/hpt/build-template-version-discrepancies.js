'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { loadReviewedView } = require('./lib/reviewed-resolutions');
const { applyNationwideVerification } = require('./lib/nationwide-verification-view');

const ROOT = path.resolve(__dirname, '..', '..');
const AUDIT = path.join(ROOT, 'data', 'hpt-audit');
const REPORT = path.join(AUDIT, 'nationwide-verification.json');
const OUTPUT = path.join(AUDIT, 'template-version-discrepancies.json');
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function collect(records, standing) {
  const byCcn = new Map(standing.map(row => [row.ccn, row]));
  const relevant = records.filter(row => row.disposition === 'verified-template-review'
    && row.prior_finding === 'compliant-observed'
    && row.cms_template_version && row.cms_template_version !== '3.0.0'
    && !row.latest_observation_superseded && !row.standing_evidence_retained);
  const presented = new Map(applyNationwideVerification(standing, records).map(row => [row.ccn, row]));
  return relevant.map(row => {
    const prior = byCcn.get(row.ccn);
    if (!prior) throw new Error(`Missing standing row ${row.ccn}`);
    const sameFile = prior.mrf_url === row.mrf_url;
    const current = presented.get(row.ccn);
    return {
      ccn: row.ccn, hospital_name: row.hospital_name, state: row.state,
      literal_template_version: row.cms_template_version,
      declared_last_updated: row.declared_last_updated,
      standing_template_version: prior.cms_template_version,
      standing_finding: prior.finding, displayed_finding: current.finding,
      standing_mrf_url: prior.mrf_url, observed_mrf_url: row.mrf_url,
      same_file_url: sameFile, header_identity_gate: row.header_identity_gate,
      observed_file_http_status: row.mrf_http_status,
      observed_at: row.observed_at, pointer_state: row.pointer_state,
      pointer_corpus_checked_url: row.pointer_corpus_checked_url,
      pointer_corpus_sha256: row.pointer_corpus_sha256,
      pointer_corpus_raw_integrity: row.pointer_corpus_raw_integrity,
      selected_header_pointer_sha256s: row.evidence?.pointer_sha256s || [],
      header_match_reason: row.evidence?.header_match_reason || '',
      matched_mrf_candidates: row.evidence?.matched_mrf_candidates || 0,
      facility_identity: row.facility_identity,
      metadata_source: row.metadata_source,
      review_priority: sameFile ? '3-same-file-metadata-review'
        : current.finding === 'mrf-template-version-noncanonical' ? '2-different-file-replaced-with-exact-pointer-proof'
          : '1-different-file-pointer-match-unresolved',
      next_action: sameFile ? 'Validate complete-file structure and monitor publisher correction of the literal version.'
        : current.finding === 'mrf-template-version-noncanonical'
          ? 'Validate the complete replacement file and monitor correction of the literal template identifier; retain displaced file in history.'
          : 'Resolve the first-party pointer entry to this exact CCN before replacing the standing file; retain the matched file header as separate evidence.'
    };
  }).sort((a, b) => a.review_priority.localeCompare(b.review_priority) || a.ccn.localeCompare(b.ccn));
}

function main() {
  const bytes = fs.readFileSync(REPORT);
  const report = JSON.parse(bytes);
  const standing = loadReviewedView(AUDIT, { nationwide: false }).compliance;
  const records = collect(report.records, standing);
  const summary = {
    generated_from_nationwide_report_at: report.summary.generated_at,
    source_nationwide_sha256: sha256(bytes),
    total: records.length,
    same_file_metadata_review: records.filter(row => row.same_file_url).length,
    different_file_pointer_identity_review: records.filter(row => !row.same_file_url).length,
    different_file_replaced_with_exact_pointer_proof: records.filter(row => row.review_priority === '2-different-file-replaced-with-exact-pointer-proof').length,
    different_file_pointer_match_unresolved: records.filter(row => row.review_priority === '1-different-file-pointer-match-unresolved').length,
    displayed_noncanonical: records.filter(row => row.displayed_finding === 'mrf-template-version-noncanonical').length,
    note: 'Observed literal versions and bounded identity/header checks; not a legal compliance determination or a full-file validation.'
  };
  fs.writeFileSync(OUTPUT, JSON.stringify({ summary, records }, null, 2) + '\n');
  console.log(JSON.stringify(summary, null, 2));
}

if (require.main === module) main();
module.exports = { collect };
