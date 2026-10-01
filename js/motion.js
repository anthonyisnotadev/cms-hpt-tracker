/* Shared, optional motion. Content is always visible without this script. */
(function () {
  'use strict';

  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  var active = new Set();
  var byElement = new WeakMap();

  function enter(element, heading) {
    if (!element || reduced.matches || !element.animate
        || element.contains(document.activeElement)) return;
    var previous = byElement.get(element);
    if (previous) previous.cancel();
    var style = getComputedStyle(document.documentElement);
    var duration = parseFloat(style.getPropertyValue(heading ? '--duration-entrance' : '--duration-panel'));
    var animation = element.animate([
      { opacity: .65, transform: 'translateY(' + (heading ? 8 : 4) + 'px)' },
      { opacity: 1, transform: 'translateY(0)' }
    ], { duration: duration || 220, easing: style.getPropertyValue('--ease').trim() || 'ease-out' });
    active.add(animation);
    byElement.set(element, animation);
    function release() {
      active.delete(animation);
      if (byElement.get(element) === animation) byElement.delete(element);
    }
    animation.onfinish = release;
    animation.oncancel = release;
  }

  function ease() {
    return getComputedStyle(document.documentElement).getPropertyValue('--ease').trim() || 'ease-out';
  }

  // The big number in the banner counts up once. The final text is written
  // first-hand by the caller; this only animates towards it, so a reader who
  // never sees the animation still gets the right figure.
  // The returned function redirects a count that is still running to a new
  // figure and returns true. Once the count has finished, or when there is no
  // animation at all, it returns false and the caller writes the figure itself.
  function countUp(element, value, format) {
    if (!element || reduced.matches || !window.requestAnimationFrame) return function () { return false; };
    var start = null, duration = 900, running = true;
    function frame(now) {
      if (start === null) start = now;
      var t = Math.min(1, (now - start) / duration);
      var eased = 1 - Math.pow(1 - t, 3);
      element.textContent = format(Math.round(value * eased));
      if (t < 1) requestAnimationFrame(frame);
      else { running = false; element.textContent = format(value); }
    }
    element.textContent = format(0);
    requestAnimationFrame(frame);
    return function retarget(next) {
      if (!running) return false;
      value = next;
      return true;
    };
  }

  window.HptMotion = { enter: function (element) { enter(element, false); }, countUp: countUp };

  var canMove = !reduced.matches && 'IntersectionObserver' in window && !!document.documentElement.animate;

  // Diagrams draw themselves in the first time they are mostly on screen.
  // .dg-ready hides the pieces and is only added when motion is allowed, so
  // nothing is ever left invisible for a reader who cannot see the animation.
  if (canMove) {
    var diagrams = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        diagrams.unobserve(entry.target);
        entry.target.classList.add('in');
      });
    }, { threshold: .35 });
    document.querySelectorAll('.dg').forEach(function (figure) {
      figure.classList.add('dg-ready');
      diagrams.observe(figure);
    });

    // Bars and cards on the tracker page. The containers are watched, not the
    // items: most of them are written by js/tracker.js after this file runs,
    // so the children are read when the container comes into view.
    var GROW = '.f-fill, .hist-fill, .rate-bar i';
    var groups = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        groups.unobserve(entry.target);
        var box = entry.target, curve = ease();
        if (box.matches('.ha-bar')) {
          box.animate([{ clipPath: 'inset(0 100% 0 0 round 6px)' }, { clipPath: 'inset(0 0 0 0 round 6px)' }],
            { duration: 900, easing: curve, delay: 150, fill: 'backwards' });
          return;
        }
        [].forEach.call(box.querySelectorAll(GROW), function (bar, i) {
          bar.style.transformOrigin = 'left center';
          bar.animate([{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }],
            { duration: 700, easing: curve, delay: Math.min(i, 12) * 45, fill: 'backwards' });
        });
        if (box.matches('.tiles, .queue, .method, .limits, .oc-summary, .ha-legend')) {
          [].forEach.call(box.children, function (child, i) {
            child.animate([{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'none' }],
              { duration: 480, easing: curve, delay: Math.min(i, 8) * 60, fill: 'backwards' });
          });
        }
      });
    }, { threshold: .2 });
    ['#ha-bar', '#ha-legend', '#queue-cards', '#hist', '#state-table', '.method', '.limits', '#oc-summary']
      .forEach(function (selector) {
        var box = document.querySelector(selector);
        if (box) groups.observe(box);
      });
  }

  // Once per heading, rather than animating whole sections or live data rows.
  // Anchor destinations and keyboard focus stay still for immediate orientation.
  if ('IntersectionObserver' in window) {
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        observer.unobserve(entry.target);
        var section = entry.target.closest('section');
        if (section && location.hash === '#' + section.id) return;
        enter(entry.target, true);
      });
    }, { threshold: .15 });
    document.querySelectorAll('.sec-head, .prose > section > h2').forEach(function (element) {
      observer.observe(element);
    });
  }

  // An OS preference change also stops animations already in flight.
  if (reduced.addEventListener) reduced.addEventListener('change', function () {
    if (reduced.matches) active.forEach(function (animation) { animation.cancel(); });
  });
})();
