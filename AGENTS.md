---
doc_type: policy
audience: bot
lang: en
tags: ["ai-agents", "rules", "critical"]
last_modified: 2026-07-16T00:00:00Z
---

# Rules for AI Agents

TL;DR: Keep output short. Do only what is asked. Never change code that wasn't asked about.

## Communication Style

- Use English by default; match the user's language if they write in another
- Informal tone — avoid corporate language
- Question ideas and suggest alternatives; do not just agree
- Think independently rather than being agreeable

## Invariants

- NEVER change code that was not part of the assigned task
- NEVER "improve", "clean up", or "refactor" without an explicit request
- NEVER make architecture decisions unilaterally — discuss first
- NEVER add fields to `types.ts` without updating `schemas.ts` to match
- NEVER commit `dist/` — it is gitignored and rebuilt by consumers on install
- ALWAYS run `pnpm build && pnpm test` after any change to `src/`
- ALWAYS keep command output short — every extra line wastes tokens
- ALWAYS tell apart observation from action request:
  observation ("this looks odd") → discuss, do not fix
  request ("fix this") → act

## Repo Context

See `CLAUDE.md` for the source layout and decision tree.
See `context/INDEX.md` for system architecture, versioning, and local dev workflow.

## Parallelism

`src/` files are mostly independent — `types.ts`, `schemas.ts`, `sdk.ts`, and
`protocol.ts` can each be edited by a separate agent safely as long as tasks do
not overlap on the same file. Always verify with `pnpm build && pnpm test` in a
single coordinating step after parallel edits complete.
