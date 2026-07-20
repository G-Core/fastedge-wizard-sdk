# AI Agent Instructions for fastedge-wizard-sdk

## Quick Start

This is the **guest-side TypeScript SDK** for FastEdge wizard front-ends. Wizards call `connect()` to perform the `MessageChannel` handshake with the portal host, then use the returned `WizardSession` to invoke bridge intents.

**Stack**: TypeScript • vitest • esbuild (consumers bundle) • Node.js (`bin/dev.mjs` mock host)

**Read `context/INDEX.md` second** — it has the full system picture, versioning, and local dev workflow.

---

## What to Read (Decision Tree)

| Task | Read |
|------|------|
| Adding/changing intent types | `src/types.ts` directly — it's the canonical source |
| Fixing Zod fixture schemas | `src/schemas.ts` |
| Protocol changes (new intent, version bump) | `src/protocol.ts` + `src/protocol-parity.spec.ts` |
| SDK handshake / session behaviour | `src/sdk.ts` + `src/sdk.spec.ts` |
| Mock host (dev server) | `bin/dev.mjs` + `mock-host/` |
| Checking live API vs types | Run `/check-api-drift` skill (`.claude/agents/`) |
| Versioning / publish | `context/INDEX.md` |

---

## Critical Anti-Patterns

❌ **Don't** add fields to `types.ts` without updating the corresponding Zod schema in `schemas.ts`
❌ **Don't** change `protocol.ts` intent names without updating `protocol-parity.spec.ts`
❌ **Don't** commit `dist/` — it is gitignored and built by consumers on install via the `prepare` script
❌ **Don't** publish to npm — consumers install via `github:` ref
❌ **Don't** use `any` — all intent param/result types must be fully typed

✅ **Do** run `pnpm build && pnpm test` after every change to `src/`
✅ **Do** keep `types.ts` and `schemas.ts` in sync — the fixture validator depends on both
✅ **Do** use `/check-api-drift` before adding new fixture data to confirm the live API shape matches types

---

## Repository Structure

```
fastedge-wizard-sdk/
├── src/
│   ├── index.ts                  # public exports
│   ├── sdk.ts                    # WizardSession + connect()
│   ├── protocol.ts               # INTENT_NAMES, message types, constants
│   ├── types.ts                  # all public param/result types (canonical)
│   ├── schemas.ts                # Zod fixture schemas (must mirror types.ts)
│   ├── errors.ts                 # WizardError
│   ├── sdk.spec.ts               # unit tests
│   └── protocol-parity.spec.ts   # host/SDK intent-name sync check
├── bin/
│   └── dev.mjs                   # mock host server — serves wizard + fixtures
├── mock-host/                    # mock host static assets (host.js, stubs.js)
├── docs/
│   └── quickstart.md
├── context/
│   └── INDEX.md                  # read this second
├── .claude/
│   └── agents/
│       └── check-api-drift.md    # skill: live API vs types.ts diff
├── package.json
└── tsconfig.json
```

---

## Common Commands

```bash
pnpm build          # tsc compile → dist/
pnpm test           # vitest run
pnpm build && pnpm test   # always run both after src/ changes

# Validate fixtures in a consuming wizard without starting the server:
node bin/dev.mjs <wizard-dist-dir> --validate-only
```

---

## Core Principles

- **Types are the contract** — `types.ts` is what wizards code against; schemas.ts is the runtime guard
- **Schemas mirror types** — every change to a public type that has a Zod schema must update the schema
- **No silent drift** — run `/check-api-drift` when the live API changes; don't guess at shapes
- **Minimal dist** — only `dist/` is published (via `files: ["dist"]`); never add runtime dependencies
