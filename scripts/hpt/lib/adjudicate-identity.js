'use strict';
// Tiered per-facility identity adjudication for files the standard matcher
// could not auto-corroborate. Every tier is anchored to the roster facility's
// own address and state; a tier is rejected when two roster facilities could
// claim the same file. This never overrides the matcher on name alone.
const { normalizeName, nameSimilarity } = require('./util');
const { splitHeaderValues, strongAddressAgreement, distinctiveNameOverlap } = require('./mrf-header-match');

const CORPORATE_SUFFIX = /\s+(llc|inc|incorporated|corp|corporation|ltd|co)\.?$/i;
// Trailing campus qualifier on a normalized name: optional single word + "campus"
// ("summit campus", "main campus", bare "campus"). Applied to normalized text.
const CAMPUS_QUALIFIER = /(\s+[a-z0-9&'.-]+)?\s+campus$/i;
function stripCorporate(name) { return normalizeName(name).replace(CORPORATE_SUFFIX, '').trim(); }
function stripCampus(name) { return normalizeName(name).replace(CAMPUS_QUALIFIER, '').trim(); }
// Runs on the raw header string: normalizeName drops the dba token entirely.
function dbaSuffix(name) {
  const m = String(name || '').match(/\b(?:d\/b\/a|dba)\b\s*[:\-]?\s*(.+)$/i);
  return m ? m[1].trim() : null;
}
function locationStrong(rosterRow, addresses) {
  const zip = (String(rosterRow.zip || '').match(/\d{5}/) || [])[0] || '';
  return splitHeaderValues(addresses).some(address => {
    const declaredZips = (address.match(/\b\d{5}(?:-\d{4})?\b/g) || []).map(v => v.slice(0, 5));
    if (zip && declaredZips.length && !declaredZips.includes(zip)) return false;
    return strongAddressAgreement(rosterRow.address, address) && ((!!zip && declaredZips.includes(zip)) || address.toLowerCase().includes(String(rosterRow.city || '').toLowerCase()));
  });
}
function nameVs(name, rosterName) {
  const exact = normalizeName(name) === normalizeName(rosterName);
  return { exact, distinctive: distinctiveNameOverlap(name, rosterName), score: nameSimilarity(name, rosterName) };
}
// Address-uniqueness across the roster: more than one facility at the same
// normalized street number+name means address evidence cannot disambiguate.
function addressCompetitors(roster, rosterRow) {
  const key = a => normalizeName(a).split(/\s+/).filter(t => t && !/^(st|street|ave|avenue|rd|road|dr|drive|blvd|boulevard|n|s|e|w|north|south|east|west)$/.test(t)).join(' ');
  const target = key(rosterRow.address);
  if (!target) return 0;
  return roster.filter(h => h.ccn !== rosterRow.ccn && key(h.address) === target).length;
}
function adjudicateIdentity({ rosterRow, roster, member, pointerLinked, pointerLabels = [] }) {
  const headerNames = [...new Set([...splitHeaderValues(member.mrfHospitalName), ...splitHeaderValues(member.mrfLocationName)])].filter(Boolean);
  const stateMissing = !String(member.mrfLicenseState || '').trim();
  const stateOk = stateMissing || String(member.mrfLicenseState || '').toUpperCase() === String(rosterRow.state || '').toUpperCase();
  const strongLocation = locationStrong(rosterRow, member.mrfAddress);
  // Street-level agreement independent of the ZIP gate (used by the variant tier).
  const streetStrong = splitHeaderValues(member.mrfAddress).some(address =>
    strongAddressAgreement(rosterRow.address, address) && address.toLowerCase().includes(String(rosterRow.city || '').toLowerCase()));
  if (!headerNames.length) return { accept: false, reason: 'no-header-name' };
  if (!stateOk) {
    // A declared state that conflicts with the roster is a publisher data
    // error when everything else triangulates: exact roster name, exact
    // address match, unique address. It is surfaced as a publisher issue,
    // never silently promoted.
    const exact = headerNames.some(h => normalizeName(h) === normalizeName(rosterRow.name));
    if (exact && strongLocation && addressCompetitors(roster, rosterRow) === 0) {
      return { accept: false, reason: 'file-declares-conflicting-license-state' };
    }
    return { accept: false, reason: 'license-state-conflicts-with-roster' };
  }
  if (!strongLocation) {
    // T6: exact roster name and the exact street address, with only the postal
    // ZIP differing (CMS roster vs mailing ZIP). Requires pointer linkage and
    // no same-named facility at that street.
    const zipVariant = pointerLinked && headerNames.some(h2 => normalizeName(h2) === normalizeName(rosterRow.name))
      && splitHeaderValues(member.mrfAddress).some(address => {
        const rz = (String(rosterRow.zip || '').match(/\d{5}/) || [])[0] || '';
        const dz = (address.match(/\b\d{5}(?:-\d{4})?\b/g) || []).map(v => v.slice(0, 5));
        return rz && dz.length && !dz.includes(rz)
          && strongAddressAgreement(rosterRow.address, address)
          && address.toLowerCase().includes(String(rosterRow.city || '').toLowerCase());
      });
    const sameNamed = zipVariant && roster.filter(h2 => h2.ccn !== rosterRow.ccn && normalizeName(h2.name) === normalizeName(rosterRow.name));
    if (zipVariant && (!sameNamed || !sameNamed.length)) {
      return { accept: true, basis: 'exact-name-and-street-with-postal-zip-variant', reason: 'exact-identity-with-postal-zip-variant' };
    }
    if (zipVariant && sameNamed && sameNamed.length) {
      return { accept: false, reason: 'same-named-facility-also-at-this-street' };
    }
    return { accept: false, reason: 'file-address-does-not-agree-with-roster' };
  }
  if (addressCompetitors(roster, rosterRow) > 0) return { accept: false, reason: 'roster-has-another-facility-at-this-address' };

  // T1: legal-entity DBA clause ("X, LLC d/b/a Y Hospital") — DBA name must
  // match the roster name exactly or distinctively. (Corporate suffixes alone
  // never block a match: normalizeName already drops llc/inc/corp tokens.)
  for (const header of headerNames) {
    const dba = dbaSuffix(header);
    if (!dba) continue;
    const v = nameVs(dba, rosterRow.name);
    if (v.exact || (v.distinctive && v.score >= 0.72)) return { accept: true, basis: 'dba-name-and-roster-address', reason: 'dba-clause-names-roster-facility' };
  }
  // T3: campus-qualified name ("X Medical Center Main Campus" vs "X Medical
  // Center") — base name must identify exactly one roster facility.
  for (const header of headerNames) {
    const base = stripCampus(header);
    if (base === normalizeName(header) || base !== normalizeName(rosterRow.name)) continue;
    const competitors = roster.filter(h => h.ccn !== rosterRow.ccn && stripCampus(normalizeName(h.name)) === base
      && String(h.state).toUpperCase() === String(rosterRow.state).toUpperCase());
    if (!competitors.length) return { accept: true, basis: 'campus-qualified-name-and-roster-address', reason: 'campus-qualifier-over-roster-name' };
    return { accept: false, reason: 'campus-base-name-is-ambiguous-in-roster' };
  }
  // T4: full rename — the official pointer lists this file under the NEW name,
  // the header agrees with that label, and the address matches the roster row.
  if (pointerLinked) {
    const renamed = headerNames.some(header => { const v = nameVs(header, rosterRow.name); return !v.exact && v.score < 0.72; });
    const endorsed = pointerLabels.some(label => headerNames.some(header => nameVs(header, label).score >= 0.5 || normalizeName(header) === normalizeName(label)));
    if (renamed && endorsed) return { accept: true, basis: 'renamed-facility-pointer-label-and-roster-address', reason: 'rename-endorsed-by-pointer-label' };
  }
  // T5: header lacks a license state — require exact roster name and a strong
  // address match instead of the state-pool filter.
  if (stateMissing) {
    const exact = headerNames.some(header => normalizeName(header) === normalizeName(rosterRow.name));
    if (exact) return { accept: true, basis: 'exact-name-and-address-without-license-state', reason: 'exact-identity-without-license-state' };
  }
  return { accept: false, reason: 'no-adjudication-tier-applies' };
}

module.exports = { adjudicateIdentity, stripCorporate, stripCampus, dbaSuffix, locationStrong };
