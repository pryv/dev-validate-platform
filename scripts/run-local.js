#!/usr/bin/env node
/**
 * @license
 * [BSD-3-Clause](https://github.com/pryv/dev-validate-platform/blob/main/LICENSE)
 */

/**
 * Boot a throwaway open-pryv.io single-instance from a local checkout and run
 * the validation suites against it — handy for validating a feature branch
 * before it is deployed.
 *
 *   node scripts/run-local.js --open-pryv /path/to/open-pryv.io
 *
 * Engine DB ports are read from `<open-pryv>/config/test-config.yml` (so the
 * spawned server uses the same isolated PostgreSQL / rqlite / InfluxDB instances
 * your test suite uses) — those databases must already be running.
 *
 * Options (or env OPEN_PRYV_PATH / API_PORT / RECEIVER_PORT):
 *   --open-pryv <path>     path to an open-pryv.io checkout (required)
 *   --api-port <n>         API server port (default 3201)
 *   --receiver-port <n>    webhook receiver port (default 7655)
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const { validateWebhooks } = require('../src/validateWebhooks');

function arg (name, fallback) {
  const i = process.argv.indexOf('--' + name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const OPV = arg('open-pryv', process.env.OPEN_PRYV_PATH);
const API_PORT = parseInt(arg('api-port', process.env.API_PORT || '3201'), 10);
const RECEIVER_PORT = parseInt(arg('receiver-port', process.env.RECEIVER_PORT || '7655'), 10);
const ADMIN_KEY = 'dvp-local-admin-key';

if (!OPV || !fs.existsSync(path.join(OPV, 'components/api-server/bin/server'))) {
  console.error('Provide a valid open-pryv.io checkout via --open-pryv <path> (or OPEN_PRYV_PATH).');
  process.exit(2);
}

// Pin the spawned dev server to the same isolated engine instances the
// workspace's test suite uses (read from its test-config.yml).
function engineEnvFromTestConfig () {
  const env = {};
  try {
    const cfg = fs.readFileSync(path.join(OPV, 'config/test-config.yml'), 'utf8');
    const pg = cfg.match(/postgresql:[\s\S]*?port:\s*(\d+)/);
    const rqUrl = cfg.match(/rqlite:[\s\S]*?url:\s*(\S+)/);
    const rqRaft = cfg.match(/rqlite:[\s\S]*?raftPort:\s*(\d+)/);
    const influx = cfg.match(/influxdb:[\s\S]*?port:\s*(\d+)/);
    if (pg) env.storages__engines__postgresql__port = pg[1];
    if (rqUrl) env.storages__engines__rqlite__url = rqUrl[1];
    if (rqRaft) env.storages__engines__rqlite__raftPort = rqRaft[1];
    if (influx) env.storages__engines__influxdb__port = influx[1];
  } catch (e) {
    console.log('· could not read test-config.yml engine ports — server uses canonical ports');
  }
  return env;
}

function postJson (url, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const u = new URL(url);
    const req = http.request({ hostname: u.hostname, port: u.port, path: u.pathname, method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } }, (res) => {
      let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => resolve({ status: res.statusCode, body: b }));
    });
    req.on('error', reject); req.write(data); req.end();
  });
}

function waitFor (url, ms) {
  const deadline = Date.now() + ms;
  return new Promise((resolve, reject) => {
    const tick = () => {
      const u = new URL(url);
      http.get({ hostname: u.hostname, port: u.port, path: u.pathname }, (res) => { res.resume(); resolve(); })
        .on('error', () => (Date.now() > deadline ? reject(new Error('server not ready: ' + url)) : setTimeout(tick, 500)));
    };
    tick();
  });
}

function findFirstAvailableHostingKey (tree) {
  for (const region of Object.values((tree && tree.regions) || {})) {
    for (const zone of Object.values(region.zones || {})) {
      for (const [key, h] of Object.entries(zone.hostings || {})) {
        if (h && h.available) return key;
      }
    }
  }
  return null;
}

const OVERRIDE = path.join(OPV, 'config/override-config.yml');
const overrideYml = `# throwaway dev-validate-platform local run — auto-removed
http:
  port: ${API_PORT}
dnsLess:
  isActive: true
  publicUrl: http://127.0.0.1:${API_PORT}/
auth:
  adminAccessKey: '${ADMIN_KEY}'
  filesReadTokenSecret: 'dvp-local-files-secret'
  ssoCookieSignSecret: 'dvp-local-sso-secret'
`;

(async () => {
  let server;
  try {
    fs.writeFileSync(OVERRIDE, overrideYml);
    console.log('· booting open-pryv.io api-server on :' + API_PORT + ' (isolated DBs)…');
    server = spawn(process.execPath, [path.join(OPV, 'components/api-server/bin/server')], {
      cwd: OPV,
      env: { ...process.env, ...engineEnvFromTestConfig(), NODE_ENV: 'development', PRYV_BOILER_SUFFIX: '-dvp-local' },
      stdio: ['ignore', fs.openSync('/tmp/dvp-local-api.log', 'w'), fs.openSync('/tmp/dvp-local-api-err.log', 'w')]
    });
    await waitFor('http://127.0.0.1:' + API_PORT + '/', 30000);
    console.log('· api-server up');

    const username = 'dvpuser' + Date.now().toString().slice(-6);
    const password = username + 'PASS!1';
    const serviceInfoUrl = 'http://127.0.0.1:' + API_PORT + '/reg/service/info';

    // discover a hosting + register a user (lib-js createUser mis-detects the
    // 2.0.0-pre version as legacy, so register via the direct endpoint)
    const tree = await (await fetch('http://127.0.0.1:' + API_PORT + '/reg/hostings')).json();
    const hosting = findFirstAvailableHostingKey(tree) || 'default';
    const reg = await postJson('http://127.0.0.1:' + API_PORT + '/reg/users',
      { username, password, email: username + '@example.com', hosting, appId: 'dvp-validate', language: 'en', invitationToken: 'enjoy', referer: 'dvp' });
    if (reg.status !== 200 && reg.status !== 201) throw new Error('register failed [' + reg.status + ']: ' + reg.body.slice(0, 200));
    console.log('· registered user ' + username + ' (hosting=' + hosting + ')');

    const results = await validateWebhooks(
      { serviceInfoUrl, username, password, receiverHost: '127.0.0.1', receiverPort: RECEIVER_PORT, receiverBind: '127.0.0.1' },
      (m) => console.log('  · ' + m)
    );

    console.log('');
    let failed = 0;
    for (const r of results) { console.log((r.pass ? 'PASS ' : 'FAIL ') + r.name + (r.detail ? '  (' + r.detail + ')' : '')); if (!r.pass) failed++; }
    console.log('\n' + (results.length - failed) + '/' + results.length + ' checks passed');
    process.exitCode = failed === 0 ? 0 : 1;
  } catch (e) {
    console.error('FATAL: ' + (e && e.message ? e.message : e));
    process.exitCode = 1;
  } finally {
    if (server) { try { server.kill('SIGTERM'); } catch (e) { /* */ } }
    try { fs.unlinkSync(OVERRIDE); } catch (e) { /* */ }
    setTimeout(() => process.exit(), 1500);
  }
})();
