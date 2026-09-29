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
    if (file === 'tracker.html') {
      assert.match(html, /categorized as file located; file contents were not verified/);
      assert.doesNotMatch(html, /categorized as observed-compliant/);
    }
  }
  const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
  assert.match(readme, /LOCAL SNAPSHOT\s+2026-09-29 04:49 UTC/);
  assert.match(readme, /local reviewed snapshot from September 29,\s*2026, 04:49 UTC/);
  assert.match(readme, /Roster represented\s+\[#+\]\s+5,419\s+100\.0%/);
  assert.match(readme, /Unresolved investigation\s+\[#+\.+\]\s+542\s+10\.0%/);
  assert.match(readme, /\| Unresolved \| 542 \| Resolve discovery, access, pointer linkage, or facility identity/);
  assert.match(readme, /\*\*1,592 hospitals\*\*/);
  assert.match(readme, /\| Standing evidence follow-ups \| 962 \|/);
  assert.doesNotMatch(readme, /\*\*1,593 hospitals\*\*|\| Standing evidence follow-ups \| 961 \|/);
  assert.doesNotMatch(readme, /regenerated on September 18, 2026|Observed-compliant \| 3,837|Observed file problem \| 215|Unresolved \| 1,201/);
});
