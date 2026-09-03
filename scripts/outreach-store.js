#!/usr/bin/env node
/* Outreach record store - the single write path for cms_data/outreach.json.
 *
 * The mutation and validation logic used to live in outreach-server.js, which
 * meant it was duplicated with js/outreach.js's local backend. It now lives
 * here, and both outreach-server.js (HTTP) and outreach-cli.js (terminal, and
 * therefore the LLM) call in. js/outreach.js still carries its own copy because
 * it runs in the browser with no build step; keep the two in sync by hand.
 *
 * Writes are atomic (tmp + rename) and take a one-deep backup first, so a bad
 * batch is always one `restore` away.
 *
 * No dependencies.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const redact = require('./outreach-redact');

const ROOT = path.join(__dirname, '..');
const DATA_FILE = path.join(ROOT, 'cms_data', 'outreach.json');
const BACKUP_FILE = path.join(ROOT, 'cms_data', 'outreach.backup.json');

const STATUSES = ['none', 'contacted', 'awaiting-reply', 'replied', 'resolved', 'no-response'];
const OUTCOMES = ['none', 'replied', 'bounced', 'no-response'];
const VERDICTS = ['', 'compliant', 'failing', 'blocked', 'exempt', 'unknown'];

class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

/* ---------- helpers (mirror js/outreach.js exactly) ---------- */

function nowIso() { return new Date().toISOString(); }
function today() { return nowIso().slice(0, 10); }
function entryId() { return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8); }
function clamp(v, n) { return String(v == null ? '' : v).slice(0, n); }
function isDate(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')); }

function normUrl(v) {
  const s = clamp(v, 2000).trim();
  if (!s) return '';
  try {
    const u = new URL(s);
    return (u.protocol === 'http:' || u.protocol === 'https:') ? u.href : '';
  } catch (e) { return ''; }
}

function normDomain(v) {
  const s = clamp(v, 300).trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(s) ? s : '';
}

function blank(ccn, seed) {
  seed = seed || {};
  return {
    ccn,
    name: clamp(seed.name, 300),
    city: clamp(seed.city, 120),
    state: clamp(seed.state, 8),
    status: 'none',
    followUpOn: '',
    createdAt: nowIso(),
    updatedAt: nowIso(),
    entries: [],
  };
}

/* ---------- persistence ---------- */

let records = Object.create(null);
let loadedMtimeMs = -1;

function readFileInto(target) {
  try {
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    Object.keys(parsed || {}).forEach((k) => {
      if (k === '__proto__' || k === 'constructor' || k === 'prototype') return;
      target[k] = parsed[k];
    });
  } catch (e) {
    if (e.code !== 'ENOENT') throw new ApiError(500, `could not read ${DATA_FILE}: ${e.message}`);
  }
}

function mtimeMs() {
  try { return fs.statSync(DATA_FILE).mtimeMs; } catch (e) { return -1; }
}

function load() {
  records = Object.create(null);
  readFileInto(records);
  loadedMtimeMs = mtimeMs();
  return records;
}

/* Re-read only if something else (the CLI, or a git checkout) touched the file
 * since we last read it. The long-lived server calls this before every mutation
 * so a terminal write is never silently clobbered by stale memory. */
function syncFromDisk() {
  const m = mtimeMs();
  if (m !== loadedMtimeMs) load();
  return records;
}

function save() {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  try {
    if (fs.existsSync(DATA_FILE)) fs.copyFileSync(DATA_FILE, BACKUP_FILE);
  } catch (e) {
    throw new ApiError(500, `could not write backup ${BACKUP_FILE}: ${e.message}`);
  }
  const tmp = `${DATA_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(records, null, 2)}\n`);
  fs.renameSync(tmp, DATA_FILE);
  loadedMtimeMs = mtimeMs();
  redactPublic();
}

/* Regenerate the shareable copy after every write, so cms_data/outreach.public.json
 * can never drift from the private file. Best-effort: a redaction failure must
 * not lose the write that already landed. */
function redactPublic() {
  try {
    redact.generate(redact.SRC, redact.DST);
  } catch (e) {
    console.error(`warning: could not regenerate ${path.basename(redact.DST)}: ${e.message}`);
  }
}

function restore() {
  if (!fs.existsSync(BACKUP_FILE)) throw new ApiError(404, `no backup at ${BACKUP_FILE}`);
  fs.copyFileSync(BACKUP_FILE, DATA_FILE);
  return load();
}

