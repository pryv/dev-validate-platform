#!/usr/bin/env node
/**
 * @license
 * Copyright (C) Pryv https://pryv.com
 * This file is part of Pryv.io and released under BSD-Clause-3 License
 * Refer to LICENSE file
 */

/**
 * CLI: validate scoped-notification webhooks against a live Pryv.io platform.
 *
 *   node bin/validate-webhooks.js \
 *     --service https://reg.pryv.me/service/info \
 *     --username alice --password ****** \
 *     [--receiver-host 127.0.0.1] [--receiver-port 7654] \
 *     [--receiver-public-url https://xxx.backloop.dev]
 *
 * Config may also come from env: SERVICE_INFO_URL, USERNAME, PASSWORD,
 * RECEIVER_HOST, RECEIVER_PORT, RECEIVER_PUBLIC_URL.
 */

const { validateWebhooks } = require('../src/validateWebhooks');

function arg (name, fallback) {
  const i = process.argv.indexOf('--' + name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

async function main () {
  const config = {
    serviceInfoUrl: arg('service', process.env.SERVICE_INFO_URL),
    username: arg('username', process.env.USERNAME),
    password: arg('password', process.env.PASSWORD),
    receiverHost: arg('receiver-host', process.env.RECEIVER_HOST || '127.0.0.1'),
    receiverPort: parseInt(arg('receiver-port', process.env.RECEIVER_PORT || '7654'), 10),
    receiverPublicUrl: arg('receiver-public-url', process.env.RECEIVER_PUBLIC_URL)
  };

  if (!config.serviceInfoUrl || !config.username || !config.password) {
    console.error('Missing required config. Provide --service, --username, --password (or SERVICE_INFO_URL/USERNAME/PASSWORD).');
    process.exit(2);
  }

  console.log('# dev-validate-platform — webhook scoped-notification validation');
  console.log('# platform: ' + config.serviceInfoUrl + '  user: ' + config.username + '\n');

  let results;
  try {
    results = await validateWebhooks(config, (m) => console.log('  · ' + m));
  } catch (err) {
    console.error('\nFATAL: ' + (err && err.message ? err.message : err));
    process.exit(1);
  }

  console.log('');
  let failed = 0;
  for (const r of results) {
    console.log((r.pass ? 'PASS ' : 'FAIL ') + r.name + (r.detail ? '   (' + r.detail + ')' : ''));
    if (!r.pass) failed++;
  }
  console.log('\n' + (results.length - failed) + '/' + results.length + ' checks passed');
  process.exit(failed === 0 ? 0 : 1);
}

main();
