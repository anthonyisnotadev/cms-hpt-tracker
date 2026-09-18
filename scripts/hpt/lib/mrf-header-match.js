'use strict';

const { normalizeName, nameSimilarity, strictSimilarity } = require('./util');

function successfulStatus(value) {
  const status = Number(value || 0);
  return status >= 200 && status < 300;
}

function splitHeaderValues(value) {
  const values = Array.isArray(value) ? value : [value];
  return values.flatMap(item => String(item || '').split('|'))
    .map(item => item.trim()).filter(Boolean);
}

function phraseIn(value, phrase) {
  const normalizedValue = normalizeName(value);
  const normalizedPhrase = normalizeName(phrase);
  return !!normalizedPhrase && (` ${normalizedValue} `).includes(` ${normalizedPhrase} `);
}

function identityName(value) {
  // CMS and publisher systems sometimes split a registered joined brand in
  // the roster, or join the brand to its campus name. This is orthographic
  // equivalence only; the address and state gates below still apply.
  return normalizeName(value).replace(/\badvent health\b/g, 'adventhealth')
    .replace(/^adventhealth(?=[a-z])/, 'adventhealth ');
}

function bestNameMatch(values, hospitalName) {
  const normalizedHospital = identityName(hospitalName);
  return values.map(value => ({
    value,
    score: nameSimilarity(identityName(value), normalizedHospital),
    strictScore: strictSimilarity(identityName(value), normalizedHospital),
    exact: identityName(value) === normalizedHospital
  })).sort((a, b) => b.score - a.score || b.strictScore - a.strictScore)[0] || {
    value: '', score: 0, strictScore: 0, exact: false
  };
}

const IDENTITY_MODIFIERS = [
  ['va', 'veteran', 'veterans'],
  ['rehab', 'rehabilitation'],
  ['behavioral'], ['psychiatric', 'psych'],
  ['child', 'children', 'childrens', 'pediatric'],
  ['surgical', 'surgery'], ['orthopedic', 'orthopaedic'],
  ['heart', 'cardiac'], ['cancer', 'oncology'], ['emergency']
];

// Shared corporate branding must not match one named campus to another.
const GENERIC_NAME_WORDS = new Set('hca florida hosp med ctr hospital hospitals health healthcare system systems medical center centre inc incorporated corporation corp llc the of and memorial regional community general'.split(' '));
function distinctiveNameOverlap(a, b) {
  const tokens = value => normalizeName(value).split(' ').filter(t => t && !GENERIC_NAME_WORDS.has(t));
  const left = new Set(tokens(a));
  return tokens(b).some(t => left.has(t));
}

function streetTokens(value) {
  const words = { one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9', ten: '10',
    first: '1st', second: '2nd', third: '3rd', fourth: '4th', fifth: '5th', sixth: '6th', seventh: '7th', eighth: '8th', ninth: '9th', tenth: '10th', eleventh: '11th', twelfth: '12th',
    north: 'n', south: 's', east: 'e', west: 'w', northeast: 'ne', northwest: 'nw', southeast: 'se', southwest: 'sw' };
  const types = new Set('street streets st sts avenue ave road rd route sr highway hwy drive dr boulevard blvd lane ln parkway pkwy place pl circle cir court ct terrace ter trail trl way plaza plz expressway expy us'.split(' '));
  const normalizedInput = String(value || '')
    .replace(/\bhosptial\b/gi, 'hospital').replace(/\bcorp0rate\b/gi, 'corporate')
    .replace(/\bmillenium\b/gi, 'millennium').replace(/\bstuderbaker\b/gi, 'studebaker')
    .replace(/^\s*n\s*\/?\s*a\s*(?=\d)/i, '')
    .replace(/^\s*(\d+)\s*-\s*(\d+)\b/, '$1$2')
    .replace(/^\s*(\d+)(n|s|e|w|ne|nw|se|sw)\b/i, '$1 $2')
    .replace(/\bl\s+v\b/gi, 'lv');
  const withoutMailbox = normalizeName(normalizedInput).replace(/\b(?:p o|po) box \d+[a-z]?\b/g, ' ')
    // Normalize recurring publisher/roster transcription errors only inside
    // address comparison. Exact street number, city/ZIP and state gates still
    // apply in matchMrfHeader.
    // Secondary delivery designators are not part of the physical street.
    .replace(/\b(?:suite|ste|unit|spc|space|floor|fl|room|rm|slot|mail slot|building|bldg)\s+[a-z0-9-]+\b.*$/g, ' ')
    // Written street number and split compass abbreviations are equivalent;
    // do not erase the direction, which distinguishes different streets.
    .replace(/^([a-z]+)\b/, token => words[token] || token)
    .replace(/\b([ns])\s+([ew])\b/g, '$1$2');
  return withoutMailbox.split(' ').map(v => words[v] || v).filter(v => v && !types.has(v));
}
const DIRECTIONS = new Set(['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']);
function oneEditApart(a, b) {
  if (a === b) return true;
  if (Math.min(a.length, b.length) < 5 || Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else { i++; j++; }
  }
  return edits + (i < a.length || j < b.length ? 1 : 0) <= 1;
}
function corroboratedAddressAgreement(rosterAddress, fileAddress) {
  const left = streetTokens(rosterAddress), right = streetTokens(fileAddress);
  if (!left.length || !right.length || !/^\d+$/.test(left[0]) || left[0].replace(/^0+/, '') !== right[0].replace(/^0+/, '')) return false;
  const leftDirections = new Set(left.filter(token => DIRECTIONS.has(token)));
  const rightDirections = new Set(right.filter(token => DIRECTIONS.has(token)));
  if (leftDirections.size && rightDirections.size && ![...leftDirections].some(token => rightDirections.has(token))) return false;
  const street = left.slice(1).filter(token => !DIRECTIONS.has(token));
  const candidateList = right.slice(1).filter(token => !DIRECTIONS.has(token));
  const candidates = new Set(candidateList);
  if (street.length && (street.join('') === candidateList[0]
    || (street.length === 1 && street[0] === candidateList.slice(0, 2).join('')))) return true;
  return street.length > 0
    && street.filter(token => candidates.has(token) || candidateList.some(candidate => oneEditApart(token, candidate))).length / street.length >= 0.75;
}
function strongAddressAgreement(rosterAddress, fileAddress) {
  const left = streetTokens(rosterAddress), right = streetTokens(fileAddress);
  if (!left.length || !/^\d/.test(left[0]) || left[0] !== right[0]) return false;
  const street = left.slice(1), candidates = new Set(right.slice(1));
  return street.length > 0 && street.filter(v => candidates.has(v)).length / street.length >= 0.75;
}

