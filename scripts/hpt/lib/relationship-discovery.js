'use strict';

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const readline = require('readline');
const { pipeline } = require('stream/promises');
const { Readable } = require('stream');

const {
  csvToObjects, hostOf, isAggregator, normalizeName, nameSimilarity,
  strictSimilarity, pooled, JsonStore
} = require('./util');
const { heuristicCandidates, GENERIC } = require('./candidates');
const { parsePointer } = require('./parse');
const {
  loadKey, deobfuscatePointerText, DEFAULT_KEY_FILE
} = require('./pointer-obfuscation');
const {
  candidateRow, normalizeDomain, normalizePhone, normalizeState,
  addressAgreement
} = require('./domain-discovery');

const APP_UA = 'cms-hpt-tracker/0.1 hospital domain discovery';
const CONSUMER_EMAIL_HOSTS = new Set([
  'aol.com', 'gmail.com', 'googlemail.com', 'hotmail.com', 'icloud.com',
  'live.com', 'outlook.com', 'proton.me', 'protonmail.com', 'yahoo.com'
]);
const CMS_CATALOGS = {
  enrollments: { slug: 'hospital-enrollments', prefix: 'Hospital_Enrollments_' },
  owners: { slug: 'hospital-all-owners', prefix: 'Hospital_All_Owners_' },
  chow: { slug: 'hospital-change-of-ownership', prefix: 'Hospital_CHOW_' }
};

function first(row, names) {
  for (const name of names) {
    if (row[name] !== undefined && row[name] !== null && String(row[name]).trim()) return String(row[name]).trim();
  }
  return '';
}

function unique(values) {
  return [...new Set(values.flatMap(value => Array.isArray(value) ? value : [value])
    .map(value => String(value || '').trim()).filter(Boolean))];
}

function zip5(value) {
  const match = String(value || '').match(/\d{5}/);
  return match ? match[0] : '';
}

function addressText(address) {
  return [address.address_1, address.address_2, address.city, address.state, address.postal_code]
    .filter(Boolean).join(', ');
}

function sanitizeAddress(address = {}) {
  return {
    address_1: String(address.address_1 || '').trim(),
    address_2: String(address.address_2 || '').trim(),
    city: String(address.city || '').trim(),
    state: normalizeState(address.state),
    postal_code: String(address.postal_code || '').trim(),
    telephone_number: String(address.telephone_number || '').trim(),
    address_purpose: String(address.address_purpose || '').trim()
  };
}

/** Keep organization evidence while dropping authorized-official contact data. */
function sanitizeNppesResult(result = {}) {
  const basic = result.basic || {};
  return {
    npi: String(result.number || '').trim(),
    organization_name: String(basic.organization_name || '').trim(),
    parent_name: String(basic.parent_organization_legal_business_name || '').trim(),
    status: String(basic.status || '').trim(),
    other_names: unique((result.other_names || []).map(row => row.organization_name)),
    addresses: (result.addresses || []).map(sanitizeAddress),
    practice_locations: (result.practiceLocations || []).map(sanitizeAddress),
    endpoints: (result.endpoints || []).map(endpoint => ({
      endpoint: String(endpoint.endpoint || '').trim(),
      endpoint_type: String(endpoint.endpointType || endpoint.endpoint_type || '').trim(),
      description: String(endpoint.endpointDescription || endpoint.endpoint_description || '').trim()
    })).filter(endpoint => endpoint.endpoint)
  };
}

function nppesNames(result) {
  return unique([result.organization_name, result.parent_name, result.other_names]);
}

