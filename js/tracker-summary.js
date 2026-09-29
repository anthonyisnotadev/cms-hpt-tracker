(function (root) {
  'use strict';
  function summarize(data, corrections, today) {
    today = today || new Date().toISOString().slice(0, 10);
    var day = Date.parse(today + 'T00:00:00Z');
    var tiers = data.tiers.map(function (t) { return Object.assign({}, t, { n: 0 }); });
    var tierByKey = Object.fromEntries(tiers.map(function (t) { return [t.key, t]; }));
    var findings = data.findings.filter(function (f) { return !f.manual; }).map(function (f) { return Object.assign({}, f, { n: 0 }); });
    var findingByKey = Object.fromEntries(findings.map(function (f) { return [f.key, f]; }));
    var interventions = data.interventions.filter(function (v) { return !v.manual; }).map(function (v) { return Object.assign({}, v, { n: 0 }); });
    var interventionByKey = Object.fromEntries(interventions.map(function (v) { return [v.key, v]; }));
    var states = data.dict.states.map(function (code) {
      var old = data.states.find(function (s) { return s.code === code; });
      return group({ code: code, name: old ? old.name : code });
    });
    var types = data.dict.types.map(function (name) { return group({ name: name }); });
    var freshness = data.freshness.map(function (b) { return Object.assign({}, b, { n: 0 }); });
    var queue = data.queue.map(function (q) { return Object.assign({}, q, { n: 0 }); });
    var queueByKey = Object.fromEntries(queue.map(function (q) { return [q.key, q]; }));
    var records = {}, ages = [], bytes = 0, filesRead = 0, applied = 0;
    function group(meta) {
      var g = Object.assign({ total: 0, verifiable: 0 }, meta);
      tiers.forEach(function (t) { g[t.key] = 0; });
      return g;
    }
    function add(g, tier) { g.total++; g[tier]++; }
    function fileAge(date, fallback) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(date || '')) {
        var value = Date.parse(date + 'T00:00:00Z');
        if (Number.isFinite(value)) return Math.max(0, Math.floor((day - value) / 86400000));
      }
      return fallback !== null && fallback !== '' && Number.isFinite(Number(fallback)) ? Math.max(0, Number(fallback)) : null;
    }
    data.rows.forEach(function (row) {
      var ccn = row[0], corr = corrections && corrections[ccn];
      var reviewed = data.reviewedAt && data.reviewedAt[ccn];
      if (corr && reviewed && corr.checkedOn && corr.checkedOn.slice(0, 10) < reviewed.slice(0, 10)) corr = null;
      if (corr) applied++;
      var original = findingByKey[data.dict.findings[row[5]]];
      var tier = corr && tierByKey[corr.verdict] ? corr.verdict : original.tier;
      var changedFile = !!(corr && corr.mrfUrl && corr.mrfUrl !== row[8]);
      var changedMetadata = !!(corr && ((corr.lastUpdatedOn && corr.lastUpdatedOn !== row[13])
        || (corr.templateVersion && corr.templateVersion !== row[7])
        || (corr.pointerUrl && corr.pointerUrl !== row[9])));
      var finding = original.key, intervention = data.dict.interventions[row[19]];
      // A local tier correction is not proof of a specific reviewed finding.
      if (tier !== original.tier || changedFile || changedMetadata) {
        finding = intervention = 'manual-' + tier;
        if (!findingByKey[finding]) {
          var label = 'Manual correction: ' + tierByKey[tier].label.toLowerCase();
          var f = { key: finding, tier: tier, label: label, blurb: 'A current manual correction changes the displayed result. The original audit remains in the hospital history.', n: 0, manual: true };
          findingByKey[finding] = f; findings.push(f);
          var v = { key: finding, label: label, plain: f.blurb, action: 'Review the correction and original evidence in the hospital record.', n: 0, manual: true };
          interventionByKey[finding] = v; interventions.push(v);
        }
      }
      var date = corr && corr.lastUpdatedOn || (changedFile ? '' : row[13]);
      var age = fileAge(date, changedFile ? null : row[6]);
      var version = corr && corr.templateVersion || (changedFile ? '' : row[7]);
      var size = changedFile ? null : row[12];
      var mrf = corr && corr.mrfUrl || row[8], ptr = corr && corr.pointerUrl || row[9];
      records[ccn] = { tier: tier, finding: finding, intervention: intervention, age: age, version: version, mrf: mrf, ptr: ptr, corrected: !!corr };
      tierByKey[tier].n++; findingByKey[finding].n++;
      if (interventionByKey[intervention]) interventionByKey[intervention].n++;
      add(states[row[3]], tier); add(types[row[4]], tier);
      if (mrf && (size > 0 || date || version || (!changedFile && row[11]))) filesRead++;
      if (size > 0) bytes += Number(size);
      if (age !== null) {
        ages.push(age);
        freshness.forEach(function (b) { if (age >= b.lo && (b.hi === null || age <= b.hi)) b.n++; });
      }
      var step = data.investigationNextSteps && data.investigationNextSteps[ccn];
      if (step && queueByKey[step.stream]) {
        // Retained findings can still have unresolved evidence tasks. Only a
        // current file-located or exempt correction settles an investigation.
        if (step.stream !== 'genuinely-unresolved-investigation' || !corr || (corr.verdict !== 'compliant' && corr.verdict !== 'exempt')) queueByKey[step.stream].n++;
      }
    });
    function rates(g) {
      g.verifiable = g.compliant + g.failing + g.blocked;
      g.rate = g.verifiable ? g.compliant / g.verifiable : null;
      g.coverage = g.total ? g.verifiable / g.total : 0;
    }
    states.forEach(rates); types.forEach(rates);
    ages.sort(function (a, b) { return a - b; });
    function quantile(q) { return ages.length ? ages[Math.min(ages.length - 1, Math.floor(ages.length * q))] : null; }
    return { records: records, tiers: tiers, findings: findings, interventions: interventions.sort(function (a, b) { return b.n - a.n; }),
      states: states, types: types.sort(function (a, b) { return b.total - a.total; }), freshness: freshness,
      queue: queue.sort(function (a, b) { return b.n - a.n; }),
      totals: { hospitals: data.rows.length, states: states.filter(function (s) { return s.total; }).length, filesRead: filesRead, terabytes: bytes / 1e12,
        medianAge: quantile(.5), p90Age: quantile(.9), maxAge: ages.length ? ages[ages.length - 1] : null, agesCounted: ages.length, corrections: applied } };
  }
  if (typeof module === 'object' && module.exports) module.exports = { summarize: summarize };
  else root.TrackerSummary = { summarize: summarize };
})(typeof window === 'object' ? window : globalThis);
