'use strict';

const addressAssert = require('node:assert/strict');
require('node:test')('address equivalence preserves street number and compass direction', () => {
  const { strongAddressAgreement } = require('../lib/mrf-header-match');
  addressAssert.equal(strongAddressAgreement('100 N E SAINT LUKES BOULEVARD', '100 NE Saint Lukes Boulevard Lees Summit MO 64086'), true);
  addressAssert.equal(strongAddressAgreement('5830 N W BARRY ROAD', '5830 NW Barry Road Kansas City MO 64154'), true);
  addressAssert.equal(strongAddressAgreement('ONE HEALTHY WAY', '1 Healthy Way Oceanside NY 11572'), true);
  addressAssert.equal(strongAddressAgreement('ONE GUSTAVE L LEVY PLACE', 'One_Gustave_L_Levy_Place_New_York_NY_10029'), true);
  addressAssert.equal(strongAddressAgreement('100 N E MAIN ROAD', '100 NW Main Road'), false);
  addressAssert.equal(strongAddressAgreement('ONE HEALTHY WAY', '2 Healthy Way'), false);
});

const test = require('node:test');
const assert = require('node:assert/strict');

const { matchMrfHeader, identityName, strongAddressAgreement, corroboratedAddressAgreement } = require('../lib/mrf-header-match');

test('pointer-corroborated address comparison permits formatting omissions but not identity conflicts', () => {
  assert.equal(corroboratedAddressAgreement('1653 TEMPLE AVENUE NORTH', '1653 Temple Avenue, Fayette, AL 35555'), true);
  assert.equal(corroboratedAddressAgreement('TWO ST VINCENT CIRCLE', '2 St. Vincent Circle, Little Rock, AR 72205'), true);
  assert.equal(corroboratedAddressAgreement('15248 11TH ST', '15248 Eleventh Street, Victorville, CA 92395'), true);
  assert.equal(corroboratedAddressAgreement('100 N MAIN ST', '100 South Main Street, Town, AL 12345'), false);
  assert.equal(corroboratedAddressAgreement('778 SCOGIN DRIVE', '788 Scogin Drive, Monticello, AR 71655'), false);
  assert.equal(corroboratedAddressAgreement('508 GREENE STREET', '508 Green Street, Greensboro, AL 36744'), true);
  assert.equal(corroboratedAddressAgreement('6200 NORTH LA CHOLLA BOULEVARD', '6200 N LaCholla Blvd, Tucson, AZ 85741'), true);
  assert.equal(corroboratedAddressAgreement('7353 SISTERS GROVE', '7353 Brothers Grove, Colorado Springs, CO 80923'), false);
  assert.equal(corroboratedAddressAgreement('1550 W CRAIG RANCH', '1550 W Craig Road, Las Vegas, NV 89032'), false);
});

test('relaxed address corroboration requires exact pointer CCN plus city, ZIP and state', () => {
  const hospital = { ccn: '010045', name: 'FAYETTE MEDICAL CENTER', address: '1653 TEMPLE AVENUE NORTH', city: 'FAYETTE', state: 'AL', zip: '35555' };
  const probe = { rangeStatus: 206, mrfLicenseState: 'AL', mrfHospitalName: 'Fayette Medical Center', mrfAddress: '1653 Temple Avenue, Fayette, AL 35555' };
  assert.equal(matchMrfHeader({ refs: [], existingMatchedCcns: new Set(['010045']) }, probe, [hospital]).matches[0].hospital.ccn, '010045');
  assert.equal(matchMrfHeader({ refs: [], existingMatchedCcns: new Set() }, probe, [hospital]).matches.length, 0);
});

test('joined AdventHealth brand is exact across roster spacing only', () => {
  assert.equal(identityName('ADVENT HEALTH POLK'), identityName('AdventHealth Polk'));
  assert.equal(identityName('AdventHealthManchester'), identityName('Adventhealth Manchester'));
  assert.notEqual(identityName('Adventist Health Polk'), identityName('AdventHealth Polk'));
});

test('joined AdventHealth campus can match only with its own street and license state', () => {
  const hospital = { ccn: '180043', name: 'AdventHealthManchester', address: '210 MARIE LANGDON DRIVE',
    city: 'MANCHESTER', state: 'KY', zip: '40962' };
  const probe = { rangeStatus: 206, mrfLicenseState: 'KY', mrfHospitalName: 'Adventhealth Manchester',
    mrfLocationName: 'Adventhealth Manchester', mrfAddress: '210 Marie Langdon Drive, Manchester, KY 40962' };
  const task = { refs: [{ location_name: 'Adventhealth Manchester' }] };
  assert.equal(matchMrfHeader(task, probe, [hospital]).matches[0].hospital.ccn, '180043');
  assert.equal(matchMrfHeader(task, { ...probe, mrfAddress: '211 Marie Langdon Drive, Manchester, KY 40962' }, [hospital]).matches.length, 0);
  assert.equal(matchMrfHeader(task, { ...probe, mrfLicenseState: 'TN' }, [hospital]).matches.length, 0);
});