function nppesIdentity(job, result) {
  const addresses = [...(result.addresses || []), ...(result.practice_locations || [])];
  const names = nppesNames(result);
  const nameScore = Math.max(0, ...names.map(name => nameSimilarity(job.hospital_name, name)));
  const strictScore = Math.max(0, ...names.map(name => strictSimilarity(job.hospital_name, name)));
  const stateMatch = addresses.some(address => address.state === job.state);
  const phoneMatch = addresses.some(address => normalizePhone(address.telephone_number)
    && normalizePhone(address.telephone_number) === normalizePhone(job.phone));
  const addressMatch = addresses.some(address => addressAgreement(job.address, addressText(address)));
  const zipMatch = addresses.some(address => zip5(address.postal_code) && zip5(address.postal_code) === zip5(job.zip));
  const cityMatch = addresses.some(address => address.city
    && normalizeName(address.city) === normalizeName(job.city));
  const accepted = stateMatch && (phoneMatch || addressMatch
    || (nameScore >= 0.72 && (zipMatch || cityMatch))
    || (nameScore >= 0.88 && strictScore >= 0.60));
  return { accepted, nameScore, strictScore, phoneMatch, addressMatch, zipMatch, cityMatch, addresses };
}

async function fetchJson(url, { timeoutMs = 30000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json', 'User-Agent': APP_UA } });
    if (!response.ok) return { error: `http-${response.status}`, rows: [] };
    return { json: await response.json() };
  } catch (error) {
    return { error: String((error && error.message) || error), rows: [] };
  } finally {
    clearTimeout(timer);
  }
}

async function runNppesDiscovery({ jobs, cacheFile, concurrency = 4, timeoutMs = 30000, refresh = false }) {
  const store = new JsonStore(cacheFile);
  await store.load();
  let cacheHits = 0;
  let requests = 0;
  let completed = 0;
  const results = await pooled(jobs, {
    concurrency,
    onProgress: done => { if (done === jobs.length || done % 50 === 0) console.log(`NPPES ${done}/${jobs.length}`); }
  }, async job => {
    if (!refresh && store.has(job.ccn)) { cacheHits++; return store.get(job.ccn); }
    const query = new URL('https://npiregistry.cms.hhs.gov/api/');
    query.searchParams.set('version', '2.1');
    query.searchParams.set('limit', '50');
    query.searchParams.set('enumeration_type', 'NPI-2');
    query.searchParams.set('organization_name', job.hospital_name);
    query.searchParams.set('state', job.state);
    const fetched = await fetchJson(query.toString(), { timeoutMs });
    requests++;
    const row = fetched.error
      ? { ccn: job.ccn, query: query.toString(), rows: [], error: fetched.error, checked_at: new Date().toISOString() }
      : { ccn: job.ccn, query: query.toString(), rows: (fetched.json.results || []).map(sanitizeNppesResult), error: '', checked_at: new Date().toISOString() };
    store.set(job.ccn, row);
    if (++completed % 25 === 0) await store.save();
    return row;
  });
  await store.save(true);
  return { results, cacheHits, requests };
}

function resolvedFacilities(domains, roster) {
  const rosterByCcn = new Map(roster.map(row => [row.ccn, row]));
  const out = [];
  for (const [domain, meta] of Object.entries(domains || {})) for (const ccn of (meta.ccns || [])) {
    const hospital = rosterByCcn.get(ccn);
    if (hospital) out.push({ domain, ...hospital });
  }
  return out;
}

function distinctiveTokens(value) {
  const extraGeneric = new Set(['saint', 'care', 'services', 'foundation', 'corporation', 'incorporated']);
  return normalizeName(value).split(' ').filter(token => token.length > 2
    && !GENERIC.has(token) && !extraGeneric.has(token));
}

