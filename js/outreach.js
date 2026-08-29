/* Outreach store: notes and a log of emails you sent, keyed by CCN.
 *
 * Talks to /api/outreach when a server is serving the page, and
 * falls back to localStorage when it isn't (the standalone build, file://, or a
 * published copy). The two are never merged — whichever backend answers first
 * owns the data — so `mode` is surfaced in the UI to make that visible.
 *
 * Nothing in here sends mail. Emails are recorded after the fact; composing
 * hands off to the user's own mail client via a mailto: link.
 */
(function (global) {
  'use strict';

  var LOCAL_KEY = 'cms-hpt-tracker.outreach.v1';
  var LEGACY_LOCAL_KEY = 'murphylabs.outreach.v1';
  var STATUSES = ['none', 'contacted', 'awaiting-reply', 'replied', 'resolved', 'no-response'];
  var OUTCOMES = ['none', 'replied', 'bounced', 'no-response'];
  var VERDICTS = ['', 'compliant', 'failing', 'blocked', 'exempt', 'unknown'];

  var records = Object.create(null);   // ccn -> record
  var listeners = [];
  var mode = 'local';

  function nowIso() { return new Date().toISOString(); }
  function today() { return nowIso().slice(0, 10); }
  function entryId() { return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8); }
  function clamp(v, n) { return String(v == null ? '' : v).slice(0, n); }
  function isDate(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')); }

  // Corrections accept only absolute http(s) URLs and bare hostnames. Anything
  // else is stored empty rather than half-parsed.
  function normUrl(v) {
    var s = clamp(v, 2000).trim();
    if (!s) return '';
    try {
      var u = new URL(s);
      return (u.protocol === 'http:' || u.protocol === 'https:') ? u.href : '';
    } catch (e) { return ''; }
  }
  function normDomain(v) {
    var s = clamp(v, 300).trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(s) ? s : '';
  }

  /* ---------- discarded input ---------- */

  /* This store coerces silently — a URL without a scheme, a date that isn't
   * YYYY-MM-DD, or a body past its cap is stored empty, replaced, or clipped
   * with no error. In the drawer that reads as a field quietly emptying itself;
   * through importJson() it is invisible entirely. So after every write we
   * compare what was handed in against what landed and report the difference.
   *
   * Comparing after the fact rather than re-validating: normUrl/normDomain/isDate
   * above are already a hand-kept copy of scripts/outreach-store.js, and a second
   * set of rules here would be one more thing to drift. scripts/outreach-cli.js
   * reports the same way for terminal writes. */

  // Fields each write path reads. Anything else handed in is dropped untouched.
  var WRITE_FIELDS = {
    upsert: ['ccn', 'name', 'city', 'state', 'status', 'followUpOn'],
    entry: ['ccn', 'name', 'city', 'state', 'kind', 'subject', 'to', 'body', 'sentAt', 'outcome', 'text'],
    editEntry: ['ccn', 'id', 'kind', 'subject', 'to', 'body', 'sentAt', 'outcome', 'text'],
    correction: ['ccn', 'name', 'city', 'state', 'domain', 'pointerUrl', 'mrfUrl',
      'lastUpdatedOn', 'templateVersion', 'verdict', 'checkedOn', 'note', 'clear'],
  };

  // Fields worth comparing by value. name/city/state are deliberately absent from
  // entry/correction: those paths only seed a blank label, so a record that already
  // has a name is meant to keep it — not a discard, and the drawer passes the
  // labels on every save.
  var COMPARE_FIELDS = {
    upsert: ['name', 'city', 'state', 'status', 'followUpOn'],
    entry: ['subject', 'to', 'body', 'sentAt', 'outcome', 'text'],
    editEntry: ['subject', 'to', 'body', 'sentAt', 'outcome', 'text'],
    correction: ['domain', 'pointerUrl', 'mrfUrl', 'lastUpdatedOn', 'templateVersion',
      'verdict', 'checkedOn', 'note'],
  };

  // Addressing or bookkeeping rather than stored content. id and at are listed
  // because importJson() replays whole entries and this store always mints fresh
  // ones — expected, not a discard worth reporting per entry.
  var SKIP_FIELDS = ['ccn', 'clear', 'id', 'at', 'kind'];

  var FIELD_LABEL = {
    mrfUrl: 'the charges file URL', pointerUrl: 'the pointer URL', domain: 'the domain',
    lastUpdatedOn: 'the file date', checkedOn: 'the checked date', templateVersion: 'the template version',
    followUpOn: 'the follow-up date', sentAt: 'the sent date', note: 'the correction note',
    text: 'the note', body: 'the email body', subject: 'the subject', to: 'the recipient',
    verdict: 'the verdict', status: 'the status', outcome: 'the outcome',
    name: 'the name', city: 'the city', state: 'the state',
  };

  var FIELD_RULE = {
    mrfUrl: 'a URL needs a full http:// or https:// address',
    pointerUrl: 'a URL needs a full http:// or https:// address',
    domain: 'a domain looks like example.org',
    lastUpdatedOn: 'a date must be YYYY-MM-DD',
    checkedOn: 'a date must be YYYY-MM-DD',
    followUpOn: 'a date must be YYYY-MM-DD',
    sentAt: 'a date must be YYYY-MM-DD',
    outcome: 'that is not one of the outcomes',
  };

  function explainDiscard(k, sent, stored) {
    var label = FIELD_LABEL[k] || k;
    if (!stored) return label + ' was dropped — ' + (FIELD_RULE[k] || 'it did not look valid');
    if (stored.length < sent.length && sent.indexOf(stored) === 0) {
      return label + ' was shortened to ' + stored.length + ' characters';
    }
    return label + ' was saved as \u201c' + stored + '\u201d'
      + (FIELD_RULE[k] ? ' \u2014 ' + FIELD_RULE[k] : '');
  }

  function discardsFor(kind, input, landed) {
    var out = [];
    var known = WRITE_FIELDS[kind];
    var compare = COMPARE_FIELDS[kind];
    Object.keys(input || {}).forEach(function (k) {
      if (SKIP_FIELDS.indexOf(k) !== -1) return;
      if (known.indexOf(k) === -1) {
        out.push('\u201c' + k + '\u201d is not a field this tracker stores');
        return;
      }
      if (compare.indexOf(k) === -1) return;
      // A collapsed correction has nothing to compare against, but the rejected
      // fields are why it collapsed — compare against empty so the cause shows too.
      var target = landed;
      if (!target && kind === 'correction' && !(input && input.clear)) target = {};
      if (!target) return;
      // Trim both sides: this store trims some fields and not others, and a trim
      // is not the kind of loss worth reporting. Clipping and coercion still differ.
      var sent = String(input[k] == null ? '' : input[k]).trim();
      var stored = String(target[k] == null ? '' : target[k]).trim();
      if (sent !== stored) out.push(explainDiscard(k, sent, stored));
    });
    return out;
  }

  var lastDiscards = [];
  var discardListeners = [];
  var accumulating = null;   // importJson collects across the whole run

  function reportDiscards(ccn, kind, input, landed) {
    var msgs = discardsFor(kind, input, landed);
    if (kind === 'correction' && !(input && input.clear) && !landed) {
      msgs.push('the correction was dropped — it needs a verdict, a URL, a domain, '
        + 'a file date, a template version or a note (a checked date alone is not enough)');
    }
    lastDiscards = msgs;
    if (!msgs.length) return msgs;
    if (accumulating) {
      msgs.forEach(function (m) { accumulating.push(ccn + ': ' + m); });
    }
    console.warn('[outreach] ' + ccn + ': ' + msgs.join('; '));
    for (var i = 0; i < discardListeners.length; i++) {
      try { discardListeners[i](ccn, kind, msgs); } catch (e) { /* a bad listener must not stall a save */ }
    }
    return msgs;
  }

  function emit() {
    for (var i = 0; i < listeners.length; i++) {
      try { listeners[i](); } catch (e) { /* a bad listener must not stall the rest */ }
    }
  }

  /* An outcome says something about the record as a whole: a reply means the
     hospital answered, a bounce means the message never landed. Only
     awaiting-reply moves — contacted and no-response were set deliberately.
     Shared by setOutcome and editEntry so the rule has one home. */
  function applyOutcomeStatus(rec, outcome) {
    if (outcome === 'replied' && rec.status === 'awaiting-reply') rec.status = 'replied';
    if (outcome === 'bounced' && rec.status === 'awaiting-reply') rec.status = 'none';
  }

  function blank(ccn, seed) {
    seed = seed || {};
    return {
      ccn: ccn,
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

  /* ---------- local backend ---------- */

  function localRead() {
    try {
      var raw = global.localStorage.getItem(LOCAL_KEY) || global.localStorage.getItem(LEGACY_LOCAL_KEY);
      if (!raw) return Object.create(null);
      var parsed = JSON.parse(raw);
      var out = Object.create(null);
      Object.keys(parsed || {}).forEach(function (k) {
        if (k === '__proto__' || k === 'constructor' || k === 'prototype') return;
        out[k] = parsed[k];
      });
      return out;
    } catch (e) { return Object.create(null); }
  }

  function localWrite() {
    try {
      global.localStorage.setItem(LOCAL_KEY, JSON.stringify(records));
      return true;
    } catch (e) {
      // Quota or a privacy mode that blocks writes. Keep the in-memory copy so
      // the current session still works, but say so rather than failing quietly.
      console.warn('[outreach] could not persist to localStorage:', e && e.message);
      return false;
    }
  }

  /* ---------- server backend ---------- */

  function post(path, body) {
    return fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then(function (r) {
      return r.json().then(function (j) {
        if (!r.ok) throw new Error(j && j.error ? j.error : 'HTTP ' + r.status);
        return j;
      });
    });
  }

  /* ---------- init ---------- */

  var ready = (function () {
    if (typeof fetch !== 'function' || !/^https?:$/.test(global.location.protocol)) {
      records = localRead();
      return Promise.resolve('local');
    }
    return fetch('/api/outreach', { headers: { Accept: 'application/json' } })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (j) {
        var next = Object.create(null);
        (j.items || []).forEach(function (rec) { if (rec && rec.ccn) next[rec.ccn] = rec; });
        records = next;
        mode = 'server';
        return 'server';
      })
      .catch(function () {
        records = localRead();
        mode = 'local';
        return 'local';
      });
  })();

  /* ---------- public API ---------- */

  var api = {
    STATUSES: STATUSES,
    OUTCOMES: OUTCOMES,
    VERDICTS: VERDICTS,
    ready: ready,
    get mode() { return mode; },

    onChange: function (fn) { if (typeof fn === 'function') listeners.push(fn); },

    /* Fires when a write stored something other than what it was handed — a URL
       without a scheme, a body past its cap. Saves still succeed; this is the
       only signal that part of the input did not survive. */
    onDiscard: function (fn) { if (typeof fn === 'function') discardListeners.push(fn); },

    /* What the most recent write discarded, for callers that would rather check
       after their own save resolves than subscribe. */
    lastDiscards: function () { return lastDiscards.slice(); },

    get: function (ccn) { return records[ccn] || null; },
    all: function () { return Object.keys(records).map(function (k) { return records[k]; }); },
    count: function () { return Object.keys(records).length; },

    /* Header fields: status, follow-up date, and the identifying labels. */
    upsert: function (ccn, fields) {
      if (!ccn) return Promise.reject(new Error('ccn required'));
      fields = fields || {};
      if (fields.status != null && STATUSES.indexOf(fields.status) === -1) {
        return Promise.reject(new Error('unknown status: ' + fields.status));
      }
      var rec = records[ccn] || blank(ccn, fields);
      if (fields.name != null) rec.name = clamp(fields.name, 300);
      if (fields.city != null) rec.city = clamp(fields.city, 120);
      if (fields.state != null) rec.state = clamp(fields.state, 8);
      if (fields.status != null) rec.status = fields.status;
      if (fields.followUpOn != null) rec.followUpOn = isDate(fields.followUpOn) ? fields.followUpOn : '';
      rec.updatedAt = nowIso();
      records[ccn] = rec;
      reportDiscards(ccn, 'upsert', fields, rec);
      emit();
      if (mode === 'server') {
        return post('/api/outreach/upsert', {
          ccn: ccn, name: rec.name, city: rec.city, state: rec.state,
          status: rec.status, followUpOn: rec.followUpOn,
        }).then(function (j) { records[ccn] = j.record; emit(); return j.record; });
      }
      localWrite();
      return Promise.resolve(rec);
    },

    /* Append a note or an email you already sent. */
    addEntry: function (ccn, input) {
      if (!ccn) return Promise.reject(new Error('ccn required'));
      input = input || {};
      var kind = input.kind === 'email' ? 'email' : 'note';
      var entry = { id: entryId(), kind: kind, at: nowIso() };
      if (kind === 'note') {
        entry.text = clamp(input.text, 8000).trim();
        if (!entry.text) return Promise.reject(new Error('note text is required'));
      } else {
        entry.subject = clamp(input.subject, 500).trim();
        if (!entry.subject) return Promise.reject(new Error('email subject is required'));
        entry.to = clamp(input.to, 320).trim();
        entry.body = clamp(input.body, 8000);
        entry.sentAt = isDate(input.sentAt) ? input.sentAt : today();
        entry.outcome = OUTCOMES.indexOf(input.outcome) >= 0 ? input.outcome : 'none';
      }

      var rec = records[ccn] || blank(ccn, input);
      rec.entries = Array.isArray(rec.entries) ? rec.entries : [];
      rec.entries.unshift(entry);
      if (kind === 'email' && rec.status === 'none' && entry.outcome !== 'bounced') rec.status = 'awaiting-reply';
      if (!rec.name && input.name) rec.name = clamp(input.name, 300);
      if (!rec.city && input.city) rec.city = clamp(input.city, 120);
      if (!rec.state && input.state) rec.state = clamp(input.state, 8);
      rec.updatedAt = nowIso();
      records[ccn] = rec;
      reportDiscards(ccn, 'entry', input, entry);
      emit();

      if (mode === 'server') {
        var payload = { ccn: ccn, kind: kind, name: rec.name, city: rec.city, state: rec.state };
        if (kind === 'note') payload.text = entry.text;
        else {
          payload.to = entry.to; payload.subject = entry.subject;
          payload.body = entry.body; payload.sentAt = entry.sentAt; payload.outcome = entry.outcome;
        }
        return post('/api/outreach/entry', payload)
          .then(function (j) { records[ccn] = j.record; emit(); return j.entry; });
      }
      localWrite();
      return Promise.resolve(entry);
    },

    /* A manual correction to the audit snapshot — the domain or file the crawl
       missed, and whether you judged it current. Kept in its own block so the
       UI can always show it as your finding rather than the crawler's.
       Pass { clear: true } to drop it. */
    setCorrection: function (ccn, fields) {
      if (!ccn) return Promise.reject(new Error('ccn required'));
      fields = fields || {};
      if (fields.verdict && VERDICTS.indexOf(fields.verdict) === -1) {
        return Promise.reject(new Error('unknown verdict: ' + fields.verdict));
      }
      var rec = records[ccn] || blank(ccn, fields);
      if (fields.clear) {
        delete rec.correction;
      } else {
        var prev = rec.correction || {};
        var next = {
          domain: normDomain(fields.domain != null ? fields.domain : prev.domain),
          pointerUrl: normUrl(fields.pointerUrl != null ? fields.pointerUrl : prev.pointerUrl),
          mrfUrl: normUrl(fields.mrfUrl != null ? fields.mrfUrl : prev.mrfUrl),
          lastUpdatedOn: isDate(fields.lastUpdatedOn != null ? fields.lastUpdatedOn : prev.lastUpdatedOn)
            ? (fields.lastUpdatedOn != null ? fields.lastUpdatedOn : prev.lastUpdatedOn) : '',
          templateVersion: clamp(fields.templateVersion != null ? fields.templateVersion : prev.templateVersion, 24).trim(),
          verdict: fields.verdict != null ? fields.verdict : (prev.verdict || ''),
          checkedOn: isDate(fields.checkedOn) ? fields.checkedOn : (prev.checkedOn || today()),
          note: clamp(fields.note != null ? fields.note : prev.note, 2000).trim(),
        };
        var empty = !next.domain && !next.pointerUrl && !next.mrfUrl && !next.lastUpdatedOn
          && !next.templateVersion && !next.verdict && !next.note;
        if (empty) delete rec.correction; else rec.correction = next;
      }
      if (!rec.name && fields.name) rec.name = clamp(fields.name, 300);
      if (!rec.city && fields.city) rec.city = clamp(fields.city, 120);
      if (!rec.state && fields.state) rec.state = clamp(fields.state, 8);
      rec.updatedAt = nowIso();
      records[ccn] = rec;
      reportDiscards(ccn, 'correction', fields, rec.correction || null);
      emit();

      if (mode === 'server') {
        var payload = { ccn: ccn, name: rec.name, city: rec.city, state: rec.state };
        if (fields.clear) payload.clear = true;
        else Object.keys(rec.correction || {}).forEach(function (k) { payload[k] = rec.correction[k]; });
        return post('/api/outreach/correction', payload)
          .then(function (j) { records[ccn] = j.record; emit(); return j.correction; });
      }
      localWrite();
      return Promise.resolve(rec.correction || null);
    },

    setOutcome: function (ccn, id, outcome) {
      var rec = records[ccn];
      if (!rec) return Promise.reject(new Error('no record for ' + ccn));
      if (OUTCOMES.indexOf(outcome) === -1) return Promise.reject(new Error('unknown outcome'));
      var entry = (rec.entries || []).filter(function (e) { return e.id === id; })[0];
      if (!entry) return Promise.reject(new Error('no entry ' + id));
      entry.outcome = outcome;
      applyOutcomeStatus(rec, outcome);
      rec.updatedAt = nowIso();
      emit();
      if (mode === 'server') {
        return post('/api/outreach/entry/outcome', { ccn: ccn, id: id, outcome: outcome })
          .then(function (j) { records[ccn] = j.record; emit(); return j.entry; });
      }
      localWrite();
      return Promise.resolve(entry);
    },

    /* Correct an entry in place. Delete-then-re-add would mint a new id and a new
       `at`, quietly rewriting when you logged the thing; here both survive and
       `editedAt` records that it was revised. Omitted fields keep their current
       value, and `kind` cannot change.

       Coercion differs from addEntry on purpose: a malformed sentAt there falls
       back to today, a fair default for a fresh log, but here it would overwrite a
       date already correct — so it keeps the stored one and reports a discard.
       Mirrors editEntry in scripts/outreach-store.js; keep the two in step. */
    editEntry: function (ccn, id, fields) {
      var rec = records[ccn];
      if (!rec) return Promise.reject(new Error('no record for ' + ccn));
      if (!id) return Promise.reject(new Error('entry id required'));
      var entry = (rec.entries || []).filter(function (e) { return e.id === id; })[0];
      if (!entry) return Promise.reject(new Error('no entry ' + id));
      fields = fields || {};
      if (fields.kind != null && fields.kind !== entry.kind) {
        return Promise.reject(new Error('entry ' + id
          + ' is ' + (entry.kind === 'email' ? 'an email' : 'a note')
          + ' and cannot become ' + (fields.kind === 'email' ? 'an email' : 'a note')));
      }
      if (fields.outcome != null && OUTCOMES.indexOf(fields.outcome) === -1) {
        return Promise.reject(new Error('unknown outcome: ' + fields.outcome));
      }

      var next = {};
      if (entry.kind === 'note') {
        if (fields.text != null) {
          var text = clamp(fields.text, 8000).trim();
          if (!text) return Promise.reject(new Error('note text is required'));
          next.text = text;
        }
      } else {
        if (fields.subject != null) {
          var subject = clamp(fields.subject, 500).trim();
          if (!subject) return Promise.reject(new Error('email subject is required'));
          next.subject = subject;
        }
        if (fields.to != null) next.to = clamp(fields.to, 320).trim();
        if (fields.body != null) next.body = clamp(fields.body, 8000);
        if (fields.sentAt != null) next.sentAt = isDate(fields.sentAt) ? fields.sentAt : entry.sentAt;
        if (fields.outcome != null) next.outcome = fields.outcome;
      }

      // A save that changes nothing is not an edit: no editedAt, no updatedAt, and
      // no request. Re-saving an untouched form must leave the record alone.
      var changed = Object.keys(next).filter(function (k) { return entry[k] !== next[k]; });
      reportDiscards(ccn, 'editEntry', fields, Object.assign({}, entry, next));
      if (!changed.length) return Promise.resolve(entry);

      changed.forEach(function (k) { entry[k] = next[k]; });
      entry.editedAt = nowIso();
      if (changed.indexOf('outcome') !== -1) applyOutcomeStatus(rec, entry.outcome);
      rec.updatedAt = nowIso();
      emit();

      if (mode === 'server') {
        var payload = { ccn: ccn, id: id };
        changed.forEach(function (k) { payload[k] = entry[k]; });
        return post('/api/outreach/entry/edit', payload)
          .then(function (j) { records[ccn] = j.record; emit(); return j.entry; });
      }
      localWrite();
      return Promise.resolve(entry);
    },

    deleteEntry: function (ccn, id) {
      var rec = records[ccn];
      if (!rec) return Promise.resolve(false);
      rec.entries = (rec.entries || []).filter(function (e) { return e.id !== id; });
      rec.updatedAt = nowIso();
      emit();
      if (mode === 'server') {
        return post('/api/outreach/entry/delete', { ccn: ccn, id: id })
          .then(function (j) { records[ccn] = j.record; emit(); return true; });
      }
      localWrite();
      return Promise.resolve(true);
    },

    remove: function (ccn) {
      delete records[ccn];
      emit();
      if (mode === 'server') {
        return post('/api/outreach/delete', { ccn: ccn }).then(function () { return true; });
      }
      localWrite();
      return Promise.resolve(true);
    },

    /* Everything as JSON, for backing up or moving between browser and server. */
    exportJson: function () { return JSON.stringify(records, null, 2); },

    importJson: function (text) {
      var parsed = JSON.parse(text);
      var keys = Object.keys(parsed || {});
      // Every record replays through the same coercion as a hand write, and a
      // bulk import is exactly where nobody is watching. Collect across the run
      // and leave it in lastDiscards() rather than changing what this resolves to.
      accumulating = [];
      var chain = Promise.resolve();
      keys.forEach(function (ccn) {
        if (ccn === '__proto__' || ccn === 'constructor' || ccn === 'prototype') return;
        var rec = parsed[ccn];
        if (!rec || typeof rec !== 'object') return;
        chain = chain
          .then(function () {
            return api.upsert(ccn, {
              name: rec.name, city: rec.city, state: rec.state,
              status: STATUSES.indexOf(rec.status) >= 0 ? rec.status : 'none',
              followUpOn: rec.followUpOn,
            });
          })
          .then(function () {
            if (!rec.correction) return null;
            return api.setCorrection(ccn, rec.correction);
          })
          .then(function () {
            // Oldest first, so the restored timeline keeps its original order.
            var entries = (rec.entries || []).slice().reverse();
            return entries.reduce(function (p, e) {
              return p.then(function () { return api.addEntry(ccn, e); });
            }, Promise.resolve());
          });
      });
      return chain.then(function () {
        lastDiscards = accumulating || [];
        accumulating = null;
        if (lastDiscards.length) {
          console.warn('[outreach] import discarded ' + lastDiscards.length + ' value(s)');
        }
        return keys.length;
      }, function (err) { accumulating = null; throw err; });
    },
  };

  global.Outreach = api;
})(window);
