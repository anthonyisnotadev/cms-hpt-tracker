#!/usr/bin/env node
/**
 * Resolves every hospital in the roster to a latitude/longitude, once, so the
 * tracker can draw a map without asking a geocoder at page-open time.
 *
 *   node scripts/hpt/geocode.js [options]
 *
 *     --batch N        addresses per request (default 1000, Census caps at 10000)
 *     --limit N        stop after N addresses, for a trial run
 *     --benchmark NAME Census address-range vintage (default Public_AR_Current;
 *                      Public_AR_Census2020 matches rural rows Current misses)
 *     --retry          drop cached misses and ask about them again
 *     --zip            after the address pass, fall back to ZIP centroids
 *     --zip-only       skip the address pass and only do the ZIP fallback
 *
 * Source is the US Census Bureau's batch geocoder: public domain, no API key,
 * and built for exactly this shape of request (a file of US addresses in, a
 * file of coordinates out). Nominatim is the obvious alternative and the wrong
 * one — its usage policy rules out systematic bulk queries like this.
 *
 * Results are cached in cms_data/hpt/coords.json and written after every batch,
 * so an interrupted run resumes where it stopped. Misses are cached as null: an
 * address the Census cannot match will not match on the next run either, and
 * re-asking 700 times costs an hour for nothing.
 *
 * The full run, which is what produced the committed file:
 *
 *   node scripts/hpt/geocode.js
 *   node scripts/hpt/geocode.js --retry --benchmark Public_AR_Census2020
 *   node scripts/hpt/geocode.js --zip-only
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..', '..');
const ROSTER = path.join(ROOT, 'cms_data', 'hpt', 'roster.json');
const OUT = path.join(ROOT, 'cms_data', 'hpt', 'coords.json');

const ENDPOINT = 'https://geocoding.geo.census.gov/geocoder/locations/addressbatch';
// Centroids for every ZIP Code Tabulation Area, used only where the street
// address itself will not match. Public domain, same agency, about 950 KB.
const GAZETTEER = 'https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2025_Gazetteer/2025_Gaz_zcta_national.zip';

/* ---------- args ---------- */

const argv = process.argv.slice(2);
const numFlag = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? Number(argv[i + 1]) : fallback;
};
const strFlag = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};

const LIMIT = numFlag('--limit', Infinity);
// Smaller batches finish sooner and lose less work when one times out, which on
// this endpoint is not rare.
const BATCH = numFlag('--batch', 1000);
const BENCHMARK = strFlag('--benchmark', 'Public_AR_Current');
const RETRY_MISSES = argv.includes('--retry');
const ZIP_ONLY = argv.includes('--zip-only');
const ZIP_FALLBACK = ZIP_ONLY || argv.includes('--zip');

/* ---------- csv ---------- */

// The response is quoted CSV with commas inside fields ("lon,lat" is one
// field), so it needs a real parser rather than a split.
function parseCsvLine(line) {
  const out = [];
  let field = '', quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { out.push(field); field = ''; }
    else field += ch;
  }
  out.push(field);
  return out;
}

// The request is CSV too, and an address containing a comma would otherwise
// shift every column after it.
const csvCell = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';

/* ---------- addresses ---------- */

