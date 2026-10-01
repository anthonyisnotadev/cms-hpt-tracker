'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../../..');
const audit = path.join(root, 'data/hpt-audit');
const read = name => JSON.parse(fs.readFileSync(path.join(audit, name), 'utf8'));

test('SUN Columbus browser 404s update the next action without becoming file-absence proof', () => {
  const proof = read('reconciliation-sun-columbus-interactive-browser-recheck-2026-09-29.json');
  const manual = read('reconciliation-manual-access-observations.json').records.find(row => row.ccn === proof.ccn);
  const nationwide = read('nationwide-verification.json').records.find(row => row.ccn === proof.ccn);
  const work = read('unresolved-investigation-worklist.json').records.find(row => row.ccn === proof.ccn);
  const crosscheck = read('reconciliation-891-worklist-membership-crosscheck-2026-09-28.json');

  assert.equal(proof.browser_observations.pricing_page_rendered, true);
  assert.equal(proof.browser_observations.csv_bytes_received, false);
  assert.equal(proof.browser_observations.pointer_text_received, false);
  assert.equal(proof.browser_observations.browser_http_status_exposed, false);
  assert.equal(proof.assessment.disposition, 'pointer-discovery-incomplete');
  assert.equal(proof.assessment.disposition_changed, false);
  assert.equal(manual.latest_interactive_browser_recheck.proof_file,
    'reconciliation-sun-columbus-interactive-browser-recheck-2026-09-29.json');
  assert.equal(nationwide.disposition, 'pointer-discovery-incomplete');
  assert.match(work.next_action, /Do not retry the unchanged CSV or cms-hpt\.txt URLs/);
  assert.equal(crosscheck.comparison.cohort_genuinely_unresolved_ccns, 541);
  assert.equal(crosscheck.comparison.historical_cohort_memberships, 891);
  assert.deepEqual(crosscheck.comparison.cohort_unresolved_missing_from_worklist, []);
});
