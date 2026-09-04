'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const {
  queueRows, stratifiedSample, parseOsmElements, parseWikidataBindings,
  candidatesFromExternal, candidateRow, limitCandidates,
  verifyDiscoveryCandidate, applyPromotionNotes, validatePromotionRows, hospitalStatuses,
  manualSearchRows, writeProtectedPointer, pointerArchiveCandidates, normalizePhone, normalizeState,
  addressAgreement, haversineKm
} = require('../lib/domain-discovery');
const { inspectPointerText, loadKey, obfuscatePointerText } = require('../lib/pointer-obfuscation');
const { buildCandidatePrompt } = require('../lib/adjudicate');
const { llmDomainPrompt, runLlmDomainDiscovery } = require('../lib/candidates');
const { candidateDomainsFromResults, runSearchDiscovery } = require('../lib/search');
const { loadPointerTasks, candidateLeads } = require('../lib/inverse-discovery');
const {
  sanitizeNppesResult, nppesIdentity, nppesCandidateRows, siblingDomainCandidates,
  emailDomains, contactDomainCandidates, parseCsvLine, parseIrsXml,
  cmsRelationshipCandidates
} = require('../lib/relationship-discovery');

const hospital = (ccn, queue = 'missing', state = 'AL', type = 'Acute Care Hospitals') => ({
  ccn, hospital_name: `GOOD HOSPITAL ${ccn}`, address: '100 MAIN STREET',
  city: 'DOTHAN', state, zip: '36301', phone: '(334) 555-0100', type,
  remediation: 'exa-domain-lookup', seeded_domain: queue === 'stale' ? 'old.test' : '',
  queue_kind: queue, previous_domain: queue === 'stale' ? 'old.test' : ''
});

test('filters only non-federal domain-discovery gaps and labels queue kind', () => {
  const rows = [
    hospital('010001'), hospital('010002', 'stale'),
    { ...hospital('010003'), remediation: 'name-match-review' },
    { ...hospital('010004'), type: 'Acute Care - Department of Defense' }
  ];
  const out = queueRows(rows);
  assert.deepEqual(out.map(row => [row.ccn, row.queue_kind, row.previous_domain]), [
    ['010001', 'missing', ''], ['010002', 'stale', 'old.test']
  ]);
});

test('loads name-review and blocked queues only when requested', () => {
  const rows = [
    { ...hospital('010010'), remediation: 'name-match-review', seeded_domain: 'names.test' },
    { ...hospital('010011'), remediation: 'unblocker', seeded_domain: 'blocked.test' },
    { ...hospital('010012'), remediation: 'exempt-federal' }
  ];
  const out = queueRows(rows, { kinds: ['name', 'blocked'] });
  assert.deepEqual(out.map(row => [row.ccn, row.queue_kind, row.previous_domain]), [
    ['010010', 'name', 'names.test'], ['010011', 'blocked', 'blocked.test']
  ]);
});

test('stratified trial is deterministic and keeps the 80/20 queue split', () => {
  const rows = [];
  for (let i = 0; i < 120; i++) rows.push(hospital(`01${String(i).padStart(4, '0')}`, 'missing', i % 2 ? 'AL' : 'TX', i % 3 ? 'Acute Care Hospitals' : 'Psychiatric'));
  for (let i = 0; i < 50; i++) rows.push(hospital(`02${String(i).padStart(4, '0')}`, 'stale', i % 2 ? 'CA' : 'NY', 'Critical Access Hospitals'));
  const one = stratifiedSample(rows, 100, 'fixed');
  const two = stratifiedSample(rows, 100, 'fixed');
  assert.deepEqual(one.map(row => row.ccn), two.map(row => row.ccn));
  assert.equal(one.filter(row => row.queue_kind === 'missing').length, 80);
  assert.equal(one.filter(row => row.queue_kind === 'stale').length, 20);
  assert.equal(new Set(one.map(row => row.ccn)).size, 100);
});

test('normalizes phone, state, address, and geographic distance', () => {
  assert.equal(normalizePhone('+1 (334) 555-0100'), '3345550100');
  assert.equal(normalizeState('US-AL'), 'AL');
  assert.equal(normalizeState('Alabama'), 'AL');
  assert.equal(addressAgreement('100 Main Street', '100 Main St, Dothan'), true);
  assert.equal(addressAgreement('100 Main Street', '200 Main Street'), false);
  assert.ok(haversineKm({ lat: 31.2, lon: -85.4 }, { lat: 31.21, lon: -85.4 }) < 2);
});