function siblingDomainCandidates(jobs, domains, roster) {
  const resolved = resolvedFacilities(domains, roster);
  const tokenFrequency = new Map();
  for (const row of roster) for (const token of new Set(distinctiveTokens(row.name))) {
    tokenFrequency.set(token, (tokenFrequency.get(token) || 0) + 1);
  }
  const resolvedByToken = new Map();
  for (const row of resolved) for (const token of new Set(distinctiveTokens(row.name))) {
    if (!resolvedByToken.has(token)) resolvedByToken.set(token, []);
    resolvedByToken.get(token).push(row);
  }
  const out = [];
  for (const job of jobs) {
    const jobTokens = distinctiveTokens(job.hospital_name);
    const pool = new Map();
    for (const token of jobTokens) {
      if ((tokenFrequency.get(token) || Infinity) > 18) continue;
      for (const row of resolvedByToken.get(token) || []) pool.set(`${row.ccn}|${row.domain}`, row);
    }
    for (const row of pool.values()) {
      if (row.ccn === job.ccn || row.state !== job.state) continue;
      const score = nameSimilarity(job.hospital_name, row.name);
      const strict = strictSimilarity(job.hospital_name, row.name);
      const common = jobTokens.filter(token => distinctiveTokens(row.name).includes(token)).length;
      if (score < 0.55 && common < 2) continue;
      out.push(candidateRow(job, row.domain, 'siblings', {
        source_record_url: `cms-roster:${row.ccn}`,
        source_name: row.name,
        source_address: row.address,
        source_phone: row.phone,
        name_score: Number(score.toFixed(3)),
        strict_name_score: Number(strict.toFixed(3)),
        candidate_score: 40 + score * 30 + Math.min(common, 3) * 4
      }));
    }
  }
  return out;
}

function domainsByResolvedName(domains, roster) {
  const exact = new Map();
  for (const row of resolvedFacilities(domains, roster)) {
    const key = `${normalizeName(row.name)}|${row.state}`;
    if (!exact.has(key)) exact.set(key, []);
    exact.get(key).push(row);
  }
  return exact;
}

