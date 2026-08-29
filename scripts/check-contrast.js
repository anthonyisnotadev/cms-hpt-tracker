#!/usr/bin/env node
'use strict';

/*
 * Contrast gate for the palette in css/docs.css.
 *
 * The status tokens carry three variants each: a mark drawn on the page
 * ground, a tint, and a text colour that has to clear 4.5:1 on that tint.
 * Those are three different jobs against three different backdrops, and a
 * change to any ground silently invalidates all of them. This reads the
 * values out of the stylesheet itself rather than keeping a second copy,
 * so it always checks what actually ships.
 *
 *   node scripts/check-contrast.js
 *
 * Exits non-zero if any required pair fails, so it can gate a build.
 */

const fs = require('fs');
const path = require('path');

const CSS = path.join(__dirname, '..', 'css', 'docs.css');

/* ---------- colour maths (WCAG 2.x relative luminance) ---------- */

function parseHex(hex) {
  const h = hex.trim().replace(/^#/, '');
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  if (!/^[0-9a-f]{6}$/i.test(full)) throw new Error('not a hex colour: ' + hex);
  return [0, 2, 4].map(i => parseInt(full.slice(i, i + 2), 16));
}

function luminance(hex) {
  const srgb = parseHex(hex).map(v => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * srgb[0] + 0.7152 * srgb[1] + 0.0722 * srgb[2];
}

function contrast(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/* ---------- pull the token blocks out of the stylesheet ---------- */

// The light palette is the bare :root block; dark is the explicit
// [data-theme="dark"] override. The prefers-color-scheme copy carries the
// same values, so checking one of the two dark blocks covers both.
function tokensIn(css, selector) {
  const start = css.indexOf(selector);
  if (start < 0) throw new Error('no "' + selector + '" block in css/docs.css');
  const open = css.indexOf('{', start);
  const end = css.indexOf('\n}', open);
  const body = css.slice(open, end);
  const out = {};
  const re = /(--[a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{3,6})\s*;/g;
  let m;
  while ((m = re.exec(body))) out[m[1]] = m[2];
  return out;
}

const css = fs.readFileSync(CSS, 'utf8');
const themes = {
  light: tokensIn(css, ':root {'),
  dark: tokensIn(css, ':root[data-theme="dark"] {'),
};

const TIERS = ['compliant', 'failing', 'blocked', 'exempt', 'unknown'];

/* ---------- the required pairs ----------
 * 4.5 = WCAG AA for normal text.
 * 3.0 = WCAG AA for large text, UI components and graphical objects (1.4.11).
 *       A mark in the field and a focus ring are graphical, not text.
 */
function checksFor(t) {
  const rows = [
    ['body text', '--ink', '--paper', 7, 'AAA body text on the page ground'],
    ['secondary text', '--ink-2', '--paper', 4.5, 'prose and table body'],
    ['muted text', '--ink-3', '--paper', 4.5, 'captions, labels, datelines'],
    ['secondary on surface', '--ink-2', '--surface', 4.5, 'text inside cards'],
    ['muted on surface', '--ink-3', '--surface', 4.5, 'labels inside cards'],
    ['muted on band', '--ink-3', '--band', 4.5, 'labels in zebra-banded rows'],
    // Callouts and the standing notice are filled panels rather than outlined
    // boxes, so their text sits on the sunk surface instead of the page ground.
    ['body on sunk', '--ink', '--surface-sunk', 7, 'callout headings, notice bold'],
    ['secondary on sunk', '--ink-2', '--surface-sunk', 4.5, 'callout and notice body'],
    ['muted on sunk', '--ink-3', '--surface-sunk', 4.5, 'hints inside filled panels'],
    ['focus ring', '--focus', '--paper', 3, 'keyboard focus must be visible'],
    ['field hollow mark', '--field-hollow', '--paper', 3, 'the 1,626 unreached hospitals'],
  ];
  for (const tier of TIERS) {
    rows.push([
      'badge text: ' + tier,
      '--st-' + tier + '-fg',
      '--st-' + tier + '-bg',
      4.5,
      'badge label on its own tint',
    ]);
    rows.push([
      'mark on paper: ' + tier,
      '--st-' + tier,
      '--paper',
      3,
      'canvas mark and status dot',
    ]);
    rows.push([
      'mark on surface: ' + tier,
      '--st-' + tier,
      '--surface',
      3,
      'status dot inside a card or row',
    ]);
    // The register drops the badge tint, so the same -fg text has to hold up on
    // the page ground and on a zebra-banded row instead of on its own tint.
    rows.push([
      'flat badge on paper: ' + tier,
      '--st-' + tier + '-fg',
      '--paper',
      4.5,
      'register status text, unbanded row',
    ]);
    rows.push([
      'flat badge on band: ' + tier,
      '--st-' + tier + '-fg',
      '--band',
      4.5,
      'register status text, banded row',
    ]);
  }
  return rows.map(([label, fgVar, bgVar, min, why]) => {
    const fg = t[fgVar];
    const bg = t[bgVar];
    if (!fg) throw new Error('missing token ' + fgVar);
    if (!bg) throw new Error('missing token ' + bgVar);
    return { label, fgVar, bgVar, fg, bg, min, why, ratio: contrast(fg, bg) };
  });
}

let failed = 0;
let checked = 0;

for (const [name, tokens] of Object.entries(themes)) {
  const results = checksFor(tokens);
  console.log('\n' + name.toUpperCase());
  console.log('-'.repeat(74));
  for (const r of results) {
    checked++;
    const ok = r.ratio >= r.min;
    if (!ok) failed++;
    const ratio = r.ratio.toFixed(2).padStart(6);
    const mark = ok ? 'ok  ' : 'FAIL';
    console.log(
      mark + '  ' + r.label.padEnd(26) +
      ratio + ':1  (needs ' + r.min + ')  ' +
      r.fg + ' on ' + r.bg
    );
    if (!ok) console.log('        ^ ' + r.fgVar + ' on ' + r.bgVar + ', ' + r.why);
  }
}

console.log('\n' + '='.repeat(74));
if (failed) {
  console.error(failed + ' of ' + checked + ' pairs FAILED. Fix the tokens in css/docs.css.');
  process.exit(1);
}
console.log('All ' + checked + ' pairs pass, in both themes.');
