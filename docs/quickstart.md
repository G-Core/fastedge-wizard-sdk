# Quickstart: building a FastEdge wizard

## What a wizard is

A wizard is a web app (HTML/JS, React, Vue — any framework) that the Gcore FastEdge portal loads in a sandboxed iframe. The portal acts as a broker: your wizard asks for Gcore API actions via the SDK, the portal shows a consent dialog to the user, and only then performs the action. Your wizard code **never sees a Gcore API token**.

A wizard is a static site, not a FastEdge app. Its built files live in an allow-listed GitHub
repository, and the portal serves them through a Gcore proxy (see
[runtime rules](runtime-rules.md#how-a-wizard-is-served-and-connected)). A wizard is attached to a
FastEdge **template**: the template's `WIZARD_SOURCE_CONFIG` says where the wizard lives. The
template can be an HTTP app (`wasi-http`) or a CDN app (`proxy-wasm`), and the wizard can deploy
several apps and CDN objects from it. The portal opens the wizard at `wizards/template/:templateId`
(first run) or, if the template opts in to re-entry, at `wizards/app/:appId` on an app it deployed.

## Prerequisites

- Node.js 22+
- A FastEdge template (HTTP or CDN app) for the wizard to launch from, with its `WIZARD_SOURCE_CONFIG`
  pointing at your wizard's folder in the wizard repository
- The portal's origin (e.g. `https://portal.gcore.com`) — needed for `expectedHostOrigin`

## 1. Install the SDK

```sh
npm install @gcoredev/fastedge-wizard-sdk
```

Or in `package.json`:

```json
"dependencies": {
  "@gcoredev/fastedge-wizard-sdk": "latest"
}
```

## 2. Connect on page load

Call `connect` as early as possible. The portal delivers the handshake on page load; if you wait too long the 10 s timeout fires.

```js
import { connect, WizardError } from '@gcoredev/fastedge-wizard-sdk';

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

Write intents (`apps.create`, `apps.update`, `secrets.pickOrCreate`, `secrets.generateKeypair`, `stores.pickOrCreate`, `cdn.origins.create`, `cdn.rules.create`, `deployment.apply`) trigger a consent dialog in the portal. The promise resolves once the user confirms and the action completes. If the user clicks Cancel, `WizardError` with code `user_cancelled` is thrown — handle this as a non-error UI state.

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

For pickers and generate/create flows where a cancel is just "nothing selected",
the SDK ships `optional()` so you don't repeat that try/catch at every call site:

```js
import { optional } from '@gcoredev/fastedge-wizard-sdk';

const picked = await optional(() => session.fastedge.secrets.pickOrCreate());
if (picked) set({ secret: picked }); // null when the user dismissed the dialog
```

It swallows only `user_cancelled`; any other error still throws.

## 5. Multi-step deployment (plan → apply)

For wizards that need to create several linked resources atomically, use the plan/apply pattern. `plan` is a dry-run (no consent dialog); `apply` shows a single consent dialog and streams progress events.

```js
const plan = await session.deployment.plan({
    fastedgeApps: [
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
    for (const app of result.createdFastedgeApps) {
        console.log(`${app.ref} → id ${app.id}, url ${app.url}`);
    }
}
```

## 6. Re-entry: reopen and edit a deployment

If the wizard's template opts in (`"reentry": true` in its wizard config), users can reopen the
wizard from an app it deployed and change it. Then `launchTemplateId` is `null`, and the wizard
works in three steps: **load** the form from the live deployment, let the user **edit**, **save** it
back. A field map does the load and the save:

```js
import { defineFieldMap, field } from '@gcoredev/fastedge-wizard-sdk';

// Where each form value lives, declared once. 'main' is the Ref the app was created with.
const fields = defineFieldMap({
    greeting: field.env('main', 'GREETING', { default: 'hello' }),
});

const ctx = await session.context.get();
const reentry = ctx.launchTemplateId === null;

// Template mode starts from a skeleton of what to create; re-entry from what is deployed.
const state = reentry
    ? await session.deployment.current()
    : { fastedgeApps: [{ ref: 'main', name: 'greeter', api_type: 'wasi-http', source: { fromTemplateId: ctx.launchTemplateId }, env: {} }] };

const { values, errors } = fields.load(state);   // errors: what couldn't be read, e.g. a broken value
// ...show the form with values; the user edits them...
const next = fields.save(values, state);          // only the mapped keys change

const result = await session.deployment.deploy(next); // re-entry: next carries current()'s revision
if (result.status === 'complete') {
    // done
}
```

On re-entry the plan is the complete desired state: the portal compares it with what is deployed,
shows the differences in its consent dialog, and applies only those. Env keys the user added by hand
are kept, because `save` changes only what the map owns. See
[runtime rules §Template mode and re-entry](runtime-rules.md#template-mode-and-re-entry) for
removals, locked fields, the revision check and the field kinds.

## 7. Secrets

Secrets never cross the bridge as plaintext. The SDK only ever passes `{ id, name }` refs.

```js
// Let the user pick an existing secret — or create a new one inline — via the portal's picker UI.
// The user creates within the same modal; no separate create call is needed.
const [secretRef] = await session.fastedge.secrets.pickOrCreate();

// Pass the ref id when creating/updating an app
await session.fastedge.apps.create({
    name: 'my-app',
    api_type: 'wasi-http',
    source: { fromTemplateId: 42 },
    secretRefs: { API_KEY: secretRef.id },
});
```

The same call covers Edge Storage via `session.fastedge.stores.pickOrCreate()`.

**Local dev tip:** in the mock host, choosing "➕ Create new…" prompts you for a name (pre-filled
with an indexed default). For flows that create several resources — where per-create prompts get
tedious — seed realistic names up front in `fixtures/fastedge/new-secrets.json` /
`fixtures/fastedge/new-stores.json` (an ordered list of `{ "name": "...", "comment"?: "..." }`);
the mock hands out the next one on each create, with no prompts.

## 8. Clean up

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
- **`wizards/_example-intents/`** — reference wizard exercising every v1 write intent with inline docs

To run the reference wizard locally against the mock host:

```sh
cd wizards/_example-intents
pnpm install
pnpm run dev   # builds and starts the mock host on http://localhost:9999
```

Open `http://localhost:9999` and click "Run demo" to step through all intents without a live portal.

To try re-entry locally, add `fixtures/deployment/current.json` (what `deployment.current()`
returns) and open the mock host with `?mode=reentry`. A template-mode deploy in the mock host also
becomes the live state, so you can deploy first and then reopen.

Building for a rebranded portal? Add a `wizard-brand.json` to your repo root to preview its brand
colour in every wizard; see [runtime rules §Theme](runtime-rules.md#theme-locale-and-branding).

## Error handling reference

All bridge errors are `WizardError` instances with a `.code` string. The codes you most commonly need to handle in UI:

| Code             | When to expect it                         | Suggested handling                        |
| ---------------- | ----------------------------------------- | ----------------------------------------- |
| `user_cancelled` | User dismissed a consent or picker dialog | No-op or restore UI state                 |
| `timeout`        | Intent took > 60 s (or handshake > 10 s)  | Show retry option                         |
| `not_found`      | Resource was deleted since last read      | Refresh list and re-prompt                |
| `conflict`       | Duplicate app/secret name                 | Ask user to choose a different name       |
| `conflict`       | Re-entry: the deployment changed since `current()` | Ask user to close and reopen the wizard |
| `rate_limited`   | > 20 intents in 10 s                      | Debounce requests and retry after a pause |

For the full code list see the [README](../README.md#wizarderror). For what the sandbox blocks,
what `out_of_scope` means and how rollback behaves, see [`runtime-rules.md`](runtime-rules.md).
