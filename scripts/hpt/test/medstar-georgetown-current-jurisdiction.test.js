const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const auditDir = path.resolve(__dirname, '../../../data/hpt-audit');
const proof = JSON.parse(fs.readFileSync(path.join(auditDir, 'reconciliation-medstar-georgetown-license-number-jurisdiction-audit-2026-09-27.json'), 'utf8'));
const surveyProof = JSON.parse(fs.readFileSync(path.join(auditDir, 'reconciliation-medstar-georgetown-2026-dc-health-survey-identifier-crosscheck.json'), 'utf8'));
const manual = JSON.parse(fs.readFileSync(path.join(auditDir, 'reconciliation-manual-access-observations.json'), 'utf8'));
const record = manual.records.find(item => item.ccn === '090004');
const browserReviews = JSON.parse(fs.readFileSync(path.join(auditDir, 'nationwide-browser-reviews.json'), 'utf8')).records;
const pageLinkRecheck = JSON.parse(fs.readFileSync(path.join(auditDir,
  'reconciliation-medstar-georgetown-current-pricing-page-link-recheck-2026-09-30.json'), 'utf8'));

test('MedStar Georgetown current DC jurisdiction evidence is hash-bound without resolving the MD suffix conflict', () => {
  assert.equal(proof.ccn, '090004');
  assert.equal(proof.file_sha256, '216bf4e59243abae3daef7843f910ebdb1e1226bc1fc181c4226e4fb07ee09d3');
  const dc = proof.sources.find(source => source.kind === 'current-dc-health-hospital-directory');
  assert.ok(dc, 'current DC Health directory source is retained');
  assert.equal(dc.directory_updated, '2026-09-03');
  assert.equal(dc.http_status, 200);
  assert.equal(dc.bytes, 186422);
  assert.equal(dc.sha256, 'dcc0e318bf8f35c1eb8a6863c6e7c1182113641668a8a7161dd05d586cfa0e05');
  assert.match(dc.entry.facility, /MedStar-Georgetown University Hospital \(Acute Care\)/);
  assert.match(dc.entry.address, /Washington, DC 20007/);
  assert.equal(proof.disposition, 'narrowed-license-metadata-suffix-conflict-retained');
  assert.equal(proof.count_effect, 'none; retain CCN 090004 as unresolved pending publisher correction or explanation of the literal MD suffix');
  const cmsDictionary = proof.sources.find(source => source.kind === 'current-cms-csv-data-dictionary-v3');
  assert.ok(cmsDictionary, 'current CMS v3.0 field semantics are retained');
  assert.equal(cmsDictionary.dictionary_http_status, 200);
  assert.equal(cmsDictionary.dictionary_sha256, '5129da0141428d689f79110a10a95607581ee3bef81fb0d937a6d39a6bf39dcc');
  assert.equal(cmsDictionary.state_codes_sha256, '54fc6f0dd75bc67118f47b536a2ba11a23225cb09fd3969d2b0cd4409840541e');
  assert.equal(cmsDictionary.valid_codes['District of Columbia'], 'DC');
  assert.equal(cmsDictionary.valid_codes.Maryland, 'MD');
  assert.match(cmsDictionary.field_definition, /licensing state or territory's two-letter abbreviation/);
  assert.match(cmsDictionary.limitation, /does not identify this hospital's licensing jurisdiction/);

  const irs = proof.sources.find(source => source.kind === '2024-form-990-schedule-h-filed-with-irs');
  assert.ok(irs, 'IRS Schedule H source is retained');
  assert.equal(irs.irs_index_record.OBJECT_ID, '202611319349300406');
  assert.equal(irs.irs_index_record.XML_BATCH_ID, '2026_TEOS_XML_05A');
  assert.equal(irs.irs_xml_bytes, 191603);
  assert.equal(irs.irs_xml_sha256, 'e4c2dd66427b6f359af20e4bc8d2b5c8c799097e58a08b2af1c22dcb6b2f6474');
  assert.equal(irs.tax_year, 2024);
  assert.equal(irs.schedule_h_facility, 'DBA GEORGETOWN UNIVERSITY HOSPITAL');
  assert.equal(irs.schedule_h_address, '3800 RESERVOIR ROAD NW, WASHINGTON, DC 20007');
  assert.equal(irs.schedule_h_state_license_number, 'HFD01-0188');
  assert.ok(irs.interpretation.includes("does not validate the license beyond the 2024 tax-period report or explain the MRF's literal license_number|MD suffix"));

  assert.equal(surveyProof.ccn, '090004');
  assert.equal(surveyProof.live_listing_recheck_2026_09_29.listed_year, 2026);
  assert.equal(surveyProof.live_listing_recheck_2026_09_29.report_url_unchanged, true);
  assert.match(surveyProof.live_listing_recheck_2026_09_29.classification, /no-new-evidence/);
  assert.match(surveyProof.next_action, /Do not repeat this DC Health report listing unless its page or linked report changes/);
  assert.equal(surveyProof.report.provider_supplier_clia_identification_number, 'HFD01-0188');
  assert.equal(surveyProof.report.facility_address, '3800 RESERVOIR RD, WASHINGTON, DC 20007');
  assert.equal(surveyProof.report.bounded_sample_sha256, 'b83be733ce8688134fa0256428175df8048eb07d0907d83aa9df8e7e0b2e0ca0');
  const completeReport = surveyProof.report.full_document_retrieval_2026_09_29;
  assert.equal(completeReport.http_status, 200);
  assert.equal(completeReport.bytes, 403855);
  assert.equal(completeReport.sha256, '10500bc3d4d54f94398cb5232a3b7d5572b536d9394e4150df5ad1521481c390');
  const retainedReport = path.join(auditDir, completeReport.retained_file);
  assert.equal(fs.statSync(retainedReport).size, completeReport.bytes);
  const retainedHash = require('node:crypto').createHash('sha256').update(fs.readFileSync(retainedReport)).digest('hex');
  assert.equal(retainedHash, completeReport.sha256, 'retained complete official PDF bytes match the proof hash');
  assert.equal(surveyProof.cohort_count_effect, 0);
  assert.equal(surveyProof.disposition, proof.disposition);
  assert.match(surveyProof.evidence_gain, /does not explicitly call it the current state license number/);
  assert.match(surveyProof.evidence_gain, /already present in the audit/);
  assert.equal(surveyProof.cohort_count_effect, 0, 'completing the retained source bytes does not change cohort counts');

  const nested = record.license_number_jurisdiction_audit.current_dc_health_directory;
  assert.equal(nested.sha256, dc.sha256, 'manual observation points to the same source bytes');
  const irsFiling = record.license_number_jurisdiction_audit.irs_filed_2024_schedule_h_xml;
  assert.equal(irsFiling.member_sha256, irs.irs_xml_sha256);
  assert.equal(irsFiling.state_license_number, 'HFD01-0188');
  assert.equal(record.license_number_jurisdiction_audit.current_cms_csv_data_dictionary_v3.dictionary_sha256,
    cmsDictionary.dictionary_sha256);
  assert.ok(record.license_number_jurisdiction_audit.next_action.includes("unresolved only for the MRF's literal license_number|MD state suffix"));
  const currentSurvey = record.license_number_jurisdiction_audit.current_dc_health_2026_licensure_survey_report;
  assert.equal(currentSurvey.provider_supplier_clia_identification_number, 'HFD01-0188');
  assert.match(currentSurvey.result, /does not explicitly call the identifier a current state license number/);
  const browserSurvey = browserReviews.find(item => item.ccn === '090004' && item.kind === 'current-dc-health-licensure-survey-identifier-crosscheck');
  assert.equal(browserSurvey.browser_status, 'navigation-timeout; PDF accessibility tree contained only target URL');
  assert.match(browserSurvey.detail, /No new MRF or price data was observed/);

  assert.equal(pageLinkRecheck.ccn, '090004');
  assert.equal(pageLinkRecheck.current_file_url, proof.file_url);
  assert.equal(pageLinkRecheck.retained_file_sha256, proof.file_sha256);
  assert.equal(pageLinkRecheck.file_navigation_result.includes('no response bytes'), true);
  assert.equal(pageLinkRecheck.count_effect, 'none');
  const pageLinkBrowser = browserReviews.find(item => item.ccn === '090004'
    && item.kind === 'official-pricing-page-link-recheck');
  assert.ok(pageLinkBrowser);
  assert.equal(pageLinkBrowser.mrf_url, proof.file_url);
  assert.equal(pageLinkBrowser.file_sha256, proof.file_sha256);
  assert.equal(pageLinkBrowser.bytes_read, 0);
  assert.match(pageLinkBrowser.status, /same-known-file/);
});