function nppesCandidateRows(jobs, nppesResults, domains, roster, options = {}) {
  const jobByCcn = new Map(jobs.map(job => [job.ccn, job]));
  const knownNames = domainsByResolvedName(domains, roster);
  const out = [];
  const aliases = new Map();
  for (const cached of nppesResults) {
    const job = jobByCcn.get(cached.ccn);
    if (!job) continue;
    const accepted = (cached.rows || []).map(result => ({ result, identity: nppesIdentity(job, result) }))
      .filter(item => item.identity.accepted)
      .sort((a, b) => b.identity.nameScore - a.identity.nameScore);
    const names = unique(accepted.flatMap(item => nppesNames(item.result)));
    aliases.set(job.ccn, names);
    for (const { result, identity } of accepted.slice(0, 5)) {
      const sourceName = nppesNames(result).join('|');
      const sourceAddress = identity.addresses.map(addressText).filter(Boolean).join('|');
      const sourcePhone = identity.addresses.map(address => address.telephone_number).filter(Boolean).join('|');
      for (const endpoint of result.endpoints || []) {
        if (!/^https?:\/\//i.test(endpoint.endpoint)) continue;
        const domain = normalizeDomain(endpoint.endpoint);
        if (!domain) continue;
        out.push(candidateRow(job, domain, 'nppes-endpoint', {
          source_record_url: `https://npiregistry.cms.hhs.gov/provider-view/${result.npi}`,
          source_name: sourceName, source_address: sourceAddress, source_phone: sourcePhone,
          name_score: Number(identity.nameScore.toFixed(3)),
          phone_match: identity.phoneMatch ? 'yes' : 'no', address_match: identity.addressMatch ? 'yes' : 'no',
          candidate_score: 72 + (identity.phoneMatch ? 10 : 0) + (identity.addressMatch ? 8 : 0)
        }));
      }
      for (const name of nppesNames(result)) {
        for (const row of knownNames.get(`${normalizeName(name)}|${job.state}`) || []) {
          if (row.ccn === job.ccn) continue;
          out.push(candidateRow(job, row.domain, 'nppes-sibling', {
            source_record_url: `https://npiregistry.cms.hhs.gov/provider-view/${result.npi}`,
            source_name: name, source_address: sourceAddress, source_phone: sourcePhone,
            name_score: 1, candidate_score: 78
          }));
        }
        if (options.includeHeuristics) for (const guess of heuristicCandidates({ name }, { maxPerHospital: 6 })) {
          out.push(candidateRow(job, guess.domain, 'nppes', {
            source_record_url: `https://npiregistry.cms.hhs.gov/provider-view/${result.npi}`,
            source_name: name, source_address: sourceAddress, source_phone: sourcePhone,
            name_score: Number(identity.nameScore.toFixed(3)), candidate_score: 8 + identity.nameScore * 12
          }));
        }
      }
    }
  }
  const limited = [];
  const byCcn = new Map();
  for (const row of out) {
    if (!byCcn.has(row.ccn)) byCcn.set(row.ccn, []);
    byCcn.get(row.ccn).push(row);
  }
  for (const rows of byCcn.values()) {
    rows.sort((a, b) => Number(b.candidate_score || 0) - Number(a.candidate_score || 0)
      || a.candidate_domain.localeCompare(b.candidate_domain));
    limited.push(...rows.slice(0, 3));
  }
  return { candidates: limited, aliases };
}

function emailDomains(value) {
  const matches = String(value || '').match(/[A-Z0-9._%+-]+@([A-Z0-9.-]+\.[A-Z]{2,})/gi) || [];
  return unique(matches.map(email => email.slice(email.lastIndexOf('@') + 1).toLowerCase()))
    .filter(domain => !CONSUMER_EMAIL_HOSTS.has(domain) && !isAggregator(domain));
}

function contactDomainCandidates(jobs, pointerDir, options = {}) {
  const keyFile = options.keyFile || DEFAULT_KEY_FILE;
  if (!fs.existsSync(keyFile) || !fs.existsSync(pointerDir)) return { candidates: [], files: 0, contactDomains: 0, error: 'key-or-pointer-archive-missing' };
  const key = loadKey({ keyFile });
  const candidates = [];
  let files = 0;
  let contactDomains = 0;
  for (const file of fs.readdirSync(pointerDir).filter(name => name.endsWith('.txt'))) {
    files++;
    const protectedText = fs.readFileSync(path.join(pointerDir, file), 'utf8');
    let parsed;
    try { parsed = parsePointer(deobfuscatePointerText(protectedText, key).text); }
    catch (_error) { continue; }
    for (const entry of parsed.entries || []) {
      const domains = emailDomains(entry.contactEmail);
      if (!domains.length || !entry.locationName) continue;
      contactDomains += domains.length;
      for (const job of jobs) {
        const score = nameSimilarity(job.hospital_name, entry.locationName);
        const strict = strictSimilarity(job.hospital_name, entry.locationName);
        if (score < 0.72 || strict < 0.50) continue;
        for (const domain of domains) candidates.push(candidateRow(job, domain, 'contacts', {
          source_record_url: `protected-pointer:${file}`,
          source_name: entry.locationName,
          name_score: Number(score.toFixed(3)), strict_name_score: Number(strict.toFixed(3)),
          candidate_score: 64 + score * 20
        }));
      }
    }
  }
  return { candidates, files, contactDomains, error: '' };
}

function parseCsvLine(line) {
  const values = [];
  let value = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (quoted) {
      if (char === '"' && line[i + 1] === '"') { value += '"'; i++; }
      else if (char === '"') quoted = false;
      else value += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') { values.push(value); value = ''; }
    else value += char;
  }
  values.push(value);
  return values;
}

async function downloadFile(url, file, { timeoutMs = 180000 } = {}) {
  if (fs.existsSync(file) && fs.statSync(file).size > 0) return { file, cacheHit: true };
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const temp = `${file}.tmp`;
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': APP_UA } });
    if (!response.ok || !response.body) throw new Error(`http-${response.status}`);
    await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(temp));
    await fsp.rename(temp, file);
    return { file, cacheHit: false };
  } finally {
    clearTimeout(timer);
    if (fs.existsSync(temp)) await fsp.rm(temp, { force: true });
  }
}

