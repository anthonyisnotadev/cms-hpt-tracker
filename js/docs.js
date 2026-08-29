/**
 * Shared behaviour for the explainer pages (mrf.html, rules.html, pointer.html).
 *
 * Two jobs, both optional: flip the theme, and mark which section of the page
 * the reader is in. Everything on those pages is plain HTML, so a failure here
 * costs highlighting and nothing else.
 */
(function () {
  'use strict';

  /* ---------- theme ----------
     Same contract as js/tracker.js: a data-theme flip on the root, seeded from
     the OS preference on the first click so that the first press always
     visibly changes something, and remembered under the same storage key the
     tracker uses so one choice covers every page. Re-applying it before the
     first paint is the inline script's job, not this one's — this file is
     deferred and would flash the old palette. */
  var toggle = document.getElementById('theme-toggle');
  if (toggle) {
    toggle.addEventListener('click', function () {
      var root = document.documentElement;
      var current = root.getAttribute('data-theme');
      if (!current) {
        current = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      }
      var next = current === 'dark' ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      try { window.localStorage.setItem('cms-hpt-tracker.theme', next); } catch (e) { /* private mode */ }
    });
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
