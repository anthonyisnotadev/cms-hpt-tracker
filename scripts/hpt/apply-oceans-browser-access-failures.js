const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const observedAt = '2026-09-26T04:10:00Z';
const rows = {
  '194086': ['Oceans Behavioral Hospital of Baton Rouge', 'https://oceanshealthcare.com/wp-content/uploads/2026/06/203890581_Oceans-Behavioral-Hosptial-of-Baton-Rouge_standardcharges-1.csv', 'LA'],
  '254012': ['Oceans Behavioral Hospital of Biloxi', 'https://oceanshealthcare.com/wp-content/uploads/2026/06/832265556_Oceans-Behavioral-Hospital-of-Biloxi_standardcharges.csv', 'MS'],
  '454155': ['Oceans Behavioral Hospital of Corpus Christi', 'https://oceanshealthcare.com/wp-content/uploads/2026/06/853222037_Oceans-Behavioral-Hospital-of-Corpus-Christi_standardcharges.csv', 'TX']
};
const manualPath = path.join(audit, 'reconciliation-manual-access-observations.json');
const manual = JSON.parse(fs.readFileSync(manualPath, 'utf8'));
for (const [ccn, [name, url, state]] of Object.entries(rows)) {
  const proofFile = `reconciliation-oceans-${ccn}-browser-access-failure-2026-09-26.json`;
  const proof = { ccn, observed_at: observedAt, proof_file: proofFile, official_site: 'https://oceanshealthcare.com/financial-guidance/#price-transparency', official_page_status: 200, official_page_observation: 'Official Oceans Financial Guidance page visibly lists the facility-specific CSV link.', pointer_url: 'https://oceanshealthcare.com/cms-hpt.txt', pointer_status: 'cloudflare-challenge', mrf_url: url, mrf_status: 403, facility_name: name, state, disposition: 'mrf-request-unsuccessful', interpretation: 'The current official page identifies the facility-linked file, but direct retrieval is denied. Earlier saved observations remain available and are not erased.', next_action: 'Retry the exact official file through a permitted browser/download route; do not treat the access denial as proof of noncompliance.' };
  fs.writeFileSync(path.join(audit, proofFile), JSON.stringify(proof, null, 2) + '\n');
  manual.records = manual.records.filter(r => r.ccn !== ccn);
  manual.records.push({ ...proof, manual_disposition: 'later-observation-corroborates-factual-access-issue' });
}
manual.records.sort((a, b) => a.ccn.localeCompare(b.ccn));
fs.writeFileSync(manualPath, JSON.stringify(manual, null, 2) + '\n');
console.log(JSON.stringify({ applied: Object.keys(rows), count: Object.keys(rows).length }, null, 2));
