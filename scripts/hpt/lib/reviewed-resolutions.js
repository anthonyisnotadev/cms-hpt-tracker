'use strict';
const fs = require('fs');
const path = require('path');
const { csvToObjects } = require('./util');
const { metadataStatus } = require('../recheck-interventions');

// Apply a reviewed, dated ledger to the current presentation. Original audit
// CSVs remain immutable, and base checks prevent an old correction overriding
// a subsequent crawl. All builders consume this same effective view.
function applyResolutions(compliance, manifest, gaps, resolutions = []) {
  const by = new Map(), history = {};
  for (const r of resolutions) {
    if (by.has(r.ccn)) throw new Error(`Duplicate resolution ${r.ccn}`);
    if (!['replace', 'quarantine'].includes(r.action)) throw new Error(`Unknown resolution action ${r.action}`);
    by.set(r.ccn, r);
  }
  const applied = new Map();
  const rows = compliance.map(row => {
    const resolution = by.get(row.ccn);
    if (!resolution) return row;
    if (['finding', 'domain', 'pointer_url', 'mrf_url', 'checked_at'].some(k => (row[k] || '') !== (resolution.base[k] || ''))) return row;
    const e = resolution.evidence;
    if (resolution.action === 'replace') {
      if (!e || e.identity !== 'corroborated' || !e.pointerUrl || !e.url || !e.pointerSha256
          || !/^2\d\d$/.test(String(e.http_status)) || !e.checked_at
          || metadataStatus({ declared_date: e.date, version: e.version }, Date.parse(e.checked_at)) !== 'date-within-365-days-version-3') {
        throw new Error(`Resolution ${row.ccn} lacks current, pointer-linked identity and metadata evidence`);
      }
    }
    history[row.ccn] = { ...row, resolution_note: resolution.note };
    applied.set(row.ccn, resolution);
    if (resolution.action === 'quarantine') return { ...row,
      finding: 'not-assessed-identity-conflict', assessable: 'no', domain: resolution.official?.domain || '',
      pointer_url: '', mrf_url: '', mrf_last_updated: '', mrf_days_since_update: '', cms_template_version: '',
      checked_at: resolution.reviewed_at, evidence: resolution.note };
    return { ...row, finding: 'compliant-observed', assessable: 'yes',
      domain: e.officialDomain || new URL(e.pointerUrl).hostname, pointer_url: e.pointerUrl, mrf_url: e.url,
      mrf_last_updated: e.date, mrf_days_since_update: String(Math.floor((Date.parse(e.checked_at) - Date.parse(e.date + 'T00:00:00Z')) / 86400000)),
      cms_template_version: e.version, checked_at: e.checked_at,
      evidence: `Reviewed pointer/file identity and location; declared update ${e.date}, version ${e.version}. ${resolution.note}` };
  });
  const rowBy = new Map(rows.map(r => [r.ccn, r]));
  const manBy = new Map(manifest.map(r => [r.ccn, r]));
  for (const [ccn, resolution] of applied) {
    if (resolution.action === 'quarantine') { manBy.delete(ccn); continue; }
    const row = rowBy.get(ccn), e = resolution.evidence;
    manBy.set(ccn, { ...(manBy.get(ccn) || {}), ...row,
      location_name: e.location_name, pointer_via: 'reviewed-direct', source_page_url: e.sourcePageUrl || '', extra_mrf_urls: '',
      mrf_format: e.file_kind, mrf_last_updated_raw: e.date, mrf_date_source: 'file-metadata',
      mrf_stale_over_365: 'no', mrf_cms_version: e.version, mrf_bytes: '', match_method: 'reviewed-header-and-pointer',
      match_corroboration: e.identity_basis, mrf_file_kind: e.file_kind, mrf_http_status: e.http_status,
      mrf_checked_at: e.checked_at, mrf_http_last_modified_diagnostic: '' });
  }
  const remaining = gaps.filter(r => !applied.has(r.ccn));
  for (const [ccn, resolution] of applied) if (resolution.action === 'quarantine') {
    const row = rowBy.get(ccn);
    remaining.push({ ...row, remediation: 'name-match-review', reason: resolution.note, seeded_domain: row.domain, pointer_status: 'identity-review' });
  }
  return { compliance: rows, manifest: [...manBy.values()], gaps: remaining, history, applied: [...applied.keys()] };
}

function loadReviewedView(dir) {
  const read = file => csvToObjects(fs.readFileSync(path.join(dir, file), 'utf8'));
  const ledger = path.join(dir, 'reviewed-resolutions.json');
  return applyResolutions(read('compliance.csv'), read('manifest.csv'), read('gaps.csv'),
    fs.existsSync(ledger) ? JSON.parse(fs.readFileSync(ledger, 'utf8')) : []);
}
module.exports = { applyResolutions, loadReviewedView };
