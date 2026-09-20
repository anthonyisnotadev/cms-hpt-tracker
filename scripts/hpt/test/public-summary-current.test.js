'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../../..');

test('public social-preview summaries do not retain superseded nationwide counts', () => {
  for (const file of ['tracker.html', 'skill.html']) {
    const html = fs.readFileSync(path.join(root, file), 'utf8');
    assert.match(html, /Observed results for 5,419 US hospitals/);
    assert.doesNotMatch(html, /2,908 publish|1,626 have no working website/);
  }
  const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
  assert.match(readme, /regenerated on September 18, 2026/);
  assert.match(readme, /Observed-compliant \| 3,837/);
  assert.match(readme, /Observed file problem \| 215/);
  assert.match(readme, /Unresolved \| 1,201/);
});