// CMS address lines carry things the Census parser cannot use. A mailing box
// appended to a street address ("83825 HIGHWAY 9    P O BOX 1270") makes the
// whole line unmatchable even though the street part on its own matches fine.
function cleanAddress(raw) {
  let a = String(raw || '').replace(/\s+/g, ' ').trim();
  // Drop a trailing PO box, however it was punctuated, and anything after it.
  // The word boundary and the digit keep real streets ("100 BOX ELDER RD") whole.
  a = a.replace(/[,(]?\s*\bP\.?\s?O\.?\s?BOX\b.*$/i, '');
  a = a.replace(/[,(]?\s*\bBOX\s+\d+.*$/i, '');
  return a.replace(/[\s,(]+$/, '').trim();
}

// Five decimals is about a metre. The rest is interpolation noise, and 5,400
// rows of it is payload the tracker has to ship.
const round5 = n => Number(n.toFixed(5));

/* ---------- cache ---------- */

// [lon, lat] is a located address; [lon, lat, 1] is its ZIP centroid, which is
// the right town but not the right building; null is a hospital the Census
// could not place at all.
function loadCache() {
  if (!fs.existsSync(OUT)) return {};
  try { return JSON.parse(fs.readFileSync(OUT, 'utf8')); }
  catch (e) { throw new Error('cms_data/hpt/coords.json is not readable JSON: ' + e.message); }
}

function saveCache(cache) {
  // CCN order keeps the diff between runs to the lines that actually changed.
  const sorted = {};
  for (const k of Object.keys(cache).sort()) sorted[k] = cache[k];
  fs.writeFileSync(OUT, JSON.stringify(sorted) + '\n');
}

/* ---------- address pass ---------- */

async function geocodeBatch(chunk) {
  const csv = chunk
    .map(h => [h.ccn, cleanAddress(h.address) || h.address, h.city, h.state, h.zip].map(csvCell).join(','))
    .join('\n');

  const form = new FormData();
  form.append('benchmark', BENCHMARK);
  form.append('addressFile', new Blob([csv], { type: 'text/csv' }), 'addresses.csv');

  const res = await fetch(ENDPOINT, { method: 'POST', body: form, signal: AbortSignal.timeout(180000) });
  if (!res.ok) throw new Error('census returned HTTP ' + res.status);

  const found = {};
  for (const line of (await res.text()).split('\n')) {
    if (!line.trim()) continue;
    const f = parseCsvLine(line.trim());
    const ccn = f[0];
    if (!ccn) continue;
    // Columns: id, input, match, matchtype, matched address, "lon,lat", ...
    // "Tie" means the address matched more than one line and the Census will
    // not choose; treat it as a miss rather than guessing.
    if (f[2] !== 'Match' || !f[5]) { found[ccn] = null; continue; }
    const parts = f[5].split(',').map(Number);
    const lon = parts[0], lat = parts[1];
    found[ccn] = (Number.isFinite(lat) && Number.isFinite(lon)) ? [round5(lon), round5(lat)] : null;
  }
  return found;
}

async function addressPass(roster, cache) {
  // An address is all the Census can work with; a hospital without one cannot
  // be asked about, so record the miss instead of sending an empty row.
  const pending = [];
  for (const h of roster) {
    if (Object.prototype.hasOwnProperty.call(cache, h.ccn)) continue;
    if (!h.address || !h.state) { cache[h.ccn] = null; continue; }
    pending.push(h);
  }

  const todo = pending.slice(0, LIMIT === Infinity ? pending.length : LIMIT);
  console.log(roster.length + ' hospitals, ' + (roster.length - pending.length)
    + ' already resolved, ' + todo.length + ' to ask about (benchmark ' + BENCHMARK + ')');

  for (let i = 0; i < todo.length; i += BATCH) {
    const chunk = todo.slice(i, i + BATCH);
    const label = (i + 1) + '-' + (i + chunk.length) + ' of ' + todo.length;
    let found;
    try {
      found = await geocodeBatch(chunk);
    } catch (e) {
      // One failed batch should not cost the batches that already succeeded.
      console.warn('  ' + label + ': ' + e.message + ' - skipped, rerun to retry');
      continue;
    }
    // A batch can come back short. Only cache what was actually answered, so
    // the missing rows are asked about again on the next run.
    let hit = 0;
    for (const ccn of Object.keys(found)) {
      cache[ccn] = found[ccn];
      if (found[ccn]) hit++;
    }
    saveCache(cache);
    console.log('  ' + label + ': ' + hit + '/' + Object.keys(found).length + ' matched');
  }
}

/* ---------- zip fallback ---------- */

// The gazetteer ships as a one-member zip. Rather than take a dependency to
// open it, read the central directory and inflate that member: a zip entry
// stored with method 8 is a raw deflate stream, which zlib already speaks.
function unzipSingle(buf) {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error('gazetteer download is not a zip file');
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (buf.readUInt32LE(cdOffset) !== 0x02014b50) throw new Error('gazetteer zip has no central directory');

  const method = buf.readUInt16LE(cdOffset + 10);
  const compSize = buf.readUInt32LE(cdOffset + 20);
  const localOffset = buf.readUInt32LE(cdOffset + 42);

  // Name and extra lengths differ between the central and the local header, so
  // the offset of the data itself has to come from the local one.
  const nameLen = buf.readUInt16LE(localOffset + 26);
  const extraLen = buf.readUInt16LE(localOffset + 28);
  const start = localOffset + 30 + nameLen + extraLen;
  const data = buf.subarray(start, start + compSize);
  if (method === 0) return data;
  if (method === 8) return zlib.inflateRawSync(data);
  throw new Error('gazetteer zip uses compression method ' + method);
}

async function zipCentroids() {
  console.log('fetching ZIP centroids from the Census gazetteer');
  const res = await fetch(GAZETTEER, { signal: AbortSignal.timeout(180000) });
  if (!res.ok) throw new Error('gazetteer returned HTTP ' + res.status);
  const text = unzipSingle(Buffer.from(await res.arrayBuffer())).toString('utf8');

  // Pipe-delimited: GEOID|GEOIDFQ|ALAND|AWATER|ALAND_SQMI|AWATER_SQMI|INTPTLAT|INTPTLONG
  const lines = text.split('\n');
  const head = lines[0].split('|').map(s => s.trim());
  const iZip = head.indexOf('GEOID');
  const iLat = head.indexOf('INTPTLAT');
  const iLon = head.indexOf('INTPTLONG');
  if (iZip < 0 || iLat < 0 || iLon < 0) throw new Error('gazetteer columns are not what this script expects');

  const byZip = new Map();
  for (let i = 1; i < lines.length; i++) {
    const f = lines[i].split('|');
    if (f.length <= iLon) continue;
    const lat = Number(f[iLat]), lon = Number(f[iLon]);
    if (Number.isFinite(lat) && Number.isFinite(lon)) byZip.set(f[iZip].trim(), [round5(lon), round5(lat)]);
  }
  console.log('  ' + byZip.size + ' ZIP centroids');
  return byZip;
}

async function zipPass(roster, cache) {
  const unplaced = roster.filter(h => !cache[h.ccn]);
  if (!unplaced.length) { console.log('every hospital already matched on its address'); return; }

  const byZip = await zipCentroids();
  let filled = 0, noZip = 0;
  for (const h of unplaced) {
    // CMS zips are five digits, sometimes with a +4 or a lost leading zero.
    const zip = String(h.zip || '').replace(/\D/g, '').slice(0, 5).padStart(5, '0');
    const c = byZip.get(zip);
    if (!c) { noZip++; continue; }
    cache[h.ccn] = [c[0], c[1], 1];
    filled++;
  }
  saveCache(cache);
  console.log('  ' + filled + ' placed at their ZIP centroid, ' + noZip + ' had no usable ZIP');
}

/* ---------- run ---------- */

function report(roster, cache) {
  let exact = 0, approx = 0, missing = 0;
  for (const h of roster) {
    const c = cache[h.ccn];
    if (!c) missing++;
    else if (c[2]) approx++;
    else exact++;
  }
  const pct = n => (100 * n / roster.length).toFixed(1) + '%';
  console.log('coords.json: ' + (exact + approx) + '/' + roster.length + ' located - '
    + exact + ' by address (' + pct(exact) + '), '
    + approx + ' by ZIP centroid (' + pct(approx) + '), '
    + missing + ' unplaced');
}

async function main() {
  if (!fs.existsSync(ROSTER)) throw new Error('missing ' + ROSTER);
  const roster = JSON.parse(fs.readFileSync(ROSTER, 'utf8'));
  const cache = loadCache();

  if (RETRY_MISSES) {
    let cleared = 0;
    for (const k of Object.keys(cache)) if (cache[k] === null) { delete cache[k]; cleared++; }
    if (cleared) console.log('cleared ' + cleared + ' cached misses');
  }

  if (!ZIP_ONLY) await addressPass(roster, cache);
  if (ZIP_FALLBACK) await zipPass(roster, cache);

  saveCache(cache);
  report(roster, cache);
}

main().catch(e => { console.error(e.message); process.exit(1); });
