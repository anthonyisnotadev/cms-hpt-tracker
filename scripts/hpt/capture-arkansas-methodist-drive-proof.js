'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { retrieve, parsePayload } = require('./lib/recovery-transport');

const root = path.resolve(__dirname, '../..');
const output = path.join(root, 'data/hpt-audit/reconciliation-arkansas-methodist-drive-proof.json');
const samples = path.join(root, 'cms_data/hpt/nationwide-verification/file-byte-proof');
const identityUrl = 'https://myammc.org/plan-your-visit/directory/';
const pointerUrl = 'https://myammc.org/cms-hpt.txt';
const viewerUrl = 'https://drive.google.com/file/d/1VaWrohdIhUJ1vUflQNkwPMvx-zxUCqZU/view?usp=sharing';
const fileUrl = 'https://drive.google.com/uc?export=download&id=1VaWrohdIhUJ1vUflQNkwPMvx-zxUCqZU';
const fileName = '710230218_arkansas-methodist-medical-center_standardcharges.csv';
const sha = body => crypto.createHash('sha256').update(body).digest('hex');

async function main() {
  const [identity, pointer, viewer, file] = await Promise.all([
    retrieve(identityUrl, 524288, { timeoutMs: 30000 }),
    retrieve(pointerUrl, 65536, { timeoutMs: 30000 }),
    retrieve(viewerUrl, 262144, { timeoutMs: 30000 }),
    retrieve(fileUrl, 262144, { timeoutMs: 30000 })
  ]);
  const identityText = identity.body.toString('utf8');
  const pointerText = pointer.body.toString('utf8');
  const viewerText = viewer.body.toString('utf8');
  if (identity.status < 200 || identity.status >= 300
      || !identityText.includes('Arkansas Methodist Medical Center')
      || !identityText.includes('900 West Kingshighway')
      || !identityText.includes('Paragould, AR 72450'))
    throw new Error('Arkansas Methodist first-party identity or address changed');
  if (pointer.status < 200 || pointer.status >= 300
      || !pointerText.includes('location-name: Arkansas Methodist Hospital')
      || !pointerText.includes(`mrf-url: ${viewerUrl}`))
    throw new Error('Arkansas Methodist exact root pointer changed');
  if (viewer.status < 200 || viewer.status >= 300
      || !/text\/html/i.test(viewer.headers['content-type'] || '')
      || !viewerText.includes(fileName))
    throw new Error('Google Drive viewer no longer exposes the expected filename');
  if (file.status !== 206 || !/application\/octet-stream/i.test(file.headers['content-type'] || '')
      || file.body.length !== 262144 || !/^bytes 0-262143\//.test(file.headers['content-range'] || ''))
    throw new Error('Bounded CSV retrieval no longer returns the expected byte range');
  const parsed = await parsePayload(file.body, 'text/csv');
  const header = parsed.parsed?.find(item => item.cmsVersion && item.mrfHospitalName && item.mrfAddress);
  if (!header || header.mrfHospitalName.trim() !== 'Arkansas Methodist Hospital'
      || header.mrfLocationName.trim() !== 'Arkansas Methodist Hospital'
      || header.mrfAddress.trim() !== '900 W Kingshighway Paragould AR 72450'
      || header.mrfLicenseState !== 'AR' || header.declaredLastUpdated !== '2025-05-29'
      || header.cmsVersion !== '2.0.0')
    throw new Error('Arkansas Methodist CSV identity or metadata changed');
  const digest = sha(file.body);
  fs.mkdirSync(samples, { recursive: true });
  const sample = path.join(samples, `${digest}.bin`);
  fs.writeFileSync(sample, file.body);
  const record = {
    ccn: '040039', disposition: 'pointer-html-drive-viewer-links-older-template-file',
    official_domain: 'myammc.org', identity_url: identityUrl,
    identity_http_status: identity.status, identity_sha256: sha(identity.body),
    pointer_url: pointerUrl, pointer_http_status: pointer.status, pointer_sha256: sha(pointer.body),
    pointer_location_name: 'Arkansas Methodist Hospital', pointer_mrf_url: viewerUrl,
    viewer_http_status: viewer.status, viewer_content_type: viewer.headers['content-type'],
    viewer_sha256: sha(viewer.body), viewer_file_name: fileName,
    browser_viewer_observed_on: '2026-09-16',
    browser_viewer_observation: 'Google Drive rendered the named CSV and displayed the same hospital, address, Arkansas license field, 2025-05-29 date and 2.0.0 version in its first rows.',
    file_url: fileUrl, file_http_status: file.status, file_content_type: file.headers['content-type'],
    file_content_range: file.headers['content-range'], file_sha256: digest,
    retained_bytes: file.body.length, retained_sample: path.relative(root, sample).replaceAll('\\', '/'),
    declared_hospital_name: header.mrfHospitalName.trim(),
    declared_location_name: header.mrfLocationName.trim(),
    declared_address: header.mrfAddress.trim(), declared_state: header.mrfLicenseState,
    declared_date: header.declaredLastUpdated, version: header.cmsVersion,
    observed_at: file.checkedAt,
    next_action: 'Retain the exact viewer-to-file chain and older date/template metadata; recheck the root pointer and retrieved file only after a publisher change.'
  };
  fs.writeFileSync(output, `${JSON.stringify(record, null, 2)}\n`);
  console.log(JSON.stringify({ ccn: record.ccn, disposition: record.disposition, retained_bytes: record.retained_bytes }));
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
