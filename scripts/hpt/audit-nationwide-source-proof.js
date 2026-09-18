'use strict';
// Read-only source audit; writes a derived inventory, never a hospital finding.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { csvToObjects } = require('./lib/util');
const { normalizeName } = require('./lib/util');
const { strongAddressAgreement, corroboratedAddressAgreement } = require('./lib/mrf-header-match');
const { normalizeUrl } = require('./pointer-corpus');
const { qualifyBrowserIdentity } = require('./build-nationwide-verification');
const { verificationStateEvidence } = require('./lib/verification-state-evidence');
const root = path.resolve(__dirname, '../..');
const split = value => String(value || '').split('|').map(s => s.trim()).filter(Boolean);
const normalizedText = value => String(value || '').replace(/[\u00a0\ufffd]+/g, ' ').replace(/\s+/g, ' ').trim();
const normalizedName = value => normalizeName(value).replace(/\b([a-z]+) s\b/g, '$1s');
const read = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function retainedRootMatches(record, candidate) {
  const nameMatches = (!record.declared_hospital_name && !record.declared_location_name)
    || [candidate.mrfHospitalName, candidate.mrfLocationName].flatMap(split).some(candidateName =>
      [record.declared_hospital_name, record.declared_location_name].flatMap(split)
        .some(declaredName => normalizedName(candidateName) === normalizedName(declaredName)));
  return nameMatches
    && (!record.declared_address || split(record.declared_address).some(address => split(candidate.mrfAddress).some(candidateAddress =>
      normalizedText(candidateAddress) === normalizedText(address) || strongAddressAgreement(address, candidateAddress))))
    && (!record.declared_last_updated || candidate.declaredLastUpdated === record.declared_last_updated)
    && (!record.cms_template_version || candidate.cmsVersion === record.cms_template_version);
}
function main() {
  const nationwide = read('data/hpt-audit/nationwide-verification.json').records;
  const headers = csvToObjects(fs.readFileSync(path.join(root, 'cms_data/hpt/nationwide-verification/mrf-headers.csv'), 'utf8'));
  const cache = Object.values(read('cms_data/hpt/nationwide-verification/mrf-header-cache.json'));
  const browser = read('data/hpt-audit/nationwide-browser-reviews.json').records;
  const roster = new Map(read('cms_data/hpt/roster.json').map(r => [r.ccn, r]));
  const addressReviews = new Map(read('data/hpt-audit/reviewed-address-equivalences.json').records.map(r => [r.ccn, r]));
  const archiveContentFile = path.join(root, 'data/hpt-audit/reconciliation-archive-content-proof.json');
  const archiveContent = new Map((fs.existsSync(archiveContentFile) ? JSON.parse(fs.readFileSync(archiveContentFile, 'utf8')).records : [])
    .map(record => [record.ccn, record]));
  const byteProofFile = path.join(root, 'data/hpt-audit/nationwide-file-byte-proof.json');
  const byteProof = new Map((fs.existsSync(byteProofFile) ? JSON.parse(fs.readFileSync(byteProofFile, 'utf8')).records : [])
    .map(record => [record.url ? normalizeUrl(record.url) : `sha256:${record.url_sha256}`, record]));
  const index = (rows, field) => {
    const out = new Map();
    for (const row of rows) {
      const key = normalizeUrl(row[field]);
      if (!out.has(key)) out.set(key, []);
      out.get(key).push(row);
    }
    return out;
  };
  const headerIndex = index(headers, 'mrf_url'), cacheIndex = index(cache, 'url'), browserIndex = index(browser, 'target');
  const raw = new Map();
  function retainedByteProof(record) {
    const normalizedUrl = normalizeUrl(record.mrf_url);
    const proof = byteProof.get(normalizedUrl) || byteProof.get(`sha256:${hash(normalizedUrl)}`) || byteProof.get(`sha256:${hash(record.mrf_url)}`);
    if (!proof || !(proof.http_status >= 200 && proof.http_status < 300) || !proof.bytes_retained || !proof.sha256 || !proof.raw_artifact)
      return null;
    const absolute = path.resolve(root, proof.raw_artifact);
    if (!absolute.startsWith(root + path.sep) || !fs.existsSync(absolute)) return null;
    const bytes = fs.readFileSync(absolute);
    if (bytes.length !== proof.bytes_retained || hash(bytes) !== proof.sha256) return null;
    const candidates = proof.parsed_root_candidates || [];
    const matches = candidates.some(candidate => retainedRootMatches(record, candidate));
    return matches ? { checked_at: proof.checked_at, bytes: proof.bytes_retained, sha256: proof.sha256,
      requested_range: proof.requested_range, final_url: proof.final_url, final_host: proof.final_host,
      final_url_withheld: proof.final_url_withheld || '' } : null;
  }
  function streamedArchiveProof(record) {
    const proof = archiveContent.get(record.ccn);
    if (!proof || normalizeUrl(proof.mrf_url) !== normalizeUrl(record.mrf_url)
      || !/^[a-f0-9]{64}$/.test(proof.decompressed_sha256 || '') || !Number.isSafeInteger(proof.decompressed_bytes)) return null;
    if (normalizedName(proof.hospital_name) !== normalizedName(record.declared_hospital_name)
      || normalizedText(proof.address) !== normalizedText(record.declared_address)
      || proof.last_updated !== record.declared_last_updated || proof.cms_version !== record.cms_template_version) return null;
    return { observed_at: proof.observed_at, method: 'browser-ranged-zip-complete-member', zip_member: proof.zip_member,
      compressed_bytes: proof.compressed_bytes, decompressed_bytes: proof.decompressed_bytes,
      decompressed_sha256: proof.decompressed_sha256, source_url: proof.source_url };
  }
  function pointerProof(header) {
    return split(header.raw_files).map(file => {
      if (raw.has(file)) {
        const cached = raw.get(file);
        return cached.sha256 && split(header.pointer_sha256s).includes(cached.sha256)
          ? { ...cached, status: 'hash-corroborated' } : { ...cached, status: cached.status === 'hash-corroborated' ? 'hash-mismatch' : cached.status };
      }
      const absolute = path.resolve(root, file);
      if (!absolute.startsWith(root + path.sep)) return { status: 'unsafe-path' };
      const proof = { file: file.replace(/\\/g, '/') };
      if (!fs.existsSync(absolute)) proof.status = 'missing';
      else {
        const bytes = fs.readFileSync(absolute);
        proof.sha256 = hash(bytes);
        proof.status = split(header.pointer_sha256s).includes(proof.sha256) ? 'hash-corroborated'
          : bytes.includes(Buffer.from('hpt-obf:')) ? 'protected-copy-original-hash-not-reproducible' : 'hash-mismatch';
      }
      raw.set(file, proof);
      return proof;
    });
  }
  const records = nationwide.map(record => {
    if (record.latest_observation_superseded) return { ccn: record.ccn, status: 'superseded-by-reviewed-resolution', issues: [],
      observed_at: record.observed_at, superseding_resolution_observed_at: record.superseding_resolution_observed_at,
      superseding_resolution_run: record.superseding_resolution_run };
    if (!record.disposition.startsWith('verified-')) return { ccn: record.ccn, status: 'not-a-verification-claim', issues: [] };
    const url = normalizeUrl(record.mrf_url);
    const matchingHeaders = headerIndex.get(url) || [];
    const header = matchingHeaders.find(h => split(h.header_matched_ccns).includes(record.ccn));
    const facility = roster.get(record.ccn);
    const browserCandidate = (browserIndex.get(url) || []).find(b => b.kind === 'mrf' && b.status === 'retrieved');
    const browserReview = qualifyBrowserIdentity(browserCandidate, facility, addressReviews.get(record.ccn));
    const qualifiedBrowserReview = browserReview?.identity === 'corroborated' ? browserReview : null;
    const source = record.facility_identity === 'corroborated-by-pointer-and-header' ? header : qualifiedBrowserReview;
    const issues = [];
    if (!source) issues.push('claimed-identity-source-not-found');
    const fieldPairs = header && source === header
      ? [['declared_last_updated', 'mrf_last_updated'], ['cms_template_version', 'mrf_cms_version'], ['declared_address', 'mrf_address'], ['declared_hospital_name', 'mrf_hospital_name']]
      : [['declared_last_updated', 'declared_last_updated'], ['cms_template_version', 'cms_template_version'], ['declared_address', 'declared_address'], ['declared_hospital_name', 'declared_hospital_name']];
    for (const [target, field] of fieldPairs) if (source && String(record[target] || '') !== String(source[field] || '')) issues.push('source-field-disagreement:' + target);
    const browserIdentity = source === qualifiedBrowserReview ? qualifiedBrowserReview : null;
    const addressEquivalence = browserIdentity?.identity_gate === 'reviewed-file-address-equivalence';
    const pointerCorroboratedStreet = record.header_identity_gate === 'exact-pointer-ccn-file-corroborated-street-city-zip-license-state-agree'
      && record.declared_license_state === facility?.state
      && split(record.declared_address).some(address => corroboratedAddressAgreement(facility.address, address));
    if (!addressEquivalence && (!record.declared_address || !facility
      || !split(record.declared_address).some(address => strongAddressAgreement(facility.address, address)) && !pointerCorroboratedStreet))
      issues.push('street-evidence-review');
    const stateEvidence = verificationStateEvidence(record.declared_license_state, facility?.state,
      source === header ? header?.identity_gate : browserIdentity?.identity_gate);
    if (stateEvidence.status === 'missing') issues.push('state-evidence-not-recorded');
    else if (stateEvidence.status === 'conflict') issues.push('license-state-conflict');
    const pointerHeader = header || matchingHeaders[0];
    const pointers = pointerHeader ? pointerProof(pointerHeader) : [];
    if (!pointers.some(p => p.status === 'hash-corroborated')) issues.push('original-pointer-hash-not-reproduced');
    const cached = (cacheIndex.get(url) || []).find(c => !header || c.checkedAt === header.checked_at);
    if (header && !cached) issues.push('exact-header-cache-observation-not-found');
    // Parsed caches alone are insufficient. A retained sample closes this gap
    // only when its digest, size, exact URL and parsed root fields reproduce.
    const byteEvidence = retainedByteProof(record);
    const archiveEvidence = streamedArchiveProof(record);
    if (!byteEvidence && !archiveEvidence) issues.push(header ? 'file-byte-proof-not-in-parsed-cache' : 'browser-byte-proof-audit-required');
    return { ccn: record.ccn, disposition: record.disposition, identity_source: source === header && header ? 'header' : source ? 'browser' : 'missing',
      status: issues.length ? 'proof-audit-required' : 'proof-audit-complete', issues, pointer_proof: pointers,
      file_byte_proof: byteEvidence,
      archive_content_proof: archiveEvidence,
      state_evidence: stateEvidence,
      address_equivalence_review: addressEquivalence ? addressReviews.get(record.ccn) : null,
      observed_at: record.observed_at, source_observed_at: header && source === header ? header.checked_at : source?.observed_at || '',
      header_cache_found: !!cached };
  });
  const summary = { hospitals: records.length,
    superseded_observations: records.filter(r => r.status === 'superseded-by-reviewed-resolution').length,
    verification_claims: records.filter(r => !['not-a-verification-claim', 'superseded-by-reviewed-resolution'].includes(r.status)).length,
    issues: {} };
  for (const r of records) for (const issue of r.issues) summary.issues[issue] = (summary.issues[issue] || 0) + 1;
  fs.writeFileSync(path.join(root, 'data/hpt-audit/nationwide-source-proof-audit.json'), JSON.stringify({ summary, records }, null, 2) + '\n');
  console.log(JSON.stringify(summary, null, 2));
}
if (require.main === module) main();
module.exports = { retainedRootMatches };
