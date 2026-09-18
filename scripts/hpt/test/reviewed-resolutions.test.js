'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { applyDomainObservations, applyResolutions, correctTemplateVersionFinding, loadReviewedView } = require('../lib/reviewed-resolutions');
const path = require('node:path');
const reviewedLedger = require('../../../data/hpt-audit/reviewed-resolutions.json');
const base = { ccn: '010001', finding: 'mrf-url-unreachable', domain: 'hospital.test', pointer_url: 'https://hospital.test/cms-hpt.txt', mrf_url: 'https://hospital.test/old.csv', checked_at: '2026-09-07T00:00:00Z' };
const resolution = { ccn: base.ccn, base, action: 'replace', note: 'Reviewed', evidence: {
  identity: 'corroborated', pointerUrl: base.pointer_url, pointerSha256: 'verified-body-hash', url: 'https://hospital.test/new.csv',
  http_status: 206, date: '2026-09-01', version: '3.0.0', checked_at: '2026-09-09T00:00:00Z'
} };
test('Tillamook legal-name alias resolves only the exact pointer target without claiming full-file validation', () => {
  const r = reviewedLedger.find(entry => entry.ccn === '381317');
  assert.ok(r);
  assert.equal(r.action, 'replace');
  assert.equal(r.evidence.pointerLocationName, 'NORTHWEST MEDICAL FOUNDATION OF TILLAMOOK');
  assert.equal(r.evidence.declared_address, '1000 3rd St Tillamook OR 97141');
  assert.equal(r.evidence.declared_license_state, 'OR');
  assert.equal(r.evidence.date, '2026-05-22');
  assert.equal(r.evidence.version, '3.0.0');
  assert.equal(r.evidence.completeFileValidated, false);
  assert.match(r.note, /not complete-file validation/);
  const result = applyResolutions([r.base], [], [], [r]);
  assert.equal(result.compliance[0].finding, 'compliant-observed');
  assert.equal(result.compliance[0].mrf_url, r.evidence.url);
  assert.equal(result.history[r.ccn].finding, 'not-assessed-not-named-in-file');
});
test('Perimeter Jackson legal-name alias exposes the Tennessee file license-state header conflict', () => {
  const r = reviewedLedger.find(entry => entry.ccn === '444023');
  assert.ok(r);
  assert.equal(r.action, 'replace-observation');
  assert.equal(r.evidence.location_name, 'Woodridge of West Tennessee LLC');
  assert.equal(r.evidence.declared_address, '49 Old Hickory Boulevard, Jackson TN 38305');
  assert.equal(r.evidence.declared_license_state, 'TX');
  assert.equal(r.evidence.declared_license_value_state, 'TN');
  assert.equal(r.evidence.facility_state, 'TN');
  assert.equal(r.evidence.fullFileSchemaAndRateValidityAssessed, false);
  const result = applyResolutions([r.base], [], [], [r]);
  assert.equal(result.compliance[0].finding, 'mrf-license-state-field-conflicts-facility');
  assert.equal(result.compliance[0].mrf_url, r.evidence.url);
  assert.equal(result.history[r.ccn].finding, 'not-assessed-not-named-in-file');
});
test('Erlanger Medical Center resolves only to the Baroness campus in the shared CSV', () => {
  const r = reviewedLedger.find(entry => entry.ccn === '440104');
  assert.ok(r);
  assert.equal(r.action, 'replace');
  assert.equal(r.evidence.location_name, 'Erlanger Baroness Hospital');
  assert.match(r.evidence.declared_location_name, /^Erlanger Baroness Hospital \|/);
  assert.match(r.evidence.declared_address, /^975 East Third Street, Chattanooga, TN 37403 \|/);
  assert.equal(r.evidence.declared_license_state, 'TN');
  assert.equal(r.evidence.date, '2026-01-25');
  assert.equal(r.evidence.version, '3.0.0');
  assert.equal(r.evidence.completeFileValidated, false);
  assert.match(r.note, /not fully validated/);
  const result = applyResolutions([r.base], [], [], [r]);
  assert.equal(result.compliance[0].finding, 'compliant-observed');
  assert.equal(result.compliance[0].mrf_url, r.evidence.url);
  assert.equal(result.history[r.ccn].finding, 'not-assessed-not-named-in-file');
});
test('Essentia Fargo retains the roster versus publisher ZIP difference while locating the exact file', () => {
  const r = reviewedLedger.find(entry => entry.ccn === '350070');
  assert.ok(r);
  assert.equal(r.action, 'replace');
  assert.equal(r.evidence.location_name, 'Essentia Health-Fargo');
  assert.equal(r.evidence.declared_address, 'Essentia Health Fargo, 3000 32nd Ave S Fargo, ND 58103');
  assert.equal(r.evidence.roster_zip, '58104');
  assert.equal(r.evidence.publisher_zip, '58103');
  assert.equal(r.evidence.declared_license_state, 'ND');
  assert.equal(r.evidence.date, '2026-01-01');
  assert.equal(r.evidence.completeFileValidated, false);
  assert.match(r.note, /roster says ZIP 58104/);
  const result = applyResolutions([r.base], [], [], [r]);
  assert.equal(result.compliance[0].finding, 'compliant-observed');
  assert.equal(result.compliance[0].mrf_url, r.evidence.url);
  assert.equal(result.history[r.ccn].finding, 'not-assessed-domain-unknown');
});
test('Lexington matches the physical hospital despite the roster PO-box ZIP', () => {
  const r = reviewedLedger.find(entry => entry.ccn === '340096');
  assert.ok(r);
  assert.equal(r.action, 'replace');
  assert.equal(r.evidence.declared_hospital_name, 'Lexington Medical Center');
  assert.equal(r.evidence.declared_address, '250 Hospital Dr, Lexington, NC 27292');
  assert.equal(r.evidence.roster_zip, '27293');
  assert.equal(r.evidence.publisher_zip, '27292');
  assert.equal(r.evidence.declared_license_state, 'NC');
  assert.equal(r.evidence.completeFileValidated, false);
  assert.match(r.note, /2\.14 GB file was sampled/);
  const result = applyResolutions([r.base], [], [], [r]);
  assert.equal(result.compliance[0].finding, 'compliant-observed');
  assert.equal(result.compliance[0].mrf_url, r.evidence.url);
  assert.equal(result.history[r.ccn].finding, 'not-assessed-not-named-in-file');
});
test('VCU Medical Center retains repeated same-campus address and ZIP variant without full-file claims', () => {
  const r = reviewedLedger.find(entry => entry.ccn === '490032');
  assert.ok(r);
  assert.equal(r.action, 'replace');
  assert.equal(r.evidence.location_name, 'VCU Medical Center');
  assert.equal(r.evidence.declared_location_name, 'VCU Medical Center');
  assert.equal(r.evidence.declared_hospital_name, 'VIRGINIA COMMONWEALTH UNIVERSITY HEALTH SYSTEM AUTHORITY');
  assert.equal(new Set(r.evidence.declared_address.split('|').map(v => v.trim())).size, 1);
  assert.equal(r.evidence.roster_zip, '23298');
  assert.equal(r.evidence.publisher_file_zip, '23219');
  assert.equal(r.evidence.declared_license_state, 'VA');
  assert.equal(r.evidence.completeFileValidated, false);
  assert.match(r.note, /not fully validated/);
  const result = applyResolutions([r.base], [], [], [r]);
  assert.equal(result.compliance[0].finding, 'compliant-observed');
  assert.equal(result.compliance[0].mrf_url, r.evidence.url);
  assert.equal(result.history[r.ccn].finding, 'not-assessed-site-unreachable');
});
test('Providence Sacred Heart uses the exact CCN campus and retains roster ZIP variant', () => {
  const r = reviewedLedger.find(entry => entry.ccn === '500054');
  assert.ok(r);
  assert.equal(r.action, 'replace');
  assert.equal(r.evidence.declared_location_name,
    "Providence Sacred Heart Medical Center and Children's Hospital");
  assert.equal(r.evidence.declared_address, '101 W 8th Ave, Spokane, WA 99204');
  assert.equal(r.evidence.roster_zip, '99220');
  assert.equal(r.evidence.publisher_zip, '99204');
  assert.equal(r.evidence.declared_license_state, 'WA');
  assert.equal(r.evidence.date, '2026-04-01');
  assert.equal(r.evidence.completeFileValidated, false);
  assert.match(r.note, /219 MB file was sampled/);
  const result = applyResolutions([r.base], [], [], [r]);
  assert.equal(result.compliance[0].finding, 'compliant-observed');
  assert.equal(result.compliance[0].mrf_url, r.evidence.url);
  assert.equal(result.history[r.ccn].finding, 'not-assessed-not-named-in-file');
});
test('Broussard recovery retains exact-site evidence and publisher spelling errors', () => {
  const r = reviewedLedger.find(entry => entry.ccn === '194073');
  assert.ok(r);
  assert.equal(r.action, 'replace');
  assert.equal(r.evidence.location_name, 'Ochsner Behavioral Health Acadiana - Broussard');
  assert.match(r.evidence.url, /Acadiana-Broussard_standardcharges-1\.csv$/);
  assert.doesNotMatch(r.evidence.url, /Acadiana-Lafayette/i);
  assert.equal(r.evidence.declared_hospital_name, 'Oshsner Behavioral Health Acadiana-Broussard');
  assert.equal(r.evidence.declared_address, '420 Albertson Parkway; Broussard, LA 70518');
  assert.match(r.note, /Albertsons Parkway/);
  const result = applyResolutions([r.base], [], [], [r]);
  assert.equal(result.compliance[0].mrf_url, r.evidence.url);
  assert.equal(result.compliance[0].finding, 'compliant-observed');
});
test('Perimeter New Orleans recovery retains Lake Pines alias and street suffix conflict', () => {
  const r = reviewedLedger.find(entry => entry.ccn === '194113');
  assert.ok(r);
  assert.equal(r.action, 'replace');
  assert.match(r.evidence.url, /\/new-orleans\/475441649_Lake-Pines-Hospital_standardcharges\.csv$/);
  assert.equal(r.evidence.declared_hospital_name, 'Lake Pines Hospital, LLC');
  assert.equal(r.evidence.declared_address, '3639 Loyola Drive, Kenner LA 70065');
  assert.match(r.note, /Loyola Avenue/);
  assert.match(r.evidence.stateFormerNameUrl, /^https:\/\/ldh\.la\.gov\//);
  const result = applyResolutions([r.base], [], [], [r]);
  assert.equal(result.compliance[0].mrf_url, r.evidence.url);
  assert.equal(result.compliance[0].finding, 'compliant-observed');
});
test('Macungie replaces the rejected Dickson City candidate with its dedicated pointer target', () => {
  const r = reviewedLedger.find(entry => entry.ccn === '390430');
  assert.ok(r);
  assert.equal(r.action, 'replace');
  assert.match(r.evidence.url, /\/lvhn\/Macungie$/);
  assert.match(r.evidence.sourcePageFileUrl, /\/lvhn\/macungie$/);
  assert.equal(r.evidence.declared_address, '3369 Route 100, Macungie PA 18062');
  assert.equal(r.evidence.declared_license_state, 'PA');
  assert.equal(r.evidence.date, '2026-07-01');
  assert.equal(r.evidence.version, '3.0.0');
  assert.equal(r.proof_role, 'rejected-prior-dickson-city-file');
  assert.match(r.proof.mrf_url, /\/lvhn\/dicksoncity$/);
  assert.equal(r.superseded_resolutions[0].action, 'quarantine');
  const result = applyResolutions([r.base], [], [], [r]);
  assert.equal(result.compliance[0].mrf_url, r.evidence.url);
  assert.equal(result.compliance[0].finding, 'compliant-observed');
});
test('Stonewall Jackson alias resolves only to the exact Rockbridge pointer and campus', () => {
  const r = reviewedLedger.find(entry => entry.ccn === '491304');
  assert.ok(r);
  assert.equal(r.action, 'replace');
  assert.match(r.evidence.renamePageUrl, /stonewall-jackson-hospital/);
  assert.match(r.evidence.url, /Carilion-Rockbridge-Community-Hospital_StandardCharges\.csv$/);
  assert.equal(r.evidence.declared_address, '1 Health Cir Lexington VA  24450');
  assert.equal(r.evidence.declared_license_state, 'VA');
  assert.equal(r.evidence.reportedFileBytes, 42817286);
  const result = applyResolutions([r.base], [], [], [r]);
  assert.equal(result.compliance[0].mrf_url, r.evidence.url);
  assert.equal(result.compliance[0].finding, 'compliant-observed');
});
test('McLeod Pee Dee resolves to the exact Florence campus despite abbreviated file location', () => {
  const r = reviewedLedger.find(entry => entry.ccn === '420051');
  assert.ok(r);
  assert.equal(r.action, 'replace');
  assert.match(r.evidence.url, /mcleod-regional-medical-center_standardcharges\.csv$/);
  assert.equal(r.evidence.declared_location_name, 'McLeod Health MRMC');
  assert.equal(r.evidence.declared_address, '555 East Cheves Street, Florence, SC 29506');
  assert.equal(r.evidence.declared_license_state, 'SC');
  assert.match(r.note, /Box 8700/);
  const result = applyResolutions([r.base], [], [], [r]);
  assert.equal(result.compliance[0].mrf_url, r.evidence.url);
  assert.equal(result.compliance[0].finding, 'compliant-observed');
});
test('West Jersey roster name resolves only to the Voorhees location in the shared legal-entity file', () => {
  const r = reviewedLedger.find(entry => entry.ccn === '310022');
  assert.ok(r);
  assert.equal(r.action, 'replace');
  assert.match(r.evidence.url, /Virtua-West-Jersey-Health-System-Inc_standardcharges\.csv$/);
  assert.equal(r.evidence.declared_location_name.trim(), 'Virtua Voorhees Hospital');
  assert.equal(r.evidence.declared_address, '100_Bowman_Drive_Voorhees_NJ_08043');
  assert.equal(r.evidence.declared_license_state, 'NJ');
  assert.equal(r.evidence.date, '2026-06-01');
  assert.equal(r.evidence.version, '3.0.0');
  assert.match(r.note, /Marlton/);
  const result = applyResolutions([r.base], [], [], [r]);
  assert.equal(result.compliance[0].mrf_url, r.evidence.url);
  assert.equal(result.compliance[0].finding, 'compliant-observed');
});
test('reviewed replacement updates the view while preserving original evidence', () => {
  const result = applyResolutions([base], [base], [{ ccn: base.ccn }], [resolution]);
  assert.equal(result.compliance[0].mrf_url, resolution.evidence.url);
  assert.equal(result.history[base.ccn].mrf_url, base.mrf_url);
  assert.equal(base.finding, 'mrf-url-unreachable');
  assert.equal(result.gaps.length, 0);
});
test('an old resolution cannot override a changed subsequent crawl', () => {
  const newer = { ...base, checked_at: '2026-09-10T00:00:00Z' };
  const result = applyResolutions([newer], [], [], [resolution]);
  assert.deepEqual(result.compliance, [newer]);
  assert.equal(result.applied.length, 0);
});
test('quarantine removes current file links and date while retaining the old event', () => {
  const result = applyResolutions([base], [base], [], [{ ccn: base.ccn, base, action: 'quarantine', reviewed_at: '2026-09-09', note: 'Wrong hospital' }]);
  assert.equal(result.compliance[0].mrf_url, '');
  assert.equal(result.manifest.length, 0);
  assert.equal(result.history[base.ccn].mrf_url, base.mrf_url);
});
test('dated official closure evidence removes a closed facility from active review without calling it federal', () => {
  const evidence = { closureDate: '2025-08-01', checked_at: '2026-09-15T00:00:00Z', officialSources: ['https://hospital.test/'] };
  const result = applyResolutions([base], [base], [base], [{ ccn: base.ccn, base, action: 'exempt-closed', evidence,
    official: { domain: 'hospital.test' }, reviewed_at: evidence.checked_at, note: 'Hospital ceased operations.' }]);
  assert.equal(result.compliance[0].finding, 'not-applicable-closed');
  assert.equal(result.compliance[0].assessable, 'no');
  assert.equal(result.compliance[0].domain, 'hospital.test');
  assert.equal(result.manifest.length, 0);
  assert.equal(result.gaps.length, 0);
});
test('closed-facility exemption requires dated official evidence', () => {
  assert.throws(() => applyResolutions([base], [base], [], [{ ccn: base.ccn, base, action: 'exempt-closed',
    evidence: { checked_at: '2026-09-15' }, reviewed_at: '2026-09-15', note: 'Closed' }]), /closure evidence/);
});
test('missing identity or pointer evidence prevents replacement', () => {
  assert.throws(() => applyResolutions([base], [], [], [{ ...resolution, evidence: { ...resolution.evidence, identity: 'review' } }]), /lacks current/);
  assert.throws(() => applyResolutions([base], [], [], [{ ...resolution, evidence: { ...resolution.evidence, pointerUrl: '' } }]), /lacks current/);
});

test('reviewed publisher observations require matching stale or old-version metadata', () => {
  const stale = { ...resolution, action: 'replace-observation', evidence: { ...resolution.evidence,
    date: '2025-01-01', version: '3.0.0', observedFinding: 'mrf-stale-over-365-days' } };
  const result = applyResolutions([base], [], [], [stale]);
  assert.equal(result.compliance[0].finding, 'mrf-stale-over-365-days');
  assert.equal(result.compliance[0].assessable, 'yes');
  assert.throws(() => applyResolutions([base], [], [], [{ ...stale, evidence: { ...stale.evidence,
    date: '2026-09-01' } }]), /lacks current/);
});

test('a current custom workbook may record unresolved template status without inventing a version', () => {
  const custom = { ...resolution, action: 'replace-observation', evidence: { ...resolution.evidence,
    date: '', generation_date: '2026-03-26', version: '', file_kind: 'xlsx',
    fileSha256: 'a'.repeat(64), bytesRetained: 1018292,
    schema_status: 'cms-template-not-declared-custom-workbook', observedFinding: 'mrf-custom-workbook-metadata-unverified' } };
  const result = applyResolutions([base], [], [], [custom]);
  assert.equal(result.compliance[0].finding, 'mrf-custom-workbook-metadata-unverified');
  assert.equal(result.compliance[0].mrf_last_updated, '');
  assert.equal(result.compliance[0].mrf_days_since_update, '');
  assert.equal(result.compliance[0].cms_template_version, '');
  assert.equal(result.manifest[0].mrf_date_source, '');
  assert.throws(() => applyResolutions([base], [], [], [{ ...custom,
    evidence: { ...custom.evidence, schema_status: '' } }]), /lacks current/);
  assert.throws(() => applyResolutions([base], [], [], [{ ...custom,
    evidence: { ...custom.evidence, fileSha256: '' } }]), /lacks current/);
});
test('Claiborne ledger keeps the workbook generation date separate from MRF metadata', () => {
  const reviewed = reviewedLedger.find(entry => entry.ccn === '190114');
  assert.equal(reviewed.evidence.generation_date, '2026-03-26');
  assert.equal(reviewed.evidence.date, '');
  assert.equal(reviewed.evidence.version, '');
  assert.equal(reviewed.evidence.fileSha256, 'f88260ae44800f4e6e34d42a0ade3ebc2fe1d14c596c8100e7c9ab1d74ac175a');
  const applied = applyResolutions([reviewed.base], [], [], [reviewed]);
  assert.equal(applied.compliance[0].finding, 'mrf-custom-workbook-metadata-unverified');
  assert.equal(applied.compliance[0].mrf_last_updated, '');
  assert.equal(applied.compliance[0].cms_template_version, '');
});

test('reviewed observation can retain a current file while recording a misspelled pointer URL field', () => {
  const evidence = { identity: 'corroborated', pointerUrl: 'https://example.org/cms-hpt.txt', pointerSha256: 'abc',
    url: 'https://files.example.org/current.zip', http_status: 206, checked_at: '2026-09-15T00:00:00Z',
    date: '2026-03-31', version: '3.0.0', observedFinding: 'pointer-lists-no-mrf-url', pointerIssue: 'misspelled-mfr-url' };
  const result = applyResolutions([base], [base], [], [{ ccn: base.ccn, base, action: 'replace-observation', evidence,
    reviewed_at: evidence.checked_at, note: 'Pointer uses mfr-url.' }]);
  assert.equal(result.compliance[0].finding, 'pointer-lists-no-mrf-url');
  assert.equal(result.compliance[0].mrf_url, evidence.url);
});

test('reviewed observation can retain a current file when the pointer omits the mrf-url label', () => {
  const omitted = { ccn: base.ccn, base, action: 'replace-observation', evidence: { ...resolution.evidence,
    observedFinding: 'pointer-lists-no-mrf-url', pointerIssue: 'omitted-mrf-url-label' } };
  const result = applyResolutions([base], [], [], [omitted]).compliance[0];
  assert.equal(result.finding, 'pointer-lists-no-mrf-url');
  assert.equal(result.mrf_url, omitted.evidence.url);
});

test('reviewed observation can retain a current source-page file while recording an older pointer file', () => {
  const evidence = { ...resolution.evidence, observedFinding: 'pointer-links-older-mrf-than-source-page',
    pointerIssue: 'pointer-and-current-source-page-mrf-differ', pointerMrfUrl: 'https://hospital.test/older.csv' };
  const result = applyResolutions([base], [], [], [{ ccn: base.ccn, base, action: 'replace-observation', evidence,
    reviewed_at: evidence.checked_at, note: 'Current official page and pointer differ.' }]).compliance[0];
  assert.equal(result.finding, 'pointer-links-older-mrf-than-source-page');
  assert.equal(result.mrf_url, evidence.url);
});

test('different-facility pointer file requires both byte-backed identities and a separate page file', () => {
  const evidence = { ...resolution.evidence,
    observedFinding: 'pointer-links-different-facility-mrf-source-page-file',
    pointerIssue: 'pointer-file-identifies-different-facility',
    pointerMrfUrl: 'https://hospital.test/other-campus.csv', pointerMrfHttpStatus: 206,
    pointerMrfSha256: 'a'.repeat(64), pointerMrfDeclaredAddress: '1 Other St',
    facility_address: '2 This St', declared_address: '2 This St',
    identityPageUrl: 'https://hospital.test/this-campus', identityPageSha256: 'b'.repeat(64),
    sourcePageUrl: 'https://hospital.test/prices', sourcePageSha256: 'c'.repeat(64) };
  const reviewed = { ccn: base.ccn, base, action: 'replace-observation', evidence,
    reviewed_at: evidence.checked_at, note: 'Pointer names another campus.' };
  const row = applyResolutions([base], [], [], [reviewed]).compliance[0];
  assert.equal(row.finding, evidence.observedFinding);
  assert.equal(row.mrf_url, evidence.url);
  assert.throws(() => applyResolutions([base], [], [], [{ ...reviewed,
    evidence: { ...evidence, pointerMrfDeclaredAddress: evidence.facility_address } }]), /lacks current/);
  assert.throws(() => applyResolutions([base], [], [], [{ ...reviewed,
    evidence: { ...evidence, pointerMrfSha256: '' } }]), /lacks current/);
});

test('reviewed observation can retain a current source-page file when the pointer-declared file is unavailable', () => {
  const evidence = { ...resolution.evidence,
    observedFinding: 'pointer-links-unavailable-mrf-source-page-current-file',
    pointerIssue: 'pointer-mrf-http-error-current-source-page-file',
    pointerMrfUrl: 'https://hospital.test/broken.csv', pointerMrfHttpStatus: 404 };
  const reviewed = { ccn: base.ccn, base, action: 'replace-observation', evidence,
    reviewed_at: evidence.checked_at, note: 'Current source-page file; pointer file unavailable.' };
  assert.equal(applyResolutions([base], [], [], [reviewed]).compliance[0].finding,
    'pointer-links-unavailable-mrf-source-page-current-file');
  assert.throws(() => applyResolutions([base], [], [], [{ ...reviewed,
    evidence: { ...evidence, pointerMrfHttpStatus: 200 } }]), /lacks current/);
});

test('reviewed observation can retain a file exposed by an HTML pointer target', () => {
  const evidence = { ...resolution.evidence, date: '2025-02-19', version: '2.0.0',
    observedFinding: 'pointer-links-html-download-page-with-file',
    pointerIssue: 'mrf-url-resolves-html-page-linking-file',
    pointerMrfUrl: 'https://hospital.test/prices/', pointerMrfHttpStatus: 200 };
  const reviewed = { ccn: base.ccn, base, action: 'replace-observation', evidence,
    reviewed_at: evidence.checked_at, note: 'Pointer target is HTML and links the retained file.' };
  const applied = applyResolutions([base], [], [], [reviewed]);
  assert.equal(applied.compliance[0].finding, 'pointer-links-html-download-page-with-file');
  assert.equal(applied.manifest[0].pointer_via, 'reviewed-indirect');
  assert.equal(applied.manifest[0].match_method, 'reviewed-header-and-indirect-pointer-chain');
  assert.throws(() => applyResolutions([base], [], [], [{ ...reviewed,
    evidence: { ...evidence, pointerMrfHttpStatus: 404 } }]), /lacks current/);
  const current = { ...reviewed, evidence: { ...evidence, date: '2026-03-23', version: '3.0.0' } };
  assert.equal(applyResolutions([base], [], [], [current]).compliance[0].finding,
    'pointer-links-html-download-page-with-file');
});

test('rendered pointer portal not-found does not become a working file intermediary', () => {
  const evidence = { ...resolution.evidence,
    observedFinding: 'pointer-html-portal-not-found-source-page-current-file',
    pointerIssue: 'pointer-html-portal-renders-not-found',
    pointerMrfUrl: 'https://portal.test/standard-charges', pointerMrfHttpStatus: 206,
    browserPortalFinalUrl: 'https://portal.test/not-found', browserPortalObservedAt: '2026-09-16T09:01:57Z',
    sourcePageUrl: 'https://hospital.test/pricing', sourcePageSha256: 'a'.repeat(64) };
  const reviewed = { ccn: base.ccn, base, action: 'replace-observation', evidence,
    reviewed_at: evidence.checked_at, note: 'The browser-rendered portal is not found; a first-party page links the file.' };
  assert.equal(applyResolutions([base], [], [], [reviewed]).compliance[0].finding,
    'pointer-html-portal-not-found-source-page-current-file');
  assert.throws(() => applyResolutions([base], [], [], [{ ...reviewed,
    evidence: { ...evidence, browserPortalFinalUrl: '' } }]), /lacks current/);
});

test('file-like pointer URL rendering not-found retains separate first-party current file', () => {
  const evidence = { ...resolution.evidence,
    observedFinding: 'pointer-file-url-renders-not-found-source-page-current-file',
    pointerIssue: 'pointer-file-like-url-renders-not-found',
    pointerMrfUrl: 'https://hospital.test/old.csv', pointerMrfHttpStatus: 200,
    browserPointerTargetFinalUrl: 'https://hospital.test/old.csv',
    browserPointerTargetObservedAt: '2026-09-16T09:28:19Z',
    browserPointerTargetHeading: '404 - Page Not Found',
    sourcePageUrl: 'https://hospital.test/pricing', sourcePageSha256: 'a'.repeat(64) };
  const reviewed = { ccn: base.ccn, base, action: 'replace-observation', evidence,
    reviewed_at: evidence.checked_at, note: 'File-like URL rendered not found; pricing page links the file.' };
  assert.equal(applyResolutions([base], [], [], [reviewed]).compliance[0].finding,
    'pointer-file-url-renders-not-found-source-page-current-file');
  assert.throws(() => applyResolutions([base], [], [], [{ ...reviewed,
    evidence: { ...evidence, browserPointerTargetHeading: '' } }]), /lacks current/);
});

test('reviewed observation can retain a current source-page file while recording an unavailable root pointer', () => {
  const evidence = { ...resolution.evidence, observedFinding: 'official-page-mrf-root-pointer-unavailable',
    pointerIssue: 'root-pointer-http-error', pointerHttpStatus: 400 };
  const result = applyResolutions([base], [], [], [{ ccn: base.ccn, base, action: 'replace-observation', evidence,
    reviewed_at: evidence.checked_at, note: 'Current official page file; root pointer returned an error.' }]).compliance[0];
  assert.equal(result.finding, 'official-page-mrf-root-pointer-unavailable');
  assert.equal(result.mrf_url, evidence.url);
  assert.throws(() => applyResolutions([base], [], [], [{ ccn: base.ccn, base, action: 'replace-observation',
    evidence: { ...evidence, pointerHttpStatus: 200 }, reviewed_at: evidence.checked_at, note: 'Unsupported.' }]), /lacks current/);
});

test('HTML at the root pointer path remains distinct from a working plain-text pointer', () => {
  const evidence = { ...resolution.evidence,
    observedFinding: 'root-pointer-html-page-with-official-page-file',
    pointerIssue: 'root-path-serves-html-page', pointerHttpStatus: 200,
    pointerContentType: 'text/html; charset=UTF-8',
    sourcePageUrl: 'https://example.org/prices', sourcePageSha256: 'a'.repeat(64) };
  const reviewed = { ccn: base.ccn, base, action: 'replace-observation', evidence,
    reviewed_at: evidence.checked_at, note: 'HTML root; separate page file.' };
  assert.equal(applyResolutions([base], [], [], [reviewed]).compliance[0].finding,
    'root-pointer-html-page-with-official-page-file');
  assert.throws(() => applyResolutions([base], [], [], [{ ...reviewed,
    evidence: { ...evidence, pointerContentType: 'text/plain' } }]), /lacks current/);
});

test('an externally hosted pointer does not replace an explicitly verified hospital domain', () => {
  const r = { ...resolution, evidence: { ...resolution.evidence, pointerUrl: 'https://cdn.example.org/cms-hpt.txt', officialDomain: base.domain } };
  const result = applyResolutions([base], [], [], [r]);
  assert.equal(result.compliance[0].domain, base.domain);
  assert.equal(result.compliance[0].pointer_url, r.evidence.pointerUrl);
});

test('domain observations refine only unresolved presentation without assigning evidence URLs', () => {
  const unresolved = { ccn: '010002', finding: 'not-assessed-domain-unknown', assessable: 'no',
    domain: '', pointer_url: '', mrf_url: '', evidence: 'nothing checked', checked_at: '' };
  const settled = { ...unresolved, ccn: '010003', finding: 'compliant-observed', domain: 'settled.test' };
  const observations = [{ ccn: '010002', observation: 'site-observed',
    checked_at: '2026-09-03T00:00:00Z', evidence: 'Candidate homepage matched; pointer unverified.' },
  { ccn: '010003', observation: 'candidate-found', checked_at: '2026-09-03T00:00:00Z', evidence: 'lead only' }];
  const rows = applyDomainObservations([unresolved, settled], observations);
  assert.equal(rows[0].finding, 'not-assessed-site-observed');
  assert.equal(rows[0].domain, '');
  assert.equal(rows[0].pointer_url, '');
  assert.equal(rows[0].mrf_url, '');
  assert.equal(rows[0].assessable, 'no');
  assert.equal(rows[1].finding, 'compliant-observed');
});

test('domain observations reject duplicate and unknown statuses', () => {
  assert.throws(() => applyDomainObservations([], [
    { ccn: '1', observation: 'candidate-found' }, { ccn: '1', observation: 'candidate-found' }
  ]), /Duplicate domain observation/);
  assert.throws(() => applyDomainObservations([], [{ ccn: '1', observation: 'made-up' }]),
    /Unknown domain observation/);
});

test('domain observations cannot override newer dates, assigned URLs, or changed crawl fingerprints', () => {
  const row = { ccn: '010002', finding: 'not-assessed-domain-unknown', checked_at: '2026-09-14T00:00:00Z' };
  const observation = { ccn: row.ccn, observation: 'candidate-found', checked_at: '2026-09-06T00:00:00Z', evidence: 'Old search' };
  assert.deepEqual(applyDomainObservations([row], [observation]), [row]);
  const assigned = { ...row, checked_at: '', domain: 'hospital.test' };
  assert.deepEqual(applyDomainObservations([assigned], [observation]), [assigned]);
  const changed = { ...row, checked_at: '' };
  assert.deepEqual(applyDomainObservations([changed], [{ ...observation, base_sha256: 'wrong' }]), [changed]);
});

test('reviewed observation records a file license-state field conflicting with the facility state', () => {
  const current = { ...base, ccn: '010035', finding: 'compliant-observed' };
  const evidence = {
    identity: 'corroborated', pointerUrl: current.pointer_url, pointerSha256: 'verified-body-hash',
    url: current.mrf_url, http_status: 206, checked_at: '2026-09-15T12:00:00Z',
    date: '2026-01-19', version: '3.0.0', observedFinding: 'mrf-license-state-field-conflicts-facility',
    declared_license_state: 'CA', facility_state: 'AL'
  };
  const result = applyResolutions([current], [], [], [{ ccn: current.ccn, base: current,
    action: 'replace-observation', evidence, note: 'state conflict' }]);
  assert.equal(result.compliance[0].finding, 'mrf-license-state-field-conflicts-facility');
});

test('license-state field conflict remains explicit on a current older-template file', () => {
  const current = { ...base, ccn: '260057', finding: 'not-assessed-domain-unknown', pointer_url: '', mrf_url: '' };
  const evidence = {
    identity: 'corroborated', pointerUrl: 'https://hospital.test/cms-hpt.txt', pointerSha256: 'verified-body-hash',
    url: 'https://hospital.test/current.csv', http_status: 206, checked_at: '2026-09-15T12:00:00Z',
    date: '2026-04-01', version: '2.0.0', observedFinding: 'mrf-license-state-field-conflicts-facility',
    declared_license_state: 'IN', license_value_state: 'MO', facility_state: 'MO'
  };
  const result = applyResolutions([current], [], [], [{ ccn: current.ccn, base: current,
    action: 'replace-observation', evidence, note: 'header and value state conflict' }]);
  assert.equal(result.compliance[0].finding, 'mrf-license-state-field-conflicts-facility');
  assert.equal(result.compliance[0].cms_template_version, '2.0.0');
});
test('Trumbull, Quail Creek and Clear Lake retain exact files while exposing license-state conflicts', () => {
  for (const ccn of ['360055', '450875', '454151']) {
    const reviewed = reviewedLedger.find(entry => entry.ccn === ccn);
    assert.equal(reviewed.action, 'replace-observation');
    assert.equal(reviewed.evidence.observedFinding, 'mrf-license-state-field-conflicts-facility');
    assert.notEqual(reviewed.evidence.declared_license_state, reviewed.evidence.facility_state);
    assert.equal(reviewed.base.mrf_url, reviewed.evidence.url);
    const result = applyResolutions([reviewed.base], [], [], [reviewed]);
    assert.equal(result.compliance[0].finding, 'mrf-license-state-field-conflicts-facility');
    assert.equal(result.compliance[0].mrf_url, reviewed.base.mrf_url);
  }
});
test('River Falls keeps the named pointer file but exposes its wrong hospital street and license state', () => {
  const reviewed = reviewedLedger.find(entry => entry.ccn === '521349');
  assert.equal(reviewed.evidence.observedFinding, 'mrf-address-field-conflicts-facility');
  assert.equal(reviewed.evidence.declared_address, '1617 E Division St, River Falls, WI 54022');
  assert.equal(reviewed.evidence.facility_address, '1629 E Division St, River Falls, WI 54022');
  assert.equal(reviewed.evidence.declared_license_state, 'MN');
  assert.equal(reviewed.evidence.facility_state, 'WI');
  const result = applyResolutions([reviewed.base], [], [], [reviewed]);
  assert.equal(result.compliance[0].finding, 'mrf-address-field-conflicts-facility');
  assert.equal(result.compliance[0].mrf_url, reviewed.base.mrf_url);
});
test('Methodist North refresh preserves CCN relationship and current Tennessee file header', () => {
  const reviewed = reviewedLedger.find(entry => entry.ccn === '440049');
  assert.equal(reviewed.evidence.declared_hospital_name, 'METHODIST NORTH HOSPITAL');
  assert.equal(reviewed.evidence.declared_license_state, 'TN');
  assert.match(reviewed.evidence.relationshipAuthorityUrl, /govinfo\.gov/);
  assert.match(reviewed.note, /older nationwide header observation said MS/);
  const result = applyResolutions([reviewed.base], [], [], [reviewed]);
  assert.equal(result.compliance[0].finding, 'compliant-observed');
  assert.equal(result.compliance[0].mrf_url, reviewed.base.mrf_url);
});
test('Lourdes shared file retains two distinct pointer entries and CCN-specific conflicts', () => {
  const pasco = reviewedLedger.find(entry => entry.ccn === '501337');
  const richland = reviewedLedger.find(entry => entry.ccn === '504008');
  assert.equal(pasco.evidence.url, richland.evidence.url);
  assert.equal(pasco.evidence.pointerSha256, richland.evidence.pointerSha256);
  assert.notEqual(pasco.evidence.location_name, richland.evidence.location_name);
  assert.equal(pasco.evidence.observedFinding, 'mrf-license-state-field-conflicts-facility');
  assert.equal(richland.evidence.observedFinding, 'mrf-address-field-conflicts-facility');
  assert.equal(richland.evidence.declared_address, '1175 Carondelet Dr Richland WA 99352');
  assert.equal(richland.evidence.facility_address, '1175 Carondelet Dr Richland WA 99354');
  for (const reviewed of [pasco, richland]) {
    const result = applyResolutions([reviewed.base], [], [], [reviewed]);
    assert.equal(result.compliance[0].finding, reviewed.evidence.observedFinding);
    assert.equal(result.compliance[0].mrf_url, reviewed.base.mrf_url);
  }
});

test('version 4 is reviewed as noncanonical, never described as an older template', () => {
  const current = { ...base, ccn: '271314', finding: 'old-template-version', cms_template_version: '4.0.0' };
  const evidence = { identity: 'corroborated', pointerUrl: current.pointer_url,
    pointerSha256: 'verified-body-hash', url: current.mrf_url, http_status: 206,
    checked_at: '2026-09-16T12:00:00Z', date: '2026-01-01', version: '4.0.0',
    expected_version: '3.0.0', observedFinding: 'mrf-template-version-noncanonical' };
  const reviewed = applyResolutions([current], [], [], [{ ccn: current.ccn, base: current,
    action: 'replace-observation', evidence, note: 'literal version review' }]);
  assert.equal(reviewed.compliance[0].finding, 'mrf-template-version-noncanonical');
  const derived = correctTemplateVersionFinding([
    { ...current, ccn: '1', cms_template_version: '4.0.0' },
    { ...current, ccn: '2', cms_template_version: '2.0.0' },
    { ...current, ccn: '3', cms_template_version: 'unresolved-custom-workbook' }
  ]);
  assert.equal(derived[0].finding, 'mrf-template-version-noncanonical');
  assert.equal(derived[1].finding, 'old-template-version');
  assert.equal(derived[2].finding, 'old-template-version');
});

test('reviewed observation records a pointer-linked file address conflicting with the official hospital campus', () => {
  const current = { ...base, ccn: '061319', finding: 'not-assessed-domain-unknown', pointer_url: '', mrf_url: '' };
  const evidence = {
    identity: 'corroborated', pointerUrl: 'https://hospital.test/cms-hpt.txt', pointerSha256: 'verified-body-hash',
    url: 'https://hospital.test/current.csv', http_status: 200, checked_at: '2026-09-15T12:00:00Z',
    date: '2026-06-01', version: '3.0.0', observedFinding: 'mrf-address-field-conflicts-facility',
    declared_address: '822 W 4th St, Leadville, CO 80461', facility_address: '816 W 4TH ST'
  };
  const result = applyResolutions([current], [], [], [{ ccn: current.ccn, base: current,
    action: 'replace-observation', evidence, note: 'campus address conflict' }]);
  assert.equal(result.compliance[0].finding, 'mrf-address-field-conflicts-facility');
});

test('incomplete file address is distinct from a different-campus address', () => {
  const evidence = { ...resolution.evidence, observedFinding: 'mrf-address-field-incomplete',
    declared_address: '1454 N County Road, Carthage IL',
    facility_address: '1454 N County Road 2050, Carthage IL', missing_address_component: '2050',
    fileSha256: 'a'.repeat(64), identityPageSha256: 'b'.repeat(64) };
  const reviewed = { ccn: base.ccn, base, action: 'replace-observation', evidence, note: 'Incomplete street.' };
  assert.equal(applyResolutions([base], [], [], [reviewed]).compliance[0].finding, 'mrf-address-field-incomplete');
  assert.throws(() => applyResolutions([base], [], [], [{ ...reviewed,
    evidence: { ...evidence, missing_address_component: '9999' } }]), /lacks current/);
});

test('exact-pointer changed-file overlays retain the displaced standing row in history', () => {
  const audit = path.resolve(__dirname, '../../../data/hpt-audit');
  const inventory = require('../../../data/hpt-audit/template-version-discrepancies.json');
  const view = loadReviewedView(audit);
  const byCcn = new Map(view.compliance.map(row => [row.ccn, row]));
  const replacements = inventory.records.filter(row => row.review_priority === '2-different-file-replaced-with-exact-pointer-proof');
  assert.equal(replacements.length, 28);
  for (const replacement of replacements) {
    const current = byCcn.get(replacement.ccn);
    const prior = view.history[replacement.ccn];
    assert.equal(current.finding, 'mrf-template-version-noncanonical');
    assert.equal(current.mrf_url, replacement.observed_mrf_url);
    assert.equal(prior.mrf_url, replacement.standing_mrf_url);
    assert.equal(prior.history_source, 'nationwide-overlay');
  }
});

test('matched nationwide replacement keeps cross-state standing files as history', () => {
  const audit = path.resolve(__dirname, '../../../data/hpt-audit');
  const view = loadReviewedView(audit);
  const byCcn = new Map(view.compliance.map(row => [row.ccn, row]));
  for (const [ccn, wrongFile, correctFile, source] of [
    ['060023', 'st-george-regional-hospital', 'st-marys-medical-center', 'reviewed'],
    ['521304', 'gundersen-st-elizabeths', 'gundersen-st-josephs', 'nationwide-overlay'],
    ['521302', 'mayo-clinic-health-system-albert-lea-and-austin', 'mayo-clinic-health-system-osseo', 'nationwide-overlay']
  ]) {
    assert.match(view.history[ccn].mrf_url, new RegExp(wrongFile));
    if (source === 'nationwide-overlay') assert.equal(view.history[ccn].history_source, source);
    assert.match(byCcn.get(ccn).mrf_url, new RegExp(correctFile));
    assert.notEqual(view.history[ccn].mrf_url, byCcn.get(ccn).mrf_url);
  }
  assert.equal(byCcn.get('060023').domain, 'intermountainhealthcare.org');
});

test('Conejos exact pointer and page file retain the declared ZIP conflict', () => {
  const audit = path.resolve(__dirname, '../../../data/hpt-audit');
  const proof = require('../../../data/hpt-audit/reconciliation-conejos-page-pointer-file-proof.json');
  const view = loadReviewedView(audit);
  const current = view.compliance.find(row => row.ccn === proof.ccn);
  assert.equal(current.finding, 'mrf-address-field-conflicts-facility');
  assert.equal(current.mrf_url, proof.file_url);
  assert.equal(current.mrf_last_updated, proof.file_header_last_updated_on);
  assert.match(current.evidence, /81101/);
  assert.match(current.evidence, /81140/);
  assert.equal(view.history[proof.ccn].finding, 'not-assessed-not-named-in-file');
  assert.equal(proof.fresh_root_pointer_supplied_structured_bytes, false);
});

test('Sedgwick Memorial resolves through first-party DBA alias and exact-campus file', () => {
  const audit = path.resolve(__dirname, '../../../data/hpt-audit');
  const proof = require('../../../data/hpt-audit/reconciliation-sedgwick-health-center-memorial-proof.json');
  const view = loadReviewedView(audit);
  const current = view.compliance.find(row => row.ccn === proof.ccn);
  assert.equal(current.finding, 'compliant-observed');
  assert.equal(current.domain, 'schealth.org');
  assert.equal(current.pointer_url, proof.root_pointer_url);
  assert.equal(current.mrf_url, proof.file_url);
  assert.equal(current.mrf_last_updated, proof.file_last_updated_on);
  assert.equal(view.history[proof.ccn].finding, 'not-assessed-domain-unknown');
  assert.equal(proof.file_json_parse, 'complete-top-level-json-parse-succeeded');
  assert.equal(proof.file_hospital_address[0], '900 Cedar Street, Julesburg, CO 80737');
});

test('four Ochsner Mississippi campuses keep distinct files and LA field conflicts', () => {
  const audit = path.resolve(__dirname, '../../../data/hpt-audit');
  const proof = require('../../../data/hpt-audit/reconciliation-ochsner-rush-mississippi-license-state-proof.json');
  const view = loadReviewedView(audit);
  const urls = new Set();
  for (const item of proof.records) {
    const current = view.compliance.find(row => row.ccn === item.ccn);
    assert.equal(current.finding, 'mrf-license-state-field-conflicts-facility');
    assert.equal(current.pointer_url, proof.root_pointer_final_url);
    assert.equal(current.mrf_url, item.file_url);
    assert.equal(current.mrf_last_updated, item.declared_last_updated_on);
    assert.match(current.evidence, /LA/);
    assert.match(current.evidence, /Mississippi/);
    assert.equal(view.history[item.ccn].finding, 'not-assessed-not-named-in-file');
    assert.equal(item.declared_license_state_column, 'LA');
    urls.add(current.mrf_url);
  }
  assert.equal(urls.size, 4);
});
