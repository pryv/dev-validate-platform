/**
 * @license
 * Copyright (C) Pryv https://pryv.com
 * This file is part of Pryv.io and released under BSD-Clause-3 License
 * Refer to LICENSE file
 */

const http = require('http');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A tiny HTTP server that records the webhook POSTs a platform sends it.
 * The platform must be able to reach the chosen host:port — for local runs the
 * platform and this receiver both live on localhost; for a remote platform,
 * expose it (e.g. backloop.dev) and pass the public URL as the webhook URL.
 */
class WebhookReceiver {
  constructor () {
    this.received = []; // [{ time, path, body }]
    this.server = http.createServer((req, res) => {
      if (req.method !== 'POST') { res.writeHead(200); return res.end('ok'); }
      let data = '';
      req.on('data', (chunk) => { data += chunk; });
      req.on('end', () => {
        let body;
        try { body = JSON.parse(data); } catch (e) { body = data; }
        this.received.push({ time: Date.now(), path: req.url, body });
        res.writeHead(200);
        res.end('ok');
      });
    });
  }

  listen (port, host = '0.0.0.0') {
    return new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(port, host, resolve);
    });
  }

  close () {
    return new Promise((resolve) => this.server.close(resolve));
  }

  /** Number of deliveries received so far — use as a baseline before an action. */
  mark () { return this.received.length; }

  /** All matched scope keys across deliveries since `mark`. */
  keysSince (mark) {
    const keys = new Set();
    for (const r of this.received.slice(mark)) {
      const msgs = r.body && r.body.messages;
      if (Array.isArray(msgs)) for (const m of msgs) keys.add(m);
    }
    return [...keys];
  }

  /** Wait until a delivery whose `messages` include `key` arrives, else null. */
  async waitForKey (key, timeoutMs = 12000, mark = 0) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (this.keysSince(mark).includes(key)) return true;
      await sleep(250);
    }
    return false;
  }

  /** Resolve true only if NO delivery arrives within the window (negative check). */
  async expectSilence (timeoutMs, mark) {
    await sleep(timeoutMs);
    return this.received.length === mark;
  }
}

module.exports = { WebhookReceiver, sleep };
