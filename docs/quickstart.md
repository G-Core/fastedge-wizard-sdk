# Quickstart: building a FastEdge wizard

## What a wizard is

A wizard is a web app (HTML/JS, React, Vue — any framework) that the Gcore FastEdge portal loads in a sandboxed iframe. The portal acts as a broker: your wizard asks for Gcore API actions via the SDK, the portal shows a consent dialog to the user, and only then performs the action. Your wizard code **never sees a Gcore API token**.

The portal sources wizards from an allow-listed GitHub repository. Your wizard is deployed as a FastEdge WASM app on your own account; the portal frames it at `wizards/app/:feAppId` (re-entry) or `wizards/template/:templateId` (first run).

## Prerequisites

- Node.js 22+
- Your wizard app published as a FastEdge WASM HTTP app on your Gcore account
- The portal's origin (e.g. `https://portal.gcore.com`) — needed for `expectedHostOrigin`

## 1. Install the SDK

```sh
npm install github:G-Core/fastedge-wizard-sdk#<tag>
```

Or in `package.json`:

```json
"dependencies": {
  "@gcore/fastedge-wizard-sdk": "github:G-Core/fastedge-wizard-sdk#<tag>"
}
```

## 2. Connect on page load

Call `connect` as early as possible. The portal delivers the handshake on page load; if you wait too long the 10 s timeout fires.

```js
import { connect, WizardError } from '@gcore/fastedge-wizard-sdk';

async function main() {
    let session;
    try {
        session = await connect({
            expectedHostOrigin: 'https://portal.gcore.com',
        });
    } catch (err) {
        if (err instanceof WizardError) {
            console.error('Bridge handshake failed:', err.code, err.message);
        }
        return;
    }

    // Handshake complete — session is live.
    const ctx = await session.context.get();
    console.log('theme:', ctx.theme, 'locale:', ctx.locale);
}

main();
```

`connect` is framework-agnostic. In React, call it inside a `useEffect` on the root component (not on every render); dispose the session in the cleanup return.

## 3. Read data

```js
// List templates available in the account
const templates = await session.fastedge.templates.list();

// Get details (including params) for one template
const detail = await session.fastedge.templates.read({ id: templates[0].id });

// List apps this wizard already manages
const apps = await session.fastedge.apps.list();
```

## 4. Write data (with user consent)

Write intents (`apps.create`, `apps.update`, `secrets.create`, `deployment.apply`) trigger a consent dialog in the portal. The promise resolves once the user confirms and the action completes. If the user clicks Cancel, `WizardError` with code `user_cancelled` is thrown — handle this as a non-error UI state.

```js
try {
    const created = await session.fastedge.apps.create({
        name: 'my-saml-proxy',
        api_type: 'wasi-http',
        source: { fromTemplateId: detail.id },
        env: { IDP_SSO_URL: 'https://sso.example.com/saml2' },
    });
    console.log('created app id:', created.id, 'url:', created.url);
} catch (err) {
    if (err instanceof WizardError && err.code === 'user_cancelled') {
        // user cancelled the portal consent dialog
    } else {
        throw err;
    }
}
```

## 5. Multi-step deployment (plan → apply)

For wizards that need to create several linked resources atomically, use the plan/apply pattern. `plan` is a dry-run (no consent dialog); `apply` shows a single consent dialog and streams progress events.

```js
const plan = await session.deployment.plan({
    apps: [
        {
            ref: 'auth',
            name: 'my-auth-proxy',
            api_type: 'wasi-http',
            source: { fromTemplateId: 42 },
            env: { MODE: 'production' },
        },
        {
            ref: 'cdn-filter',
            name: 'my-cdn-filter',
            api_type: 'proxy-wasm',
            source: { fromTemplateId: 99 },
        },
    ],
    sharedEnv: { ACCOUNT_DOMAIN: 'example.com' },
});

// Show plan.summary and plan.steps to the user, then apply:
const off = session.on('deployment.progress', ({ step, total, describe }) => {
    console.log(`[${step}/${total}] ${describe}`);
});

const result = await session.deployment.apply({ planId: plan.planId });
off(); // unsubscribe

if (result.status === 'complete') {
    for (const app of result.created) {
        console.log(`${app.ref} → id ${app.id}, url ${app.url}`);
    }
}
```

## 6. Secrets

Secrets never cross the bridge as plaintext. The SDK only ever passes `{ id, name }` refs.

```js
// Let the user pick from existing secrets via the portal's picker UI
const [secretRef] = await session.fastedge.secrets.pick();

// Or open the portal's create-secret modal
const newRef = await session.fastedge.secrets.create({ name: 'my-api-key' });

// Pass the ref id when creating/updating an app
await session.fastedge.apps.create({
    name: 'my-app',
    api_type: 'wasi-http',
    source: { fromTemplateId: 42 },
    secretRefs: { API_KEY: secretRef.id },
});
```

## 7. Clean up

```js
// In a React component:
useEffect(() => {
    let session;
    connect({ expectedHostOrigin: 'https://portal.gcore.com' }).then((s) => {
        session = s; /* use s */
    });
    return () => session?.dispose();
}, []);
```

## Local dev setup

Working wizard implementations live in [`fastedge-wizard-apps`](https://github.com/G-Core/fastedge-wizard-apps):

- **`wizards/_template/`** — minimal starter skeleton, copy this to begin a new wizard
- **`wizards/write-intents/`** — full smoke-test wizard exercising every write intent

To run a wizard locally against the mock host:

```sh
cd wizards/write-intents
pnpm install
pnpm run dev   # builds and starts the mock host on http://localhost:9999
```

Open `http://localhost:9999/mock-host` to drive the wizard through all steps without a live portal.

## Error handling reference

All bridge errors are `WizardError` instances with a `.code` string. The codes you most commonly need to handle in UI:

| Code             | When to expect it                         | Suggested handling                        |
| ---------------- | ----------------------------------------- | ----------------------------------------- |
| `user_cancelled` | User dismissed a consent or picker dialog | No-op or restore UI state                 |
| `timeout`        | Intent took > 60 s (or handshake > 10 s)  | Show retry option                         |
| `not_found`      | Resource was deleted since last read      | Refresh list and re-prompt                |
| `conflict`       | Duplicate app/secret name                 | Ask user to choose a different name       |
| `rate_limited`   | > 20 intents in 10 s                      | Debounce requests and retry after a pause |

For the full code list see the [README](../README.md#wizarderror).
