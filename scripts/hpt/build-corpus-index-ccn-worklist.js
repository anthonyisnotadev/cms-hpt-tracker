'use strict';

// Per-CCN follow-up for indexed pointer versions absent from successful
// final-state targets. Retained old links are leads, never current proof.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { csvToObjects } = require('./lib/util');
const { parsePointer } = require('./lib/parse');
const { normalizeUrl } = require('./pointer-corpus');

const root = path.resolve(__dirname, '../..');
const auditFile = path.join(root, 'data/hpt-audit/corpus-state-index-discrepancies.json');
const verificationFile = path.join(root, 'data/hpt-audit/nationwide-verification.json');
const stateFile = path.join(root, 'cms_data/hpt/pointer-corpus/crawl-state.json');
const indexFile = path.join(root, 'cms_data/hpt/pointer-corpus/cms_hpt_entries.csv');
const resolutionsFile = path.join(root, 'data/hpt-audit/reviewed-resolutions.json');
const rechecksFile = path.join(root, 'data/hpt-audit/corpus-index-priority-one-rechecks.json');
const provenanceRechecksFile = path.join(root, 'data/hpt-audit/pointer-provenance-discrepancy-rechecks.json');
const outputFile = path.join(root, 'data/hpt-audit/corpus-index-ccn-worklist.json');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const split = value => String(value || '').split('|').map(item => item.trim()).filter(Boolean);

