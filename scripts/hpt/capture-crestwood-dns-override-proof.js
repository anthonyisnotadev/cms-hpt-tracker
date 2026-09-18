'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cp = require('child_process');
const cheerio = require('cheerio');
const { parsePayload } = require('./lib/recovery-transport');

const root = path.resolve(__dirname, '../..');
const domain = 'crestwoodmedcenter.com';
const resolvedIp = '199.116.78.73'; // 2026-09-16 Google DNS A response; re-resolve before a later capture.
const pointerUrl = `https://${domain}/cms-hpt.txt`;
const pageUrl = `https://${domain}/financial-information/price-transparency/`;
const identityUrl = `https://${domain}/contact/`;
const fileUrl = `https://${domain}/wp-content/uploads/621647983_crestwood-medical-center_standardcharges.csv`;
const sha256 = body => crypto.createHash('sha256').update(body).digest('hex');

function boundedGet(url, cap) {
  const result = cp.execFileSync('curl.exe', [
    '--resolve', `${domain}:443:${resolvedIp}`, '--fail', '--silent', '--show-error',
    '--max-time', '30', '--range', `0-${cap - 1}`, '--max-filesize', String(cap),
    '--write-out', '%{http_code}', url,
  ], { maxBuffer: cap + 4096 });
  const status = Number(result.subarray(-3).toString('ascii'));
  const body = result.subarray(0, -3);
  if (![200, 206].includes(status) || body.length > cap) throw new Error(`Unexpected bounded response for ${url}`);
  return { status, body, sha256: sha256(body) };
}

async function main() {
  const pointer = boundedGet(pointerUrl, 65536);
  const page = boundedGet(pageUrl, 262144);
  const identity = boundedGet(identityUrl, 262144);
  const file = boundedGet(fileUrl, 262144);
  const pointerText = pointer.body.toString('utf8');
  const $ = cheerio.load(page.body.toString('utf8'));
  const links = $('a[href]').map((_, a) => new URL($(a).attr('href'), pageUrl).href).get();
  const identityText = cheerio.load(identity.body.toString('utf8'))('body').text().replace(/\s+/g, ' ');
  const header = (await parsePayload(file.body, 'text/csv')).parsed
    .find(item => item.innerKind === 'csv' && item.mrfHospitalName);
  if (pointer.body.length !== 308
      || !pointerText.includes('location-name: Crestwood Medical Center')
      || !pointerText.includes(`mrf-url: ${fileUrl}`)
      || !links.includes(fileUrl)
      || !identityText.includes('One Hospital Drive')
      || !identityText.includes('Huntsville, AL 35801')
      || file.status !== 206 || file.body.length !== 262144
      || !header || header.mrfHospitalName !== 'Crestwood Medical Center'
      || header.mrfLocationName !== 'Crestwood Medical Center'
      || header.mrfAddress !== 'One Hospital Drive, Huntsville, AL 35801'
      || header.mrfLicenseState !== 'AL'
      || header.declaredLastUpdated !== '2026-01-01'
      || header.cmsVersion !== '3.0.0') {
    throw new Error('Current Crestwood pointer/page/file proof changed');
  }
  const sampleDir = path.join(root, 'cms_data/hpt/nationwide-verification/file-byte-proof');
  fs.mkdirSync(sampleDir, { recursive: true });
  const samplePath = path.join(sampleDir, `${file.sha256}.bin`);
  fs.writeFileSync(samplePath, file.body);
  const record = {
    ccn: '010131', official_domain: domain,
    dns_override_ip: resolvedIp,
    dns_override_reason: 'Default client DNS timed out; Google DNS A response resolved the official domain and curl --resolve retained exact-host TLS and URL semantics.',
    pointer_url: pointerUrl, pointer_http_status: pointer.status,
    pointer_sha256: pointer.sha256,
    source_page_url: pageUrl, source_page_http_status: page.status,
    source_page_sha256: page.sha256,
    official_identity_url: identityUrl, official_identity_http_status: identity.status,
    official_identity_sha256: identity.sha256,
    mrf_url: fileUrl, mrf_http_status: file.status,
    mrf_sample_sha256: file.sha256, retained_bytes: file.body.length,
    retained_sample: path.relative(root, samplePath).replaceAll('\\', '/'),
    declared_hospital_name: header.mrfHospitalName,
    declared_location_name: header.mrfLocationName,
    declared_address: header.mrfAddress,
    declared_state: header.mrfLicenseState,
    declared_date: header.declaredLastUpdated,
    version: header.cmsVersion,
    observed_at: new Date().toISOString(),
    next_action: 'Recheck the hospital-domain pointer and bounded file header after a publisher change or normal DNS recovery. Current finding is based on exact-host pointer linkage and a retained bounded CSV header, not full-file validation.',
  };
  fs.writeFileSync(path.join(root, 'data/hpt-audit/reconciliation-crestwood-dns-override-proof.json'),
    `${JSON.stringify({ record }, null, 2)}\n`);
  console.log(JSON.stringify({ ccn: record.ccn, pointer: pointer.status,
    file: file.status, sample_sha256: file.sha256 }));
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
