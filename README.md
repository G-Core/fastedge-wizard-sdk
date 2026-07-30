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

#### `context`

```ts
session.context.get(): Promise<WizardContext>
```

Returns the current wizard context — locale, theme, the wizard's own app ID, IDs of apps it manages, and enabled feature flags.

#### `session.fastedge.templates`

```ts
session.fastedge.templates.list(params?: { apiType?: 'wasi-http' | 'proxy-wasm' }): Promise<TemplateSummary[]>
session.fastedge.templates.read({ id: number }): Promise<TemplateDetail>
```

#### `session.fastedge.apps`

```ts
session.fastedge.apps.list(): Promise<AppSummary[]>          // only wizard-managed apps
session.fastedge.apps.get({ id }): Promise<AppDetail>
session.fastedge.apps.create(params): Promise<AppCreateResult>   // requires user consent
session.fastedge.apps.update(params): Promise<AppUpdateResult>   // requires user consent
session.fastedge.apps.link(params): Promise<AppLinkResult>       // requires user consent
```

#### `session.fastedge.secrets`

Secrets never cross the bridge as plaintext — only `{ id, name }` refs do.

```ts
// Opens the portal's secret picker; the user selects existing secret(s) OR creates one inline.
session.fastedge.secrets.pickOrCreate(): Promise<SecretRef[]>
session.fastedge.secrets.generateRandom(params): Promise<SecretGenerateResult>      // host-generated random value
session.fastedge.secrets.generateKeypair(params): Promise<SecretGenerateKeypairResult>  // ES256, returns publicKey
```

#### `session.deployment`

Plan-then-apply pattern. `plan` is a dry-run (no consent dialog); `apply` requires user consent and streams `deployment.progress` events.

```ts
session.deployment.plan(params): Promise<DeploymentPlan>
session.deployment.apply({ planId }): Promise<DeploymentApplyResult>
```

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

| Directory | What it shows |
|---|---|
| [`examples/plain-html/`](examples/plain-html/index.html) | Minimal framework-agnostic wizard: handshake, `context.get`, `templates.list`, isolation proof |
| [`examples/write-intents/`](examples/write-intents/index.html) | Full step-by-step smoke test of every write intent (`apps.*`, `secrets.*`, `deployment.*`) |