test('sanitizes NPPES records and keeps organization evidence without official contacts', () => {
  const clean = sanitizeNppesResult({
    number: '1234567890',
    basic: {
      organization_name: 'Good Hospital LLC', parent_organization_legal_business_name: 'Good Health',
      authorized_official_first_name: 'Private', authorized_official_last_name: 'Person',
      authorized_official_telephone_number: '5551112222', status: 'A'
    },
    other_names: [{ organization_name: 'Good Hospital 010001' }],
    addresses: [{ address_1: '100 Main Street', city: 'Dothan', state: 'AL',
      postal_code: '36301', telephone_number: '3345550100' }],
    endpoints: [{ endpoint: 'https://good.test/fhir', endpointDescription: 'FHIR' }]
  });
  assert.equal(clean.npi, '1234567890');
  assert.deepEqual(clean.other_names, ['Good Hospital 010001']);
  assert.equal(clean.endpoints[0].endpoint, 'https://good.test/fhir');
  assert.doesNotMatch(JSON.stringify(clean), /Private|Person|5551112222/);
  assert.equal(nppesIdentity(hospital('010001'), clean).accepted, true);
});

test('GLM domain prompt includes public aliases but no private contact fields', () => {
  const aliases = new Map([['010001', ['Good Hospital LLC', 'Good Health System']]]);
  const prompt = llmDomainPrompt([hospital('010001')], aliases);
  assert.match(prompt, /Good Hospital LLC/);
  assert.match(prompt, /100 MAIN STREET/);
  assert.doesNotMatch(prompt, /contact.email|contact.name|authorized.official/i);
});

test('GLM domain discovery caches sanitized candidate domains and rejects directories', async t => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'hpt-llm-domain-'));
  t.after(() => fsp.rm(dir, { recursive: true, force: true }));
  const cacheFile = path.join(dir, 'llm-domains.json');
  let calls = 0;
  const client = async request => {
    calls++;
    assert.equal(request.model, 'z-ai/glm-5.3-flash');
    return { model: request.model, data: { hospitals: [{ ccn: '010001', domains: [
      { domain: 'https://www.good.test/hospital', confidence: 'high', reason: 'Official health system site.' },
      { domain: 'https://www.healthgrades.com/hospital/good', confidence: 'medium', reason: 'Directory.' }
    ] }] } };
  };
  const first = await runLlmDomainDiscovery({
    hospitals: [hospital('010001')], aliases: new Map(), cacheFile, client
  });
  assert.equal(calls, 1);
  assert.deepEqual(first.rows[0].domains.map(row => row.domain), ['good.test']);
  const second = await runLlmDomainDiscovery({
    hospitals: [hospital('010001')], aliases: new Map(), cacheFile, client
  });
  assert.equal(calls, 1);
  assert.equal(second.cacheHits, 1);
});

test('search results retain official domain leads and discard directories', () => {
  const rows = candidateDomainsFromResults([
    { url: 'https://www.good.test/about', title: 'Good Hospital' },
    { url: 'https://healthgrades.com/hospital/good', title: 'Directory' },
    { url: 'https://good.test/pricing', title: 'Duplicate domain' }
  ]);
  assert.deepEqual(rows, [{ domain: 'good.test', url: 'https://www.good.test/about', title: 'Good Hospital' }]);
});

test('search discovery spends one query per hospital and resumes from sanitized cache', async t => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'hpt-search-domain-'));
  t.after(() => fsp.rm(dir, { recursive: true, force: true }));
  const cacheFile = path.join(dir, 'search.json');
  let calls = 0;
  const provider = { name: 'fixture', search: async () => {
    calls++;
    return { results: [{ url: 'https://good.test/', title: 'Good Hospital' }] };
  } };
  const first = await runSearchDiscovery({ jobs: [hospital('010001')], cacheFile, provider });
  assert.equal(first.requests, 1);
  assert.equal(first.rows[0].candidates[0].domain, 'good.test');
  const second = await runSearchDiscovery({ jobs: [hospital('010001')], cacheFile, provider });
  assert.equal(second.requests, 0);
  assert.equal(second.cacheHits, 1);
  assert.equal(calls, 1);
});

