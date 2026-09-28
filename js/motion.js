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

  window.HptMotion = { enter: function (element) { enter(element, false); } };

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
