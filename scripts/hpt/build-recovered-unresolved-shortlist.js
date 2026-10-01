'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { csvToObjects } = require('./lib/util');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const inputPaths = {
  queue: path.join(audit, 'nationwide-reconciliation-queue.json'),
  recovery: path.join(audit, 'rechecks/2026-09-09/recovery-856/file-evidence.csv'),
  compliance: path.join(audit, 'compliance.csv'),
};
const input = Object.fromEntries(Object.entries(inputPaths).map(([key, file]) => [key, fs.readFileSync(file)]));
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const queue = JSON.parse(input.queue.toString('utf8'));
const unresolved = new Map(queue.filter(row => row.workstream === 'genuinely-unresolved-investigation')
  .map(row => [row.ccn, row]));
const domainByCcn = new Map(csvToObjects(input.compliance.toString('utf8')).map(row => [row.ccn, row.domain]));

function hostname(url) {
  try { return new URL(url).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; }
}
function safePublicUrl(url) {
  try {
    const parsed = new URL(url);
    return /^https?:$/.test(parsed.protocol) && !parsed.search && !parsed.username && !parsed.password
      ? `${parsed.origin}${parsed.pathname}` : '';
  } catch { return ''; }
}

const candidateRows = csvToObjects(input.recovery.toString('utf8'))
  .filter(row => unresolved.has(row.ccn) && row.identity === 'corroborated'
    && Number(row.http_status) >= 200 && Number(row.http_status) < 300
    && row.date && row.version === '3.0.0')
  .map(row => {
    const officialDomain = domainByCcn.get(row.ccn) || '';
    const sourcePage = safePublicUrl(row.sourcePageUrl?.split('#')[0] || '');
    const candidate = safePublicUrl(row.url);
    const pageFirstParty = !!officialDomain && (hostname(sourcePage) === officialDomain
      || hostname(sourcePage).endsWith(`.${officialDomain}`));
    const fileFirstParty = !!officialDomain && (hostname(candidate) === officialDomain
      || hostname(candidate).endsWith(`.${officialDomain}`));
    const priority = !candidate ? 4 : pageFirstParty && fileFirstParty ? 1
      : pageFirstParty ? 2 : 3;
    return { ccn: row.ccn, hospital_name: row.hospital_name, official_domain: officialDomain,
      priority, candidate_url: candidate, source_page_url: sourcePage,
      candidate_url_withheld: !candidate && !!row.url,
      recovery_file_http_status: Number(row.http_status), recovery_file_sha256: row.fileSha256,
      recovery_checked_at: row.checked_at, recovery_declared_date: row.date,
      recovery_declared_version: row.version, recovery_declared_name: row.header_name,
      recovery_declared_address: row.header_address, recovery_declared_state: row.header_state,
      next_action: unresolved.get(row.ccn).next_action
        || 'Recheck the exact current root pointer, first-party source page, and bounded candidate file; compare facility identity and metadata independently before applying any reviewed correction.' };
  });
const grouped = new Map();
for (const row of candidateRows) {
  if (!grouped.has(row.ccn)) grouped.set(row.ccn, []);
  grouped.get(row.ccn).push(row);
}
const rows = [...grouped.entries()].map(([ccn, candidates]) => {
  candidates.sort((a, b) => a.priority - b.priority
    || a.recovery_declared_address.localeCompare(b.recovery_declared_address)
    || a.recovery_file_sha256.localeCompare(b.recovery_file_sha256));
  const [primary, ...additional] = candidates;
  return { ...primary,
    // Preserve distinct same-CCN files/campuses as leads instead of emitting
    // duplicate hospital rows or silently discarding candidate evidence.
    additional_candidate_files: additional.map(row => ({
      location_name: row.recovery_declared_name || '',
      address: row.recovery_declared_address || '',
      state: row.recovery_declared_state || '',
      url: row.candidate_url,
      source_page_url: row.source_page_url,
      http_status: row.recovery_file_http_status,
      sha256: row.recovery_file_sha256,
      checked_at: row.recovery_checked_at,
      date: row.recovery_declared_date,
      version: row.recovery_declared_version,
      candidate_url_withheld: row.candidate_url_withheld
    }))
  };
}).sort((a, b) => a.priority - b.priority || a.ccn.localeCompare(b.ccn));
const artifact = {
  scope: 'September 9 identity-corroborated recovery candidates still in genuine unresolved investigation; one row per CCN with distinct campus/file candidates retained',
  source_sha256: Object.fromEntries(Object.entries(input).map(([key, bytes]) => [key, sha256(bytes)])),
  priority_rule: '1=first-party page and file; 2=first-party page with hosted file; 3=third-party page; 4=query-bearing or otherwise unsafe URL withheld',
  records: rows,
};
const output = path.join(audit, 'recovered-unresolved-shortlist.json');
fs.writeFileSync(output, `${JSON.stringify(artifact, null, 2)}\n`);
console.log(JSON.stringify({ total: rows.length,
  by_priority: Object.fromEntries([1, 2, 3, 4].map(p => [p, rows.filter(row => row.priority === p).length])),
  output: path.relative(root, output).replaceAll('\\', '/') }));
