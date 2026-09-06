'use strict';

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const { csvToObjects, toCSV, normalizeName } = require('./lib/util');
const { normalizeUrl } = require('./pointer-corpus');

const ROOT = path.join(__dirname, '..', '..');
const DEFAULT_STAGE = path.join(ROOT, 'data', 'hpt-audit', '.domain-discovery', 'full-prod-20260906');

function arg(name, fallback) {
  const prefix = `--${name}=`;
  const value = process.argv.find(item => item.startsWith(prefix));
  return value ? value.slice(prefix.length) : fallback;
}

async function readCsv(file) {
  return csvToObjects(await fsp.readFile(file, 'utf8'));
}

function urlKey(value) {
  try { return normalizeUrl(value); } catch (_error) { return ''; }
}

async function main() {
  const stage = path.resolve(arg('stage-dir', DEFAULT_STAGE));
  const complianceFile = path.resolve(arg('compliance', path.join(ROOT, 'data', 'hpt-audit', 'compliance.csv')));
  const headersFile = path.resolve(arg('headers', path.join(stage, 'manifest_mrf_headers.csv')));
  const verifiedFile = path.resolve(arg('verified-domains', path.join(stage, 'name-blocked-priority', 'verified.csv')));
  const outDir = path.resolve(arg('out-dir', path.join(stage, 'banked')));

  const [compliance, headers, verifiedDomains] = await Promise.all([
    readCsv(complianceFile), readCsv(headersFile), readCsv(verifiedFile)
  ]);
  const headersByUrl = new Map(headers.map(row => [urlKey(row.mrf_url), row]).filter(([key]) => key));

  const recovered = compliance
    .filter(row => row.finding === 'mrf-url-unreachable')
    .map(row => ({ old: row, fresh: headersByUrl.get(urlKey(row.mrf_url)) }))
    .filter(({ old, fresh }) => {
      if (!fresh || fresh.header_status !== 'matched') return false;
      if (!/^2\d\d$/.test(String(fresh.mrf_range_status || fresh.mrf_http_status || ''))) return false;
      return String(fresh.header_matched_ccns || '').split('|').includes(old.ccn);
    })
    .map(({ old, fresh }) => ({
      ccn: old.ccn,
      hospital_name: old.hospital_name,
      city: old.city,
      state: old.state,
      old_finding: old.finding,
      domain: old.domain,
      pointer_url: old.pointer_url,
      mrf_url: old.mrf_url,
      fresh_http_status: fresh.mrf_http_status,
      fresh_range_status: fresh.mrf_range_status,
      header_status: fresh.header_status,
      matched_ccns: fresh.header_matched_ccns,
      mrf_hospital_name: fresh.mrf_hospital_name,
      mrf_license_state: fresh.mrf_license_state,
      mrf_last_updated: fresh.mrf_last_updated,
      checked_at: fresh.checked_at
    }))
    .sort((a, b) => a.ccn.localeCompare(b.ccn));

  const reachableReview = compliance
    .filter(row => row.finding === 'mrf-url-unreachable')
    .map(row => ({ old: row, fresh: headersByUrl.get(urlKey(row.mrf_url)) }))
    .filter(({ fresh }) => fresh && fresh.header_status === 'review'
      && /^2\d\d$/.test(String(fresh.mrf_range_status || fresh.mrf_http_status || '')))
    .map(({ old, fresh }) => ({
      ccn: old.ccn,
      hospital_name: old.hospital_name,
      city: old.city,
      state: old.state,
      old_finding: old.finding,
      domain: old.domain,
      pointer_url: old.pointer_url,
      mrf_url: old.mrf_url,
      fresh_http_status: fresh.mrf_http_status,
      fresh_range_status: fresh.mrf_range_status,
      header_status: fresh.header_status,
      review_ccns: fresh.review_ccns,
      review_hospital_names: fresh.review_hospital_names,
      mrf_hospital_name: fresh.mrf_hospital_name,
      mrf_location_name: fresh.mrf_location_name,
      mrf_address: fresh.mrf_address,
      mrf_license_state: fresh.mrf_license_state,
      checked_at: fresh.checked_at
    }))
    .sort((a, b) => a.ccn.localeCompare(b.ccn));

  const resolvedReview = reachableReview.filter(row =>
    String(row.review_ccns || '').split('|').includes(row.ccn)
    && normalizeName(row.mrf_hospital_name) === normalizeName(row.hospital_name)
    && String(row.mrf_license_state || '').toUpperCase() === String(row.state || '').toUpperCase());

  const confirmedDomains = verifiedDomains
    .filter(row => row.status === 'verified' && row.promotion_note === 'already-assigned')
    .map(row => ({
      ccn: row.ccn,
      hospital_name: row.hospital_name,
      city: row.city,
      state: row.state,
      previous_domain: row.previous_domain,
      confirmed_domain: row.resolved_domain || row.candidate_domain,
      pointer_url: row.pointer_url,
      pointer_location_name: row.pointer_location_name,
      pointer_sha256: row.pointer_sha256,
      source_page_url: row.source_page_url,
      mrf_url: row.mrf_url,
      mrf_http_status: row.mrf_http_status,
      mrf_range_status: row.mrf_range_status,
      mrf_file_kind: row.mrf_file_kind,
      mrf_content_type: row.mrf_content_type,
      mrf_license_state: row.mrf_license_state,
      mrf_hospital_name: row.mrf_hospital_name,
      mrf_location_name: row.mrf_location_name,
      mrf_address: row.mrf_address,
      mrf_last_updated: row.mrf_last_updated,
      mrf_cms_version: row.mrf_cms_version,
      status: row.status,
      reason: row.reason,
      checked_at: row.checked_at,
      promotion_note: row.promotion_note
    }))
    .sort((a, b) => a.ccn.localeCompare(b.ccn));

  await fsp.mkdir(outDir, { recursive: true });
  await Promise.all([
    fsp.writeFile(path.join(outDir, 'confirmed_mrf_recoveries.csv'), toCSV(recovered), 'utf8'),
    fsp.writeFile(path.join(outDir, 'reachable_mrf_header_review.csv'), toCSV(reachableReview), 'utf8'),
    fsp.writeFile(path.join(outDir, 'confirmed_mrf_review_resolutions.csv'), toCSV(resolvedReview), 'utf8'),
    fsp.writeFile(path.join(outDir, 'confirmed_domain_identities.csv'), toCSV(confirmedDomains), 'utf8'),
    fsp.writeFile(path.join(outDir, 'summary.json'), `${JSON.stringify({
      generated_at: new Date().toISOString(),
      confirmed_mrf_recoveries: recovered.length,
      reachable_mrf_header_review: reachableReview.length,
      confirmed_mrf_review_resolutions: resolvedReview.length,
      total_confirmed_mrf_recoveries: recovered.length + resolvedReview.length,
      confirmed_existing_domain_identities: confirmedDomains.length,
      source_files: {
        compliance: path.relative(ROOT, complianceFile).replace(/\\/g, '/'),
        headers: path.relative(ROOT, headersFile).replace(/\\/g, '/'),
        verified_domains: path.relative(ROOT, verifiedFile).replace(/\\/g, '/')
      },
      public_data_changed: false
    }, null, 2)}\n`, 'utf8')
  ]);
  console.log(JSON.stringify({ out_dir: path.relative(ROOT, outDir), recovered: recovered.length,
    reachable_review: reachableReview.length, resolved_review: resolvedReview.length,
    confirmed_domains: confirmedDomains.length }, null, 2));
}

main().catch(error => { console.error(error && error.stack || error); process.exitCode = 1; });