function aliasIndex(jobs, aliases) {
  const exact = new Map();
  const token = new Map();
  for (const job of jobs) for (const alias of unique([job.hospital_name, aliases.get(job.ccn) || []])) {
    const normalized = normalizeName(alias);
    if (!normalized) continue;
    if (!exact.has(normalized)) exact.set(normalized, new Set());
    exact.get(normalized).add(job.ccn);
    for (const word of distinctiveTokens(alias)) {
      if (word.length < 5) continue;
      if (!token.has(word)) token.set(word, new Set());
      token.get(word).add(job.ccn);
    }
  }
  return { exact, token };
}

async function scanIrsIndexes(jobs, aliases, cacheDir, options = {}) {
  const years = options.years || [new Date().getUTCFullYear(), new Date().getUTCFullYear() - 1];
  const indexes = [];
  for (const year of years) {
    const url = `https://apps.irs.gov/pub/epostcard/990/xml/${year}/index_${year}.csv`;
    const file = path.join(cacheDir, `index_${year}.csv`);
    try { indexes.push({ year, ...(await downloadFile(url, file, { timeoutMs: options.timeoutMs || 240000 })) }); }
    catch (error) { indexes.push({ year, file, error: String((error && error.message) || error) }); }
  }
  const index = aliasIndex(jobs, aliases);
  const best = new Map();
  const jobsByCcn = new Map(jobs.map(job => [job.ccn, job]));
  for (const source of indexes.filter(row => !row.error)) {
    const input = fs.createReadStream(source.file);
    const lines = readline.createInterface({ input, crlfDelay: Infinity });
    let header = null;
    for await (const line of lines) {
      const values = parseCsvLine(line);
      if (!header) { header = values; continue; }
      const row = Object.fromEntries(header.map((name, i) => [name, values[i] || '']));
      if (!/^990(?:EZ)?$/i.test(row.RETURN_TYPE || '')) continue;
      const taxpayer = String(row.TAXPAYER_NAME || '').trim();
      const normalized = normalizeName(taxpayer);
      const possible = new Set(index.exact.get(normalized) || []);
      if (!possible.size) for (const word of distinctiveTokens(taxpayer)) {
        if (word.length < 5) continue;
        const linked = index.token.get(word);
        if (!linked || linked.size > 25) continue;
        for (const ccn of linked) possible.add(ccn);
      }
      for (const ccn of possible) {
        const job = jobsByCcn.get(ccn);
        const names = unique([job.hospital_name, aliases.get(ccn) || []]);
        const score = Math.max(0, ...names.map(name => nameSimilarity(name, taxpayer)));
        const strict = Math.max(0, ...names.map(name => strictSimilarity(name, taxpayer)));
        if (score < 0.76 || strict < 0.45) continue;
        const key = `${ccn}|${row.EIN}`;
        const prior = best.get(key);
        const candidate = { ccn, year: source.year, ein: row.EIN, taxpayer_name: taxpayer,
          object_id: row.OBJECT_ID, batch_id: row.XML_BATCH_ID,
          name_score: score, strict_name_score: strict };
        if (!prior || candidate.year > prior.year || candidate.name_score > prior.name_score) best.set(key, candidate);
      }
    }
  }
  const selected = [...best.values()].sort((a, b) => b.name_score - a.name_score)
    .filter((row, indexPosition, all) => all.findIndex(other => other.ccn === row.ccn) === indexPosition)
    .slice(0, Number(options.maxFilings || 500));
  return { indexes, selected };
}

function decodeXml(value) {
  return String(value || '').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
}

function xmlValue(xml, names) {
  for (const name of names) {
    const match = String(xml || '').match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'i'));
    if (match) return decodeXml(match[1].replace(/<[^>]+>/g, ' '));
  }
  return '';
}

function parseIrsXml(xml) {
  return {
    website: xmlValue(xml, ['WebsiteAddressTxt', 'WebSite']),
    organization_name: xmlValue(xml, ['BusinessNameLine1Txt', 'BusinessNameLine1']),
    address: xmlValue(xml, ['AddressLine1Txt', 'AddressLine1']),
    city: xmlValue(xml, ['CityNm', 'City']),
    state: normalizeState(xmlValue(xml, ['StateAbbreviationCd', 'State'])),
    zip: zip5(xmlValue(xml, ['ZIPCd', 'ZIPCode']))
  };
}