test('shared HCA branding cannot substitute one named facility for another', () => {
  const result = matchMrfHeader({ refs: [{ location_name: 'HCA Florida Westside Hospital' }] }, {
    rangeStatus: 200, mrfLicenseState: 'FL', mrfHospitalName: 'HCA Florida Westside Hospital',
    mrfAddress: '401 NW 42nd Ave, Plantation FL 33317'
  }, [{ ccn: '100167', name: 'HCA Florida Mercy Hospital', address: '401 NW 42ND AVE', city: 'Plantation', state: 'FL', zip: '33317' }]);
  assert.equal(result.matches.length, 0);
});

test('a ZIP code or another street cannot stand in for a matching street address', () => {
  for (const address of ['20 Other St, Town AL 12345', '12345 Other St, Town AL 99999']) {
    const result = matchMrfHeader({ refs: [] }, { rangeStatus: 200, mrfLicenseState: 'AL',
      mrfHospitalName: 'Example Hospital', mrfAddress: address },
    [{ ccn: '010001', name: 'Example Hospital', address: '12345 Main St', city: 'Town', state: 'AL', zip: '12345' }]);
    assert.equal(result.matches.length, 0);
  }
});

test('exact pointer identity and file street address corroborate a legal-entity header', () => {
  const result = matchMrfHeader({ refs: [{ location_name: 'Example Hospital' }] }, {
    rangeStatus: 200, mrfLicenseState: 'AL', mrfHospitalName: 'County Health Authority',
    mrfAddress: '159 North Third Street, Town AL 12345'
  }, [{ ccn: '010001', name: 'Example Hospital', address: '159 N 3RD ST', city: 'Town', state: 'AL', zip: '12345' }]);
  assert.equal(result.matches[0].hospital.ccn, '010001');
});

test('exact pointer CCN plus file street and license state corroborates a renamed legal-entity header', () => {
  const result = matchMrfHeader({ refs: [{ location_name: 'Health Authority' }], existingMatchedCcns: new Set(['010001']) }, {
    rangeStatus: 206, mrfLicenseState: 'AL', mrfHospitalName: 'County Health Authority',
    mrfAddress: '159 North Third Street, Town AL 12345'
  }, [{ ccn: '010001', name: 'Example Regional Hospital', address: '159 N 3RD ST', city: 'Town', state: 'AL', zip: '12345' }]);
  assert.equal(result.matches[0].hospital.ccn, '010001');
  assert.equal(result.matches[0].identityBasis, 'exact-pointer-ccn-file-street-license-state-agree');
});

test('pointer CCN cannot waive a clinical identity modifier conflict', () => {
  const result = matchMrfHeader({ refs: [], existingMatchedCcns: new Set(['010001']) }, {
    rangeStatus: 206, mrfLicenseState: 'AL', mrfHospitalName: 'Example Rehabilitation Hospital',
    mrfAddress: '159 North Third Street, Town AL 12345'
  }, [{ ccn: '010001', name: 'Example Regional Hospital', address: '159 N 3RD ST', city: 'Town', state: 'AL', zip: '12345' }]);
  assert.equal(result.matches.length, 0);
});

test('duplicate pointer-linked facilities at one address remain review-only', () => {
  const hospitals = [
    { ccn: '010001', name: 'Example Hospital', address: '159 N 3RD ST', city: 'Town', state: 'AL', zip: '12345' },
    { ccn: '010002', name: 'Example Hospital', address: '159 N 3RD ST', city: 'Town', state: 'AL', zip: '12345' }
  ];
  const result = matchMrfHeader({ refs: [], existingMatchedCcns: new Set(['010001', '010002']) }, {
    rangeStatus: 206, mrfLicenseState: 'AL', mrfHospitalName: 'County Health Authority',
    mrfAddress: '159 North Third Street, Town AL 12345'
  }, hospitals);
  assert.equal(result.matches.length, 0);
  assert.deepEqual(result.reviews.map(item => item.hospital.ccn).sort(), ['010001', '010002']);
});

