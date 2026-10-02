'use strict';
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');

const corrections = [
  {
    ccn: '164007',
    domain: 'https://clivebehavioral.com/',
    proof: 'reconciliation-clive-behavioral-164007-domain-proof-2026-10-01.json',
    basis: 'Search found the first-party facility site clivebehavioral.com with a Standard Services hospital-charges page for Clive Behavioral Health (Clive, IA); recorded uhs.com is the UHS corporate site, not the facility domain. Facility pointer/page are Cloudflare challenge-blocked to automation (HTTP 403), which is not evidence about file availability.',
    disposition: 'official-domain-corrected-pointer-access-blocked-to-client',
    next_action: 'Retry https://clivebehavioral.com/cms-hpt.txt and the Standard Services page through a route that passes the Cloudflare challenge or a publisher-enabled copy; verify declared name (1450 NW 114th Street, Clive, IA 50325), date, CMS version and usability before any promotion.',
  },
  {
    ccn: '264034',
    domain: 'https://southeastbehavioral.com/',
    proof: 'reconciliation-southeast-behavioral-264034-domain-proof-2026-10-01.json',
    basis: 'Search found the first-party facility site southeastbehavioral.com (Southeast Behavioral Hospital, Cape Girardeau, MO) with a Standard Services hospital-charges page; recorded uhs.com is the UHS corporate site. Facility pointer/page are Cloudflare challenge-blocked to automation (HTTP 403), which is not evidence about file availability.',
    disposition: 'official-domain-corrected-pointer-access-blocked-to-client',
    next_action: 'Retry https://southeastbehavioral.com/cms-hpt.txt and the Standard Services page through a route that passes the Cloudflare challenge or a publisher-enabled copy; verify exact identity (Cape Girardeau, MO), date, CMS version and usability before any promotion.',
  },
  {
    ccn: '290062',
    domain: 'https://westhendersonhospital.com/',
    proof: 'reconciliation-west-henderson-290062-domain-proof-2026-10-01.json',
    basis: 'Search found the first-party facility site westhendersonhospital.com (West Henderson Hospital, Henderson, NV 89052) with a Pricing Guide page describing a standard-charges file; recorded uhs.com is the UHS corporate site. Pointer and page are Cloudflare-restricted to automation (HTTP 403), which is not evidence about file availability.',
    disposition: 'official-domain-corrected-pointer-access-blocked-to-client',
    next_action: 'Retry https://westhendersonhospital.com/cms-hpt.txt and the pricing-guide page through a route that passes the Cloudflare restriction or a publisher-enabled copy; require exact CCN 290062 identity (Henderson, NV), date, CMS version and usable CMS CSV/JSON bytes before promotion.',
  },
];

const manualPath = path.join(audit, 'reconciliation-manual-access-observations.json');
const manual = JSON.parse(fs.readFileSync(manualPath, 'utf8'));

for (const c of corrections) {
  manual.records = manual.records.filter((x) => x.ccn !== c.ccn);
  manual.records.push({
    ccn: c.ccn,
    observed_at: '2026-10-01T23:22:14.035Z',
    proof_file: c.proof,
    current_official_domain: c.domain,
    official_domain: c.domain,
    domain_correction_basis: c.basis,
    official_page_observation:
      'Direct GET and headless-browser navigation of the facility Standard Services/Pricing Guide page and /cms-hpt.txt both returned HTTP 403 with a Cloudflare challenge/access page. Client-side failure only; no file-absence or compliance conclusion.',
    disposition: c.disposition,
    next_action: c.next_action,
  });
}

manual.records.sort((a, b) => String(a.ccn).localeCompare(String(b.ccn)));
fs.writeFileSync(manualPath, JSON.stringify(manual, null, 2) + '\n');
console.log(JSON.stringify({ applied: corrections.map((c) => c.ccn) }, null, 2));
