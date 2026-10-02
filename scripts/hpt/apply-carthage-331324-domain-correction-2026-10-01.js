'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const obsPath = path.join(audit, 'reconciliation-manual-access-observations.json');
const obs = JSON.parse(fs.readFileSync(obsPath, 'utf8'));
const observation = {
  ccn: '331324',
  observed_at: '2026-10-01T18:36:09.481Z',
  proof_file: 'reconciliation-carthage-331324-domain-pointer-discovery-proof-2026-10-01.json',
  current_official_domain: 'https://www.carthagehospital.com/',
  domain_correction_basis: "Z.ai web search for Carthage Area Hospital price transparency returned https://carthageareahospital.com/patients-visitors/pricing ('Hospital Pricing - Carthage Area Hospital'), which canonicalizes to https://www.carthagehospital.com/patients-visitors/pricing/ with branding assets from www.carthagehospital.com. The recorded domain claxtonhepburn.org is the separate Claxton-Hepburn Medical Center site at 214 King Street, Ogdensburg, not Carthage Area Hospital's own site.",
  official_page_observation: "Both https://carthageareahospital.com/cms-hpt.txt and https://www.carthagehospital.com/cms-hpt.txt returned HTTP 200 with an identical CMS pointer (location-name: Carthage Area Hospital; mrf-url: https://www.carthagehospital.com/156022079_Carthage-Area-Hospital-Inc_standardcharges_2026.csv). The declared MRF is 830360 bytes, Last-Modified 2026-09-28; its bounded sample declares Carthage Area Hospital, 1001 WEST ST CARTHAGE, NY 13619-9703, license 2238700C, NPI 1104234376, last updated 7/2/2026, CMS template 3.0.0, attestation TRUE, with no Ogdensburg rows in the sample.",
  disposition: 'official-domain-corrected-first-party-pointer-live-carthage-campus-only-331324-unresolved',
  next_action: 'The corrected first-party domain carries a live pointer and current 2026 CSV for the Carthage campus only (matches CCN 331318 at 1001 West Street). CCN 331324 (214 Kings Street, Ogdensburg) still needs an Ogdensburg-specific pointer/MRF or authoritative facility transition evidence; do not infer coverage from the shared hospital name or the Carthage file.'
};
obs.records = obs.records.filter(row => row.ccn !== '331324');
obs.records.push(observation);
obs.records.sort((a, b) => a.ccn.localeCompare(b.ccn));
fs.writeFileSync(obsPath, `${JSON.stringify(obs, null, 2)}\n`);
console.log(JSON.stringify({ updated: '331324', disposition: observation.disposition }, null, 2));
