#!/usr/bin/env node
/* Tiny static file + outreach API server.
 *
 * Serves the repo root (so tracker.html and js/*.js load as-is) and backs
 * js/outreach.js's server contract. All record mutation and validation lives in
 * outreach-store.js, which outreach-cli.js also uses - so the same record shape
 * comes out whether the write arrived from the browser or the terminal.
 *
 * The store is re-read from disk before every mutation, so a CLI write made
 * while this server is running is picked up instead of being clobbered by a
 * stale in-memory copy.
 *
 * No dependencies: node scripts/outreach-server.js
 */
'use strict';

const http = require('http');
const store = require('./outreach-store');
const { serveStatic } = require('./static-files');

const PORT = process.env.PORT || 8080;
const HOST = process.env.HOST || '127.0.0.1';

/* Each route re-syncs from disk, mutates, then persists. */
function persisting(fn) {
  return (body) => {
    store.syncFromDisk();
    const result = fn(body);
    store.save();
    return result;
  };
}

const ROUTES = {
  '/api/outreach/upsert': persisting(store.upsert),
  '/api/outreach/entry': persisting(store.addEntry),
  '/api/outreach/correction': persisting(store.setCorrection),
  '/api/outreach/entry/outcome': persisting(store.setOutcome),
  '/api/outreach/entry/edit': persisting(store.editEntry),
  '/api/outreach/entry/delete': persisting(store.deleteEntry),
  '/api/outreach/delete': persisting(store.remove),
};

/* ---------- HTTP plumbing ---------- */

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 1e6) { reject(new store.ApiError(413, 'request body too large')); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) { resolve({}); return; }
      try { resolve(JSON.parse(raw)); }
      catch (e) { reject(new store.ApiError(400, 'invalid JSON body')); }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

const server = http.createServer((req, res) => {
  const urlPath = req.url.split('?')[0];

  if (req.method === 'GET' && urlPath === '/api/outreach') {
    store.syncFromDisk();
    sendJson(res, 200, { items: store.all() });
    return;
  }

  if (req.method === 'POST' && ROUTES[urlPath]) {
    readJsonBody(req)
      .then((body) => sendJson(res, 200, ROUTES[urlPath](body)))
      .catch((err) => sendJson(res, err.status || 500, { error: err.message }));
    return;
  }

  if (req.method === 'GET') { serveStatic(req, res); return; }

  sendJson(res, 404, { error: 'not found' });
});

store.load();
server.listen(PORT, HOST, () => {
  console.log(`http://localhost:${PORT}/tracker.html`);
  console.log(`outreach records: ${store.DATA_FILE}`);
});