test('NPPES endpoints and matching known organization aliases become candidate leads', () => {
  const job = hospital('010001');
  const roster = [
    { ccn: '010001', name: job.hospital_name, address: job.address, city: job.city, state: 'AL', zip: job.zip, phone: job.phone },
    { ccn: '010002', name: 'GOOD HOSPITAL SYSTEM', address: '200 Main Street', city: 'Dothan', state: 'AL', zip: '36301', phone: '3345550200' }
  ];
  const cached = [{ ccn: '010001', rows: [{
    npi: '1234567890', organization_name: 'Good Hospital System', parent_name: '',
    other_names: ['Good Hospital 010001'], addresses: [{ address_1: job.address, city: job.city,
      state: 'AL', postal_code: job.zip, telephone_number: job.phone }], practice_locations: [],
    endpoints: [{ endpoint: 'https://portal.good.test/fhir' }]
  }] }];
  const result = nppesCandidateRows([job], cached, { 'system.test': { ccns: ['010002'] } }, roster);
  assert.ok(result.candidates.some(row => row.candidate_domain === 'portal.good.test' && row.sources === 'nppes-endpoint'));
  assert.ok(result.candidates.some(row => row.candidate_domain === 'system.test' && row.sources === 'nppes-sibling'));
});

test('resolved sibling matching stays in state and uses distinctive hospital names', () => {
  const job = { ...hospital('010001'), hospital_name: 'PINE RIDGE NORTH HOSPITAL' };
  const roster = [
    { ccn: '010001', name: job.hospital_name, state: 'AL' },
    { ccn: '010002', name: 'PINE RIDGE SOUTH HOSPITAL', state: 'AL' },
    { ccn: '020001', name: 'PINE RIDGE HOSPITAL', state: 'AK' }
  ];
  const rows = siblingDomainCandidates([job], {
    'pineridge.test': { ccns: ['010002'] }, 'wrongstate.test': { ccns: ['020001'] }
  }, roster);
  assert.ok(rows.some(row => row.candidate_domain === 'pineridge.test'));
  assert.ok(!rows.some(row => row.candidate_domain === 'wrongstate.test'));
});

test('protected pointer email domains are extracted in memory without persisting the email', async t => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'hpt-contact-domain-'));
  t.after(() => fsp.rm(dir, { recursive: true, force: true }));
  const pointerDir = path.join(dir, 'pointers');
  const keyFile = path.join(dir, 'key');
  await fsp.mkdir(pointerDir);
  const key = loadKey({ keyFile, create: true });
  const source = 'location-name: Good Hospital 010001\nmrf-url: https://vendor.test/mrf.csv\ncontact-name: Jane Doe\ncontact-email: jane@good.test\n';
  await fsp.writeFile(path.join(pointerDir, 'system.test.txt'), obfuscatePointerText(source, key).text);
  const result = contactDomainCandidates([hospital('010001')], pointerDir, { keyFile });
  assert.equal(result.candidates[0].candidate_domain, 'good.test');
  assert.doesNotMatch(JSON.stringify(result), /jane@|Jane Doe/i);
  assert.deepEqual(emailDomains('x@gmail.com; y@good.test'), ['good.test']);
});

test('IRS helpers parse quoted index rows and website identity fields', () => {
  assert.deepEqual(parseCsvLine('1,EFILE,123,2025,2026,"GOOD HOSPITAL, INC",990,7,8,BATCH').slice(5, 7),
    ['GOOD HOSPITAL, INC', '990']);
  const row = parseIrsXml('<Return><BusinessNameLine1Txt>Good Hospital</BusinessNameLine1Txt><WebsiteAddressTxt>https://good.test/about</WebsiteAddressTxt><USAddress><AddressLine1Txt>100 Main Street</AddressLine1Txt><CityNm>Dothan</CityNm><StateAbbreviationCd>AL</StateAbbreviationCd><ZIPCd>36301</ZIPCd></USAddress></Return>');
  assert.equal(row.website, 'https://good.test/about');
  assert.equal(row.state, 'AL');
  assert.equal(row.zip, '36301');
});

