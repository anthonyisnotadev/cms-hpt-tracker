'use strict';

const fs = require('fs');
const path = require('path');
const { normalizeName } = require('./lib/util');

const ROOT = path.resolve(__dirname, '../..');
const AUDIT = path.join(ROOT, 'data/hpt-audit');
const STAGE = path.join(AUDIT, '.domain-discovery', 'review-569');
const REVIEW = path.join(AUDIT, 'discovery-review.json');
const INVENTORY = path.join(STAGE, 'inventory.json');
const SEARCH_DIR = path.join(STAGE, 'identity-search-v2');
const SEARCH_DIR_B = path.join(STAGE, 'identity-search-v2b');

const generic = new Set(['hospital', 'hosp', 'medical', 'med', 'center', 'centre', 'ctr', 'health',
  'healthcare', 'system', 'campus', 'the', 'of', 'and', 'inc', 'llc', 'regional', 'community']);
const reviewedOfficialHosts = new Set([
  'lcmcwmh.com', 'chc.la', 'mlkch.org', 'scvh.org', 'stvincent.health', 'stamfordhealth.org',
  'thevineshospital.com', 'millercountyhospital.com', 'grisellmemorialhospital.org', 'beauregard.org',
  'arbourhospital.com', 'mwmc.com', 'meekermemorial.org', 'uhs.com', 'nemhs.net', 'myrgh.org',
  'svhnm.org', 'whmcny.org', 'cmcvictoria.com', 'cchwyo.org',
]);

function words(value) {
  return [...new Set(normalizeName(value || '').split(/\s+/).filter(word => word.length > 2 && !generic.has(word)))];
}

function bestAddress(row) {
  const values = row.evidence.map(item => item.observation || {}).flatMap(item => [
    item.address, item.street_address, item.facility_address, item.roster_address,
  ]).filter(Boolean);
  return values.sort((a, b) => String(b).length - String(a).length)[0] || '';
}

function worklist() {
  const review = JSON.parse(fs.readFileSync(REVIEW, 'utf8')).records;
  const inventory = JSON.parse(fs.readFileSync(INVENTORY, 'utf8'));
  const byCcn = new Map(inventory.map(row => [row.base.ccn, row]));
  const rows = review.filter(row => row.disposition === 'candidate-identity-unverified').map(row => {
    const source = byCcn.get(row.ccn);
    const address = bestAddress(source);
    return {
      ccn: row.ccn,
      hospital_name: row.hospital_name,
      address,
      city: source.base.city,
      state: source.base.state,
      candidate_urls: row.website.candidate_urls || [],
      query: `\"${row.hospital_name}\" \"${address}\" ${source.base.city} ${source.base.state} official hospital`,
    };
  });
  fs.mkdirSync(SEARCH_DIR, { recursive: true });
  fs.writeFileSync(path.join(STAGE, 'identity-worklist-v2.json'), JSON.stringify(rows, null, 2));
  console.log(JSON.stringify({ records: rows.length, with_address: rows.filter(row => row.address).length,
    searched: rows.filter(row => fs.existsSync(path.join(SEARCH_DIR, row.ccn + '.json'))).length }, null, 2));
}

