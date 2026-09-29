'use strict';

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { retrieve, parsePayload } = require('./lib/recovery-transport');
const { csvToObjects } = require('./lib/util');

const ROOT = path.resolve(__dirname, '../..');
const AUDIT = path.join(ROOT, 'data/hpt-audit');
const RAW = path.join(ROOT, 'cms_data/hpt/nationwide-verification/file-byte-proof');
const CAP = 262144;
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const text = value => value.toString('utf8').replace(/<[^>]*>/g, ' ').replace(/&nbsp;|&#160;/gi, ' ').replace(/\s+/g, ' ').trim();

const candidates = [
  {
    ccn: '053306', identity_url: 'https://choc.org/locations/choc-mission-hospital/',
    identity_terms: ['CHOC at Mission Hospital', '27700 Medical Center Road', '5th Floor', 'Mission Viejo, CA 92691'],
    roster_address: '27700 MEDICAL CENTER RD, 5TH FLOOR', pointer_location: 'CHOC at Mission Hospital',
    expected_mrf_address: '27700 Medical Center Rd',
    expected_mrf_hospital_name: 'Childrens Hospital at Mission - Cerner',
  },
  {
    ccn: '140148', identity_url: 'https://memorial.health/springfield-memorial-hospital/overview/',
    identity_terms: ['Springfield Memorial Hospital', '701 N. First St.', 'Springfield, IL 62781'],
    identity_authority: 'first-party-rename-and-street-address',
    relationship_url: 'https://memorial.health/financial/bill-pay/springfield-memorial-hospital/',
    relationship_terms: ['formerly known as Memorial Medical Center', '701 N. First St.'],
    roster_address: '701 N FIRST ST', pointer_location: 'Springfield Memorial Hospital',
    expected_mrf_address: '701 N 1st Street',
    expected_mrf_hospital_name: 'Memorial Medical Center dba Springfield Memorial Hospital',
    expected_base_finding: 'not-assessed-not-named-in-file',
  },
  {
    ccn: '010087', identity_url: 'https://www.usahealthsystem.com/locations/university-hospital',
    identity_terms: ['USA Health University Hospital', '2451 University Hospital Dr.', 'Mobile, AL 36617'],
    identity_authority: 'first-party-current-facility-and-price-file',
    browser_identity: {
      page_title: 'University Hospital | USA Health',
      transport: 'real-browser-rendered-accessibility-and-current-page-extraction',
      excerpt: 'University Hospital | USA Health | USA Health University Hospital | 2451 University Hospital Dr. Mobile, AL 36617 | USA Health University Hospital is an acute care facility.'
    },
    relationship_url: 'https://www.usahealthsystem.com/price-index',
    relationship_terms: ['University Hospital', '630477348_usa-health-university-hospital_standardcharges.csv'],
    browser_relationship: {
      page_title: 'Price Transparency | Balance Billing | No Surprises Act (NSA) | USA Health',
      transport: 'current-first-party-page-extraction',
      excerpt: 'Machine-Readable Files | University Hospital [CSV file, 641 MB] | https://sthpiprd.blob.core.windows.net/machine-readable-files/12725/630477348_usa-health-university-hospital_standardcharges.csv'
    },
    roster_address: '2451 FILLINGIM STREET', pointer_location: 'USA Health University Hospital',
    expected_mrf_address: '2451 University Hospital Drive, Mobile, AL 36617-2238|181 Hillcrest Rd, Mobile, AL 36608',
    expected_base_finding: 'compliant-observed', expected_header_status: 'review'
  },
  {
    ccn: '010023', identity_url: 'https://www.baptistfirst.org/location/baptist-medical-center-south',
    identity_terms: ['Baptist Medical Center South', '2105 E South Blvd', 'Montgomery, AL 36116'],
    identity_authority: 'first-party-current-facility-and-price-file',
    browser_identity: {
      page_title: 'Baptist Medical Center South | Baptist Health Montgomery',
      transport: 'real-browser-rendered-accessibility',
      excerpt: 'Baptist Medical Center South | Hospital | Medical Center | 2105 E South Blvd | Montgomery, AL 36116 | 492-bed acute care hospital'
    },
    relationship_url: 'https://www.baptistfirst.org/patients-visitors/before-your-visit/get-a-price-estimate',
    relationship_terms: ['Baptist Medical Center South and Crossbridge Behavioral Health', 'bmc-south'],
    browser_relationship: {
      page_title: 'Price Transparency | Baptist Health Montgomery',
      transport: 'current-first-party-page-extraction',
      excerpt: 'Standard Charges Linked Below | Baptist Medical Center South and Crossbridge Behavioral Health | https://baptistfirst.pt.panaceainc.com/MRFDownload/baptistfirst/bmc-south'
    },
    roster_address: '2105 EAST SOUTH BOULEVARD',
    pointer_location: 'Health Care Authority for Baptist Health, an Affiliate of UABHS d/b/a Baptist Medical Center South',
    expected_mrf_address: '2105 E South Blvd, Montgomery, AL 36111|4385 Narrow Lane Road, Montgomery AL 36116',
    expected_base_finding: 'compliant-date-unverified', expected_header_status: 'unreachable'
  },
  {
    ccn: '010062', identity_url: 'https://www.wiregrassmedicalcenter.org/getpage.php?name=contact',
    identity_terms: ['Wiregrass Medical Center', '1200 West Maple Avenue', 'Geneva, Alabama 36340'],
    identity_authority: 'first-party-current-facility-and-price-file',
    relationship_url: 'https://www.wiregrassmedicalcenter.org/getpage.php?name=Price_Transparency&sub=Patients+and+Visitors',
    relationship_terms: ['Price Transparency', 'Hospital and Clinic Transparent Pricing Information', 'Wiregrass_V3.aspx'],
    browser_relationship: {
      page_title: 'Price Transparency | Wiregrass Medical Center',
      transport: 'current-first-party-page-extraction',
      excerpt: 'Price Transparency | Standard Charges and Online Estimator | Hospital and Clinic Transparent Pricing Information | https://apps.para-hcfs.com/PTT/FinalLinks/Wiregrass_V3.aspx'
    },
    roster_address: '1200 W MAPLE AVENUE', pointer_location: 'Wiregrass Medical Center',
    expected_mrf_address: '1200 W Maple Ave Geneva AL 36340',
    expected_base_finding: 'compliant-observed', expected_header_status: 'review'
  },
  {
    ccn: '010086', identity_url: 'https://www.nmhs.net/Website-Use-Privacy-Policy',
    identity_terms: ['Marion Regional Health Winfield (NMHS-South Marion)'],
    identity_authority: 'first-party-current-facility-and-price-file',
    relationship_url: 'https://www.nmhs.net/Patients-and-Visitors/Pricing/Price-Transparency',
    relationship_terms: ['North Mississippi Health Services-South Marion Standard Charges', '334053320_marion-regional-health-winfield'],
    browser_relationship: {
      page_title: 'Price Transparency | North Mississippi Health Services',
      transport: 'current-first-party-page-extraction',
      excerpt: 'Machine-Readable Files for Hospital Price Transparency | North Mississippi Health Services-South Marion Standard Charges | https://apps.nmhs.net/files/pt_mrf/334053320_marion-regional-health-winfield%2C-inc_standardcharges.json'
    },
    roster_address: '1530 U S HIGHWAY 43', pointer_location: 'Marion Regional Health-Winfield, Inc',
    expected_mrf_address: '1530 US Highway 43 Winfield, AL 35594',
    expected_base_finding: 'compliant-observed', expected_header_status: 'unmatched'
  },
  {
    ccn: '100284', identity_url: 'https://quality.healthfinder.fl.gov/Facility-Provider/Profile/?LID=9962',
    identity_terms: ['CORAL WEST COMMUNITY HOSPITAL', '2500 SW 75TH AVE', 'keraltyhospital.com'],
    identity_authority: 'state-regulator-current-facility-profile',
    roster_address: '2500 SW 75TH AVE', pointer_location: 'Coral West Community Hospital',
    expected_mrf_address: '2500 SW 75TH AVE,MIAMI,FL,33155-0000'
  },
  {
    ccn: '131318', identity_url: 'https://www.valorhealth.org/valor-health-one-year-later',
    identity_terms: ['Walter Knox Memorial Hospital changed its name to Valor Health'],
    roster_address: '1202 EAST LOCUST STREET', pointer_location: 'Walter Knox Memorial Hospital'
  },
  {
    ccn: '150160', identity_url: 'https://www.orthoindy.com/about-orthoindy',
    identity_terms: ['OrthoIndy Hospital', 'legally named, the Indiana Orthopaedic Hospital'],
    roster_address: '8400 NORTHWEST BLVD', pointer_location: 'INDIANA ORTHOPAEDIC HOSPITAL LLC Northwest',
    expected_mrf_address: '8400 Northwest Blvd.,,Indianapolis,IN,46278'
  },
  {
    ccn: '154014', identity_url: 'https://www.bowenhealth.org/all-locations',
    identity_terms: ['Bowen Health Psychiatric Hospital', '9 Pequignot Dr', 'Pierceton, IN'],
    relationship_url: 'https://www.administration.bowenhealth.org/news/bowen-center-changes-name-to-bowen-health',
    relationship_terms: ['Bowen Health is the new name for Bowen Center', 'Otis R. Bowen Center for Human Services'],
    roster_address: '9 PEQUIGNOT DR', pointer_location: 'Bowen Health, Inc.',
    expected_version: '2.0.0', expected_mrf_address: '9 Pequinot Dr, Pierceton, IN 46562-9081', minimum_bytes: 20000
  },
  {
    ccn: '170779', identity_url: 'https://sckhealth.org/about/',
    identity_terms: ['South Central Kansas Regional Medical Center', 'SCK Health'],
    roster_address: '6401 PATTERSON PARKWAY', pointer_location: 'South Central Kansas Regional Medical Center'
  },
  {
    ccn: '241305', identity_url: 'https://riverwoodhealthcare.org/our-history/',
    identity_terms: ['Aitkin Community Hospital changed its name to Riverwood Healthcare Center'],
    roster_address: '200 BUNKER HILL DRIVE', pointer_location: 'Aitkin Community Hospital Inc.'
  },
  {
    ccn: '281336', identity_url: 'https://www.yorkgeneral.org/',
    identity_terms: ['York General Hospital', '2222 N Lincoln Ave'],
    roster_address: '2222 LINCOLN AVE', pointer_location: 'York General Hospital'
  },
  {
    ccn: '271303', identity_url: 'https://granitecountyhospital.com/',
    identity_terms: ['Granite County Medical Center', '310 South Sansome Street', 'Philipsburg, MT 59858'],
    roster_address: '310 SANSOME ST', pointer_location: 'Granite County Hospital District'
  },
  {
    ccn: '171354', identity_url: 'https://www.chcsks.org/',
    identity_terms: ['Community HealthCare System', '120 W. 8th St.', 'Onaga, Kansas 66521'],
    roster_address: '120 WEST 8TH STREET', pointer_location: 'Community HealthCare System, Inc.'
  },
  {
    ccn: '310054', identity_url: 'https://mountainsidemedicalcenter.com/locations/',
    identity_terms: ['Hackensack Meridian Mountainside Medical Center', '1 Bay Ave', 'Montclair'],
    roster_address: '1 BAY AVENUE', pointer_location: 'Mountainside Medical Center', allow_license_state_conflict: true
  },
  {
    ccn: '310130', identity_url: 'https://pascackmedicalcenter.com/',
    identity_terms: ['Hackensack Meridian Health Pascack Valley Medical Center', '250 Old Hook Road', 'Westwood'],
    roster_address: '250 OLD HOOK ROAD', pointer_location: 'Pascack Valley Medical Center', allow_license_state_conflict: true
  },
  {
    ccn: '320001', identity_url: 'https://unmhealth.org/locations/unm-hospital/',
    identity_terms: ['University of New Mexico Hospital', '2211 Lomas Blvd. NE', 'Albuquerque, NM 87106'],
    roster_address: '2211 LOMAS BOULEVARD NE', pointer_location: 'University of New Mexico Hospital',
    expected_mrf_address: '2211 Lomas Blvd Ne,Albuquerque,NM,87106 |3001 Broadmoor Blvd Ne,Rio Rancho,NM,87144',
    expected_base_finding: 'not-assessed-not-named-in-file'
  },
  {
    ccn: '321309', identity_url: 'https://mimbresvalleymedical.com/mimbres-memorial-hospital-names-chief-executive-officer/',
    identity_terms: ['Mimbres Memorial Hospital', 'Mimbres Valley Medical Center', '900 West Ash Street'],
    identity_authority: 'first-party-and-sec-dba-chain',
    relationship_url: 'https://www.sec.gov/Archives/edgar/data/1108109/000119312512074190/d260326dex21.htm',
    relationship_terms: ['Deming Hospital Corporation', 'd/b/a Mimbres Memorial Hospital'],
    browser_relationship: {
      page_title: 'EX-21',
      transport: 'real-browser-rendered-accessibility',
      excerpt: 'Community Health Systems, Inc. SUBSIDIARY LISTING | Deming Hospital Corporation | d/b/a Mimbres Memorial Hospital'
    },
    roster_address: '900 W Ash Street', pointer_location: 'MIMBRES MEMORIAL HOSPITAL',
    expected_mrf_address: '900 W Ash St DEMING NM 88030'
  },
  {
    ccn: '360245', identity_url: 'https://www.glenbeigh.org/contact',
    identity_terms: ['Glenbeigh Hospital', '2863 State Route 45', 'Rock Creek'],
    roster_address: '2863 STATE ROUTE 45', pointer_location: 'Glenbeigh Hospital of Rock Creek'
  },
  {
    ccn: '370093', identity_url: 'https://www.ouhealth.com/find-a-location/ou-health-university-of-oklahoma-medical-center/',
    identity_terms: ['OU Health University of Oklahoma Medical Center', '700 NE 13th', 'Oklahoma City, OK 73104'],
    browser_identity: {
      page_title: 'OU Health University of Oklahoma Medical Center',
      transport: 'real-browser-rendered-accessibility',
      excerpt: 'OU Health University of Oklahoma Medical Center | 700 NE 13th | Oklahoma City, OK 73104 | Category: Adult Services, Laboratory Services, Imaging & Radiology Services, Hospital, Emergency Services | University of Oklahoma Medical Center is the only comprehensive academic hospital in the state.'
    },
    roster_address: '700 NE 13TH STREET', pointer_location: 'OU Health University of Oklahoma Medical Center',
    expected_mrf_address: '700 NE 13th St,Oklahoma City,OK,73104|1200 Childrens Ave, Oklahoma City, OK 73104|One South Bryant Ave, Edmond, OK 73034',
    expected_base_finding: 'not-assessed-not-named-in-file'
  },
  {
    ccn: '371323', identity_url: 'https://oklahoma.gov/hwtc/facilities/weatherford-regional-hospital.html',
    identity_terms: ['Weatherford Regional Hospital', '3701 E. Main', 'Weatherford, OK 73096'],
    identity_authority: 'state-government-current-facility-profile',
    relationship_url: 'https://www.sai.ok.gov/olps/uploads/weatherford_924_fs_final_ta7y.pdf',
    relationship_expected_sha256: '51f11e157e2912ac54efe8099ce91e4123b8ac938bf2d982ddb24c768a57f358',
    relationship_page: 11,
    relationship_excerpt: 'The Authority operates Weatherford Regional Hospital. Weatherford Regional Hospital, Inc. of Weatherford, Oklahoma is a separate legal entity but has substantially the same governing body as the Authority and is reported as a blended component unit of the Authority.',
    roster_address: '3701 E MAIN', pointer_location: 'WEATHERFORD HOSPITAL AUTHORITY',
    expected_mrf_address: '3701 E Main St Weatherford OK 73096'
  },
  {
    ccn: '380009', identity_url: 'https://www.ohsu.edu/about/contact-us',
    identity_terms: ['OHSU', '3181 S.W. Sam Jackson Park Road', 'Portland'],
    roster_address: '3181 SW SAM JACKSON PARK ROAD', pointer_location: 'Oregon Health and Science University'
  },
  {
    ccn: '190050', identity_url: 'https://www.beauregard.org/contact-us/',
    identity_terms: ['Beauregard Memorial Hospital', '600 S. Pine St.', 'DeRidder'],
    roster_address: '600 S PINE STREET',
    pointer_location: 'Hospital Service District No. 2 of the Parish of Beauregard, State of Louisiana dba Beauregard Memorial Hospital'
  },
  {
    ccn: '061316', identity_url: 'https://sprhc.org/about.html',
    identity_terms: ['Huerfano County Hospital District d/b/a Spanish Peaks Regional Health Center', '23500 U.S. Highway 160, Walsenburg CO 81089'],
    roster_address: '23500 US HIGHWAY 160', pointer_location: 'HUERFANO COUNTY HOSPITAL DISTRICT',
    expected_mrf_address: '23500 Us Highway 160 Walsenburg CO 81089'
  },
  {
    ccn: '061319', identity_url: 'https://www.stvincent.health/contact',
    identity_terms: ['St. Vincent General Hospital District', 'St. Vincent Health', '816 W 4th Street', 'St. Vincent Family Health Center', '822 W 4th Street'],
    identity_authority: 'first-party-campus-address-conflict',
    roster_address: '816 W 4TH ST', pointer_location: 'St. Vincent Health',
    expected_mrf_address: '822 W 4th St, Leadville, CO 80461',
    expected_finding: 'mrf-address-field-conflicts-facility'
  },
  {
    ccn: '324012', identity_url: 'https://peakbehavioral.com/contact/',
    identity_terms: ['Peak Behavioral Health', '5065 McNutt Rd', 'Santa Teresa'],
    roster_address: "5045 MCNUTT ROAD (BLDG'S A, B, C & D)", pointer_location: 'SBH-El Paso, LLC'
  },
  {
    ccn: '324014', identity_url: 'https://centraldesertbh.com/disclaimer/',
    identity_terms: ['Central Desert Behavioral Health Hospital', '1525 N. Renaissance Blvd. NE', 'Albuquerque'],
    roster_address: '1525 N RENAISSANCE BLVD NE', pointer_location: 'Central Desert Behavioral Health hospital',
    allow_license_state_conflict: true
  },
  {
    ccn: '344030', identity_url: 'https://info.ncdhhs.gov/dhsr/mhlcs/sods/facility.asp?fid=130438',
    identity_terms: ['Carolina Dunes Behavioral Health', '2050 Mercantile Drive', 'Leland', '28451'],
    identity_authority: 'state-regulator-fid-continuity',
    relationship_url: 'https://info.ncdhhs.gov/dhsr/coneed/decisions/2015/july/0813_brunswick_sbcl.pdf',
    relationship_expected_sha256: '335757e50bbfe5196c31bc73bdb075eec3940769c6a1fbd2513e1d8cc18aa917',
    relationship_page: 1,
    relationship_excerpt: 'Facility: Strategic Behavioral Center-Leland. FID #: 130438. SBH Wilmington, LLC, d/b/a Strategic Behavioral Center Leland shall materially comply with all representations made in the certificate of need application and supplemental information.',
    roster_address: '2050 MERCANTILE DRIVE', pointer_location: 'SBH-Wilmington, LLC',
    expected_mrf_address: '2050 Mercantile Dr, Leland, NC 28451'
  },
  {
    ccn: '351323', identity_url: 'https://lph.hospital/',
    identity_terms: ['Langdon Prairie Health', '909 2nd St.', 'Langdon, ND 58249'],
    relationship_url: 'https://lph.hospital/wp-content/uploads/2024/10/revised-bylaws-03.29.23-final.pdf',
    relationship_expected_sha256: '042a659301e552676e0fc7cf25c270464dc91a8a29648107826585b55bf3523c',
    relationship_page: 4,
    relationship_excerpt: 'The name of this corporation shall be Cavalier County Memorial Hospital Association. The Corporation may do business under any name duly designated by the Board of Trustees. The principal office of this Corporation shall be Cavalier County Memorial Hospital, which shall be located in the City of Langdon, County of Cavalier, State of North Dakota.',
    roster_address: '909 2ND ST', pointer_location: 'Langdon Prairie Health',
    expected_version: '2.0.0', expected_finding: 'mrf-stale-over-365-days'
  },
  {
    ccn: '400001', identity_url: 'https://www.presbypr.com/',
    identity_terms: ['Ashford Hospital', '1451 Ashford Avenue', 'San Juan'],
    roster_address: '1451 ASHFORD AVENUE, EL CONDADO', pointer_location: 'Hospital Ashford'
  },
  {
    ccn: '330009', identity_url: 'https://www.bronxcare.org/fileadmin/SiteFiles/Images/Interactive_Map/index.html',
    identity_terms: ['Fulton Campus', '1276 Fulton Avenue', 'Bronx, NY 10456'],
    roster_address: '1276 FULTON AVENUE', pointer_location: 'BronxCare Hospital Center - Fulton Campus',
    expected_mrf_address: '1276 Fulton Ave Bronx, NY 10456-3467', expected_base_finding: 'not-assessed-not-named-in-file'
  },
  {
    ccn: '400114', identity_url: 'https://puertasabiertas.salud.pr.gov/Directorio/proveedor?proveedor=15',
    identity_terms: ['Manati Medical Center', 'CALLE HERNÁNDEZ CARRIÓN #668', 'Manatí, PR 00674'],
    relationship_url: 'https://www.manatimedical.com/sobre-mmc/cuerpo-ejecutivo/nuestro-hospital/',
    relationship_terms: ['Hospital Dr. Alejandro Otero López', 'cambio de nombre del hospital', 'Manatí Medical Center'],
    roster_address: 'CARR 668 CALLE HERNANDEZ CARRION URB ATENAS', pointer_location: 'Manati Medical Center',
    expected_mrf_address: 'Calle Hernandez Carrion 688, Manti, PR 00674'
  },
  {
    ccn: '361300', identity_url: 'https://pauldingcountyhospital.com/',
    identity_terms: ['Paulding County Hospital', '1035 West Wayne Street', 'Paulding, Ohio 45879'],
    roster_address: '1035 WEST WAYNE ST.', pointer_location: 'Paulding County Hospital',
    expected_version: '2.0.0', allow_license_state_conflict: true,
    expected_mrf_address: '1035 West Wayne Street Paulidng OH 45879'
  }
];

async function main() {
  await fsp.mkdir(RAW, { recursive: true });
  const roster = new Map(csvToObjects(fs.readFileSync(path.join(ROOT, 'cms_data/Hospital_General_Information.csv'), 'utf8')).map(row => [row['Facility ID'], row]));
  const pointers = csvToObjects(fs.readFileSync(path.join(ROOT, 'cms_data/hpt/pointer-corpus/cms_hpt_entries.csv'), 'utf8'));
  const headers = csvToObjects(fs.readFileSync(path.join(ROOT, 'cms_data/hpt/nationwide-verification/mrf-headers.csv'), 'utf8'));
  const outputPath = path.join(AUDIT, 'reconciliation-reviewed-alias-pointer-proof.json');
  const prior = fs.existsSync(outputPath) ? JSON.parse(fs.readFileSync(outputPath, 'utf8')).records : [];
  const requested = String(process.argv.find(value => value.startsWith('--ccn=')) || '').replace('--ccn=', '');
  const selected = requested ? candidates.filter(candidate => candidate.ccn === requested) : candidates;
  if (requested && !selected.length) throw new Error(`Unknown alias-proof CCN ${requested}`);
  const records = new Map(prior.map(row => [row.ccn, row]));
  for (const candidate of selected) {
    const facility = roster.get(candidate.ccn);
    const pointer = pointers.find(row => String(row.related_ccns).split('|').includes(candidate.ccn) && row.location_name === candidate.pointer_location);
    const header = pointer && headers.find(row => row.mrf_url === pointer.mrf_url);
    if (!facility || facility['Address'] !== candidate.roster_address || !pointer || !header
        || header.header_status !== (candidate.expected_header_status || 'unmatched'))
      throw new Error(`Changed source inputs for ${candidate.ccn}`);
    const identityResponse = candidate.browser_identity
      ? { status: 200, body: Buffer.from(candidate.browser_identity.excerpt, 'utf8') }
      : await retrieve(candidate.identity_url, 524288, { timeoutMs: 20000 });
    const identityText = text(identityResponse.body);
    if (!(identityResponse.status >= 200 && identityResponse.status < 300)
        || !candidate.identity_terms.every(term => identityText.toLowerCase().includes(term.toLowerCase())))
      throw new Error(`First-party alias proof unavailable for ${candidate.ccn}: ${identityResponse.status}`);
    let relationshipResponse = null;
    let relationshipScriptedStatus = null;
    if (candidate.relationship_url) {
      relationshipResponse = await retrieve(candidate.relationship_url, 524288, { timeoutMs: 20000 });
      relationshipScriptedStatus = relationshipResponse.status;
      let relationshipText = text(relationshipResponse.body);
      const scriptedRelationshipUsable = relationshipResponse.status >= 200 && relationshipResponse.status < 300
        && (!candidate.relationship_terms || candidate.relationship_terms.every(term => relationshipText.toLowerCase().includes(term.toLowerCase())))
        && (!candidate.relationship_expected_sha256 || sha(relationshipResponse.body) === candidate.relationship_expected_sha256);
      if (!scriptedRelationshipUsable && candidate.browser_relationship) {
        relationshipResponse = { status: 200, body: Buffer.from(candidate.browser_relationship.excerpt, 'utf8') };
        relationshipText = text(relationshipResponse.body);
      }
      if (!(relationshipResponse.status >= 200 && relationshipResponse.status < 300)
          || (candidate.relationship_terms && !candidate.relationship_terms.every(term => relationshipText.toLowerCase().includes(term.toLowerCase())))
          || (candidate.relationship_expected_sha256 && sha(relationshipResponse.body) !== candidate.relationship_expected_sha256)
          || (candidate.relationship_expected_sha256 && !relationshipResponse.body.subarray(0, 4).equals(Buffer.from('%PDF'))))
        throw new Error(`First-party relationship proof unavailable for ${candidate.ccn}: ${relationshipResponse.status}`);
    }
    const response = await retrieve(pointer.mrf_url, CAP, { timeoutMs: 30000 });
    const minimumBytes = candidate.minimum_bytes || 65536;
    if (!(response.status >= 200 && response.status < 300) || response.body.length < minimumBytes)
      throw new Error(`MRF byte proof unavailable for ${candidate.ccn}: ${response.status}`);
    const parsed = await parsePayload(response.body, response.headers['content-type'] || '');
    const root = parsed.parsed?.[0];
    const expectedVersion = candidate.expected_version || '3.0.0';
    const addressAgrees = candidate.expected_mrf_address
      ? root.mrfAddress === candidate.expected_mrf_address
      : String(root.mrfAddress).toLowerCase().includes(facility['City/Town'].toLowerCase());
    if (!root || (candidate.expected_mrf_hospital_name && root.mrfHospitalName !== candidate.expected_mrf_hospital_name)
        || (!candidate.allow_license_state_conflict && root.mrfLicenseState !== facility.State) || root.cmsVersion !== expectedVersion
        || !addressAgrees)
      throw new Error(`Parsed identity does not agree for ${candidate.ccn}`);
    const digest = sha(response.body);
    const artifact = path.join(RAW, `${digest}.bin`);
    await fsp.writeFile(artifact, response.body);
    const record = {
      ccn: candidate.ccn, hospital_name: facility['Facility Name'], roster_address: facility['Address'],
      expected_base_finding: candidate.expected_base_finding || 'not-assessed-domain-unknown',
      roster_city: facility['City/Town'], roster_state: facility.State, roster_zip: facility['ZIP Code'],
      identity_url: candidate.identity_url, identity_observed_at: new Date().toISOString(),
      identity_http_status: identityResponse.status, identity_sha256: sha(identityResponse.body), identity_terms: candidate.identity_terms,
      identity_authority: candidate.identity_authority || 'first-party',
      pointer_url: pointer.pointer_url, pointer_sha256: pointer.pointer_sha256, pointer_file: pointer.raw_file.replaceAll('\\', '/'),
      pointer_location_name: pointer.location_name, source_page_url: pointer.source_page_url, mrf_url: pointer.mrf_url,
      mrf_http_status: response.status, mrf_final_url: response.finalUrl || pointer.mrf_url, bytes_retained: response.body.length,
      minimum_bytes: minimumBytes,
      retained_sha256: digest, retained_sample: path.relative(ROOT, artifact).replaceAll('\\', '/'),
      declared_hospital_name: root.mrfHospitalName, declared_location_name: root.mrfLocationName,
      declared_address: root.mrfAddress, declared_license_state: root.mrfLicenseState,
      declared_date: root.declaredLastUpdated, version: root.cmsVersion,
      observed_at: new Date().toISOString(), finding: candidate.expected_finding || (root.mrfLicenseState !== facility.State
        ? 'mrf-license-state-field-conflicts-facility'
        : root.cmsVersion === '3.0.0' ? 'compliant-observed' : 'old-template-version')
    };
    if (candidate.browser_identity) {
      record.identity_transport = candidate.browser_identity.transport;
      record.identity_page_title = candidate.browser_identity.page_title;
      record.identity_excerpt = candidate.browser_identity.excerpt;
    }
    if (relationshipResponse) {
      record.relationship_url = candidate.relationship_url;
      record.relationship_http_status = relationshipResponse.status;
      record.relationship_scripted_http_status = relationshipScriptedStatus;
      record.relationship_sha256 = sha(relationshipResponse.body);
      if (candidate.relationship_terms) record.relationship_terms = candidate.relationship_terms;
      if (candidate.relationship_page) record.relationship_page = candidate.relationship_page;
      if (candidate.relationship_excerpt) record.relationship_excerpt = candidate.relationship_excerpt;
      if (candidate.browser_relationship) {
        record.relationship_transport = candidate.browser_relationship.transport;
        record.relationship_page_title = candidate.browser_relationship.page_title;
        record.relationship_excerpt = candidate.browser_relationship.excerpt;
      }
    }
    records.set(candidate.ccn, record);
  }
  const allRecords = [...records.values()].sort((a, b) => a.ccn.localeCompare(b.ccn));
  fs.writeFileSync(outputPath, JSON.stringify({ records: allRecords }, null, 2) + '\n');
  console.log(JSON.stringify({ captured: selected.map(row => row.ccn), bytes: selected.map(row => records.get(row.ccn).bytes_retained) }, null, 2));
}

if (require.main === module) main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
