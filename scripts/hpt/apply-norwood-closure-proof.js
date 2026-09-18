'use strict';
const fs = require('fs');
const path = require('path');
const { csvToObjects } = require('./lib/util');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
const compliance = new Map(csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8')).map(row => [row.ccn, row]));
const ccn = '220126';
const evidence = {
  closureDate: '2020-06',
  licenseExpired: '2024-11-05',
  checked_at: '2026-09-15T19:38:55.000Z',
  officialSources: [
    'https://www.mass.gov/info-details/steward-health-care-transition-to-the-new-operators',
    'https://malegislature.gov/PressRoom/Detail?pressReleaseId=1469'
  ],
  rosterStatus: 'still-listed-in-local-2026-08-28-snapshot',
  basis: 'Massachusetts states that Norwood Hospital has been closed since June 2020, its license expired November 5, 2024, and the site still requires transfer to a future nonprofit operator before hospital operations can be revitalized.'
};
const note = 'Current Massachusetts executive and legislative sources document that Norwood Hospital has remained closed since June 2020 and that its license expired November 5, 2024. Treat this retained CCN row as a documented closed facility; proposed future revitalization does not establish a reopened hospital or reactivate this CCN.';
const existing = ledger.find(row => row.ccn === ccn);
if (existing) {
  if (!(existing.action === 'exempt-closed' && JSON.stringify(existing.evidence) === JSON.stringify(evidence))) {
    throw new Error(`Existing nonmatching resolution ${ccn}`);
  }
} else {
  ledger.push({
    ccn,
    base: compliance.get(ccn),
    action: 'exempt-closed',
    evidence,
    official: { domain: 'mass.gov', page: evidence.officialSources[0] },
    evidence_run: 'norwood-closure-review-2026-09-15',
    reviewed_at: evidence.checked_at,
    note
  });
  ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
  fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
}
console.log(JSON.stringify({ applied: ccn, finding: 'not-applicable-closed' }, null, 2));
