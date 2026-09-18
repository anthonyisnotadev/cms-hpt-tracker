'use strict';
const { toAssessment } = require('./nationwide-verification-view');

// Retrieval observations are a chronology, not votes on the standing finding.
function buildAssessmentHistory(legacy, nationwide, resolutions, appliedCcns, parserCorrections = []) {
  const applied = new Set(appliedCcns), history = {};
  const corrections = new Map(parserCorrections.map(record => [record.ccn, record]));
  const add = (ccn, value) => {
    if (!ccn) return;
    (history[ccn] ||= []).push(value);
  };
  for (const record of legacy) {
    const correction = corrections.get(record.ccn);
    const wasMistranscribed = correction && record.version === correction.previous_parser_value
      && record.mrf_url === correction.mrf_url;
    add(record.ccn, { ...record,
      ...(wasMistranscribed ? { metadata: `${record.metadata || record.date || ''} / Parser transcription corrected to literal ${correction.corrected_literal_value}`.trim() } : {}),
      source: 'Earlier assessment' });
  }
  for (const record of nationwide) add(record.ccn, { ...toAssessment(record), source: 'Nationwide observation' });
  for (const record of resolutions) {
    if (!applied.has(record.ccn)) continue;
    const e = record.evidence;
    if (record.action === 'correct-site') {
      add(record.ccn, {
        checked_at: e.checked_at, source: 'Applied reviewed resolution',
        website: 'Official domain corrected: ' + record.official.domain,
        pointer: e.rootPointerResponseKind === 'html-security-challenge'
          ? 'Hospital-domain root returned an HTML security challenge to this client'
          : e.rootPointerResponseKind === 'client-access-denied-web-visible-pointer'
            ? 'Web reader displayed a facility pointer; local GET returned HTTP 403 and browser navigation was blocked (pointer bytes not retained)'
          : 'Hospital-domain root returned HTTP ' + e.rootPointerHttpStatus,
        identity: e.identityAuthority === 'state-hospital-directory-current'
          ? 'State hospital directory name, address, and official domain reviewed'
          : e.identityAuthority === 'wyoming-state-directory-and-current-first-party-web'
            ? 'First-party Casper page and historical Wyoming directory corroborate CCN, name, address, and domain'
          : 'First-party facility name and address reviewed',
        file_access: e.fileSampleUrl ? `HTTP 200 CSV; ${e.fileSampleBytes} bytes sampled; pointer bytes and complete file unverified`
          : e.pageFileUrl ? 'Current page file found; pointer linkage unverified' : 'No file established from corrected domain; file access unverified',
        metadata: e.fileSampleUrl ? `Bounded file header declares ${e.fileDeclaredDate || 'date unverified'} / CMS ${e.fileDeclaredVersion || 'version unverified'}; complete file unverified`
          : e.pageFileUrl ? 'Current page file template and date require review' : 'File metadata not yet established',
        blocker: record.note || '', disposition: record.action
      });
      continue;
    }
    add(record.ccn, e ? {
      checked_at: e.checked_at, source: 'Applied reviewed resolution',
      website: e.officialDomain ? 'Official domain recorded: ' + e.officialDomain : '',
      pointer: e.pointerMrfUrl && e.pointerMrfUrl !== e.url
        ? 'Pointer names a different URL; reviewed file assessed separately'
        : 'Reviewed pointer-to-file linkage', identity: e.identity_basis || e.identity,
      file_access: 'HTTP ' + e.http_status + (e.pointerMrfUrl && e.pointerMrfUrl !== e.url ? ' (separately linked file)' : ''),
      metadata: [e.date, e.version && 'CMS ' + e.version].filter(Boolean).join(' / '),
      blocker: record.note || '', disposition: record.action
    } : {
      checked_at: record.reviewed_at, source: 'Applied reviewed resolution',
      identity: 'Assignment quarantined', blocker: record.note || '', disposition: record.action
    });
  }
  const timestamp = value => Number.isFinite(Date.parse(value.checked_at)) ? Date.parse(value.checked_at) : -Infinity;
  for (const records of Object.values(history)) records.sort((a, b) => timestamp(b) - timestamp(a)
    || Number(b.source === 'Applied reviewed resolution') - Number(a.source === 'Applied reviewed resolution'));
  return { assessments: Object.fromEntries(Object.entries(history).map(([ccn, records]) => [ccn, records[0]])), assessmentHistory: history };
}
module.exports = { buildAssessmentHistory };
