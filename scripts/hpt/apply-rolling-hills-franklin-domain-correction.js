'use strict';
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const ccn = '444007';
const observedAt = '2026-10-01T16:23:01.675Z';
const proofName = 'reconciliation-rolling-hills-franklin-org-domain-proof-2026-10-01.json';

const manualPath = path.join(audit, 'reconciliation-manual-access-observations.json');
const manual = JSON.parse(fs.readFileSync(manualPath, 'utf8'));

const record = {
  ccn,
  observed_at: observedAt,
  proof_file: proofName,
  current_official_domain: 'https://rollinghillshospital.org/',
  official_domain: 'https://rollinghillshospital.org/',
  domain_correction_basis: 'rollinghillshospital.org is the Franklin, Tennessee Rolling Hills Hospital first-party site (homepage states Franklin, Tennessee; /standard-services Standard Services Price Guide), corroborating the prior Joint Commission association. The prior recorded domain rollinghillshospital.com is the Oklahoma facility and must not be used for CCN 444007.',
  official_page_observation: 'All plain-HTTP routes on rollinghillshospital.org (root, /cms-hpt.txt, /price-transparency, /standard-services) returned HTTP 403 with Cloudflare challenge markup; the previously recorded access-block condition is unchanged. A challenge is a client-side block, not evidence of file absence.',
  disposition: 'official-domain-corrected-franklin-org-site-cloudflare-blocked',
  next_action: 'When rollinghillshospital.org is ordinarily accessible, inspect /standard-services and any cms-hpt.txt; verify any linked MRF for Franklin TN identity, declared date/version and usable bytes. Never assign the Oklahoma rollinghillshospital.com file.'
};

manual.records = manual.records.filter((x) => x.ccn !== ccn);
manual.records.push(record);
manual.records.sort((a, b) => String(a.ccn).localeCompare(String(b.ccn)));
fs.writeFileSync(manualPath, JSON.stringify(manual, null, 2) + '\n');
console.log(JSON.stringify({ applied: ccn, domain: record.current_official_domain }, null, 2));
