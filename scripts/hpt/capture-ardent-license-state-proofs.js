'use strict';
const crypto = require('crypto');
const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '../..'), audit = path.join(root, 'data/hpt-audit');
const rows = [
  { ccn: '450231', name: 'BSA Hospital', state: 'TX', address: '1600 Wallace Blvd, Amarillo, TX 79106',
    pointer: 'https://bsahs.org/cms-hpt.txt', identity: 'https://bsahs.org/', identityTokens: ['1600 Wallace Boulevard', 'Amarillo, TX 79106'],
    url: 'https://cdn.ardenthealthservices.com/price-transparency/30-0754305_BSA-Hospital_standardcharges.csv' },
  { ccn: '370216', name: 'Tulsa Spine & Specialty Hospital', state: 'OK', address: '6901 South Olympia Ave., Tulsa, OK 74132',
    pointer: 'https://tulsaspinehospital.com/cms-hpt.txt', identity: 'https://tulsaspinehospital.com/', identityTokens: ['6901 S Olympia Ave', 'Tulsa, OK 74132'],
    url: 'https://cdn.ardenthealthservices.com/price-transparency/73-1600601_Tulsa-Spine-and-Specialty-Hospital_standardcharges.csv' },
  { ccn: '670080', name: 'Seton Medical Center Harker Heights', state: 'TX', address: '850 West Central Texas Expressway, Harker Heights, TX 76548',
    pointer: 'https://setonharkerheights.net/cms-hpt.txt', identity: 'https://setonharkerheights.net/', identityTokens: ['850 West Central Texas Expressway', 'Harker Heights, TX 76548'],
    url: 'https://cdn.ardenthealthservices.com/price-transparency/27-2814378_Seton_Medical_Center_standardcharges.csv' }
];
const sha = body => crypto.createHash('sha256').update(body).digest('hex');
async function get(url, headers = {}) {
  try { const response = await fetch(url, { headers }); return { response, body: Buffer.from(await response.arrayBuffer()) }; }
  catch {
    const args = ['-L', '--fail', '--silent', '--show-error'];
    if (headers.Range) args.push('--range', headers.Range.replace(/^bytes=/, ''));
    args.push(url);
    const body = childProcess.execFileSync('curl.exe', args, { maxBuffer: 2 * 1024 * 1024 });
    return { response: { ok: true, status: headers.Range ? 206 : 200, url }, body };
  }
}
(async () => {
  const proofs = [];
  for (const row of rows) {
    const observedAt = new Date().toISOString();
    const pointer = await get(row.pointer), file = await get(row.url, { Range: 'bytes=0-1048575' }), identity = await get(row.identity);
    if (!pointer.response.ok || ![200, 206].includes(file.response.status) || !identity.response.ok)
      throw new Error(`${row.ccn} capture failed: ${pointer.response.status}/${file.response.status}/${identity.response.status}`);
    const pointerText = pointer.body.toString('utf8'), fileText = file.body.toString('utf8'), identityText = identity.body.toString('utf8');
    if (!pointerText.toLowerCase().includes(row.name.toLowerCase()) || !pointerText.includes(row.url)) throw new Error(`${row.ccn} pointer changed`);
    for (const token of ['license_number|CA', row.name, row.address, '2/12/2026', '3.0.0'])
      if (!fileText.toLowerCase().includes(token.toLowerCase())) throw new Error(`${row.ccn} file lacks ${token}`);
    for (const token of row.identityTokens) if (!identityText.toLowerCase().includes(token.toLowerCase())) throw new Error(`${row.ccn} identity page lacks ${token}`);
    const sample = `cms_data/hpt/nationwide-verification/file-byte-proof/ardent-license-state-${row.ccn}.bin`;
    fs.writeFileSync(path.join(root, sample), file.body);
    proofs.push({ ccn: row.ccn, observed_at: observedAt, pointer_url: row.pointer, pointer_http_status: pointer.response.status,
      pointer_sha256: sha(pointer.body), mrf_url: row.url, mrf_http_status: file.response.status, mrf_final_url: file.response.url,
      retained_sample: sample, retained_bytes: file.body.length, mrf_sample_sha256: sha(file.body),
      identity_page_url: row.identity, identity_page_sha256: sha(identity.body), declared_hospital_name: row.name,
      declared_location_name: row.name, declared_address: row.address, declared_license_state: 'CA', facility_state: row.state,
      declared_date: '2026-02-12', version: '3.0.0' });
  }
  fs.writeFileSync(path.join(audit, 'reconciliation-ardent-license-state-proofs.json'), `${JSON.stringify({ generated_at: new Date().toISOString(), records: proofs }, null, 2)}\n`);
  console.log(JSON.stringify({ captured: proofs.map(row => row.ccn), bytes: proofs.reduce((n, row) => n + row.retained_bytes, 0) }, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
