'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { csvToObjects } = require('./lib/util');
const { retrieve } = require('./lib/recovery-transport');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const output = path.join(audit, 'reconciliation-geisinger-challenge-observations.json');
const pointerPath = path.join(root, 'cms_data/hpt/pointer-corpus/raw/geisinger.org-afdf01719ea2.txt');
const pointerUrl = 'https://geisinger.org/cms-hpt.txt';
const ccns = new Set(['390001', '390003', '390006', '390048', '390270', '391300']);
const sha = body => crypto.createHash('sha256').update(body).digest('hex');

async function main() {
  const queue = csvToObjects(fs.readFileSync(path.join(audit, 'html-pointer-target-queue.csv'), 'utf8'));
  const base = new Map(csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8'))
    .filter(row => ccns.has(row.ccn)).map(row => [row.ccn, row]));
  const selected = queue.filter(row => ccns.has(row.ccn));
  if (selected.length !== ccns.size || new Set(selected.map(row => row.ccn)).size !== ccns.size)
    throw new Error('Geisinger queue is missing an exact CCN target');
  const pointer = fs.readFileSync(pointerPath);
  const pointerText = pointer.toString('utf8');
  const livePointer = await retrieve(pointerUrl, 65536, { timeoutMs: 30000 });
  if (livePointer.status < 200 || livePointer.status >= 300 || sha(livePointer.body) !== sha(pointer))
    throw new Error('Current Geisinger root pointer differs from the retained corpus sample');
  const results = await Promise.all(selected.map(async row => {
    const original = base.get(row.ccn);
    if (!original || row.pointer_url !== pointerUrl
        || original.mrf_url !== row.pointer_mrf_url
        || !pointerText.split(/\r?\n/).some(line => /^mrf-url:\s*/.test(line) && line.trim().endsWith(row.pointer_mrf_url)))
      throw new Error(`Geisinger ${row.ccn} pointer/base linkage changed`);
    const response = await retrieve(row.pointer_mrf_url, 262144, { timeoutMs: 30000 });
    const html = response.body.toString('utf8');
    const title = html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] || '';
    if (response.status !== 200 || !/text\/html/i.test(response.headers['content-type'] || '')
        || title !== 'Radware Captcha Page' || response.body.length < 10000)
      throw new Error(`Geisinger ${row.ccn} no longer returns the observed client challenge`);
    return {
      ccn: row.ccn, hospital_name: row.hospital_name, pointer_url: pointerUrl,
      pointer_mrf_url: row.pointer_mrf_url, prior_finding: original.finding,
      prior_checked_at: original.checked_at, prior_declared_date: original.mrf_last_updated || '',
      prior_template_version: original.cms_template_version || '',
      observed_at: response.checkedAt, http_status: response.status,
      content_type: response.headers['content-type'], html_title: title,
      response_bytes: response.body.length, response_sha256: sha(response.body),
      disposition: 'automated-client-received-html-captcha-not-file-verdict',
      next_action: 'Preserve prior file evidence; retry this exact URL only after the access challenge changes or an authorized browser can inspect the file without bypassing a CAPTCHA.'
    };
  }));
  results.sort((a, b) => a.ccn.localeCompare(b.ccn));
  fs.writeFileSync(output, `${JSON.stringify({
    scope: 'six-exact-geisinger-pointer-targets', pointer_url: pointerUrl,
    pointer_checked_at: livePointer.checkedAt, pointer_http_status: livePointer.status,
    pointer_sample: path.relative(root, pointerPath).replaceAll('\\', '/'),
    pointer_sha256: sha(pointer), observations: results
  }, null, 2)}\n`);
  console.log(JSON.stringify({ observations: results.length, disposition: results[0].disposition }));
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
