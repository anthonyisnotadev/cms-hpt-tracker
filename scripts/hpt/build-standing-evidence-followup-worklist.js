'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const reconciliationPath = path.join(audit, 'nationwide-reconciliation.json');
const verificationPath = path.join(audit, 'nationwide-verification.json');
const outputPath = path.join(audit, 'standing-evidence-followup-worklist.json');

const browserRetry = /^(?:Retry the exact pointer-declared MRF in a browser\/download-capable client|Compare the exact URL in an interactive browser|Retry with an alternate client and interactive browser)\.?$/;

function build(reconciliation, verification) {
  const byCcn = new Map(verification.records.map(row => [row.ccn, row]));
  const records = reconciliation.records.filter(row => row.workstream === 'standing-evidence-follow-up')
    .map(row => {
      const current = byCcn.get(row.ccn);
      if (!current || !row.standing_finding || !row.next_action)
        throw new Error(`Incomplete standing follow-up ${row.ccn}`);
      const reviewedAction = row.manual_access_observation?.next_action || '';
      const reviewedFollowUp = Boolean(reviewedAction)
        || row.issues?.includes('reviewed-pointer-target-client-follow-up')
        || row.issues?.includes('reviewed-html-root-pointer-follow-up')
        || row.issues?.includes('reviewed-pointer-or-page-linkage-follow-up');
      let nextAction = reviewedAction || row.next_action;
      if (!reviewedAction && browserRetry.test(nextAction) && current.browser_mrf_status) {
        nextAction = 'The exact file already had a browser result (' + current.browser_mrf_status
          + '). Preserve the standing finding; retry only through a materially different permitted route, after a publisher change, or with publisher-provided access. Then verify bounded bytes and facility identity. A client result is not a file-validity verdict.';
      }
      return {
        ccn: row.ccn, hospital_name: row.hospital_name, state: row.state,
        priority: row.priority, standing_finding: row.standing_finding,
        current_disposition: row.proposed_disposition,
        standing_checked_at: row.standing_checked_at,
        latest_observed_at: row.issues?.includes('later-manual-observation-follow-up')
          ? row.manual_access_observation?.observed_at || row.manual_correction_reconciliation?.manual_checked_at
          : row.latest_observed_at || row.standing_checked_at,
        latest_observation_source: row.issues?.includes('later-manual-observation-follow-up')
          ? 'later-manual' : row.latest_observed_at ? 'nationwide' : 'reviewed-standing',
        ...(row.issues?.includes('later-manual-observation-follow-up')
          ? { nationwide_observed_at: row.latest_observed_at } : {}),
        browser_file_status: current.browser_mrf_status || '',
        browser_file_observed_at: current.browser_mrf_observed_at || '',
        reviewed_follow_up: reviewedFollowUp,
        next_action: nextAction,
      };
    }).sort((a, b) => a.priority - b.priority
      || Number(a.reviewed_follow_up) - Number(b.reviewed_follow_up)
      || a.ccn.localeCompare(b.ccn));
  if (new Set(records.map(row => row.ccn)).size !== records.length)
    throw new Error('Duplicate standing follow-up CCN');
  return { summary: { total: records.length,
    browser_retry_replaced: records.filter(row => row.next_action.startsWith('The exact file already had a browser result')).length },
  records };
}

function main() {
  const reconciliation = JSON.parse(fs.readFileSync(reconciliationPath, 'utf8'));
  const verification = JSON.parse(fs.readFileSync(verificationPath, 'utf8'));
  const result = build(reconciliation, verification);
  result.source_sha256 = {
    'nationwide-reconciliation.json': crypto.createHash('sha256').update(fs.readFileSync(reconciliationPath)).digest('hex'),
    'nationwide-verification.json': crypto.createHash('sha256').update(fs.readFileSync(verificationPath)).digest('hex'),
  };
  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result.summary));
}

if (require.main === module) main();
module.exports = { build };
