# fastedge-wizard-sdk — Context Index

## What This Is

The guest-side SDK for FastEdge wizard front-ends. Wizards call `connect()` to
perform the `MessageChannel` handshake with the portal host, then use the
returned `WizardSession` to invoke bridge intents (`fastedge.apps.*`,
`fastedge.secrets.*`, `deployment.*`, `context.get`).

Full API reference: `README.md`. Protocol spec: `fastedge-frontend/docs/wizards/05-bridge-protocol.md`.

---

## Current State

This is a **standalone git repository** (`G-Core/fastedge-wizard-sdk`), checked
out at `~/dev/gcore/fe/fastedge-frontend/fastedge-wizard-sdk/`. The
`package.json` is already correctly structured for external consumption:

- `name`: `@gcore/fastedge-wizard-sdk`
- `exports` + `types` point to `dist/`
- `files: ["dist"]`
- `prepare` script: runs `tsc` on `pnpm install` / `npm install` so `github:`
  installs get a built `dist/` automatically

**No npm publish is needed.** Consumers install via the GitHub ref:

```json
"@gcore/fastedge-wizard-sdk": "github:G-Core/fastedge-wizard-sdk#v0.1.0"
```

---

## How `fastedge-wizard-apps` Consumes This SDK

Each wizard in `G-Core/FastEdge-Wizard-apps` (and in Orange's repo) has:

```json
"dependencies": {
  "@gcore/fastedge-wizard-sdk": "github:G-Core/fastedge-wizard-sdk#<tag>"
}
```

The wizard's build step (`esbuild src/main.js --bundle --format=esm --outfile=main.js`)
bundles the SDK into a single `main.js` that is committed to the repo and served
via GitHub Pages / jsDelivr. The proxy enforces `connect-src 'none'` — no
runtime SDK fetch is possible, so bundling is mandatory.

**Orange's repo follows the exact same pattern.** They install the same SDK
package, run the same build, commit their own bundle.

---

## Versioning

Tag releases on `main` before wizard repos pin to them:

```bash
git tag v0.0.9   # increment from current v0.0.8
git push origin v0.0.9
```

Wizard repos then update their dep ref and rebuild:

```json
"@gcore/fastedge-wizard-sdk": "github:G-Core/fastedge-wizard-sdk#v0.0.9"
```

**Current published tag**: `v0.0.8` (hosted at `godronus/fastedge-wizard-sdk` during development; will move to `G-Core/` org before wider rollout).

Pin to a tag (not `#main`) in any committed `package.json` so builds are
reproducible. `#main` is fine during active development only.

---

## Local Development — SDK + Wizard Together

When iterating on the SDK and a wizard simultaneously, use pnpm's `file:`
protocol to point the wizard at your local SDK checkout instead of the GitHub
ref. From the wizard directory:

```bash
# Temporarily override the dep to the local checkout
pnpm add file:../../../../fe/fastedge-frontend/fastedge-wizard-sdk

# When done, restore the pinned github: ref
pnpm add github:G-Core/fastedge-wizard-sdk#<tag>
```

The SDK must be built (`pnpm build` in the SDK dir) before the wizard can use
it via `file:` — `dist/` is not committed to this repo.

---

## Future: npm Publish

If the `github:` install approach becomes a bottleneck (slow CI, private repo
access issues for new partners), publishing to npm is straightforward:

1. Add `NPM_TOKEN` secret to the repo
2. Add a GitHub Actions workflow: on tag push → `npm publish`
3. Consumers switch to `"@gcore/fastedge-wizard-sdk": "^0.1.0"`

The `package.json` is already publish-ready. This step is deferred until there
is a concrete reason to do it.

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
