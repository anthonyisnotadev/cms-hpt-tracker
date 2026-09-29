'use strict';

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const { retrieve } = require('./lib/recovery-transport');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const proof = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-henry-ford-transition-proof.json'), 'utf8'));

async function main() {
  const page = await retrieve(proof.pricing_page_url, 262144, { timeoutMs: 30000 });
  const $ = cheerio.load(page.body.toString('utf8'));
  const links = $('a[href]').map((_, node) => new URL($(node).attr('href'), proof.pricing_page_url).href).get();
  if (![200, 206].includes(page.status) || proof.records.some(row => !links.includes(row.mrf_url)))
    throw new Error(`Henry Ford pricing page recheck failed: ${JSON.stringify({ status: page.status, missingLinks: proof.records.filter(row => !links.includes(row.mrf_url)).map(row => row.ccn) })}`);
  const relative = `cms_data/hpt/nationwide-verification/page-byte-proof/${page.sha256}.html`;
  const target = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  if (fs.existsSync(target) && !fs.readFileSync(target).equals(page.body))
    throw new Error('Existing content-addressed page sample differs');
  fs.writeFileSync(target, page.body);
  const recheck = { source_proof: 'reconciliation-henry-ford-transition-proof.json',
    page_url: proof.pricing_page_url, reviewed_page_sha256: proof.pricing_page_sha256,
    recheck_observed_at: page.checkedAt, recheck_http_status: page.status,
    recheck_sha256: page.sha256, recheck_sample: relative, recheck_bytes: page.body.length,
    exact_file_links_present_for_ccns: proof.records.map(row => row.ccn),
    note: 'The page bytes changed between the original review and this bounded recheck, but all three exact CSV links remain present. Preserve both hashes as separate page versions; do not infer a file change from the HTML hash.' };
  fs.writeFileSync(path.join(audit, 'reconciliation-henry-ford-price-page-recheck.json'),
    JSON.stringify(recheck, null, 2) + '\n');
  console.log(JSON.stringify({ sample: relative, reviewed_sha256: proof.pricing_page_sha256,
    recheck_sha256: page.sha256, bytes: page.body.length }));
}

if (require.main === module) main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
