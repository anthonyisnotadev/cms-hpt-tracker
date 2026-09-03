'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeCcn, normalizeState, discoverCandidates, classifyEvidence,
  verifyCandidate, selectPromotable, mergeVerifiedDomains
} = require('../verify-external-links');

const ROSTER = [
  {
    ccn: '010001', name: 'GOOD HOSPITAL', address: '100 MAIN ST',
    city: 'DOTHAN', state: 'AL', zip: '36301', type: 'Acute Care Hospitals'
  },
  {
    ccn: '020002', name: 'OTHER HOSPITAL', address: '200 MAIN ST',
    city: 'ANCHORAGE', state: 'AK', zip: '99501', type: 'Acute Care Hospitals'
  }
];

test('normalizes CCNs and full state names without guessing malformed values', () => {
  assert.equal(normalizeCcn('10001'), '010001');
  assert.equal(normalizeCcn('CCN 010001'), '010001');
  assert.equal(normalizeCcn('1234567'), '');
  assert.equal(normalizeState('Alabama'), 'AL');
  assert.equal(normalizeState('al'), 'AL');
  assert.equal(normalizeState('unknown'), '');
});

test('uses an external export only for exact CMS identity and public URL leads', () => {
  const rows = [
    {
      'Hospital Name': 'Good Hospital', State: 'Alabama',
      'Hospital Website': 'https://www.good.test/pricing',
      'Vendor Notes': 'secret ranking', 'Vendor URL': 'https://hospitalpricingfiles.org/alabama'
    },
    {
      'Hospital Name': 'Other Hospital', State: 'AK',
      'MRF URL': 'https://files.blob.core.windows.net/prices/file.csv'
    },
    {
      'Hospital Name': 'Almost Good Hospital', State: 'AL',
      URL: 'https://almost.test/file.csv'
    }
  ];
  const out = discoverCandidates(rows, ROSTER);
  assert.equal(out.candidates.length, 1);
  assert.deepEqual(out.candidates[0], {
    ccn: '010001', hospital_name: 'GOOD HOSPITAL', address: '100 MAIN ST',
    city: 'DOTHAN', state: 'AL', zip: '36301', type: 'Acute Care Hospitals',
    domain: 'good.test', lead_url: 'https://www.good.test/pricing',
    mapping_method: 'exact-name-state', source_row: 2
  });
  assert.equal(out.unmapped.find(row => row.hospital_name === 'OTHER HOSPITAL').reason, 'no-hospital-domain-url');
  assert.equal(out.unmapped.find(row => row.hospital_name === 'Almost Good Hospital').reason, 'no-exact-cms-name-state-match');
  assert.equal(JSON.stringify(out.candidates).includes('secret ranking'), false);
});

test('skips hospitals already represented in the manifest unless requested', () => {
  const rows = [{ CCN: '010001', Website: 'https://good.test/' }];
  const out = discoverCandidates(rows, ROSTER, { coveredCcns: new Set(['010001']) });
  assert.equal(out.candidates.length, 0);
  assert.equal(out.stats.covered, 1);
  const included = discoverCandidates(rows, ROSTER, {
    coveredCcns: new Set(['010001']), includeKnown: true
  });
  assert.equal(included.candidates.length, 1);
});

test('verifier ignores the lead file URL and re-discovers the MRF from cms-hpt.txt', async () => {
  let probedUrl = '';
  const candidate = {
    ccn: '010001', hospital_name: 'GOOD HOSPITAL', address: '100 MAIN ST',
    city: 'DOTHAN', state: 'AL', zip: '36301', type: 'Acute Care Hospitals',
    domain: 'good.test', lead_url: 'https://good.test/untrusted-export-file.csv'
  };
  const result = await verifyCandidate(candidate, {}, {
    directGet: async () => ({ status: 200, finalUrl: 'https://good.test/', body: '<title>Good Hospital</title>' }),
    fetchPointer: async () => ({
      ok: true, url: 'https://good.test/cms-hpt.txt', finalUrl: 'https://good.test/cms-hpt.txt',
      via: 'direct', body: 'location-name: Good Hospital\nmrf-url: https://good.test/official.csv\nsource-page-url: https://good.test/pricing'
    }),
    probeMrf: async url => {
      probedUrl = url;
      return {
        checkedAt: '2026-09-03T00:00:00.000Z', httpStatus: 200, rangeStatus: 206,
        fileKind: 'csv', contentType: 'text/csv', mrfLicenseState: 'AL',
        mrfHospitalName: 'Good Hospital', declaredLastUpdated: '2026-08-01', cmsVersion: '3.0.0'
      };
    }
  });
  assert.equal(probedUrl, 'https://good.test/official.csv');
  assert.equal(result.mrf_url, 'https://good.test/official.csv');
  assert.equal(result.status, 'verified');
  assert.equal(result.reason, 'hospital-site-pointer-and-mrf-header-agree');
  assert.equal(Object.prototype.hasOwnProperty.call(result, 'lead_url'), false);
});

