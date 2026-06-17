# dev-validate-platform

External validation toolkit for a **live** Pryv.io platform. Run it against a
freshly deployed platform (e.g. pryv.me or a single-instance) to validate it
end-to-end from a real client, over the network.

It is intentionally a *growing* repository: each platform feature that needs
live/external validation adds its own suite here.

## Suites

### Webhooks — scoped notifications (`bin/validate-webhooks.js`)

Validates the scoped-notification **webhook** surface against a running platform:

- registers a **scoped webhook** (`scopes: { onA: { kind: 'events', query: { streams: [A] } } }`),
- starts a local HTTP receiver,
- writes an **in-scope** event (stream A) → expects a delivery carrying the
  matched scope key `onA`,
- writes an **out-of-scope** event (stream B) → expects **silence**,
- checks the create response echoes `scopes` without the internal `prepared` form.

```bash
npm install
node bin/validate-webhooks.js \
  --service https://reg.pryv.me/service/info \
  --username alice --password '******'
```

Options (or env `SERVICE_INFO_URL` / `USERNAME` / `PASSWORD` / `RECEIVER_HOST` /
`RECEIVER_PORT` / `RECEIVER_PUBLIC_URL`):

| flag | default | meaning |
|---|---|---|
| `--service` | — | service-info URL of the platform |
| `--username` / `--password` | — | a personal account on the platform |
| `--receiver-host` | `127.0.0.1` | host the platform uses to reach the receiver |
| `--receiver-port` | `7654` | local port the receiver binds |
| `--receiver-public-url` | — | public base URL of the receiver (remote platform) |

**Reachability:** the platform must be able to POST to the receiver. For a local
platform both sides are on `localhost`. For a remote platform, expose the
receiver (e.g. [backloop.dev](https://backloop.dev)) and pass
`--receiver-public-url`.

Exit code is `0` when all checks pass, non-zero otherwise — suitable for CI /
post-deploy gating.

### lib-js client suite

The canonical client-library validation (the `pryv` lib-js test suite) is run
against a deployed platform as part of release validation. This repo depends on
`pryv` and is the home for wiring that run alongside the webhook suite.

## License

BSD-3-Clause.
