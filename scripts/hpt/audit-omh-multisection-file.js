'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { parseCSV, normalizeName } = require('./lib/util');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const sourceProofPath = path.join(audit, 'reconciliation-omh-unreviewed-cohort-proof.json');
const rosterPath = path.join(audit, 'reconciliation-omh-current-cms-roster-crosswalk-2026-09-27.json');
const resolutionsPath = path.join(audit, 'reviewed-resolutions.json');
const identityPath = path.join(audit, 'reconciliation-elmira-official-facility-page-proof-2026-09-26.json');
const pilgrimIdentityPath = path.join(audit, 'reconciliation-pilgrim-official-facility-page-proof-2026-09-27.json');
const rawFilePath = path.join(audit, '.domain-discovery/reconciliation/omh-shared/file.bin');
const outputPath = path.join(audit, 'reconciliation-omh-multisection-file-audit-2026-09-27.json');
const expectedFileUrl = 'https://omh.ny.gov/omhweb/adults/141663311_nysomh_standardcharges.csv';

function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function sha256(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
function keyName(value) {
  return normalizeName(value)
    .replace(/\bpsych\b/g, 'psychiatric')
    .replace(/\bny\b/g, 'new york')
    .replace(/\bctr\b/g, 'center')
    .replace(/\s+/g, ' ')
    .trim();
}
function normalizeAddress(value) {
  return String(value || '').toLowerCase()
    .replace(/\bone\b/g, '1')
    .replace(/\be\b/g, 'east')
    .replace(/&/g, ' and ')
    .replace(/\bstreet\b/g, 'st')
    .replace(/\broad\b/g, 'rd')
    .replace(/\bavenue\b/g, 'ave')
    .replace(/\bdrive\b/g, 'dr')
    .replace(/\bplace\b/g, 'pl')
    .replace(/\bboulevard\b/g, 'blvd')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function addressParts(value) {
  const clean = String(value || '').replace(/[^\x00-\x7F]+/g, ' ').trim();
  const match = /,\s*([A-Z]{2})\s+(\d{5})(?:-\d{4})?\s*$/i.exec(clean);
  if (!match) return { street: normalizeAddress(clean), city: '', state: '', zip: '' };
  const preceding = clean.slice(0, match.index).split(',').map(part => part.trim());
  return { street: normalizeAddress(preceding[0] || ''), city: normalizeName(preceding.slice(1).join(' ')),
    state: match[1].toUpperCase(), zip: match[2] };
}
function parseSections(bytes) {
  const rows = parseCSV(bytes.toString('utf8'));
  const sections = [];
  for (let i = 0; i < rows.length; i++) {
    if (rows[i][0] !== '1' || rows[i][1] !== 'hospital_name') continue;
    const metadata = rows[i + 1] || [];
    const columns = rows[i + 2] || [];
    let end = i + 3;
    const data = [];
    for (; end < rows.length && !(rows[end][0] === '1' && rows[end][1] === 'hospital_name'); end++) {
      if (/^\d+$/.test(rows[end][0] || '')) data.push(rows[end]);
    }
    const widths = [...new Set(data.map(row => row.length))].sort((a, b) => a - b);
    const grossIndex = columns.indexOf('Gross Charge');
    const npiIndex = columns.indexOf('NPI');
    const licenseIndex = columns.findIndex(value => String(value).startsWith('license_number|'));
    sections.push({
      section_name: metadata[1] || '',
      declared_date_raw: metadata[2] || '',
      version: metadata[3] || '',
      location_name: metadata[4] || '',
      address: metadata[5] || '',
      attestation: String(metadata[6] || '').toLowerCase() === 'true',
      columns: columns.length,
      data_rows: data.length,
      row_widths: widths,
      malformed_row_widths: data.filter(row => row.length !== columns.length).length,
      usable_gross_charge_rows: data.filter(row => /^\d+(\.\d+)?$/.test(row[grossIndex] || '')).length,
      license_header: licenseIndex >= 0 ? columns[licenseIndex] : '',
      license_state: licenseIndex >= 0 ? String(columns[licenseIndex]).split('|')[1] || '' : '',
      declared_npis: [...new Set(data.map(row => row[npiIndex] || '').filter(value => /^\d{10}$/.test(value)))],
      license_values: [...new Set(data.map(row => row[licenseIndex] || '').filter(Boolean))],
      start_line: i + 1,
      end_line: end,
    });
    i = end - 1;
  }
  return sections;
}

function build() {
  const source = readJson(sourceProofPath);
  const cms = readJson(rosterPath);
  const resolutions = readJson(resolutionsPath);
  const bytes = fs.readFileSync(rawFilePath);
  const digest = sha256(bytes);
  if (source.shared_file_url !== expectedFileUrl || cms.records.length !== 14
    || digest !== source.shared_file_sha256 || digest !== '84f14403ad89386a0fb9e470d2e3fe371454eef40ca32b86d31fe313a0fd0911')
    throw new Error('Retained OMH source file or source-crosswalk hashes do not match');
  const sections = parseSections(bytes);
  if (sections.length !== 20) throw new Error(`Expected 20 facility sections, found ${sections.length}`);
  const cmsByCcn = new Map(cms.records.map(row => [row.ccn, row]));
  const identity = readJson(identityPath);
  const pilgrimIdentity = readJson(pilgrimIdentityPath);
  const records = source.records.map(prior => {
    const cmsRow = cmsByCcn.get(prior.ccn);
    if (!cmsRow) throw new Error(`No current CMS roster crosswalk for ${prior.ccn}`);
    const section = sections.find(item => keyName(item.location_name) === keyName(prior.pointer_entry_name));
    if (!section) {
      return {
        ccn: prior.ccn,
        cms_hospital_name: cmsRow.hospital_name,
        cms_address: `${cmsRow.address}, ${cmsRow.city}, ${cmsRow.state} ${cmsRow.zip}`,
        official_omh_directory_name: prior.directory_name,
        pointer_entry_name: prior.pointer_entry_name,
        pointer_entry_status: prior.pointer_entry_status,
        pointer_mrf_url: prior.pointer_mrf_url,
        file_section: null,
        finding: 'pointer-or-bundle-has-no-facility-specific-section',
        next_action: 'Obtain an explicit OMH pointer entry and file section (or publisher-provided facility-specific file); keep this CCN unresolved.',
      };
    }
    const fileFacilityNameMatches = keyName(section.section_name) === keyName(prior.directory_name)
      || keyName(section.section_name).startsWith(`${keyName(prior.directory_name)} `)
      || keyName(prior.directory_name).startsWith(`${keyName(section.section_name)} `)
      || keyName(section.section_name).replace(/ psychiatric center$/, '')
        === keyName(prior.directory_name).replace(/ psychiatric center$/, '');
    const firstPartyAddress = prior.ccn === identity.ccn ? identity.facility_identity.address
      : prior.ccn === pilgrimIdentity.ccn ? pilgrimIdentity.facility_identity.address : '';
    const identityAddress = firstPartyAddress
      ? firstPartyAddress
      : `${cmsRow.address}, ${cmsRow.city}, ${cmsRow.state} ${cmsRow.zip}`;
    const fileAddress = addressParts(section.address);
    const expectedAddress = addressParts(identityAddress);
    const cityAlias = prior.ccn === pilgrimIdentity.ccn && fileAddress.city === 'brentwood'
      && expectedAddress.city === 'west brentwood' && fileAddress.street === expectedAddress.street
      && fileAddress.zip === expectedAddress.zip && fileAddress.state === expectedAddress.state;
    const cityMatches = fileAddress.city === expectedAddress.city || cityAlias;
    const addressMatches = fileAddress.street === expectedAddress.street
      && fileAddress.state === expectedAddress.state && fileAddress.zip === expectedAddress.zip && cityMatches;
    const cityStateMatches = cityMatches && fileAddress.state === cmsRow.state;
    const structurallyUsable = section.columns >= 12 && section.data_rows > 0
      && section.row_widths.length === 1 && section.row_widths[0] === section.columns
      && section.malformed_row_widths === 0 && section.usable_gross_charge_rows > 0
      && section.version === '3.0.0' && section.attestation && section.license_state === cmsRow.state;
    const matched = fileFacilityNameMatches && addressMatches && cityStateMatches && structurallyUsable;
    const nextAction = matched
      ? 'Retain this facility-specific section as current observed file evidence; only revisit after a source change or on the next scheduled verification.'
      : prior.ccn === '334004'
        ? 'Ask OMH to explain or correct why the Creedmoor section declares 79-25 Winchester Boulevard while the current CMS CCN roster lists 80-45 Winchester Blvd, Building B; keep the file unassigned until the address relationship is documented.'
        : 'Keep unresolved; obtain publisher clarification or corrected facility-specific metadata before promoting the file.';
    return {
      ccn: prior.ccn,
      cms_hospital_name: cmsRow.hospital_name,
      cms_address: `${cmsRow.address}, ${cmsRow.city}, ${cmsRow.state} ${cmsRow.zip}`,
      official_omh_directory_name: prior.directory_name,
      pointer_entry_name: prior.pointer_entry_name,
      pointer_entry_status: prior.pointer_entry_status,
      pointer_mrf_url: prior.pointer_mrf_url,
      identity_address_used: identityAddress,
      file_section: section,
      checks: { file_facility_name_matches_official_directory: fileFacilityNameMatches,
        file_address_matches_cms_or_first_party_identity: addressMatches,
        file_city_and_state_match_cms: cityStateMatches,
        cms_v3_structure_date_attestation_and_usable_rows: structurallyUsable },
      address_variation: cityAlias
        ? 'MRF section says Brentwood; the current CMS roster and OMH facility page say West Brentwood. Street, state and ZIP5 agree.' : '',
      finding: matched ? 'facility-specific-current-mrf-section-confirmed'
        : 'facility-section-retained-unresolved-for-name-address-or-structure-conflict',
      next_action: nextAction,
    };
  });
  const promotable = records.filter(row => row.finding === 'facility-specific-current-mrf-section-confirmed');
  const unresolved = records.filter(row => row.finding !== 'facility-specific-current-mrf-section-confirmed');
  const evidenceRun = 'omh-multisection-current-pointer-file-cms-roster-crosswalk-2026-09-27';
  const existingVerified = promotable.filter(row => resolutions.some(resolution => resolution.ccn === row.ccn
    && resolution.action === 'replace' && resolution.finding === 'verified-current-mrf'
    && resolution.evidence?.url === expectedFileUrl
    && String(resolution.evidence?.fileSha256 || '').toLowerCase() === digest
    && (resolution.prior_review || resolution.evidence_run !== evidenceRun)));
  return {
    observed_at: cms.observed_at,
    scope: 'All 14 CCNs in the retained OMH shared-file unresolved cohort, not all OMH facilities.',
    prior_review_assessment: 'An earlier cohort snapshot recorded the first Greater Binghamton section as if it characterized the entire shared download. Five cohort CCNs subsequently received separate facility-section reviews; this current 20-section audit checks the full 14-CCN cohort uniformly and refreshes prior positive evidence without counting those five as new resolutions.',
    source: {
      official_domain: 'omh.ny.gov',
      pointer_url: source.pointer_url,
      pointer_sha256: source.pointer_sha256,
      pointer_observation_at: source.observed_at,
      shared_file_url: source.shared_file_url,
      current_http_status: 200,
      current_content_type: 'text/csv',
      current_last_modified: '2026-06-11T15:30:53Z',
      current_full_file_bytes: bytes.length,
      current_full_file_sha256: digest,
      retained_file_bytes: bytes.length,
      retained_file_sha256: source.shared_file_sha256,
      facility_sections_in_download: sections.length,
    },
    cms_source: {
      dataset: cms.dataset,
      dataset_url: cms.dataset_url,
      dataset_id: cms.dataset_id,
      last_modified: cms.dataset_last_modified,
      released: cms.dataset_released,
      query_url: cms.query_url,
      response_status: cms.response_status,
      response_bytes: cms.response_bytes,
      response_sha256: cms.response_sha256,
      observed_at: cms.observed_at,
    },
    counts: { historical_unresolved_ccns_reviewed: records.length,
      exact_facility_sections_confirmed: promotable.length,
      already_supported_reviewed_findings: existingVerified.length,
      newly_supported_reviewed_findings: promotable.length - existingVerified.length,
      remain_unresolved: unresolved.length },
    records,
  };
}

if (require.main === module) {
  const proof = build();
  fs.writeFileSync(outputPath, `${JSON.stringify(proof, null, 2)}\n`);
  process.stdout.write(`${outputPath}\n${JSON.stringify(proof.counts)}\n`);
}

module.exports = { build, parseSections, normalizeAddress, keyName };
