'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const obsPath = path.join(audit, 'reconciliation-manual-access-observations.json');
const obs = JSON.parse(fs.readFileSync(obsPath, 'utf8'));
const observation = {
  ccn: '400004',
  observed_at: '2026-10-01T20:19:10.000Z',
  proof_file: 'reconciliation-hospital-maestro-400004-domain-lost-proof-2026-10-01.json',
  current_official_domain: '',
  domain_correction_basis: "hospitalelmaestro.org returned HTTP 200 on 2026-10-01 but serves an unrelated Indonesian gambling site (agam99.com / portal.agam99-bisa.com links, Indonesian-language content); /cms-hpt.txt, /price-transparency and /transparencia-de-precios are 404. No successor first-party Hospital del Maestro domain was found in two web searches; directories still cite the stale URL. The recorded official_domain is therefore no longer valid and no replacement is currently known.",
  official_page_observation: "No official pricing page observed; the domain that previously represented the hospital now serves third-party content. News context (not publisher evidence): the hospital filed Chapter 11 in August 2025 and is seeking an operator.",
  disposition: 'official-domain-lost-repurposed-no-successor-found',
  next_action: 'Find the successor/official Hospital del Maestro website or operator contact route (hospital is in Chapter 11 and seeking an operator); once a genuine first-party domain exists, re-run domain search and pointer/file checks from it. Do not reuse hospitalelmaestro.org results.'
};
obs.records = obs.records.filter(row => row.ccn !== '400004');
obs.records.push(observation);
obs.records.sort((a, b) => a.ccn.localeCompare(b.ccn));
fs.writeFileSync(obsPath, `${JSON.stringify(obs, null, 2)}\n`);
console.log(JSON.stringify({ updated: '400004', disposition: observation.disposition }, null, 2));
