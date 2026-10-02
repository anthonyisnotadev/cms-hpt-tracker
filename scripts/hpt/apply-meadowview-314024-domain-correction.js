'use strict';
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const ccn = '314024';
const observedAt = '2026-10-01T20:03:27.831Z';
const proofName = 'reconciliation-314024-meadowview-proof-2026-10-01.json';

const manualPath = path.join(audit, 'reconciliation-manual-access-observations.json');
const manual = JSON.parse(fs.readFileSync(manualPath, 'utf8'));

const record = {
  ccn,
  observed_at: observedAt,
  proof_file: proofName,
  current_official_domain: 'https://www.hcnj.us/',
  official_domain: 'https://www.hcnj.us/',
  domain_correction_basis: 'CCN 314024 is Meadowview Psychiatric Hospital (Hudson County), 595 County Avenue, Secaucus, NJ 07094. Search plus the facility page at https://www.hcnj.us/health-and-human-services/psychiatric-hospital (name, address, phone 201-369-5252) establish the first-party domain is the Hudson County site hcnj.us; US News and AHD (provider 314024) also list www.hcnj.us. The recorded hudsoncountynj.org is not the first-party domain.',
  official_page_observation: 'GET https://www.hcnj.us/cms-hpt.txt returned HTTP 404. GET of the facility page returned HTTP 200 (340,339 bytes) with zero href matches for price|charge|transparen|standard|cms. No MRF or pointer retrieved.',
  disposition: 'official-domain-corrected-pointer-not-found',
  next_action: 'Search hcnj.us (site sections, sitemap, Hudson County budget/resolution documents) for a Meadowview-specific CMS-template MRF or pricing page; reconcile current CMS ownership/scope before assigning any exemption or compliance label. Do not infer compliance or file absence from the root-pointer 404 alone.'
};

manual.records = manual.records.filter((x) => x.ccn !== ccn);
manual.records.push(record);
manual.records.sort((a, b) => String(a.ccn).localeCompare(String(b.ccn)));
fs.writeFileSync(manualPath, JSON.stringify(manual, null, 2) + '\n');
console.log(JSON.stringify({ applied: ccn, domain: record.current_official_domain }, null, 2));
