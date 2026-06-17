/**
 * @license
 * [BSD-3-Clause](https://github.com/pryv/dev-validate-platform/blob/main/LICENSE)
 */

const pryv = require('pryv');
const { WebhookReceiver } = require('./WebhookReceiver');

const maskToken = (apiEndpoint) => apiEndpoint.replace(/\/\/[^@]+@/, '//<token>@');

/**
 * Validate scoped-notification webhooks against a LIVE platform.
 *
 * Flow: log in (personal) → create an in-scope stream A and an out-of-scope
 * stream B → create an app access that can read both → register a scoped webhook
 * watching only A → start a local HTTP receiver → write an event to A (expect a
 * delivery carrying the matched scope key) and to B (expect silence). Cleans up
 * after itself.
 *
 * Returns an array of `{ name, pass, detail? }` check results.
 */
async function validateWebhooks (config, log = () => {}) {
  const results = [];
  const cleanups = [];
  const ts = Date.now();
  const streamA = 'dvp-a-' + ts;
  const streamB = 'dvp-b-' + ts;

  const service = new pryv.Service(config.serviceInfoUrl);
  const connection = await service.login(config.username, config.password, 'dev-validate-platform');
  log('logged in to ' + maskToken(connection.apiEndpoint));

  // in-scope + out-of-scope streams
  await connection.api([
    { method: 'streams.create', params: { id: streamA, name: 'DVP in-scope ' + ts } },
    { method: 'streams.create', params: { id: streamB, name: 'DVP out-of-scope ' + ts } }
  ]);
  cleanups.push(async () => {
    for (const id of [streamA, streamB]) {
      // streams.delete is flag-then-delete: call twice, best-effort.
      await connection.api([{ method: 'streams.delete', params: { id } }]).catch(() => {});
      await connection.api([{ method: 'streams.delete', params: { id } }]).catch(() => {});
    }
  });

  // app access able to read both streams (webhooks require an app/shared token)
  const accRes = await connection.api([{
    method: 'accesses.create',
    params: { name: 'dvp-' + ts, type: 'app', permissions: [{ streamId: streamA, level: 'read' }, { streamId: streamB, level: 'read' }] }
  }]);
  if (accRes[0].error) throw new Error('accesses.create failed: ' + JSON.stringify(accRes[0].error));
  const appToken = accRes[0].access.token;
  const appConnection = new pryv.Connection(connection.apiEndpoint.replace(/\/\/[^@]+@/, '//' + appToken + '@'));

  // local receiver
  const receiver = new WebhookReceiver();
  await receiver.listen(config.receiverPort, config.receiverBind || '0.0.0.0');
  cleanups.push(() => receiver.close());
  const hookUrl = (config.receiverPublicUrl || 'http://' + config.receiverHost + ':' + config.receiverPort) + '/hook';
  log('webhook receiver listening, callback url = ' + hookUrl);

  // scoped webhook (events kind, watching stream A only)
  const whRes = await appConnection.api([{
    method: 'webhooks.create',
    params: { url: hookUrl, minIntervalMs: 500, scopes: { onA: { kind: 'events', query: { streams: [streamA] } } } }
  }]);
  if (whRes[0].error) throw new Error('webhooks.create failed: ' + JSON.stringify(whRes[0].error));
  const webhook = whRes[0].webhook;
  cleanups.push(() => appConnection.api([{ method: 'webhooks.delete', params: { id: webhook.id } }]).catch(() => {}));
  log('scoped webhook ' + webhook.id + ' created — scopes={onA: events in ' + streamA + '}');

  results.push({
    name: 'webhook echoes scopes without the internal prepared form',
    pass: !!(webhook.scopes && webhook.scopes.onA && webhook.scopes.onA.prepared === undefined),
    detail: JSON.stringify(webhook.scopes)
  });

  // in-scope event -> expect delivery carrying matched key 'onA'
  let mark = receiver.mark();
  await connection.api([{ method: 'events.create', params: { streamIds: [streamA], type: 'note/txt', content: 'in scope' } }]);
  const gotInScope = await receiver.waitForKey('onA', config.timeoutMs || 15000, mark);
  results.push({ name: 'in-scope event delivers matched key onA', pass: gotInScope, detail: 'keys=' + JSON.stringify(receiver.keysSince(mark)) });

  // out-of-scope event -> expect silence
  mark = receiver.mark();
  await connection.api([{ method: 'events.create', params: { streamIds: [streamB], type: 'note/txt', content: 'out of scope' } }]);
  const silent = await receiver.expectSilence(config.silenceMs || 6000, mark);
  results.push({ name: 'out-of-scope event delivers nothing', pass: silent, detail: 'deliveries=' + (receiver.received.length - mark) });

  for (const fn of cleanups.reverse()) { try { await fn(); } catch (e) { /* best-effort */ } }
  return results;
}

module.exports = { validateWebhooks };