test('MRF headers fuzzy-match a unique hospital using license state and ZIP', () => {
  const task = {
    mrf_url: 'https://files.test/good.csv',
    refs: [{ domain: 'good.test', state: 'AL', location_name: 'Good Regional' }]
  };
  const hospitals = [
    { ccn: '010001', name: 'GOOD REGIONAL HOSPITAL', address: '100 MAIN STREET', city: 'DOTHAN', state: 'AL', zip: '36301' },
    { ccn: '010002', name: 'GOOD REGIONAL HOSPITAL NORTH', address: '200 NORTH STREET', city: 'MOBILE', state: 'AL', zip: '36601' }
  ];
  const matched = matchMrfHeader(task, {
    rangeStatus: 206, mrfLicenseState: 'AL',
    mrfHospitalName: 'Good Regional Hospital Campus',
    mrfAddress: '100 Main Street, Dothan, AL 36301'
  }, hospitals);
  assert.equal(matched.status, 'matched');
  assert.deepEqual(matched.matches.map(row => row.hospital.ccn), ['010001']);
});

test('MRF header name without city, address, or ZIP remains review-only', () => {
  const matched = matchMrfHeader({
    mrf_url: 'https://files.test/mercy.csv', refs: [{ domain: 'mercy.test', location_name: 'Mercy' }]
  }, {
    rangeStatus: 200, mrfLicenseState: 'AL', mrfHospitalName: 'Mercy Hospital'
  }, [{ ccn: '010003', name: 'MERCY HOSPITAL', city: 'NORTHPORT', state: 'AL', zip: '35476' }]);
  assert.equal(matched.status, 'review');
  assert.equal(matched.reviews[0].reviewReason, 'mrf-header-name-without-location');
});

test('exact file name, strong street, and license state can identify a unique facility without city or ZIP', () => {
  const matched = matchMrfHeader({ refs: [] }, {
    rangeStatus: 206, mrfLicenseState: 'OH', mrfHospitalName: 'Fairfield Medical Center',
    mrfAddress: '401 N Ewing St'
  }, [{ ccn: '360072', name: 'FAIRFIELD MEDICAL CENTER', address: '401 NORTH EWING STREET', city: 'LANCASTER', state: 'OH', zip: '43130' }]);
  assert.equal(matched.status, 'matched');
  assert.equal(matched.matches[0].hospital.ccn, '360072');
  assert.equal(matched.matches[0].identityBasis, 'exact-file-name-street-license-state-agree');
});

test('exact file name and street without city or ZIP remain review when roster identity is duplicated', () => {
  const matched = matchMrfHeader({ refs: [] }, {
    rangeStatus: 206, mrfLicenseState: 'MS', mrfHospitalName: 'Neshoba County General Hospital',
    mrfAddress: '1001 Holland Ave'
  }, [
    { ccn: '250043', name: 'NESHOBA COUNTY GENERAL HOSPITAL', address: '1001 HOLLAND AVENUE', city: 'PHILADELPHIA', state: 'MS', zip: '39350' },
    { ccn: '251340', name: 'NESHOBA COUNTY GENERAL HOSPITAL', address: '1001 HOLLAND AVENUE', city: 'PHILADELPHIA', state: 'MS', zip: '39350' }
  ]);
  assert.equal(matched.status, 'review');
  assert.deepEqual(matched.reviews.map(row => row.hospital.ccn).sort(), ['250043', '251340']);
});

test('missing license state can use an exact unique file name, street, city, state, and ZIP', () => {
  const matched = matchMrfHeader({ refs: [{ location_name: 'Prowers Medical Center' }] }, {
    rangeStatus: 206, mrfHospitalName: 'Prowers Medical Center',
    mrfAddress: '401 Kendall Dr. Lamar, CO 81052'
  }, [
    { ccn: '061323', name: 'PROWERS MEDICAL CENTER', address: '401 KENDALL DRIVE', city: 'LAMAR', state: 'CO', zip: '81052' },
    { ccn: '010001', name: 'PROWERS MEDICAL CENTER', address: '401 KENDALL DRIVE', city: 'LAMAR', state: 'AL', zip: '81052' }
  ]);
  assert.equal(matched.status, 'matched');
  assert.equal(matched.matches[0].hospital.ccn, '061323');
  assert.equal(matched.matches[0].identityBasis, 'recorded-file-name-street-state-agree');
});

test('missing license state without an address-state anchor remains review-only', () => {
  const matched = matchMrfHeader({ refs: [] }, {
    rangeStatus: 206, mrfHospitalName: 'Prowers Medical Center', mrfAddress: '401 Kendall Drive'
  }, [{ ccn: '061323', name: 'PROWERS MEDICAL CENTER', address: '401 KENDALL DRIVE', city: 'LAMAR', state: 'CO', zip: '81052' }]);
  assert.equal(matched.status, 'review');
  assert.equal(matched.reason, 'mrf-header-has-no-license-state');
});