test('CMS relationship graph links an unresolved CCN only through shared enrollment evidence', () => {
  const jobs = [hospital('010001')];
  const roster = [
    { ccn: '010001', name: jobs[0].hospital_name, state: 'AL' },
    { ccn: '010002', name: 'SIBLING HOSPITAL', state: 'AL' }
  ];
  const files = {
    enrollments: { rows: [
      { 'ENROLLMENT ID': 'E1', CCN: '010001', NPI: '111', 'ASSOCIATE ID': 'PAC1', 'ENROLLMENT STATE': 'AL', 'ORGANIZATION NAME': 'GOOD SYSTEM' },
      { 'ENROLLMENT ID': 'E2', CCN: '010002', NPI: '222', 'ASSOCIATE ID': 'PAC1', 'ENROLLMENT STATE': 'AL', 'ORGANIZATION NAME': 'GOOD SYSTEM' }
    ] }, owners: { rows: [] }, chow: { rows: [] }
  };
  const result = cmsRelationshipCandidates(jobs, files, { 'system.test': { ccns: ['010002'] } }, roster);
  assert.ok(result.candidates.some(row => row.candidate_domain === 'system.test'));
  assert.deepEqual(result.aliases.get('010001'), ['GOOD SYSTEM']);
});

test('parses OSM nodes and ways with website, contact, address, and center', () => {
  const rows = parseOsmElements({ elements: [
    { type: 'node', id: 1, lat: 31.2, lon: -85.4, tags: {
      name: 'Good Hospital', website: 'https://www.good.test/', phone: '+1 334 555 0100',
      'addr:housenumber': '100', 'addr:street': 'Main Street', 'addr:city': 'Dothan',
      'addr:state': 'Alabama', 'addr:postcode': '36301'
    } },
    { type: 'way', id: 2, center: { lat: 31.3, lon: -85.5 }, tags: {
      name: 'Other Hospital', 'contact:website': 'https://other.test/prices'
    } }
  ] });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].domains[0], 'good.test');
  assert.equal(rows[0].state, 'AL');
  assert.match(rows[0].address, /100 Main Street/);
  assert.equal(rows[1].lat, 31.3);
});

test('parses Wikidata coordinates and US subdivision codes', () => {
  const rows = parseWikidataBindings({ results: { bindings: [{
    h: { value: 'https://www.wikidata.org/entity/Q1' },
    hLabel: { value: 'Good Hospital' }, site: { value: 'https://good.test/' },
    coord: { value: 'Point(-85.4 31.2)' }, stateCode: { value: 'US-AL' }
  }] } });
  assert.deepEqual(rows[0].domains, ['good.test']);
  assert.equal(rows[0].state, 'AL');
  assert.equal(rows[0].lat, 31.2);
});

test('uses external phone, address, name, and distance only to generate candidates', () => {
  const job = hospital('010001');
  const rows = candidatesFromExternal([job], [{
    source: 'osm', source_record_url: 'https://osm.test/1', names: ['Good Hospital 010001'],
    address: '100 Main Street, Dothan, AL 36301', city: 'Dothan', state: 'AL',
    zip: '36301', phone: '+1 334 555 0100', lat: 31.2, lon: -85.4, domains: ['good.test']
  }], { '010001': [-85.4, 31.2] });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].phone_match, 'yes');
  assert.equal(rows[0].candidate_domain, 'good.test');
  assert.equal(rows[0].resolved_domain, undefined);
});

test('candidate limiting deduplicates domains and preserves source provenance', () => {
  const job = hospital('010001');
  const rows = [
    candidateRow(job, 'good.test', 'prior', { candidate_score: 20, source_record_url: 'a' }),
    candidateRow(job, 'good.test', 'osm', { candidate_score: 80, source_record_url: 'b' }),
    candidateRow(job, 'other.test', 'heuristic', { candidate_score: 1 })
  ];
  const out = limitCandidates(rows, 8);
  assert.equal(out.length, 2);
  const merged = out.find(row => row.candidate_domain === 'good.test');
  assert.match(merged.sources, /prior/);
  assert.match(merged.sources, /osm/);
  assert.match(merged.source_record_urls, /a\|b|b\|a/);
});

