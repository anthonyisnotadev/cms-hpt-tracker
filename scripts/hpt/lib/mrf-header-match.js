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

function bestNameMatch(values, hospitalName) {
  return values.map(value => ({
    value,
    score: nameSimilarity(value, hospitalName),
    strictScore: strictSimilarity(value, hospitalName),
    exact: normalizeName(value) === normalizeName(hospitalName)
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
  if (!state) return { status: 'review', reason: 'mrf-header-has-no-license-state', matches: [], reviews: [] };
  const pool = hospitals.filter(hospital => hospital.state === state);
  if (!pool.length) return { status: 'unmatched', reason: 'no-unresolved-hospitals-in-license-state', matches: [], reviews: [] };

  const headerNames = [...new Set([
    ...splitHeaderValues(probe.mrfHospitalName),
    ...splitHeaderValues(probe.mrfLocationName)
  ])];
  if (!headerNames.length) return { status: 'unmatched', reason: 'mrf-header-has-no-hospital-name', matches: [], reviews: [] };
  const pointerNames = [...new Set(task.refs.map(ref => ref.location_name).filter(Boolean))];
  const addresses = splitHeaderValues(probe.mrfAddress);
  const headerZips = new Set(addresses.flatMap(address => address.match(/\b\d{5}(?:-\d{4})?\b/g) || [])
    .map(zip => zip.slice(0, 5)));

  const candidates = pool.map(hospital => {
    const header = bestNameMatch(headerNames, hospital.name || hospital.hospital_name);
    const pointer = bestNameMatch(pointerNames, hospital.name || hospital.hospital_name);
    const zip = (String(hospital.zip || '').match(/\d{5}/) || [])[0] || '';
    const zipHit = !!zip && headerZips.has(zip);
    const cityInAddress = addresses.some(address => phraseIn(address, hospital.city));
    const cityInHeader = headerNames.some(name => phraseIn(name, hospital.city));
    const rosterStreetNumber = (String(hospital.address || '').match(/\b\d{1,6}\b/) || [])[0] || '';
    const headerStreetNumbers = new Set(addresses.flatMap(address => address.match(/\b\d{1,6}\b/g) || []));
    const streetHit = !!rosterStreetNumber && headerStreetNumbers.has(rosterStreetNumber);
    const locationStrong = streetHit && (zipHit || cityInAddress);
    const modifiersAgree = identityModifiersAgree(header.value, hospital.name || hospital.hospital_name);
    const nameStrong = header.exact
      || (header.score >= 0.72 && header.strictScore >= 0.55)
      || (locationStrong && header.score >= 0.60 && header.strictScore >= 0.65);
    return {
      hospital, header, pointer, zipHit, streetHit, cityHit: cityInAddress || cityInHeader,
      locationStrong, nameStrong: nameStrong && modifiersAgree, modifiersAgree,
      rank: header.score + header.strictScore * 0.25 + (zipHit ? 0.4 : 0)
        + (cityInAddress ? 0.2 : 0) + (streetHit ? 0.25 : 0)
    };
  }).filter(candidate => candidate.nameStrong)
    .sort((a, b) => b.rank - a.rank || b.header.strictScore - a.header.strictScore);

  if (!candidates.length) return { status: 'unmatched', reason: 'mrf-header-does-not-match-unresolved-roster', matches: [], reviews: [] };
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

module.exports = { matchMrfHeader, splitHeaderValues };
