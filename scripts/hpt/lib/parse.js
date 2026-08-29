'use strict';
const { nameSimilarity, hostOf } = require('./util');

const KEY_ALIASES = {
  'location-name': 'locationName',
  'location_name': 'locationName',
  'locationname': 'locationName',
  'source-page-url': 'sourcePageUrl',
  'source_page_url': 'sourcePageUrl',
  'sourcepageurl': 'sourcePageUrl',
  'mrf-url': 'mrfUrl',
  'mrf_url': 'mrfUrl',
  'mrfurl': 'mrfUrl',
  'contact-name': 'contactName',
  'contact-email': 'contactEmail'
};

/**
 * Parse a cms-hpt.txt body into location entries.
 *
 * CMS specifies repeating `key: value` lines where a new `location-name` starts
 * a new block, but real files also appear as JSON arrays, and some hospitals
 * emit several mrf-url lines under a single location. All three are handled.
 */
function parsePointer(body) {
  const text = String(body || '').replace(/^﻿/, '').trim();
  if (!text) return { entries: [], format: 'empty' };

  // JSON variant
  if (/^[[{]/.test(text)) {
    try {
      const j = JSON.parse(text);
      const arr = Array.isArray(j) ? j : (Array.isArray(j.locations) ? j.locations : [j]);
      const entries = arr.map(o => {
        const e = {};
        for (const [k, v] of Object.entries(o || {})) {
          const key = KEY_ALIASES[String(k).toLowerCase()] || k;
          e[key] = typeof v === 'string' ? v.trim() : v;
        }
        return e;
      }).filter(e => e.locationName || e.mrfUrl);
      if (entries.length) return { entries, format: 'json' };
    } catch (_e) { /* fall through to text parsing */ }
  }

  const entries = [];
  let cur = null;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^([A-Za-z][A-Za-z0-9_-]*)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = KEY_ALIASES[m[1].toLowerCase()];
    const val = m[2].trim();
    if (!key || !val) continue;

    if (key === 'locationName') {
      if (cur) entries.push(cur);
      cur = { locationName: val, mrfUrls: [] };
      continue;
    }
    if (!cur) cur = { locationName: '', mrfUrls: [] };
    if (key === 'mrfUrl') { if (!cur.mrfUrls.includes(val)) cur.mrfUrls.push(val); }
    else cur[key] = val;
  }
  if (cur) entries.push(cur);

  for (const e of entries) {
    if (!e.mrfUrl && e.mrfUrls && e.mrfUrls.length) e.mrfUrl = e.mrfUrls[0];
    if (e.mrfUrls && !e.mrfUrls.length) delete e.mrfUrls;
  }
  return { entries: entries.filter(e => e.locationName || e.mrfUrl), format: 'txt' };
}

/**
 * Assign pointer entries to hospital CCNs.
 *
 * A system's file lists every location, so a domain covering N hospitals needs
 * each entry matched to the right CCN by name. Scores below `threshold` are left
 * unmatched rather than guessed, and are the queue for optional LLM review.
 */
function matchEntriesToHospitals(entries, hospitals, { threshold = 0.55 } = {}) {
  const matches = [];
  const usedEntry = new Set();
  const usedCcn = new Set();

  const pairs = [];
  entries.forEach((e, ei) => {
    hospitals.forEach(h => {
      const score = nameSimilarity(e.locationName || '', h.name || '');
      if (score > 0) pairs.push({ ei, ccn: h.ccn, score });
    });
  });
  pairs.sort((a, b) => b.score - a.score);

  for (const p of pairs) {
    if (p.score < threshold) break;
    if (usedEntry.has(p.ei) || usedCcn.has(p.ccn)) continue;
    usedEntry.add(p.ei); usedCcn.add(p.ccn);
    matches.push({ ccn: p.ccn, entryIndex: p.ei, score: Number(p.score.toFixed(3)), method: 'name' });
  }

  // A single-location file on a single-hospital domain needs no name evidence.
  if (!matches.length && entries.length === 1 && hospitals.length === 1) {
    matches.push({ ccn: hospitals[0].ccn, entryIndex: 0, score: 1, method: 'sole-candidate' });
    usedEntry.add(0); usedCcn.add(hospitals[0].ccn);
  }

  return {
    matches,
    unmatchedEntries: entries.map((e, i) => i).filter(i => !usedEntry.has(i)),
    unmatchedHospitals: hospitals.filter(h => !usedCcn.has(h.ccn)).map(h => h.ccn)
  };
}

/** Sanity-check an MRF URL before we spend a download on it. */
function isPlausibleMrfUrl(u) {
  if (!u) return false;
  try {
    const url = new URL(u);
    if (!/^https?:$/.test(url.protocol)) return false;
    if (!hostOf(u)) return false;
    return true;
  } catch (_e) { return false; }
}

function guessFormat(u) {
  const s = String(u || '').toLowerCase();
  if (/\.json(\.gz)?($|[?#])/.test(s)) return 'json';
  if (/\.csv(\.gz)?($|[?#])/.test(s)) return 'csv';
  if (/\.xlsx?($|[?#])/.test(s)) return 'xlsx';
  return 'unknown';
}

module.exports = { parsePointer, matchEntriesToHospitals, isPlausibleMrfUrl, guessFormat };
