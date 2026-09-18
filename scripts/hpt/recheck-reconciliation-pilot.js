'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { requestCapped, sniffKind, extractDeclared, toISODate } = require('./lib/probe');
const { parsePointerEntries } = require('./lib/discovery-review');
const stage = path.resolve(__dirname, '../../data/hpt-audit/.domain-discovery/reconciliation');
const targets = [
  { ccn: '010023', kind: 'pointer', url: 'https://baptistfirst.org/cms-hpt.txt' },
  { ccn: '010023', kind: 'mrf', url: 'https://baptistfirst.pt.panaceainc.com/MRFDownload/baptistfirst/bmc-south' },
  { ccn: '051300', kind: 'pointer', url: 'https://www.ephc.org/cms-hpt.txt' },
  { ccn: '051300', kind: 'mrf', url: 'https://www.ephc.org/V3.0TallEPHC.csv' }
];
async function run(target) {
  const key = target.ccn + '-' + target.kind;
  const recordPath = path.join(stage, key + '.json');
  if (fs.existsSync(recordPath)) return JSON.parse(fs.readFileSync(recordPath, 'utf8'));
  const out = { ...target, checked_at: new Date().toISOString(), reason: 'Reconcile retained quarantine with official source and prior manual evidence.' };
  try {
    const cap = target.kind === 'pointer' ? 262144 : 1048576;
    const response = await requestCapped(target.url, { timeoutMs: 30000, cap, headers: { Range: `bytes=0-${cap - 1}` } });
    Object.assign(out, { http_status: response.status, final_url: response.finalUrl,
      bytes_retained: response.body.length, sha256: crypto.createHash('sha256').update(response.body).digest('hex') });
    fs.writeFileSync(path.join(stage, key + '.bin'), response.body);
    if (response.status >= 200 && response.status < 300) {
      if (target.kind === 'pointer') out.entries = parsePointerEntries(response.body.toString('utf8'));
      else {
        out.file_kind = sniffKind(response.body, response.headers['content-type']);
        const d = extractDeclared(response.body, out.file_kind);
        out.metadata = { hospital_name: d.hospitalName, location_name: d.locationName, address: d.address,
          license_state: d.licenseState, declared_date: toISODate(d.raw), version: d.version };
      }
    }
  } catch (error) { out.error = error.message; }
  fs.writeFileSync(recordPath, JSON.stringify(out, null, 2) + '\n');
  return out;
}
async function main() {
  fs.mkdirSync(stage, { recursive: true });
  for (let i = 0; i < targets.length; i += 2) {
    const results = await Promise.all(targets.slice(i, i + 2).map(run));
    for (const result of results) console.log(JSON.stringify(result));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
