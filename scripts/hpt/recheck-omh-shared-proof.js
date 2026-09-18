'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { requestCapped, sniffKind, extractDeclared, toISODate } = require('./lib/probe');
const { parsePointerEntries } = require('./lib/discovery-review');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const stage = path.join(audit, '.domain-discovery/reconciliation/omh-shared');
const pointerUrl = 'https://omh.ny.gov/cms-hpt.txt';
const mrfUrl = 'https://omh.ny.gov/omhweb/adults/141663311_nysomh_standardcharges.csv';
const ccns = ['334001', '334020', '334054', '334063', '334066', '334067'];
const sha = value => crypto.createHash('sha256').update(value).digest('hex');

async function main() {
  fs.mkdirSync(stage, { recursive: true });
  const pointer = await requestCapped(pointerUrl, { timeoutMs: 30000, cap: 1048576 });
  const file = await requestCapped(mrfUrl, { timeoutMs: 30000, cap: 1048576, headers: { Range: 'bytes=0-1048575' } });
  if (!(pointer.status >= 200 && pointer.status < 300) || !(file.status >= 200 && file.status < 300))
    throw new Error(`Unexpected status pointer=${pointer.status} file=${file.status}`);
  fs.writeFileSync(path.join(stage, 'pointer.txt'), pointer.body);
  fs.writeFileSync(path.join(stage, 'file.bin'), file.body);
  const entries = parsePointerEntries(pointer.body.toString('utf8'));
  const linked = entries.filter(entry => entry.mrf_url === mrfUrl);
  if (!linked.length) throw new Error('Official pointer does not declare the reviewed MRF URL');
  const kind = sniffKind(file.body, file.headers['content-type']);
  const metadata = extractDeclared(file.body, kind);
  const ledger = JSON.parse(fs.readFileSync(path.join(audit, 'reviewed-resolutions.json'), 'utf8'));
  const roster = new Map(JSON.parse(fs.readFileSync(path.join(root, 'cms_data/hpt/roster.json'), 'utf8')).map(row => [row.ccn, row]));
  const records = ccns.map(ccn => {
    const resolution = ledger.find(row => row.ccn === ccn);
    const facility = roster.get(ccn);
    if (!resolution || !facility) throw new Error(`Missing ledger/roster ${ccn}`);
    return { ccn, observed_at: new Date().toISOString(), pointer_url: pointerUrl, pointer_http_status: pointer.status,
      pointer_sha256: sha(pointer.body), pointer_location_names: linked.map(entry => entry.location_name || entry.hospital_name || ''),
      mrf_url: mrfUrl, mrf_http_status: file.status, file_sha256: sha(file.body), payload_sha256: sha(file.body), file_kind: kind,
      observed_hospital_name: metadata.hospitalName, observed_location_name: metadata.locationName,
      observed_address: metadata.address, observed_license_state: metadata.licenseState,
      declared_date: toISODate(metadata.raw), cms_template_version: metadata.version,
      roster_hospital_name: facility.hospital_name, roster_address: facility.address, official_page: resolution.official.page,
      disposition: 'supported-identity-uncertainty',
      reason: `The exact official pointer-declared file identifies ${metadata.hospitalName} at ${metadata.address}, not ${facility.hospital_name}.` };
  });
  fs.writeFileSync(path.join(audit, 'reconciliation-omh-shared-proof.json'), JSON.stringify({ records }, null, 2) + '\n');
  console.log(JSON.stringify({ pointer_sha256: sha(pointer.body), file_sha256: sha(file.body), linked_entries: linked.length, records: records.length,
    observed_hospital_name: metadata.hospitalName, observed_address: metadata.address }, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
