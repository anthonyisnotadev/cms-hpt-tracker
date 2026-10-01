'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { summary, compact } = require('./readable-history');

const CCN_KEYS = new Set([
  'ccn', 'ccns', 'ccn_investigated', 'ccn_under_review', 'facility_ccn',
  'cms_ccn', 'cms_certification_number', 'provider_number', 'source_ccns',
  'related_ccn', 'sibling_ccn',
]);
const FACT_KEYS = [
  'interpretation', 'finding', 'conclusion', 'result', 'summary', 'outcome',
  'observation', 'finding_summary', 'evidence_classification', 'issue',
  'limitation', 'disposition', 'status',
];
const DATE_KEYS = ['observed_at', 'checked_at', 'reviewed_at', 'observed_on', 'attempted_at', 'generated_at'];

function ccnValues(value) {
  return (Array.isArray(value) ? value : [value]).map(String).filter(value => /^\d{6}$/.test(value));
}

function namedCcns(value, depth = 0, result = new Set()) {
  if (!value || typeof value !== 'object' || depth > 6) return result;
  if (Array.isArray(value)) {
    value.forEach(item => namedCcns(item, depth + 1, result));
    return result;
  }
  for (const [key, entry] of Object.entries(value)) {
    if (CCN_KEYS.has(key)) ccnValues(entry).forEach(ccn => result.add(ccn));
    else if (entry && typeof entry === 'object') namedCcns(entry, depth + 1, result);
  }
  return result;
}

function firstText(value, depth = 0) {
  if (typeof value === 'string') return compact(value);
  if (!value || typeof value !== 'object' || depth > 2) return '';
  for (const key of FACT_KEYS) {
    const text = firstText(value[key], depth + 1);
    if (text) return text;
  }
  return '';
}

function safeText(value) {
  return compact(value)
    .replace(/https?:\/\/\S+/gi, '[source URL]')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[contact]')
    .replace(/\bhpt-obf:v1:[A-Za-z0-9_.-]+\b/g, '[protected contact]');
}

function prose(value, maxChars = 260) {
  const text = safeText(value);
  if (!text) return '';
  const clause = text.length > maxChars ? text.split(';')[0] : text;
  let sentence = summary(clause, '', { maxChars });
  if (/^[a-z0-9]+(?:-[a-z0-9]+){1,}$/i.test(sentence)) sentence = sentence.replace(/-/g, ' ');
  sentence = sentence.replace(/^./, character => character.toUpperCase());
  return /[.!?…]$/.test(sentence) ? sentence : sentence + '.';
}

function titleFor(file) {
  return file.replace(/^reconciliation-/, '').replace(/\.json$/, '')
    .replace(/-\d{4}-\d{2}-\d{2}(?:\.incomplete)?$/, '')
    .replace(/-proofs?$/, '').replace(/-review$/, ' review')
    .replace(/-/g, ' ').replace(/\b(?:cms|mrf|ccn|qies|npi|api|http)\b/gi, word => word.toUpperCase())
    .replace(/^./, character => character.toUpperCase());
}

function dateFor(record, document, file) {
  for (const source of [record, document]) for (const key of DATE_KEYS) {
    const date = String(source?.[key] || '').slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
  }
  return file.match(/\d{4}-\d{2}-\d{2}/)?.[0] || '';
}

function entryFor(file, document, record, recordIndex = null) {
  const fact = firstText(record) || (record === document ? '' : firstText(document));
  const action = typeof record?.next_action === 'string' ? record.next_action
    : typeof document?.next_action === 'string' ? document.next_action : '';
  const label = titleFor(file);
  const finding = prose(fact) || `A ${label.toLowerCase()} observation was recorded.`;
  const nextAction = prose(action, 220);
  return {
    title: label,
    observedAt: dateFor(record, document, file),
    finding,
    ...(nextAction && nextAction !== finding ? { nextAction } : {}),
    sourceFile: file,
    ...(recordIndex === null ? {} : { recordIndex }),
  };
}

function buildAuditDocumentHistory(auditDir, knownCcns) {
  const byCcn = {}, skipped = [];
  const known = new Set(knownCcns);
  const files = fs.readdirSync(auditDir).filter(file => /^reconciliation-.*\.json$/.test(file)
    && !file.includes('.incomplete.')).sort();
  let indexedDocuments = 0, entries = 0;
  function add(ccn, entry) {
    if (!known.has(ccn)) return;
    (byCcn[ccn] ||= []).push(entry);
    entries++;
  }
  for (const file of files) {
    const document = JSON.parse(fs.readFileSync(path.join(auditDir, file), 'utf8'));
    const rootCcns = [...namedCcns(Object.fromEntries(Object.entries(document)
      .filter(([key]) => CCN_KEYS.has(key))))].filter(ccn => known.has(ccn));
    if (rootCcns.length && rootCcns.length <= 8) {
      const entry = entryFor(file, document, document);
      rootCcns.forEach(ccn => add(ccn, entry));
      indexedDocuments++;
      continue;
    }
    const records = Array.isArray(document.records) ? document.records
      : document.record && typeof document.record === 'object' ? [document.record] : [];
    let linked = false;
    records.forEach((record, index) => {
      const ccns = [...namedCcns(record)].filter(ccn => known.has(ccn));
      if (!ccns.length || ccns.length > 8) return;
      const entry = entryFor(file, document, record, index);
      ccns.forEach(ccn => add(ccn, entry));
      linked = true;
    });
    if (!linked) {
      const ccns = [...namedCcns(document)].filter(ccn => known.has(ccn));
      if (ccns.length && ccns.length <= 8) {
        const entry = entryFor(file, document, document);
        ccns.forEach(ccn => add(ccn, entry));
        linked = true;
      }
    }
    if (linked) indexedDocuments++;
    else skipped.push(file);
  }
  for (const list of Object.values(byCcn)) list.sort((a, b) =>
    b.observedAt.localeCompare(a.observedAt) || a.sourceFile.localeCompare(b.sourceFile)
    || (a.recordIndex ?? -1) - (b.recordIndex ?? -1));
  return { byCcn, counts: { scannedDocuments: files.length, indexedDocuments, entries,
    hospitals: Object.keys(byCcn).length, unlinkedDocuments: skipped.length }, skipped };
}

module.exports = { buildAuditDocumentHistory };