/* ---------- mutations ---------- */

function requireCcn(body) {
  const ccn = body && body.ccn;
  if (!ccn) throw new ApiError(400, 'ccn required');
  return ccn;
}

function seedLabels(rec, body) {
  if (!rec.name && body.name) rec.name = clamp(body.name, 300);
  if (!rec.city && body.city) rec.city = clamp(body.city, 120);
  if (!rec.state && body.state) rec.state = clamp(body.state, 8);
}

function upsert(body) {
  const ccn = requireCcn(body);
  if (body.status != null && STATUSES.indexOf(body.status) === -1) {
    throw new ApiError(400, `unknown status: ${body.status}`);
  }
  const rec = records[ccn] || blank(ccn, body);
  if (body.name != null) rec.name = clamp(body.name, 300);
  if (body.city != null) rec.city = clamp(body.city, 120);
  if (body.state != null) rec.state = clamp(body.state, 8);
  if (body.status != null) rec.status = body.status;
  if (body.followUpOn != null) rec.followUpOn = isDate(body.followUpOn) ? body.followUpOn : '';
  rec.updatedAt = nowIso();
  records[ccn] = rec;
  return { record: rec };
}

function addEntry(body) {
  const ccn = requireCcn(body);
  const kind = body.kind === 'email' ? 'email' : 'note';
  const entry = { id: entryId(), kind, at: nowIso() };
  if (kind === 'note') {
    entry.text = clamp(body.text, 8000).trim();
    if (!entry.text) throw new ApiError(400, 'note text is required');
  } else {
    entry.subject = clamp(body.subject, 500).trim();
    if (!entry.subject) throw new ApiError(400, 'email subject is required');
    entry.to = clamp(body.to, 320).trim();
    entry.body = clamp(body.body, 8000);
    entry.sentAt = isDate(body.sentAt) ? body.sentAt : today();
    entry.outcome = OUTCOMES.indexOf(body.outcome) >= 0 ? body.outcome : 'none';
  }

  const rec = records[ccn] || blank(ccn, body);
  rec.entries = Array.isArray(rec.entries) ? rec.entries : [];
  rec.entries.unshift(entry);
  if (kind === 'email' && rec.status === 'none' && entry.outcome !== 'bounced') rec.status = 'awaiting-reply';
  seedLabels(rec, body);
  rec.updatedAt = nowIso();
  records[ccn] = rec;
  return { record: rec, entry };
}

function setCorrection(body) {
  const ccn = requireCcn(body);
  if (body.verdict && VERDICTS.indexOf(body.verdict) === -1) {
    throw new ApiError(400, `unknown verdict: ${body.verdict}`);
  }
  const rec = records[ccn] || blank(ccn, body);
  if (body.clear) {
    delete rec.correction;
  } else {
    const prev = rec.correction || {};
    const pick = (k) => (body[k] != null ? body[k] : prev[k]);
    const next = {
      domain: normDomain(pick('domain')),
      pointerUrl: normUrl(pick('pointerUrl')),
      mrfUrl: normUrl(pick('mrfUrl')),
      lastUpdatedOn: isDate(pick('lastUpdatedOn')) ? pick('lastUpdatedOn') : '',
      templateVersion: clamp(pick('templateVersion'), 24).trim(),
      verdict: body.verdict != null ? body.verdict : (prev.verdict || ''),
      checkedOn: isDate(body.checkedOn) ? body.checkedOn : (prev.checkedOn || today()),
      note: clamp(pick('note'), 2000).trim(),
    };
    const empty = !next.domain && !next.pointerUrl && !next.mrfUrl && !next.lastUpdatedOn
      && !next.templateVersion && !next.verdict && !next.note;
    if (empty) delete rec.correction; else rec.correction = next;
  }
  seedLabels(rec, body);
  rec.updatedAt = nowIso();
  records[ccn] = rec;
  return { record: rec, correction: rec.correction || null };
}

/* An outcome says something about the record as a whole: a reply means the
 * hospital answered, a bounce means the message never landed and so is not one
 * you are awaiting a reply to. Only awaiting-reply moves - contacted and
 * no-response were set deliberately and are left alone. Shared by setOutcome and
 * editEntry so the rule has one home. */
