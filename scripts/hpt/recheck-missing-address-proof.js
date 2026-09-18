'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { requestCapped, sniffKind, decompressHead, extractDeclared, toISODate } = require('./lib/probe');
const { strongAddressAgreement } = require('./lib/mrf-header-match');
const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const cohort = process.argv.includes('--corewell') ? 'corewell-manual'
  : process.argv.includes('--abrazo') ? 'abrazo-manual'
    : process.argv.includes('--quarantine-state') ? 'quarantine-state'
      : process.argv.includes('--cameron-page') ? 'cameron-official-page'
        : process.argv.includes('--remaining-quarantine') ? 'remaining-quarantine'
          : process.argv.includes('--manual-pointer-file') ? 'manual-pointer-file' : 'missing-address';
const stage = path.join(audit, '.domain-discovery/reconciliation', cohort);
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
async function main() {
  fs.mkdirSync(stage, { recursive: true });
  const manualIds = cohort === 'corewell-manual' ? ['230020', '230035', '230038', '230089', '230151', '230269', '230270']
    : cohort === 'abrazo-manual' ? ['030030', '030083', '030094', '030110'] : null;
  const quarantineIds = cohort === 'quarantine-state' ? ['250174', '260057', '371331', '400139', '510094'] : null;
  const remainingQuarantineIds = cohort === 'remaining-quarantine' ? ['100167', '330141', '390430'] : null;
  const manualPointerFileIds = cohort === 'manual-pointer-file' ? ['010045', '110129', '210065', '640001'] : null;
  const officialPageTargets = cohort === 'cameron-official-page' ? [{ ccn: '260057',
    mrf_url: 'https://irp.cdn-website.com/87401228/files/uploaded/440668347_cameron-regional-medical-center_standardcharges-b094301b-664adbbd.csv' }] : null;
  const targets = manualIds || manualPointerFileIds
    ? read(path.join(audit, 'manual-correction-reconciliation.json')).records
      .filter(r => (manualIds || manualPointerFileIds).includes(r.ccn))
      .map(r => ({ ccn: r.ccn, mrf_url: r.manual_mrf_url }))
    : officialPageTargets || (quarantineIds || remainingQuarantineIds ? read(path.join(audit, 'nationwide-verification.json')).records
      .filter(r => (quarantineIds || remainingQuarantineIds).includes(r.ccn))
      .map(r => ({ ccn: r.ccn, mrf_url: r.mrf_url }))
      : read(path.join(audit, 'nationwide-verification.json')).records.filter(r => r.disposition.startsWith('verified-') && !r.declared_address));
  const roster = new Map(read(path.join(root, 'cms_data/hpt/roster.json')).map(r => [r.ccn, r]));
  const records = [];
  async function run(target) {
    const key = target.ccn + '-' + sha(Buffer.from(target.mrf_url)).slice(0, 12);
    const json = path.join(stage, key + '.json');
    let result;
    if (fs.existsSync(json)) result = read(json);
    else {
      result = { ccn: target.ccn, url: target.mrf_url, observed_at: new Date().toISOString(), reason: manualIds || manualPointerFileIds ? 'Reconcile a saved manual file correction against per-CCN file identity and metadata.'
        : officialPageTargets ? 'Try the distinct file URL exposed by the current official price-transparency page after the pointer-derived route returned HTTP 403.'
        : quarantineIds || remainingQuarantineIds ? 'Recheck a quarantined identity assignment from retained file bytes before deciding whether the uncertainty is supported.'
          : 'Resolve missing file address in a nationwide verification claim.' };
      try {
        const response = await requestCapped(target.mrf_url, { timeoutMs: 30000, cap: 1048576, headers: { Range: 'bytes=0-1048575' } });
        fs.writeFileSync(path.join(stage, key + '.bin'), response.body);
        Object.assign(result, { http_status: response.status, final_url: response.finalUrl, bytes: response.body.length, sha256: sha(response.body), raw_file: key + '.bin' });
        if (response.status >= 200 && response.status < 300) {
          result.file_kind = sniffKind(response.body, response.headers['content-type']);
          const payload = ['zip', 'gzip'].includes(result.file_kind) ? await decompressHead(response.body, result.file_kind) : response.body;
          if (payload) {
            result.payload_kind = sniffKind(payload, null);
            fs.writeFileSync(path.join(stage, key + '.payload'), payload);
            result.payload_sha256 = sha(payload);
            const metadata = extractDeclared(payload, result.payload_kind);
            result.metadata = { hospital_name: metadata.hospitalName, location_name: metadata.locationName, address: metadata.address,
              license_state: metadata.licenseState, date: toISODate(metadata.raw), version: metadata.version };
          } else result.decompression_failed = true;
        }
      } catch (error) { result.error = error.message; }
      fs.writeFileSync(json, JSON.stringify(result, null, 2) + '\n');
    }
    if (result.raw_file && sha(fs.readFileSync(path.join(stage, result.raw_file))) !== result.sha256) throw Error('Cached bytes changed: ' + target.ccn);
    const facility = roster.get(target.ccn), metadata = result.metadata;
    const addressAgrees = !!metadata?.address && String(metadata.address).split('|').some(address => strongAddressAgreement(facility.address, address));
    const stateAgrees = !!metadata?.license_state && metadata.license_state === facility.state;
    records.push({ ccn: target.ccn, source_url: target.mrf_url, final_url: result.final_url || target.mrf_url,
      observed_at: result.observed_at, http_status: result.http_status || null,
      bytes: result.bytes || 0, sha256: result.sha256 || null, payload_sha256: result.payload_sha256 || null,
      file_kind: result.file_kind || '', payload_kind: result.payload_kind || '', metadata: metadata || null,
      address_agrees: addressAgrees, license_state_agrees: stateAgrees,
      status: addressAgrees && stateAgrees ? 'file-address-corroborated-pointer-review-required' : metadata?.address ? 'identity-review-required' : 'address-not-observed-in-this-read',
      error: result.error || '', next_action: addressAgrees && stateAgrees ? 'Review facility name and exact cached pointer linkage before applying a finding.' : 'Inspect the retained payload or use official page and browser evidence; retrieval failure is not evidence of absent metadata.' });
    if (cohort === 'corewell-manual' && ['230020', '230151'].includes(target.ccn)) {
      records[records.length - 1].pointer_observation = 'Saved pointer has an empty mrf-url field followed by the matching URL on the next line.';
      records[records.length - 1].next_action = 'Reconcile nonstandard wrapped pointer linkage with official pricing-page evidence; retain the successful file-header proof and do not repeat the same download.';
    }
    console.log(JSON.stringify(records[records.length - 1]));
  }
  for (let i = 0; i < targets.length; i += 3) await Promise.all(targets.slice(i, i + 3).map(run));
  records.sort((a, b) => a.ccn.localeCompare(b.ccn));
  fs.writeFileSync(path.join(audit, 'reconciliation-' + cohort + '-proof.json'), JSON.stringify({ records }, null, 2) + '\n');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
