'use strict';
const fs = require('fs');
const path = require('path');

const file = path.resolve(__dirname, '../../data/hpt-audit/reviewed-resolutions.json');
const rows = JSON.parse(fs.readFileSync(file, 'utf8'));
const index = rows.findIndex(row => row.ccn === '450253');
if (index < 0 || rows[index].action !== 'correct-site') throw new Error('Bellville correct-site base changed');
const base = rows[index].base;
if (base.finding !== 'not-assessed-not-named-in-file' || base.domain !== 'sjhsyr.org') throw new Error('Bellville base mismatch');
rows[index] = {
  ccn: '450253',
  base,
  action: 'replace',
  evidence: {
    identity: 'corroborated',
    identity_basis: 'current-first-party-Bellville-page-and-complete-current-TallCSV-match-roster-address-state',
    pointerUrl: 'https://midcoasthealthsystem.org/cms-hpt.txt',
    pointerSha256: '44c86cec5e89748abb131df902131b4fbd0a802409cf88d665d68eaf6d8bd68e',
    pointerMrfUrl: 'https://app.box.com/shared/static/3mydfralbd8qx0h8vqu7j9wbf4ps63x7.csv',
    pointerMrfHttpStatus: 206,
    pointerIssue: 'pointer-and-current-source-page-mrf-differ',
    pageMrfUrl: 'https://app.box.com/shared/static/ekqzfqpdsu4v3ma27u1kti5yqdr0qw5b.csv',
    pageMrfSha256: 'dc80c189f37443a0193ef33af668e766ad0b831b3bcfc8930a831a976c132bea',
    pageMrfHttpStatus: 200,
    pageMrfDate: '2026-06-01',
    pageMrfVersion: '3.0.0',
    url: 'https://app.box.com/shared/static/ekqzfqpdsu4v3ma27u1kti5yqdr0qw5b.csv',
    fileSha256: 'dc80c189f37443a0193ef33af668e766ad0b831b3bcfc8930a831a976c132bea',
    fullFileBytes: 15602756,
    http_status: 200,
    checked_at: '2026-09-19T16:25:00Z',
    date: '2026-06-01',
    version: '3.0.0',
    officialDomain: 'midcoasthealthsystem.org',
    location_name: 'Bellville Medical Center',
    declared_hospital_name: 'Bellville Medical Center',
    declared_address: '44 North Cummings St , Bellville, TX 77418',
    declared_license_state: 'TX',
    file_kind: 'csv',
    sourcePageUrl: 'https://midcoasthealthsystem.org/pricing-transparency/',
    sourcePageSha256: '1ab0c981e953a340465bbdaceebe8846accc1d7328f834deb1995c568a0a26e8',
    identityPageUrl: 'https://midcoasthealthsystem.org/mcmc-bellville/',
    identityPageSha256: '696f7953a5777a22df23166bbd868a9246d13d0d2b980aeecc128bfe3a260a66',
    observedFinding: 'pointer-links-older-mrf-than-source-page'
  },
  evidence_run: 'bellville-current-page-tallcsv-complete-file-2026-09-19',
  reviewed_at: '2026-09-19T16:25:00Z',
  note: 'The current first-party Mid Coast pricing page links a complete 15,602,756-byte Bellville TallCSV whose header identifies Bellville Medical Center at 44 North Cummings St, Bellville, TX, dated 2026-06-01 with CMS 3.0.0. The current root pointer remains a separate Bellville-specific 2025-06-01/v2.0.0 target. The newer page-linked file replaces the unrelated New York site assignment and the older pointer-only observation; both source roles remain explicit, with no legal compliance or rate-line conclusion inferred.',
  official: { domain: 'midcoasthealthsystem.org', page: 'https://midcoasthealthsystem.org/pricing-transparency/' }
};
fs.writeFileSync(file, JSON.stringify(rows, null, 2) + '\n');
