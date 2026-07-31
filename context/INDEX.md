# fastedge-wizard-sdk — Context Index

## What This Is

The guest-side SDK for FastEdge wizard front-ends. Wizards call `connect()` to
perform the `MessageChannel` handshake with the portal host, then use the
returned `WizardSession` to invoke bridge intents (`fastedge.apps.*`,
`fastedge.secrets.*`, `deployment.*`, `context.get`).

Full API reference: `README.md`. The underlying bridge/protocol spec is Gcore-maintained internally; wizard authors code against this SDK, not the wire protocol.

---

## Current State

This is a **standalone public git repository** (`G-Core/fastedge-wizard-sdk`),
published to npm as **`@gcoredev/fastedge-wizard-sdk`** (public, with provenance):

- `name`: `@gcoredev/fastedge-wizard-sdk`
- `exports` + `types` point to `dist/`
- `files`: `["dist", "bin", "mock-host", "docs"]`
- `build` script: runs `tsc` → `dist/` (built in CI before publish)

Consumers install from npm:

```json
"@gcoredev/fastedge-wizard-sdk": "latest"
```

---

## How `fastedge-wizard-apps` Consumes This SDK

Each wizard in `G-Core/FastEdge-Wizard-apps` (and any allow-listed partner repo) has:

```json
"dependencies": {
  "@gcoredev/fastedge-wizard-sdk": "latest"
}
```

The wizard's build step (`esbuild src/main.js --bundle --format=esm --outfile=main.js`)
bundles the SDK into a single `main.js`. Source only is committed; CI builds each
wizard and publishes the output, which jsDelivr serves. The proxy enforces
`connect-src 'none'` — no runtime SDK fetch is possible, so bundling is mandatory.

Partner repos follow the exact same pattern — same SDK package, same build.

---

## Versioning

Releases publish to npm from CI on a `v*.*.*` tag push
(`.github/workflows/npm-publish.yml`):

```bash
npm version patch        # bumps package.json + creates the vX.Y.Z tag
git push --follow-tags   # tag push → workflow builds + npm publish
```

CI fails the publish if the tag doesn't match `package.json` version.

Wizard repos track `"latest"`, so a fresh `pnpm install` picks up the newest
release. Pin to `^0.0.1` (or rely on the lockfile) where reproducible builds
matter.

---

## Local Development — SDK + Wizard Together

When iterating on the SDK and a wizard simultaneously, use pnpm's `file:`
protocol to point the wizard at your local SDK checkout instead of the npm
package. From the wizard directory (adjust the path to wherever you cloned the SDK):

```bash
# Temporarily override the dep to your local checkout
pnpm add file:/path/to/fastedge-wizard-sdk

# When done, restore the npm dep
pnpm add @gcoredev/fastedge-wizard-sdk@latest
```

The SDK must be built (`pnpm build` in the SDK dir) before the wizard can use
it via `file:` — `dist/` is not committed to this repo.

---

## Publishing (npm)

Published to npm as `@gcoredev/fastedge-wizard-sdk` via
`.github/workflows/npm-publish.yml` on a `v*.*.*` tag push:

- **Auth**: npm Trusted Publishing (OIDC) — no `NPM_TOKEN` secret. The trusted
  publisher is configured on npmjs.com (repo `G-Core/fastedge-wizard-sdk`,
  workflow `npm-publish.yml`).
- **Provenance**: `npm publish --provenance --access public` (needs `id-token: write`).
- The workflow guards that the pushed tag matches `package.json` version.

---

## SDK Source Layout

```
src/
  index.ts                   # public exports
  sdk.ts                     # WizardSession implementation + connect()
  protocol.ts                # INTENT_NAMES, message types, constants
  types.ts                   # all public param/result types (canonical)
  schemas.ts                 # Zod fixture schemas — must mirror types.ts
  errors.ts                  # WizardError class
  sdk.spec.ts                # unit tests (vitest)
  protocol-parity.spec.ts    # verifies host + SDK intent names stay in sync
bin/
  dev.mjs                    # mock host dev server — serves wizard + fixtures
mock-host/
  host.js                    # bridge implementation for local dev
  stubs.js                   # default intent stubs (overridden by fixtures)
  index.html / style.css
```

---

## Developer Skills

`.claude/agents/check-api-drift.md` — compares the live Gcore API responses
against `src/types.ts` and `src/schemas.ts`, reports drift, and proposes
minimal edits. Run this before syncing wizard fixtures in `fastedge-wizard-apps`.

Intentionally excluded API fields (do not flag as drift):
`owned` on templates, `binary` / `networks` / `plan` / `plan_id` / app `comment` / `log` on apps.
`rsp_headers` on apps **is** included (added 2026-07-16).
