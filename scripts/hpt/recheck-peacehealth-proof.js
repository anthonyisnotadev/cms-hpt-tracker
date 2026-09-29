'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { requestCapped, sniffKind, decompressHead, extractDeclared, toISODate } = require('./lib/probe');
const { parsePointerEntries } = require('./lib/discovery-review');
const { strongAddressAgreement } = require('./lib/mrf-header-match');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const stage = path.join(audit, '.domain-discovery/reconciliation/peacehealth');
const pointerUrl = 'https://www.peacehealth.org/cms-hpt.txt';
const ids = new Set(['021311', '380102', '381301', '381316', '500030', '500041', '500050', '501329', '501340']);
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

async function main() {
  fs.mkdirSync(stage, { recursive: true });
  let pointer = await requestCapped(pointerUrl, { timeoutMs: 30000, cap: 1048576 });
  if (pointer.status !== 200) {
    const body = execFileSync('curl.exe', ['-L', '--fail', '--silent', '--show-error', '--max-time', '30',
      '--range', '0-1048575', '-A', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0 Safari/537.36', pointerUrl],
    { encoding: null, maxBuffer: 1048577 });
    pointer = { status: 200, body, finalUrl: pointerUrl, route: 'curl-browser-signature-fallback' };
  }
  fs.writeFileSync(path.join(stage, 'pointer.txt'), pointer.body);
  const entries = parsePointerEntries(pointer.body.toString('utf8'));
  const manual = JSON.parse(fs.readFileSync(path.join(audit, 'manual-correction-reconciliation.json'), 'utf8')).records.filter(row => ids.has(row.ccn));
  const roster = new Map(JSON.parse(fs.readFileSync(path.join(root, 'cms_data/hpt/roster.json'), 'utf8')).map(row => [row.ccn, row]));
  const records = [];
  async function run(row) {
    const entry = entries.find(item => item.mrf_url === row.manual_mrf_url);
    if (!entry) throw new Error(`No exact pointer entry for ${row.ccn}`);
    const key = row.ccn + '-' + sha(Buffer.from(row.manual_mrf_url)).slice(0, 12);
    const cachePath = path.join(stage, key + '.json');
    let cached;
    if (fs.existsSync(cachePath)) cached = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    else {
      const response = await requestCapped(row.manual_mrf_url, { timeoutMs: 30000, cap: 1048576, headers: { Range: 'bytes=0-1048575' } });
      const rawPath = path.join(stage, key + '.bin');
      fs.writeFileSync(rawPath, response.body);
      const fileKind = sniffKind(response.body, response.headers['content-type']);
      const payload = ['zip', 'gzip'].includes(fileKind) ? await decompressHead(response.body, fileKind) : response.body;
      if (!payload) throw new Error(`Could not expand ${row.ccn}`);
      fs.writeFileSync(path.join(stage, key + '.payload'), payload);
      const payloadKind = sniffKind(payload, null), metadata = extractDeclared(payload, payloadKind);
      cached = { http_status: response.status, final_url: response.finalUrl, file_kind: fileKind, payload_kind: payloadKind,
        file_sha256: sha(response.body), payload_sha256: sha(payload), metadata: { hospital_name: metadata.hospitalName,
          location_name: metadata.locationName, address: metadata.address, license_state: metadata.licenseState,
          date: toISODate(metadata.raw), version: metadata.version }, observed_at: new Date().toISOString() };
      fs.writeFileSync(cachePath, JSON.stringify(cached, null, 2) + '\n');
    }
    const facility = roster.get(row.ccn);
    const addressAgrees = String(cached.metadata.address || '').split('|').some(address => strongAddressAgreement(facility.address, address));
    records.push({ ccn: row.ccn, hospital_name: facility.hospital_name, roster_address: facility.address, roster_state: facility.state,
      pointer_url: pointerUrl, pointer_sha256: sha(pointer.body), pointer_route: pointer.route || 'node-direct', pointer_location_name: entry.location_name,
      source_page_url: entry.source_page_url, mrf_url: entry.mrf_url, ...cached,
      address_agrees: addressAgrees, license_state_agrees: cached.metadata.license_state === facility.state,
      status: cached.http_status >= 200 && cached.http_status < 300 && addressAgrees && cached.metadata.license_state === facility.state
        ? 'identity-corroborated' : 'review-required' });
  }
  for (let i = 0; i < manual.length; i += 3) await Promise.all(manual.slice(i, i + 3).map(run));
  records.sort((a, b) => a.ccn.localeCompare(b.ccn));
  fs.writeFileSync(path.join(audit, 'reconciliation-peacehealth-proof.json'), JSON.stringify({ records }, null, 2) + '\n');
  console.log(JSON.stringify({ pointer_sha256: sha(pointer.body), pointer_entries: entries.length,
    records: records.map(row => ({ ccn: row.ccn, status: row.status, http_status: row.http_status, metadata: row.metadata })) }, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
