'use strict';
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const ccn = '250017';
const observedAt = '2026-10-01T23:26:44.065Z';
const proofName = 'reconciliation-250017-domain-correction-proof-2026-10-01.json';

const manualPath = path.join(audit, 'reconciliation-manual-access-observations.json');
const manual = JSON.parse(fs.readFileSync(manualPath, 'utf8'));

const record = {
  ccn,
  observed_at: observedAt,
  proof_file: proofName,
  current_official_domain: 'https://www.phghouston.com/',
  official_domain: 'https://www.phghouston.com/',
  domain_correction_basis: 'CCN 250017 is Progressive Health of Houston (successor of Trace Regional Hospital), 1002 E Madison St, Houston, MS 38851. The contact page https://www.phghouston.com/contact shows the facility name and address; AHD (provider 250017) and US News both list www.phghouston.com as the hospital website. The recorded traceregional.com is a parked JS-redirect shell: every path, including /cms-hpt.txt, returns the same 114-byte window.location="/lander" body. No CMS pointer (HTTP 400) and no standard-charges MRF link were found on phghouston.com on 2026-10-01.',
  official_page_observation: "GET https://traceregional.com/cms-hpt.txt returned HTTP 200 but the identical 114-byte parked-redirect shell (text/html). GET https://www.phghouston.com/cms-hpt.txt returned HTTP 400. GET https://www.phghouston.com/billing-registration returned HTTP 200 (595,410 bytes) with only the prose heading 'What are Standard Charges?' and no downloadable MRF link.",
  disposition: 'official-domain-corrected-pointer-not-found',
  next_action: 'Search phghouston.com exhaustively (Wix site, sitemap, filesusr.com document host) for a Progressive Health of Houston-specific CMS-template MRF or pricing page; as a Rural Emergency Hospital it is not categorically exempt from the standard-charges file requirement. Do not infer compliance or file absence from the root-pointer 400 alone.'
};

manual.records = manual.records.filter((x) => x.ccn !== ccn);
manual.records.push(record);
manual.records.sort((a, b) => String(a.ccn).localeCompare(String(b.ccn)));
fs.writeFileSync(manualPath, JSON.stringify(manual, null, 2) + '\n');
console.log(JSON.stringify({ applied: ccn, domain: record.current_official_domain }, null, 2));
