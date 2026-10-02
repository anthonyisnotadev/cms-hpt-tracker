'use strict';
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const ccn = '440183';
const observedAt = '2026-10-01T16:23:01.675Z';
const proofName = 'reconciliation-st-francis-memphis-domain-discrepancy-proof-2026-10-01.json';

const manualPath = path.join(audit, 'reconciliation-manual-access-observations.json');
const manual = JSON.parse(fs.readFileSync(manualPath, 'utf8'));

const record = {
  ccn,
  observed_at: observedAt,
  proof_file: proofName,
  current_official_domain: 'https://www.saintfrancishealthsystem.com/',
  official_domain: 'https://www.saintfrancishealthsystem.com/',
  domain_correction_basis: 'CCN 440183 is Saint Francis Hospital-Memphis, 5959 Park Ave, Memphis, TN 38119 (CMS roster, medicare.gov, AHD). The prior recorded domain saintfrancisevanston.org is Saint Francis Hospital, Evanston, Illinois - a different facility and state. The first-party Saint Francis Health System site lists Saint Francis Hospital - Memphis at 5959 Park Avenue.',
  official_page_observation: 'All automated routes to saintfrancishealthsystem.com (root cms-hpt.txt via plain HTTP and Playwright, Memphis location page via Playwright) returned HTTP 403 with a Cloudflare "Just a moment..." challenge. This is a client-side block, not evidence of file absence or noncompliance.',
  disposition: 'official-domain-corrected-memphis-site-cloudflare-blocked',
  next_action: 'When the saintfrancishealthsystem.com Cloudflare challenge is ordinarily passable, inspect the Memphis pricing page and any cms-hpt.txt, then verify a Memphis 5959 Park Ave identity, TN state, declared date/version and usable bytes. Do not use the saintfrancisevanston.org (Illinois) pointer or its 992441755-named file as CCN 440183 evidence.'
};

manual.records = manual.records.filter((x) => x.ccn !== ccn);
manual.records.push(record);
manual.records.sort((a, b) => String(a.ccn).localeCompare(String(b.ccn)));
fs.writeFileSync(manualPath, JSON.stringify(manual, null, 2) + '\n');
console.log(JSON.stringify({ applied: ccn, domain: record.current_official_domain }, null, 2));