function build(audit, verification, state, indexRows, resolutions = [], rechecks = [], provenanceRechecks = []) {
  const byCcn = new Map(verification.records.map(row => [row.ccn, row]));
  const reviewedByCcn = new Map(resolutions.map(row => [row.ccn, row]));
  const recheckByCcn = new Map(rechecks.map(row => [row.ccn, row]));
  const provenanceRecheckByCcn = new Map(provenanceRechecks.map(row => [row.ccn, row]));
  const successful = new Set(Object.values(state.targets || {})
    .filter(target => target.status === 'ok' && target.finalUrl && target.sha256)
    .map(target => `${target.finalUrl}\0${target.sha256}`));
  const activeByCcn = new Map();
  for (const row of indexRows) {
    if (!successful.has(`${row.final_url}\0${row.pointer_sha256}`)) continue;
    for (const ccn of split(row.matched_ccns)) {
      if (!activeByCcn.has(ccn)) activeByCcn.set(ccn, []);
      activeByCcn.get(ccn).push(row);
    }
  }
  const queued = new Map();
  for (const document of audit.discrepancies) for (const ccn of document.matched_ccns) {
    const row = byCcn.get(ccn);
    if (!row) throw new Error(`Indexed CCN ${ccn} absent from nationwide verification`);
    if (!queued.has(ccn)) queued.set(ccn, { ccn, hospital_name: row.hospital_name,
      state: row.state, standing_finding: row.standing_finding,
      nationwide_disposition: row.disposition, selected_mrf_url: row.mrf_url || '',
      observation_role: row.observation_role || '',
      selected_file_observed_at: row.observed_at || '', selected_file_version: row.cms_template_version || '',
      pointer_state: row.pointer_state, pointer_checked_url: row.pointer_corpus_checked_url || '',
      pointer_sha256: row.pointer_corpus_sha256 || '', pointer_observed_at: row.pointer_corpus_observed_at || '',
      stale_index_documents: [] });
    queued.get(ccn).stale_index_documents.push({ pointer_url: document.pointer_url,
      final_url: document.final_url, sha256: document.pointer_sha256,
      fetched_at: document.fetched_at, issue: document.issue });
  }
  const records = [...queued.values()].map(row => {
    const active = activeByCcn.get(row.ccn) || [];
    const activeLinks = [...new Map(active.map(item => [item.mrf_url, {
      mrf_url: item.mrf_url, pointer_url: item.pointer_url,
      pointer_sha256: item.pointer_sha256, fetched_at: item.fetched_at
    }])).values()].filter(item => item.mrf_url);
    // URL hostnames are case-insensitive; signed paths and query values are
    // not. Normalize only URL components that are safe to canonicalize.
    const selectedFileInActiveLinks = activeLinks.some(item => normalizeUrl(item.mrf_url)
      === normalizeUrl(row.selected_mrf_url));
    const reviewed = reviewedByCcn.get(row.ccn);
    const reviewedPointer = reviewed?.evidence?.pointerUrl && reviewed?.evidence?.pointerSha256
      && Object.values(state.targets || {}).some(target => target.status === 'ok'
        && target.sha256 === reviewed.evidence.pointerSha256
        && [target.input, target.acceptedUrl, target.finalUrl].includes(reviewed.evidence.pointerUrl));
    // A later guarded review can corroborate exact pointer/file bytes even
    // before the crawl state adopts its URL alias. Preserve the stale index
    // version, but do not queue it as an unreviewed active-file gap.
    const reviewedIndexPointer = reviewed?.evidence?.identity === 'corroborated'
      && /^[a-f0-9]{64}$/.test(String(reviewed.evidence.fileSha256 || ''))
      && /^2\d\d$/.test(String(reviewed.evidence.http_status || ''))
      && reviewed.evidence.url === row.selected_mrf_url
      && indexRows.some(item => item.record_status === 'ok'
        && item.pointer_sha256 === reviewed.evidence.pointerSha256
        && item.mrf_url === reviewed.evidence.url
        && item.location_name === reviewed.evidence.location_name);
    const reviewedCurrentProof = reviewed?.action === 'replace-observation' && (reviewedPointer || reviewedIndexPointer)
      && reviewed.evidence?.url && reviewed.evidence?.observedFinding
      && Number.isFinite(Date.parse(reviewed.evidence.checked_at))
      && row.stale_index_documents.every(item => Date.parse(reviewed.evidence.checked_at) > Date.parse(item.fetched_at));
    const recheck = recheckByCcn.get(row.ccn);
    const provenanceRecheck = provenanceRecheckByCcn.get(row.ccn);
    const currentProvenanceRecheck = ['superseded-retry', 'incomplete-retry-standing-retained'].includes(row.observation_role)
      && !!provenanceRecheck?.retained_file
      && provenanceRecheck?.checked_url === row.pointer_checked_url
      && byCcn.get(row.ccn)?.mrf_url === row.selected_mrf_url
      && provenanceRecheck.complete_pointer_bytes === true
      && Number(provenanceRecheck.http_status) >= 200 && Number(provenanceRecheck.http_status) < 300
      && /^[a-f0-9]{64}$/.test(String(provenanceRecheck.response_sha256 || ''))
      && row.stale_index_documents.every(item => Date.parse(provenanceRecheck.observed_at) > Date.parse(item.fetched_at));
    const currentRootRecheck = row.observation_role === 'superseded-retry'
      && recheck?.selected_file_in_pointer && recheck.selected_mrf_url === row.selected_mrf_url
      && Number(recheck.http_status) >= 200 && Number(recheck.http_status) < 300
      && row.stale_index_documents.every(item => Date.parse(recheck.checked_at) > Date.parse(item.fetched_at));
    const priority = reviewedCurrentProof || currentRootRecheck || currentProvenanceRecheck ? 4 : !activeLinks.length ? 1 : !selectedFileInActiveLinks ? 2 : 3;
    return { ...row, active_successful_pointer_links: activeLinks,
      selected_file_in_active_links: selectedFileInActiveLinks,
      reviewed_current_proof: reviewedCurrentProof ? {
        source: reviewedPointer ? 'reviewed-ledger-and-successful-state' : 'reviewed-ledger-and-corpus-byte-match',
        observed_finding: reviewed.evidence.observedFinding, pointer_url: reviewed.evidence.pointerUrl,
        pointer_sha256: reviewed.evidence.pointerSha256,
        file_url: reviewed.evidence.url, checked_at: reviewed.evidence.checked_at,
        evidence_run: reviewed.evidence_run
      } : currentProvenanceRecheck ? {
        source: 'later-hash-bound-provenance-recheck', pointer_url: provenanceRecheck.checked_url,
        pointer_sha256: provenanceRecheck.response_sha256, file_url: provenanceRecheck.selected_mrf_url,
        checked_at: provenanceRecheck.observed_at, reviewed_hash_matches_current_pointer: true
      } : currentRootRecheck ? {
        source: 'bounded-current-root-recheck', pointer_url: recheck.pointer_url,
        pointer_sha256: recheck.sha256, file_url: recheck.selected_mrf_url,
        checked_at: recheck.checked_at, reviewed_hash_matches: recheck.reviewed_hash_matches
      } : null,
      priority, next_step: currentRootRecheck || currentProvenanceRecheck
        ? 'Dated current root bytes list the selected file; keep the older index version historical and recheck file bytes/metadata on the next crawl.'
        : priority === 4
        ? 'Reviewed current pointer/file proof supersedes this stale index link; retain the specific finding and recheck the publisher/index on a later crawl.'
        : priority === 1
        ? 'Inspect current first-party pointer entries and matched file header for this exact CCN; preserve the older indexed link only as historical.'
        : priority === 2
          ? 'Reconcile the selected file against the active pointer-linked alternatives and their facility-specific headers before changing the standing finding.'
          : 'Confirm the active same-file link and separate any older indexed pointer version from current provenance.' };
  }).sort((a, b) => a.priority - b.priority || a.ccn.localeCompare(b.ccn));
  return { summary: { ccns: records.length, by_priority: Object.fromEntries([1, 2, 3, 4]
    .map(priority => [priority, records.filter(row => row.priority === priority).length])) }, records };
}

