'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { csvToObjects, toCSV } = require('./lib/util');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const headersPath = path.join(root, 'cms_data/hpt/nationwide-verification/mrf-headers.csv');
const rosterPath = path.join(root, 'cms_data/Hospital_General_Information.csv');
const pointerPath = path.join(root, 'cms_data/hpt/pointer-corpus/cms_hpt_entries.csv');
const outputPath = path.join(audit, 'html-pointer-target-queue.csv');
const columns = ['priority', 'ccn', 'hospital_name', 'state', 'target_kind', 'review_status',
  'pointer_url', 'pointer_mrf_url', 'observed_http_status', 'observed_content_type', 'header_checked_at',
  'review_checked_at', 'next_action'];

function buildQueue(headers, pointers, facilities, resolutions, challenges = [], accessReviews = []) {
  const roster = new Map(facilities.map(row => [row['Facility ID'], row]));
  const resolved = new Map(resolutions.map(row => [row.ccn, row]));
  const challenged = new Map(challenges.map(row => [row.ccn, row]));
  const accessReviewed = new Map(accessReviews.map(row => [row.ccn, row]));
  const rows = [];
  for (const header of headers) {
    if (!['200', '206'].includes(String(header.mrf_http_status))
        || !/text\/html/i.test(header.mrf_content_type || '')
        || header.mrf_file_kind !== 'html') continue;
    const ccns = String(header.existing_matched_ccns || '').split('|').filter(Boolean);
    for (const ccn of ccns) {
      const facility = roster.get(ccn);
      const pointer = pointers.find(row => String(row.matched_ccns || '').split('|').includes(ccn)
        && row.mrf_url === header.mrf_url);
      if (!facility) continue;
      const filename = (() => { try { return new URL(header.mrf_url).pathname.split('/').pop().toLowerCase(); } catch { return ''; } })();
      const fileLike = /\.(csv|json|zip|xlsx?|ashx|rtf)$/.test(filename) || /standardcharges/i.test(filename);
      const prior = resolved.get(ccn);
      const reviewedFinding = pointer ? prior?.evidence?.observedFinding : '';
      const reviewed = ['pointer-links-html-download-page-with-file',
        'pointer-html-portal-not-found-source-page-current-file',
        'pointer-file-url-renders-not-found-source-page-current-file'].includes(reviewedFinding);
      const challenge = pointer && challenged.get(ccn);
      const challengeMatches = challenge && challenge.pointer_url === pointer.pointer_url
        && challenge.pointer_mrf_url === header.mrf_url && challenge.http_status === 200
        && challenge.html_title === 'Radware Captcha Page' && challenge.observed_at;
      const accessReview = pointer && accessReviewed.get(ccn);
      const accessReviewMatches = accessReview && accessReview.pointer_url === pointer.pointer_url
        && accessReview.target_sha256 === crypto.createHash('sha256').update(header.mrf_url).digest('hex')
        && accessReview.observed_at && accessReview.next_action
        && ['reviewed-current-pointer-linkage-unverified', 'reviewed-pricer-app-shell-no-csv-proof']
          .includes(accessReview.review_status);
      rows.push({
        priority: reviewed ? 3 : challengeMatches ? 2 : pointer && !fileLike ? 1 : 2,
        ccn, hospital_name: facility['Facility Name'], state: facility.State,
        target_kind: challengeMatches ? 'automation-challenge-html'
          : fileLike ? 'file-like-url-returned-html' : 'html-page-or-portal-target',
        review_status: reviewed ? reviewedFinding === 'pointer-links-html-download-page-with-file'
          ? 'reviewed-html-intermediary-with-file-proof'
          : reviewedFinding === 'pointer-html-portal-not-found-source-page-current-file'
            ? 'reviewed-portal-not-found-with-first-party-file-proof'
            : 'reviewed-file-url-not-found-with-first-party-file-proof'
          : challengeMatches ? 'observed-automation-captcha-preserve-prior-evidence'
          : accessReviewMatches ? accessReview.review_status
          : pointer ? 'needs-target-and-link-review' : 'existing-link-not-exact-pointer-matched',
        pointer_url: pointer?.pointer_url || '', pointer_mrf_url: header.mrf_url,
        observed_http_status: header.mrf_http_status, observed_content_type: header.mrf_content_type,
        header_checked_at: header.checked_at, review_checked_at: challengeMatches ? challenge.observed_at
          : accessReviewMatches ? accessReview.observed_at : '',
        next_action: reviewed
          ? reviewedFinding === 'pointer-file-url-renders-not-found-source-page-current-file'
            ? 'Retain the current first-party file evidence; recheck the exact pointer-declared file URL after a publisher change.'
            : 'Retain reviewed portal/page/file proof; recheck only after the pointer or linked file changes.'
          : challengeMatches ? challenge.next_action
          : accessReviewMatches ? accessReview.next_action
          : !pointer
            ? 'Resolve exact per-CCN root-pointer linkage before using this shared HTML target as facility evidence.'
          : fileLike
            ? 'Diagnose why this file-like URL returned HTML before treating it as a download page or an invalid file.'
            : 'Open the exact pointer target, inspect its file link, then separately verify facility identity and bounded file metadata.'
      });
    }
  }
  return rows.sort((a, b) => a.priority - b.priority || a.ccn.localeCompare(b.ccn) || a.pointer_mrf_url.localeCompare(b.pointer_mrf_url));
}

function main() {
  const headers = csvToObjects(fs.readFileSync(headersPath, 'utf8'));
  const pointers = csvToObjects(fs.readFileSync(pointerPath, 'utf8'));
  const facilities = csvToObjects(fs.readFileSync(rosterPath, 'utf8'));
  const resolutions = JSON.parse(fs.readFileSync(path.join(audit, 'reviewed-resolutions.json'), 'utf8'));
  const challengePath = path.join(audit, 'reconciliation-geisinger-challenge-observations.json');
  const accessReviewPath = path.join(audit, 'reconciliation-html-target-access-reviews.json');
  const challengeProof = fs.existsSync(challengePath) ? JSON.parse(fs.readFileSync(challengePath, 'utf8')) : null;
  if (challengeProof) {
    const pointerSample = fs.readFileSync(path.join(root, challengeProof.pointer_sample));
    const digest = crypto.createHash('sha256').update(pointerSample).digest('hex');
    if (digest !== challengeProof.pointer_sha256) throw new Error('Geisinger challenge pointer proof hash changed');
  }
  const accessReviews = fs.existsSync(accessReviewPath)
    ? JSON.parse(fs.readFileSync(accessReviewPath, 'utf8')).observations : [];
  const rows = buildQueue(headers, pointers, facilities, resolutions, challengeProof?.observations || [], accessReviews);
  fs.writeFileSync(outputPath, toCSV(rows, columns));
  console.log(JSON.stringify({ rows: rows.length, pending: rows.filter(row => row.priority !== 3).length,
    reviewed: rows.filter(row => row.priority === 3).length, output: path.relative(root, outputPath) }));
}

if (require.main === module) main();
module.exports = { buildQueue };