test('verification accepts a location-specific pointer and matching MRF header', async () => {
  const job = candidateRow(hospital('010001'), 'good.test', 'osm', {});
  const result = await verifyDiscoveryCandidate(job, {}, {
    resolveDns: async () => 'ok',
    directGet: async () => ({ status: 403, finalUrl: 'https://good.test/', body: '' }),
    quickPointer: async () => ({ ok: true, url: 'https://good.test/cms-hpt.txt', body:
      'location-name: Good Hospital 010001\nmrf-url: https://good.test/mrf.csv\ncontact-email: person@good.test\n' }),
    probeMrf: async () => ({ rangeStatus: 206, httpStatus: 200, mrfLicenseState: 'AL', requestCount: 2,
      mrfHospitalName: 'Good Hospital 010001', mrfAddress: '100 Main Street, Dothan, AL 36301' })
  });
  assert.equal(result.status, 'verified');
  assert.equal(result.resolved_domain, 'good.test');
  assert.equal(result.mrf_url, 'https://good.test/mrf.csv');
  assert.equal(result.request_count, 4);
});

test('high-confidence LLM alias ruling can satisfy only the pointer-name gate', async () => {
  const job = candidateRow({ ...hospital('010001'), hospital_name: 'NEW OWNER HEALTH' }, 'good.test', 'osm', {});
  const result = await verifyDiscoveryCandidate(job, {
    llmNameMatch: true, llmModel: 'z-ai/glm-5.3-flash'
  }, {
    resolveDns: async () => 'ok',
    directGet: async () => ({ status: 200, finalUrl: 'https://good.test/', body: '<title>New Owner Health Dothan AL</title>' }),
    quickPointer: async () => ({ ok: true, url: 'https://good.test/cms-hpt.txt', body:
      'location-name: Owner Memorial Hospital\nmrf-url: https://good.test/mrf.csv\n' }),
    probeMrf: async () => ({ rangeStatus: 206, httpStatus: 200, mrfLicenseState: 'AL', requestCount: 2,
      mrfHospitalName: 'New Owner Health', mrfAddress: '100 Main Street, Dothan, AL 36301' }),
    adjudicatePair: async () => ({ match: true, confidence: 'high', reason: 'Same address and state.',
      model: 'z-ai/glm-5.3-flash', totalTokens: 42 })
  });
  assert.equal(result.status, 'verified');
  assert.equal(result.llm_name_match, 'yes');
  assert.equal(result.llm_name_confidence, 'high');
  assert.equal(result.llm_name_total_tokens, 42);
});

test('LLM alias ruling cannot waive MRF state disagreement', async () => {
  const job = candidateRow({ ...hospital('010001'), hospital_name: 'NEW OWNER HEALTH' }, 'good.test', 'osm', {});
  const result = await verifyDiscoveryCandidate(job, { llmNameMatch: true }, {
    resolveDns: async () => 'ok',
    directGet: async () => ({ status: 200, finalUrl: 'https://good.test/', body: '' }),
    quickPointer: async () => ({ ok: true, url: 'https://good.test/cms-hpt.txt', body:
      'location-name: Owner Memorial Hospital\nmrf-url: https://good.test/mrf.csv\n' }),
    probeMrf: async () => ({ rangeStatus: 206, httpStatus: 200, mrfLicenseState: 'TX', requestCount: 2 }),
    adjudicatePair: async () => ({ match: true, confidence: 'high', reason: 'Possible rename.' })
  });
  assert.equal(result.status, 'rejected');
  assert.equal(result.reason, 'mrf-license-state-TX-not-AL');
  assert.equal(result.resolved_domain, '');
});

test('LLM rename ruling can resolve an old MRF name at the exact CMS address', async () => {
  const job = candidateRow({ ...hospital('010001'), hospital_name: 'NEW OWNER HEALTH' }, 'good.test', 'osm', {});
  const result = await verifyDiscoveryCandidate(job, { llmNameMatch: true }, {
    resolveDns: async () => 'ok',
    directGet: async () => ({ status: 200, finalUrl: 'https://good.test/', body: '' }),
    quickPointer: async () => ({ ok: true, url: 'https://good.test/cms-hpt.txt', body:
      'location-name: Owner Memorial Hospital\nmrf-url: https://good.test/mrf.csv\n' }),
    probeMrf: async () => ({ rangeStatus: 206, httpStatus: 200, mrfLicenseState: 'AL', requestCount: 2,
      mrfHospitalName: 'Owner Memorial Hospital', mrfAddress: '100 Main St, Dothan, AL 36301' }),
    adjudicatePair: async () => ({ match: true, confidence: 'high', reason: 'Same renamed facility and address.' })
  });
  assert.equal(result.status, 'verified');
});

