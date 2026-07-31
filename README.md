# @gcoredev/fastedge-wizard-sdk

Guest-side SDK for building **FastEdge wizard forms** that embed inside the Gcore FastEdge portal UI.

A wizard is a small web app (any framework, or plain HTML/JS) that the portal loads in a hardened iframe. The wizard never holds a Gcore API credential — instead it talks to the portal over a capability-mediated `postMessage` bridge, and the portal performs Gcore API calls on its behalf.

## Install

Published on npm (public):

```sh
npm install @gcoredev/fastedge-wizard-sdk
```

Or in `package.json`:

```json
"dependencies": {
  "@gcoredev/fastedge-wizard-sdk": "latest"
}
```

## Quickstart

```js
import { connect } from '@gcoredev/fastedge-wizard-sdk';

const session = await connect({
  // Must exactly match the origin of the Gcore portal that hosts your wizard.
  expectedHostOrigin: 'https://portal.gcore.com',
});

const ctx = await session.context.get();
console.log(ctx.theme, ctx.locale);

const templates = await session.fastedge.templates.list();
```

See [`docs/quickstart.md`](docs/quickstart.md) for a full end-to-end example and local dev setup.

## API

### `connect(options): Promise<WizardSession>`

Performs the handshake with the portal host and returns a live session.

| Option | Type | Required | Description |
|---|---|---|---|
| `expectedHostOrigin` | `string` | Yes | Exact origin of the portal (`https://…`). The SDK rejects INIT from any other origin. |
| `handshakeTimeoutMs` | `number` | No | Override the default 10 s handshake timeout. |

Throws `WizardError` with code `timeout` if the portal doesn't complete the handshake in time, or `protocol_error` on a version mismatch.

### `WizardSession`

The full, always-current surface is the **`WizardSession` interface in [`src/sdk.ts`](src/sdk.ts)** (the method tree) and the **param/result types in [`src/types.ts`](src/types.ts)**. Both are re-exported from the package, so your editor shows every signature and its doc comment the moment you `import`. Those files are the canonical contract — the map below is orientation, not an exhaustive signature list.

| Namespace | Purpose |
|---|---|
| `session.context` | Locale, theme, the wizard's own app ID, managed app IDs, feature flags |
| `session.fastedge.templates` | List / read FastEdge templates |
| `session.fastedge.apps` | List / get / create / update / link apps |
| `session.fastedge.secrets` | Pick-or-create secrets, generate ES256 keypairs |
| `session.fastedge.stores` | Pick-or-create KV stores |
| `session.cdn.resources` | List / pick CDN resources |
| `session.cdn.origins` | List / create CDN origin groups |
| `session.cdn.rules` | List / create CDN rules |
| `session.deployment` | Plan-then-apply — **prefer `deploy()`** |

Behaviours the types don't spell out:

- **Consent-gated writes** — `apps.create` / `apps.update` / `apps.link`, `cdn.origins.create`, and `cdn.rules.create` open a portal consent dialog; a user cancel throws `WizardError` with code `user_cancelled`. Pickers (`secrets.pickOrCreate`, `stores.pickOrCreate`, `cdn.resources.pick`) are consent points too.
- **Refs only, never plaintext** — secrets and KV stores cross the bridge as `{ id, name }` refs (secrets add an `origin` of `'picked'` | `'created'`); the guest never sees a secret value or enumerates the account.
- **Deployment scope** — `plan` / `deploy` create apps, CDN origins, and CDN rules, **not** secrets or stores. Create those eagerly with `secrets.pickOrCreate` / `secrets.generateKeypair` / `stores.pickOrCreate` and reference them by id. `deploy` plans, applies, streams `deployment.progress`, and tears the listener down afterwards (even if apply rejects) — prefer it over `plan` + `apply`.

#### `session.on(event, handler)`

Subscribe to host-pushed events. Returns an unsubscribe function.

```js
const off = session.on('deployment.progress', ({ step, total, describe }) => {
  console.log(`[${step}/${total}] ${describe}`);
});
// later:
off();
```

#### `session.dispose()`

Closes the `MessageChannel` port and rejects all pending intents. Call this when the wizard unmounts.

### `WizardError`

All bridge errors are thrown as `WizardError`, which extends `Error` and adds a typed `.code` field.

| Code | Meaning |
|---|---|
| `denied` | Intent not in the catalog or host refused it |
| `out_of_scope` | Resource is outside the wizard's managed scope |
| `invalid_params` | Request params failed host-side validation |
| `user_cancelled` | User dismissed a consent or picker dialog |
| `unauthorized` | Session token expired |
| `not_found` | Requested resource doesn't exist |
| `conflict` | Duplicate name or conflicting state |
| `upstream_error` | Gcore API returned an error |
| `rate_limited` | Exceeded 20 intents per 10 s |
| `timeout` | Intent or handshake took longer than allowed |
| `protocol_error` | Message version mismatch or session disposed |

```js
import { WizardError } from '@gcoredev/fastedge-wizard-sdk';

try {
  await session.fastedge.apps.create(params);
} catch (err) {
  if (err instanceof WizardError && err.code === 'user_cancelled') {
    // user clicked cancel in the portal consent dialog — not a real error
  }
}
```

## Rate limits & safety

- Max **20 intents per 10 s** sliding window (host-enforced; `rate_limited` on breach).
- Max **8 in-flight intents** at a time.
- Messages larger than **64 KB** are silently dropped by the host (the client-side timeout fires after ~90 s).
- The bridge rejects `INIT` from any origin other than `expectedHostOrigin`.

## Examples

Worked examples live in the sibling **`fastedge-wizard-apps`** repo under `wizards/`:

| Wizard | What it shows |
|---|---|
| `_example/` | Minimal framework-agnostic wizard: handshake, `context.get`, `templates.list` |
| `_example-intents/` | Step-by-step exercise of the full intent surface (`apps.*`, `secrets.*`, `stores.*`, `cdn.*`, `deployment.*`) |
| `edge-totp/` | Canonical real wizard — two apps + CDN wiring, eager secrets/stores, `deployment.deploy` |

For local dev (mock host, fixtures) see [`docs/quickstart.md`](docs/quickstart.md).
