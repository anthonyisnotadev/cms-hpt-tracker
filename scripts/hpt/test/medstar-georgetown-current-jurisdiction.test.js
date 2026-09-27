const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const auditDir = path.resolve(__dirname, '../../../data/hpt-audit');
const proof = JSON.parse(fs.readFileSync(path.join(auditDir, 'reconciliation-medstar-georgetown-license-number-jurisdiction-audit-2026-09-27.json'), 'utf8'));
const manual = JSON.parse(fs.readFileSync(path.join(auditDir, 'reconciliation-manual-access-observations.json'), 'utf8'));
const record = manual.records.find(item => item.ccn === '090004');

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

  const nested = record.license_number_jurisdiction_audit.current_dc_health_directory;
  assert.equal(nested.sha256, dc.sha256, 'manual observation points to the same source bytes');
  assert.match(record.license_number_jurisdiction_audit.next_action, /Ask MedStar to confirm/);
});