test('LLM rename ruling cannot waive a conflicting MRF street address', async () => {
  const job = candidateRow({ ...hospital('010001'), hospital_name: 'NEW OWNER HEALTH' }, 'good.test', 'osm', {});
  const result = await verifyDiscoveryCandidate(job, { llmNameMatch: true }, {
    resolveDns: async () => 'ok',
    directGet: async () => ({ status: 200, finalUrl: 'https://good.test/', body: '' }),
    quickPointer: async () => ({ ok: true, url: 'https://good.test/cms-hpt.txt', body:
      'location-name: Owner Memorial Hospital\nmrf-url: https://good.test/mrf.csv\n' }),
    probeMrf: async () => ({ rangeStatus: 206, httpStatus: 200, mrfLicenseState: 'AL', requestCount: 2,
      mrfHospitalName: 'Owner Memorial Hospital', mrfAddress: '900 Other Road, Dothan, AL 36301' }),
    adjudicatePair: async () => ({ match: true, confidence: 'high', reason: 'Possible rename.' })
  });
  assert.equal(result.status, 'review');
  assert.equal(result.reason, 'mrf-header-name-conflicts-with-cms-roster');
});

test('network failures remain separate from contradictory evidence', async () => {
  const fetches = {
    resolveDns: async () => 'network-error',
    directGet: async () => ({ status: 0, finalUrl: '', body: '', bytesRead: 0 }),
    quickPointer: async () => ({ ok: false, reason: 'neterr', bytesRead: 0 })
  };
  const external = await verifyDiscoveryCandidate(candidateRow(hospital('010001'), 'good.test', 'osm', {}), {}, fetches);
  assert.equal(external.status, 'review');
  assert.equal(external.reason, 'network-error');
  const guess = await verifyDiscoveryCandidate(candidateRow(hospital('010001'), 'guess.test', 'heuristic', {}), {}, fetches);
  assert.equal(guess.status, 'none');
  assert.equal(guess.reason, 'network-error');
});

test('LLM candidate prompts contain public identity evidence without pointer contacts', () => {
  const prompt = buildCandidatePrompt(hospital('010001'), {
    candidate_domain: 'good.test', sources: 'osm|wikidata',
    source_names: 'Good Medical Center', source_addresses: '100 Main Street',
    source_phones: '3345550100', distance_km: '0.3', pointer_location_name: ''
  });
  assert.match(prompt, /GOOD HOSPITAL 010001/);
  assert.match(prompt, /Good Medical Center/);
  assert.match(prompt, /0\.3/);
  assert.doesNotMatch(prompt, /contact-email|contact-name/i);
});

test('site-found and generic-name review rows never receive a resolved domain', async () => {
  const specific = candidateRow(hospital('010001'), 'good.test', 'osm', {});
  const site = await verifyDiscoveryCandidate(specific, {}, {
    resolveDns: async () => 'ok',
    directGet: async () => ({ status: 200, finalUrl: 'https://good.test/', body: '<title>Good Hospital 010001 Dothan AL</title>' }),
    quickPointer: async () => ({ ok: false, reason: 'notfound' })
  });
  assert.equal(site.status, 'site-found');
  assert.equal(site.resolved_domain, '');

  const generic = candidateRow({ ...hospital('010002'), hospital_name: 'COMMUNITY HOSPITAL' }, 'generic.test', 'prior', {});
  const review = await verifyDiscoveryCandidate(generic, { duplicateNames: new Set() }, {
    resolveDns: async () => 'ok',
    directGet: async () => ({ status: 200, finalUrl: 'https://generic.test/', body: '<title>Community Hospital</title>' }),
    quickPointer: async () => ({ ok: true, url: 'https://generic.test/cms-hpt.txt', body:
      'location-name: Community Hospital\nmrf-url: https://generic.test/mrf.csv\n' }),
    probeMrf: async () => ({ rangeStatus: 206, httpStatus: 200, mrfLicenseState: 'AL', mrfHospitalName: 'Community Hospital' })
  });
  assert.equal(review.status, 'review');
  assert.equal(review.reason, 'generic-name-needs-location');
  assert.equal(review.resolved_domain, '');
});