function postalCodes(value) {
  // A five-digit street number at the start of an address is not a ZIP code.
  return (String(value || '').replace(/^\s*\d+[A-Za-z-]*\b/, '').match(/\b\d{5}(?:-\d{4})?\b/g) || [])
    .map(zip => zip.slice(0, 5));
}

function identityModifiersAgree(a, b) {
  const tokens = value => new Set(normalizeName(value).split(' ').filter(Boolean));
  const left = tokens(a), right = tokens(b);
  for (const group of IDENTITY_MODIFIERS) {
    const inLeft = group.some(token => left.has(token));
    const inRight = group.some(token => right.has(token));
    if (inLeft !== inRight) return false;
  }
  return true;
}

function matchMrfHeader(task, probe, hospitals) {
  if (!successfulStatus(probe && probe.rangeStatus)) {
    return { status: 'unreachable', reason: 'mrf-header-unreachable', matches: [], reviews: [] };
  }
  const state = String(probe && probe.mrfLicenseState || '').toUpperCase();
  const pool = state ? hospitals.filter(hospital => hospital.state === state) : hospitals;
  if (!pool.length) return { status: 'unmatched', reason: 'no-unresolved-hospitals-in-license-state', matches: [], reviews: [] };

  const headerNames = [...new Set([
    ...splitHeaderValues(probe.mrfHospitalName),
    ...splitHeaderValues(probe.mrfLocationName)
  ])];
  if (!headerNames.length) return { status: 'unmatched', reason: 'mrf-header-has-no-hospital-name', matches: [], reviews: [] };
  const pointerNames = [...new Set(task.refs.map(ref => ref.location_name).filter(Boolean))];
  const pointerLinkedCcns = task.existingMatchedCcns instanceof Set
    ? task.existingMatchedCcns : new Set(task.existingMatchedCcns || []);
  const addresses = splitHeaderValues(probe.mrfAddress);
  const headerZips = new Set(addresses.flatMap(postalCodes));

  const candidates = pool.map(hospital => {
    const pointerLinked = pointerLinkedCcns.has(hospital.ccn);
    const header = bestNameMatch(headerNames, hospital.name || hospital.hospital_name);
    const pointer = bestNameMatch(pointerNames, hospital.name || hospital.hospital_name);
    const zip = (String(hospital.zip || '').match(/\d{5}/) || [])[0] || '';
    const zipHit = !!zip && headerZips.has(zip);
    const cityInAddress = addresses.some(address => phraseIn(address, hospital.city));
    const cityInHeader = headerNames.some(name => phraseIn(name, hospital.city));
    const rosterStreetNumber = (String(hospital.address || '').match(/\b\d{1,6}\b/) || [])[0] || '';
    const headerStreetNumbers = new Set(addresses.map(address => (address.match(/^\s*(\d{1,6})\b/) || [])[1]).filter(Boolean));
    const streetHit = !!rosterStreetNumber && headerStreetNumbers.has(rosterStreetNumber);
    const pointerCorroboratedAddress = addresses.some(address => {
      const declaredZips = postalCodes(address);
      return pointerLinked && !strongAddressAgreement(hospital.address, address)
        && corroboratedAddressAgreement(hospital.address, address)
        && phraseIn(address, hospital.city) && !!zip && declaredZips.includes(zip);
    });
    const locationStrong = addresses.some(address => {
      const declaredZips = postalCodes(address);
      const strictStreet = strongAddressAgreement(hospital.address, address);
      const pointerCorroboratedStreet = pointerLinked && corroboratedAddressAgreement(hospital.address, address)
        && phraseIn(address, hospital.city) && !!zip && declaredZips.includes(zip);
      return (strictStreet || pointerCorroboratedStreet)
        // Roster ZIPs sometimes describe a billing or PO-box address. An
        // exact pointer name can corroborate a matching street and city when
        // that mailing ZIP is obsolete; without it, a declared conflict blocks.
        && ((!!zip && declaredZips.includes(zip))
          || (phraseIn(address, hospital.city) && (!declaredZips.length || pointer.exact))
          // Some valid root headers contain only the street. An exact file
          // facility name plus an agreeing license state and strong street is
          // sufficient, provided the later ambiguity grouping finds only one
          // roster facility for that exact identity.
          || (header.exact && !!state && !declaredZips.length));
    });
    const stateInAddress = addresses.some(address => new RegExp(`(?:^|[\\s,])${hospital.state}(?:[\\s,]|$)`, 'i').test(address));
    const modifiersAgree = identityModifiersAgree(header.value, hospital.name || hospital.hospital_name);
    const distinctive = distinctiveNameOverlap(header.value, hospital.name || hospital.hospital_name);
    const pointerExactWithAddress = pointer.exact && locationStrong;
    const pointerCcnWithAddress = pointerLinked && locationStrong && !!state;
    const nameStrong = pointerCcnWithAddress || pointerExactWithAddress || header.exact || (distinctive && (
      (header.score >= 0.72 && header.strictScore >= 0.55)
      || (locationStrong && header.score >= 0.60 && header.strictScore >= 0.65)));
    return {
      hospital, header, pointer, zipHit, streetHit, cityHit: cityInAddress || cityInHeader,
      locationStrong, stateInAddress,
      nameStrong: nameStrong && modifiersAgree && (state || (header.exact && locationStrong && stateInAddress)), modifiersAgree,
      identityBasis: !state ? 'recorded-file-name-street-state-agree'
        : pointerCorroboratedAddress ? 'exact-pointer-ccn-file-corroborated-street-city-zip-license-state-agree'
        : header.exact && locationStrong && !addresses.some(address => postalCodes(address).length) ? 'exact-file-name-street-license-state-agree'
        : pointerCcnWithAddress && !header.exact ? 'exact-pointer-ccn-file-street-license-state-agree'
        : pointerExactWithAddress && !header.exact ? 'exact-pointer-name-and-file-address' : 'file-name-and-address',
      rank: header.score + header.strictScore * 0.25 + (zipHit ? 0.4 : 0)
        + (cityInAddress ? 0.2 : 0) + (streetHit ? 0.25 : 0)
    };
  }).filter(candidate => candidate.nameStrong)
    .sort((a, b) => b.rank - a.rank || b.header.strictScore - a.header.strictScore);

  if (!candidates.length) return { status: state ? 'unmatched' : 'review',
    reason: state ? 'mrf-header-does-not-match-unresolved-roster' : 'mrf-header-has-no-license-state', matches: [], reviews: [] };
  const located = candidates.filter(candidate => candidate.locationStrong);
  const matches = [], reviews = [];
  const byIdentity = new Map();
  for (const candidate of located) {
    const key = normalizeName(candidate.header.value);
    if (!byIdentity.has(key)) byIdentity.set(key, []);
    byIdentity.get(key).push(candidate);
  }
  for (const group of byIdentity.values()) {
    if (group.length === 1) matches.push(group[0]);
    else reviews.push(...group.map(candidate => ({ ...candidate, reviewReason: 'ambiguous-mrf-header-identity' })));
  }
  if (!located.length) {
    const top = candidates[0];
    const ambiguous = candidates[1] && top.rank - candidates[1].rank < 0.1;
    const selected = ambiguous ? candidates.filter(candidate => top.rank - candidate.rank < 0.1) : [top];
    reviews.push(...selected.map(candidate => ({
      ...candidate,
      reviewReason: ambiguous ? 'ambiguous-mrf-header-identity' : 'mrf-header-name-without-location'
    })));
  }
  return {
    status: matches.length ? 'matched' : 'review',
    reason: matches.length ? 'mrf-header-identity-and-location-agree' : reviews[0].reviewReason,
    matches, reviews
  };
}

module.exports = { matchMrfHeader, splitHeaderValues, distinctiveNameOverlap, strongAddressAgreement, corroboratedAddressAgreement, identityName };