test('MRF header state is required and a mismatch is rejected', () => {
  const hospital = { hospital_name: 'GOOD HOSPITAL', state: 'AL' };
  const home = { status: 200 };
  const pointer = { ok: true };
  const best = {
    exact: true, score: 1, strictScore: 1,
    entry: { mrfUrl: 'https://good.test/official.csv' }
  };
  assert.deepEqual(classifyEvidence({ home, pointer, best, probe: { rangeStatus: 206 }, hospital }),
    { status: 'review', reason: 'mrf-header-has-no-license-state' });
  assert.deepEqual(classifyEvidence({
    home, pointer, best, probe: { rangeStatus: 206, mrfLicenseState: 'GA' }, hospital
  }), { status: 'rejected', reason: 'mrf-license-state-GA-not-AL' });
});

test('external link verification can treat homepage reachability as diagnostic', () => {
  const hospital = { hospital_name: 'GOOD HOSPITAL', state: 'AL' };
  const verdict = classifyEvidence({
    home: { status: 403 },
    pointer: { ok: true },
    best: {
      exact: true, score: 1, strictScore: 1,
      entry: { mrfUrl: 'https://good.test/official.csv' }
    },
    probe: { rangeStatus: 206, mrfLicenseState: 'AL', mrfHospitalName: 'Good Hospital' },
    hospital,
    requireHomepage: false
  });
  assert.equal(verdict.status, 'verified');
});

test('same-state generic names with a conflicting MRF ZIP require review', () => {
  const common = {
    home: { status: 200 }, pointer: { ok: true }, requireHomepage: false,
    best: {
      exact: true, score: 1, strictScore: 1,
      entry: { locationName: 'Good Samaritan Hospital', mrfUrl: 'https://good.test/official.csv' }
    },
    hospital: {
      hospital_name: 'GOOD SAMARITAN HOSPITAL, LP', city: 'BAKERSFIELD',
      state: 'CA', zip: '93308'
    }
  };
  const verdict = classifyEvidence({
    ...common,
    probe: {
      rangeStatus: 206, mrfLicenseState: 'CA', mrfHospitalName: 'Good Samaritan Hospital',
      mrfLocationName: 'Good Samaritan Hospital', mrfAddress: '2425 Samaritan Drive, San Jose, CA 95124'
    }
  });
  assert.deepEqual(verdict, {
    status: 'review', reason: 'mrf-header-location-conflicts-with-cms-roster'
  });
});

test('a facility name naming the roster city can override a corporate MRF ZIP', () => {
  const verdict = classifyEvidence({
    home: { status: 200 }, pointer: { ok: true }, requireHomepage: false,
    best: {
      exact: true, score: 1, strictScore: 1,
      entry: { locationName: 'UCI Health - Lakewood', mrfUrl: 'https://uci.test/official.json' }
    },
    hospital: { hospital_name: 'UCI HEALTH-LAKEWOOD', city: 'LAKEWOOD', state: 'CA', zip: '90712' },
    probe: {
      rangeStatus: 206, mrfLicenseState: 'CA', mrfHospitalName: 'UCI Health - Lakewood',
      mrfAddress: '101 City Drive South, Orange, CA 92868'
    }
  });
  assert.equal(verdict.status, 'verified');
});

test('weak pointer identity is rejected without probing an unrelated sibling MRF', async () => {
  let probes = 0;
  const candidate = {
    ccn: '010001', hospital_name: 'GOOD HOSPITAL', address: '100 MAIN ST',
    city: 'DOTHAN', state: 'AL', zip: '36301', type: 'Acute Care Hospitals',
    domain: 'shared.test', lead_url: 'https://shared.test/file.csv'
  };
  const result = await verifyCandidate(candidate, {}, {
    directGet: async () => ({ status: 200, finalUrl: 'https://shared.test/', body: '<title>Shared System</title>' }),
    fetchPointer: async () => ({
      ok: true, url: 'https://shared.test/cms-hpt.txt', finalUrl: 'https://shared.test/cms-hpt.txt',
      body: 'location-name: Unrelated Medical Center\nmrf-url: https://shared.test/unrelated.csv'
    }),
    probeMrf: async () => { probes++; return { rangeStatus: 206, mrfLicenseState: 'AL' }; }
  });
  assert.equal(result.reason, 'cms-hpt-does-not-name-hospital');
  assert.equal(probes, 0);
});

test('promotion refuses conflicting or multiple domains and preserves provenance', () => {
  const evidence = [
    { ccn: '010001', status: 'verified', resolved_domain: 'new.test', pointer_match_score: 1 },
    { ccn: '020002', status: 'verified', resolved_domain: 'a.test', pointer_match_score: 1 },
    { ccn: '020002', status: 'verified', resolved_domain: 'b.test', pointer_match_score: 1 }
  ];
  const domains = {
    'old.test': { domain: 'old.test', ccns: ['010001'], source: 'open-data' },
    'keep.test': { domain: 'keep.test', ccns: ['999999'], source: 'manual' }
  };
  assert.deepEqual(selectPromotable(evidence, domains), []);
  assert.match(evidence[0].promotion_note, /^existing-domain:/);
  assert.equal(evidence[1].promotion_note, 'multiple-verified-domains');

  const selected = [{ ccn: '030003', resolved_domain: 'keep.test' }];
  const merged = mergeVerifiedDomains(domains, selected);
  assert.equal(merged.added, 1);
  assert.deepEqual(merged.domains['keep.test'].ccns, ['030003', '999999']);
  assert.equal(merged.domains['keep.test'].source, 'manual');
});
