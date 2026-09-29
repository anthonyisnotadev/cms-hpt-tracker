'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { retrieve, parsePayload } = require('./lib/recovery-transport');

const root = path.resolve(__dirname, '../..');
const output = path.join(root, 'data/hpt-audit/reconciliation-oss-portal-not-found-proof.json');
const samples = path.join(root, 'cms_data/hpt/nationwide-verification/file-byte-proof');
const identityUrl = 'https://osshealth.com/locations/oss-orthopaedic-hospital';
const pricingUrl = 'https://osshealth.com/oss-health-pricing';
const pointerUrl = 'https://osshealth.com/cms-hpt.txt';
const portalUrl = 'https://www.cdmpricing.com/bc751d7bc627f16d079c47ff05c9fe44/standard-charges';
const fileUrl = 'https://osshealth.com/uploads/docs/800458999_oss-orthopaedic-hospital_standardcharges_2026-04-09-171951_gboz.csv';
const sha = body => crypto.createHash('sha256').update(body).digest('hex');

async function main() {
  fs.mkdirSync(samples, { recursive: true });
  const [identity, pricing, pointer, portal, file] = await Promise.all([
    retrieve(identityUrl, 524288, { timeoutMs: 30000 }),
    retrieve(pricingUrl, 524288, { timeoutMs: 30000 }),
    retrieve(pointerUrl, 65536, { timeoutMs: 30000 }),
    retrieve(portalUrl, 262144, { timeoutMs: 30000 }),
    retrieve(fileUrl, 262144, { timeoutMs: 30000 })
  ]);
  const identityText = identity.body.toString('utf8');
  const pricingText = pricing.body.toString('utf8');
  const pointerText = pointer.body.toString('utf8');
  const portalText = portal.body.toString('utf8');
  if (identity.status < 200 || identity.status >= 300 || !identityText.includes('OSS Orthopaedic Hospital')
      || !identityText.includes('1861 Powder Mill Rd') || !identityText.includes('York, PA 17402'))
    throw new Error('OSS exact-hospital identity page changed');
  if (pricing.status < 200 || pricing.status >= 300 || !pricingText.includes(fileUrl)
      || !pricingText.includes('downloadable machine-readable file'))
    throw new Error('OSS first-party pricing page does not link the expected CSV');
  if (pointer.status < 200 || pointer.status >= 300 || !pointerText.includes('location-name: OSS Health')
      || !pointerText.includes(`mrf-url: ${portalUrl}`) || pointerText.includes(fileUrl))
    throw new Error('OSS pointer no longer targets the separate portal');
  if (portal.status < 200 || portal.status >= 300 || !/text\/html/i.test(portal.headers['content-type'] || '')
      || portalText.includes(fileUrl))
    throw new Error('OSS portal response changed; browser observation needs renewal');
  const parsed = await parsePayload(file.body, file.headers['content-type'] || '');
  const header = parsed.parsed?.find(item => item.cmsVersion && item.mrfHospitalName && item.mrfAddress);
  if (file.status < 200 || file.status >= 300 || file.body.length < 65536 || !header
      || header.cmsVersion !== '3.0.0' || header.mrfLicenseState !== 'PA'
      || header.declaredLastUpdated !== '2026-04-01'
      || header.mrfHospitalName !== 'OSS Orthopaedic Hospital'
      || header.mrfLocationName !== 'OSS Orthopaedic Hospital'
      || header.mrfAddress !== '1861 Powder Mill Rd, York, PA 17402')
    throw new Error('OSS current CSV identity or metadata mismatch');
  const digest = sha(file.body);
  const sample = path.join(samples, `${digest}.bin`);
  fs.writeFileSync(sample, file.body);
  const record = {
    ccn: '390325', disposition: 'pointer-html-portal-renders-not-found-first-party-current-file',
    official_domain: 'osshealth.com', identity_url: identityUrl,
    identity_http_status: identity.status, identity_sha256: sha(identity.body),
    pricing_url: pricingUrl, pricing_http_status: pricing.status, pricing_sha256: sha(pricing.body),
    pointer_url: pointerUrl, pointer_http_status: pointer.status, pointer_sha256: sha(pointer.body),
    pointer_location_name: 'OSS Health', pointer_mrf_url: portalUrl,
    portal_script_http_status: portal.status, portal_content_type: portal.headers['content-type'],
    portal_sha256: sha(portal.body),
    browser_portal_observed_at: '2026-09-16T09:01:57Z',
    browser_portal_title: 'Pricing Transparency',
    browser_portal_final_url: 'https://www.cdmpricing.com/bc751d7bc627f16d079c47ff05c9fe44/not-found',
    browser_portal_excerpt: '404 Page does not exist. You might have typed in the wrong address or the page has been moved.',
    file_url: fileUrl, file_http_status: file.status, file_sha256: digest,
    retained_bytes: file.body.length, retained_sample: path.relative(root, sample).replaceAll('\\', '/'),
    declared_hospital_name: header.mrfHospitalName, declared_location_name: header.mrfLocationName,
    declared_address: header.mrfAddress, declared_state: header.mrfLicenseState,
    declared_date: header.declaredLastUpdated, version: header.cmsVersion,
    observed_at: file.checkedAt,
    next_action: 'Retain the first-party current file evidence but do not call it pointer-linked; recheck the exact portal route after the publisher changes the pointer or portal.'
  };
  fs.writeFileSync(output, `${JSON.stringify(record, null, 2)}\n`);
  console.log(JSON.stringify({ ccn: record.ccn, disposition: record.disposition, retained_bytes: record.retained_bytes }));
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
