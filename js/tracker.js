(function () {
  'use strict';

  var D = JSON.parse(document.getElementById('tracker-data').textContent);
  var $ = function (id) { return document.getElementById(id); };
  var fmt = new Intl.NumberFormat('en-US');
  var TIER_OF = {};
  D.findings.forEach(function (f) { TIER_OF[f.key] = f.tier; });
  var TIER_META = {};
  D.tiers.forEach(function (t) { TIER_META[t.key] = t; });

  function pct(n, d) { return d ? (100 * n / d) : 0; }
  function pct1(n, d) { return pct(n, d).toFixed(1) + '%'; }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  // CMS records every hospital name in caps. Title-casing makes 5,419 rows
  // readable, but naively lowercasing turns UPMC into "Upmc" — so keep known
  // initialisms, plus anything short and vowelless, in caps.
  var SMALL_WORD = /^(of|and|the|at|for|in|on|to|a|an|by|de|del|la)$/;
  var ACRONYM = /^(VA|HCA|CHI|SSM|ARH|UPMC|CAH|LLC|INC|LLP|PC|USA|UF|UC|UCSF|UCLA|USC|NYU|LSU|UAB|OSF|UNC|UT|UTMB|WVU|ECU|VCU|MUSC|UMC|UMMC|JPS|SCL|HSHS|MHS|IHS|DOD|AFB|JFK|LDS|OU|SIU|SUNY|TMC|UNM|UVA|WCA|II|III|IV)$/;
  var NOT_ACRONYM = /^(ST|MT|DR|FT|JR|SR|MC|BROS)$/;

  function titleCase(s) {
    var first = true;
    return String(s == null ? '' : s).replace(/[A-Za-z0-9']+/g, function (w) {
      var up = w.toUpperCase();
      var isFirst = first;
      first = false;
      if (ACRONYM.test(up)) return up;
      if (!NOT_ACRONYM.test(up) && up.length >= 2 && up.length <= 5
          && /^[A-Z]+$/.test(up) && !/[AEIOUY]/.test(up)) return up;
      var lower = w.toLowerCase();
      if (!isFirst && SMALL_WORD.test(lower)) return lower;
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    });
  }

  /* ---------- tooltip ---------- */
  var tip = $('tip');
  function showTip(html, ev) {
    tip.innerHTML = html;
    tip.classList.add('on');
    moveTip(ev);
  }
  function moveTip(ev) {
    var pad = 14;
    var r = tip.getBoundingClientRect();
    var x = ev.clientX + pad;
    var y = ev.clientY + pad;
    if (x + r.width > window.innerWidth - 8) x = ev.clientX - r.width - pad;
    if (y + r.height > window.innerHeight - 8) y = ev.clientY - r.height - pad;
    tip.style.left = Math.max(8, x) + 'px';
    tip.style.top = Math.max(8, y) + 'px';
  }
  function hideTip() { tip.classList.remove('on'); }
  document.addEventListener('scroll', hideTip, true);

  /* ---------- dateline ---------- */
  var T = D.totals;
  var snapshot = D.generated
    ? new Date(D.generated + 'T12:00:00Z').toLocaleDateString('en-US',
        { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' })
    : 'unknown';
  $('sf-total').textContent = fmt.format(T.hospitals);
  $('dl-date').textContent = snapshot;
  $('dl-n').textContent = fmt.format(T.hospitals);
  $('dl-states').textContent = T.states;
  $('dl-files').textContent = fmt.format(T.filesRead);

  /* ---------- how old is this page? ----------
     The snapshot date alone does not tell a reader whether to trust the page;
     the distance from today does. So the age is computed in the browser rather
     than baked in at build time, and past a month the standing notice escalates
     instead of quietly going stale. */
  var STALE_DAYS = 30;
  var snapshotAge = (function () {
    if (!D.generated) return null;
    var then = Date.parse(D.generated + 'T12:00:00Z');
    if (!Number.isFinite(then)) return null;
    // Compare noon-to-noon UTC so a reader's timezone never shifts the count.
    var now = new Date();
    var today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 12);
    return Math.max(0, Math.round((today - then) / 86400000));
  })();

  // Days up to two months, then months, then years. The cut is at 60 rather
  // than 45 so the first month reading is "2 months" — rounding 45 days down to
  // "1 month" understates the age at exactly the point a reader starts caring.
  function ageSpan(days) {
    if (days < 60) return { n: days, unit: 'day' };
    // Both cuts are on days, not on the rounded value, so the wording only ever
    // climbs: 59 days, 2 months, ... 18 months, 2 years.
    if (days < 548) return { n: Math.round(days / 30.44), unit: 'month' };
    return { n: Math.round(days / 365.25), unit: 'year' };
  }

  function humanAge(days) {
    if (days === 0) return 'today';
    if (days === 1) return 'yesterday';
    var s = ageSpan(days);
    return s.n + ' ' + s.unit + (s.n === 1 ? '' : 's') + ' ago';
  }

  function elapsedPhrase(days) {
    if (days === 0) return 'Nothing has been re-checked since';
    var s = ageSpan(days);
    return 'Nothing has been re-checked in the '
      + (s.n === 1 ? '' : s.n + ' ') + s.unit + (s.n === 1 ? '' : 's') + ' since';
  }

  if (snapshotAge !== null) {
    var stale = snapshotAge > STALE_DAYS ? '1' : '0';
    $('dl-age').textContent = '(' + humanAge(snapshotAge) + ')';
    $('dl-date').setAttribute('data-stale', stale);
    $('notice-age').textContent = elapsedPhrase(snapshotAge);
    $('snapshot-notice').setAttribute('data-stale', stale);
  }

  /* ---------- verdict ---------- */
  var byTier = {};
  D.tiers.forEach(function (t) { byTier[t.key] = t.n; });
  var judged = byTier.compliant + byTier.failing;
  var reached = judged + byTier.blocked;

  // "unknown" is drawn hollow rather than filled — the one tier that is an
  // absence of information gets an absence of ink.
  var SOLID = { compliant: 1, failing: 1, blocked: 1, exempt: 1, unknown: 0 };
  var maxTier = Math.max.apply(null, D.tiers.map(function (t) { return t.n; }));

  $('field-n').textContent = fmt.format(T.hospitals);

  $('legend').innerHTML = D.tiers.map(function (t) {
    var solid = SOLID[t.key];
    return '<button class="readout-row" type="button" data-key="' + t.key + '" role="row">'
      + '<span class="readout-mark sw-' + t.key + '" data-solid="' + solid + '"></span>'
      + '<span class="readout-name">' + t.label + '<small>' + t.note + '</small></span>'
      + '<span class="readout-n">' + fmt.format(t.n) + '</span>'
      + '<span class="readout-pct">' + pct(t.n, T.hospitals).toFixed(1) + '%</span>'
      + '<span class="readout-bar"><i class="sw-' + t.key + '" data-solid="' + solid + '"'
      + ' style="width:' + (100 * t.n / maxTier).toFixed(2) + '%"></i></span>'
      + '</button>';
  }).join('');

  $('readout-foot').innerHTML =
    'Of the <b>' + fmt.format(judged) + '</b> hospitals the crawl reached and could judge, '
    + '<b>' + pct(byTier.compliant, judged).toFixed(1) + '%</b> had a live, current file. '
    + 'But that rate only covers the solid marks. <b>' + fmt.format(byTier.unknown) + '</b> hospitals '
    + '&mdash; ' + pct1(byTier.unknown, T.hospitals) + ' of the registry, and the single largest bloc '
    + 'in the data &mdash; have no working website on record, so nobody knows either way.';

  function tierTip(key) {
    var t = TIER_META[key];
    return '<b>' + t.label + '</b><span class="tn">' + fmt.format(t.n) + '</span> hospitals &middot; '
      + '<span class="tn">' + pct1(t.n, T.hospitals) + '</span> of the registry';
  }
  [].forEach.call(document.querySelectorAll('.readout-row'), function (el) {
    el.addEventListener('mouseenter', function (ev) { showTip(tierTip(el.dataset.key), ev); });
    el.addEventListener('mousemove', moveTip);
    el.addEventListener('mouseleave', hideTip);
  });

  /* ---------- tiles ---------- */
  var over = D.freshness[D.freshness.length - 1].n;
  $('tiles').innerHTML = [
    { l: 'Pointer files fetched', v: fmt.format(T.hospitals), n: 'one request per hospital on the registry' },
    { l: 'Charge files read', v: fmt.format(T.filesRead), n: 'headers parsed for version and update date' },
    { l: 'Data downloaded', v: T.terabytes >= 1 ? T.terabytes.toFixed(2) + ' TB' : Math.round(T.terabytes * 1000) + ' GB',
      n: 'across the charge files that answered' },
    { l: 'Median file age', v: T.medianAge + ' days', n: over + ' files are past the twelve-month mark' }
  ].map(function (t) {
    return '<div class="tile"><div class="t-label">' + t.l + '</div>'
      + '<div class="t-value">' + t.v + '</div><div class="t-note">' + t.n + '</div></div>';
  }).join('');

  /* ---------- findings ---------- */
  var maxF = Math.max.apply(null, D.findings.map(function (f) { return f.n; }));
  $('finding-list').innerHTML = D.findings.slice().sort(function (a, b) { return b.n - a.n; })
    .map(function (f) {
      return '<div class="finding">'
        + '<span class="f-stripe" data-tier="' + f.tier + '"></span>'
        + '<span class="f-name">' + f.label + '<span class="f-blurb">' + f.blurb + '</span></span>'
        + '<span class="f-track"><span class="f-fill" data-tier="' + f.tier + '" style="width:'
        + (100 * f.n / maxF).toFixed(2) + '%"></span></span>'
        + '<span class="f-n">' + fmt.format(f.n) + '</span>'
        + '</div>';
    }).join('');

  /* ---------- freshness ---------- */
  var maxBin = Math.max.apply(null, D.freshness.map(function (b) { return b.n; }));
  $('hist').innerHTML = D.freshness.map(function (b) {
    var isOver = b.hi === null ? 1 : 0;
    return '<div class="hist-row" data-over="' + isOver + '">'
      + '<span class="hist-label">' + b.label + '</span>'
      + '<span class="hist-track"><span class="hist-fill" style="width:'
      + (100 * b.n / maxBin).toFixed(2) + '%"></span></span>'
      + '<span class="hist-n">' + fmt.format(b.n) + '</span>'
      + '</div>';
  }).join('');
  $('quantiles').innerHTML = [
    ['Median', T.medianAge + 'd'],
    ['90th percentile', T.p90Age + 'd'],
    ['Oldest', T.maxAge + 'd']
  ].map(function (q) { return '<div><b>' + q[1] + '</b>' + q[0] + '</div>'; }).join('');

  /* ---------- mini stacked bar ---------- */
  function mini(row) {
    return '<span class="state-mini">' + D.tiers.map(function (t) {
      var n = row[t.key] || 0;
      if (!n) return '';
      return '<i data-tier="' + t.key + '" style="flex:' + n + ' 1 0"></i>';
    }).join('') + '</span>';
  }

  /* ---------- types ---------- */
  $('type-table').querySelector('tbody').innerHTML = D.types.map(function (t) {
    return '<tr><td>' + esc(t.name) + '</td><td>' + mini(t) + '</td>'
      + '<td class="t-right num">' + fmt.format(t.total) + '</td>'
      + '<td class="t-right rate">' + (t.rate == null ? '&mdash;' : (100 * t.rate).toFixed(0) + '%') + '</td></tr>';
  }).join('');

  /* ---------- states ---------- */
  var stateSort = { key: 'total', dir: -1 };
  var stateBody = $('state-table').querySelector('tbody');

  function renderStates() {
    var rows = D.states.slice().sort(function (a, b) {
      var x = a[stateSort.key], y = b[stateSort.key];
      // States with nothing to measure sink to the bottom either way, so
      // sorting ascending surfaces the worst real rate rather than the blanks.
      if (x == null && y == null) return 0;
      if (x == null) return 1;
      if (y == null) return -1;
      if (typeof x === 'string') return stateSort.dir * x.localeCompare(y);
      return stateSort.dir * (x - y);
    });
    stateBody.innerHTML = rows.map(function (s) {
      var r = s.rate == null ? null : 100 * s.rate;
      // A rate computed on under half the state is a sample, not a verdict.
      var thin = s.coverage < 0.5;
      var note = thin
        ? ' title="Measured on only ' + s.verifiable + ' of ' + s.total + ' hospitals in ' + s.name + '"'
        : '';
      return '<tr>'
        + '<td><b>' + esc(s.name) + '</b></td>'
        + '<td>' + mini(s) + '</td>'
        + '<td class="t-right num">' + fmt.format(s.total) + '</td>'
        + '<td class="t-right num' + (thin ? ' thin' : '') + '">' + (100 * s.coverage).toFixed(0) + '%</td>'
        + '<td class="t-right rate' + (thin ? ' thin' : '') + '"' + note + '>'
        + '<span class="rate-bar"><i style="width:' + (r == null ? 0 : r).toFixed(1) + '%"></i></span>'
        + (r == null ? '&mdash;' : r.toFixed(1) + '%')
        + (thin ? '<abbr title="Fewer than half the hospitals in this state could be reached, so treat the rate as a sample.">*</abbr>' : '')
        + '</td>'
        + '</tr>';
    }).join('');
  }
  [].forEach.call($('state-table').querySelectorAll('th.sortable'), function (th) {
    th.addEventListener('click', function () {
      var key = th.dataset.key;
      stateSort.dir = stateSort.key === key ? -stateSort.dir : (key === 'name' ? 1 : -1);
      stateSort.key = key;
      [].forEach.call($('state-table').querySelectorAll('th.sortable'), function (o) {
        o.setAttribute('aria-sort', o === th ? (stateSort.dir === 1 ? 'ascending' : 'descending') : 'none');
      });
      renderStates();
    });
  });
  renderStates();

  /* ---------- queue ---------- */
  $('queue-cards').innerHTML = D.queue.map(function (q) {
    return '<div class="q-card">'
      + '<div class="q-n">' + fmt.format(q.n) + '</div>'
      + '<div class="q-label">' + q.label + '</div>'
      + '<p class="q-why">' + q.why + '</p>'
      + '<p class="q-action">' + q.action + '</p>'
      + '</div>';
  }).join('');

  /* ---------- register ---------- */
  var C = { CCN: 0, NAME: 1, CITY: 2, STATE: 3, TYPE: 4, FIND: 5, DAYS: 6, TMPL: 7, MRF: 8, PTR: 9, EV: 10, FMT: 11, BYTES: 12, UPD: 13 };
  var findingMeta = D.dict.findings.map(function (k) {
    return D.findings.filter(function (f) { return f.key === k; })[0];
  });

  // One lowercase haystack per row, built once.
  var hay = D.rows.map(function (r) {
    return (r[C.NAME] + ' ' + r[C.CITY] + ' ' + D.dict.states[r[C.STATE]] + ' ' + r[C.CCN]).toLowerCase();
  });

  var sel = { q: '', state: '', type: '', tiers: {}, outreach: '', stage: '', finding: '', age: '', links: '', corrected: '' };
  var filtered = D.rows.map(function (_, i) { return i; });

  var stateSelect = $('f-state');
  D.states.slice().sort(function (a, b) { return a.name.localeCompare(b.name); }).forEach(function (s) {
    var o = document.createElement('option');
    o.value = s.code; o.textContent = s.name;
    stateSelect.appendChild(o);
  });
  var typeSelect = $('f-type');
  D.types.forEach(function (t) {
    var o = document.createElement('option');
    o.value = t.name; o.textContent = t.name;
    typeSelect.appendChild(o);
  });
  var findingSelect = $('f-finding');
  D.findings.forEach(function (f) {
    var o = document.createElement('option');
    o.value = f.key; o.textContent = f.label;
    findingSelect.appendChild(o);
  });
  // Bucket bounds come from the same freshness bins the histogram draws, so
  // the two never drift apart. Value is just the bin's index.
  var ageSelect = $('f-age');
  D.freshness.forEach(function (b, i) {
    var o = document.createElement('option');
    o.value = String(i); o.textContent = b.label;
    ageSelect.appendChild(o);
  });

  // Audit tiers first, then the outreach filters. They read as one row of
  // chips but answer different questions, so a separator keeps them apart.
  var OC_CHIPS = [
    { key: 'any', label: 'Has outreach' },
    { key: 'awaiting-reply', label: 'Awaiting reply' },
    { key: 'due', label: 'Follow-up due' },
    { key: 'corrected', label: 'Corrected by me' },
    { key: 'none', label: 'Not contacted' },
  ];

  $('tier-chips').innerHTML = D.tiers.map(function (t) {
    return '<button class="chip" type="button" data-key="' + t.key + '" aria-pressed="false">'
      + '<span class="dot sw-' + t.key + '"></span>' + t.label
      + ' <span class="cn">' + fmt.format(t.n) + '</span></button>';
  }).join('')
    + '<span class="chip-sep" aria-hidden="true"></span>'
    + OC_CHIPS.map(function (c) {
      return '<button class="chip oc-chip" type="button" data-oc="' + c.key + '" aria-pressed="false">'
        + c.label + ' <span class="cn" data-count="' + c.key + '">0</span></button>';
    }).join('');

  [].forEach.call($('tier-chips').querySelectorAll('.chip[data-key]'), function (btn) {
    btn.addEventListener('click', function () {
      var k = btn.dataset.key;
      sel.tiers[k] = !sel.tiers[k];
      btn.setAttribute('aria-pressed', sel.tiers[k] ? 'true' : 'false');
      applyFilters();
    });
  });
  [].forEach.call($('tier-chips').querySelectorAll('.oc-chip'), function (btn) {
    btn.addEventListener('click', function () {
      var k = btn.dataset.oc;
      sel.outreach = sel.outreach === k ? '' : k;
      [].forEach.call($('tier-chips').querySelectorAll('.oc-chip'), function (b) {
        b.setAttribute('aria-pressed', b.dataset.oc === sel.outreach ? 'true' : 'false');
      });
      applyFilters();
    });
  });

  function anyTier() {
    for (var k in sel.tiers) if (sel.tiers[k]) return true;
    return false;
  }

  // True when the hospital matches the active outreach chip.
  function matchesOutreach(ccn, mode) {
    var rec = OC.get(ccn);
    if (mode === 'any') return !!rec && (rec.entries || []).length > 0;
    if (mode === 'none') return !rec || !(rec.entries || []).length;
    if (mode === 'awaiting-reply') return !!rec && rec.status === 'awaiting-reply';
    if (mode === 'due') return !!rec && isDue(rec);
    if (mode === 'corrected') return !!(rec && rec.correction);
    return true;
  }

  // "Where this stands" is the drawer's own stage field, not the coarser
  // outreach chips above — this matches it exactly, including "not contacted".
  function matchesStage(ccn, stage) {
    var rec = OC.get(ccn);
    return (rec ? rec.status : 'none') === stage;
  }

  function matchesAge(days, binIdx) {
    if (days == null) return false;
    var b = D.freshness[binIdx];
    if (!b) return true;
    return days >= b.lo && (b.hi == null || days <= b.hi);
  }

  function matchesLinks(r, mode) {
    var hasPtr = !!r[C.PTR], hasMrf = !!r[C.MRF];
    if (mode === 'no-ptr') return !hasPtr;
    if (mode === 'no-mrf') return !hasMrf;
    if (mode === 'neither') return !hasPtr && !hasMrf;
    return true;
  }

  /* ---------- sorting the register ----------
     Six columns, three states each: the column's useful direction first, then
     its reverse, then back to registry order — which is CCN order, so it
     arrives as one block per state and is worth being able to get back to.
     Sorting runs on the filtered index list, not on all 5,419 rows. */

  // Status sorts by how much attention a row wants, not by the legend's order:
  // the reason to sort this column is to bring the unfinished work up.
  var STATUS_ORDER = ['failing', 'blocked', 'unknown', 'exempt', 'compliant'];

  var SORTS = [
    { key: 'status', label: 'Status', first: 1, up: 'needs attention first', down: 'compliant first' },
    { key: 'name', label: 'Hospital', first: 1, up: 'A–Z', down: 'Z–A' },
    { key: 'finding', label: 'Finding', first: 1, up: 'compliant findings first', down: 'exempt findings first' },
    { key: 'age', label: 'File age', first: -1, up: 'newest first', down: 'oldest first' },
    { key: 'links', label: 'Links', first: 1, up: 'fewest first', down: 'most first' },
    { key: 'outreach', label: 'Outreach', first: -1, up: 'least logged first', down: 'most logged first' },
  ];
  var SORT_OF = {};
  SORTS.forEach(function (s) { SORT_OF[s.key] = s; });

  var regSort = { key: '', dir: 1 };
  var sortStale = false;   // an outreach edit landed while the drawer was open

  // Numeric collation so "St. Mary 2" follows "St. Mary 1" rather than
  // "St. Mary 10", and so case never decides the order of two names.
  var collator = window.Intl && Intl.Collator
    ? new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
    : null;
  function collate(a, b) { return collator ? collator.compare(a, b) : a.localeCompare(b); }

  // What a column sorts on. Corrections win over the crawl here exactly as
  // they do in the row itself, so the order matches what is on screen.
  function sortValue(key, i) {
    var r = D.rows[i];
    var corr = correctionOf(r[C.CCN]);
    if (key === 'status') {
      var tier = (corr && corr.verdict) || findingMeta[r[C.FIND]].tier;
      var n = STATUS_ORDER.indexOf(tier);
      return n < 0 ? STATUS_ORDER.length : n;
    }
    if (key === 'name') return String(r[C.NAME] || '');
    if (key === 'finding') return r[C.FIND];
    if (key === 'age') {
      var d = r[C.DAYS];
      if (corr && corr.lastUpdatedOn) {
        var cd = daysSince(corr.lastUpdatedOn);
        if (cd != null) d = cd;
      }
      return d == null ? null : d;
    }
    if (key === 'links') {
      return (((corr && corr.mrfUrl) || r[C.MRF]) ? 1 : 0)
        + (((corr && corr.pointerUrl) || r[C.PTR]) ? 1 : 0);
    }
    if (key === 'outreach') {
      var rec = OC.get(r[C.CCN]);
      return rec ? (rec.entries || []).length : 0;
    }
    return 0;
  }

  function sortFiltered() {
    if (!regSort.key) return;
    var key = regSort.key, dir = regSort.dir;
    // Decorate first: sortValue reads the outreach store, which is too much
    // work to repeat inside a comparator that runs n log n times.
    var keyed = filtered.map(function (i) { return { i: i, v: sortValue(key, i) }; });
    keyed.sort(function (a, b) {
      var x = a.v, y = b.v;
      // A row with no readable date has no place on an age scale, so it sinks
      // in both directions rather than pretending to be new or old.
      if (x == null && y == null) return a.i - b.i;
      if (x == null) return 1;
      if (y == null) return -1;
      var c = typeof x === 'string' ? collate(x, y) : x - y;
      // Ties break on registry order, not on where the row happens to sit
      // now — otherwise re-sorting the already-sorted list drifts.
      return c ? dir * c : a.i - b.i;
    });
    filtered = keyed.map(function (k) { return k.i; });
  }

  function sortNote() {
    if (!regSort.key) return '';
    var s = SORT_OF[regSort.key];
    return s.label.toLowerCase() + ', ' + (regSort.dir === 1 ? s.up : s.down);
  }

  var regHeadBtns = [].slice.call(document.querySelectorAll('.reg-head .rh'));
  var regSortSelect = $('reg-sort');
  regSortSelect.innerHTML = '<option value="">Registry order</option>'
    + SORTS.map(function (s) {
      return '<option value="' + s.key + ':' + s.first + '">' + esc(s.label + ' — ' + (s.first === 1 ? s.up : s.down)) + '</option>'
        + '<option value="' + s.key + ':' + (-s.first) + '">' + esc(s.label + ' — ' + (s.first === 1 ? s.down : s.up)) + '</option>';
    }).join('');

  function paintSort() {
    regHeadBtns.forEach(function (b) {
      var s = SORT_OF[b.dataset.key];
      var on = regSort.key === s.key;
      var dir = on ? regSort.dir : s.first;
      var how = dir === 1 ? s.up : s.down;
      b.setAttribute('data-sorted', on ? '1' : '0');
      b.querySelector('.rh-arrow').textContent = dir === 1 ? '▲' : '▼';
      b.setAttribute('aria-label', on
        ? s.label + ', sorted ' + how + '. Activate to sort ' + (dir === 1 ? s.down : s.up) + '.'
        : s.label + ', not sorted. Activate to sort ' + how + '.');
      b.title = on ? 'Sorted ' + how : 'Sort ' + how;
    });
    regSortSelect.value = regSort.key ? regSort.key + ':' + regSort.dir : '';
  }

  regHeadBtns.forEach(function (b) {
    b.addEventListener('click', function () {
      var s = SORT_OF[b.dataset.key];
      if (regSort.key !== s.key) { regSort.key = s.key; regSort.dir = s.first; }
      else if (regSort.dir === s.first) { regSort.dir = -s.first; }
      else { regSort.key = ''; regSort.dir = 1; }   // third click: registry order
      paintSort();
      applyFilters();
    });
  });
  regSortSelect.addEventListener('change', function () {
    var v = regSortSelect.value.split(':');
    regSort.key = SORT_OF[v[0]] ? v[0] : '';
    regSort.dir = Number(v[1]) === -1 ? -1 : 1;
    paintSort();
    applyFilters();
  });
  paintSort();

  // Re-order in place after the outreach store changes: same rows, same scroll
  // position, only the order of what is already on screen.
  function resort() {
    if (!regSort.key) return;
    sortFiltered();
    layout();
  }

  function applyFilters() {
    var q = sel.q.trim().toLowerCase();
    var stateIdx = sel.state ? D.dict.states.indexOf(sel.state) : -1;
    var typeIdx = sel.type ? D.dict.types.indexOf(sel.type) : -1;
    var useTier = anyTier();
    var out = [];
    for (var i = 0; i < D.rows.length; i++) {
      var r = D.rows[i];
      if (stateIdx >= 0 && r[C.STATE] !== stateIdx) continue;
      if (typeIdx >= 0 && r[C.TYPE] !== typeIdx) continue;
      if (useTier && !sel.tiers[findingMeta[r[C.FIND]].tier]) continue;
      if (sel.outreach && !matchesOutreach(r[C.CCN], sel.outreach)) continue;
      if (sel.stage && !matchesStage(r[C.CCN], sel.stage)) continue;
      if (sel.finding && findingMeta[r[C.FIND]].key !== sel.finding) continue;
      if (sel.age !== '' && !matchesAge(r[C.DAYS], Number(sel.age))) continue;
      if (sel.links && !matchesLinks(r, sel.links)) continue;
      if (sel.corrected && (!!correctionOf(r[C.CCN])) !== (sel.corrected === 'yes')) continue;
      if (q && hay[i].indexOf(q) === -1) continue;
      out.push(i);
    }
    filtered = out;
    sortFiltered();
    var line = fmt.format(out.length) + ' of ' + fmt.format(D.rows.length) + ' hospitals';
    if (regSort.key) line += ' · sorted by ' + sortNote();
    if (!out.length) line += ' — try a broader filter';
    else if (narrow.matches && out.length > MOBILE_CAP) {
      line += ' — showing the first ' + MOBILE_CAP + ', search to narrow';
    }
    $('result-line').textContent = line;
    $('reg-empty').hidden = out.length > 0;
    viewport.scrollTop = 0;
    layout();
  }

  var viewport = $('reg-viewport');
  var canvas = $('reg-canvas');
  var regHead = document.querySelector('.reg-head');
  var ROW_H = 58;
  var OVERSCAN = 6;
  var MOBILE_CAP = 60;
  var narrow = window.matchMedia('(max-width: 760px)');

  // Days between an ISO date and today, or null if the date is unusable.
  function daysSince(iso) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso || ''))) return null;
    var then = Date.parse(iso + 'T00:00:00Z');
    if (isNaN(then)) return null;
    return Math.max(0, Math.floor((Date.now() - then) / 86400000));
  }

  // The correction a user recorded for this hospital, if any.
  function correctionOf(ccn) {
    var rec = OC && OC.get(ccn);
    return (rec && rec.correction) || null;
  }

  function ageCell(r, corr) {
    var d = r[C.DAYS];
    var edited = false;
    if (corr && corr.lastUpdatedOn) {
      var cd = daysSince(corr.lastUpdatedOn);
      if (cd != null) { d = cd; edited = true; }
    }
    if (d == null) return '<span class="cell-age"><span class="dash">&mdash;</span></span>';
    var cls = 'cell-age' + (d > 365 ? ' stale' : '') + (edited ? ' edited' : '');
    return '<span class="' + cls + '"' + (edited ? ' title="From your correction, not the crawl"' : '')
      + '>' + d + 'd' + (edited ? '<sup>*</sup>' : '') + '</span>';
  }

  // Compact outreach marker: counts if there is a file, "Log" if there isn't.
  function outreachCell(ccn) {
    var rec = OC.get(ccn);
    var entries = rec ? (rec.entries || []) : [];
    var label = 'Log';
    var has = '0';
    if (entries.length) {
      var mails = entries.filter(function (e) { return e.kind === 'email'; }).length;
      var notes = entries.length - mails;
      var bits = [];
      if (mails) bits.push(mails + 'e');
      if (notes) bits.push(notes + 'n');
      label = bits.join(' ');
      has = '1';
    }
    var due = rec && isDue(rec) ? '1' : '0';
    var title = rec
      ? OC_STAGE_LABEL[rec.status] + (rec.followUpOn ? ' · follow up ' + rec.followUpOn : '')
      : 'No notes or emails logged yet';
    return '<span class="cell-outreach">'
      + '<button class="oc-btn" type="button" data-ccn="' + esc(ccn) + '"'
      + ' data-has="' + has + '" data-due="' + due + '" title="' + esc(title) + '">'
      + '<span class="oc-mark"></span>' + label + '</button></span>';
  }

  function rowHtml(i, top, band) {
    var r = D.rows[i];
    var f = findingMeta[r[C.FIND]];
    var corr = correctionOf(r[C.CCN]);

    // A correction can override the verdict, but it is always badged as yours.
    var tier = f.tier;
    var short = TIER_META[tier].short;
    var badgeExtra = '';
    if (corr && corr.verdict) {
      tier = corr.verdict;
      short = TIER_META[tier].short;
      badgeExtra = ' data-edited="1" title="Your correction of '
        + esc(corr.checkedOn || '') + ' — the crawl found: ' + esc(f.label) + '"';
    }

    var mrf = (corr && corr.mrfUrl) || r[C.MRF];
    var ptr = (corr && corr.pointerUrl) || r[C.PTR];
    var edited = corr && (corr.mrfUrl || corr.pointerUrl) ? ' data-edited="1"' : '';
    var links = '';
    if (mrf) links += '<a class="linkbtn"' + edited + ' href="' + esc(mrf) + '" target="_blank" rel="noopener noreferrer">FILE</a>';
    if (ptr) links += '<a class="linkbtn"' + edited + ' href="' + esc(ptr) + '" target="_blank" rel="noopener noreferrer">PTR</a>';
    if (!links) links = '<span class="linkbtn" style="border-color:transparent;color:var(--ink-3)">&mdash;</span>';

    var why = corr && corr.verdict
      ? '<b>' + esc(TIER_META[tier].label) + ' &mdash; your correction</b><span>'
        + esc(corr.note || ('Crawl found: ' + f.label)) + '</span>'
      : '<b>' + f.label + '</b><span>' + esc(r[C.EV] || f.blurb) + '</span>';

    return '<div class="reg-row" data-band="' + (band ? 1 : 0) + '"'
      + (narrow.matches ? '' : ' style="top:' + top + 'px"') + '>'
      + '<span class="badge" data-tier="' + tier + '"' + badgeExtra + '><span class="dot"></span>'
      + short + '</span>'
      + '<span class="cell-name oc-open" data-ccn="' + esc(r[C.CCN]) + '"><b>' + esc(titleCase(r[C.NAME])) + '</b>'
      + '<span>' + esc(titleCase(r[C.CITY])) + ', ' + D.dict.states[r[C.STATE]] + ' &middot; ' + esc(r[C.CCN]) + '</span></span>'
      + '<span class="cell-why">' + why + '</span>'
      + ageCell(r, corr)
      + '<span class="cell-links">' + links + '</span>'
      + outreachCell(r[C.CCN])
      + '</div>';
  }

  function layout() {
    if (narrow.matches) {
      regHead.style.paddingRight = '';
      // Small screens get a plain capped list; virtualising a variable-height
      // stack is not worth the jank on a phone.
      var slice = filtered.slice(0, MOBILE_CAP);
      canvas.style.height = 'auto';
      canvas.innerHTML = slice.map(function (i, n) { return rowHtml(i, 0, n % 2); }).join('');
      return;
    }
    // Size the canvas first: the scrollbar only exists once the content is
    // tall enough, and the header (which sits outside the scroll container)
    // has to be padded by exactly that width or its columns drift off the rows'.
    canvas.style.height = (filtered.length * ROW_H) + 'px';
    var sbw = viewport.offsetWidth - viewport.clientWidth;
    regHead.style.paddingRight = (14 + Math.max(0, sbw)) + 'px';

    var start = Math.max(0, Math.floor(viewport.scrollTop / ROW_H) - OVERSCAN);
    var count = Math.ceil(viewport.clientHeight / ROW_H) + OVERSCAN * 2;
    var end = Math.min(filtered.length, start + count);
    var html = '';
    for (var k = start; k < end; k++) html += rowHtml(filtered[k], k * ROW_H, k % 2);
    canvas.innerHTML = html;
  }

  var ticking = false;
  viewport.addEventListener('scroll', function () {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(function () { layout(); ticking = false; });
  });
  window.addEventListener('resize', layout);
  if (narrow.addEventListener) narrow.addEventListener('change', layout);

  var qInput = $('q');
  var debounce;
  qInput.addEventListener('input', function () {
    clearTimeout(debounce);
    debounce = setTimeout(function () { sel.q = qInput.value; applyFilters(); }, 120);
  });
  stateSelect.addEventListener('change', function () { sel.state = stateSelect.value; applyFilters(); });
  typeSelect.addEventListener('change', function () { sel.type = typeSelect.value; applyFilters(); });
  findingSelect.addEventListener('change', function () { sel.finding = findingSelect.value; applyFilters(); });
  ageSelect.addEventListener('change', function () { sel.age = ageSelect.value; applyFilters(); });
  $('f-links').addEventListener('change', function () { sel.links = $('f-links').value; applyFilters(); });
  $('f-corrected').addEventListener('change', function () { sel.corrected = $('f-corrected').value; applyFilters(); });

  // Clicking a row of the readout jumps to the register, filtered to that tier.
  [].forEach.call(document.querySelectorAll('.readout-row'), function (el) {
    el.addEventListener('click', function () {
      var k = el.dataset.key;
      D.tiers.forEach(function (t) { sel.tiers[t.key] = (t.key === k); });
      [].forEach.call($('tier-chips').querySelectorAll('.chip[data-key]'), function (b) {
        b.setAttribute('aria-pressed', b.dataset.key === k ? 'true' : 'false');
      });
      applyFilters();
      $('register').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });

  /* ================= outreach ================= */

  var OC = window.Outreach;
  var OC_STAGE_LABEL = {
    'none': 'Not contacted',
    'contacted': 'Contacted',
    'awaiting-reply': 'Awaiting reply',
    'replied': 'They replied',
    'resolved': 'Resolved',
    'no-response': 'No response',
  };
  var OC_OUTCOME_LABEL = {
    'none': 'No reply yet',
    'replied': 'Replied',
    'bounced': 'Bounced',
    'no-response': 'No response',
  };

  var stageSelect = $('f-stage');
  OC.STATUSES.forEach(function (s) {
    var o = document.createElement('option');
    o.value = s; o.textContent = OC_STAGE_LABEL[s];
    stageSelect.appendChild(o);
  });
  stageSelect.addEventListener('change', function () { sel.stage = stageSelect.value; applyFilters(); });

  function todayStr() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0')
      + '-' + String(d.getDate()).padStart(2, '0');
  }
  // A follow-up only counts as due while the thread is still open.
  function isDue(rec) {
    if (!rec || !rec.followUpOn) return false;
    if (rec.status === 'resolved' || rec.status === 'no-response') return false;
    return rec.followUpOn <= todayStr();
  }

  // CCN -> index into D.rows, so the drawer can show audit context.
  var rowByCcn = {};
  for (var ri = 0; ri < D.rows.length; ri++) rowByCcn[D.rows[ri][C.CCN]] = ri;

  function hospitalOf(ccn) {
    var i = rowByCcn[ccn];
    if (i == null) return null;
    var r = D.rows[i];
    return {
      ccn: ccn,
      name: titleCase(r[C.NAME]),
      city: titleCase(r[C.CITY]),
      state: D.dict.states[r[C.STATE]],
      finding: findingMeta[r[C.FIND]],
      evidence: r[C.EV],
      days: r[C.DAYS],
      mrf: r[C.MRF],
      ptr: r[C.PTR],
    };
  }

  /* ---- email template, tailored to what the audit actually found ---- */
  var TEMPLATE_BY_FINDING = {
    'mrf-url-unreachable': 'The link in your cms-hpt.txt file points to a standard charges file that we could not retrieve — the URL returns an error. Could you confirm the correct location, or update the pointer file?',
    'mrf-stale-over-365-days': 'The standard charges file we retrieved was last updated more than twelve months ago. 45 CFR 180.50 asks for an update at least once a year. Is a newer version available?',
    'old-template-version': 'The standard charges file we retrieved declares an older CMS template version. The current schema is 3.0.0. Is an updated file available?',
    'no-cms-hpt-txt-published': 'We could reach your website, but found no cms-hpt.txt pointer file at the root or under /.well-known/. Could you confirm where your machine-readable standard charges file is published?',
    'pointer-blocked-to-automation': 'Requests for your cms-hpt.txt file are being refused (HTTP 403/429), which prevents automated retrieval of your standard charges file. Could you confirm the file is publicly reachable without a browser?',
    'mrf-blocked-to-automation': 'Your pointer file resolves, but the standard charges file itself refuses automated requests. Could you confirm it is reachable without a browser?',
    'not-assessed-domain-unknown': 'We are compiling published hospital standard charges files and could not find a website on record for your facility. Could you point us to where your machine-readable file is published?',
    'not-assessed-site-unreachable': 'We were unable to reach the website we have on record for your facility. Could you confirm the correct domain and where your machine-readable standard charges file is published?',
    // Deliberately not phrased as a compliance complaint: the omission may be
    // ours. We found their system's file and simply could not see this hospital
    // in it, so the ask is which entry corresponds to this facility.
    'not-assessed-not-named-in-file': 'We located a cms-hpt.txt pointer file on your health system’s website, but we could not find an entry that corresponds to this facility. Could you tell us which location entry covers it, or where its own machine-readable file is published?',
    'compliant-date-unverified': 'We retrieved your standard charges file successfully, but could not read a last_updated_on value from it, so we cannot tell when it was last refreshed. Could you confirm the date it was last updated?',
    'pointer-lists-no-mrf-url': 'Your cms-hpt.txt names this facility, but the entry does not include an mrf-url pointing at the standard charges file. 45 CFR 180.50(d)(6) asks for a direct link. Could you add it, or tell us where the file lives?',
  };

  function templateFor(h) {
    var lines = [
      'Hello,',
      '',
      'I am writing about the machine-readable standard charges file that '
        + h.name + ' publishes under the Hospital Price Transparency rule (45 CFR 180).',
      '',
      TEMPLATE_BY_FINDING[h.finding.key]
        || 'I am compiling published hospital standard charges files and had a question about yours.',
    ];
    if (h.evidence) lines.push('', 'What we observed: ' + h.evidence);
    if (h.ptr) lines.push('Pointer file: ' + h.ptr);
    if (h.mrf) lines.push('Charges file: ' + h.mrf);
    lines.push('', 'Thank you,', '');
    return {
      subject: 'Price transparency file — ' + h.name + ' (CCN ' + h.ccn + ')',
      body: lines.join('\n'),
    };
  }

  /* ---- drawer ---- */
  var drawer = $('oc-drawer');
  var scrim = $('oc-scrim');
  var openCcn = null;
  var lastFocus = null;

  $('oc-status').innerHTML = OC.STATUSES.map(function (s) {
    return '<option value="' + s + '">' + OC_STAGE_LABEL[s] + '</option>';
  }).join('');

  function drawerRecord() { return (openCcn && OC.get(openCcn)) || null; }

  // Which entry is open for editing, if any. Held here rather than in the DOM so
  // a re-render from any other write keeps the form open with what you typed
  // still on screen — and cleared whenever the drawer changes hospital.
  var editingId = null;

  function outcomeOptions(selected) {
    return OC.OUTCOMES.map(function (o) {
      return '<option value="' + o + '"' + (o === selected ? ' selected' : '') + '>'
        + OC_OUTCOME_LABEL[o] + '</option>';
    }).join('');
  }

  /* The edit form deliberately does not offer the entry kind, the id or the
     logged-at time: none of them can change, which is the whole point of editing
     in place rather than deleting and retyping. */
  function entryForm(e) {
    var f = '<div class="oc-ev-form">';
    if (e.kind === 'email') {
      f += '<div class="oc-field"><label for="oc-e-subject">Subject</label>'
        + '<input id="oc-e-subject" type="text" value="' + esc(e.subject) + '"></div>'
        + '<div class="oc-ev-row">'
        + '<div class="oc-field"><label for="oc-e-to">To</label>'
        + '<input id="oc-e-to" type="text" value="' + esc(e.to) + '"></div>'
        + '<div class="oc-field"><label for="oc-e-sent">Sent</label>'
        + '<input id="oc-e-sent" type="date" value="' + esc(e.sentAt) + '"></div>'
        + '</div>'
        + '<div class="oc-field"><label for="oc-e-outcome">Reply status</label>'
        + '<select id="oc-e-outcome">' + outcomeOptions(e.outcome) + '</select></div>'
        + '<div class="oc-field"><label for="oc-e-body">Body</label>'
        + '<textarea id="oc-e-body" spellcheck="true">' + esc(e.body) + '</textarea></div>';
    } else {
      f += '<div class="oc-field"><label for="oc-e-text">Note</label>'
        + '<textarea id="oc-e-text" spellcheck="true">' + esc(e.text) + '</textarea></div>';
    }
    return f + '<div class="oc-actions">'
      + '<button class="oc-action" type="button" id="oc-e-save">Save changes</button>'
      + '<button class="oc-action ghost" type="button" id="oc-e-cancel">Cancel</button>'
      + '</div><p class="oc-hint" id="oc-e-state"></p></div>';
  }

  function renderTimeline() {
    var rec = drawerRecord();
    var entries = rec ? (rec.entries || []) : [];
    if (!entries.length) {
      $('oc-timeline').innerHTML = '<p class="oc-hint">Nothing logged yet.</p>';
      return;
    }
    // An entry can be deleted while its form is open — from here or from the
    // terminal. Drop the flag rather than rendering a form for nothing.
    if (editingId && !entries.some(function (e) { return e.id === editingId; })) editingId = null;

    $('oc-timeline').innerHTML = entries.map(function (e) {
      var editing = e.id === editingId;
      var when = e.kind === 'email' ? (e.sentAt || String(e.at).slice(0, 10)) : String(e.at).slice(0, 10);
      var head = '<div class="oc-ev-top">'
        + '<span class="oc-ev-kind" data-kind="' + e.kind + '">' + (e.kind === 'email' ? 'Email' : 'Note') + '</span>'
        + (e.editedAt ? '<span class="oc-ev-edited">edited ' + esc(String(e.editedAt).slice(0, 10)) + '</span>' : '')
        + '<span class="oc-ev-when">' + esc(when) + '</span></div>';
      var open = '<div class="oc-ev" data-id="' + esc(e.id) + '"'
        + (editing ? ' data-editing="1"' : '') + '>' + head;
      if (editing) return open + entryForm(e) + '</div>';

      var foot = '<div class="oc-ev-foot">'
        + (e.kind === 'email'
          ? '<select class="oc-outcome" data-id="' + esc(e.id) + '" aria-label="Reply status">'
            + outcomeOptions(e.outcome) + '</select>'
          : '')
        + '<button class="oc-edit" type="button" data-id="' + esc(e.id) + '">Edit</button>'
        + '<button class="oc-del" type="button" data-id="' + esc(e.id) + '">Delete</button>'
        + '</div>';

      if (e.kind === 'email') {
        return open
          + '<p class="oc-ev-subject">' + esc(e.subject) + '</p>'
          + (e.to ? '<p class="oc-ev-to">to ' + esc(e.to) + '</p>' : '')
          + (e.body ? '<p class="oc-ev-text">' + esc(e.body) + '</p>' : '')
          + foot + '</div>';
      }
      return open + '<p class="oc-ev-text">' + esc(e.text) + '</p>' + foot + '</div>';
    }).join('');
  }

  function renderDrawer(force) {
    if (!openCcn) return;
    var h = hospitalOf(openCcn);
    var rec = drawerRecord();
    $('oc-title').textContent = h ? h.name : openCcn;
    // The snapshot date rides along in the subtitle: this drawer is where
    // someone decides to act on a label, so it is where "as of when" matters
    // most.
    $('oc-subtitle').textContent = (h
      ? (h.city + ', ' + h.state + ' · CCN ' + h.ccn)
      : ('CCN ' + openCcn))
      + (D.generated ? ' · crawled ' + snapshot : '');

    var corr = rec && rec.correction;
    var tags = '';
    if (h) {
      // Show the standing verdict first. When that is a correction, the crawl's
      // original finding stays visible beside it rather than being replaced.
      var tier = corr && corr.verdict ? corr.verdict : h.finding.tier;
      tags += '<span class="badge" data-tier="' + tier + '"'
        + (corr && corr.verdict ? ' data-edited="1" title="Your correction"' : '')
        + '><span class="dot"></span>' + TIER_META[tier].short + '</span>';
      if (corr && corr.verdict && corr.verdict !== h.finding.tier) {
        tags += '<span class="oc-stage" title="What the crawl found on '
          + esc(D.generated) + '">Crawl: ' + esc(TIER_META[h.finding.tier].short) + '</span>';
      }
      tags += '<span class="oc-stage" data-stage="' + (rec ? rec.status : 'none') + '">'
        + OC_STAGE_LABEL[rec ? rec.status : 'none'] + '</span>';
      var ptr = (corr && corr.pointerUrl) || h.ptr;
      var mrf = (corr && corr.mrfUrl) || h.mrf;
      if (ptr) tags += '<a class="linkbtn"' + (corr && corr.pointerUrl ? ' data-edited="1"' : '')
        + ' href="' + esc(ptr) + '" target="_blank" rel="noopener noreferrer">POINTER</a>';
      if (mrf) tags += '<a class="linkbtn"' + (corr && corr.mrfUrl ? ' data-edited="1"' : '')
        + ' href="' + esc(mrf) + '" target="_blank" rel="noopener noreferrer">FILE</a>';
    }
    $('oc-tags').innerHTML = tags;
    $('oc-status').value = rec ? rec.status : 'none';
    $('oc-followup').value = rec ? (rec.followUpOn || '') : '';
    fillCorrection(force);
    renderTimeline();
  }

  function openDrawer(ccn) {
    openCcn = ccn;
    lastFocus = document.activeElement;
    var h = hospitalOf(ccn);
    // Pre-fill the compose fields but leave them editable; a fresh draft each
    // time is friendlier than restoring a half-finished one.
    $('oc-to').value = '';
    $('oc-sent').value = todayStr();
    if (h) {
      var t = templateFor(h);
      $('oc-subject').value = t.subject;
      $('oc-body').value = '';
    } else {
      $('oc-subject').value = '';
      $('oc-body').value = '';
    }
    $('oc-note').value = '';
    // An entry form left open belongs to the hospital you were just looking at.
    editingId = null;
    // A different hospital's correction must replace whatever is in the form.
    renderDrawer(true);
    drawer.hidden = false;
    scrim.hidden = false;
    // Next frame so the transform transition actually runs.
    requestAnimationFrame(function () {
      drawer.classList.add('on');
      scrim.classList.add('on');
      $('oc-close').focus();
    });
    document.addEventListener('keydown', onDrawerKey);
  }

  function closeDrawer() {
    if (!openCcn) return;
    openCcn = null;
    // An edit made in the drawer can change where its row belongs in the
    // current sort. Moving it while you are still typing would be hostile,
    // so the re-order waits until the drawer is out of the way.
    if (sortStale) { sortStale = false; resort(); }
    drawer.classList.remove('on');
    scrim.classList.remove('on');
    document.removeEventListener('keydown', onDrawerKey);
    window.setTimeout(function () {
      if (!openCcn) { drawer.hidden = true; scrim.hidden = true; }
    }, 220);
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  function onDrawerKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); closeDrawer(); return; }
    if (e.key !== 'Tab') return;
    // Keep tabbing inside the drawer while it is modal.
    var f = drawer.querySelectorAll('a[href], button, input, select, textarea');
    var list = [].filter.call(f, function (el) { return !el.disabled && el.offsetParent !== null; });
    if (!list.length) return;
    var first = list[0], last = list[list.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  scrim.addEventListener('click', closeDrawer);
  $('oc-close').addEventListener('click', closeDrawer);

  // Rows are re-rendered constantly by the virtualiser, so delegate.
  canvas.addEventListener('click', function (e) {
    var target = e.target.closest ? e.target.closest('.oc-btn, .oc-open') : null;
    if (target && target.dataset.ccn) openDrawer(target.dataset.ccn);
  });

  function seedFields() {
    var h = hospitalOf(openCcn);
    return h ? { name: h.name, city: h.city, state: h.state } : {};
  }

  function warn(err) {
    console.error('[outreach]', err);
    window.alert('Could not save: ' + (err && err.message ? err.message : err));
  }

  // The store coerces silently — a URL without a scheme is stored empty, a long
  // body is clipped at 8000 characters. It reports what it dropped; without this
  // the field just quietly empties and the save looks clean.
  function showDiscards(slotId, prefix) {
    var slot = $(slotId);
    if (!slot) return false;
    var msgs = OC.lastDiscards();
    slot.textContent = msgs.length ? (prefix || 'Saved, but ') + msgs.join('; ') + '.' : '';
    return msgs.length > 0;
  }

  $('oc-status').addEventListener('change', function () {
    OC.upsert(openCcn, Object.assign({ status: $('oc-status').value }, seedFields())).catch(warn);
  });
  $('oc-followup').addEventListener('change', function () {
    OC.upsert(openCcn, Object.assign({ followUpOn: $('oc-followup').value }, seedFields())).catch(warn);
  });
  // Nudges from whatever is already in the field (today if it's empty), so
  // clicking it again keeps pushing the date forward.
  $('oc-followup-30').addEventListener('click', function () {
    var cur = $('oc-followup').value;
    var base = /^\d{4}-\d{2}-\d{2}$/.test(cur) ? new Date(cur + 'T00:00:00') : new Date();
    base.setDate(base.getDate() + 30);
    var next = base.getFullYear() + '-' + String(base.getMonth() + 1).padStart(2, '0')
      + '-' + String(base.getDate()).padStart(2, '0');
    $('oc-followup').value = next;
    OC.upsert(openCcn, Object.assign({ followUpOn: next }, seedFields())).catch(warn);
  });
  // Emptying a native date field is fiddly enough that people give up on it, so
  // dropping the follow-up gets its own button.
  $('oc-followup-clear').addEventListener('click', function () {
    $('oc-followup').value = '';
    OC.upsert(openCcn, Object.assign({ followUpOn: '' }, seedFields())).catch(warn);
  });

  /* ---- corrections ---- */
  var VERDICT_LABEL = {
    '': 'Leave as the audit found it',
    'compliant': 'Compliant — file found and current',
    'failing': 'Not compliant',
    'blocked': 'Blocked to automation',
    'exempt': 'Exempt',
    'unknown': 'Still unknown',
  };
  $('oc-c-verdict').innerHTML = OC.VERDICTS.map(function (v) {
    return '<option value="' + v + '">' + VERDICT_LABEL[v] + '</option>';
  }).join('');

  // Anything that writes to the store re-renders the drawer, and refilling
  // these inputs from the saved record would wipe a half-typed correction —
  // change the stage or nudge the follow-up date mid-edit and the work is gone.
  // So the fields are only repopulated when they are not being edited, or when
  // the caller forces it: opening the drawer, and saving or clearing.
  var CORRECTION_FIELDS = ['oc-c-domain', 'oc-c-ptr', 'oc-c-mrf', 'oc-c-updated',
    'oc-c-version', 'oc-c-verdict', 'oc-c-checked', 'oc-c-note'];
  var correctionDirty = false;
  CORRECTION_FIELDS.forEach(function (id) {
    $(id).addEventListener('input', function () { correctionDirty = true; });
    $(id).addEventListener('change', function () { correctionDirty = true; });
  });

  function fillCorrection(force) {
    var corr = (drawerRecord() || {}).correction || null;
    if (force || !correctionDirty) {
      $('oc-c-domain').value = corr ? corr.domain : '';
      $('oc-c-ptr').value = corr ? corr.pointerUrl : '';
      $('oc-c-mrf').value = corr ? corr.mrfUrl : '';
      $('oc-c-updated').value = corr ? corr.lastUpdatedOn : '';
      $('oc-c-version').value = corr ? corr.templateVersion : '';
      $('oc-c-verdict').value = corr ? corr.verdict : '';
      $('oc-c-checked').value = corr ? (corr.checkedOn || todayStr()) : todayStr();
      $('oc-c-note').value = corr ? corr.note : '';
      correctionDirty = false;
    }
    var age = corr && corr.lastUpdatedOn ? daysSince(corr.lastUpdatedOn) : null;
    $('oc-c-state').textContent = corr
      ? ('Correction saved ' + (corr.checkedOn || '') + (age == null ? ''
          : ' · file is ' + age + ' days old' + (age > 365 ? ', past the twelve-month mark' : ', within the year')))
      : 'No correction recorded. The register shows what the crawl found.';
  }

  $('oc-c-save').addEventListener('click', function () {
    // Capture what was typed before saving: re-rendering the drawer replaces
    // the field values with the normalised ones, and a field that failed
    // validation comes back empty. Comparing the two is how we can tell the
    // user something was dropped rather than losing it silently.
    var typed = {
      domain: $('oc-c-domain').value.trim(),
      pointerUrl: $('oc-c-ptr').value.trim(),
      mrfUrl: $('oc-c-mrf').value.trim(),
    };
    OC.setCorrection(openCcn, Object.assign({
      domain: typed.domain,
      pointerUrl: typed.pointerUrl,
      mrfUrl: typed.mrfUrl,
      lastUpdatedOn: $('oc-c-updated').value,
      templateVersion: $('oc-c-version').value,
      verdict: $('oc-c-verdict').value,
      checkedOn: $('oc-c-checked').value || todayStr(),
      note: $('oc-c-note').value,
    }, seedFields())).then(function () {
      // Saved, so the normalised values are now the truth to show.
      renderDrawer(true);
      showDiscards('oc-c-state');
    }).catch(warn);
  });

  $('oc-c-clear').addEventListener('click', function () {
    if (!window.confirm('Remove your correction and show what the crawl found?')) return;
    OC.setCorrection(openCcn, { clear: true })
      .then(function () { renderDrawer(true); }).catch(warn);
  });

  $('oc-template').addEventListener('click', function () {
    var h = hospitalOf(openCcn);
    if (!h) return;
    var t = templateFor(h);
    $('oc-subject').value = t.subject;
    $('oc-body').value = t.body;
  });

  $('oc-compose').addEventListener('click', function () {
    var to = $('oc-to').value.trim();
    var url = 'mailto:' + encodeURIComponent(to)
      + '?subject=' + encodeURIComponent($('oc-subject').value)
      + '&body=' + encodeURIComponent($('oc-body').value);
    // Very long drafts get truncated by some mail clients; warn rather than
    // silently handing over a clipped message.
    if (url.length > 1800) {
      if (!window.confirm('This draft is long enough that some mail clients will truncate it. Open it anyway?')) return;
    }
    window.location.href = url;
  });

  $('oc-save-email').addEventListener('click', function () {
    var subject = $('oc-subject').value.trim();
    if (!subject) { $('oc-subject').focus(); return; }
    OC.addEntry(openCcn, Object.assign({
      kind: 'email',
      to: $('oc-to').value.trim(),
      subject: subject,
      body: $('oc-body').value,
      sentAt: $('oc-sent').value || todayStr(),
    }, seedFields())).then(function () {
      $('oc-to').value = '';
      $('oc-body').value = '';
      renderDrawer();
      showDiscards('oc-email-state');
    }).catch(warn);
  });

  $('oc-save-note').addEventListener('click', function () {
    var text = $('oc-note').value.trim();
    if (!text) { $('oc-note').focus(); return; }
    OC.addEntry(openCcn, Object.assign({ kind: 'note', text: text }, seedFields()))
      .then(function () {
        $('oc-note').value = '';
        renderDrawer();
        showDiscards('oc-note-state');
      })
      .catch(warn);
  });

  $('oc-timeline').addEventListener('change', function (e) {
    var s = e.target.closest ? e.target.closest('.oc-outcome') : null;
    if (s) OC.setOutcome(openCcn, s.dataset.id, s.value).then(renderDrawer).catch(warn);
  });
  $('oc-timeline').addEventListener('click', function (e) {
    if (!e.target.closest) return;

    var edit = e.target.closest('.oc-edit');
    if (edit) {
      editingId = edit.dataset.id;
      renderTimeline();
      var first = $('oc-timeline').querySelector('.oc-ev-form input, .oc-ev-form textarea');
      if (first) first.focus();
      return;
    }

    if (e.target.closest('#oc-e-cancel')) { editingId = null; renderTimeline(); return; }

    if (e.target.closest('#oc-e-save')) {
      var rec = drawerRecord();
      var entry = rec && (rec.entries || []).filter(function (x) { return x.id === editingId; })[0];
      if (!entry) { editingId = null; renderTimeline(); return; }
      // Only the fields this kind actually holds — handing an email field to a
      // note would be reported as an unknown field rather than ignored.
      var fields = entry.kind === 'email'
        ? {
          subject: $('oc-e-subject').value,
          to: $('oc-e-to').value,
          sentAt: $('oc-e-sent').value,
          outcome: $('oc-e-outcome').value,
          body: $('oc-e-body').value,
        }
        : { text: $('oc-e-text').value };
      OC.editEntry(openCcn, editingId, fields).then(function () {
        // Stay in the form when something was coerced, so the message has
        // somewhere to land and you can see what the field became. Render before
        // reporting, or the re-render wipes the slot the message goes into.
        var coerced = OC.lastDiscards().length > 0;
        if (!coerced) editingId = null;
        renderDrawer();
        if (coerced) showDiscards('oc-e-state');
      }).catch(warn);
      return;
    }

    var b = e.target.closest('.oc-del');
    if (!b) return;
    if (!window.confirm('Delete this entry? This cannot be undone.')) return;
    OC.deleteEntry(openCcn, b.dataset.id).then(renderDrawer).catch(warn);
  });

  /* ---- page-level outreach section ---- */

  function ocItem(ccn, title, meta, when, over, dismiss) {
    var item = '<button class="oc-item" type="button" data-ccn="' + esc(ccn) + '">'
      + '<b>' + esc(title) + '</b>'
      + '<span class="oc-when' + (over ? ' over' : '') + '">' + esc(when) + '</span>'
      + '<span class="oc-meta">' + esc(meta) + '</span>'
      + '</button>';
    if (!dismiss) return item;
    return '<div class="oc-item-row">' + item
      + '<button class="oc-item-x" type="button" data-clear="' + esc(ccn) + '"'
      + ' title="Drop the follow-up date for ' + esc(title) + '"'
      + ' aria-label="Drop the follow-up date for ' + esc(title) + '">Clear</button></div>';
  }

  function nameFor(ccn, rec) {
    var h = hospitalOf(ccn);
    return h ? h.name : (rec && rec.name) || ccn;
  }

  function renderOutreachSection() {
    var all = OC.all();
    var withActivity = all.filter(function (r) { return (r.entries || []).length; });
    var emails = 0;
    var notes = 0;
    all.forEach(function (r) {
      (r.entries || []).forEach(function (e) { if (e.kind === 'email') emails++; else notes++; });
    });
    var awaiting = all.filter(function (r) { return r.status === 'awaiting-reply'; }).length;
    var due = all.filter(isDue).length;
    var corrected = all.filter(function (r) { return !!r.correction; }).length;

    $('oc-summary').innerHTML = [
      { l: 'Hospitals in the file', v: fmt.format(withActivity.length), n: 'with at least one note or email' },
      { l: 'Emails logged', v: fmt.format(emails), n: notes + ' notes alongside them' },
      { l: 'Awaiting reply', v: fmt.format(awaiting), n: 'sent, nothing back yet' },
      { l: 'Records corrected', v: fmt.format(corrected), n: 'your findings, kept out of the audit totals' },
      { l: 'Follow-ups due', v: fmt.format(due), n: due ? 'on or before today' : 'nothing overdue' },
    ].map(function (t) {
      return '<div class="tile"><div class="t-label">' + t.l + '</div>'
        + '<div class="t-value">' + t.v + '</div><div class="t-note">' + t.n + '</div></div>';
    }).join('');

    var follow = all.filter(function (r) { return r.followUpOn; })
      .sort(function (a, b) { return a.followUpOn.localeCompare(b.followUpOn); });
    $('oc-followups').innerHTML = follow.length
      ? follow.map(function (r) {
          return ocItem(r.ccn, nameFor(r.ccn, r),
            OC_STAGE_LABEL[r.status] + ' · ' + (r.entries || []).length + ' logged',
            r.followUpOn, isDue(r), true);
        }).join('')
      : '<p class="oc-empty">No follow-up dates set. Open a hospital and pick one to see it here.</p>';

    // Anything touched counts, not just a logged note or email — moving the
    // stage or setting a follow-up date is activity too, and showing nothing
    // after a hospital was clearly worked on reads as broken.
    var touched = all.filter(function (r) {
      return (r.entries || []).length || r.correction || r.followUpOn || (r.status && r.status !== 'none');
    });
    var recent = touched.slice().sort(function (a, b) {
      return String(b.updatedAt).localeCompare(String(a.updatedAt));
    }).slice(0, 12);
    $('oc-recent').innerHTML = recent.length
      ? recent.map(function (r) {
          var last = (r.entries || [])[0];
          var what = last
            ? (last.kind === 'email' ? ('Email · ' + (last.subject || '')) : ('Note · ' + (last.text || '')))
            : (r.correction ? 'Correction recorded' : 'Stage: ' + OC_STAGE_LABEL[r.status || 'none']);
          return ocItem(r.ccn, nameFor(r.ccn, r), what.slice(0, 90),
            String(r.updatedAt || '').slice(0, 10), false);
        }).join('')
      : '<p class="oc-empty">Nothing logged yet. Open any hospital in the register to start its file.</p>';

    // Chip counts
    var counts = {
      any: withActivity.length,
      'awaiting-reply': awaiting,
      due: due,
      corrected: corrected,
      none: D.rows.length - withActivity.length,
    };
    [].forEach.call($('tier-chips').querySelectorAll('.cn[data-count]'), function (el) {
      el.textContent = fmt.format(counts[el.dataset.count] || 0);
    });
  }

  $('oc-summary').parentNode.addEventListener('click', function (e) {
    if (!e.target.closest) return;
    // Dropping the date leaves the rest of the record alone; only the row's
    // place in this list changes.
    var x = e.target.closest('.oc-item-x');
    if (x && x.dataset.clear) {
      OC.upsert(x.dataset.clear, { followUpOn: '' }).catch(warn);
      return;
    }
    var b = e.target.closest('.oc-item');
    if (b && b.dataset.ccn) openDrawer(b.dataset.ccn);
  });

  /* ---- storage mode + export/import ---- */
  function renderMode() {
    var mode = OC.mode;
    $('oc-mode-label').textContent = mode === 'server' ? 'this server'
      : mode === 'published' ? 'the published copy'
      : 'this browser only';
    $('oc-mode-note').textContent = mode === 'server'
      ? 'Saved to cms_data/outreach.json — shared by every browser that opens this server.'
      : mode === 'published'
      ? 'Showing the published log from cms_data/outreach.public.json. No server reachable, so anything you add here stays in this browser only.'
      : 'No server reachable, so records live in this browser’s localStorage. Export to move them.';
  }
  $('oc-export').addEventListener('click', function () {
    $('oc-io').hidden = false;
    $('oc-io-text').value = OC.exportJson();
    $('oc-io-msg').textContent = OC.count() + ' record(s). Select all and copy to keep a backup.';
    $('oc-io-text').focus();
    $('oc-io-text').select();
  });
  $('oc-import').addEventListener('click', function () {
    $('oc-io').hidden = false;
    var text = $('oc-io-text').value.trim();
    if (!text) { $('oc-io-msg').textContent = 'Paste exported JSON into the box first.'; $('oc-io-text').focus(); return; }
    $('oc-io-msg').textContent = 'Importing…';
    OC.importJson(text).then(function (n) {
      $('oc-io-msg').textContent = 'Imported ' + n + ' record(s).';
      showDiscards('oc-io-msg', 'Imported ' + n + ' record(s), but ');
    }).catch(function (err) {
      $('oc-io-msg').textContent = 'Import failed: ' + (err && err.message ? err.message : err);
    });
  });

  // Any change to the store refreshes the section, the chips and the visible rows.
  OC.onChange(function () {
    renderOutreachSection();
    if (openCcn) renderDrawer();
    if (openCcn) sortStale = true; else sortFiltered();
    layout();
    // A correction can change a hospital's tier, so the field has to repaint.
    if (fieldGeom.cols) drawField(fieldDrawn);
  });

  /* ================= the field =================
     One mark per hospital, the whole registry at true scale. Canvas rather
     than 5,419 DOM nodes: hit-testing is arithmetic, and a redraw after every
     correction stays cheap. */

  var fieldEl = $('field');
  var fx = fieldEl.getContext('2d');
  var fieldGeom = { pitch: 0, gap: 0, cols: 0, rows: 0, w: 0, h: 0 };
  var fieldDrawn = 0;          // how many marks have been laid down so far
  var fieldTimer = null;
  var hoverIdx = -1;

  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  // Pick the largest mark that keeps the whole registry inside a sane height.
  function pickPitch(width, budget) {
    for (var p = 11; p >= 3; p--) {
      var cols = Math.floor(width / p);
      if (cols < 1) continue;
      if (Math.ceil(D.rows.length / cols) * p <= budget) return p;
    }
    return 3;
  }

  function tierAt(i) {
    var corr = correctionOf(D.rows[i][C.CCN]);
    if (corr && corr.verdict) return { tier: corr.verdict, edited: true };
    return { tier: findingMeta[D.rows[i][C.FIND]].tier, edited: false };
  }

  function sizeField() {
    var width = Math.max(240, Math.floor(fieldEl.parentNode.getBoundingClientRect().width));
    var budget = width < 640 ? 520 : 430;
    var pitch = pickPitch(width, budget);
    var cols = Math.floor(width / pitch);
    var rows = Math.ceil(D.rows.length / cols);
    var dpr = Math.min(2, window.devicePixelRatio || 1);

    fieldGeom = {
      pitch: pitch,
      gap: pitch >= 7 ? 2 : 1,
      cols: cols,
      rows: rows,
      w: cols * pitch,
      h: rows * pitch,
    };
    fieldEl.width = Math.round(fieldGeom.w * dpr);
    fieldEl.height = Math.round(fieldGeom.h * dpr);
    fieldEl.style.width = fieldGeom.w + 'px';
    fieldEl.style.height = fieldGeom.h + 'px';
    fx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function markRect(i) {
    var g = fieldGeom;
    return {
      x: (i % g.cols) * g.pitch,
      y: Math.floor(i / g.cols) * g.pitch,
      s: g.pitch - g.gap,
    };
  }

  function drawMark(i, colors) {
    var m = markRect(i);
    var t = tierAt(i);
    if (SOLID[t.tier]) {
      fx.fillStyle = colors[t.tier];
      fx.fillRect(m.x, m.y, m.s, m.s);
    } else {
      // Hollow: the hospitals nobody could check are drawn as holes.
      fx.strokeStyle = colors.hollow;
      fx.lineWidth = 1;
      fx.strokeRect(m.x + 0.5, m.y + 0.5, m.s - 1, m.s - 1);
    }
    if (t.edited) {
      // Your corrections carry an ink outline so they read as yours in the texture.
      fx.strokeStyle = colors.ink;
      fx.lineWidth = 1;
      fx.strokeRect(m.x - 0.5, m.y - 0.5, m.s + 1, m.s + 1);
    }
  }

  function fieldColors() {
    return {
      compliant: cssVar('--st-compliant'),
      failing: cssVar('--st-failing'),
      blocked: cssVar('--st-blocked'),
      exempt: cssVar('--st-exempt'),
      hollow: cssVar('--field-hollow'),
      ink: cssVar('--ink'),
      surface: cssVar('--surface'),
    };
  }

  function drawField(upTo) {
    var colors = fieldColors();
    fx.clearRect(0, 0, fieldGeom.w, fieldGeom.h);
    var n = Math.min(upTo == null ? D.rows.length : upTo, D.rows.length);
    for (var i = 0; i < n; i++) drawMark(i, colors);
    if (hoverIdx >= 0 && hoverIdx < n) {
      var m = markRect(hoverIdx);
      fx.strokeStyle = colors.ink;
      fx.lineWidth = 2;
      fx.strokeRect(m.x - 1, m.y - 1, m.s + 2, m.s + 2);
    }
  }

  // The one orchestrated moment: the registry feeds in, like paper off a printer.
  // A timeout backstop guarantees the complete field even where rAF never runs.
  function runField(animate) {
    sizeField();
    if (fieldTimer) { clearTimeout(fieldTimer); fieldTimer = null; }
    if (!animate) { fieldDrawn = D.rows.length; drawField(); return; }

    fieldDrawn = 0;
    var startedAt = null;
    var DURATION = 700;
    var step = function (ts) {
      if (startedAt === null) startedAt = ts;
      var t = Math.min(1, (ts - startedAt) / DURATION);
      fieldDrawn = Math.round(D.rows.length * t);
      drawField(fieldDrawn);
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
    fieldTimer = setTimeout(function () {
      if (fieldDrawn < D.rows.length) { fieldDrawn = D.rows.length; drawField(); }
    }, DURATION + 250);
  }

  function idxAt(ev) {
    var r = fieldEl.getBoundingClientRect();
    var g = fieldGeom;
    var col = Math.floor((ev.clientX - r.left) / g.pitch);
    var row = Math.floor((ev.clientY - r.top) / g.pitch);
    if (col < 0 || col >= g.cols || row < 0) return -1;
    var i = row * g.cols + col;
    return i >= 0 && i < D.rows.length ? i : -1;
  }

  fieldEl.addEventListener('mousemove', function (ev) {
    var i = idxAt(ev);
    if (i !== hoverIdx) {
      hoverIdx = i;
      drawField(fieldDrawn);
      fieldEl.classList.toggle('pickable', i >= 0);
    }
    if (i < 0) { hideTip(); return; }
    var r = D.rows[i];
    var t = tierAt(i);
    showTip('<b>' + esc(titleCase(r[C.NAME])) + '</b>'
      + esc(titleCase(r[C.CITY])) + ', ' + D.dict.states[r[C.STATE]]
      + ' &middot; <span class="tn">' + esc(r[C.CCN]) + '</span><br>'
      + TIER_META[t.tier].label + (t.edited ? ' (your correction)' : ''), ev);
  });
  fieldEl.addEventListener('mouseleave', function () {
    hoverIdx = -1;
    drawField(fieldDrawn);
    hideTip();
  });
  fieldEl.addEventListener('click', function (ev) {
    var i = idxAt(ev);
    if (i >= 0) openDrawer(D.rows[i][C.CCN]);
  });

  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  runField(!reduceMotion.matches);

  var fieldResize;
  window.addEventListener('resize', function () {
    clearTimeout(fieldResize);
    fieldResize = setTimeout(function () { runField(false); }, 150);
  });
  // The marks are painted from CSS variables, so a theme flip needs a repaint.
  var darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
  if (darkQuery.addEventListener) darkQuery.addEventListener('change', function () { runField(false); });

  applyFilters();
  renderOutreachSection();
  renderMode();
  OC.ready.then(function () {
    renderMode();
    renderOutreachSection();
    layout();
  });

  /* ---------- theme ----------
     The choice sticks across reloads. The inline script in <head> is what
     applies it before the first paint; this only records it. */
  var toggle = $('theme-toggle');
  toggle.addEventListener('click', function () {
    var root = document.documentElement;
    var current = root.getAttribute('data-theme');
    if (!current) {
      current = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    var next = current === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    try { window.localStorage.setItem('cms-hpt-tracker.theme', next); } catch (e) { /* private mode */ }
    runField(false);
  });
})();
