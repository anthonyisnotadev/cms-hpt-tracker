/**
 * Shared behaviour for the explainer pages (mrf.html, rules.html, pointer.html).
 *
 * Three jobs, all optional: flip the theme, mark which section of the page the
 * reader is in, and show a glossary definition on hover. Everything on those
 * pages is plain HTML, so a failure here costs highlighting and a hover panel
 * and nothing else: a glossary term is a real anchor to a real definition at
 * the foot of the page whether this file runs or not.
 */
(function () {
  'use strict';

  /* ---------- theme ----------
     Same contract as js/tracker.js: a data-theme flip on the root, seeded from
     the OS preference on the first click so that the first press always
     visibly changes something, and remembered under the same storage key the
     tracker uses so one choice covers every page. Re-applying it before the
     first paint is the inline script's job, not this one's; this file is
     deferred and would flash the old palette. */
  var toggle = document.getElementById('theme-toggle');
  if (toggle) {
    var darkQuery = window.matchMedia('(prefers-color-scheme: dark)');

    function currentTheme() {
      return document.documentElement.getAttribute('data-theme')
        || (darkQuery.matches ? 'dark' : 'light');
    }
    // The control names what it will do, not what it is: pressing "Dark" gives
    // you dark. "Theme" named the noun and left you to guess the verb.
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
    });
    // Following the OS while no explicit choice is stored means the label has
    // to follow it too.
    if (darkQuery.addEventListener) darkQuery.addEventListener('change', paintToggle);
  }

  /* ---------- glossary ----------
     The definitions are already in the document, in the <dl class="glossary">
     at the foot of the page, and every inline term is an anchor to one. So
     this adds exactly one thing: reading that definition without losing your
     place. It lifts the text out of the <dd> it points at rather than holding
     a second copy, which is the whole reason the markup is shaped this way.

     Hover only, and only where hovering is a real gesture. On a touch screen
     the anchor already does the right thing: it jumps to the entry, and
     :target lights it. Faking a tooltip there would break a link that works. */
  var canHover = !window.matchMedia || window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  var terms = [].slice.call(document.querySelectorAll('.prose a.gl[href^="#g-"]'));

  if (canHover && terms.length) {
    var pop = document.createElement('div');
    pop.className = 'gl-pop';
    pop.id = 'gl-pop';
    pop.setAttribute('role', 'tooltip');
    pop.hidden = true;
    document.body.appendChild(pop);

    var open = null;
    var GAP = 8;      // between the word and the panel
    var EDGE = 12;    // between the panel and the viewport

    function hide() {
      if (!open) return;
      open.removeAttribute('aria-describedby');
      open = null;
      pop.hidden = true;
    }

    function show(a) {
      var target = document.getElementById(decodeURIComponent(a.getAttribute('href').slice(1)));
      if (!target) return;
      var dt = target.querySelector('dt');
      var dd = target.querySelector('dd');
      if (!dd) return;

      pop.innerHTML = '<b>' + (dt ? dt.innerHTML : '') + '</b>' + dd.innerHTML;
      pop.hidden = false;

      // Measure after filling, and place in document coordinates so the panel
      // stays put while the page scrolls under it.
      var r = a.getBoundingClientRect();
      var w = pop.offsetWidth;
      var h = pop.offsetHeight;
      var sx = window.pageXOffset;
      var sy = window.pageYOffset;

      var left = Math.min(Math.max(r.left, EDGE), window.innerWidth - w - EDGE);
      // Below by default; above when the word is close enough to the bottom
      // that the panel would hang off it.
      var below = r.bottom + GAP + h <= window.innerHeight - EDGE;
      var top = below ? r.bottom + GAP : r.top - GAP - h;

      pop.style.left = (left + sx) + 'px';
      pop.style.top = (top + sy) + 'px';

      a.setAttribute('aria-describedby', 'gl-pop');
      open = a;
    }

    terms.forEach(function (a) {
      a.addEventListener('mouseenter', function () { show(a); });
      a.addEventListener('mouseleave', hide);
      // Keyboard reaches these as links already; focus is the equivalent of
      // hovering one, and Escape dismisses without following it.
      a.addEventListener('focus', function () { show(a); });
      a.addEventListener('blur', hide);
    });

    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') hide(); });
    // A panel positioned against one layout is wrong in the next one.
    window.addEventListener('resize', hide);
    window.addEventListener('scroll', hide, { passive: true });
  }

  /* ---------- contents rail ---------- */
  var links = [].slice.call(document.querySelectorAll('.toc a[href^="#"]'));
  if (!links.length || !window.IntersectionObserver) return;

  var byId = {};
  var sections = [];
  links.forEach(function (a) {
    var el = document.getElementById(decodeURIComponent(a.getAttribute('href').slice(1)));
    if (!el) return;
    byId[el.id] = a;
    sections.push(el);
  });
  if (!sections.length) return;

  // Track which headings are on screen and light the topmost one. Observing
  // visibility rather than scroll position keeps this correct when the reader
  // jumps by anchor, and costs nothing while the page is idle.
  var visible = Object.create(null);

  function paint() {
    var top = null;
    for (var i = 0; i < sections.length; i++) {
      if (visible[sections[i].id]) { top = sections[i].id; break; }
    }
    links.forEach(function (a) { a.classList.remove('on'); });
    if (top && byId[top]) {
      byId[top].classList.add('on');
      byId[top].setAttribute('aria-current', 'true');
    }
    links.forEach(function (a) { if (!a.classList.contains('on')) a.removeAttribute('aria-current'); });
  }

  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) { visible[e.target.id] = e.isIntersecting; });
    paint();
  }, { rootMargin: '-10% 0px -70% 0px', threshold: 0 });

  sections.forEach(function (el) { io.observe(el); });
})();
