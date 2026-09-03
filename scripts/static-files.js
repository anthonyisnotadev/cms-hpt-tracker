'use strict';

const fs = require('fs');
const path = require('path');
const {
  DEFAULT_KEY_FILE,
  loadKey,
  deobfuscatePointerText,
  inspectPointerText
} = require('./hpt/lib/pointer-obfuscation');

const DEFAULT_ROOT = path.join(__dirname, '..');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

function sendJson(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function inside(parent, child) {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function privateFile(root, filePath, keyFile) {
  const relative = path.relative(root, filePath);
  const parts = relative.split(path.sep);
  const base = path.basename(filePath).toLowerCase();
  return !inside(root, filePath)
    || inside(path.join(root, '.git'), filePath)
    || parts.includes('node_modules')
    || base.startsWith('.env')
    || base === '.pointer-obfuscation-key'
    || path.resolve(filePath) === path.resolve(keyFile)
    || relative.toLowerCase() === path.join('cms_data', 'outreach.json').toLowerCase()
    || relative.toLowerCase() === path.join('cms_data', 'outreach.backup.json').toLowerCase()
    || relative.toLowerCase() === path.join('cms_data', 'redact-names.json').toLowerCase();
}

function serveStatic(req, res, { root = DEFAULT_ROOT, keyFile = DEFAULT_KEY_FILE } = {}) {
  let urlPath;
  try { urlPath = decodeURIComponent(req.url.split('?')[0]); }
  catch (_error) { sendJson(res, 400, { error: 'bad request' }); return; }
  const rel = urlPath === '/' ? 'tracker.html' : urlPath.replace(/^\/+/, '');
  const filePath = path.resolve(root, rel);
  if (privateFile(root, filePath, keyFile)) { sendJson(res, 403, { error: 'forbidden' }); return; }

  fs.readFile(filePath, (error, original) => {
    if (error) { sendJson(res, 404, { error: 'not found' }); return; }
    let data = original;
    const pointerDirs = [
      path.join(root, 'data', 'hpt-audit', 'pointers'),
      path.join(root, 'cms_data', 'hpt', 'pointers')
    ];
    if (pointerDirs.some(pointerDir => inside(pointerDir, filePath)) && path.extname(filePath).toLowerCase() === '.txt') {
      const text = original.toString('utf8');
      const inspection = inspectPointerText(text);
      if (inspection.protected) {
        try { data = Buffer.from(deobfuscatePointerText(text, loadKey({ keyFile })).text); }
        catch (decryptError) { sendJson(res, 500, { error: decryptError.message }); return; }
      }
    }
    const headers = {
      'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Content-Length': data.length,
      'Cache-Control': 'no-store'
    };
    res.writeHead(200, headers);
    res.end(req.method === 'HEAD' ? undefined : data);
  });
}

module.exports = { MIME, inside, privateFile, sendJson, serveStatic };
