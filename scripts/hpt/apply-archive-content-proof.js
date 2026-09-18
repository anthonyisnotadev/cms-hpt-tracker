'use strict';
const fs = require('fs');
const path = require('path');
const { upsert } = require('./nationwide-browser-review');
const ROOT = path.resolve(__dirname, '../..');
const proof = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/hpt-audit/reconciliation-archive-content-proof.json'), 'utf8'));
const reviewFile = path.join(ROOT, 'data/hpt-audit/nationwide-browser-reviews.json');
let reviews = JSON.parse(fs.readFileSync(reviewFile, 'utf8'));
for (const record of proof.records) {
  if (!/^\d{6}$/.test(record.ccn) || !/^https:\/\//.test(record.mrf_url) || !/^[a-f0-9]{64}$/.test(record.decompressed_sha256))
    throw new Error(`Invalid archive proof for ${record.ccn}`);
  reviews = upsert(reviews, {
    kind: 'mrf', target: record.mrf_url, final_url: record.mrf_url, status: 'retrieved', title: '',
    detail: `Complete ZIP member decompressed in browser (${record.decompressed_bytes} bytes; SHA-256 ${record.decompressed_sha256}); root metadata parsed from ${record.zip_member}.`,
    browser: 'brave-cdp-ranged-zip-member', http_status: '206', bytes_read: String(record.decompressed_bytes),
    content_range: 'complete-compressed-member-via-ranged-transfer', identity: 'corroborated',
    declared_hospital_name: record.hospital_name, declared_location_name: record.location_name,
    declared_address: record.address, declared_license_state: record.license_state,
    declared_last_updated: record.last_updated, cms_template_version: record.cms_version,
    observed_at: proof.observed_at
  });
}
fs.writeFileSync(reviewFile, JSON.stringify(reviews, null, 2) + '\n');
console.log(JSON.stringify({ applied: proof.records.length, observed_at: proof.observed_at }, null, 2));