function zipEntries(buffer) {
  const minimum = Math.max(0, buffer.length - 65557);
  let eocd = -1;
  for (let offset = buffer.length - 22; offset >= minimum; offset--) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) { eocd = offset; break; }
  }
  if (eocd < 0) throw new Error('zip-end-record-not-found');
  const count = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  const entries = [];
  for (let i = 0; i < count; i++) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error('zip-central-directory-invalid');
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.slice(offset + 46, offset + 46 + nameLength).toString('utf8');
    entries.push({ name, method, compressedSize, uncompressedSize, localOffset });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function extractSelectedZip(file, objectIds) {
  const zlib = require('zlib');
  const buffer = fs.readFileSync(file);
  const wanted = new Set([...objectIds].map(String));
  const out = new Map();
  for (const entry of zipEntries(buffer)) {
    const match = entry.name.match(/(\d+)_public\.xml$/i);
    if (!match || !wanted.has(match[1])) continue;
    const offset = entry.localOffset;
    if (buffer.readUInt32LE(offset) !== 0x04034b50) continue;
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const start = offset + 30 + nameLength + extraLength;
    const compressed = buffer.slice(start, start + entry.compressedSize);
    const body = entry.method === 0 ? compressed
      : entry.method === 8 ? zlib.inflateRawSync(compressed) : null;
    if (body) out.set(match[1], body.toString('utf8'));
  }
  return out;
}

async function runIrsDiscovery({ jobs, aliases = new Map(), cacheDir, concurrency = 6,
  timeoutMs = 60000, indexTimeoutMs = 240000, years, maxFilings = 500 }) {
  await fsp.mkdir(cacheDir, { recursive: true });
  const scan = await scanIrsIndexes(jobs, aliases, cacheDir, { years, timeoutMs: indexTimeoutMs, maxFilings });
  const recordCache = new JsonStore(path.join(cacheDir, 'filings.json'));
  await recordCache.load();
  let requests = 0;
  let cacheHits = 0;
  const pending = scan.selected.filter(selected => {
    const cached = recordCache.get(selected.object_id);
    if (cached && !cached.error) { cacheHits++; return false; }
    return true;
  });
  const batches = new Map();
  for (const selected of pending) {
    const key = `${selected.year}|${selected.batch_id}`;
    if (!batches.has(key)) batches.set(key, []);
    batches.get(key).push(selected);
  }
  let batchNumber = 0;
  for (const [key, selectedRows] of batches) {
    const [year, batchId] = key.split('|');
    if (!batchId) continue;
    batchNumber++;
    console.log(`IRS archive ${batchNumber}/${batches.size}: ${batchId}`);
    const url = `https://apps.irs.gov/pub/epostcard/990/xml/${year}/${batchId}.zip`;
    const file = path.join(cacheDir, 'batches', `${batchId}.zip`);
    try {
      await downloadFile(url, file, { timeoutMs: indexTimeoutMs });
      requests++;
      const extracted = extractSelectedZip(file, selectedRows.map(row => row.object_id));
      for (const selected of selectedRows) {
        const xml = extracted.get(String(selected.object_id));
        const record = xml
          ? { ...parseIrsXml(xml), source_url: url, error: '' }
          : { source_url: url, error: 'filing-not-found-in-archive' };
        recordCache.set(selected.object_id, record);
      }
    } catch (error) {
      for (const selected of selectedRows) recordCache.set(selected.object_id, {
        source_url: url, error: String((error && error.message) || error)
      });
    } finally {
      if (fs.existsSync(file)) await fsp.rm(file, { force: true });
      await recordCache.save();
    }
  }
  const rows = scan.selected.map(selected => ({ ...selected, ...(recordCache.get(selected.object_id) || { error: 'not-fetched' }) }));
  await recordCache.save(true);
  const jobsByCcn = new Map(jobs.map(job => [job.ccn, job]));
  const candidates = [];
  for (const row of rows) {
    const job = jobsByCcn.get(row.ccn);
    const domain = normalizeDomain(row.website);
    if (!job || !domain || row.state !== job.state) continue;
    const cityMatch = normalizeName(row.city) === normalizeName(job.city);
    const zipMatch = row.zip && row.zip === zip5(job.zip);
    const addressMatch = addressAgreement(job.address, row.address);
    if (!addressMatch && !cityMatch && !zipMatch) continue;
    candidates.push(candidateRow(job, domain, 'irs990', {
      source_record_url: row.source_url,
      source_name: row.taxpayer_name,
      source_address: [row.address, row.city, row.state, row.zip].filter(Boolean).join(', '),
      name_score: Number(row.name_score.toFixed(3)),
      strict_name_score: Number(row.strict_name_score.toFixed(3)),
      address_match: addressMatch ? 'yes' : 'no',
      candidate_score: 60 + row.name_score * 20 + (addressMatch ? 10 : 0) + (zipMatch ? 5 : 0)
    }));
  }
  return { candidates, rows, selected: scan.selected.length, indexes: scan.indexes, requests, cacheHits };
}