function applyOutcomeStatus(rec, outcome) {
  if (outcome === 'replied' && rec.status === 'awaiting-reply') rec.status = 'replied';
  if (outcome === 'bounced' && rec.status === 'awaiting-reply') rec.status = 'none';
}

function setOutcome(body) {
  const rec = records[body && body.ccn];
  if (!rec) throw new ApiError(404, `no record for ${body && body.ccn}`);
  if (OUTCOMES.indexOf(body.outcome) === -1) throw new ApiError(400, 'unknown outcome');
  const entry = (rec.entries || []).filter((e) => e.id === body.id)[0];
  if (!entry) throw new ApiError(404, `no entry ${body.id}`);
  entry.outcome = body.outcome;
  applyOutcomeStatus(rec, body.outcome);
  rec.updatedAt = nowIso();
  return { record: rec, entry };
}

/* Correct an entry in place. The alternative - delete then re-add - mints a new
 * id and a new `at`, which silently rewrites when you logged something and
 * breaks any reference to the old id. Here both survive, and `editedAt` records
 * that the entry is no longer purely what was first written down.
 *
 * Omitted fields keep their current value, like setCorrection. `kind` cannot
 * change: a note and an email do not hold the same fields, and turning one into
 * the other is a delete and a new entry, honestly.
 *
 * Coercion deliberately differs from addEntry. There, an unparseable sentAt
 * falls back to today, a fair default for something logged just now. Here that
 * would overwrite a date already correct, so a malformed value leaves the stored
 * one standing and surfaces as a discard instead. */
function editEntry(body) {
  const rec = records[body && body.ccn];
  if (!rec) throw new ApiError(404, `no record for ${body && body.ccn}`);
  if (!body.id) throw new ApiError(400, 'entry id required');
  const entry = (rec.entries || []).filter((e) => e.id === body.id)[0];
  if (!entry) throw new ApiError(404, `no entry ${body.id}`);
  if (body.kind != null && body.kind !== entry.kind) {
    throw new ApiError(400, `entry ${body.id} is ${entry.kind === 'email' ? 'an email' : 'a note'}`
      + ` and cannot become ${body.kind === 'email' ? 'an email' : 'a note'}`);
  }
  if (body.outcome != null && OUTCOMES.indexOf(body.outcome) === -1) {
    throw new ApiError(400, `unknown outcome: ${body.outcome}`);
  }

  const next = {};
  if (entry.kind === 'note') {
    if (body.text != null) {
      const text = clamp(body.text, 8000).trim();
      if (!text) throw new ApiError(400, 'note text is required');
      next.text = text;
    }
  } else {
    if (body.subject != null) {
      const subject = clamp(body.subject, 500).trim();
      if (!subject) throw new ApiError(400, 'email subject is required');
      next.subject = subject;
    }
    if (body.to != null) next.to = clamp(body.to, 320).trim();
    if (body.body != null) next.body = clamp(body.body, 8000);
    if (body.sentAt != null) next.sentAt = isDate(body.sentAt) ? body.sentAt : entry.sentAt;
    if (body.outcome != null) next.outcome = body.outcome;
  }

  // A save that changes nothing is not an edit, and should not stamp editedAt or
  // move updatedAt - re-saving an untouched form must leave the record alone.
  const changed = Object.keys(next).filter((k) => entry[k] !== next[k]);
  if (!changed.length) return { record: rec, entry };

  changed.forEach((k) => { entry[k] = next[k]; });
  entry.editedAt = nowIso();
  if (changed.indexOf('outcome') !== -1) applyOutcomeStatus(rec, entry.outcome);
  rec.updatedAt = nowIso();
  return { record: rec, entry };
}

function deleteEntry(body) {
  const rec = records[body && body.ccn];
  if (!rec) return { record: null };
  rec.entries = (rec.entries || []).filter((e) => e.id !== body.id);
  rec.updatedAt = nowIso();
  return { record: rec };
}

function remove(body) {
  delete records[body && body.ccn];
  return {};
}

module.exports = {
  DATA_FILE,
  BACKUP_FILE,
  STATUSES,
  OUTCOMES,
  VERDICTS,
  ApiError,
  nowIso,
  today,
  isDate,
  load,
  save,
  restore,
  syncFromDisk,
  get: (ccn) => records[ccn] || null,
  all: () => Object.keys(records).map((k) => records[k]),
  records: () => records,
  upsert,
  addEntry,
  setCorrection,
  setOutcome,
  editEntry,
  deleteEntry,
  remove,
};
