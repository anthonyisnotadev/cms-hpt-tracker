'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../../..');
const audit = path.join(root, 'data/hpt-audit');
const proofName = 'reconciliation-asante-ashland-city-affiliation-termination-crosscheck-2026-09-29.json';
const proof = JSON.parse(fs.readFileSync(path.join(audit, proofName), 'utf8'));
const manual = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-manual-access-observations.json'), 'utf8'));
const browser = JSON.parse(fs.readFileSync(path.join(audit, 'nationwide-browser-reviews.json'), 'utf8'));
const cohort = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-891-baseline-member-roster-2026-09-27.json'), 'utf8'));

assert.equal(proof.ccn, '380005');
assert.equal(proof.source.url, 'https://ashlandoregon.gov/m/newsflash/Archive/Item/512?arcId=1677');
assert.equal(proof.source.published_at, '2026-06-24');
assert.equal(proof.transition_timeline.municipal_affiliation_agreement_termination_effective_date, '2026-06-12');
assert.equal(proof.new_mrf_bytes, false);
assert.equal(proof.disposition_effect, 'none');
assert.equal(proof.count_effect, 0);
assert.match(proof.interpretation, /not a Medicare certification or termination record/i);
assert.match(proof.comparison_to_retained_evidence.current_publisher_page_observation, /already recorded on 2026-09-27/);
assert.ok(cohort.current_crosswalk_ccns['genuinely-unresolved'].includes(proof.ccn));
assert.ok(manual.records.find(record => record.ccn === proof.ccn)
  .latest_city_affiliation_termination_crosscheck_2026_09_29);
assert.ok(browser.records.some(record => record.ccn === proof.ccn
  && record.proof_file === proofName
  && record.kind === 'official-municipal-transition-crosscheck'));

console.log('Asante Ashland municipal transition corroboration remains separate from CMS status and MRF scope.');
