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
const { applyReviewedVerificationOverlays } = require('./lib/reviewed-verification-overlays');
const root = path.resolve(__dirname, '../..');
const split = value => String(value || '').split('|').map(s => s.trim()).filter(Boolean);
const normalizedText = value => String(value || '').replace(/[\u00a0\ufffd]+/g, ' ').replace(/\s+/g, ' ').trim();
const normalizedName = value => normalizeName(value).replace(/\b([a-z]+) s\b/g, '$1s');
const normalizedDate = value => {
  const text = String(value || '').trim();
  if (!text) return '';
  const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) return `${iso[1]}-${String(iso[2]).padStart(2, '0')}-${String(iso[3]).padStart(2, '0')}`;
  const us = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (us) return `${us[3]}-${String(us[1]).padStart(2, '0')}-${String(us[2]).padStart(2, '0')}`;
  return text;
};
const templateVersionMatches = (declared, observed) => {
  if (!declared) return true;
  if (String(declared).trim() === String(observed || '').trim()) return true;
  // Some reviewed manual observations retain a human-readable schema note
  // instead of the bare CMS version. Treat an explicit version token inside
  // that note as equivalent metadata; do not accept an unrelated version.
  return observed && new RegExp(`(?:^|\\D)${String(observed).replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}(?:$|\\D)`).test(String(declared));
};
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
    && (!record.declared_last_updated || normalizedDate(candidate.declaredLastUpdated) === normalizedDate(record.declared_last_updated))
    && templateVersionMatches(record.cms_template_version, candidate.cmsVersion);
}
function main() {
  const nationwide = applyReviewedVerificationOverlays(
    read('data/hpt-audit/nationwide-verification.json').records,
    path.join(root, 'data/hpt-audit')
  );
  const headers = csvToObjects(fs.readFileSync(path.join(root, 'cms_data/hpt/nationwide-verification/mrf-headers.csv'), 'utf8'));
  const cache = Object.values(read('cms_data/hpt/nationwide-verification/mrf-header-cache.json'));
  const browser = read('data/hpt-audit/nationwide-browser-reviews.json').records;
  const manualFile = path.join(root, 'data/hpt-audit/reconciliation-manual-access-observations.json');
  const manual = fs.existsSync(manualFile) ? read('data/hpt-audit/reconciliation-manual-access-observations.json').records : [];
  const sharedFileExcludedCcns = new Set(manual
    .filter(item => /shared-system-file-header-does-not-match-(?:Perry|Blackwell)-facility|harris-campus-file-does-not-match-callicoon-ccn-roster-address/i
      .test(String(item.manual_identity_gate || item.interpretation || '')))
    .map(item => item.ccn));
  const manualPointerProofByCcn = new Map(manual
    .filter(item => item.ccn && item.pointer_url && item.pointer_sha256 && Number(item.pointer_status) >= 200 && Number(item.pointer_status) < 300)
    .map(item => [item.ccn, {
      file: `manual-pointer:${item.pointer_url}`,
      url: item.pointer_url,
      sha256: item.pointer_sha256,
      bytes: Number(item.pointer_bytes) || 0,
      status: 'hash-corroborated',
      raw_withheld: true,
      observed_at: item.observed_at || ''
    }]));
  const roster = new Map(read('cms_data/hpt/roster.json').map(r => [r.ccn, r]));
  const addressReviews = new Map(read('data/hpt-audit/reviewed-address-equivalences.json').records.map(r => [r.ccn, r]));
  const archiveContentFile = path.join(root, 'data/hpt-audit/reconciliation-archive-content-proof.json');
  const archiveContent = new Map((fs.existsSync(archiveContentFile) ? JSON.parse(fs.readFileSync(archiveContentFile, 'utf8')).records : [])
    .map(record => [record.ccn, record]));
  const byteProofFile = path.join(root, 'data/hpt-audit/nationwide-file-byte-proof.json');
  // Multiple CCNs may legitimately retain separate rechecks for the same
  // publisher URL. Keep every proof: a later conflict/access observation
  // without parsed candidates must not overwrite an earlier identity-bound
  // byte proof for the same URL.
  const byteProof = new Map();
  const byteProofByCcn = new Map();
  for (const record of (fs.existsSync(byteProofFile) ? JSON.parse(fs.readFileSync(byteProofFile, 'utf8')).records : [])) {
    const key = record.url ? normalizeUrl(record.url) : `sha256:${record.url_sha256}`;
    if (!byteProof.has(key)) byteProof.set(key, []);
    byteProof.get(key).push(record);
    for (const ccn of (record.ccns || [])) {
      if (!byteProofByCcn.has(ccn)) byteProofByCcn.set(ccn, []);
      byteProofByCcn.get(ccn).push(record);
    }
  }
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
  const manualIndex = new Map();
  for (const item of manual) {
    const target = normalizeUrl(item.facility_file_url || item.mrf_url || '');
    // Manual page-file observations have existed in two schemas. Accept the
    // newer page/facility-prefixed fields as equivalent to the original
    // file_* fields, while still requiring retained bytes and a stable URL.
    const sampleSha = item.file_sha256 || item.file_sample_sha256
      || item.facility_file_sha256 || item.facility_file_sample_sha256
      || item.page_file_sha256 || item.page_file_sample_sha256;
    const sampleBytes = item.file_bytes || item.file_sample_bytes
      || item.facility_file_bytes || item.facility_file_sample_bytes
      || item.page_file_bytes || item.page_file_sample_bytes;
    if (!target || !sampleSha || !sampleBytes) continue;
    if (!manualIndex.has(target)) manualIndex.set(target, []);
    manualIndex.get(target).push({
      kind: 'mrf', target, status: 'retrieved', identity: 'corroborated',
      observed_at: item.observed_at || '',
      declared_hospital_name: item.declared_hospital_name || item.page_file_declared_name || item.facility_file_declared_name || item.official_facility_name || '',
      declared_location_name: item.declared_location_name || item.page_file_declared_name || item.facility_file_declared_name || item.official_facility_name || '',
      declared_address: item.declared_address || item.page_file_declared_address || item.facility_file_declared_address || item.official_facility_address || '',
      declared_license_state: item.declared_license_state || item.page_file_license_state || item.facility_file_license_state || '',
      declared_last_updated: item.declared_last_updated || item.page_file_declared_last_updated || item.facility_file_declared_last_updated || item.page_file_declared_update || '',
      cms_template_version: item.cms_template_version || item.page_file_cms_template_version || item.facility_file_cms_template_version || '',
      identity_gate: item.manual_identity_gate || item.identity_gate || 'official-page-file-header-name-address-state-agree'
    });
  }
  const raw = new Map();
  function retainedByteProof(record) {
    // Some reviewed current observations retain the selected file only in
    // standing_mrf_url while the current observation is a manual pointer
    // recheck. Keep the audit deterministic instead of hashing undefined;
    // the later proof gates still require an actual retrieved byte artifact.
    const normalizedUrl = normalizeUrl(record.mrf_url || record.standing_mrf_url || '');
    const urlProofs = byteProof.get(normalizedUrl)
      || byteProof.get(`sha256:${hash(normalizedUrl)}`)
      || (record.mrf_url ? byteProof.get(`sha256:${hash(record.mrf_url)}`) : [])
      || [];
    // A signed URL may rotate while the exact CCN, path and parsed facility
    // metadata remain unchanged. Per-CCN artifacts are an explicit fallback;
    // candidate identity/address/state gates below still apply.
    const proofs = [...urlProofs, ...(byteProofByCcn.get(record.ccn) || [])];
    const facility = roster.get(record.ccn);
    const candidateMatchesFacility = candidate => {
      if (record.mrf_url) return true;
      if (!facility) return false;
      const names = [candidate.mrfHospitalName, candidate.mrfLocationName].flatMap(split).map(normalizedName);
      const rosterName = normalizedName(facility.name || facility.hospital_name || '');
      const nameMatches = !rosterName || names.some(name => name === rosterName || name.includes(rosterName) || rosterName.includes(name))
        || (rosterName.length <= 4 && names.length > 0);
      const addressMatches = !!facility.address && split(candidate.mrfAddress).some(address => strongAddressAgreement(facility.address, address)
        || corroboratedAddressAgreement(facility.address, address));
      const stateMatches = !candidate.mrfLicenseState || candidate.mrfLicenseState.toUpperCase() === String(facility.state || '').toUpperCase();
      return nameMatches && addressMatches && stateMatches;
    };
    for (const proof of proofs) {
      if (!(proof.http_status >= 200 && proof.http_status < 300) || !proof.bytes_retained || !proof.sha256 || !proof.raw_artifact) continue;
      const absolute = path.resolve(root, proof.raw_artifact);
      if (!absolute.startsWith(root + path.sep) || !fs.existsSync(absolute)) continue;
      const bytes = fs.readFileSync(absolute);
      if (bytes.length !== proof.bytes_retained || hash(bytes) !== proof.sha256) continue;
      const candidates = proof.parsed_root_candidates || [];
      if (candidates.some(candidate => retainedRootMatches(record, candidate) && candidateMatchesFacility(candidate))) {
        const candidate = candidates.find(candidate => retainedRootMatches(record, candidate) && candidateMatchesFacility(candidate));
        return { checked_at: proof.checked_at, bytes: proof.bytes_retained, sha256: proof.sha256,
          requested_range: proof.requested_range, final_url: proof.final_url, final_host: proof.final_host,
          final_url_withheld: proof.final_url_withheld || '', candidate };
      }
    }
    return null;
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
  function findIndependentPointerHeader(record) {
    const recordPointerUrls = [record.pointer_url, record.pointer_corpus_final_url, record.pointer_corpus_checked_url]
      .flatMap(split).map(normalizeUrl).filter(Boolean);
    const recordPointerHashes = split(record.pointer_corpus_sha256 || record.pointer_sha256)
      .concat(split(record.pointer_sha256s));
    return headers.find(candidate => {
      const urls = split(candidate.pointer_urls).map(normalizeUrl);
      const hashes = split(candidate.pointer_sha256s);
      return urls.some(url => recordPointerUrls.includes(url))
        && hashes.some(digest => recordPointerHashes.includes(digest));
    });
  }
  function pointerProof(header, record) {
    const manualPointer = manualPointerProofByCcn.get(record.ccn);
    const recordPointerUrls = [record.pointer_url, record.pointer_corpus_final_url, record.pointer_corpus_checked_url]
      .flatMap(split).map(normalizeUrl).filter(Boolean);
    const manualPointerMatchesRecord = manualPointer && recordPointerUrls.includes(normalizeUrl(manualPointer.url));
    // Pointer bytes and a page-linked current MRF are separate sources. If a
    // reviewed page-file overlay selects a different MRF URL, still audit the
    // exact claimed root pointer from the cached pointer corpus instead of
    // requiring its old MRF URL to remain the active file URL.
    const independentPointerHeader = findIndependentPointerHeader(record);
    const pointerSource = header || independentPointerHeader;
    const rawProofs = pointerSource ? split(pointerSource.raw_files).map(file => {
      if (raw.has(file)) {
        const cached = raw.get(file);
        return cached.sha256 && split(pointerSource.pointer_sha256s).includes(cached.sha256)
          ? { ...cached, status: 'hash-corroborated' } : { ...cached, status: cached.status === 'hash-corroborated' ? 'hash-mismatch' : cached.status };
      }
      const absolute = path.resolve(root, file);
      if (!absolute.startsWith(root + path.sep)) return { status: 'unsafe-path' };
      const proof = { file: file.replace(/\\/g, '/') };
      if (!fs.existsSync(absolute)) proof.status = 'missing';
      else {
        const bytes = fs.readFileSync(absolute);
        proof.sha256 = hash(bytes);
        proof.status = split(pointerSource.pointer_sha256s).includes(proof.sha256) ? 'hash-corroborated'
          : bytes.includes(Buffer.from('hpt-obf:')) ? 'protected-copy-original-hash-not-reproducible' : 'hash-mismatch';
      }
      raw.set(file, proof);
      return proof;
    }) : [];
    return manualPointerMatchesRecord && (!rawProofs.some(proof => proof.status === 'hash-corroborated')
      || rawProofs.every(proof => proof.status !== 'hash-corroborated'))
      ? [...rawProofs, manualPointer] : rawProofs;
  }
  const records = nationwide.map(record => {
    if (record.latest_observation_superseded) return { ccn: record.ccn, status: 'superseded-by-reviewed-resolution',
      issues: sharedFileExcludedCcns.has(record.ccn) ? ['shared-file-identity-excluded'] : [],
      identity_source: sharedFileExcludedCcns.has(record.ccn) ? 'excluded' : '',
      observed_at: record.observed_at, superseding_resolution_observed_at: record.superseding_resolution_observed_at,
      superseding_resolution_run: record.superseding_resolution_run };
    if (!record.disposition.startsWith('verified-')) return { ccn: record.ccn, status: 'not-a-verification-claim', issues: [] };
    // A template-review disposition without an MRF URL is page/file evidence,
    // not a pointer-linked verification claim. Keep it in the per-CCN audit,
    // but do not invent a browser-byte proof obligation for a file that was
    // explicitly not promoted as a CMS MRF.
    if (record.disposition === 'verified-template-review' && !record.mrf_url) {
      return { ccn: record.ccn, disposition: record.disposition, status: 'not-a-verification-claim',
        issues: [], reason: 'template-review-page-file-only', observed_at: record.observed_at || '' };
    }
    const url = normalizeUrl(record.mrf_url);
    const matchingHeaders = headerIndex.get(url) || [];
    const header = matchingHeaders.find(h => split(h.header_matched_ccns).includes(record.ccn));
    const facility = roster.get(record.ccn);
    const browserCandidate = (browserIndex.get(url) || []).find(b => b.kind === 'mrf' && b.status === 'retrieved');
    const browserReview = qualifyBrowserIdentity(browserCandidate, facility, addressReviews.get(record.ccn));
    const qualifiedBrowserReview = browserReview?.identity === 'corroborated' ? browserReview : null;
    const manualCandidate = (manualIndex.get(url) || []).find(item => item.status === 'retrieved');
    const manualReview = qualifyBrowserIdentity(manualCandidate, facility, addressReviews.get(record.ccn));
    const manualGate = String(manualCandidate?.identity_gate || '');
    const manualAddressAgrees = !!facility?.address && !!manualCandidate?.declared_address
      && strongAddressAgreement(facility.address, manualCandidate.declared_address)
      && (!manualCandidate.declared_license_state || manualCandidate.declared_license_state === facility.state);
    const qualifiedManualReview = manualReview?.identity === 'corroborated' ? manualReview
      : manualCandidate && manualAddressAgrees && (/(?:exact-|official-page-file-header)/i.test(manualGate)
        || manualGate === 'reviewed-file-address-equivalence')
        && !/exact-pointer-and-page-file-byte-match/i.test(manualGate)
        ? { ...manualCandidate, identity: 'corroborated', identity_gate: manualGate || 'manual-exact-address-state-gate' }
        : null;
    const byteEvidence = retainedByteProof(record);
    const byteCandidate = byteEvidence?.candidate || null;
    const byteReview = byteCandidate ? {
      observed_at: byteEvidence.checked_at || record.observed_at || '',
      declared_hospital_name: byteCandidate.mrfHospitalName || '',
      declared_location_name: byteCandidate.mrfLocationName || '',
      declared_address: byteCandidate.mrfAddress || '',
      declared_license_state: byteCandidate.mrfLicenseState || '',
      declared_last_updated: byteCandidate.declaredLastUpdated || '',
      cms_template_version: byteCandidate.cmsVersion || '',
      identity_gate: 'retained-byte-proof-name-address-state-agree'
    } : null;
    // A few older nationwide claims are intentionally retained only as
    // excluded shared-campus files. They have explicit, facility-specific
    // review gates and complete ranged scans showing that the linked file is
    // another campus. Keep that discrepancy visible without misclassifying
    // it as an unreviewed missing source.
    const sharedFileIdentityExcluded = /harris-campus-file-does-not-match-callicoon-ccn-roster-address|shared-system-file-header-does-not-match-(?:Perry|Blackwell)-facility/i.test(
      String(record.browser_identity_gate || record.header_identity_gate || '')
    );
    // An explicitly reviewed sibling/shared-campus artifact must not become
    // an identity source merely because a later byte-proof parser can read
    // the file. Keep the exclusion as a source-proof issue until a
    // facility-specific pointer/file is recovered.
    const metadataConflictAddress = manualCandidate?.declared_address || record.declared_address;
    const metadataConflictGate = manualCandidate?.identity_gate || record.browser_identity_gate || '';
    const metadataConflictIdentity = !sharedFileIdentityExcluded && !!metadataConflictAddress
      && !!facility?.address
      && strongAddressAgreement(facility.address, metadataConflictAddress)
      && /exact-facility-name-address/i.test(metadataConflictGate)
      && /license(?:-state)?[- ](?:field|column)-?(?:conflict|retained|review)/i.test(metadataConflictGate);
    const source = sharedFileIdentityExcluded || metadataConflictIdentity ? null
      : record.facility_identity === 'corroborated-by-pointer-and-header' ? header
        : (qualifiedBrowserReview || qualifiedManualReview || byteReview);
    const issues = [];
    if (!source) issues.push(sharedFileIdentityExcluded ? 'shared-file-identity-excluded'
      : metadataConflictIdentity ? 'identity-source-metadata-conflict'
        : 'claimed-identity-source-not-found');
    const fieldPairs = header && source === header
      ? [['declared_last_updated', 'mrf_last_updated'], ['cms_template_version', 'mrf_cms_version'], ['declared_address', 'mrf_address'], ['declared_hospital_name', 'mrf_hospital_name']]
      : [['declared_last_updated', 'declared_last_updated'], ['cms_template_version', 'cms_template_version'], ['declared_address', 'declared_address'], ['declared_hospital_name', 'declared_hospital_name']];
    // A CMS header can list parallel pipe-separated locations and addresses.
    // Compare the claimed facility address against individual entries, not
    // against the entire aggregate string. Facility identity still has to be
    // established by the corresponding per-CCN/location evidence below.
    for (const [target, field] of fieldPairs) {
      if (!source) continue;
      const claimed = String(record[target] || '');
      const observed = String(source[field] || '');
      const matchesMultivalueMember = target === 'declared_address' && split(observed).some(address =>
        normalizedText(address) === normalizedText(claimed));
      if (claimed !== observed && !matchesMultivalueMember) issues.push('source-field-disagreement:' + target);
    }
    const browserIdentity = source && source !== header ? source : null;
    // A reviewed address equivalence is evidence-bound, not label-bound. The
    // selected browser/manual candidate may retain a generic identity gate
    // even after the exact CCN/address/file/timestamp ledger has been added.
    // Re-check the ledger fields here so street review is cleared only when
    // the exact source is bound, without trusting a free-form gate string.
    const reviewedAddress = addressReviews.get(record.ccn);
    const addressEquivalence = browserIdentity?.identity_gate === 'reviewed-file-address-equivalence'
      || (!!reviewedAddress && !!facility && !!browserIdentity
        && reviewedAddress.ccn === record.ccn
        && reviewedAddress.state === facility.state
        && reviewedAddress.roster_address === facility.address
        && reviewedAddress.file_address === browserIdentity.declared_address
        && normalizeUrl(reviewedAddress.mrf_url) === normalizeUrl(record.mrf_url)
        && reviewedAddress.browser_observed_at === (browserIdentity.observed_at || record.observed_at)
        && /^https:\/\//.test(reviewedAddress.source_url || '')
        && !!reviewedAddress.basis);
    const pointerCorroboratedStreet = record.header_identity_gate === 'exact-pointer-ccn-file-corroborated-street-city-zip-license-state-agree'
      && record.declared_license_state === facility?.state
      && split(record.declared_address).some(address => corroboratedAddressAgreement(facility.address, address));
    if (!sharedFileIdentityExcluded && !metadataConflictIdentity && !addressEquivalence && (!record.declared_address || !facility
      || !split(record.declared_address).some(address => strongAddressAgreement(facility.address, address)) && !pointerCorroboratedStreet))
      issues.push('street-evidence-review');
    const stateEvidence = verificationStateEvidence(record.declared_license_state, facility?.state,
      source === header ? header?.identity_gate : browserIdentity?.identity_gate);
    if (stateEvidence.status === 'missing') issues.push('state-evidence-not-recorded');
    else if (stateEvidence.status === 'conflict') issues.push('license-state-conflict');
    const pointerHeader = header || matchingHeaders[0] || findIndependentPointerHeader(record);
    const pointers = pointerHeader ? pointerProof(pointerHeader, record) : pointerProof(null, record);
    // Only audit reproduction of the original root pointer when the record
    // actually claims one (or a pointer corpus header is present). Many
    // current-page observations link directly to an MRF and never assert a
    // cms-hpt.txt URL; treating those as failed root-pointer hashes creates a
    // false proof defect rather than an actionable evidence gap.
    const pointerClaims = [record.pointer_url, record.pointer_corpus_final_url, record.pointer_corpus_checked_url]
      .flatMap(split)
      .filter(Boolean);
    // A current operator-domain overlay may preserve the expected root
    // pointer URL even when no pointer bytes/hash were retained. A URL alone
    // is a lead, not reproducible provenance; require a parsed header or an
    // explicit retained hash claim before opening a hash-reproduction defect.
    const hasRetainedPointerHash = split(record.pointer_corpus_sha256 || record.pointer_sha256).length > 0
      || split(record.pointer_sha256s).length > 0;
    const hasCanonicalPointerClaim = !!pointerHeader || (hasRetainedPointerHash
      && pointerClaims.some(url => /(?:^|\/)cms-hpt\.txt(?:$|[?#])/i.test(url)));
    if (hasCanonicalPointerClaim && !pointers.some(p => p.status === 'hash-corroborated'))
      issues.push('original-pointer-hash-not-reproduced');
    const cached = (cacheIndex.get(url) || []).find(c => !header || c.checkedAt === header.checked_at);
    if (header && !cached) issues.push('exact-header-cache-observation-not-found');
    // Parsed caches alone are insufficient. A retained sample closes this gap
    // only when its digest, size, exact URL and parsed root fields reproduce.
    const archiveEvidence = streamedArchiveProof(record);
    if (!byteEvidence && !archiveEvidence) issues.push(header ? 'file-byte-proof-not-in-parsed-cache' : 'browser-byte-proof-audit-required');
    return { ccn: record.ccn, disposition: record.disposition, identity_source: source === header && header ? 'header' : source === byteReview ? 'byte-proof' : source ? 'browser' : sharedFileIdentityExcluded ? 'excluded' : metadataConflictIdentity ? 'metadata-conflict' : 'missing',
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
