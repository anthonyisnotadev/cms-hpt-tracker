#!/usr/bin/env node
'use strict';

const http = require('http');
const { sendJson, serveStatic } = require('./static-files');

const PORT = Number(process.env.PORT || 8081);
const HOST = process.env.HOST || '127.0.0.1';

const server = http.createServer((req, res) => {
  if (req.method === 'GET' || req.method === 'HEAD') {
    serveStatic(req, res);
    return;
  }
  sendJson(res, 404, { error: 'not found' });
});

server.listen(PORT, HOST, () => {
  console.log(`http://localhost:${PORT}/tracker.html`);
  console.log('protected pointer contacts are decrypted in memory on request');
});

module.exports = { server };