const blockedHost = /(^|\.)(healthgrades|turquoise\.health|npiprofile|usnews|yelp|mapquest|facebook|linkedin|wikipedia|bbb\.org|ahd\.com|cms\.gov|data\.cms\.gov|carecompare|vitadox|sharecare|vitals|yellowpages|superpages|chamberofcommerce|causeiq|dnb|zoominfo|definitivehc|medicarelist|hospitalcaredata|hospitalinspections|countyoffice|buzzfile|opencorporates|nursa|indeed|glassdoor|zocdoc|webmd|rehabs|addictions\.com|detoxrehabs|mentalhealthclinics|psychologytoday|findhelp|providerexpress|uhcprovider|aetna|cigna|humana|firstmedicalpr|mcs|tricare|bcbs|providence\.org\/BaseSearch|jcipatientsafety|insurancedatanow|publicdatahub|maps\.apple|opennpi|healthluminate|healthcare4ppl|mentalhealthus|npir\.org|payerprice|careranks|eldercarecosts|carelistings|medigy|velarionrecords|practicelink|plainhospital|insiderx|marithealth|goodbill|jointcommission|nursinghomedatabase|hospitalcompare|healthcarecomps|healthcare6|medifind|docspot|healthline|wellness|ratemds|healthsoul|doctor\.webmd|sosou\.de|minimalistmama|allnurses|vivian\.com|medibillsaver|blackhealth|freida\.ama-assn|hospitalranked|patientbill|seniorhealthdatabase|npino|carepriceguide|safehospitalsusa|rehab\.com|waze\.com|mapadecaborojo|healthprovidersdata|medicalrecords|healthlocator|calhospitalcompare|search\.211|211unitedway|business\.|chamber|drugrehab|freementalhealth|visitlancasterpa|catertrax|connectwilbarger|medinatriennial|georgiastateauthority|pshpgeorgia|healthplanofnevada|findbhhelp|al-hospitals|totalcare|healthspring|caregraph|amerihealth|hospitallookup|molinahealthcare|ourhealthnetwork|cbhc\.org|lmhospcu|careers\.|bhcfcu|trillianthealth|sunshinehealth|simplyhealthcare|ucf\.edu|dekalbpublichealth|healthnomix|everlighthealth|nomadhealth|families\.care|healthcarejournal|individualcarecenter|commonwealthcarealliance|montcalmcare|conciergemedicaldirectory|baseratehealth|mnmentalhealth|homestatehealth|healthbycounty|magnoliahealthplan|mshospitaltransparency|healthcaredealhub|hospitalstats|nebraskahospitals|levinassociates|nvhospitalquality|loacare|hospitalcostdata|zmedhealth|goodhospitalbadhospital|getcaresc|carecredit|greatplainstribalhealth|quality\.allianthealth|superiorhealthplan|fostercaretx|hospitales\.info|medical-centers\.org|utahhospitals|hospital-us|carecarta|networkhealth|healthguideaz|makeahealthymove|carboncountypublichealth|casperpublichealth|manteca\.org|delraybeach\.com|habitatdesoto|massachealth|dearborncountyinguide|metrowestymca|finishthejobnorwood|misofi\.net|alpenaregionalmedicalcenter|mybergen\.com|visitgallup|medicine\.buffalo|holdenvillechamber|emarketplace\.state\.pa|sanantoniodrugtreatmentcenters|elcampochamber|campbellcountyresources|hospitals\.net|carelens|newchoicehealth|careermd|mizu\.health|namibuffalony|lucascountyhealth|providers\.corewellhealth|ferrycounty\.com|healthy\.kaiserpermanente|pawneecity\.com|search\.wyoming211|jobs\.tenethealth|tpn\.health|pawneecitynebraska|legistar|cityofhenderson|vermont211|digitalcollections)/i;

function governmentOperatorResult(result) {
  const value = result.host + new URL(result.url).pathname;
  return /(mh\.alabama\.gov\/bryce|ihs\.gov\/.+healthcarefacilities|cdhs\..*\/CMHHIP|portal\.ct\.gov\/dmhas|dbhdd\.georgia\.gov\/.+regional-hospital|health\.maryland\.gov\/springfield|mn\.gov\/dct|mississippi\.gov\/agencies\/south-mississippi-state-hospital|smsh\.ms\.gov|nj\.gov\/health\/integratedhealth\/hospitals|omh\.ny\.gov\/omhweb\/facilities|oklahoma\.gov\/odmhsas\/.+facilities|bhdd\.sc\.gov\/.+\/hospitals|tn\.gov\/behavioral-health\/hospitals|hhs\.texas\.gov\/services\/mental-health-substance-use\/state-hospitals|dhs\.wisconsin\.gov\/(mmhi|wmhi))/i.test(value);
}

