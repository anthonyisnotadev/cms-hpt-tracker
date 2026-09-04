'use strict';
const zlib = require('zlib');
const http = require('http');
const https = require('https');
const { parseCSV } = require('./util');
const { BROWSER_HEADERS, unblockerGet, activeProvider } = require('./fetch');

const HEAD_BYTES = 16384;
// Compressed payloads need a wider window to inflate a usable header row.
const COMPRESSED_BYTES = 262144;

/**
 * Normalize the many date spellings hospitals emit into ISO yyyy-mm-dd.
 * Observed in the wild: "3/27/2026", "2026-04-01", "2025-09-09", "4/1/2026".
 */
function toISODate(raw) {
  const s = String(raw || '').trim().replace(/^["']|["']$/g, '');
  if (!s) return null;
  let m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (m) return iso(m[1], m[2], m[3]);
  m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);       // US month-first
  if (m) return iso(m[3], m[1], m[2]);
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return null;

  function iso(y, mo, da) {
    const Y = Number(y), M = Number(mo), D = Number(da);
    if (!Y || M < 1 || M > 12 || D < 1 || D > 31) return null;
    return `${Y}-${String(M).padStart(2, '0')}-${String(D).padStart(2, '0')}`;
  }
}

/** Detect the real payload type from magic bytes, not the URL extension. */
function sniffKind(buf, contentType) {
  if (buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b) return 'zip';
  if (buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b) return 'gzip';
  const head = buf.slice(0, 400).toString('utf8').trimStart();
  if (head.startsWith('{') || head.startsWith('[')) return 'json';
  // Panacea and several hospital-owned hosts serve fully quoted CSV headers as
  // application/octet-stream. Content sniffing must therefore accept either
  // quoted or bare field names instead of relying on the response MIME type.
  if (/^"?[a-z_][a-z0-9_ ]*"?\s*,\s*"?[a-z_][a-z0-9_ ]*"?/i.test(head)) return 'csv';
  if (/json/i.test(contentType || '')) return 'json';
  if (/csv/i.test(contentType || '')) return 'csv';
  return 'unknown';
}

/**
 * Pull the CMS-required `last_updated_on` and template `version` out of the
 * first chunk of the file. The CMS template places both in the leading metadata
 * (JSON top-level keys, or the CSV's first header/value row pair), so a ranged
 * request avoids downloading files that routinely exceed 300 MB.
 */
// Hospitals spell the column several ways; server.js already learned this set
// the hard way, so the same relaxed matching is applied here.
const UPDATED_ALIASES = new Set([
  'lastupdatedon', 'lastupdated', 'lastupdateddate', 'lastupdatedondate',
  'updatedon', 'filelastupdated', 'filelastupdatedon'
]);
const ISO_IN_TEXT = /(19|20)\d{2}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])/;
// Matches a JSON string value while tolerating escaped quotes inside it. A
// naive "([^"]*)" truncates at the first \" and yields a corrupt date.
const jsonStr = key => new RegExp(`"${key}"\\s*:\\s*"([^"\\\\]*(?:\\\\.[^"\\\\]*)*)"`, 'i');

/** Hospitals write the template version as "3.0.0", "V3.0.0", "v3.0"; group them. */
function normalizeVersion(v) {
  const s = String(v || '').trim().replace(/^v/i, '');
  return /^\d/.test(s) ? s : (s || null);
}

function findUpdatedIndex(headers) {
  const exact = headers.indexOf('last_updated_on');
  if (exact !== -1) return exact;
  const norm = s => String(s || '').toLowerCase().replace(/[^a-z]/g, '');
  for (let i = 0; i < headers.length; i++) {
    const n = norm(headers[i]);
    if (UPDATED_ALIASES.has(n)) return i;
    if (n.includes('last') && n.includes('updated')) return i;
  }
  return -1;
}

const US_STATE = /^(A[LKZR]|C[AOT]|D[EC]|FL|GA|HI|I[ADLN]|K[SY]|LA|M[ADEINOST]|N[CDEHJMVY]|O[HKR]|P[AR]|RI|S[CD]|T[NX]|UT|V[AIT]|W[AIVY])$/;

/**
 * The state a hospital licenses itself in, taken from the CMS template's
 * `license_number|<ST>` column header (CSV) or `license_information.state`
 * (JSON). This is the hospital's own declaration of where it operates, which is
 * what makes it usable to confirm or reject a cross-state name match.
 */
