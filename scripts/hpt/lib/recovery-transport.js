'use strict';
const { spawn } = require('child_process');
const zlib = require('zlib');
const crypto = require('crypto');
const { requestCapped, sniffKind, extractDeclared, toISODate } = require('./probe');
const { BROWSER_HEADERS } = require('./fetch');
const MAX_BYTES = 32 * 1024 * 1024;
const PARSER_VERSION = 'recovery-v1';
const sha = value => crypto.createHash('sha256').update(value).digest('hex');

function safeUrl(value) {
  const raw = String(value || '').trim();
  const u = new URL(raw);
  if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password) throw new Error('Unsupported URL');
  if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.|\[::1\]|\[f[cd]|\[fe80)/i.test(u.hostname)) throw new Error('Non-public URL');
  // URL serializes spaces/non-ASCII in paths. Preserve the query byte-for-byte.
  const q = raw.indexOf('?'), fragment = raw.indexOf('#');
  if (q >= 0 && (fragment < 0 || q < fragment)) u.search = raw.slice(q, fragment < 0 ? undefined : fragment);
  return u.href;
}
function decode(buf) {
  if (buf[0] === 0xff && buf[1] === 0xfe) return buf.subarray(2).toString('utf16le');
  if (buf[0] === 0xfe && buf[1] === 0xff) {
    const copy = Buffer.from(buf.subarray(2, buf.length - (buf.length % 2))); copy.swap16(); return copy.toString('utf16le');
  }
  if (buf.length > 8 && buf[1] === 0 && buf[3] === 0) return buf.toString('utf16le');
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); }
  catch (_) { return new TextDecoder('windows-1252').decode(buf); }
}
function curlGet(url, cap, timeoutMs = 15000, hops = 6) {
  return new Promise(resolve => {
    const args = ['--silent', '--show-error', '--max-time', String(timeoutMs / 1000),
      '--connect-timeout', '8', '--proto', '=http,https', '--proto-redir', '=http,https', '--include',
      '--range', `0-${cap - 1}`, '--user-agent', BROWSER_HEADERS['User-Agent'], '--url', safeUrl(url)];
    const child = spawn('curl.exe', args, { windowsHide: true, shell: false });
    const chunks = []; let size = 0, error = '', done = false;
    const finish = () => {
      if (done) return; done = true; clearTimeout(timer);
      let raw = Buffer.concat(chunks), status = 0, finalUrl = url; const redirects = []; let headers = {};
      while (raw.subarray(0, 5).toString() === 'HTTP/') {
        const end = raw.indexOf('\r\n\r\n'); if (end < 0) break;
        const lines = raw.subarray(0, end).toString().split('\r\n'); status = Number(lines.shift().split(' ')[1]); headers = {};
        for (const line of lines) { const i = line.indexOf(':'); if (i > 0) headers[line.slice(0, i).toLowerCase()] = line.slice(i + 1).trim(); }
        raw = raw.subarray(end + 4);
        if (headers.location && status >= 300 && status < 400) { redirects.push({ url: finalUrl, status, location: headers.location }); finalUrl = new URL(headers.location, finalUrl).href; }
      }
      if (headers.location && status >= 300 && status < 400 && hops > 0) {
        try { const next = safeUrl(finalUrl); curlGet(next, cap, timeoutMs, hops - 1).then(r => resolve({ ...r, redirects: [...redirects, ...(r.redirects || [])] })); }
        catch(e) { resolve({ status: 0, finalUrl: url, redirects, headers: {}, body: Buffer.alloc(0), via: 'curl', error: e.message }); }
        return;
      }
      resolve({ status, finalUrl, redirects, headers, body: raw.subarray(0, cap), via: 'curl', error: status ? '' : error.slice(0, 160) || 'curl-no-response' });
    };
    const timer = setTimeout(() => { error = 'curl deadline exceeded'; child.kill(); finish(); }, timeoutMs + 1000);
    child.stdout.on('data', c => { const b = c.subarray(0, Math.max(0, cap + 65536 - size)); chunks.push(b); size += b.length; if (size >= cap + 65536) { child.kill(); finish(); } });
    child.stderr.on('data', c => { error += c.toString(); });
    child.on('error', e => { error = e.code || e.message; finish(); }); child.on('close', finish);
  });
}
async function retrieve(url, cap, { native = requestCapped, curl = curlGet, timeoutMs = 15000 } = {}) {
  url = safeUrl(url); const started = new Date().toISOString(); const attempts = [];
  let r;
  try { r = { ...await native(url, { cap, timeoutMs, validateUrl: safeUrl, headers: { ...BROWSER_HEADERS, Range: `bytes=0-${cap - 1}` } }), via: 'native' }; }
  catch (e) { if (/EACCES|EPERM/.test(e.code || e.message)) throw e; r = { status: 0, body: Buffer.alloc(0), error: e.code || e.message, via: 'native' }; }
  attempts.push({ method: 'GET', via: r.via, url, finalUrl: r.finalUrl || url, status: r.status, error: r.error || '', bytes: r.body.length, sha256: sha(r.body), redirects: r.redirects || [], checkedAt: started });
  if (!r.status) {
    r = await curl(url, cap, timeoutMs);
    attempts.push({ method: 'GET', via: r.via, url, finalUrl: r.finalUrl || url, status: r.status, error: r.error || '', bytes: r.body.length, sha256: sha(r.body), redirects: r.redirects || [], checkedAt: new Date().toISOString() });
  }
  return { ...r, attempts, checkedAt: new Date().toISOString(), sha256: sha(r.body) };
}
function inflateBounded(source, kind, limit) {
  return new Promise(resolve => {
    const stream = kind === 'gzip' ? zlib.createGunzip() : zlib.createInflateRaw();
    const chunks = []; let bytes = 0, done = false;
    const finish = () => { if (!done) { done = true; stream.destroy(); resolve(Buffer.concat(chunks)); } };
    stream.on('data', c => { const keep = c.subarray(0, Math.max(0, limit - bytes)); chunks.push(keep); bytes += keep.length; if (bytes >= limit) finish(); });
    stream.on('error', finish); stream.on('end', finish); stream.on('close', finish); stream.end(source);
  });
}
function zipEntries(buf) {
  const result = [];
  // Prefer the central directory when present (handles local data descriptors).
  for (let i = Math.max(0, buf.length - 65557); i + 22 <= buf.length; i++) {
    if (buf.readUInt32LE(i) !== 0x06054b50) continue;
    let p = buf.readUInt32LE(i + 16), count = buf.readUInt16LE(i + 10);
    if (count > 10000) break;
    for (let n = 0; n < count && p + 46 <= buf.length && buf.readUInt32LE(p) === 0x02014b50; n++) {
      const nameLen = buf.readUInt16LE(p + 28), extra = buf.readUInt16LE(p + 30), comment = buf.readUInt16LE(p + 32);
      const local = buf.readUInt32LE(p + 42);
      if (local + 30 <= buf.length) result.push({ name: decode(buf.subarray(p + 46, p + 46 + nameLen)), method: buf.readUInt16LE(p + 10), flags: buf.readUInt16LE(p + 8), size: buf.readUInt32LE(p + 20), start: local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28) });
      p += 46 + nameLen + extra + comment;
    }
    if (result.length) return result;
  }
  let p = 0;
  while (p + 30 <= buf.length && buf.readUInt32LE(p) === 0x04034b50) {
    const nameLen = buf.readUInt16LE(p + 26), extra = buf.readUInt16LE(p + 28), size = buf.readUInt32LE(p + 18), flags = buf.readUInt16LE(p + 6);
    const start = p + 30 + nameLen + extra;
    result.push({ name: decode(buf.subarray(p + 30, p + 30 + nameLen)), method: buf.readUInt16LE(p + 8), flags, size, start });
    if ((flags & 8) || !size) break; p = start + size;
  }
  return result;
}
async function parsePayload(buf, contentType = '', outputLimit = MAX_BYTES) {
  let kind = sniffKind(buf, contentType), members = [], inflatedBytes = 0;
  if (kind === 'gzip') {
    const body = await inflateBounded(buf, 'gzip', outputLimit); inflatedBytes += body.length; members.push({ name: 'gzip-content', body });
  } else if (kind === 'zip') {
    const entries = zipEntries(buf).filter(e => /\.(csv|json)$/i.test(e.name) && !(e.flags & 1));
    for (const e of entries.slice(0, 16)) {
      const remaining = outputLimit - inflatedBytes; if (remaining <= 0) break;
      const source = buf.subarray(e.start, e.size ? e.start + e.size : undefined);
      const body = e.method === 0 ? source.subarray(0, remaining) : e.method === 8 ? await inflateBounded(source, 'deflate', remaining) : Buffer.alloc(0);
      inflatedBytes += body.length; members.push({ name: e.name, body });
    }
  } else members.push({ name: '', body: buf });
  const parsed = members.map(m => {
    const text = decode(m.body).replace(/^\uFEFF/, ''), body = Buffer.from(text);
    let innerKind = sniffKind(body, contentType);
    if (innerKind === 'unknown' && /hospital_name\s*[",]/i.test(text.slice(0, 65536))) innerKind = 'csv';
    const d = extractDeclared(body, innerKind);
    return { member: m.name, fileKind: kind, innerKind, declaredLastUpdated: toISODate(d.raw), cmsVersion: d.version,
      mrfHospitalName: d.hospitalName, mrfLocationName: d.locationName, mrfAddress: d.address, mrfLicenseState: d.licenseState };
  });
  return { parsed, inflatedBytes, archive: ['zip', 'gzip'].includes(kind) };
}
function sufficient(p) { return p.declaredLastUpdated && p.cmsVersion && p.mrfHospitalName && p.mrfAddress && p.mrfLicenseState; }
async function progressiveProbe(url, request = retrieve) {
  let transferred = 0, decompressed = 0, parsed = [], attempts = [], last;
  for (const desired of [262144, 1048576, 4194304, 26 * 1048576]) {
    const cap = Math.min(desired, MAX_BYTES - transferred); if (cap <= 0) break;
    const r = await request(url, cap); last = r; attempts.push(...r.attempts); transferred += r.attempts.reduce((s, a) => s + a.bytes, 0);
    if (r.status < 200 || r.status >= 300) break;
    const p = await parsePayload(r.body, r.headers['content-type'], MAX_BYTES - decompressed); parsed = p.parsed; decompressed += p.inflatedBytes;
    if (parsed.some(sufficient) || r.body.length < cap || (!p.archive && cap >= 4194304) || decompressed >= MAX_BYTES) break;
  }
  return { url, checkedAt: last?.checkedAt, finalUrl: last?.finalUrl || url, rangeStatus: last?.status || 0,
    error: last?.error || '', transferred, decompressed, attempts, parserVersion: PARSER_VERSION,
    candidates: parsed.map(p => ({ ...p, rangeStatus: last.status, checkedAt: last.checkedAt })),
    blocker: parsed.some(sufficient) ? '' : transferred >= MAX_BYTES || decompressed >= MAX_BYTES ? 'byte-limit-reached' : 'metadata-incomplete-or-request-failed' };
}
module.exports = { safeUrl, decode, retrieve, curlGet, parsePayload, zipEntries, progressiveProbe, sha, MAX_BYTES, PARSER_VERSION };