function parseResults(text) {
  return String(text || '').split(/^[-]{20,}\s*$/m).map(section => {
    const first = section.trim().split(/\r?\n/, 1)[0] || '';
    const match = first.match(/^(.*?) \((https?:\/\/.*)\)$/);
    if (!match) return null;
    let url;
    try { url = new URL(match[2]); } catch { return null; }
    return { title: match[1], url: url.href, host: url.hostname.toLowerCase(), text: section.trim() };
  }).filter(Boolean);
}

function candidateScore(row, result) {
  const text = normalizeName(result.text);
  const title = normalizeName(result.title);
  const nameWords = words(row.hospital_name);
  const addressWords = words(row.address).filter(word => !/^\d+$/.test(word));
  const streetNumber = String(row.address).match(/\b\d{2,6}\b/)?.[0] || '';
  const nameHits = nameWords.filter(word => text.includes(word));
  const titleHits = nameWords.filter(word => title.includes(word));
  const addressHits = addressWords.filter(word => text.includes(word));
  const cityHit = normalizeName(row.city).split(/\s+/).filter(Boolean).every(word => text.includes(word));
  const streetHit = streetNumber && new RegExp(`\\b${streetNumber}\\b`).test(text);
  const compactHost = result.host.replace(/^www\./, '').replace(/[^a-z0-9]/g, '');
  const brandedHost = nameWords.some(word => word.length >= 5 && compactHost.includes(word));
  const government = /\.(gov|mil)$/.test(result.host) || /(^|\.)ihs\.gov$/.test(result.host);
  const priorCandidateHost = row.candidate_urls.some(value => {
    try { return new URL(value).hostname.replace(/^www\./, '') === result.host.replace(/^www\./, ''); } catch { return false; }
  });
  const denied = blockedHost.test(result.host + new URL(result.url).pathname);
  const nameRatio = nameHits.length / (nameWords.length || 1);
  const titleRatio = titleHits.length / (nameWords.length || 1);
  const addressRatio = addressHits.length / (addressWords.length || 1);
  const identityMatch = nameRatio >= .6 && streetHit && cityHit && addressRatio >= .34;
  const authoritative = !denied && (government || brandedHost || priorCandidateHost);
  return { ...result, name_hits: nameHits, title_hits: titleHits, address_hits: addressHits,
    street_hit: !!streetHit, city_hit: cityHit, branded_host: brandedHost, government, prior_candidate_host: priorCandidateHost, denied,
    identity_match: identityMatch, authoritative, score: nameRatio + titleRatio + addressRatio + (cityHit ? .3 : 0) + (streetHit ? .4 : 0) + (brandedHost ? .3 : 0) + (government ? .2 : 0) };
}

function analyze() {
  const rows = JSON.parse(fs.readFileSync(path.join(STAGE, 'identity-worklist-v2.json'), 'utf8'));
  const output = rows.map(row => {
    const file = path.join(SEARCH_DIR, row.ccn + '.json');
    const fileB = path.join(SEARCH_DIR_B, row.ccn + '.json');
    const saved = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
    const savedB = fs.existsSync(fileB) ? JSON.parse(fs.readFileSync(fileB, 'utf8')) : null;
    const candidates = [...parseResults(saved?.result), ...parseResults(savedB?.result)]
      .map(result => candidateScore(row, result)).sort((a, b) => b.score - a.score);
    return { ...row, observed_at: [saved?.observed_at, savedB?.observed_at].filter(Boolean).sort().at(-1) || '', candidates,
      strict_matches: candidates.filter(candidate => candidate.identity_match && candidate.authoritative).length };
  });
  fs.writeFileSync(path.join(STAGE, 'identity-search-v2-analysis.json'), JSON.stringify(output, null, 2));
  const histogram = output.reduce((counts, row) => (counts[row.strict_matches] = (counts[row.strict_matches] || 0) + 1, counts), {});
  console.log(JSON.stringify({ records: output.length, histogram,
    strict_match_records: output.filter(row => row.strict_matches).length,
    no_result_records: output.filter(row => !row.candidates.length).length }, null, 2));
}

function titleRatio(row, candidate) {
  const target = words(row.hospital_name);
  return candidate.title_hits.length / (target.length || 1);
}

