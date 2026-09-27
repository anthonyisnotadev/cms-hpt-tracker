const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const proofName = 'reconciliation-parkview-medical-center-uchealth-cms-hpt-proof-2026-09-23.json';
const auditDir = path.join(root, 'data', 'hpt-audit');
const proof = JSON.parse(fs.readFileSync(path.join(auditDir, proofName), 'utf8'));
const file = path.join(auditDir, 'reconciliation-manual-access-observations.json');
const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
doc.records = doc.records.filter((record) => record.ccn !== proof.ccn);
doc.records.push({ ...proof, proof_file: proofName });
doc.records.sort((a, b) => a.ccn.localeCompare(b.ccn));
fs.writeFileSync(file, JSON.stringify(doc, null, 2) + '\n');
console.log(`Applied ${proof.ccn}: ${proof.disposition}`);
