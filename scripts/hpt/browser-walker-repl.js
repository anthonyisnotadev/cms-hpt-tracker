'use strict';
// Resumable interactive-browser walker for single-domain browser-download
// cases. Run from the control-browser REPL: import and call runWalk(n).
// State: browser-walk4.json (worklist), walk4-done.json (checkpoint),
// walk4-log.jsonl (per-step log). Downloads are captured by polling
// %USERPROFILE%/Downloads for new *.csv/json/zip files after a click.
const h = require('node:path');
const u = require('node:url');
const fs = require('node:fs');
const { parsePayload } = require('./lib/recovery-transport');
const ROOT = h.resolve(__dirname, '../..');
const DIR = ROOT + '/data/hpt-audit/.domain-discovery';
const DLDIR = process.env.USERPROFILE + '/Downloads';
const DONE = DIR + '/browser-staging/walk4-done.json';
const LOG = DIR + '/browser-staging/walk4-log.jsonl';
const done = new Set(fs.existsSync(DONE) ? JSON.parse(fs.readFileSync(DONE, 'utf8')) : []);
const log = (o) => fs.appendFileSync(LOG, JSON.stringify(o) + '\n');
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function usableFile(status, bytes) {
  if (status < 200 || status >= 300 || !bytes.length) return false;
  try {
    const parsed = await parsePayload(bytes, '', 4 * 1048576);
    return parsed.parsed.some(m => m.innerKind !== 'html' && (m.mrfHospitalName || m.mrfLocationName));
  } catch { return false; }
}
function dlSnapshot() {
  try { return fs.readdirSync(DLDIR).filter(f => /\.(csv|json|zip|txt)$/i.test(f)).map(f => ({ f, size: fs.statSync(DLDIR + '/' + f).size, m: fs.statSync(DLDIR + '/' + f).mtimeMs })); }
  catch { return []; }
}
async function waitNewDownload(before, ms = 75000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    await sleep(10000);
    const now = dlSnapshot().filter(x => !before.some(b => b.f === x.f));
    const stable = now.filter(x => { try { return fs.statSync(DLDIR + '/' + x.f).size === x.size && Date.now() - x.m > 8000; } catch { return false; } });
    if (stable.length) return stable;
  }
  return [];
}
async function runWalk(batch, browser) {
  const work = JSON.parse(fs.readFileSync(DIR + '/browser-walk4.json', 'utf8')).filter(x => !done.has(x.ccn));
  const grabText = async (tab, url, n = 150000) => await tab.playwright.evaluate(async ([u2, cap]) => {
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 15000);
    const resp = await fetch(u2, { headers: { 'Range': 'bytes=0-' + cap }, signal: ctrl.signal }); clearTimeout(t);
    const reader = resp.body.getReader();
    const chunks = []; let total = 0;
    while (true) { const { done: d, value } = await reader.read(); if (d) break; chunks.push(value); total += value.length; if (total >= cap) { await reader.cancel(); break; } }
    let bin = new Uint8Array(total), off = 0;
    for (const c of chunks) { bin.set(c, off); off += c.length; }
    let s = ''; const CH = 8192;
    for (let i = 0; i < bin.length; i += CH) s += String.fromCharCode.apply(null, bin.subarray(i, Math.min(i + CH, bin.length)));
    return { status: resp.status, total, text: s };
  }, [url, n]);
  const grabBytes = async (tab, url) => await tab.playwright.evaluate(async (u2) => {
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 20000);
    const resp = await fetch(u2, { headers: { 'Range': 'bytes=0-262143' }, signal: ctrl.signal }); clearTimeout(t);
    const reader = resp.body.getReader();
    const chunks = []; let total = 0;
    while (true) { const { done: d, value } = await reader.read(); if (d) break; chunks.push(value); total += value.length; if (total >= 262144) { await reader.cancel(); break; } }
    let bin = new Uint8Array(total), off = 0;
    for (const c of chunks) { bin.set(c, off); off += c.length; }
    let s = ''; const CH = 8192;
    for (let i = 0; i < bin.length; i += CH) s += String.fromCharCode.apply(null, bin.subarray(i, Math.min(i + CH, bin.length)));
    return { status: resp.status, finalUrl: resp.url, total, b64: btoa(s) };
  }, url);
  const results = [];
  let processed = 0;
  for (const item of work) {
    if (processed >= batch) break;
    const origin = item.domain;
    let tab = null;
    try { tab = await browser.tabs.new(); } catch (e) { await sleep(5000); try { tab = await browser.tabs.new(); } catch (e2) { log({ ccn: item.ccn, step: 'newTab', err: String(e2).slice(0, 60) }); processed++; continue; } }
    let loaded = false;
    try { await tab.goto('https://' + origin + '/'); await tab.playwright.waitForLoadState({ state: 'domcontentloaded' }); loaded = true; } catch (e) {}
    const nowAt = await tab.url();
    if (!loaded && !(nowAt || '').includes(origin)) {
      log({ ccn: item.ccn, step: 'unreachable', at: (nowAt || '').slice(0, 40) });
      processed++; try { await tab.close(); } catch (e) {} continue;
    }
    // locate the pricing page: prefer homepage links containing pricing keywords
    let pricingUrl = null;
    try {
      const links = await tab.playwright.evaluate(() => Array.from(document.querySelectorAll('a[href]')).map(a => ({ href: a.href, t: (a.textContent || '').trim() })).filter(l => /cms-hpt|transparen|standard.?charg|pricing|price/i.test(l.t + ' ' + l.href)));
      const pick = links.find(l => /cms-hpt|standardcharg/i.test(l.href)) || links.find(l => /transparen|standardcharg/i.test(l.t)) || links.find(l => /pricing|price/i.test(l.t)) || links[0];
      if (pick) pricingUrl = pick.href;
    } catch (e) {}
    // strategy 1: same-origin in-page fetch of the pricing page's file links,
    // or of the recorded mrf_url when it shares the origin
    let staged = false;
    const observations = [];
    const recordFetch = record => {
      observations.push(record);
      fs.writeFileSync(DIR + '/browser-staging/w4-' + item.ccn + '.json', JSON.stringify(observations));
    };
    const tryFetch = async (url) => {
      try {
        const r = await grabBytes(tab, url);
        recordFetch({ url, kind: 'mrf', ccns: [item.ccn], status: r.status, finalUrl: r.finalUrl, base64: r.b64, note: 'browser in-page fetch' });
        return await usableFile(r.status, Buffer.from(r.b64, 'base64'));
      } catch { return false; }
    };
    if (pricingUrl && /cms-hpt|standardcharg|\.(csv|json|zip)/i.test(pricingUrl)) staged = await tryFetch(pricingUrl);
    if (!staged && item.mrf_url) staged = await tryFetch(item.mrf_url);
    if (!staged && pricingUrl) {
      try {
        const page = await grabText(tab, pricingUrl);
        const flinks = [...new Set([...page.text.matchAll(/https?:\/\/[^\s"'<>\\]+\.(?:csv|json|zip)/gi)].map(m => m[0]))].slice(0, 3);
        for (const u of flinks) { if (await tryFetch(u)) { staged = true; break; } }
        if (!staged) log({ ccn: item.ccn, step: 'pricing-page-no-fetchable-file', page: pricingUrl.slice(0, 70), links: flinks.length });
      } catch (e) { log({ ccn: item.ccn, step: 'pricing-grab', err: String(e).slice(0, 50) }); }
    }
    // strategy 2: click-download from the live pricing page
    if (!staged && pricingUrl) {
      try {
        await tab.goto(pricingUrl); await tab.playwright.waitForLoadState({ state: 'domcontentloaded' });
        const anchors = await tab.playwright.evaluate(() => Array.from(document.querySelectorAll('a[href]')).map(a => a.href).filter(h2 => /\.(csv|json|zip|txt)(\?|$)|standardcharg/i.test(h2)).slice(0, 3));
        for (const href of anchors) {
          if (staged) break;
          const before = dlSnapshot();
          const link = tab.playwright.locator(`a[href="${href}"]`);
          if ((await link.count()) !== 1) continue;
          const dlPromise = tab.playwright.waitForEvent('download', { timeoutMs: 15000 }).catch(() => null);
          await link.click({ timeoutMs: 15000 });
          const dl = await dlPromise;
          let file = null;
          if (dl && dl.suggestedFilename) {
            const nm = await dl.suggestedFilename().catch(() => null);
            if (nm) { const p = DLDIR + '/' + nm; if (fs.existsSync(p)) file = p; }
          }
          if (!file) {
            const fresh = await waitNewDownload(before, 75000);
            if (fresh.length) file = DLDIR + '/' + fresh.sort((a, b) => b.size - a.size)[0].f;
          }
          if (file && fs.existsSync(file)) {
            const size = fs.statSync(file).size;
            const fh = fs.openSync(file, 'r'); const buf = Buffer.alloc(Math.min(262144, size));
            fs.readSync(fh, buf, 0, buf.length, 0); fs.closeSync(fh);
            recordFetch({ url: href, kind: 'mrf', ccns: [item.ccn], status: 200, base64: buf.toString('base64'), note: 'browser click-download, full size ' + size });
            staged = await usableFile(200, buf);
          }
        }
      } catch (e) { log({ ccn: item.ccn, step: 'click-download', err: String(e).slice(0, 50) }); }
    }
    if (staged) done.add(item.ccn);
    processed++;
    log({ ccn: item.ccn, step: staged ? 'STAGED' : 'no-evidence', origin, pricingUrl: (pricingUrl || '').slice(0, 60) });
    results.push(item.ccn + ' => ' + (staged ? 'STAGED' : 'none'));
    try { await tab.close(); } catch (e) {}
  }
  fs.writeFileSync(DONE, JSON.stringify([...done]));
  return { results, remaining: work.filter(item => !done.has(item.ccn)).length, totalDone: done.size };
}

module.exports = { runWalk };