function main() {
  const recheckBytes = fs.existsSync(rechecksFile) ? fs.readFileSync(rechecksFile) : Buffer.from('{"records":[]}');
  const provenanceRecheckBytes = fs.existsSync(provenanceRechecksFile) ? fs.readFileSync(provenanceRechecksFile) : Buffer.from('{"records":[]}');
  const recheckReport = JSON.parse(recheckBytes);
  const provenanceRecheckReport = JSON.parse(provenanceRecheckBytes);
  const verifiedRechecks = (recheckReport.records || []).filter(record => {
    const raw = path.resolve(root, record.raw_artifact || '');
    if (!record.raw_artifact || !raw.startsWith(root + path.sep) || !fs.existsSync(raw)) return false;
    const bytes = fs.readFileSync(raw);
    return bytes.length === record.bytes_retained && sha(bytes) === record.sha256
      && parsePointer(bytes.toString('utf8')).entries.some(entry => entry.mrfUrls?.includes(record.selected_mrf_url));
  });
  const verifiedProvenanceRechecks = (provenanceRecheckReport.records || []).filter(record => {
    if (record.http_status < 200 || record.http_status >= 300 || record.complete_pointer_bytes !== true
      || !/^[a-f0-9]{64}$/.test(String(record.response_sha256 || '')) || !record.retained_file) return false;
    const raw = path.resolve(root, record.retained_file);
    if (!raw.startsWith(root + path.sep) || !fs.existsSync(raw)) return false;
    const bytes = fs.readFileSync(raw);
    return bytes.length === record.response_bytes && sha(bytes) === record.response_sha256
      && parsePointer(bytes.toString('utf8')).entries.some(entry => entry.mrfUrls?.includes(
        (JSON.parse(fs.readFileSync(verificationFile, 'utf8')).records.find(item => item.ccn === record.ccn)?.mrf_url || '')));
  });
  const inputs = { 'corpus-state-index-discrepancies.json': fs.readFileSync(auditFile),
    'nationwide-verification.json': fs.readFileSync(verificationFile),
    'crawl-state.json': fs.readFileSync(stateFile),
    'cms_hpt_entries.csv': fs.readFileSync(indexFile),
    'reviewed-resolutions.json': fs.readFileSync(resolutionsFile),
    'corpus-index-priority-one-rechecks.json': recheckBytes,
    'pointer-provenance-discrepancy-rechecks.json': provenanceRecheckBytes };
  const report = build(JSON.parse(inputs['corpus-state-index-discrepancies.json']),
    JSON.parse(inputs['nationwide-verification.json']), JSON.parse(inputs['crawl-state.json']),
    csvToObjects(inputs['cms_hpt_entries.csv'].toString('utf8')),
    JSON.parse(inputs['reviewed-resolutions.json']), verifiedRechecks, verifiedProvenanceRechecks);
  report.source_sha256 = Object.fromEntries(Object.entries(inputs).map(([name, bytes]) => [name, sha(bytes)]));
  fs.writeFileSync(outputFile, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report.summary));
}

if (require.main === module) main();
module.exports = { build };
