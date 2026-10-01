'use strict';

function compact(text) { return String(text || '').replace(/\s+/g, ' ').trim(); }

// Stable browser-friendly fingerprint used to ignore a saved rewrite after its
// source text has changed. It is an index, not a security or evidence hash.
function sourceHash(text) {
  const value = String(text || '');
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function assessmentHash(record) {
  const volatile = new Set(['ccn', 'hospital_name', 'state', 'mrf_url', 'pointer_url', 'source_page', 'sourcePageUrl']);
  const normalized = Object.fromEntries(Object.keys(record || {}).filter(key => !volatile.has(key))
    .sort().map(key => [key, record[key]]));
  return sourceHash(JSON.stringify(normalized));
}

function splitSentences(text) {
  return (compact(text).match(/.+?(?:[.!?](?=\s+[A-Z0-9])|$)/g) || [])
    .map(sentence => sentence.trim()).filter(Boolean);
}

function summary(text, label = '', options = {}) {
  let clean = compact(text);
  if (!clean) return '';

  const browserFallback = clean.match(/Browser fallback reached official (.+?) page; it identifies .+? and links (.+?), but no CMS pointer/i);
  if (browserFallback) {
    let result = `The official ${browserFallback[1]} page links ${browserFallback[2]}, but no CMS pointer was found.`;
    if (/\bHTTP 404\b/i.test(clean)) result += ' The checked pointer URL returned HTTP 404.';
    return result;
  }

  // Long evidence often appends a procedural recipe after a clear observation.
  // Keep that recipe in the original record; the readable text leads with facts.
  if (options.omitNextStep !== false) {
    const next = clean.search(/\bNext(?: step)?\s*:/i);
    if (next >= 0) clean = clean.slice(0, next).trim();
  }
  if (options.kind === 'email') {
    clean = clean.replace(/^(?:hello|hi|good (?:morning|afternoon|evening))[^\n]*\n+/i, '').trim();
    clean = clean.split(/\n\s*(?:thanks|thank you|best|sincerely|regards)[^\n]*$/i)[0].trim();
    clean = compact(clean);
  }

  const sentences = splitSentences(clean);
  if (label && sentences.length) {
    const words = value => compact(value).toLowerCase().replace(/[^a-z0-9 ]/g, '')
      .split(/\s+/).filter(word => word.length > 2);
    const labelWords = words(label), firstWords = words(sentences[0]);
    const shared = labelWords.filter(word => firstWords.includes(word)).length;
    if (labelWords.length && shared / labelWords.length >= 0.6) sentences.shift();
  }

  const limit = options.maxChars || (options.kind === 'email' ? 220 : 240);
  let result = sentences.slice(0, 2).join(' ');
  if (!result) result = clean;
  if (result.length > limit) {
    const first = sentences[0] || result;
    result = first.length <= limit ? first
      : first.slice(0, limit - 3).replace(/\s+\S*$/, '') + '…';
  }
  return result;
}

function assessmentSummary(record) {
  const disp = String(record.disposition || '').replace(/-/g, ' ');
  const state = String(record.pointer || '').replace(/-/g, ' ');
  const sourceEvidence = compact(record.evidence || '');
  const isGeneric = /^(?:Nationwide verification|Earlier assessment|Applied reviewed resolution)\.?$/i.test(sourceEvidence);
  if (isGeneric) {
    const parts = [];
    if (disp) parts.push(`Assessment: ${disp}.`);
    if (record.website) parts.push(`Website: ${String(record.website).replace(/-/g, ' ')}.`);
    if (state) parts.push(`Pointer: ${state}.`);
    if (record.identity) parts.push(`Facility match: ${String(record.identity).replace(/-/g, ' ')}.`);
    if (record.file_access) parts.push(`File: ${String(record.file_access).replace(/-/g, ' ')}.`);
    if (record.metadata) parts.push(`File details: ${String(record.metadata).replace(/-/g, ' ')}.`);
    return parts.join(' ');
  }
  if (/^(?:Nationwide verification|Earlier assessment|Applied reviewed resolution)\.?$/i.test(sourceEvidence)) return '';
  const fields = [
    ['Official site', record.website], ['Pointer', record.pointer],
    ['Facility match', record.identity], ['File access', record.file_access],
    ['Date / template', record.metadata], ['Browser check', record.browser_observation],
  ].filter(([, value]) => value);
  return fields.map(([label, value]) => `${label}: ${String(value).replace(/-/g, ' ')}.`).join(' ');
}

function assessmentRecordSummary(row, record) {
  const legacy = row && row.old_finding ? row : null;
  if (legacy) {
    const parts = [];
    const evidence = compact(legacy.evidence || legacy.observation || '');
    if (evidence) parts.push(summary(evidence, legacy.old_finding, { maxChars: 320 }));
    else if (legacy.status) parts.push(`Recorded result: ${String(legacy.status).replace(/-/g, ' ')}.`);
    if (legacy.website) parts.push(`Website: ${String(legacy.website).replace(/-/g, ' ')}.`);
    if (legacy.pointer) parts.push(`Pointer: ${String(legacy.pointer).replace(/-/g, ' ')}.`);
    if (legacy.identity) parts.push(`Facility match: ${String(legacy.identity).replace(/-/g, ' ')}.`);
    if (legacy.file_access) parts.push(`File access: ${String(legacy.file_access).replace(/-/g, ' ')}.`);
    if (legacy.date) parts.push(`File date: ${legacy.date}.`);
    if (legacy.version) parts.push(`Template version: ${legacy.version}.`);
    return parts.filter(Boolean).join(' ');
  }
  const base = assessmentSummary(record || {});
  if (!base || base.length > 650) return base;
  const extras = [];
  if (row && row.pointer_historical_checked_url) extras.push('An earlier pointer capture is recorded.');
  if (row && row.pointer_raw_integrity === 'hash-conflict') extras.push('The retained pointer bytes do not match the recorded hash.');
  if (row && row.pointer === 'retrieved-facility-match-unresolved') extras.push('The pointer was found, but no facility entry was assigned.');
  return [base, ...extras].filter(Boolean).join(' ');
}

function findingRecordSummary(row, label = '') {
  const evidence = compact(row && row.evidence);
  const observation = evidence.replace(/\bNext(?: step)?\s*:[\s\S]*$/i, '').trim();
  const generic = /^(?:Nationwide verification|Earlier assessment|Applied reviewed resolution)\.?$/i.test(observation);
  if (!generic) return summary(evidence, label);
  const parts = [];
  if (row.mrf_url) parts.push('A machine-readable file URL is recorded.');
  else if (row.pointer_url) parts.push('A pointer URL is recorded, but no machine-readable file URL is recorded.');
  else parts.push('No machine-readable file URL is recorded.');
  if (row.mrf_last_updated) parts.push(`The file declares an update date of ${row.mrf_last_updated}.`);
  if (row.cms_template_version) parts.push(`The recorded CMS template version is ${row.cms_template_version}.`);
  if (row.domain) parts.push(`The recorded official domain is ${row.domain}.`);
  const result = parts.join(' ');
  return result || (label ? `${label}.` : 'A nationwide assessment was recorded.');
}

module.exports = { summary, sourceHash, assessmentHash, assessmentSummary, assessmentRecordSummary, findingRecordSummary, compact };
