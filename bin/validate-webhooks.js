#!/usr/bin/env node
/**
 * @license
 * [BSD-3-Clause](https://github.com/pryv/dev-validate-platform/blob/main/LICENSE)
 */

/**
 * CLI: validate scoped-notification webhooks against a live Pryv.io platform.
 *
 *   node bin/validate-webhooks.js \
 *     --service https://reg.pryv.me/service/info \
 *     --username alice --password ****** \
 *     [--receiver-host 127.0.0.1] [--receiver-port 7654] \
 *     [--receiver-public-url https://host.example.com:7654]
 *
 * Alternatively, skip the login and pass a personal apiEndpoint with an embedded
 * token (useful when the platform's trusted-app login check rejects a bare
 * password login from Node):
 *
 *   node bin/validate-webhooks.js \
 *     --api-endpoint https://TOKEN@alice.pryv.me/ \
 *     --receiver-public-url https://host.example.com:7654
 *
 * The receiver-public-url must be reachable from the platform's servers (the
 * platform POSTs the webhook to it) — a public host/port, not a local-only name.
 *
 * Config may also come from env: SERVICE_INFO_URL, API_ENDPOINT, USERNAME,
 * PASSWORD, RECEIVER_HOST, RECEIVER_PORT, RECEIVER_PUBLIC_URL.
 */

const { validateWebhooks } = require('../src/validateWebhooks');

function arg (name, fallback) {
  const i = process.argv.indexOf('--' + name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

async function main () {
  const config = {
    serviceInfoUrl: arg('service', process.env.SERVICE_INFO_URL),
    apiEndpoint: arg('api-endpoint', process.env.API_ENDPOINT),
    username: arg('username', process.env.USERNAME),
    password: arg('password', process.env.PASSWORD),
    receiverHost: arg('receiver-host', process.env.RECEIVER_HOST || '127.0.0.1'),
    receiverPort: parseInt(arg('receiver-port', process.env.RECEIVER_PORT || '7654'), 10),
    receiverPublicUrl: arg('receiver-public-url', process.env.RECEIVER_PUBLIC_URL)
  };

  // Either an apiEndpoint (token embedded), or service + username + password.
  if (!config.apiEndpoint && (!config.serviceInfoUrl || !config.username || !config.password)) {
    console.error('Missing required config. Provide --api-endpoint, OR --service + --username + --password (or the matching env vars).');
    process.exit(2);
  }

  const platformLabel = config.apiEndpoint
    ? config.apiEndpoint.replace(/\/\/[^@]+@/, '//<token>@')
    : config.serviceInfoUrl + '  user: ' + config.username;
  console.log('# dev-validate-platform — webhook scoped-notification validation');
  console.log('# platform: ' + platformLabel + '\n');

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