test('street and city corroboration survives PO boxes and obsolete mailing ZIPs', () => {
  const task = { refs: [{ location_name: 'Example Hospital' }] };
  const poBox = matchMrfHeader(task, {
    rangeStatus: 200, mrfLicenseState: 'AK', mrfHospitalName: 'Example Hospital',
    mrfAddress: '602 Chase Ave, PO Box 160, Cordova, AK 99574'
  }, [{ ccn: '020001', name: 'EXAMPLE HOSPITAL', address: 'PO BOX 160 - 602 CHASE AVENUE', city: 'CORDOVA', state: 'AK', zip: '99574' }]);
  assert.equal(poBox.matches[0].hospital.ccn, '020001');

  const oldZip = matchMrfHeader(task, {
    rangeStatus: 200, mrfLicenseState: 'AL', mrfHospitalName: 'Example Hospital',
    mrfAddress: '4370 W Main St, Dothan, AL 36305'
  }, [{ ccn: '010001', name: 'EXAMPLE HOSPITAL', address: '4370 WEST MAIN STREET', city: 'DOTHAN', state: 'AL', zip: '36302' }]);
  assert.equal(oldZip.matches[0].hospital.ccn, '010001');
});

test('address corroboration normalizes documented hospital and corporate transcription errors', () => {
  const cases = [
    ['200 HOSPITAL AVE', '200 Hosptial Ave, Jefferson, NC 28640'],
    ['4646 HILTON CORP0RATE DRIVE', '4646 Hilton Corporate Drive, Columbus, OH 43232']
  ];
  for (const [roster, file] of cases) assert.equal(strongAddressAgreement(roster, file), true);
  assert.equal(strongAddressAgreement('200 HOSPITAL AVE', '201 Hosptial Ave, Jefferson, NC 28640'), false);
});

test('address corroboration treats state-route notation and secondary delivery codes as non-identity fields', () => {
  assert.equal(strongAddressAgreement('8885 SR 237', '8885 ST ROAD 237, TELL CITY, IN 47586'), true);
  assert.equal(strongAddressAgreement('1500 E MEDICAL CENTER DRIVE, SPC 5474', '1500 East Medical Center Drive, Ann Arbor, MI 48109'), true);
  assert.equal(strongAddressAgreement('8885 SR 237', '8886 ST ROAD 237, TELL CITY, IN 47586'), false);
});

test('one system MRF header can recover multiple independently located facilities', () => {
  const task = {
    mrf_url: 'https://system.test/all.csv',
    refs: [{ domain: 'system.test', state: 'AL', location_name: 'Example System' }]
  };
  const hospitals = [
    { ccn: '010010', name: 'EXAMPLE NORTH HOSPITAL', address: '1 NORTH ST', city: 'NORTH', state: 'AL', zip: '35001' },
    { ccn: '010011', name: 'EXAMPLE SOUTH HOSPITAL', address: '2 SOUTH ST', city: 'SOUTH', state: 'AL', zip: '35002' }
  ];
  const matched = matchMrfHeader(task, {
    rangeStatus: 206, mrfLicenseState: 'AL', mrfHospitalName: 'Example System',
    mrfLocationName: 'Example North Hospital|Example South Hospital',
    mrfAddress: '1 North St, North, AL 35001|2 South St, South, AL 35002'
  }, hospitals);
  assert.deepEqual(matched.matches.map(row => row.hospital.ccn).sort(), ['010010', '010011']);
});

test('MRF header recovery refuses conflicting VA and rehabilitation identities', () => {
  const task = {
    mrf_url: 'https://files.test/wrong.csv',
    refs: [{ domain: 'wrong.test', state: 'MO', location_name: 'St Lukes Rehabilitation Hospital' }]
  };
  const rehab = matchMrfHeader(task, {
    rangeStatus: 206, mrfLicenseState: 'MO', mrfHospitalName: 'St Lukes Rehabilitation Hospital LLC',
    mrfAddress: '14709 Olive Blvd, Chesterfield, MO 63017'
  }, [{
    ccn: '260179', name: 'ST LUKES HOSPITAL', address: '232 S WOODS MILL RD',
    city: 'CHESTERFIELD', state: 'MO', zip: '63017'
  }]);
  assert.equal(rehab.matches.length, 0);

  const va = matchMrfHeader(task, {
    rangeStatus: 206, mrfLicenseState: 'NY', mrfHospitalName: 'Albany Medical Center Hospital',
    mrfAddress: '43 New Scotland Avenue, Albany, NY 12208'
  }, [{
    ccn: '33009F', name: 'ALBANY VA MEDICAL CENTER', address: '113 HOLLAND AVENUE',
    city: 'ALBANY', state: 'NY', zip: '12208'
  }]);
  assert.equal(va.matches.length, 0);
});