async function resolveCmsCatalogUrl(kind, { timeoutMs = 30000 } = {}) {
  const config = CMS_CATALOGS[kind];
  if (!config) throw new Error(`Unknown CMS relationship source: ${kind}`);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`https://catalog.data.gov/dataset/${config.slug}`, {
      signal: controller.signal, headers: { 'User-Agent': APP_UA }
    });
    if (!response.ok) throw new Error(`catalog-http-${response.status}`);
    const html = await response.text();
    const pattern = new RegExp(`https://data\\.cms\\.gov/sites/default/files/[^\" ]+/${config.prefix}[^\" ]+\\.csv`, 'gi');
    const urls = unique(html.match(pattern) || []);
    if (!urls.length) throw new Error('no-static-csv-in-catalog');
    return urls.sort().at(-1);
  } finally { clearTimeout(timer); }
}

async function loadCmsRelationshipFiles(cacheDir, options = {}) {
  const result = {};
  for (const kind of Object.keys(CMS_CATALOGS)) {
    const supplied = options[`${kind}File`];
    const file = supplied ? path.resolve(supplied) : path.join(cacheDir, `${kind}.csv`);
    try {
      if (!supplied) {
        const url = options[`${kind}Url`] || await resolveCmsCatalogUrl(kind, { timeoutMs: options.timeoutMs });
        await downloadFile(url, file, { timeoutMs: options.downloadTimeoutMs || 240000 });
        result[kind] = { file, url, rows: csvToObjects(await fsp.readFile(file, 'utf8')), error: '' };
      } else {
        result[kind] = { file, url: '', rows: csvToObjects(await fsp.readFile(file, 'utf8')), error: '' };
      }
    } catch (error) {
      result[kind] = { file, url: '', rows: [], error: String((error && error.message) || error) };
    }
  }
  return result;
}