test('promotion notes refuse conflicts and require approval for stale replacements', () => {
  const evidence = [
    { ccn: '010001', queue_kind: 'missing', status: 'verified', resolved_domain: 'good.test', mrf_url: 'https://good.test/mrf.csv', pointer_match_score: 1 },
    { ccn: '010002', queue_kind: 'stale', status: 'verified', resolved_domain: 'new.test', mrf_url: 'https://new.test/mrf.csv', pointer_match_score: 1 },
    { ccn: '010003', queue_kind: 'missing', status: 'verified', resolved_domain: 'one.test', mrf_url: 'https://one.test/mrf.csv', pointer_match_score: 1 },
    { ccn: '010003', queue_kind: 'missing', status: 'verified', resolved_domain: 'two.test', mrf_url: 'https://two.test/mrf.csv', pointer_match_score: 1 }
  ];
  const selected = applyPromotionNotes(evidence, { 'old.test': { ccns: ['010002'] } });
  assert.equal(evidence[0].promotion_note, 'eligible');
  assert.equal(evidence[1].promotion_note, 'replacement-needs-approval');
  assert.equal(evidence[2].promotion_note, 'multiple-verified-domains');
  assert.deepEqual(selected.map(row => row.ccn), ['010001', '010002']);
});

test('an already assigned domain remains eligible for manifest recovery', () => {
  const evidence = [{ ccn: '010001', queue_kind: 'name', status: 'verified',
    resolved_domain: 'good.test', mrf_url: 'https://good.test/mrf.csv', pointer_match_score: 1 }];
  const selected = applyPromotionNotes(evidence, { 'good.test': { ccns: ['010001'] } });
  assert.equal(selected.length, 1);
  assert.equal(selected[0].promotion_note, 'already-assigned');
  assert.equal(validatePromotionRows(selected).length, 1);
});

test('promotion validation refuses every non-verified status and unapproved replacements', () => {
  for (const status of ['site-found', 'review', 'blocked', 'rejected', 'none']) {
    assert.throws(() => validatePromotionRows([{ ccn: '010001', status, promotion_note: 'eligible' }]), /Promotion refuses status=/);
  }
  assert.throws(() => validatePromotionRows([{ ccn: '010002', status: 'verified', promotion_note: 'replacement-needs-approval' }]), /replacement-needs-approval/);
  assert.equal(validatePromotionRows([{ ccn: '010002', status: 'verified', promotion_note: 'replacement-needs-approval', approved: 'yes' }]).length, 1);
});

test('manual search queue excludes verified hospitals', () => {
  const jobs = [hospital('010001'), hospital('010002')];
  const statuses = hospitalStatuses(jobs, [{ ccn: '010001', status: 'verified' }, { ccn: '010002', status: 'blocked' }]);
  const manual = manualSearchRows(jobs, statuses);
  assert.equal(manual.length, 1);
  assert.equal(manual[0].ccn, '010002');
  assert.match(manual[0].phone_query, /3345550100/);
});

test('verified pointer snapshots are obfuscated before being written', async t => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'hpt-discovery-'));
  t.after(() => fsp.rm(dir, { recursive: true, force: true }));
  const result = {
    status: 'verified', resolved_domain: 'good.test',
    _pointerBody: 'location-name: Good Hospital\ncontact-name: Jane Doe\ncontact-email: jane@good.test\n'
  };
  const file = await writeProtectedPointer(result, dir);
  const text = await fsp.readFile(file, 'utf8');
  assert.equal(text.includes('Jane Doe'), false);
  assert.equal(text.includes('jane@good.test'), false);
  assert.equal(inspectPointerText(text).plaintext, 0);
});

