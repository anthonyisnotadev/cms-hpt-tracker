#!/usr/bin/env node
/* Store readable companion text for every tracker History item. Original audit
 * evidence and sent email bodies remain unchanged beside these summaries. */
'use strict';

const fs = require('fs');
const path = require('path');
const { loadReviewedView } = require('./lib/reviewed-resolutions');
const { buildAssessmentHistory } = require('./lib/assessment-history');
const { summary, sourceHash, assessmentHash, assessmentRecordSummary, findingRecordSummary } = require('./lib/readable-history');

const ROOT = path.join(__dirname, '..', '..');
const auditDir = path.join(ROOT, 'data', 'hpt-audit');
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const writeJson = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');

function readTable(file) {
  const text = fs.readFileSync(file, 'utf8'), rows = [];
  let field = '', row = [], quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (ch !== '\r') field += ch;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const header = rows[0] || [];
  return rows.slice(1).filter(values => values.length === header.length)
    .map(values => Object.fromEntries(header.map((key, index) => [key, values[index]])));
}

function main() {
  const reviewed = loadReviewedView(auditDir);
  const resolutionRecords = readJson(path.join(auditDir, 'reviewed-resolutions.json'));
  const resolutionByCcn = new Map(resolutionRecords.map(record => [record.ccn, record]));
  const findings = Object.fromEntries(reviewed.compliance.map(row => [row.ccn, {
    sourceHash: sourceHash(row.evidence),
    summary: (() => {
      // When an applied reviewed resolution supersedes the raw finding, the
      // tracker shows the resolved current row. Keep its History summary on
      // that same evidence; the original observation remains in assessments.
      const resolution = resolutionByCcn.get(row.ccn);
      const applied = resolution && reviewed.applied.includes(row.ccn);
      const superseding = applied && resolution.finding === row.finding
        && resolution.note && reviewed.history[row.ccn]
        && reviewed.history[row.ccn].resolution_note === resolution.note;
      return superseding ? summary(resolution.note, row.finding) : findingRecordSummary(row, row.finding);
    })(),
  }]));
  const auditHistory = Object.fromEntries(Object.entries(reviewed.history).map(([ccn, row]) => {
    const text = (row.evidence || '') + (row.history_source === 'nationwide-overlay' ? ' Update: ' : ' Review: ')
      + (row.resolution_note || '');
    return [ccn, { sourceHash: sourceHash(text), summary: summary(text, row.finding) }];
  }));
  const resolutions = Object.fromEntries(readJson(path.join(auditDir, 'reviewed-resolutions.json')).map(row => [
    `${row.ccn}:${sourceHash(row.note)}`, { sourceHash: sourceHash(row.note), summary: summary(row.note) },
  ]));

  const legacyFiles = ['rechecks/2026-09-09/resolution/assessments.csv', 'rechecks/2026-09-09/recovery-856/assessments.csv'];
  const legacy = legacyFiles.flatMap(file => {
    const target = path.join(auditDir, file);
    if (!fs.existsSync(target)) return [];
    return readTable(target);
  });
  const assessments = buildAssessmentHistory(legacy,
    (reviewed.nationwide && reviewed.nationwide.records) || [], resolutionRecords,
    reviewed.applied, reviewed.parserCorrections).assessmentHistory;
  // The tracker applies a reviewed CCN correction to some legacy rows while
  // building the page. Mirror that projection here so rewrite hashes describe
  // the exact records the browser receives.
  const legacyCorrections = new Map(reviewed.parserCorrections.map(record => [record.ccn, record]));
  for (const records of Object.values(assessments)) for (const record of records) {
    const correction = legacyCorrections.get(record.ccn);
    if (correction && record.version === correction.previous_parser_value && record.mrf_url === correction.mrf_url)
      record.mrf_url = correction.mrf_url;
  }
  const readableAssessments = Object.fromEntries(Object.entries(assessments).map(([ccn, records]) => [ccn,
    records.map(record => ({ sourceHash: assessmentHash(record), checkedAt: record.checked_at || '', source: record.source || '',
      summary: assessmentRecordSummary(record, record),
      fullText: record.old_finding ? [record.evidence, record.next_action && `Next: ${record.next_action}`].filter(Boolean).join(' ') : '',
      nextActionSummary: summary(record.blocker, '', { maxChars: 180 }) }))]));

  const outreachFile = path.join(ROOT, 'cms_data', 'outreach.json');
  const outreach = readJson(outreachFile);
  let entryCount = 0, noteCount = 0, emailCount = 0, correctionCount = 0;
  for (const record of Object.values(outreach)) {
    for (const entry of record.entries || []) {
      const source = entry.kind === 'email' ? entry.body : entry.text;
      if (source == null) continue;
      entry.readableSummary = summary(source, '', { kind: entry.kind === 'email' ? 'email' : 'note' });
      entry.readableSourceHash = sourceHash(source);
      entryCount++;
      if (entry.kind === 'note') noteCount++;
      if (entry.kind === 'email') emailCount++;
    }
    if (record.correction && record.correction.note) {
      const source = record.correction.note;
      record.correction.readableSummary = summary(source);
      record.correction.readableSourceHash = sourceHash(source);
      correctionCount++;
    }
  }
  writeJson(outreachFile, outreach);

  // The public file is derived through the existing redactor, which also masks
  // any contact details that might appear in a newly added summary.
  const publicFile = path.join(ROOT, 'cms_data', 'outreach.public.json');
  require('../outreach-redact').generate(outreachFile, publicFile);
  // Match the exact strings the browser reader sees after replacing protected
  // contact tokens. Rewrites for email text therefore cannot reintroduce them.
  const protectedContacts = /hpt-obf:v1:[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;
  const visibleOutreach = JSON.parse(fs.readFileSync(publicFile, 'utf8').replace(protectedContacts, '[protected contact]'));
  const outreachRewrites = Object.fromEntries(Object.entries(visibleOutreach).map(([ccn, record]) => [ccn, {
    entries: Object.fromEntries((record.entries || []).flatMap(entry => {
      const source = entry.kind === 'email' ? entry.body : entry.text;
      if (source == null) return [];
      return [[entry.id, { sourceHash: sourceHash(source),
        summary: summary(source, '', { kind: entry.kind === 'email' ? 'email' : 'note' }) }]];
    })),
    ...(record.correction && record.correction.note ? { correction: {
      sourceHash: sourceHash(record.correction.note), summary: summary(record.correction.note),
    } } : {}),
  }]));

  const rewriteFile = path.join(auditDir, 'readable-history-rewrites.json');
  writeJson(rewriteFile, {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    findings,
    auditHistory,
    reviewedNotes: resolutions,
    assessments: readableAssessments,
    outreach: outreachRewrites,
    counts: {
      findings: Object.keys(findings).length,
      reviewedNotes: Object.keys(resolutions).length,
      assessmentRecords: Object.values(readableAssessments).reduce((sum, list) => sum + list.length, 0),
      outreachEntries: entryCount,
      notes: noteCount,
      emails: emailCount,
      manualCorrections: correctionCount,
      publicOutreachEntries: Object.values(outreachRewrites).reduce((sum, record) => sum + Object.keys(record.entries).length, 0),
    },
  });
  process.stdout.write(JSON.stringify({ output: path.relative(ROOT, rewriteFile), ...readJson(rewriteFile).counts }) + '\n');
}

main();
