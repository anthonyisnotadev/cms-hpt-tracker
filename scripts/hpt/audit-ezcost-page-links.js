'use strict';

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const { csvToObjects } = require('./lib/util');
const { retrieve } = require('./lib/recovery-transport');

const root = path.resolve(__dirname, '../..');
const input = path.join(root, 'cms_data/hpt/pointer-corpus/cms_hpt_entries.csv');
const output = path.join(root, 'data/hpt-audit/reconciliation-ezcost-page-link-audit.json');

function normalized(url) {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    return parsed.href.replace(/\/$/, '');
  } catch { return ''; }
}

async function main() {
  const entries = csvToObjects(fs.readFileSync(input, 'utf8'))
    .filter(row => /^https?:\/\/(?:www\.)?ezcost\.info\//i.test(row.source_page_url || ''));
  const pages = [...new Map(entries.map(row => [normalized(row.source_page_url), row.source_page_url])).entries()]
    .sort(([a], [b]) => a.localeCompare(b));
  let cursor = 0;
  const pageResults = new Map();
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (cursor < pages.length) {
      const [key, url] = pages[cursor++];
      try {
        const response = await retrieve(url, 262144, { timeoutMs: 30000 });
        const $ = cheerio.load(response.body.toString('utf8'));
        const downloads = $('a[href]').map((_, anchor) => {
          try {
            const href = new URL($(anchor).attr('href'), url).href;
            return /standardcharges\.(?:csv|json)(?:[?#]|$)/i.test(href)
              ? { url: href, label: $(anchor).text().replace(/\s+/g, ' ').trim().slice(0, 160) } : null;
          } catch { return null; }
        }).get();
        pageResults.set(key, { http_status: response.status, observed_at: response.checkedAt,
          page_sha256: response.sha256, final_url: response.finalUrl || url, downloads });
      } catch (error) {
        pageResults.set(key, { http_status: 0, observed_at: new Date().toISOString(),
          error: String(error.code || error.message).slice(0, 120), downloads: [] });
      }
    }
  }));
  const records = entries.map(row => {
    const page = pageResults.get(normalized(row.source_page_url));
    const declared = row.mrf_url || '';
    const exact = page.downloads.some(item => normalized(item.url) === normalized(declared));
    return { location_name: row.location_name, matched_ccns: row.matched_ccns || '',
      pointer_url: row.pointer_url, pointer_sha256: row.pointer_sha256,
      pointer_source_page_url: row.source_page_url, pointer_mrf_url: declared,
      page_http_status: page.http_status, page_final_url: page.final_url || '',
      page_observed_at: page.observed_at, page_sha256: page.page_sha256 || '',
      page_error: page.error || '', page_downloads: page.downloads,
      relationship: page.http_status !== 200 ? 'page-not-retrieved'
        : exact ? 'pointer-url-present-on-page'
          : page.downloads.length ? 'page-download-differs-from-pointer' : 'no-standardcharges-download-observed' };
  });
  const counts = records.reduce((out, row) => ((out[row.relationship] = (out[row.relationship] || 0) + 1), out), {});
  const report = { generated_at: new Date().toISOString(), scope: 'Current pointer-corpus entries with EZCOST source-page URL; link comparison only, not facility or file validation',
    pointer_entries: records.length, unique_source_pages: pages.length, counts, records };
  fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ pointer_entries: records.length, unique_source_pages: pages.length, counts }));
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