test('protected pointer archives provide facility leads without decrypting contacts', async t => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'hpt-pointer-leads-'));
  t.after(() => fsp.rm(dir, { recursive: true, force: true }));
  await writeProtectedPointer({ status: 'verified', resolved_domain: 'good.test',
    _pointerBody: 'location-name: Good Hospital 010001\nmrf-url: https://good.test/mrf.csv\ncontact-name: Jane Doe\ncontact-email: jane@good.test\n' }, dir);
  const leads = pointerArchiveCandidates([hospital('010001')], dir);
  assert.equal(leads.length, 1);
  assert.equal(leads[0].candidate_domain, 'good.test');
  assert.equal(leads[0].sources, 'pointers');
});

test('inverse discovery skips represented entries and retains unrepresented MRFs', async t => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'hpt-inverse-pointer-'));
  t.after(() => fsp.rm(dir, { recursive: true, force: true }));
  await fsp.writeFile(path.join(dir, 'system.test.txt'), [
    'location-name: Known Hospital',
    'mrf-url: https://system.test/known.csv',
    'location-name: Renamed Hospital',
    'mrf-url: https://system.test/unrepresented.csv',
    ''
  ].join('\n'));
  const tasks = loadPointerTasks(dir, [{
    mrf_url: 'https://system.test/known.csv', location_name: 'Known Hospital'
  }]);
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].mrfUrl, 'https://system.test/unrepresented.csv');
  assert.equal(tasks[0].refs[0].locationName, 'Renamed Hospital');
});

test('inverse MRF headers create a lead only with state and identity evidence', () => {
  const job = hospital('010001');
  const task = { mrfUrl: 'https://system.test/new.csv', refs: [{
    domain: 'system.test', locationName: 'Former Good Hospital',
    pointerFile: 'data/hpt-audit/pointers/system.test.txt', sourcePageUrl: ''
  }] };
  const matching = candidateLeads([task], [{
    rangeStatus: 206, mrfLicenseState: 'AL', mrfHospitalName: 'Former Good Hospital',
    mrfAddress: '100 Main Street, Dothan, AL 36301'
  }], [job]);
  assert.equal(matching.length, 1);
  assert.equal(matching[0].domain, 'system.test');
  assert.equal(matching[0].evidence.source_mrf_url, task.mrfUrl);
  const wrongState = candidateLeads([task], [{
    rangeStatus: 206, mrfLicenseState: 'TX', mrfHospitalName: 'Former Good Hospital',
    mrfAddress: '100 Main Street, Dothan, AL 36301'
  }], [job]);
  assert.equal(wrongState.length, 0);
});

test('offline CLI stages a deterministic fixture and resumes idempotently', async t => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'hpt-discovery-cli-'));
  t.after(() => fsp.rm(dir, { recursive: true, force: true }));
  const input = path.join(dir, 'gaps.csv');
  const stage = path.join(dir, 'stage');
  await fsp.writeFile(input, 'ccn,hospital_name,address,city,state,zip,phone,type,remediation,seeded_domain\n010001,GOOD HOSPITAL,100 MAIN STREET,DOTHAN,AL,36301,3345550100,Acute Care Hospitals,exa-domain-lookup,\n');
  const script = path.join(__dirname, '..', 'find-domains.js');
  const args = [script, `--input=${input}`, `--stage-dir=${stage}`, '--sources=heuristic', '--offline', '--limit=1'];
  const first = spawnSync(process.execPath, args, { encoding: 'utf8' });
  assert.equal(first.status, 0, first.stderr || first.stdout);
  const firstDomains = csvDomains(path.join(stage, 'candidates.csv'));
  const second = spawnSync(process.execPath, args, { encoding: 'utf8' });
  assert.equal(second.status, 0, second.stderr || second.stdout);
  assert.deepEqual(csvDomains(path.join(stage, 'candidates.csv')), firstDomains);
  const run = JSON.parse(await fsp.readFile(path.join(stage, 'run.json'), 'utf8'));
  assert.equal(run.selected, 1);
  assert.equal(run.canonical_unchanged, true);

  function csvDomains(file) {
    const lines = fs.readFileSync(file, 'utf8').trim().split(/\r?\n/);
    const header = lines.shift().split(',');
    const index = header.indexOf('candidate_domain');
    return lines.map(line => line.split(',')[index]).sort();
  }
});