function cmsRelationshipCandidates(jobs, files, domains, roster) {
  const domainByCcn = new Map();
  for (const [domain, meta] of Object.entries(domains || {})) for (const ccn of (meta.ccns || [])) {
    if (!domainByCcn.has(ccn)) domainByCcn.set(ccn, new Set());
    domainByCcn.get(ccn).add(domain);
  }
  const enrollmentById = new Map();
  const keysByCcn = new Map();
  const domainsByKey = new Map();
  const addKey = (ccn, key, row) => {
    if (!key) return;
    if (!keysByCcn.has(ccn)) keysByCcn.set(ccn, []);
    keysByCcn.get(ccn).push({ key, row });
    for (const domain of domainByCcn.get(ccn) || []) {
      if (!domainsByKey.has(key)) domainsByKey.set(key, new Set());
      domainsByKey.get(key).add(domain);
    }
  };
  for (const row of files.enrollments?.rows || []) {
    const ccn = first(row, ['CCN', 'CAH OR HOSPITAL CCN']);
    const enrollmentId = first(row, ['ENROLLMENT ID']);
    if (enrollmentId) enrollmentById.set(enrollmentId, { row, ccn });
    const state = first(row, ['ENROLLMENT STATE', 'STATE']);
    for (const [prefix, value] of [
      ['pac', first(row, ['ASSOCIATE ID'])], ['npi', first(row, ['NPI'])],
      ['org', normalizeName(first(row, ['ORGANIZATION NAME']))],
      ['dba', normalizeName(first(row, ['DOING BUSINESS AS NAME']))]
    ]) addKey(ccn, value ? `${prefix}:${value}|${state}` : '', row);
  }
  const ownerKeysByEnrollment = new Map();
  for (const row of files.owners?.rows || []) {
    const enrollmentId = first(row, ['ENROLLMENT ID']);
    const ownerId = first(row, ['ASSOCIATE ID - OWNER']);
    const ownerName = normalizeName(first(row, ['ORGANIZATION NAME - OWNER', 'DOING BUSINESS AS NAME - OWNER']));
    const keys = unique([ownerId && `owner-id:${ownerId}`, ownerName && `owner-name:${ownerName}`]);
    ownerKeysByEnrollment.set(enrollmentId, unique([ownerKeysByEnrollment.get(enrollmentId) || [], keys]));
    const enrollment = enrollmentById.get(enrollmentId);
    if (enrollment) for (const key of keys) addKey(enrollment.ccn, key, row);
  }
  for (const row of files.chow?.rows || []) for (const side of ['BUYER', 'SELLER']) {
    const ccn = first(row, [`CCN - ${side}`]);
    const state = first(row, [`ENROLLMENT STATE - ${side}`]);
    for (const [prefix, value] of [
      ['pac', first(row, [`ASSOCIATE ID - ${side}`])], ['npi', first(row, [`NPI - ${side}`])],
      ['org', normalizeName(first(row, [`ORGANIZATION NAME - ${side}`]))],
      ['dba', normalizeName(first(row, [`DOING BUSINESS AS NAME - ${side}`]))]
    ]) addKey(ccn, value ? `${prefix}:${value}|${state}` : '', row);
  }
  const jobsByCcn = new Map(jobs.map(job => [job.ccn, job]));
  const candidates = [];
  const aliases = new Map();
  for (const [ccn, keyed] of keysByCcn) {
    const job = jobsByCcn.get(ccn);
    if (!job) continue;
    const names = unique(keyed.flatMap(({ row }) => [
      first(row, ['ORGANIZATION NAME', 'ORGANIZATION NAME - BUYER', 'ORGANIZATION NAME - SELLER']),
      first(row, ['DOING BUSINESS AS NAME', 'DOING BUSINESS AS NAME - BUYER', 'DOING BUSINESS AS NAME - SELLER'])
    ]));
    aliases.set(ccn, names);
    for (const { key } of keyed) for (const domain of domainsByKey.get(key) || []) {
      candidates.push(candidateRow(job, domain, 'cms-relations', {
        source_record_url: 'cms-provider-enrollment', source_name: names.join('|'),
        candidate_score: key.startsWith('npi:') || key.startsWith('pac:') ? 88 : 76
      }));
    }
  }
  return { candidates, aliases };
}

module.exports = {
  sanitizeNppesResult, nppesIdentity, runNppesDiscovery, nppesCandidateRows,
  siblingDomainCandidates, emailDomains, contactDomainCandidates,
  parseCsvLine, parseIrsXml, scanIrsIndexes, runIrsDiscovery,
  zipEntries, extractSelectedZip,
  resolveCmsCatalogUrl, loadCmsRelationshipFiles, cmsRelationshipCandidates
};
