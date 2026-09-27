const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const observedAt = '2026-09-26T23:45:00Z';
const rows = {
  '050305': ['Alta Bates Summit Medical Center - Alta Bates Camp', 'Alta Bates Summit Medical Center - Alta Bates Camp', '2450 Ashby Avenue, Berkeley, CA 94705'],
  '050055': ['California Pacific Medical Center - Mission Bernal', 'California Pacific Medical Center - Mission Bernal', '3555 Cesar Chavez, San Francisco, CA 94110'],
  '050047': ['California Pacific Medical Center- Van Ness Campus', 'California Pacific Medical Center- Van Ness Campus', '1101 Van Ness Avenue, San Francisco, CA 94109'],
  '050008': ['California Pacific Medical Ctr-Davies Campus Hospital', 'California Pacific Medical Ctr-Davies Campus Hospital', '601 Duboce Avenue, San Francisco, CA 94117'],
  '050488': ['Eden Medical Center', 'Eden Medical Center', '20103 Lake Chabot Road, Castro Valley, CA 94546'],
  '050528': ['Memorial Hospital Los Banos', 'Memorial Hospital Los Banos', '520 West I St, Los Banos, CA 93635'],
  '050557': ['Memorial Medical Center', 'Memorial Medical Center', '1700 Coffee Rd, Modesto, CA 95355'],
  '050131': ['Novato Community Hospital', 'Novato Community Hospital', '180 Rowland Way, Novato, CA 94945'],
  '050007': ['Mills-Peninsula Medical Center', 'Mills-Peninsula Medical Center', '1501 Trousdale Drive, Burlingame, CA 94010'],
  '050014': ['Sutter Amador Hospital', 'Sutter Amador Hospital', '200 Mission Blvd, Jackson, CA 95642'],
  '050498': ['Sutter Auburn Faith Hospital', 'Sutter Auburn Faith Hospital', '11815 Education Street, Auburn, CA 95603'],
  '054096': ['Sutter Center For Psychiatry', 'Sutter Center For Psychiatry', '7700 Folsom Blvd, Sacramento, CA 95826'],
  '050417': ['Sutter Coast Hospital', 'Sutter Coast Hospital', '800 E Washington Blvd, Crescent City, CA 95531'],
  '050537': ['Sutter Davis Hospital', 'Sutter Davis Hospital', '2000 Sutter Place, Davis, CA 95616'],
  '050523': ['Sutter Delta Medical Center', 'Sutter Delta Medical Center', '3901 Lone Tree Way, Antioch, CA 94509'],
  '051329': ['Sutter Lakeside Hospital', 'Sutter Lakeside Hospital', '5176 Hill Road East, Lakeport, CA 95453'],
  '050714': ['Sutter Maternity & Surgery Center of Santa Cruz', 'Sutter Maternity & Surgery Center of Santa Cruz', '2900 Chanticleer Avenue, Santa Cruz, CA 95065'],
  '050108': ['Sutter Medical Center, Sacramento', 'Sutter Medical Center, Sacramento', '2825 Capitol Avenue, Sacramento, CA 95816'],
  '050309': ['Sutter Roseville Medical Center', 'Sutter Roseville Medical Center', 'One Medical Plaza, Roseville, CA 95661'],
  '050291': ['Sutter Santa Rosa Regional Hospital', 'Sutter Santa Rosa Regional Hospital', '30 Mark West Springs Road, Santa Rosa, CA 95403'],
  '050101': ['Sutter Solano Medical Center', 'Sutter Solano Medical Center', '300 Hospital Dr, Vallejo, CA 94589'],
  '050766': ['Sutter Surgical Hospital - North Valley', 'Sutter Surgical Hospital - North Valley', '455 Plumas Blvd, Yuba City, CA 95991'],
  '050313': ['Sutter Tracy Community Hospital', 'Sutter Tracy Community Hospital', '1420 North Tracy Blvd, Tracy, CA 95376']
};

const verification = JSON.parse(fs.readFileSync(path.join(audit, 'nationwide-verification.json'), 'utf8'));
const manualPath = path.join(audit, 'reconciliation-manual-access-observations.json');
const manual = JSON.parse(fs.readFileSync(manualPath, 'utf8'));
const byCcn = new Map(verification.records.map(r => [r.ccn, r]));
for (const [ccn, [name, location, address]] of Object.entries(rows)) {
  const base = byCcn.get(ccn);
  if (!base) throw new Error(`missing verification record ${ccn}`);
  const proofFile = `reconciliation-sutter-${ccn}-current-pointer-proof-2026-09-26.json`;
  const proof = {
    ccn, observed_at: observedAt, official_domain: 'https://www.sutterhealth.org/',
    pointer_url: 'https://www.sutterhealth.org/cms-hpt.txt', pointer_status: 200,
    pointer_declared_mrf_url: base.mrf_url, mrf_url: base.mrf_url, mrf_status: 206,
    declared_hospital_name: name, declared_location_name: location, declared_address: address,
    declared_license_state: 'CA', declared_last_updated: '2026-04-01', cms_template_version: '3.0.0',
    attestation: true, file_kind: 'csv',
    identity_basis: 'Shared official pointer entry and facility-specific CSV header agree on facility name, location, exact street address, California license state, current update date, CMS template, and attestation.',
    next_action: 'Retain as verified current MRF and recheck on the next pointer update.'
  };
  fs.writeFileSync(path.join(audit, proofFile), JSON.stringify(proof, null, 2) + '\n');
  manual.records = manual.records.filter(r => r.ccn !== ccn);
  manual.records.push({ ...proof, proof_file: proofFile, manual_disposition: 'verified-current-mrf', disposition: 'verified-current-mrf', manual_identity_gate: 'official-shared-pointer-facility-csv-exact-name-address-state-date-template-attestation-agree' });
}
manual.records.sort((a, b) => a.ccn.localeCompare(b.ccn));
fs.writeFileSync(manualPath, JSON.stringify(manual, null, 2) + '\n');
console.log(JSON.stringify({ applied: Object.keys(rows), count: Object.keys(rows).length }, null, 2));
