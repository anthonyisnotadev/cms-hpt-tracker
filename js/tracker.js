(function () {
  'use strict';

  var D = JSON.parse(document.getElementById('tracker-data').textContent);
  var sourceData = D;
  var currentRecords;
  function calculateSummary() {
    var corrections = {};
    sourceData.rows.forEach(function (r) {
      var rec = window.Outreach && window.Outreach.get(r[0]);
      if (rec && rec.correction) corrections[r[0]] = Object.assign({}, rec.correction, { checkedOn: rec.correction.checkedOn || String(rec.updatedAt || '').slice(0, 10) });
    });
    var summary = window.TrackerSummary.summarize(sourceData, corrections);
    currentRecords = summary.records;
    D = Object.assign({}, sourceData, summary);
  }
  calculateSummary();
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
      .replace(/hpt-obf:v1:[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[protected contact]')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  // CMS records every hospital name in caps. Title-casing makes 5,419 rows
  // readable, but naively lowercasing turns UPMC into "Upmc", so keep known
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
  // The hero's answer: how many hospitals have a file we could open, and how
  // the rest divide. Built from D.tiers so it moves with the field and the
  // register chips. Zero-count tiers are left out rather than shown as 0.
  // The count-up starts on the first render only. A later render (the tiers are
  // recomputed once the outreach records load) redirects it if it is still
  // running, so it lands on the current figure instead of the one it began with.
  var heroCounted = false, heroRetarget = null;
  function renderHeroAnswer() {
    var total = D.tiers.reduce(function (sum, t) { return sum + t.n; }, 0) || 1;
    var located = D.tiers.filter(function (t) { return t.key === 'compliant'; })[0];
    var shown = D.tiers.filter(function (t) { return t.n > 0; });
    var located_n = located ? located.n : 0;
    if (!heroRetarget || !heroRetarget(located_n)) {
      $('ha-n').textContent = fmt.format(located_n);
      if (!heroCounted && window.HptMotion) { heroCounted = true; heroRetarget = window.HptMotion.countUp($('ha-n'), located_n, fmt.format.bind(fmt)); }
    }
    $('ha-of').textContent = fmt.format(total);
    $('ha-bar').innerHTML = shown.map(function (t) {
      return '<span class="sw-' + t.key + '" style="flex-grow:' + t.n + '"></span>';
    }).join('');
    $('ha-bar').setAttribute('aria-label', shown.map(function (t) { return t.label + ' ' + fmt.format(t.n); }).join(', '));
    $('ha-legend').innerHTML = shown.map(function (t) {
      return '<li><span class="dot sw-' + t.key + '"></span><span class="ha-l">' + esc(t.label) + '</span>'
        + '<span class="ha-c">' + fmt.format(t.n) + '</span><span class="ha-p">' + (100 * t.n / total).toFixed(t.n / total < 0.1 ? 1 : 0) + '%</span></li>';
    }).join('');
  }
  var snapshot = D.generated
    ? new Date(D.generated + 'T12:00:00Z').toLocaleDateString('en-US',
        { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' })
    : 'unknown';
  function recordedDate(value) {
    var day = String(value || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return day;
    var date = new Date(day + 'T12:00:00Z');
    return Number.isNaN(date.getTime()) ? day : date.toLocaleDateString('en-US',
      { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
  }
  $('sf-total').textContent = fmt.format(T.hospitals);
  renderHeroAnswer();
  $('dl-date').textContent = snapshot;
  function sizeLabel() { return T.terabytes >= 1 ? T.terabytes.toFixed(2) + ' TB' : Math.round(T.terabytes * 1000) + ' GB'; }
  $('dl-size').textContent = sizeLabel();
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
  // than 45 so the first month reading is "2 months", rounding 45 days down to
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
    if (days === 0) return 'The latest included observation is from today';
    var s = ageSpan(days);
    return 'The latest included observation is from '
      + s.n + ' ' + s.unit + (s.n === 1 ? '' : 's') + ' ago';
  }

  if (snapshotAge !== null) {
    var stale = snapshotAge > STALE_DAYS ? '1' : '0';
    $('dl-age').textContent = '(' + humanAge(snapshotAge) + ')';
    $('dl-date').setAttribute('data-stale', stale);
    $('notice-age').textContent = elapsedPhrase(snapshotAge);
    $('snapshot-notice').setAttribute('data-stale', stale);
  }

  var stateSort = { key: 'total', dir: -1 };
  var SOLID = { compliant: 1, failing: 1, blocked: 1, exempt: 1, unknown: 0 };
  function renderDashboard() {
    /* ---------- verdict ---------- */
    var byTier = {};
    D.tiers.forEach(function (t) { byTier[t.key] = t.n; });
    var judged = byTier.compliant + byTier.failing;
    var reached = judged + byTier.blocked;

    // "unknown" is drawn hollow rather than filled, the one tier that is an
    // absence of information gets an absence of ink.
    var maxTier = Math.max(1, Math.max.apply(null, D.tiers.map(function (t) { return t.n; })));

    $('field-n').textContent = fmt.format(T.hospitals);

    // The canvas is a picture, so its numbers are also stated in text for anyone
    // who cannot see it. Built from D.tiers so it can never drift from the field.
    $('field-counts').innerHTML = ' Of these, '
      + D.tiers.map(function (t, i) {
          return (i === D.tiers.length - 1 ? 'and ' : '')
            + '<b>' + fmt.format(t.n) + '</b> ' + t.label.toLowerCase();
        }).join(', ')
      + '.';

    // Reach before verdict. A compliance rate computed on the hospitals we could
    // open says nothing about the ones we could not, and the ones we could not
    // are the larger finding, so they get stated first and given a mark.
    $('coverage').innerHTML = [
      {
        role: 'judged',
        k: 'Check result recorded',
        n: judged,
        note: 'The audit recorded a file or discovery result.',
      },
      {
        role: 'unreached',
        k: 'Assessment unresolved',
        n: byTier.unknown,
        note: 'Domain, access, or hospital identity remains unresolved.',
      },
    ].map(function (c) {
      return '<div class="cov" data-role="' + c.role + '">'
        + '<div class="cov-k">' + c.k + '</div>'
        + '<div class="cov-n">' + fmt.format(c.n) + '</div>'
        + '<p class="cov-note">' + pct1(c.n, T.hospitals) + ' of the registry. ' + c.note + '</p>'
        + '</div>';
    }).join('');

    $('legend').innerHTML = D.tiers.filter(function (t) { return t.n > 0; }).map(function (t) {
      var solid = SOLID[t.key];
      return '<button class="readout-row" type="button" data-key="' + t.key + '">'
        + '<span class="readout-mark sw-' + t.key + '" data-solid="' + solid + '"></span>'
        + '<span class="readout-name">' + t.label + '<small>' + t.note + '</small></span>'
        + '<span class="readout-n">' + fmt.format(t.n) + '</span>'
        + '<span class="readout-pct">' + pct(t.n, T.hospitals).toFixed(1) + '%</span>'
        + '<span class="readout-bar"><i class="sw-' + t.key + '" data-solid="' + solid + '"'
        + ' style="width:' + (100 * t.n / maxTier).toFixed(2) + '%"></i></span>'
        + '</button>';
    }).join('');

    $('readout-foot').innerHTML =
      'A file was located for <b>' + pct(byTier.compliant, judged).toFixed(1)
      + '%</b> of the <b>' + fmt.format(judged) + '</b> hospitals with a result. '
      + 'Assessment remains unresolved for <b>' + fmt.format(byTier.unknown) + '</b> hospitals ('
      + pct1(byTier.unknown, T.hospitals) + ' of the registry).'
      + '<br><span class="summary-note">Full tracker including ' + fmt.format(T.corrections) + ' current manual correction' + (T.corrections === 1 ? '' : 's') + '. File ages are calculated as of today; unknown dates are excluded. Original audit observations remain in hospital history.</span>';

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

    /* ---------- freshness ---------- */
    var maxBin = Math.max(1, Math.max.apply(null, D.freshness.map(function (b) { return b.n; })));
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
      ['Median', T.medianAge == null ? 'Unknown' : T.medianAge + 'd'],
      ['90th percentile', T.p90Age == null ? 'Unknown' : T.p90Age + 'd'],
      ['Oldest', T.maxAge == null ? 'Unknown' : T.maxAge + 'd']
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
        + '<td class="t-right rate">' + (t.rate == null ? 'n/a' : (100 * t.rate).toFixed(0) + '%') + '</td></tr>';
    }).join('');

    /* ---------- states ---------- */
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
          + (r == null ? 'n/a' : r.toFixed(1) + '%')
          + (thin ? '<abbr title="Fewer than half the hospitals in this state could be reached, so treat the rate as a sample.">*</abbr>' : '')
          + '</td>'
          + '</tr>';
      }).join('');
    }
    [].forEach.call($('state-table').querySelectorAll('th.sortable'), function (th) {
      th.onclick = function () {
        var key = th.dataset.key;
        stateSort.dir = stateSort.key === key ? -stateSort.dir : (key === 'name' ? 1 : -1);
        stateSort.key = key;
        [].forEach.call($('state-table').querySelectorAll('th.sortable'), function (o) {
          o.setAttribute('aria-sort', o === th ? (stateSort.dir === 1 ? 'ascending' : 'descending') : 'none');
        });
        renderStates();
      };
    });
    renderStates();

    /* ---------- queue ----------
       Follow-up work is not the same thing as a bad result: many of these
       hospitals already have a file located, and the follow-up only rechecks
       it. So every card carries the current results of its hospitals, the lede
       says how many are already settled, and the handful of tiny groups share
       one card instead of each taking a full one. */
    var queueTiers = {};
    Object.keys(currentRecords).forEach(function (ccn) {
      var rec = currentRecords[ccn];
      if (!rec.queue) return;
      var t = queueTiers[rec.queue] || (queueTiers[rec.queue] = {});
      t[rec.tier] = (t[rec.tier] || 0) + 1;
    });
    var openQueue = D.queue.filter(function (q) { return q.n > 0; });
    var queueTotal = openQueue.reduce(function (sum, q) { return sum + q.n; }, 0);
    var queueLocated = openQueue.reduce(function (sum, q) { return sum + ((queueTiers[q.key] || {}).compliant || 0); }, 0);
    $('queue-lede').innerHTML = '<b>' + fmt.format(queueTotal) + '</b> hospitals have open follow-up work. '
      + '<b>' + fmt.format(queueLocated) + '</b> of them already have a file located, so for those the work is a recheck, not a missing file. '
      + 'These groups overlap the findings above; do not add the two together.';
    function queueMix(key) {
      var t = queueTiers[key] || {};
      var parts = D.tiers.filter(function (x) { return t[x.key]; });
      return '<span class="state-mini" aria-hidden="true">' + parts.map(function (x) {
          return '<i data-tier="' + x.key + '" style="flex:' + t[x.key] + ' 1 0"></i>';
        }).join('') + '</span>'
        + '<span class="q-mix">' + parts.map(function (x) {
          return fmt.format(t[x.key]) + ' ' + x.label.toLowerCase();
        }).join(' · ') + '</span>';
    }
    var SMALL_QUEUE = 40;
    var bigQueue = openQueue.filter(function (q) { return q.n >= SMALL_QUEUE; });
    var smallQueue = openQueue.filter(function (q) { return q.n < SMALL_QUEUE; });
    $('queue-cards').innerHTML = bigQueue.map(function (q) {
      return '<button type="button" class="q-card q-card-btn" data-queue="' + esc(q.key) + '">'
        + '<span class="q-n">' + fmt.format(q.n) + '</span>'
        + '<span class="q-label">' + esc(q.label) + '</span>'
        + queueMix(q.key)
        + '<span class="q-why">' + esc(q.why) + '</span>'
        + '<span class="q-action">' + esc(q.action) + '</span>'
        + '</button>';
    }).join('');
    // Groups of a few dozen do not earn a card each; one line under the grid
    // keeps them reachable without an orphaned card on a row of its own.
    $('queue-small').hidden = !smallQueue.length;
    $('queue-small').innerHTML = '<span class="q-small-k">Smaller reviews</span>' + smallQueue.map(function (q) {
      return '<button type="button" data-queue="' + esc(q.key) + '" title="' + esc(q.why) + '">'
        + esc(q.label) + ' <b>' + fmt.format(q.n) + '</b></button>';
    }).join('');

  }
  renderDashboard();

  /* ---------- findings, grouped by intervention ----------
     The queue says what work remains; this says what the work actually is.
     Cards filter the register, because "show me the 256 Cloudflare-blocked
     hospitals" is the whole reason this section exists. Rows that need no
     person (compliant, federal-exempt) stay in the filter but not here: a
     "None needed" card at the top of an intervention list is noise. */
  var interventionGroups;
  var interventionList = $('intervention-cards');
  var selectedIntervention = null;
  function renderInterventionGroups() {
    interventionGroups = D.interventions.filter(function (v) {
      return v.n > 0 && v.key !== 'none' && v.key !== 'exempt-federal'
        && v.key !== 'exempt-ihs-program' && v.key !== 'exempt-closed';
    }).sort(function (a, b) { return b.n - a.n; });
    interventionList.innerHTML = interventionGroups.map(function (v, i) {
      return '<button class="intervention-option" type="button" data-key="' + esc(v.key) + '" aria-pressed="false" aria-controls="intervention-detail"' + (i >= 6 ? ' hidden' : '') + '>'
        + '<span class="iv-bar" aria-hidden="true" style="--w:' + (100 * v.n / interventionGroups[0].n).toFixed(1) + '%"></span>'
        + '<span class="iv-name">' + esc(v.label) + '</span><strong>' + fmt.format(v.n) + '</strong></button>';
    }).join('');
    var expanded = $('intervention-more').getAttribute('aria-expanded') === 'true';
    [].forEach.call(interventionList.querySelectorAll('button'), function (btn, i) { btn.hidden = !expanded && i >= 6; });
    var selected = selectedIntervention && interventionGroups.find(function (v) { return v.key === selectedIntervention.key; });
    if (selected || interventionGroups.length) selectIntervention((selected || interventionGroups[0]).key);
    else { selectedIntervention = null; }
    $('intervention-detail').hidden = !selectedIntervention;
    // Rows that need no person are left out of the list above, so say how many
    // and why, or the groups read as the whole registry.
    var countOf = function (k) { var v = D.interventions.filter(function (x) { return x.key === k; })[0]; return v ? v.n : 0; };
    var exempt = [['exempt-federal', 'federal'], ['exempt-ihs-program', 'Indian Health program'], ['exempt-closed', 'closed'], ['exempt-state-hospital', 'state hospital']]
      .filter(function (e) { return countOf(e[0]) > 0; });
    var exemptN = exempt.reduce(function (sum, e) { return sum + countOf(e[0]); }, 0);
    $('intervention-excluded').textContent = 'Not listed: ' + fmt.format(countOf('none')) + ' hospitals with no issue observed'
      + (exemptN ? ', and ' + fmt.format(exemptN) + ' exempt (' + exempt.map(function (e) { return fmt.format(countOf(e[0])) + ' ' + e[1]; }).join(', ') + ')' : '') + '.';
    $('intervention-more').hidden = interventionGroups.length <= 6;
    $('intervention-more').textContent = expanded ? 'Show fewer categories' : 'Show all ' + interventionGroups.length + ' categories';
  }
  renderInterventionGroups();
  function selectIntervention(key) {
    var v = interventionGroups.filter(function (group) { return group.key === key; })[0];
    if (!v) return;
    selectedIntervention = v;
    [].forEach.call(interventionList.querySelectorAll('button'), function (btn) { btn.setAttribute('aria-pressed', String(btn.dataset.key === key)); });
    $('intervention-detail-title').textContent = v.label;
    $('intervention-detail-count').textContent = fmt.format(v.n);
    $('intervention-detail-why').textContent = v.plain;
    $('intervention-detail-action').textContent = v.action;
    // The groups are coarse on purpose; the findings behind one are what the
    // crawl actually recorded, so they are listed rather than lost. A group
    // made of a single finding would only repeat its own title.
    var inGroup = {};
    Object.keys(currentRecords).forEach(function (ccn) {
      var rec = currentRecords[ccn];
      if (rec.intervention === key) inGroup[rec.finding] = (inGroup[rec.finding] || 0) + 1;
    });
    // The nationwide and discovery passes keep separate keys for the same
    // condition under the same label, so rows are merged by label: one line
    // per thing a reader can tell apart.
    var byLabel = {};
    Object.keys(inGroup).forEach(function (k) {
      var f = D.findings.filter(function (x) { return x.key === k; })[0];
      var label = f ? f.label : k;
      byLabel[label] = (byLabel[label] || 0) + inGroup[k];
    });
    var parts = Object.keys(byLabel).map(function (label) {
      return { label: label, n: byLabel[label] };
    }).sort(function (a, b) { return b.n - a.n; });
    $('intervention-detail-findings-block').hidden = parts.length < 2;
    $('intervention-detail-findings').innerHTML = parts.map(function (p) {
      return '<li><span>' + esc(p.label) + '</span><b>' + fmt.format(p.n) + '</b></li>';
    }).join('');
    $('intervention-view').textContent = 'View ' + fmt.format(v.n) + ' hospitals →';
    if (window.HptMotion) window.HptMotion.enter($('intervention-detail'));
  }
  interventionList.addEventListener('click', function (event) {
    var btn = event.target.closest('button[data-key]');
    if (btn) selectIntervention(btn.dataset.key);
  });
  var interventionMore = $('intervention-more');
  interventionMore.hidden = interventionGroups.length <= 6;
  interventionMore.textContent = 'Show all ' + interventionGroups.length + ' categories';
  interventionMore.addEventListener('click', function () {
    var expanded = interventionMore.getAttribute('aria-expanded') !== 'true';
    interventionMore.setAttribute('aria-expanded', String(expanded));
    [].forEach.call(interventionList.querySelectorAll('button'), function (btn, i) { btn.hidden = !expanded && i >= 6; });
    if (!expanded && interventionGroups.slice(6).some(function (v) { return v.key === selectedIntervention.key; })) selectIntervention(interventionGroups[0].key);
    interventionMore.textContent = expanded ? 'Show fewer categories' : 'Show all ' + interventionGroups.length + ' categories';
  });
  $('intervention-view').addEventListener('click', function () {
    if (!selectedIntervention) return;
    var el = $('f-finding');
    el.value = selectedIntervention.key;
    el.dispatchEvent(new Event('change'));
    setMoreFiltersOpen(true);
    $('register').scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  });
  if (interventionGroups.length) selectIntervention(interventionGroups[0].key);

  /* ---------- register ---------- */
  // LON/LAT come from scripts/hpt/geocode.js by way of the build. APPROX is 1
  // when the point is the centre of the hospital's ZIP rather than its address.
  var C = { CCN: 0, NAME: 1, CITY: 2, STATE: 3, TYPE: 4, FIND: 5, DAYS: 6, TMPL: 7, MRF: 8, PTR: 9, EV: 10, FMT: 11, BYTES: 12, UPD: 13, LON: 14, LAT: 15, APPROX: 16, CHECKED: 17, SOURCE: 18, INTERV: 19 };
  var findingMeta = D.dict.findings.map(function (k) {
    return D.findings.filter(function (f) { return f.key === k; })[0];
  });
  // Same shape as findingMeta: the operational overlay beside the regulatory
  // one. Built from dict order so r[C.INTERV] indexes into it directly.
  var interventionMeta = D.dict.interventions.map(function (k) {
    return D.interventions.filter(function (v) { return v.key === k; })[0];
  });

  // One lowercase haystack per row, built once.
  var hay = D.rows.map(function (r) {
    return (r[C.NAME] + ' ' + r[C.CITY] + ' ' + D.dict.states[r[C.STATE]] + ' ' + r[C.CCN]).toLowerCase();
  });

  var sel = { q: '', state: '', type: '', tiers: {}, outreach: '', stage: '', mrfCheck: '', finding: '', queue: '', age: '', version: '', links: '' };
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
  var mrfStatusSelect = $('f-mrf-check');
  var MRF_CHECK_OPTIONS = [
    { state: 'met', label: 'Passes checks' },
    { state: 'issue', label: 'Fails check' },
    { state: 'review', label: 'Review needed' },
    { state: 'unverified', label: 'Not verified' },
    { state: 'scope', label: 'Outside scope' },
  ];
  function populateMrfStatusOptions() {
    var counts = {};
    D.rows.forEach(function (r) {
      var state = window.TrackerSummary.mrfCheck(currentRecords[r[C.CCN]]).state;
      counts[state] = (counts[state] || 0) + 1;
    });
    mrfStatusSelect.innerHTML = '<option value="">Any MRF status</option>';
    MRF_CHECK_OPTIONS.forEach(function (item) {
      if (!counts[item.state]) return;
      var option = document.createElement('option');
      option.value = item.state;
      option.textContent = item.label + ' (' + fmt.format(counts[item.state]) + ')';
      mrfStatusSelect.appendChild(option);
    });
    mrfStatusSelect.value = sel.mrfCheck;
    if (mrfStatusSelect.value !== sel.mrfCheck) sel.mrfCheck = '';
  }
  populateMrfStatusOptions();
  var findingSelect = $('f-finding');
  function populateFindingOptions() {
    findingSelect.innerHTML = '<option value="">Any finding group</option>';
    D.interventions.forEach(function (v) {
      if (!v.n) return;
      var o = document.createElement('option');
      o.value = v.key; o.textContent = v.label + ' (' + fmt.format(v.n) + ')';
      findingSelect.appendChild(o);
    });
    findingSelect.value = sel.finding;
    if (findingSelect.value !== sel.finding) sel.finding = '';
  }
  populateFindingOptions();
  var queueSelect = $('f-queue');
  function populateQueueOptions() {
    queueSelect.innerHTML = '<option value="">Any follow-up work</option>';
    D.queue.forEach(function (q) {
      if (!q.n) return;
      var o = document.createElement('option');
      o.value = q.key; o.textContent = 'Follow-up: ' + q.label + ' (' + fmt.format(q.n) + ')';
      queueSelect.appendChild(o);
    });
    queueSelect.value = sel.queue;
    if (queueSelect.value !== sel.queue) sel.queue = '';
  }
  populateQueueOptions();
  queueSelect.addEventListener('change', function () { sel.queue = queueSelect.value; applyFilters(); });
  // A queue card is a shortcut into the register, filtered to that group.
  $('queue').addEventListener('click', function (event) {
    var btn = event.target.closest('[data-queue]');
    if (!btn) return;
    queueSelect.value = btn.dataset.queue;
    queueSelect.dispatchEvent(new Event('change'));
    setMoreFiltersOpen(true);
    $('register').scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  });
  // Keep each declared version distinct; a missing value is not an old version.
  function recordedVersion(r) { return String(currentRecords[r[C.CCN]].version || '').trim(); }
  var versionSelect = $('f-version');
  function populateVersionOptions() {
    versionSelect.innerHTML = '<option value="">Any MRF version</option>';
  var recordedVersions = Array.from(new Set(D.rows.map(recordedVersion))).filter(Boolean);
  recordedVersions.sort(function (a, b) { return b.localeCompare(a, 'en', { numeric: true }); });
  recordedVersions.forEach(function (v) {
    var o = document.createElement('option');
    o.value = v; o.textContent = 'MRF v' + v;
    versionSelect.appendChild(o);
  });
  var unknownVersion = document.createElement('option');
  unknownVersion.value = '__unknown__'; unknownVersion.textContent = 'MRF version: unknown / not recorded';
  versionSelect.appendChild(unknownVersion);
    versionSelect.value = sel.version;
    if (versionSelect.value !== sel.version) sel.version = '';
  }
  populateVersionOptions();
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
    { key: 'corrected', label: 'Manually corrected' },
    { key: 'none', label: 'Not contacted' },
  ];

  $('tier-chips').innerHTML = D.tiers.map(function (t) {
    return '<button class="chip" type="button" data-key="' + t.key + '" aria-pressed="false"' + (t.n ? '' : ' hidden') + '>'
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
  // outreach chips above, this matches it exactly, including "not contacted".
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
    var hasPtr = !!currentRecords[r[C.CCN]].ptr, hasMrf = !!currentRecords[r[C.CCN]].mrf;
    if (mode === 'no-ptr') return !hasPtr;
    if (mode === 'no-mrf') return !hasMrf;
    if (mode === 'neither') return !hasPtr && !hasMrf;
    return true;
  }

  /* ---------- sorting the register ----------
     Six columns, three states each: the column's useful direction first, then
     its reverse, then back to registry order, which is CCN order, so it
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
      var d = currentRecords[r[C.CCN]].age;
      if (corr && corr.lastUpdatedOn) {
        var cd = daysSince(corr.lastUpdatedOn);
        if (cd != null) d = cd;
      }
      return d == null ? null : d;
    }
    if (key === 'links') {
      return (((corr && corr.mrfUrl) || r[C.MRF]) ? 1 : 0)
        + (((corr && corr.pointerUrl) || r[C.PTR]) ? 1 : 0)
        + (r[C.SOURCE] ? 1 : 0);
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
      // now, otherwise re-sorting the already-sorted list drifts.
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
      return '<option value="' + s.key + ':' + s.first + '">' + esc(s.label + ': ' + (s.first === 1 ? s.up : s.down)) + '</option>'
        + '<option value="' + s.key + ':' + (-s.first) + '">' + esc(s.label + ': ' + (s.first === 1 ? s.down : s.up)) + '</option>';
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

  /* ---------- filter state, named ----------
     Eighteen controls govern this list. Rather than leaving a reader to work
     out why it is short, every active one is named in the result line, using
     the text of its own control so the summary always matches the screen. */
  var FILTER_SELECTS = [
    { id: 'f-state', key: 'state' },
    { id: 'f-type', key: 'type', extra: true },
    { id: 'f-mrf-check', key: 'mrfCheck' },
    { id: 'f-finding', key: 'finding', extra: true },
    { id: 'f-queue', key: 'queue', extra: true },
    { id: 'f-stage', key: 'stage', extra: true },
    { id: 'f-age', key: 'age', extra: true },
    { id: 'f-version', key: 'version' },
    { id: 'f-links', key: 'links', extra: true },
  ];

  function selLabel(id) {
    var el = $(id);
    if (!el || !el.value) return null;
    var o = el.options[el.selectedIndex];
    return o ? o.textContent.trim() : null;
  }

  function activeFilters() {
    var out = [];
    if (sel.q.trim()) out.push('“' + sel.q.trim() + '”');
    FILTER_SELECTS.forEach(function (f) {
      var l = selLabel(f.id);
      if (l) out.push(l);
    });
    D.tiers.forEach(function (t) { if (sel.tiers[t.key]) out.push(t.label); });
    if (sel.outreach) {
      OC_CHIPS.forEach(function (c) { if (c.key === sel.outreach) out.push(c.label); });
    }
    return out;
  }

  // How many of the folded-away filters are set, so the disclosure can say so
  // without being opened.
  function extraCount() {
    var n = 0;
    FILTER_SELECTS.forEach(function (f) { if (f.extra && sel[f.key] !== '') n++; });
    return n;
  }

  function clearAllFilters() {
    sel.q = '';
    sel.tiers = {};
    sel.outreach = '';
    FILTER_SELECTS.forEach(function (f) {
      sel[f.key] = '';
      var el = $(f.id);
      if (el) el.value = '';
    });
    if ($('q')) $('q').value = '';
    if ($('nav-q')) $('nav-q').value = '';
    [].forEach.call($('tier-chips').querySelectorAll('.chip'), function (b) {
      b.setAttribute('aria-pressed', 'false');
    });
    applyFilters();
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
      if (useTier && !sel.tiers[currentRecords[r[C.CCN]].tier]) continue;
      if (sel.outreach && !matchesOutreach(r[C.CCN], sel.outreach)) continue;
      if (sel.stage && !matchesStage(r[C.CCN], sel.stage)) continue;
      if (sel.mrfCheck && window.TrackerSummary.mrfCheck(currentRecords[r[C.CCN]]).state !== sel.mrfCheck) continue;
      if (sel.finding && currentRecords[r[C.CCN]].intervention !== sel.finding) continue;
      if (sel.queue && currentRecords[r[C.CCN]].queue !== sel.queue) continue;
      if (sel.age !== '' && !matchesAge(currentRecords[r[C.CCN]].age, Number(sel.age))) continue;
      if (sel.version && recordedVersion(r) !== (sel.version === '__unknown__' ? '' : sel.version)) continue;
      if (sel.links && !matchesLinks(r, sel.links)) continue;
      if (q && hay[i].indexOf(q) === -1) continue;
      out.push(i);
    }
    filtered = out;
    sortFiltered();
    viewport.scrollTop = 0;
    relayout();
  }

  /* The line describes what is actually on screen, including the mobile cap,
     which depends on the viewport rather than on the filters. So it is painted
     by the relayout path, not by the filter pass: crossing the 760px breakpoint
     re-renders the rows without re-filtering, and the count has to follow it or
     it ends up contradicting the list underneath. */
  function paintResultLine() {
    var n = filtered.length;
    var active = activeFilters();
    var line = '<b>' + fmt.format(n) + '</b> of ' + fmt.format(D.rows.length) + ' hospitals';
    var chips = [];
    function chip(key, value, label) { chips.push('<button type="button" data-filter="' + esc(key) + '" data-value="' + esc(value) + '" aria-label="Remove filter: ' + esc(label) + '">' + esc(label) + '<span aria-hidden="true"> ×</span></button>'); }
    if (sel.q.trim()) chip('q', '', sel.q.trim());
    FILTER_SELECTS.forEach(function (f) { var label = selLabel(f.id); if (label) chip(f.key, '', label); });
    D.tiers.forEach(function (t) { if (sel.tiers[t.key]) chip('tier', t.key, t.label); });
    OC_CHIPS.forEach(function (c) { if (sel.outreach === c.key) chip('outreach', '', c.label); });
    $('active-filter-chips').innerHTML = chips.join('');
    if (regSort.key) line += ' · sorted by ' + esc(sortNote());
    if (n && narrow.matches && n > MOBILE_CAP) {
      line += ' · showing the first ' + MOBILE_CAP + ', search to narrow';
    }
    $('result-line').innerHTML = line;
    $('reg-empty').hidden = n > 0;

    // The reset only exists when there is something to reset.
    var extra = extraCount();
    var countEl = $('filters-count');
    if (countEl) { countEl.textContent = extra; countEl.hidden = extra === 0; }
    [].forEach.call(document.querySelectorAll('.clear-filters'), function (b) {
      b.hidden = active.length === 0;
    });
  }

  // Scrolling calls layout() alone, once per frame, it must not rewrite the
  // line. Everything that changes what the list contains or how much of it is
  // shown goes through here instead.
  function relayout() {
    layout();
    paintResultLine();
  }

  var viewport = $('reg-viewport');
  var canvas = $('reg-canvas');
  var regHead = document.querySelector('.reg-head');
  // Must match --row-h in css/tracker.css: rows are absolutely positioned at
  // index * this height, so a mismatch shows as gaps or overlap while scrolling.
  var ROW_H = 64;
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
    var reviewed = D.reviewedAt && D.reviewedAt[ccn];
    var manualDate = rec && rec.correction && (rec.correction.checkedOn || rec.updatedAt);
    if (reviewed && manualDate && String(manualDate).slice(0, 10) < String(reviewed).slice(0, 10)) return null;
    return (rec && rec.correction) || null;
  }

  function ageCell(r, corr) {
    var d = currentRecords[r[C.CCN]].age;
    var edited = false;
    if (corr && corr.lastUpdatedOn) {
      var cd = daysSince(corr.lastUpdatedOn);
      if (cd != null) { d = cd; edited = true; }
    }
    // A blank here is not "fresh", it means no usable date is recorded,
    // because an empty cell in a column of numbers reads as a zero.
    if (d == null) {
      return '<span class="cell-age" title="No usable file update date is recorded for this hospital">'
        + '<span class="dash">unknown</span></span>';
    }
    var cls = 'cell-age' + (d > 365 ? ' stale' : '') + (edited ? ' edited' : '');
    return '<span class="' + cls + '"' + (edited ? ' title="From a manual correction, not the crawl"' : '')
      + '>' + d + 'd' + (edited ? '<sup>*</sup>' : '') + '</span>';
  }

  function rowHtml(i, top, band) {
    var r = D.rows[i];
    var f = findingMeta[r[C.FIND]];
    var corr = correctionOf(r[C.CCN]);
    var mrfCheck = window.TrackerSummary.mrfCheck(currentRecords[r[C.CCN]]);

    // A correction can override the verdict, but it is always identified as manual.
    var tier = f.tier;
    var short = TIER_META[tier].short;
    var badgeExtra = '';
    if (corr && corr.verdict) {
      tier = corr.verdict;
      short = TIER_META[tier].short;
      badgeExtra = ' data-edited="1" title="Manual correction from '
        + esc(corr.checkedOn || '') + '. The crawl found: ' + esc(f.label) + '"';
    }

    var mrf = (corr && corr.mrfUrl) || r[C.MRF];
    var ptr = (corr && corr.pointerUrl) || r[C.PTR];
    var source = r[C.SOURCE];
    var edited = corr && (corr.mrfUrl || corr.pointerUrl) ? ' data-edited="1"' : '';
    var links = '';
    var primaryFileLabel = !(corr && corr.mrfUrl) && D.primaryFileLabels && D.primaryFileLabels[r[C.CCN]];
    if (mrf) links += '<a class="linkbtn"' + edited + ' href="' + esc(mrf) + '" target="_blank" rel="noopener noreferrer">' + (primaryFileLabel ? 'Charges: ' + esc(primaryFileLabel) : 'Charge file') + '</a>';
    if (!(corr && corr.mrfUrl) && D.additionalFiles && D.additionalFiles[r[C.CCN]]) {
      D.additionalFiles[r[C.CCN]].forEach(function (file) {
        links += '<a class="linkbtn" href="' + esc(file[1]) + '" target="_blank" rel="noopener noreferrer" title="' + esc(file[0]) + '">FILE: ' + esc(file[0]) + '</a>';
      });
    }
    if (ptr) links += '<a class="linkbtn"' + edited + ' href="' + esc(ptr) + '" target="_blank" rel="noopener noreferrer">PTR</a>';
    if (source) links += '<a class="linkbtn" href="' + esc(source) + '" target="_blank" rel="noopener noreferrer">Price page</a>';
    // Raw HTTP transcript of why this row is blocked or unresolved: what the
    // tracker's own client saw, hop by hop. Links into the published
    // curl-evidence archive; the drawer carries the full list per hospital.
    var evList = D.evidence[r[C.CCN]];
    if (evList && evList.length) {
      links += '<a class="linkbtn evid" href="data/hpt-audit/' + esc(evList[0][3])
        + '" target="_blank" rel="noopener noreferrer" title="Raw HTTP evidence: '
        + esc(evList[0][1] + (evList[0][2] ? ' via ' + evList[0][2] : '')) + '">EVID</a>';
    }
    if (!links) links = '<span class="linkbtn" style="border-color:transparent;color:var(--ink-3)">none</span>';

    var why = '<b>' + (corr && corr.verdict
      ? esc(TIER_META[tier].label) + ' (manual correction)' : esc(f.label)) + '</b>'
      + '<span class="mrf-badge cell-mrf-check" data-state="' + mrfCheck.state + '" title="'
      + esc(mrfCheck.detail) + '">MRF · ' + esc(mrfCheck.label) + '</span>';

    return '<div class="reg-row" data-ccn="' + esc(r[C.CCN]) + '" data-band="' + (band ? 1 : 0) + '"'
      + (narrow.matches ? '' : ' style="top:' + top + 'px"') + '>'
      + '<span class="badge flat" data-tier="' + tier + '"' + badgeExtra + '>'
      + short + '</span>'
      + '<span class="cell-name"><button type="button" class="hospital-open">' + esc(titleCase(r[C.NAME])) + '</button>'
      + '<span>' + esc(titleCase(r[C.CITY])) + ', ' + D.dict.states[r[C.STATE]] + ' &middot; ' + esc(r[C.CCN]) + '</span></span>'
      + '<span class="cell-why">' + why + '</span>'
      + ageCell(r, corr)
      + '<span class="cell-links">' + links + '</span>'
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
  // Both of these can cross the 760px breakpoint, which swaps the virtualised
  // list for a capped one and changes how many rows are on screen. relayout()
  // repaints the count alongside the rows so the two cannot disagree.
  window.addEventListener('resize', relayout);
  if (narrow.addEventListener) narrow.addEventListener('change', relayout);

  var qInput = $('q');
  var navQ = $('nav-q');
  var debounce;

  // The register's search and the one in the section bar are the same query in
  // two places. Whichever is typed into wins; the other follows.
  function setQuery(value, echoTo) {
    sel.q = value;
    if (echoTo && echoTo.value !== value) echoTo.value = value;
    applyFilters();
  }
  qInput.addEventListener('input', function () {
    clearTimeout(debounce);
    debounce = setTimeout(function () { setQuery(qInput.value, navQ); }, 120);
  });
  if (navQ) {
    navQ.addEventListener('input', function () {
      clearTimeout(debounce);
      debounce = setTimeout(function () { setQuery(navQ.value, qInput); }, 120);
    });
    // Enter moves focus to the results rather than submitting anything.
    navQ.addEventListener('keydown', function (ev) {
      if (ev.key !== 'Enter') return;
      ev.preventDefault();
      $('register').scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
    });
  }

  [].forEach.call(document.querySelectorAll('.clear-filters'), function (b) {
    b.addEventListener('click', function () {
      clearAllFilters();
      qInput.focus();
    });
  });

  var moreBtn = $('filters-toggle');
  function setMoreFiltersOpen(open) {
    if (!moreBtn) return;
    moreBtn.setAttribute('aria-expanded', String(open));
    $('filters-extra').hidden = !open;
  }
  if (moreBtn) {
    moreBtn.addEventListener('click', function () {
      setMoreFiltersOpen(moreBtn.getAttribute('aria-expanded') !== 'true');
    });
  }
  stateSelect.addEventListener('change', function () { sel.state = stateSelect.value; applyFilters(); });
  typeSelect.addEventListener('change', function () { sel.type = typeSelect.value; applyFilters(); });
  mrfStatusSelect.addEventListener('change', function () { sel.mrfCheck = mrfStatusSelect.value; applyFilters(); });
  findingSelect.addEventListener('change', function () { sel.finding = findingSelect.value; applyFilters(); });
  ageSelect.addEventListener('change', function () { sel.age = ageSelect.value; applyFilters(); });
  versionSelect.addEventListener('change', function () { sel.version = versionSelect.value; applyFilters(); });
  $('f-links').addEventListener('change', function () { sel.links = $('f-links').value; applyFilters(); });

  // Clicking a row of the readout jumps to the register, filtered to that tier.
  $('legend').addEventListener('click', function (event) {
    var el = event.target.closest('.readout-row');
    if (!el) return;
      var k = el.dataset.key;
      D.tiers.forEach(function (t) { sel.tiers[t.key] = (t.key === k); });
      [].forEach.call($('tier-chips').querySelectorAll('.chip[data-key]'), function (b) {
        b.setAttribute('aria-pressed', b.dataset.key === k ? 'true' : 'false');
      });
      applyFilters();
      $('register').scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
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
      updatedAt: r[C.UPD] || '',
      mrf: r[C.MRF],
      additionalFiles: D.additionalFiles && D.additionalFiles[ccn] || [],
      primaryFileLabel: D.primaryFileLabels && D.primaryFileLabels[ccn] || '',
      ptr: r[C.PTR],
      source: r[C.SOURCE],
      lon: r[C.LON],
      lat: r[C.LAT],
      approx: r[C.APPROX] === 1,
      checkedAt: r[C.CHECKED] || '',
    };
  }

  /* ---- email template, tailored to what the audit actually found ---- */
  var TEMPLATE_BY_FINDING = {
    'mrf-facility-identity-unresolved': 'I reached a possible machine-readable file, but could not safely match its identity to this facility. Could you confirm which file applies?',
    'not-assessed-nationwide-linked-mrf-header-unmatched': 'I reached the linked file, but could not safely match its header to this facility. Could you confirm which file applies?',
    'not-assessed-nationwide-pointer-discovery-incomplete': 'My pointer check did not complete because of a request or client-layer failure. Could you share the current pointer and file locations?',
    'not-assessed-nationwide-pointer-not-retrieved': 'I did not retrieve a usable pointer from the official locations checked. Could you share the current pointer and file locations?',
    'not-assessed-nationwide-official-website-not-identified-completed-search': 'I could not verify an official facility website in the completed search. Could you share the official website and file location?',
    'not-assessed-nationwide-pointer-access-denied-to-client': 'My request to the official pointer was denied or challenged for this client. Could you confirm the current pointer and file locations?',
    'not-assessed-nationwide-mrf-facility-identity-unresolved': 'I reached a possible machine-readable file, but could not safely match its identity to this facility. Could you confirm which file applies?',
    'not-assessed-nationwide-pointer-facility-match-unresolved': 'I retrieved a pointer, but could not safely match an entry to this facility. Could you identify the applicable entry?',
    'not-assessed-nationwide-mrf-request-unsuccessful': 'My request to the facility-linked machine-readable file did not return usable file content. Could you confirm its current location?',
    'not-assessed-nationwide-mrf-verification-pending': 'I retrieved a possible file, but its facility identity or metadata still needs verification. Could you confirm which file applies?',
    'not-assessed-nationwide-official-website-search-pending': 'My official-website search for this facility is not complete. Could you share the official website and file location?',
    'not-assessed-discovery-official-hpt-pending': 'I identified your facility’s official website; my review of its pointer and machine-readable file is unfinished. Could you share the current file location?',
    'not-assessed-discovery-candidate-identity-unverified': 'I found a possible website for this facility, but have not resolved its identity. Could you confirm the official website and file location?',
    'not-assessed-discovery-pointer-client-denied': 'My request to the recorded official pointer URL was refused. Could you confirm the current pointer and machine-readable file locations?',
    'not-assessed-discovery-pointer-not-retrieved': 'I did not retrieve a usable pointer from the official locations checked. Other locations may work. Could you share the current links?',
    'not-assessed-discovery-pointer-match-unresolved': 'I retrieved a pointer, but could not resolve the entry for this facility. Could you identify the applicable entry?',
    'not-assessed-discovery-mrf-request-failed': 'My request for the facility-linked machine-readable file failed. Could you confirm its current location?',
    'not-assessed-discovery-mrf-verification-pending': 'I retrieved a file, but its facility identity or metadata still needs verification. Could you confirm which file covers this facility?',
    'not-assessed-discovery-search-completed-no-official': 'I did not identify a supported official website in the completed search. Could you share the official website and machine-readable file location?',
    'not-assessed-discovery-request-tool-failure': 'My discovery checks could not complete because of a request or tool failure. Could you share the official website and machine-readable file location?',
    'not-assessed-discovery-review-pending': 'My review of the discovery evidence for this facility is unfinished. Could you share the official website and machine-readable file location?',
    'mrf-url-unreachable': 'The link in your cms-hpt.txt file points to a standard charges file that returned an error. Could you confirm the correct location, or update the pointer file?',
    'mrf-stale-over-365-days': 'The retrieved standard charges file was last updated more than twelve months ago. 45 CFR 180.50 asks for an update at least once a year. Is a newer version available?',
    'old-template-version': 'The retrieved standard charges file declares an older CMS template version. The current schema is 3.0.0. Is an updated file available?',
    'mrf-license-state-field-conflicts-facility': 'The retrieved file identifies this facility, but its license-number column is labeled for a different state. Could you correct or clarify that state field?',
    'mrf-address-field-conflicts-facility': 'The retrieved file identifies this facility, but one of its address fields differs from the independently verified hospital address. Could you correct or clarify that field?',
    'mrf-address-field-incomplete': 'The retrieved file names this facility, but its hospital_address field omits part of the street address shown on your hospital website. Could you confirm the intended address for that field?',
    'mrf-template-version-noncanonical': 'The retrieved file identifies this facility, but its declared version differs from the CMS schema identifier 3.0.0. Could you clarify the intended template version and provide a corrected file if needed?',
    'mrf-custom-workbook-metadata-unverified': 'The pointer-linked object identifies this facility, but it is an XLSX workbook behind a CSV-labeled URL and does not declare a CMS template version or MRF last_updated_on. Is a CMS-template CSV or JSON file available?',
    'no-cms-hpt-txt-published': 'The website opened, but no cms-hpt.txt pointer file was found at the root or under /.well-known/. Could you confirm where the machine-readable standard charges file is published?',
    'pointer-blocked-to-automation': 'Requests for your cms-hpt.txt file are being refused (HTTP 403/429), which prevents automated retrieval of your standard charges file. Could you confirm the file is publicly reachable without a browser?',
    'mrf-blocked-to-automation': 'Your pointer file resolves, but the standard charges file itself refuses automated requests. Could you confirm it is reachable without a browser?',
    'not-assessed-domain-unknown': 'I could not verify an official website for your facility in the sources checked. Could you share the location of its machine-readable file?',
    'not-assessed-site-observed': 'I found a website candidate matching your facility, but could not verify its cms-hpt.txt pointer and machine-readable file. Could you share the current file location?',
    'not-assessed-pointer-review': 'I found a cms-hpt.txt file on a candidate website, but could not confidently match its entry and machine-readable file to your facility. Could you confirm the correct links?',
    'not-assessed-domain-candidate': 'I found one or more possible websites for your facility, but could not verify an official domain and its machine-readable file. Could you share the correct location?',
    'not-assessed-domain-search-pending': 'I have not yet completed an official-website search for your facility. Could you share the location of its machine-readable file?',
    'not-assessed-domain-search-error': 'My website search for your facility did not complete successfully. Could you share the official website and machine-readable file location?',
    'not-assessed-no-domain-candidate': 'I could not identify an official website in the sources checked. Could you share the location of your facility’s machine-readable file?',
    'not-assessed-site-unreachable': 'The website on record for your facility did not open. Could you confirm the correct domain and location of the machine-readable standard charges file?',
    // Deliberately not phrased as a compliance complaint: the omission may be
    // ours. We found their system's file and simply could not see this hospital
    // in it, so the ask is which entry corresponds to this facility.
    'not-assessed-not-named-in-file': 'A cms-hpt.txt pointer file was found on your health system’s website, but no entry could be matched to this facility. Could you identify the entry that covers it, or provide its machine-readable file?',
    'compliant-date-unverified': 'The standard charges file opened, but no last_updated_on value could be read. Could you confirm the date it was last updated?',
    'pointer-lists-no-mrf-url': 'Your cms-hpt.txt names this facility, but the entry does not include an mrf-url pointing at the standard charges file. 45 CFR 180.50(d)(6) asks for a direct link. Could you add it, or provide the file location?',
    'pointer-links-older-mrf-than-source-page': 'Your current pricing page links a newer machine-readable file than cms-hpt.txt. Could you update the pointer so both locations identify the same current file?',
    'pointer-links-different-facility-mrf-source-page-file': 'The file linked for this facility in cms-hpt.txt declares a different campus address, while your pricing page links a file naming this campus. Could you confirm which file the pointer should identify?',
    'pointer-html-portal-not-found-source-page-current-file': 'Your cms-hpt.txt link to a pricing portal rendered a not-found page during a browser check, while your pricing page links a readable machine-readable file. Could you confirm the intended pointer URL?',
    'pointer-file-url-renders-not-found-source-page-current-file': 'The file URL in your cms-hpt.txt rendered a not-found page during a browser check, while your pricing page links a different readable file. Could you update or clarify the pointer URL?',
    'official-page-mrf-root-pointer-unavailable': 'Your pricing page links a readable machine-readable file, but the root cms-hpt.txt request did not return a usable pointer. Could you publish or restore the root pointer for this file?',
    'root-pointer-omits-facility-page-file-found': 'Your pricing page links an identity-matched file, but the root cms-hpt.txt lists other facilities and no entry for this hospital. Could you add this facility and its exact file URL to the root pointer?',
    'root-pointer-omits-facility-official-storage-file-found': 'Your root cms-hpt.txt omits this hospital, although an identity-matched file was observed in the official publisher storage namespace. Could you add this facility and its exact file URL to the root pointer?',
    'pointer-target-google-sheet-page-file-found': 'Your cms-hpt.txt names this facility but points to a Google Sheets edit page, while your pricing page links a complete machine-readable CSV. Could you update the pointer to the direct CSV or document the official export relationship?',
  };

  function templateFor(h) {
    var lines = [
      'Hello,',
      '',
      'This message concerns the machine-readable standard charges file that '
        + h.name + ' publishes under the Hospital Price Transparency rule (45 CFR 180).',
      '',
      TEMPLATE_BY_FINDING[h.finding.key]
        || 'A question came up while reviewing the published standard charges file.',
    ];
    if (h.evidence) lines.push('', 'Observed: ' + h.evidence);
    if (h.ptr) lines.push('Pointer file: ' + h.ptr);
    if (h.mrf) lines.push('Charges file: ' + h.mrf);
    lines.push('', 'Thank you,', '');
    return {
      subject: 'Price transparency file: ' + h.name + ' (CCN ' + h.ccn + ')',
      body: lines.join('\n'),
    };
  }

  /* ---- location map ----

     OpenFreeMap serves the tiles: OpenStreetMap data, no key, no per-view
     tracking, and no quota to keep an eye on. MapLibre draws them, and neither
     is fetched until a drawer actually opens - the tracker already ships 1.8 MB
     of audit data, and a map library nobody asked for would be a third of that
     again on every page load for the people who only read the charts.

     Positron and its dark counterpart are near-achromatic on purpose. This page
     spends colour on one thing, the audit's verdict, and a basemap with green
     parks and blue water beside a red status pin would spend it on scenery. */

  var MAP_LIB = {
    // Pinned and subresource-checked: this is third-party code with the run of
    // the page, and an unpinned CDN URL is a standing invitation.
    js: 'https://unpkg.com/maplibre-gl@5.24.0/dist/maplibre-gl.js',
    jsHash: 'sha384-5+cfbwT0iiub6VsQAdn6yz16nr6sDiQoHx6tm4O8OVYXHYOxcffFmCJBL0dgdvGp',
    css: 'https://unpkg.com/maplibre-gl@5.24.0/dist/maplibre-gl.css',
    cssHash: 'sha384-uTttxo/aOKbdE5RlD/SPzSDoDmNvGlUYPjONi2MN/b7c9HPSvW07OIuyP7uL6jxK',
  };
  var MAP_STYLE = {
    light: 'https://tiles.openfreemap.org/styles/positron',
    dark: 'https://tiles.openfreemap.org/styles/dark',
  };
  // A located address is worth a street-level view. A ZIP centroid is not: zoom
  // that far in and the map draws a specific building the data cannot support.
  var MAP_ZOOM = { exact: 15, approx: 11 };

  var mapWrap = $('oc-map-wrap');
  var mapEl = $('oc-map');
  var mapNote = $('oc-map-note');
  var mapLoad = null;   // the one library load, in flight or finished
  var mapView = null;   // the one map, reused as the drawer moves between hospitals
  var mapPin = null;
  var mapStyled = null; // which theme's style is currently on the map

  function loadMapLibrary() {
    if (mapLoad) return mapLoad;
    mapLoad = new Promise(function (resolve, reject) {
      var css = document.createElement('link');
      css.rel = 'stylesheet';
      css.href = MAP_LIB.css;
      css.integrity = MAP_LIB.cssHash;
      css.crossOrigin = 'anonymous';
      // Above the page's own stylesheet, not after it. MapLibre's control
      // chrome is styled at the same specificity this page overrides it with,
      // so appending would hand every tie to the library and leave a white
      // attribution bar sitting on a black map.
      var ours = document.getElementById('tracker-css');
      if (ours) document.head.insertBefore(css, ours);
      else document.head.appendChild(css);

      var js = document.createElement('script');
      js.src = MAP_LIB.js;
      js.integrity = MAP_LIB.jsHash;
      js.crossOrigin = 'anonymous';
      js.onload = function () {
        clearTimeout(deadline);
        if (window.maplibregl) resolve(window.maplibregl);
        else reject(new Error('map library loaded but did not register'));
      };
      js.onerror = function () { clearTimeout(deadline); reject(new Error('map library did not load')); };
      var deadline = setTimeout(function () { reject(new Error('map library load timed out')); }, 10000);
      document.head.appendChild(js);
    });
    return mapLoad;
  }

  function mapTheme() { return currentTheme() === 'dark' ? 'dark' : 'light'; }

  function pinElement() {
    var el = document.createElement('span');
    el.className = 'oc-pin';
    return el;
  }

  // Says where the pin came from, and nothing at all when the pin is simply
  // right. A caption under every map reading "exact location" would be noise.
  function mapCaption(h) {
    if (!h.approx) return '';
    return 'Approximate: the centre of this hospital’s ZIP code. Its street '
      + 'address is not in the Census address file, so the pin marks the town, not the building.';
  }

  function renderMap(h, tier) {
    if (!mapWrap) return;
    if (!h || h.lat == null || h.lon == null) { mapWrap.hidden = true; return; }

    var at = [h.lon, h.lat];
    var zoom = h.approx ? MAP_ZOOM.approx : MAP_ZOOM.exact;
    mapWrap.hidden = false;
    // A previous failure may have hidden the canvas and written its own note.
    mapEl.hidden = !mapView;
    mapNote.textContent = mapView ? mapCaption(h) : 'Loading location map…';
    mapEl.setAttribute('aria-label', 'Map showing the location of ' + h.name + ', ' + h.city + ', ' + h.state);

    loadMapLibrary().then(function (gl) {
      // The drawer can have moved to another hospital, or closed, while the
      // library was still coming down the wire.
      if (openCcn !== h.ccn) return;
      mapEl.hidden = false;
      mapNote.textContent = mapCaption(h);
      if (!mapView) {
        mapView = new gl.Map({
          container: mapEl,
          style: MAP_STYLE[mapTheme()],
          center: at,
          zoom: zoom,
          // Off here and re-added compact below: the default control is a full
          // bar across a 168px-tall map. The credit itself is not optional -
          // the tile source supplies its own text and this only folds it into
          // an (i) once the map has been touched.
          attributionControl: false,
          // The drawer is a scrolling column. A map that swallowed the wheel
          // would trap the scroll every time it passed under the pointer.
          scrollZoom: false,
          // Same trap, worse: on a touch screen there is no pointer to move
          // away, so a thumb that starts its swipe on the map would drag the
          // map instead of scrolling the panel and the drawer would feel
          // broken. Dragging stays on where there is a mouse to do it with;
          // everywhere else the +/- buttons and pinch are enough.
          dragPan: !window.matchMedia('(pointer: coarse)').matches,
          // Nothing here is worth reading at an angle.
          dragRotate: false,
        });
        mapView.touchZoomRotate.disableRotation();
        mapStyled = mapTheme();
        mapView.addControl(new gl.AttributionControl({ compact: true }));
        mapView.addControl(new gl.NavigationControl({ showCompass: false, showZoom: true }), 'top-right');
        mapPin = new gl.Marker({ element: pinElement() }).setLngLat(at).addTo(mapView);
        // MapLibre measures its container once and then believes itself. The
        // drawer is min(520px, 100%), so a window resize changes the map's
        // width without telling it, and a map built while the drawer was still
        // sliding in measured whatever the container was mid-transition. This
        // makes it follow the box instead of being reminded to.
        if (window.ResizeObserver) new ResizeObserver(resizeMap).observe(mapEl);
      } else {
        if (mapStyled !== mapTheme()) {
          // Markers are DOM overlays, so the pin survives a restyle.
          mapView.setStyle(MAP_STYLE[mapTheme()]);
          mapStyled = mapTheme();
        }
        mapPin.setLngLat(at);
        // jumpTo, not flyTo: this is a new hospital, not a move across one map,
        // and an animated swoop between two unrelated towns reads as a glitch.
        mapView.jumpTo({ center: at, zoom: zoom });
      }
      mapPin.getElement().dataset.tier = tier;
      mapPin.getElement().dataset.approx = h.approx ? '1' : '0';
      resizeMap();
    }).catch(function (err) {
      if (openCcn !== h.ccn) return;
      // Offline, or a blocked CDN. Say so and hand over a map that does work,
      // rather than leaving an empty grey rectangle to be interpreted.
      mapEl.hidden = true;
      mapNote.innerHTML = 'Map unavailable offline. '
        + '<a href="https://www.openstreetmap.org/?mlat=' + encodeURIComponent(h.lat)
        + '&amp;mlon=' + encodeURIComponent(h.lon) + '#map=' + zoom + '/' + encodeURIComponent(h.lat)
        + '/' + encodeURIComponent(h.lon) + '" target="_blank" rel="noopener noreferrer">'
        + 'Open this location in OpenStreetMap</a>.';
      warn(err);
    });
  }

  // The map is built while the drawer is still translated off-screen, so it
  // measures its container as zero and draws nothing until told to look again.
  function resizeMap() {
    if (mapView && !mapWrap.hidden) mapView.resize();
  }

  /* ---- drawer ---- */
  var drawer = $('oc-drawer');
  var DRAWER_VIEWS = ['overview', 'history'];
  function setDrawerView(name) {
    DRAWER_VIEWS.forEach(function (view) {
      $('oc-view-' + view).hidden = view !== name;
      $('oc-tab-' + view).setAttribute('aria-selected', String(view === name));
      $('oc-tab-' + view).tabIndex = view === name ? 0 : -1;
    });
    drawer.querySelector('.oc-body').scrollTop = 0;
    if (name === 'overview') resizeMap();
  }
  DRAWER_VIEWS.forEach(function (view, index) {
    var tab = $('oc-tab-' + view);
    tab.addEventListener('click', function () { setDrawerView(view); });
    tab.addEventListener('keydown', function (event) {
      var count = DRAWER_VIEWS.length;
      var next = event.key === 'ArrowRight' ? (index + 1) % count : event.key === 'ArrowLeft' ? (index + count - 1) % count : event.key === 'Home' ? 0 : event.key === 'End' ? count - 1 : -1;
      if (next < 0) return;
      event.preventDefault();
      setDrawerView(DRAWER_VIEWS[next]);
      $('oc-tab-' + DRAWER_VIEWS[next]).focus();
    });
  });
  $('active-filter-chips').addEventListener('click', function (event) {
    var btn = event.target.closest('button[data-filter]');
    if (!btn) return;
    var key = btn.dataset.filter;
    if (key === 'q') { clearTimeout(debounce); sel.q = ''; qInput.value = ''; if (navQ) navQ.value = ''; }
    else if (key === 'tier') {
      delete sel.tiers[btn.dataset.value];
      [].forEach.call($('tier-chips').querySelectorAll('.chip[data-key]'), function (b) { b.setAttribute('aria-pressed', String(!!sel.tiers[b.dataset.key])); });
    } else {
      sel[key] = '';
      FILTER_SELECTS.forEach(function (f) { if (f.key === key) $(f.id).value = ''; });
      if (key === 'outreach') [].forEach.call($('tier-chips').querySelectorAll('.oc-chip'), function (b) { b.setAttribute('aria-pressed', 'false'); });
    }
    applyFilters();
    qInput.focus();
  });
  var scrim = $('oc-scrim');
  var openCcn = null;
  var lastFocus = null;

  $('oc-status').innerHTML = OC.STATUSES.map(function (s) {
    return '<option value="' + s + '">' + OC_STAGE_LABEL[s] + '</option>';
  }).join('');

  function drawerRecord() { return (openCcn && OC.get(openCcn)) || null; }

  // Which entry is open for editing, if any. Held here rather than in the DOM so
  // a re-render from any other write keeps the form open with the entered text
  // still on screen, and cleared whenever the drawer changes hospital.
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

  function findingLinks(pointerUrl, mrfUrl, edited, sourceUrl, additionalFiles, primaryFileLabel) {
    var links = '';
    if (pointerUrl) links += '<a class="linkbtn"' + (edited ? ' data-edited="1"' : '')
      + ' href="' + esc(pointerUrl) + '" target="_blank" rel="noopener noreferrer">File list</a>';
    if (mrfUrl) links += '<a class="linkbtn"' + (edited ? ' data-edited="1"' : '')
      + ' href="' + esc(mrfUrl) + '" target="_blank" rel="noopener noreferrer">' + (primaryFileLabel ? 'Charges: ' + esc(primaryFileLabel) : 'Charge file') + '</a>';
    (additionalFiles || []).forEach(function (file) {
      links += '<a class="linkbtn" href="' + esc(file[1]) + '" target="_blank" rel="noopener noreferrer">Charges: ' + esc(file[0]) + '</a>';
    });
    if (sourceUrl) links += '<a class="linkbtn" href="' + esc(sourceUrl)
      + '" target="_blank" rel="noopener noreferrer">Price page</a>';
    return links ? '<div class="oc-ev-links">' + links + '</div>' : '';
  }

  // The full record usually opens with the summary sentence, so a disclosure
  // under a summary repeats it. A record short enough to read in place is
  // shown once, whole; only a long one keeps the summary and a disclosure.
  function findingText(summary, text) {
    var whole = compactText(text), brief = compactText(summary);
    if (!whole || whole === brief) return brief ? '<p class="oc-ev-text">' + esc(summary) + '</p>' : '';
    if (whole.length <= 520) return '<p class="oc-ev-text">' + esc(text) + '</p>';
    return (brief ? '<p class="oc-ev-text">' + esc(summary) + '</p>' : '')
      + '<details class="oc-history-detail"><summary>Read the full record</summary><p class="oc-ev-text">' + esc(text) + '</p></details>';
  }

  function findingEntry(item) {
    var head = '<div class="oc-ev-top">'
      + '<span class="oc-ev-kind" data-kind="finding">' + (item.source === 'correction' ? 'Manual correction' : item.source === 'reviewed' ? 'Reviewed check' : item.source === 'nationwide' ? 'Nationwide review' : item.source === 'historical' ? 'Earlier check' : 'Automated check') + '</span>'
      + '<time class="oc-ev-when">' + esc(recordedDate(item.when)) + '</time></div>';
    return '<div class="oc-ev" data-history-kind="finding" data-tier="' + esc(item.tier) + '">' + head
      + '<p class="oc-ev-subject">' + esc(item.label) + '</p>'
      + findingText(item.summary, item.text)
      + findingLinks(item.pointerUrl, item.mrfUrl, item.source === 'correction', item.sourcePage, item.additionalFiles, item.primaryFileLabel)
      + '</div>';
  }

  // Keep each CCN's own evidence, but lead with its observed result and omit
  // procedural next steps from the scan-friendly summary. The full source text
  // remains available in the disclosure and the stored record is unchanged.
  function compactText(text) { return String(text || '').replace(/\s+/g, ' ').trim(); }
  function sourceHash(text) {
    var value = String(text || ''), hash = 2166136261;
    for (var i = 0; i < value.length; i++) { hash ^= value.charCodeAt(i); hash = Math.imul(hash, 16777619); }
    return (hash >>> 0).toString(16).padStart(8, '0');
  }
  function assessmentHash(record) {
    var normalized = {};
    var volatile = ['ccn', 'hospital_name', 'state', 'mrf_url', 'pointer_url', 'source_page', 'sourcePageUrl'];
    Object.keys(record || {}).filter(function (key) { return volatile.indexOf(key) < 0; })
      .sort().forEach(function (key) { normalized[key] = record[key]; });
    return sourceHash(JSON.stringify(normalized));
  }
  function readableSummary(text, label, options) {
    var clean = compactText(text);
    if (!clean) return '';
    options = options || {};
    var browserFallback = clean.match(/Browser fallback reached official (.+?) page; it identifies .+? and links (.+?), but no CMS pointer/i);
    if (browserFallback) {
      var summary = 'The official ' + browserFallback[1] + ' page links ' + browserFallback[2] + ', but no CMS pointer was found.';
      if (/\bHTTP 404\b/i.test(clean)) summary += ' The checked pointer URL returned HTTP 404.';
      return summary;
    }
    if (options.kind === 'email') {
      clean = clean.replace(/^(?:hello|hi|good (?:morning|afternoon|evening))[^\n]*\n+/i, '').trim();
      clean = compactText(clean.split(/\n\s*(?:thanks|thank you|best|sincerely|regards)[^\n]*$/i)[0]);
    }
    var next = clean.search(/\bNext(?: step)?\s*:/i);
    if (next >= 0) clean = clean.slice(0, next).trim();
    var sentences = clean.match(/.+?(?:[.!?](?=\s+[A-Z0-9])|$)/g) || [clean];
    sentences = sentences.map(function (sentence) { return sentence.trim(); }).filter(Boolean);
    if (label && sentences.length) {
      var words = function (value) { return compactText(value).toLowerCase().replace(/[^a-z0-9 ]/g, '').split(/\s+/).filter(function (word) { return word.length > 2; }); };
      var labelWords = words(label);
      var firstWords = words(sentences[0]);
      var shared = labelWords.filter(function (word) { return firstWords.indexOf(word) >= 0; }).length;
      if (labelWords.length && shared / labelWords.length >= 0.6) sentences.shift();
    }
    var summary = sentences.slice(0, 2).join(' ');
    if (!summary) summary = clean;
    var maxChars = options.maxChars || (options.kind === 'email' ? 220 : 240);
    if (summary.length > maxChars) {
      var firstSentence = sentences[0] || summary;
      summary = firstSentence.length <= maxChars ? firstSentence : firstSentence.slice(0, maxChars - 3).replace(/\s+\S*$/, '') + '…';
    }
    return summary;
  }
  function storedSummary(record, text, label, options) {
    if (record && record.sourceHash === sourceHash(text) && record.summary) return record.summary;
    return readableSummary(text, label, options);
  }
  function reviewedNoteSummary(ccn, text) {
    if (!text) return '';
    var hash = sourceHash(text);
    var record = D.readableHistory && D.readableHistory.reviewedNotes
      && D.readableHistory.reviewedNotes[ccn + ':' + hash];
    return record && record.sourceHash === hash ? record.summary : '';
  }
  function outreachRewrite(ccn, id, kind, record) {
    var shared = D.readableHistory && D.readableHistory.outreach && D.readableHistory.outreach[ccn];
    var rewrite = kind === 'correction' ? shared && shared.correction
      : shared && shared.entries && shared.entries[id];
    if (rewrite) return rewrite;
    return record && record.readableSummary
      ? { sourceHash: record.readableSourceHash, summary: record.readableSummary } : null;
  }
  function findingSummary(finding, evidence, rewrite) {
    return storedSummary(rewrite, evidence, finding && finding.label)
      || readableSummary(finding && finding.blurb, finding && finding.label);
  }
  function overviewFinding(h) {
    if (h.finding.key === 'pointer-target-dns-unresolved-page-file-found') return {
      title: 'Charge file found; link needs review',
      detail: 'The hospital’s pricing page linked to a charge file that opened. Its published file list names a different address that did not work in the check.'
    };
    if (h.finding.key === 'compliant-observed') return {
      title: 'Charge file found',
      detail: 'A machine-readable charge file was found for this hospital.'
        + (h.updatedAt ? ' The file reports an update on ' + recordedDate(h.updatedAt) + '.' : '')
    };
    if (h.finding.key === 'mrf-stale-over-365-days') return {
      title: 'File update date is over a year old',
      detail: 'The date reported by the charge file was more than a year old when it was checked.'
    };
    if (h.finding.key === 'not-assessed-nationwide-pointer-not-retrieved') return {
      title: 'Hospital file list not found',
      detail: 'The hospital’s file list could not be opened at the locations checked. A charge file may still be available elsewhere.'
    };
    if (h.finding.key === 'not-assessed-nationwide-pointer-discovery-incomplete') return {
      title: 'File link check incomplete',
      detail: 'The request did not finish, so the hospital’s current file link could not be confirmed.'
    };
    if (h.finding.key === 'mrf-facility-identity-unresolved'
        || h.finding.key === 'not-assessed-nationwide-linked-mrf-header-unmatched'
        || h.finding.key === 'not-assessed-nationwide-mrf-facility-identity-unresolved') return {
      title: 'File found; hospital match unconfirmed',
      detail: 'A possible charge file was reached, but it could not be confirmed as belonging to this hospital.'
    };
    return {
      title: h.finding.label,
      detail: readableSummary(h.finding.blurb, h.finding.label, { maxChars: 220 })
        || findingSummary(h.finding, h.evidence,
          D.readableHistory && D.readableHistory.findings && D.readableHistory.findings[openCcn])
    };
  }
  // A next check is shown whole when it is short. A disclosure is offered only
  // when the summary actually leaves something out; "Full next check" that
  // repeats the line above it word for word is noise.
  function nextCheckHtml(summary, full) {
    var whole = compactText(full);
    var brief = compactText(summary);
    if (!brief || whole.length <= 280 || brief === whole)
      return '<p><strong>Next check:</strong> ' + esc(whole || brief) + '</p>';
    return '<p><strong>Next check:</strong> ' + esc(brief) + '</p>'
      + '<details class="oc-history-detail"><summary>Full next check</summary><p>' + esc(whole) + '</p></details>';
  }
  function assessmentFallbackSummary(record) {
    return [['Official site', record.website], ['Pointer', record.pointer],
      ['Facility match', record.identity], ['File access', record.file_access],
      ['Date / template', record.metadata], ['Browser check', record.browser_observation]]
      .filter(function (field) { return field[1]; })
      .map(function (field) { return field[0] + ': ' + String(field[1]).replace(/-/g, ' ') + '.'; }).join(' ');
  }

  function auditDocumentEntry(record, brief) {
    return '<li class="oc-audit-doc">'
      + '<span class="oc-audit-doc-heading">' + esc(record.title) + '</span>'
      + (record.observedAt ? '<time>' + esc(record.observedAt) + '</time>' : '')
      + '<p>' + esc(record.finding) + '</p>'
      + (!brief && record.nextAction ? '<p><strong>Next:</strong> ' + esc(record.nextAction) + '</p>' : '')
      + '<small>Source: ' + esc(record.sourceFile)
      + (record.recordIndex == null ? '' : ' · record ' + (record.recordIndex + 1))
      + '</small></li>';
  }

  function renderAuditDocuments() {
    var records = D.auditDocuments && D.auditDocuments[openCcn] || [];
    var history = $('oc-audit-documents-history');
    history.hidden = !records.length;
    if (!records.length) return;
    history.innerHTML = '<details class="oc-disclosure"><summary>Source notes (' + records.length + ')</summary>'
      + '<ul class="oc-audit-doc-list">' + records.map(auditDocumentEntry).join('') + '</ul></details>';
  }

  function isRetainedStandingStream(stream) {
    return stream === 'standing-evidence-follow-up' || stream === 'standing-evidence-access-retry';
  }

  function simpleNextStep(step, followup, assessment) {
    if (step) {
      var hospital = hospitalOf(openCcn);
      if (hospital && hospital.finding.key === 'pointer-target-dns-unresolved-page-file-found')
        return 'The hospital should correct that file address. The charge file on its pricing page remains available.';
      if (step.stream === 'standing-evidence-access-retry')
        return 'A later check' + (step.latestObservedAt ? ' on ' + recordedDate(step.latestObservedAt) : '')
          + ' could not reach or finish reading the file, so it says nothing against the finding. The finding stands until a check reads the file.';
      if (step.stream === 'standing-evidence-follow-up')
        return 'A later check' + (step.latestObservedAt ? ' on ' + recordedDate(step.latestObservedAt) : '')
          + ' did not verify a different result. This is the latest verified finding in this snapshot.';
      if (step.stream === 'supported-uncertainty-monitor')
        return 'Check again when the hospital or publisher provides new evidence.';
      if (step.stream === 'same-campus-ccn-review' || step.stream === 'identity-quarantine')
        return 'Confirm which hospital this file belongs to.';
      if (step.stream === 'genuinely-unresolved-investigation')
        return 'Find a current official charge file and confirm it belongs to this hospital.';
      return readableSummary(step.nextAction, '', { maxChars: 180 });
    }
    if (followup) return 'A later check' + (followup.observedAt ? ' on ' + recordedDate(followup.observedAt) : '')
      + ' did not verify a different result. This is the latest verified finding in this snapshot.';
    if (assessment && assessment.blocker && !/no discovery follow-up|next scheduled crawl/i.test(assessment.blocker))
      return readableSummary(assessment.blocker, '', { maxChars: 180 });
    return '';
  }

  // One row per thing we tried, in the order a reader would try it: is there a
  // site, did it list a file, is the file this hospital's, did it open, does it
  // meet the date and template rules. A row is left out when the record does not
  // say, rather than printing "unknown" for something nobody checked.
  function checkLedger(assessment, mrfCheck, pointerLinkIssue) {
    var rows = [];
    var a = assessment || {};
    var website = String(a.website || ''), pointer = String(a.pointer || '');
    var identity = String(a.identity || ''), file = String(a.file_access || '');
    if (/official|first-party/i.test(website) && !/not|unresolved|missing|unknown/i.test(website))
      rows.push(['Website', 'Official site identified', 'ok']);
    else if (/not|unresolved|missing|unknown/i.test(website)) rows.push(['Website', 'Not confirmed', 'no']);
    if (pointerLinkIssue) rows.push(['File list', 'Names a different file address, which did not respond', 'warn']);
    else if (/not-retrieved|unavailable|not-found/.test(pointer))
      rows.push(['File list', 'Not retrieved from the places checked', 'no']);
    else if (/retrieved/.test(pointer)) rows.push(['File list', 'Retrieved', 'ok']);
    if (/unresolved|uncertain|not-matched|not-corroborated/.test(identity))
      rows.push(['Hospital match', 'File not yet matched to this hospital', 'warn']);
    else if (/corroborated|confirmed|matched|exact/.test(identity))
      rows.push(['Hospital match', 'File matches this hospital', 'ok']);
    if (/HTTP 2\d\d|retrieved|opened/.test(file) && !/not|unresolved|failed/.test(file))
      rows.push(['Charge file', 'Opened', 'ok']);
    else if (/HTTP [45]\d\d|failed|not-retrieved|unresolved/.test(file))
      rows.push(['Charge file', 'Did not open', 'no']);
    if (mrfCheck) rows.push(['Date and template', mrfCheck.label,
      { met: 'ok', issue: 'no', review: 'warn' }[mrfCheck.state] || 'na',
      pointerLinkIssue ? 'The file date and format were recorded; the published link still needs review.' : mrfCheck.detail]);
    return rows;
  }

  function renderTimeline() {
    var h = hospitalOf(openCcn);
    var rec = drawerRecord();
    var entries = rec ? (rec.entries || []) : [];
    var items = entries.map(function (e, i) {
      var when = e.kind === 'email' ? (e.sentAt || String(e.at).slice(0, 10)) : String(e.at).slice(0, 10);
      return { type: 'entry', entry: e, when: when, priority: 2, order: i };
    });
    var priorAudit = D.auditHistory && D.auditHistory[openCcn];
    if (priorAudit) {
      var priorFinding = D.findings.filter(function (f) { return f.key === priorAudit.finding; })[0];
      var priorText = priorAudit.evidence + (priorAudit.history_source === 'nationwide-overlay' ? ' Update: ' : ' Review: ') + priorAudit.resolution_note;
      items.push({ type: 'finding', source: 'historical', when: String(priorAudit.checked_at || '').slice(0, 10),
        tier: priorFinding ? priorFinding.tier : 'unknown', label: (priorAudit.history_source === 'nationwide-overlay' ? 'Earlier standing assessment: ' : 'Original audit: ') + (priorFinding ? priorFinding.label : priorAudit.finding),
        summary: storedSummary(D.readableHistory && D.readableHistory.auditHistory && D.readableHistory.auditHistory[openCcn], priorText, priorFinding && priorFinding.label)
          || 'Earlier finding retained in the audit history.',
        text: priorText,
        pointerUrl: priorAudit.pointer_url, mrfUrl: priorAudit.mrf_url, priority: 0, order: items.length });
    }

    // Findings are read-only timeline events. The crawl remains visible when a
    // manual correction becomes the standing verdict, preserving both pieces
    // of provenance without copying either one into the editable outreach log.
    if (h) {
      items.push({
        type: 'finding', source: priorAudit ? (priorAudit.history_source === 'nationwide-overlay' ? 'nationwide' : 'reviewed') : 'crawl', when: String(h.checkedAt || '').slice(0, 10),
        tier: h.finding.tier, label: h.finding.label,
        summary: findingSummary(h.finding, h.evidence, D.readableHistory && D.readableHistory.findings && D.readableHistory.findings[openCcn]),
        text: h.evidence || '', pointerUrl: h.ptr, mrfUrl: h.mrf, sourcePage: h.source,
        additionalFiles: h.additionalFiles, primaryFileLabel: h.primaryFileLabel,
        priority: 1, order: items.length,
      });
    }
    if (h && rec && rec.correction) {
      var corr = rec.correction;
      var corrTier = corr.verdict || h.finding.tier;
      items.push({
        type: 'finding', source: 'correction', when: corr.checkedOn || String(rec.updatedAt || '').slice(0, 10),
        tier: corrTier,
        label: corr.verdict ? TIER_META[corrTier].short + ' (manual correction)' : 'Manual correction',
        summary: storedSummary(outreachRewrite(openCcn, '', 'correction', corr), corr.note) || 'A manual correction was recorded.',
        text: corr.note || 'Manual correction recorded.',
        pointerUrl: corr.pointerUrl, mrfUrl: corr.mrfUrl,
        priority: 3, order: items.length,
      });
    }

    if (!items.length) {
      $('oc-timeline').innerHTML = '<p class="oc-hint">No activity recorded for this hospital yet.</p>';
      return;
    }
    // An entry can be deleted while its form is open, from here or from the
    // terminal. Drop the flag rather than rendering a form for nothing.
    if (editingId && !entries.some(function (e) { return e.id === editingId; })) editingId = null;

    items.sort(function (a, b) {
      if (a.when !== b.when) return a.when < b.when ? 1 : -1;
      if (a.priority !== b.priority) return b.priority - a.priority;
      return a.order - b.order;
    });

    $('oc-timeline').innerHTML = items.map(function (item) {
      if (item.type === 'finding') return findingEntry(item);
      var e = item.entry;
      var editing = e.id === editingId;
      var head = '<div class="oc-ev-top">'
        + '<span class="oc-ev-kind" data-kind="' + e.kind + '">' + (e.kind === 'email' ? 'Email' : 'Note') + '</span>'
        + (e.editedAt ? '<span class="oc-ev-edited">edited ' + esc(recordedDate(e.editedAt)) + '</span>' : '')
        + '<time class="oc-ev-when">' + esc(recordedDate(item.when)) + '</time></div>';
      var open = '<div class="oc-ev" data-kind="' + e.kind + '" data-id="' + esc(e.id) + '"'
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
        var emailSummary = storedSummary(outreachRewrite(openCcn, e.id, 'entry', e), e.body, '', { kind: 'email' });
        return open
          + '<p class="oc-ev-subject">' + esc(e.subject) + '</p>'
          + (e.to ? '<p class="oc-ev-to">to ' + esc(e.to) + '</p>' : '')
          + (emailSummary ? '<p class="oc-ev-text">' + esc(emailSummary) + '</p>' : '')
          + (e.body && compactText(emailSummary) !== compactText(e.body)
            ? '<details class="oc-history-detail"><summary>Read full email</summary><p class="oc-ev-text">' + esc(e.body) + '</p></details>' : '')
          + foot + '</div>';
      }
      var noteSummary = storedSummary(outreachRewrite(openCcn, e.id, 'entry', e), e.text);
      return open + '<p class="oc-ev-text">' + esc(noteSummary) + '</p>'
        + (noteSummary !== compactText(e.text)
          ? '<details class="oc-history-detail"><summary>Read full note</summary><p class="oc-ev-text">' + esc(e.text) + '</p></details>' : '')
        + foot + '</div>';
    }).join('');
  }

  function renderDrawer(force) {
    if (!openCcn) return;
    var h = hospitalOf(openCcn);
    var rec = drawerRecord();
    var corr = correctionOf(openCcn);
    $('oc-title').textContent = h ? h.name : openCcn;
    $('oc-record-ccn').textContent = 'CCN ' + openCcn;
    $('oc-subtitle').innerHTML = h
      ? '<span class="oc-record-place">' + esc(h.city + ', ' + h.state) + '</span>' : '';

    // One verdict: the badge says which bucket, the headline says why, and the
    // date says how old that is. A manual correction owns the badge, so the
    // crawl's own headline is labelled as the automated check it came from.
    var overview = h && overviewFinding(h);
    $('oc-finding-title').textContent = overview ? overview.title : 'No audit finding recorded';
    $('oc-finding-detail').textContent = overview ? overview.detail : '';
    renderAuditDocuments();
    var reviewedFollowup = D.reviewedFollowups && D.reviewedFollowups[openCcn];
    var followupBlock = $('oc-reviewed-followup');
    if (followupBlock) {
      followupBlock.hidden = !reviewedFollowup;
      if (reviewedFollowup) {
        followupBlock.innerHTML = '<h4>Later reviewed observation · ' + esc(String(reviewedFollowup.observedAt).slice(0, 10)) + '</h4>'
          + '<p class="oc-hint">This follow-up does not replace the standing finding.</p>'
          + '<p>' + esc(reviewedFollowup.disposition.replace(/-/g, ' ')) + '</p>'
          + (reviewedFollowup.fileEvidence
            ? '<p><strong>Recovered file evidence:</strong> ' + esc(reviewedFollowup.fileEvidence.facilityName || 'facility identity pending')
              + (reviewedFollowup.fileEvidence.address ? ' · ' + esc(reviewedFollowup.fileEvidence.address) : '')
              + (reviewedFollowup.fileEvidence.state ? ' · ' + esc(reviewedFollowup.fileEvidence.state) : '')
              + (reviewedFollowup.fileEvidence.declaredDate ? ' · dated ' + esc(reviewedFollowup.fileEvidence.declaredDate) : '')
              + (reviewedFollowup.fileEvidence.version ? ' · CMS ' + esc(reviewedFollowup.fileEvidence.version) : '')
              + ' · ' + esc(reviewedFollowup.fileEvidence.bytes.toLocaleString()) + ' bytes · SHA-256 ' + esc(reviewedFollowup.fileEvidence.sha256)
              + '</p>'
              + (reviewedFollowup.fileEvidence.structuralDefect
                ? '<p><strong>Open file issue:</strong> ' + esc(reviewedFollowup.fileEvidence.structuralDefect) + '</p>' : '')
            : '')
          + (reviewedFollowup.crossFacilityEvidence
            ? '<p><strong>Current state cross-check · ' + esc(String(reviewedFollowup.crossFacilityEvidence.retrievedAt).slice(0, 10)) + ':</strong> '
              + 'license ' + esc(reviewedFollowup.crossFacilityEvidence.facilityA.license) + ' · ' + esc(reviewedFollowup.crossFacilityEvidence.facilityA.address)
              + ' <em>versus</em> license ' + esc(reviewedFollowup.crossFacilityEvidence.facilityB.license) + ' · ' + esc(reviewedFollowup.crossFacilityEvidence.facilityB.address)
              + ' · source SHA-256 ' + esc(reviewedFollowup.crossFacilityEvidence.sourceSha256)
              + '</p><p class="oc-hint">' + esc(reviewedFollowup.crossFacilityEvidence.interpretation) + '</p>'
            : '')
          + (reviewedFollowup.campusScopeEvidence
            ? '<p><strong>First-party campus scope · ' + esc(String(reviewedFollowup.observedAt).slice(0, 10)) + ':</strong> '
              + esc(reviewedFollowup.campusScopeEvidence.hospitalCampus) + ' <em>versus</em> '
              + esc(reviewedFollowup.campusScopeEvidence.relatedCampus) + '</p>'
              + '<p class="oc-hint">' + esc(reviewedFollowup.campusScopeEvidence.interpretation) + '</p>'
            : '')
          + '<p><strong>Next check:</strong> ' + esc(reviewedFollowup.nextAction) + '</p>';
      }
    }
    var investigationStep = D.investigationNextSteps && D.investigationNextSteps[openCcn];
    var investigationBlock = $('oc-investigation-next-step');
    if (investigationBlock) {
      investigationBlock.hidden = !investigationStep || !!reviewedFollowup;
      if (investigationStep && !reviewedFollowup) {
        var retainedStanding = isRetainedStandingStream(investigationStep.stream);
        var supportedUncertainty = investigationStep.stream === 'supported-uncertainty-monitor';
        var sameCampusCcnReview = investigationStep.stream === 'same-campus-ccn-review';
        // Named the way the work queue names it, so the record and the queue
        // card a reader arrived from use the same words.
        var streamMeta = (D.queue || []).filter(function (q) { return q.key === investigationStep.stream; })[0];
        var gateText = investigationStep.gate.replace(/-/g, ' ');
        investigationBlock.innerHTML = '<h4>' + esc(streamMeta ? streamMeta.label : 'Open follow-up') + '</h4>'
          + '<p class="oc-hint">Stopped at: ' + esc(gateText.charAt(0).toUpperCase() + gateText.slice(1)) + '.</p>'
          + (retainedStanding
            ? '<p class="oc-hint">The later incomplete check does not erase the standing finding.'
              + (investigationStep.latestObservedAt ? ' Latest check: ' + esc(String(investigationStep.latestObservedAt).slice(0, 10)) + '.' : '')
              + '</p>'
            : supportedUncertainty
              ? '<p class="oc-hint">The documented conflict remains open; this is not a verified recovery.'
                + (investigationStep.latestObservedAt ? ' Reviewed ' + esc(String(investigationStep.latestObservedAt).slice(0, 10)) + '.' : '')
                + '</p>'
            : sameCampusCcnReview
              ? '<p class="oc-hint">A shared hospital name and address do not establish which enrollment a current file covers.</p>'
            : '')
          + (investigationStep.browserFileStatus
            ? '<p class="oc-hint">Last browser file result: ' + esc(investigationStep.browserFileStatus.replace(/-/g, ' '))
              + (investigationStep.browserFileObservedAt ? ' · ' + esc(String(investigationStep.browserFileObservedAt).slice(0, 10)) : '') + '</p>'
            : '')
          + '<p><strong>Next check:</strong> ' + esc(investigationStep.nextAction) + '</p>';
      }
    }
    var tier, pointerLinkIssue = false, mrfCheck = null;
    var correctedVerdict = !!(corr && corr.verdict);
    var badgeHtml = '', whenText = '', originText = '';
    if (h) {
      tier = correctedVerdict ? corr.verdict : h.finding.tier;
      pointerLinkIssue = !correctedVerdict
        && h.finding.key === 'pointer-target-dns-unresolved-page-file-found';
      badgeHtml = '<span class="badge" data-tier="' + tier + '"'
        + (correctedVerdict ? ' data-edited="1"' : '')
        + ' title="' + esc(pointerLinkIssue
          ? 'A hospital charge file was found; its pointer link needs review.'
          : (correctedVerdict ? 'Manual correction. ' : '') + TIER_META[tier].note) + '"'
        + '>' + (pointerLinkIssue ? 'File found · link issue' : TIER_META[tier].short) + '</span>';
      var resultDate = correctedVerdict ? (corr.checkedOn || rec && rec.updatedAt || '') : h.checkedAt;
      whenText = (correctedVerdict ? 'Manual correction' : 'Checked')
        + (resultDate ? ' · ' + recordedDate(resultDate) : '');
      if (correctedVerdict) originText = 'Automated check' + (h.checkedAt ? ' · ' + recordedDate(h.checkedAt) : '');
      mrfCheck = window.TrackerSummary.mrfCheck(currentRecords[openCcn]);
      var ptr = (corr && corr.pointerUrl) || h.ptr;
      var mrf = (corr && corr.mrfUrl) || h.mrf;
      var links = [];
      if (ptr) links.push(['File list', ptr, !!(corr && corr.pointerUrl)]);
      if (mrf) links.push([!(corr && corr.mrfUrl) && h.primaryFileLabel ? 'Charges: ' + h.primaryFileLabel : 'Charge file', mrf, !!(corr && corr.mrfUrl)]);
      if (!(corr && corr.mrfUrl)) h.additionalFiles.forEach(function (file) { links.push(['Charges: ' + file[0], file[1], false]); });
      if (h.source) links.push(['Hospital price page', h.source, false]);
      $('oc-sources').innerHTML = links.map(function (link) {
        var host = ''; try { host = new URL(link[1]).hostname.replace(/^www\./, ''); } catch (err) { /* show the name alone */ }
        return '<li><a href="' + esc(link[1]) + '" target="_blank" rel="noopener noreferrer"'
          + (link[2] ? ' data-edited="1"' : '') + '><span class="oc-src-name">' + esc(link[0]) + '</span>'
          + (host ? '<span class="oc-src-host">' + esc(host) + '</span>' : '')
          + '<span class="oc-src-go" aria-hidden="true">↗</span></a></li>';
      }).join('');
      $('oc-source-actions').hidden = !links.length;
    } else {
      $('oc-sources').innerHTML = '';
      $('oc-source-actions').hidden = true;
    }
    $('oc-verdict-badge').innerHTML = badgeHtml;
    $('oc-finding-source').textContent = whenText;
    var origin = $('oc-finding-origin');
    origin.textContent = originText;
    origin.hidden = !originText;
    var outreachHistory = $('oc-history-outreach');
    outreachHistory.hidden = !(rec && rec.status && rec.status !== 'none');
    if (!outreachHistory.hidden) outreachHistory.textContent = 'Outreach · ' + OC_STAGE_LABEL[rec.status];
    var assessment = D.assessments && D.assessments[openCcn];
    var assessmentBlock = $('oc-assessment');
    var plainNext = simpleNextStep(investigationStep, reviewedFollowup, assessment);
    var plainNextBlock = $('oc-simple-next');
    plainNextBlock.hidden = !plainNext;
    var standingExplanation = h && h.finding.key !== 'pointer-target-dns-unresolved-page-file-found'
      && (investigationStep
        ? isRetainedStandingStream(investigationStep.stream) : !!reviewedFollowup);
    if (plainNext) plainNextBlock.innerHTML = '<h4>'
      + (standingExplanation ? 'Why this finding remains' : 'What needs checking')
      + '</h4><p>' + esc(plainNext) + '</p>';
    $('oc-technical-record').hidden = !(assessment || investigationStep || reviewedFollowup);
    $('oc-trail').hidden = $('oc-audit-documents-history').hidden && $('oc-technical-record').hidden;
    var ledgerRows = h ? checkLedger(assessment, mrfCheck, pointerLinkIssue) : [];
    $('oc-ledger-block').hidden = !ledgerRows.length;
    $('oc-ledger').innerHTML = ledgerRows.map(function (row) {
      return '<div class="oc-check" data-s="' + row[2] + '"><dt>' + esc(row[0]) + '</dt><dd>' + esc(row[1])
        + (row[3] ? '<small>' + esc(row[3]) + '</small>' : '') + '</dd></div>';
    }).join('');
    if (assessmentBlock) {
      assessmentBlock.hidden = !assessment;
      if (assessment) {
        var assessmentRewrites = D.readableHistory && D.readableHistory.assessments && D.readableHistory.assessments[openCcn] || [];
        var assessmentRewrite = assessmentRewrites[0];
        var assessmentSummaryText = assessmentRewrite && assessmentRewrite.sourceHash === assessmentHash(assessment)
          ? assessmentRewrite.summary : assessmentFallbackSummary(assessment);
        var assessmentFullText = assessmentRewrite && assessmentRewrite.sourceHash === assessmentHash(assessment)
          ? assessmentRewrite.fullText : '';
        var nextActionSummary = reviewedNoteSummary(openCcn, assessment.blocker)
          || (assessmentRewrite && assessmentRewrite.sourceHash === assessmentHash(assessment)
            ? assessmentRewrite.nextActionSummary : readableSummary(assessment.blocker, '', { maxChars: 180 }));
        // The follow-up block above already explains a retained finding and
        // already names the next check; repeating either here is what made the
        // record read as the same paragraph three times. The fallback summary
        // is a sentence form of the table below, so it is dropped too.
        var followupShown = !!(investigationStep || reviewedFollowup);
        var retainedShown = investigationStep && isRetainedStandingStream(investigationStep.stream);
        var summaryRepeatsTable = !assessmentSummaryText
          || compactText(assessmentSummaryText) === compactText(assessmentFallbackSummary(assessment))
          || /^Official site:/.test(assessmentSummaryText);
        assessmentBlock.innerHTML = '<h4>Check details</h4><p class="oc-hint">Checked ' + esc(String(assessment.checked_at || '').slice(0, 10)) + '.'
        + (retainedShown ? '' : ' A later unsuccessful request does not erase stronger earlier evidence.') + '</p>'
        + (summaryRepeatsTable ? '' : '<p class="oc-ev-text">' + esc(assessmentSummaryText) + '</p>')
        + (assessmentFullText && compactText(assessmentFullText) !== compactText(assessmentSummaryText)
          ? '<details class="oc-history-detail"><summary>Full assessment details</summary><p>' + esc(assessmentFullText) + '</p></details>' : '')
        + '<dl>' + [['Website', assessment.website], ['Pointer file', assessment.pointer], ['Hospital match', assessment.identity],
          ['Charge file', assessment.file_access], ['File details', assessment.metadata],
          ['Browser', assessment.browser_observation]].filter(function (field) { return field[1]; }).map(function (field) {
            return '<dt>' + esc(field[0]) + '</dt><dd>' + esc(String(field[1]).replace(/-/g, ' ')) + '</dd>';
          }).join('') + '</dl>'
        + (assessment.blocker && !followupShown ? nextCheckHtml(nextActionSummary, assessment.blocker) : '')
        + (assessment.pointer === 'retrieved-facility-match-unresolved' && assessment.pointer_checked_url
          ? '<p class="oc-hint">Checked pointer source captured ' + esc(String(assessment.pointer_corpus_observed_at || '').slice(0, 10))
            + '; no entry has been assigned to this hospital.</p><div class="oc-ev-links"><a class="linkbtn" href="'
            + esc(assessment.pointer_checked_url) + '" target="_blank" rel="noopener noreferrer">CHECKED POINTER</a>'
            + (assessment.pointer_final_url && assessment.pointer_final_url !== assessment.pointer_checked_url
              ? '<a class="linkbtn" href="' + esc(assessment.pointer_final_url)
                + '" target="_blank" rel="noopener noreferrer">REDIRECT DESTINATION</a>' : '') + '</div>'
          : '')
        + (assessment.pointer_raw_integrity === 'hash-conflict'
          ? '<p class="oc-hint">Pointer cache warning: retained raw bytes do not match the crawl-state hash. That hash is historical, not corroborated by this cache. This does not change the hospital finding.</p>' : '')
        + (assessment.pointer_historical_checked_url
          ? '<p class="oc-hint">Earlier pointer bytes were retained from ' + esc(String(assessment.pointer_historical_observed_at || '').slice(0, 10))
            + (assessment.pointer_historical_raw_integrity === 'hash-corroborated' ? ' and match their recorded hash' : ' but their recorded hash is not corroborated')
            + '. A later pointer request failed; this earlier capture is not proof of current access.</p><div class="oc-ev-links"><a class="linkbtn" href="'
            + esc(assessment.pointer_historical_checked_url) + '" target="_blank" rel="noopener noreferrer">EARLIER POINTER SOURCE</a></div>' : '')
        + ((D.assessmentHistory && D.assessmentHistory[openCcn] || []).length > 1
          ? '<details><summary>Earlier separate checks</summary>' + D.assessmentHistory[openCcn].slice(1).map(function (prior) {
            var priorHash = assessmentHash(prior);
            var priorRewrite = assessmentRewrites.find(function (rewrite) { return rewrite.sourceHash === priorHash; });
            return '<div class="oc-prior"><p class="oc-prior-h">' + esc(String(prior.checked_at || 'Undated').slice(0, 10)) + ' · ' + esc(prior.source || 'Observation')
              + '</p><p>' + esc(priorRewrite ? priorRewrite.summary : assessmentFallbackSummary(prior)) + '</p>'
              + (prior.blocker ? '<p><strong>Next check:</strong> ' + esc(prior.blocker) + '</p>' : '')
              + '</div>';
          }).join('') + '</details>' : '');
      }
    }
    // Every raw transcript collected for this hospital's finding. Status and
    // edge attribution are inline so the list reads without opening a file.
    var evBlock = $('oc-evidence-block');
    var evList = openCcn && D.evidence ? D.evidence[openCcn] : null;
    if (evBlock) {
      if (evList && evList.length) {
        $('oc-evidence').innerHTML = evList.map(function (e) {
          return '<div class="oc-evidence-row">'
            + '<span class="oc-ev-status" data-s="' + esc(String(e[1])) + '">HTTP ' + esc(String(e[1])) + '</span>'
            + (e[2] ? '<span class="oc-ev-edge">' + esc(e[2]) + '</span>' : '')
            + '<span class="oc-ev-url">' + esc(e[0]) + '</span>'
            + '<a class="linkbtn" href="data/hpt-audit/' + esc(e[3]) + '" target="_blank" rel="noopener noreferrer">transcript</a>'
            + '</div>';
        }).join('');
        evBlock.hidden = false;
      } else {
        evBlock.hidden = true;
      }
    }
    // Passed the same tier the badge just used, so correcting a verdict
    // recolours the pin along with everything else.
    renderMap(h, tier);
    $('oc-status').value = rec ? rec.status : 'none';
    $('oc-followup').value = rec ? (rec.followUpOn || '') : '';
    fillCorrection(force);
    renderTimeline();
  }

  function openDrawer(ccn) {
    openCcn = ccn;
    setDrawerView('overview');
    if ($('oc-evidence-block')) $('oc-evidence-block').open = false;
    $('oc-technical-record').open = false;
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
    if ($('oc-email-advance')) $('oc-email-advance').checked = true;
    // Every hospital opens on the same task. Logging an email is the common
    // case, and a panel that remembered the last one would make the form depend
    // on whichever hospital was opened previously.
    setTask('email');
    $('oc-email-state').textContent = '';
    $('oc-note-state').textContent = '';
    $('oc-c-discards').textContent = '';
    // An entry form left open belongs to the previously viewed hospital.
    editingId = null;
    // A different hospital's correction must replace whatever is in the form.
    renderDrawer(true);
    drawer.hidden = false;
    scrim.hidden = false;
    // Establish the closed position after display:none before transitioning.
    void drawer.offsetWidth;
    // Next frame so the transform transition actually runs.
    requestAnimationFrame(function () {
      if (openCcn !== ccn) return;
      drawer.classList.add('on');
      scrim.classList.add('on');
      $('oc-close').focus();
      // renderDrawer ran while the drawer was still hidden, so a map that was
      // already built measured its container as zero.
      resizeMap();
    });
    document.addEventListener('keydown', onDrawerKey);
  }

  function closeDrawer() {
    if (!openCcn) return;
    openCcn = null;
    // An edit made in the drawer can change where its row belongs in the
    // current sort. Moving it during data entry would be hostile,
    // so the re-order waits until the drawer is out of the way.
    if (sortStale) { sortStale = false; resort(); }
    drawer.classList.remove('on');
    scrim.classList.remove('on');
    document.removeEventListener('keydown', onDrawerKey);
    window.setTimeout(function () {
      if (!openCcn) { drawer.hidden = true; scrim.hidden = true; }
    }, reduceMotion.matches ? 0 : 220);
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  function onDrawerKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); closeDrawer(); return; }
    if (e.key !== 'Tab') return;
    // Keep tabbing inside the drawer while it is modal.
    var f = drawer.querySelectorAll('a[href], button, input, select, textarea, summary, [tabindex="0"]');
    var list = [].filter.call(f, function (el) { return !el.disabled && el.offsetParent !== null; });
    if (!list.length) return;
    var first = list[0], last = list[list.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  scrim.addEventListener('click', closeDrawer);
  $('oc-close').addEventListener('click', closeDrawer);

  // Rows are re-rendered constantly by the virtualiser, so delegate. The whole
  // row opens the drawer, not just the name: on a 64px row the name was a 34px
  // target that required prior knowledge, and on the phone card it left most of the
  // card inert. The Log button needs no case of its own, it sits inside a row
  // that carries the same CCN.
  canvas.addEventListener('click', function (e) {
    if (!e.target.closest) return;
    // FILE and PTR point at the hospital's own server. Those clicks are theirs.
    if (e.target.closest('a[href]')) return;
    // A click that lands at the end of a drag is someone copying a CCN, not
    // asking for the drawer.
    var sel = window.getSelection && window.getSelection();
    if (sel && !sel.isCollapsed && String(sel).trim()) return;
    var row = e.target.closest('.reg-row');
    if (row && row.dataset.ccn) {
      openDrawer(row.dataset.ccn);
    }
  });

  function seedFields() {
    var h = hospitalOf(openCcn);
    return h ? { name: h.name, city: h.city, state: h.state } : {};
  }

  function warn(err) {
    console.error('[outreach]', err);
    window.alert('Could not save: ' + (err && err.message ? err.message : err));
  }

  // The store coerces silently, a URL without a scheme is stored empty, a long
  // body is clipped at 8000 characters. It reports what it dropped; without this
  // the field just quietly empties and the save looks clean.
  function showDiscards(slotId, prefix, msgs) {
    var slot = $(slotId);
    if (!slot) return false;
    msgs = msgs || OC.lastDiscards();
    slot.textContent = msgs.length ? (prefix || 'Saved, but ') + msgs.join('; ') + '.' : '';
    return msgs.length > 0;
  }

  /* ---- one form at a time ----
     The panel used to show all nineteen inputs at once, organised by the shape
     of the data rather than by what had happened. These three cover every way a
     record changes; picking one hides the other two, so there is a single
     primary button on screen at any moment. */
  var TASKS = ['email', 'note', 'correction'];
  function setTask(name) {
    TASKS.forEach(function (t) {
      var btn = document.querySelector('.oc-task[data-task="' + t + '"]');
      var panel = $('oc-panel-' + t);
      if (btn) btn.setAttribute('aria-pressed', t === name ? 'true' : 'false');
      if (panel) panel.hidden = t !== name;
    });
  }
  [].forEach.call(document.querySelectorAll('.oc-task'), function (btn) {
    btn.addEventListener('click', function () { setTask(btn.dataset.task); });
  });

  // Stage and the follow-up date commit on change, unlike every other field in
  // the drawer. Saying so out loud is the only thing that makes the difference
  // legible.
  var savedTimer;
  function flashSaved() {
    var el = $('oc-state-saved');
    if (!el) return;
    el.textContent = 'Saved';
    el.classList.add('on');
    clearTimeout(savedTimer);
    savedTimer = setTimeout(function () {
      el.classList.remove('on');
      el.textContent = '';
    }, 1800);
  }

  // Shared by the +30 days button and by the side effect of logging an email.
  // Nudges from whatever date is passed in, or today when that is empty, so
  // clicking +30 days again keeps pushing the date forward.
  function plusDays(fromIso, n) {
    var base = /^\d{4}-\d{2}-\d{2}$/.test(fromIso || '') ? new Date(fromIso + 'T00:00:00') : new Date();
    base.setDate(base.getDate() + n);
    return base.getFullYear() + '-' + String(base.getMonth() + 1).padStart(2, '0')
      + '-' + String(base.getDate()).padStart(2, '0');
  }

  $('oc-status').addEventListener('change', function () {
    OC.upsert(openCcn, Object.assign({ status: $('oc-status').value }, seedFields()))
      .then(flashSaved).catch(warn);
  });
  $('oc-followup').addEventListener('change', function () {
    OC.upsert(openCcn, Object.assign({ followUpOn: $('oc-followup').value }, seedFields()))
      .then(flashSaved).catch(warn);
  });
  $('oc-followup-30').addEventListener('click', function () {
    var next = plusDays($('oc-followup').value, 30);
    $('oc-followup').value = next;
    OC.upsert(openCcn, Object.assign({ followUpOn: next }, seedFields()))
      .then(flashSaved).catch(warn);
  });
  // Emptying a native date field is fiddly enough that people give up on it, so
  // dropping the follow-up gets its own button.
  $('oc-followup-clear').addEventListener('click', function () {
    $('oc-followup').value = '';
    OC.upsert(openCcn, Object.assign({ followUpOn: '' }, seedFields()))
      .then(flashSaved).catch(warn);
  });

  /* ---- corrections ---- */
  var VERDICT_LABEL = {
    '': 'Leave as the audit found it',
    'compliant': 'File found and current',
    'failing': 'Issue observed',
    'blocked': 'Blocked to automation',
    'exempt': 'Exempt',
    'unknown': 'Still unknown',
  };
  $('oc-c-verdict').innerHTML = OC.VERDICTS.map(function (v) {
    return '<option value="' + v + '">' + VERDICT_LABEL[v] + '</option>';
  }).join('');

  // Anything that writes to the store re-renders the drawer, and refilling
  // these inputs from the saved record would wipe a half-typed correction;
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
    // The correction form is folded away by default, so its tab carries a mark
    // when there is something in it to find.
    var mark = $('oc-task-mark-correction');
    if (mark) mark.hidden = !corr;
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
      // Saved, so the normalised values are now the truth to show. Discards go
      // in their own slot: #oc-c-state says what is on record, and letting this
      // overwrite it meant a clean save blanked its own confirmation.
      renderDrawer(true);
      showDiscards('oc-c-discards');
    }).catch(warn);
  });

  $('oc-c-clear').addEventListener('click', function () {
    if (!window.confirm('Remove the manual correction and show what the crawl found?')) return;
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
    var advance = $('oc-email-advance') && $('oc-email-advance').checked;
    var discards = [];
    OC.addEntry(openCcn, Object.assign({
      kind: 'email',
      to: $('oc-to').value.trim(),
      subject: subject,
      body: $('oc-body').value,
      sentAt: $('oc-sent').value || todayStr(),
    }, seedFields())).then(function () {
      // Capture before the second write: lastDiscards() reports the most recent
      // call, and the upsert below would replace the email's report with its own.
      discards = OC.lastDiscards().slice();
      // Sending mail is also a stage change. Doing both from one button is what
      // stops the stage and the log drifting apart.
      if (!advance) return null;
      return OC.upsert(openCcn, Object.assign({
        status: 'awaiting-reply',
        followUpOn: plusDays('', 30),
      }, seedFields()));
    }).then(function () {
      $('oc-to').value = '';
      $('oc-body').value = '';
      renderDrawer();
      showDiscards('oc-email-state', null, discards);
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
      // Only the fields this kind actually holds, handing an email field to a
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
        // somewhere to land and the resulting field value remains visible. Render before
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
  var outreachListMode = 'follow';
  var outreachExpanded = false;
  var outreachSelected = null;
  function renderOutreachPreview(ccn) {
    outreachSelected = ccn;
    var rec = ccn && OC.get(ccn);
    [].forEach.call(document.querySelectorAll('.outreach-list .oc-item'), function (btn) {
      btn.setAttribute('aria-pressed', String(btn.dataset.ccn === ccn));
    });
    $('oc-preview-name').textContent = rec ? nameFor(ccn, rec) : 'No hospital selected';
    $('oc-preview-meta').innerHTML = rec
      ? '<span class="oc-pill" data-stage="' + esc(rec.status || 'none') + '">' + esc(OC_STAGE_LABEL[rec.status || 'none']) + '</span>'
        + (rec.followUpOn ? '<span class="oc-pill' + (isDue(rec) ? ' over' : '') + '">Follow up ' + esc(recordedDate(rec.followUpOn)) + '</span>' : '')
        + '<span class="oc-pill-ccn">CCN ' + esc(ccn) + '</span>'
      : '<span class="oc-pill-ccn">Choose a hospital from the list, or open one in the register.</span>';
    var last = rec && (rec.entries || [])[0];
    $('oc-preview-text').textContent = last ? (last.kind === 'email' ? 'Email · ' + (last.subject || 'No subject') : last.text || 'Note recorded') : rec && rec.correction ? 'Manual correction recorded. Open the hospital record for details.' : 'No email or note logged yet.';
    $('oc-preview-open').hidden = !rec;
    $('oc-preview-clear').hidden = !rec || !rec.followUpOn;
    $('oc-preview-clear').dataset.clear = ccn || '';
    if (window.HptMotion) window.HptMotion.enter($('oc-preview'));
  }
  function updateOutreachList() {
    var active = outreachListMode === 'follow' ? 'oc-followups' : 'oc-recent';
    $('oc-followups').hidden = active !== 'oc-followups';
    $('oc-recent').hidden = active !== 'oc-recent';
    $('oc-list-follow').setAttribute('aria-pressed', String(outreachListMode === 'follow'));
    $('oc-list-recent').setAttribute('aria-pressed', String(outreachListMode === 'recent'));
    $('oc-list-hint').textContent = outreachListMode === 'follow' ? 'Soonest first · overdue dates highlighted' : 'Most recently updated first';
    var buttons = [].slice.call($(active).querySelectorAll('.oc-item'));
    buttons.forEach(function (btn, i) { btn.hidden = !outreachExpanded && i >= 6; });
    $('oc-list-more').hidden = buttons.length <= 6;
    $('oc-list-more').setAttribute('aria-expanded', String(outreachExpanded));
    $('oc-list-more').textContent = outreachExpanded ? 'Show fewer hospitals' : 'Show all ' + buttons.length + ' hospitals';
    var current = buttons.filter(function (btn) { return !btn.hidden && btn.dataset.ccn === outreachSelected; })[0];
    renderOutreachPreview(current ? outreachSelected : buttons.length ? buttons[0].dataset.ccn : null);
  }
  ['follow', 'recent'].forEach(function (mode) {
    $('oc-list-' + mode).addEventListener('click', function () { outreachListMode = mode; outreachExpanded = false; updateOutreachList(); });
  });
  $('oc-list-more').addEventListener('click', function () { outreachExpanded = !outreachExpanded; updateOutreachList(); });
  $('oc-preview-open').addEventListener('click', function () {
    if (outreachSelected) { openDrawer(outreachSelected); setDrawerView('history'); }
  });

  function ocItem(ccn, title, meta, when, over, dismiss) {
    var item = '<button class="oc-item" type="button" data-ccn="' + esc(ccn) + '">'
      + '<b>' + esc(title) + '</b>'
      + '<span class="oc-when' + (over ? ' over' : '') + '">' + esc(recordedDate(when)) + '</span>'
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
    var corrected = T.corrections;

    $('oc-summary').innerHTML = [
      { l: 'Hospitals in the file', v: fmt.format(withActivity.length), n: 'with at least one note or email' },
      { l: 'Emails logged', v: fmt.format(emails), n: notes + ' notes alongside them' },
      { l: 'Awaiting reply', v: fmt.format(awaiting), n: 'sent, nothing back yet' },
      { l: 'Records corrected', v: fmt.format(corrected), n: 'current corrections are included in tracker summaries' },
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
            r.followUpOn, isDue(r), false);
        }).join('')
      : '<p class="oc-empty">No follow-up dates set. Open a hospital and pick one to see it here.</p>';

    // Anything touched counts, not just a logged note or email, moving the
    // stage or setting a follow-up date is activity too, and showing nothing
    // after a hospital was clearly worked on reads as broken.
    var touched = all.filter(function (r) {
      return (r.entries || []).length || r.correction || r.followUpOn || (r.status && r.status !== 'none');
    });
    var recent = touched.slice().sort(function (a, b) {
      return String(b.updatedAt).localeCompare(String(a.updatedAt));
    });
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
    updateOutreachList();

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
    if (b && b.dataset.ccn) renderOutreachPreview(b.dataset.ccn);
  });

  /* ---- storage mode + export/import ---- */
  function renderMode() {
    var mode = OC.mode;
    $('oc-mode-label').textContent = mode === 'server' ? 'this server'
      : mode === 'published' ? 'the published copy'
      : 'this browser only';
    $('oc-mode-note').textContent = mode === 'server'
      ? 'Saved to cms_data/outreach.json, shared by every browser that opens this server.'
      : mode === 'published'
      ? 'Showing the published log from cms_data/outreach.public.json. No server is reachable, so new entries remain in this browser only.'
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

  function refreshSummary() {
    calculateSummary();
    T = D.totals;
    D.tiers.forEach(function (t) { TIER_META[t.key] = t; });
    $('sf-total').textContent = fmt.format(T.hospitals);
    renderHeroAnswer();
    $('dl-size').textContent = sizeLabel();
    $('dl-states').textContent = T.states;
    $('dl-files').textContent = fmt.format(T.filesRead);
    renderDashboard();
    renderInterventionGroups();
    populateMrfStatusOptions();
    populateFindingOptions();
    populateQueueOptions();
    populateVersionOptions();
    [].forEach.call($('tier-chips').querySelectorAll('.chip[data-key]'), function (btn) {
      var n = TIER_META[btn.dataset.key].n;
      btn.querySelector('.cn').textContent = fmt.format(n);
      btn.hidden = !n && btn.getAttribute('aria-pressed') !== 'true';
    });
    applyFilters();
  }

  // Any change to the store refreshes the section, the chips and the visible rows.
  OC.onChange(function () {
    refreshSummary();
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
  var fieldFrame = null;
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
      // Manual corrections carry an ink outline so their provenance remains visible in the texture.
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
    if (fieldFrame !== null) { cancelAnimationFrame(fieldFrame); fieldFrame = null; }
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
      fieldFrame = t < 1 ? requestAnimationFrame(step) : null;
    };
    fieldFrame = requestAnimationFrame(step);
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
      + TIER_META[t.tier].label + (t.edited ? ' (manual correction)' : ''), ev);
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
  if (reduceMotion.addEventListener) reduceMotion.addEventListener('change', function () {
    if (reduceMotion.matches) runField(false);
  });

  var fieldResize;
  window.addEventListener('resize', function () {
    clearTimeout(fieldResize);
    fieldResize = setTimeout(function () { runField(false); }, 150);
  });
  // The marks are painted from CSS variables, so a theme flip needs a repaint.
  var darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
  if (darkQuery.addEventListener) darkQuery.addEventListener('change', function () {
    runField(false);
    // Same reason the toggle does it: the basemap follows the theme by hand.
    if (openCcn) renderDrawer();
  });

  applyFilters();
  renderOutreachSection();
  renderMode();
  OC.ready.then(function () {
    refreshSummary();
    if (fieldGeom.cols) drawField(fieldDrawn);
    renderMode();
    renderOutreachSection();
    layout();
  });

  var summaryDay = new Date().toISOString().slice(0, 10);
  function refreshSummaryDay() {
    var day = new Date().toISOString().slice(0, 10);
    if (day !== summaryDay) { summaryDay = day; refreshSummary(); }
  }
  document.addEventListener('visibilitychange', function () { if (!document.hidden) refreshSummaryDay(); });
  setInterval(refreshSummaryDay, 60000);

  /* ---------- theme ----------
     The choice sticks across reloads. The inline script in <head> is what
     applies it before the first paint; this only records it. */
  var toggle = $('theme-toggle');

  function currentTheme() {
    return document.documentElement.getAttribute('data-theme')
      || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  }
  // The control names what it will do, not what it is: pressing "Dark" gives
  // dark mode. "Theme" named the noun without identifying the action.
  function paintToggle() {
    var next = currentTheme() === 'dark' ? 'Light' : 'Dark';
    toggle.textContent = next;
    toggle.setAttribute('aria-label', 'Switch to ' + next.toLowerCase() + ' theme');
  }
  paintToggle();

  toggle.addEventListener('click', function () {
    var next = currentTheme() === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try { window.localStorage.setItem('cms-hpt-tracker.theme', next); } catch (e) { /* private mode */ }
    paintToggle();
    runField(false);
    // The basemap is a separate stylesheet from the page's, so it has to be
    // told; a light Positron under a black drawer is the one thing on screen
    // that would not follow.
    if (openCcn) renderDrawer();
  });
  // Following the OS while no explicit choice is stored means the label has to
  // follow it too.
  if (darkQuery.addEventListener) darkQuery.addEventListener('change', paintToggle);

  /* ---------- section bar ----------
     Same mechanism as the explainer pages' contents rail (js/docs.js): an
     observer lights the topmost visible section, chosen over scroll-position
     maths so anchor jumps stay correct. */
  var navLinks = [].slice.call(document.querySelectorAll('#secnav-links a'));
  var sections = navLinks
    .map(function (a) { return document.getElementById(a.getAttribute('href').slice(1)); })
    .filter(Boolean);

  if (sections.length && 'IntersectionObserver' in window) {
    var visible = {};
    var markCurrent = function () {
      var top = null;
      for (var i = 0; i < sections.length; i++) {
        if (visible[sections[i].id]) { top = sections[i].id; break; }
      }
      navLinks.forEach(function (a) {
        var on = a.getAttribute('href') === '#' + top;
        a.classList.toggle('on', on);
        if (on) a.setAttribute('aria-current', 'true');
        else a.removeAttribute('aria-current');
      });
    };
    var obs = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { visible[e.target.id] = e.isIntersecting; });
      markCurrent();
    }, { rootMargin: '-20% 0px -70% 0px' });
    sections.forEach(function (s) { obs.observe(s); });
  }
})();