function licenseStateFromHeaders(headers) {
  for (const h of headers) {
    const k = String(h || '').trim();
    if (!/^license_number/i.test(k)) continue;
    const st = (k.split('|')[1] || '').trim().toUpperCase();
    if (US_STATE.test(st)) return st;
  }
  return null;
}

/**
 * Pull the date, template version, and the identifying fields (address,
 * location name, licensing state) out of the file header.
 *
 * The identifying fields cost nothing extra - the header is already in hand -
 * and they are what lets an ambiguous name match be settled on evidence instead
 * of string similarity. "St Mary's Hospital" appears in many states; the file
 * itself says which one it is.
 */
function extractDeclared(buf, kind) {
  const text = buf.toString('utf8').replace(/^﻿/, '');
  const empty = { raw: null, version: null, address: null, locationName: null, licenseState: null, hospitalName: null };

  if (kind === 'json') {
    const d = text.match(jsonStr('last_updated_on'));
    const v = text.match(jsonStr('version'));
    const out = {
      ...empty,
      raw: d ? d[1].replace(/\\"/g, '"') : null,
      version: v ? normalizeVersion(v[1]) : null
    };
    const n = text.match(jsonStr('hospital_name'));
    if (n) out.hospitalName = n[1].replace(/\\"/g, '"');
    // Both fields may be a bare string or an array; the head is often truncated
    // mid-array, so a tolerant parse beats JSON.parse here.
    const addrArr = text.match(/"hospital_address"\s*:\s*\[([^\]]*)/i);
    if (addrArr) {
      const first = addrArr[1].match(/"([^"\\]*(?:\\.[^"\\]*)*)"/);
      if (first) out.address = first[1].replace(/\\"/g, '"');
    } else {
      const a = text.match(jsonStr('hospital_address'));
      if (a) out.address = a[1].replace(/\\"/g, '"');
    }
    const locArr = text.match(/"(?:location_name|hospital_location)"\s*:\s*\[([^\]]*)/i);
    if (locArr) {
      const first = locArr[1].match(/"([^"\\]*(?:\\.[^"\\]*)*)"/);
      if (first) out.locationName = first[1].replace(/\\"/g, '"');
    } else {
      const l = text.match(jsonStr('location_name')) || text.match(jsonStr('hospital_location'));
      if (l) out.locationName = l[1].replace(/\\"/g, '"');
    }
    const ls = text.match(/"license_information"\s*:\s*\{[^}]*"state"\s*:\s*"([A-Za-z]{2})"/i)
      || text.match(jsonStr('state'));
    if (ls && US_STATE.test(String(ls[1]).toUpperCase())) out.licenseState = String(ls[1]).toUpperCase();
    return out;
  }

  if (kind === 'csv') {
    // Row 1 is the header, row 2 the values; the attestation column contains
    // commas inside quotes, so this must go through a real CSV parse.
    const rows = parseCSV(text);
    if (rows.length >= 2) {
      const rawHdr = rows[0].map(h => String(h || '').trim());
      const hdr = rawHdr.map(h => h.toLowerCase());
      const at = name => { const i = hdr.indexOf(name); return i >= 0 ? (rows[1][i] || null) : null; };
      const di = findUpdatedIndex(hdr);
      const vi = hdr.indexOf('version');
      let raw = di >= 0 ? (rows[1][di] || null) : null;
      // Fallback: some files shift columns or omit the header entirely, so
      // scan the value row for the first ISO-looking date.
      if (!raw) {
        const m = (rows[1] || []).join(',').match(ISO_IN_TEXT);
        if (m) raw = m[0];
      }
      return {
        raw,
        version: vi >= 0 ? normalizeVersion(rows[1][vi]) : null,
        address: at('hospital_address') || at('address'),
        // v3.0.0 renamed hospital_location to location_name; accept either.
        locationName: at('location_name') || at('hospital_location'),
        licenseState: licenseStateFromHeaders(rawHdr),
        hospitalName: at('hospital_name')
      };
    }
    return { ...empty };
  }

  // Compressed payloads carry the date inside the archive; a ranged read cannot
  // reach it, so report the container rather than guessing.
  return { ...empty };
}

/**
 * Inflate the front of a compressed MRF so its declared date can be read.
 *
 * Worth the extra bytes: a compressed file is otherwise undatable, and the only
 * alternative signal (HTTP Last-Modified) is a deployment timestamp, not a
 * content date. Truncated input is expected here - we only need the first rows,
 * so a mid-stream error still leaves usable output.
 */
function decompressHead(buf, kind) {
  return new Promise(resolve => {
    let stream, source = buf;
    if (kind === 'gzip') {
      stream = zlib.createGunzip();
    } else if (kind === 'zip') {
      // Local file header: 30 fixed bytes, then name and extra field.
      if (buf.length < 30 || buf[0] !== 0x50 || buf[1] !== 0x4b) return resolve(null);
      const method = buf.readUInt16LE(8);
      const nameLen = buf.readUInt16LE(26);
      const extraLen = buf.readUInt16LE(28);
      const start = 30 + nameLen + extraLen;
      if (start >= buf.length) return resolve(null);
      source = buf.slice(start);
      if (method === 0) return resolve(source.slice(0, HEAD_BYTES));   // stored
      if (method !== 8) return resolve(null);                          // not deflate
      stream = zlib.createInflateRaw();
    } else {
      return resolve(null);
    }

    const out = [];
    let total = 0, done = false;
    const finish = () => { if (!done) { done = true; resolve(out.length ? Buffer.concat(out).slice(0, HEAD_BYTES) : null); } };
    stream.on('data', c => {
      out.push(c); total += c.length;
      if (total >= HEAD_BYTES) { try { stream.destroy(); } catch (_e) {} finish(); }
    });
    stream.on('error', finish);   // truncated input is normal
    stream.on('end', finish);
    stream.on('close', finish);
    stream.end(source);
  });
}

async function rangedRead(url, cap, timeoutMs) {
  try {
    const response = await requestCapped(url, {
      timeoutMs, cap, headers: { ...BROWSER_HEADERS, Range: `bytes=0-${cap - 1}` }
    });
    if (response.status < 200 || response.status >= 300) return null;
    return response.body;
  } catch (_e) { return null; }
}

function requestCapped(url, options = {}, redirects = 6) {
  return new Promise((resolve, reject) => {
    let parsed;
    try { parsed = new URL(url); } catch (error) { reject(error); return; }
    const client = parsed.protocol === 'http:' ? http : https;
    const method = options.method || 'GET';
    const cap = Number(options.cap || 0);
    let settled = false;
    let deadline = null;
    const finish = value => {
      if (!settled) { settled = true; if (deadline) clearTimeout(deadline); resolve(value); }
    };
    const fail = error => {
      if (!settled) { settled = true; if (deadline) clearTimeout(deadline); reject(error); }
    };
    const request = client.request(parsed, {
      method,
      headers: options.headers || {},
      timeout: Number(options.timeoutMs || 45000)
    }, response => {
      response.on('error', fail);
      const status = Number(response.statusCode || 0);
      const location = response.headers.location;
      if (location && status >= 300 && status < 400 && redirects > 0) {
        if (deadline) clearTimeout(deadline);
        response.resume();
        requestCapped(new URL(location, parsed).toString(), options, redirects - 1).then(finish, fail);
        return;
      }
      if (method === 'HEAD') {
        response.resume();
        finish({ status, headers: response.headers, body: Buffer.alloc(0), finalUrl: parsed.toString() });
        return;
      }
      const chunks = [];
      let total = 0;
      response.on('data', chunk => {
        if (settled) return;
        const buffer = Buffer.from(chunk);
        const keep = cap ? buffer.slice(0, Math.max(0, cap - total)) : buffer;
        if (keep.length) chunks.push(keep);
        total += keep.length;
        if (cap && total >= cap) {
          finish({ status, headers: response.headers, body: Buffer.concat(chunks), finalUrl: parsed.toString() });
          response.destroy();
          request.destroy();
        }
      });
      response.on('end', () => finish({
        status, headers: response.headers, body: Buffer.concat(chunks), finalUrl: parsed.toString()
      }));
    });
    request.on('timeout', () => request.destroy(new Error('request timeout')));
    request.on('error', fail);
    deadline = setTimeout(() => request.destroy(new Error('request deadline exceeded')),
      Number(options.timeoutMs || 45000));
    request.end();
  });
}

async function readCapped(res, cap = HEAD_BYTES) {
  const chunks = [];
  let got = 0;
  const reader = res.body.getReader();
  while (got < cap) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(Buffer.from(value));
    got += value.byteLength;
  }
  try { await reader.cancel(); } catch (_e) {}
  return Buffer.concat(chunks).slice(0, cap);
}

/**
 * Probe one MRF URL for its date, size and format without downloading it.
 *
 * The date of record is the file's own `last_updated_on`. HTTP Last-Modified is
 * still captured, but only as a diagnostic - it is a deployment timestamp and is
 * never substituted for the declared date.
 */
async function probeMrf(url, { timeoutMs = 45000, useUnblocker = true } = {}) {
  const out = { url, checkedAt: new Date().toISOString(), requestCount: 0, bytesRead: 0 };

  // HEAD is cheap and gives size + Last-Modified even when Range is refused.
  try {
    out.requestCount++;
    const r = await requestCapped(url, { method: 'HEAD', timeoutMs, headers: BROWSER_HEADERS });
    out.httpStatus = r.status;
    out.httpLastModified = toISODate(r.headers['last-modified']);
    out.httpLastModifiedRaw = r.headers['last-modified'] || null;
    out.bytes = Number(r.headers['content-length'] || 0) || null;
    out.contentType = r.headers['content-type'] || null;
  } catch (e) {
    out.headError = String((e && e.message) || e).slice(0, 120);
  }

  // Ranged GET for the metadata header. Servers that ignore Range return 200
  // and the full body, so the socket reader enforces the byte cap either way.
  try {
    out.requestCount++;
    const r = await requestCapped(url, { timeoutMs, cap: HEAD_BYTES,
      headers: { ...BROWSER_HEADERS, Range: `bytes=0-${HEAD_BYTES - 1}` } });
    out.rangeStatus = r.status;
    if (out.httpStatus === undefined) out.httpStatus = r.status;
    if (r.status === 403 || r.status === 429) {
      out.blocked = true;
    } else if (r.status >= 200 && r.status < 300) {
      const buf = r.body;
      out.bytesRead += buf.length;
      out.fileKind = sniffKind(buf, out.contentType);
      if (!out.contentType) out.contentType = r.headers['content-type'] || null;
      let payload = buf, payloadKind = out.fileKind;
      if (out.fileKind === 'zip' || out.fileKind === 'gzip') {
        // 16 KB of compressed data rarely inflates to a full header row, so
        // pull a larger window before decompressing.
        out.requestCount++;
        const wide = await rangedRead(url, COMPRESSED_BYTES, timeoutMs);
        out.bytesRead += wide ? wide.length : 0;
        const inflated = await decompressHead(wide || buf, out.fileKind);
        if (inflated) {
          payload = inflated;
          payloadKind = sniffKind(inflated, null);
          out.innerKind = payloadKind;
        } else {
          out.decompressFailed = true;
        }
      }
      const meta = extractDeclared(payload, payloadKind);
      out.declaredRaw = meta.raw;
      out.declaredLastUpdated = toISODate(meta.raw);
      out.cmsVersion = meta.version;
      // Identifying fields, used to corroborate ambiguous name matches.
      out.mrfAddress = meta.address || null;
      out.mrfLocationName = meta.locationName || null;
      out.mrfLicenseState = meta.licenseState || null;
      out.mrfHospitalName = meta.hospitalName || null;
    }
  } catch (e) {
    out.rangeError = String((e && e.message) || e).slice(0, 120);
  }

  // Only spend on the unblocker when the host actually refused us.
  if (useUnblocker && out.blocked && activeProvider()) {
    const alt = await unblockerGet(url, { timeoutMs });
    if (alt.body) {
      const buf = Buffer.from(alt.body.slice(0, HEAD_BYTES));
      out.fileKind = sniffKind(buf, out.contentType);
      const meta = extractDeclared(buf, out.fileKind);
      out.declaredRaw = meta.raw;
      out.declaredLastUpdated = toISODate(meta.raw);
      out.cmsVersion = meta.version;
      out.mrfAddress = meta.address || null;
      out.mrfLocationName = meta.locationName || null;
      out.mrfLicenseState = meta.licenseState || null;
      out.mrfHospitalName = meta.hospitalName || null;
      out.via = alt.via;
      out.blocked = false;
    }
  }

  // Only the file's own `last_updated_on` counts. HTTP Last-Modified tracks when
  // the bytes were deployed, not when the prices changed: measured across 726
  // files it ran a median 23 days late, and in 111 cases it PREDATED the
  // declared date, which is impossible for a real content timestamp. It is kept
  // as a separate diagnostic column and never used as the date of record.
  if (out.declaredLastUpdated) {
    out.dateSource = 'file-metadata';
    const days = Math.floor((Date.now() - new Date(out.declaredLastUpdated + 'T00:00:00Z').getTime()) / 86400000);
    out.daysSinceUpdate = days;
    // 45 CFR 180.50 requires an update at least once a year.
    out.staleOver365 = days > 365;
  } else {
    out.dateSource = null;
  }
  out.ok = !!out.declaredLastUpdated;
  return out;
}

module.exports = { probeMrf, toISODate, sniffKind, extractDeclared, normalizeVersion,
  decompressHead, licenseStateFromHeaders, requestCapped };
