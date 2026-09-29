'use strict';
const fs = require('fs');
const path = require('path');
const { csvToObjects } = require('./lib/util');
const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
const compliance = new Map(csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8')).map(row => [row.ccn, row]));
const ccn = '040132';
const evidence = { closureDate: '2025-08-01', checked_at: '2026-09-15T12:25:10.180Z',
  officialSources: ['https://levihospital.com/', 'https://www.levicares.org/contact'],
  rosterStatus: 'still-listed-in-local-2026-08-28-snapshot',
  basis: 'The former hospital website says hospital operations ceased August 1, 2025; the successor foundation says it no longer operates a hospital.' };
const note = 'First-party Levi Hospital and successor-foundation pages state that Levi ceased hospital operations on August 1, 2025 and now operates as a community foundation. Treat this retained CCN row as a documented closed facility, not as a current HPT failure or a federal exemption.';
const existing = ledger.find(row => row.ccn === ccn);
if (existing) {
  if (!(existing.action === 'exempt-closed' && JSON.stringify(existing.evidence) === JSON.stringify(evidence)))
    throw new Error(`Existing nonmatching resolution ${ccn}`);
} else {
  ledger.push({ ccn, base: compliance.get(ccn), action: 'exempt-closed', evidence,
    official: { domain: 'levihospital.com', page: 'https://levihospital.com/' },
    evidence_run: 'closed-facility-review-2026-09-15', reviewed_at: evidence.checked_at, note });
  ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
  fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
}
console.log(JSON.stringify({ applied: ccn, finding: 'not-applicable-closed' }, null, 2));