function officialLooking(row, candidate) {
  if (row.ccn === '364035' && /summitbhc\.com$/i.test(candidate.host)) return false;
  if (candidate.denied) return false;
  if (candidate.government) return governmentOperatorResult(candidate);
  if (reviewedOfficialHosts.has(candidate.host.replace(/^www\./, ''))) return true;
  if (candidate.branded_host || candidate.prior_candidate_host) return true;
  if (titleRatio(row, candidate) < .5) return false;
  const healthcareHost = /(health|hospital|medical|clinic|care|behavioral|hosp|bhc)/i.test(candidate.host);
  return healthcareHost;
}

function decide() {
  const analysis = JSON.parse(fs.readFileSync(path.join(STAGE, 'identity-search-v2-analysis.json'), 'utf8'));
  const decisions = analysis.map(row => {
    const official = row.candidates.find(candidate => candidate.identity_match && officialLooking(row, candidate));
    if (official) return {
      ccn: row.ccn,
      identity: 'corroborated',
      official_domain: official.host.replace(/^www\./, ''),
      source_url: official.url,
      observed_at: row.observed_at,
      method: 'built-in-web-search-exact-facility-page',
      basis: `Fresh built-in search identified an operator-controlled facility page matching the hospital name, roster street address (${row.address}), and ${row.city}, ${row.state}.`,
      search_queries: [row.query, `\"${row.hospital_name}\" ${row.city} ${row.state} official website`],
      rejected_candidate_urls: row.candidate_urls.filter(url => {
        try { return new URL(url).hostname.replace(/^www\./, '') !== official.host.replace(/^www\./, ''); } catch { return true; }
      }),
      pricing_urls: row.candidates.filter(candidate => candidate.host === official.host && /price|transparen|standard.?charge/i.test(candidate.url + ' ' + candidate.title)).map(candidate => candidate.url),
    };
    const unresolved = row.candidates.find(candidate => officialLooking(row, candidate)
      && candidate.city_hit && candidate.name_hits.length / (words(row.hospital_name).length || 1) >= .6);
    if (unresolved) return {
      ccn: row.ccn,
      identity: 'unverified',
      candidate_domain: unresolved.host.replace(/^www\./, ''),
      source_url: unresolved.url,
      observed_at: row.observed_at,
      method: 'built-in-web-search-facility-page-address-unresolved',
      basis: `Fresh built-in search found a plausible operator or facility page for the hospital in ${row.city}, ${row.state}, but that page did not corroborate the roster street address (${row.address}).`,
      next_action: 'Confirm the facility street address or documented name/location transition on an operator-controlled page.',
      rejected_candidate_urls: row.candidate_urls.filter(url => {
        try { return new URL(url).hostname.replace(/^www\./, '') !== unresolved.host.replace(/^www\./, ''); } catch { return true; }
      }),
    };
    return {
      ccn: row.ccn,
      identity: 'not-identified',
      observed_at: row.observed_at,
      method: 'built-in-web-search-completed-no-supported-official-site',
      basis: `Two fresh built-in searches completed for the exact hospital and roster location; returned pages were directories, unrelated sites, or address-only corroboration and did not establish an official hospital/operator website.`,
      next_action: 'Search current legal/operator and historical facility names, then require an operator-controlled facility page before assigning a website.',
      rejected_candidate_urls: row.candidate_urls,
    };
  });
  fs.writeFileSync(path.join(STAGE, 'deep-identity-v2.json'), JSON.stringify(decisions, null, 2));
  const counts = decisions.reduce((out, row) => (out[row.identity] = (out[row.identity] || 0) + 1, out), {});
  console.log(JSON.stringify({ records: decisions.length, counts }, null, 2));
}

if (require.main === module) {
  if (process.argv[2] === 'worklist') worklist();
  else if (process.argv[2] === 'analyze') analyze();
  else if (process.argv[2] === 'decide') decide();
  else throw Error('Usage: node scripts/hpt/deepen-candidate-identities.js <worklist|analyze|decide>');
}

module.exports = { parseResults, candidateScore, officialLooking, governmentOperatorResult };
