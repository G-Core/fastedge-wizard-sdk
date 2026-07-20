---
name: check-api-drift
description: Fetch live Gcore FastEdge API responses, compare against SDK types.ts and schemas.ts, report any drift, and propose minimal edits to bring them in sync.
---

Detect type drift between the live Gcore FastEdge API and the SDK's TypeScript definitions, then apply minimal fixes.

## When to use

- Before running `/sync-wizard-fixtures` in `fastedge-wizard-apps` — ensures fixture payloads will pass the SDK schemas
- After a Gcore API update when fixture validation or tests start failing with unexpected schema errors
- Periodically, as a health check, to catch silent API changes before they break anything

## Repo

This skill operates in `fastedge-wizard-sdk/`. All file edits target `src/types.ts` and `src/schemas.ts` only.

---

## Intentionally excluded API fields

These fields are returned by the Gcore API but are **deliberately absent** from `types.ts`. Do not flag them as drift in future runs unless the user explicitly asks to revisit them.

| Field | Appears on | Reason excluded |
|---|---|---|
| `owned` | `TemplateSummary`, `TemplateDetail` | Per-account ownership flag — not relevant to wizard logic |
| `binary` | `AppSummary`, `AppDetail` | Internal binary/deployment ID — host resolves this; not exposed to wizards |
| `networks` | `AppSummary`, `AppDetail` | CDN network routing — infrastructure concern, not wizard-facing |
| `plan` / `plan_id` | `AppSummary`, `AppDetail` | Billing plan — not a wizard concern |
| `comment` | `AppSummary`, `AppDetail` | App-level admin note — not exposed to wizards (note: `SecretSummary.comment` IS included — different context) |
| `log` | `AppDetail` | Runtime log handle — not wizard-facing |

## Steps

### 1 — Read current types

Read `src/types.ts` and `src/schemas.ts` in full. Build a mental map of each entity and the fields + types currently declared:

| Entity | Interface | Zod schema | Source endpoint |
|---|---|---|---|
| Template list item | `TemplateSummary` | _(inline in fixtureSchemas)_ | `GET /fastedge/v1/template` → `templates[]` |
| Template detail | `TemplateDetail` + `TemplateParam` | `TemplateDetailSchema` | `GET /fastedge/v1/template/{id}` |
| App list item | `AppSummary` | _(inline)_ | `GET /fastedge/v1/apps` → `apps[]` |
| App detail | `AppDetail` | `AppDetailSchema` | `GET /fastedge/v1/apps/{id}` |
| Secret list item | `SecretSummary` | `SecretSummarySchema` | `GET /fastedge/v1/secrets` → `secrets[]` |

### 2 — Fetch live examples via the Gcore FastEdge MCP

Use `gcore_api` to fetch one concrete example of each shape. Run the list calls first in parallel; then the detail calls in parallel using IDs from the lists.

```
List calls (parallel):
  GET /fastedge/v1/template?limit=5
  GET /fastedge/v1/apps?limit=5
  GET /fastedge/v1/secrets?limit=5

Detail calls (parallel, pick first item from each list):
  GET /fastedge/v1/template/{templateId}
  GET /fastedge/v1/apps/{appId}
```

For each response, capture the **raw JSON object** (not just the field names — the actual values matter for type inference).

### 3 — Diff each entity

For each entity pair (live object ↔ current interface), produce a structured diff:

**Extra fields** — present in the live API response, absent from `types.ts`.
These are likely new fields the API started returning. They are candidates to add.

**Missing fields** — declared in `types.ts` but absent from the live response.
They may have been removed, renamed, or made conditional. **Treat as breaking — do not silently remove.** Flag them explicitly and ask the user what to do.

**Type mismatches** — field is present in both, but the value's inferred type
(from the live JSON) doesn't match the declared TypeScript type. Examples:
- Declared `number`, actual value is a string → mismatch
- Declared `string`, actual value is `null` → should be `string | null`

If a missing field in `types.ts` has a same-semantics near-match in the live response (e.g. `descr` → `description`), call it out as a possible rename rather than remove + add.

Print a clear per-entity drift report. If there is no drift across all entities, say so and stop — do not open an editor or touch any file.

### 4 — Propose and apply edits

If drift is found:

1. Show the **minimal proposed diff** to `src/types.ts` and `src/schemas.ts`:
   - New fields → add to interface and Zod schema
   - Type mismatches → correct the declared type
   - Removed fields → show as a breaking-change warning, do not include in the diff without explicit user confirmation
   - Optional vs required → use `?` for fields the API returned as absent or null in some responses; do not make mandatory fields optional without cause

2. Ask the user to confirm before writing anything.

3. After confirmation, apply the edits to `src/types.ts` and `src/schemas.ts`.

4. Run:
   ```bash
   pnpm build && pnpm test
   ```
   Report whether the build and tests pass. If they fail, show the error and stop — do not attempt further edits; let the user decide.

5. Summarise: what changed, what was flagged as a breaking warning (if anything).

---

## Constraints

- **Only edit `src/types.ts` and `src/schemas.ts`** — never touch protocol logic, SDK internals, or test files.
- Prefer adding optional `?` fields over removing required ones.
- If a field needs to be widened (e.g. `string` → `string | null`), do it; narrowing requires user confirmation.
- Keep Zod schemas in sync with TypeScript interfaces — if a field is added to the interface, add it to the corresponding schema too.
- Do not reformat or reorder unchanged code; minimal diffs only.
