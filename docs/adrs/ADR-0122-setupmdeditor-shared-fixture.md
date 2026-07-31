# ADR-0122 — Shared `setupMdEditor` markdown-test fixture (CHORE-46 / #34)

## Status

Accepted

## Context

`setupMdEditor` — a helper that creates a started editor, requires the markdown + find-file command modules, creates a buffer, and optionally sets its filename — was duplicated byte-for-byte in two markdown test files (`test/unit/markdown-spec-039.test.ts:16-25` and `test/unit/markdown-follow-link.test.ts:15-24`). The codex review of refactor issue #34 approved the dedup as behavior-preserving, with constraints: do **not** broaden `createStartedEditor` (it has many unrelated callers), remove the now-unused `Editor` type and `createStartedEditor` imports, and add a dedicated helper beside `createStartedEditor` preserving the initialization order exactly.

## Decision

Export a single `setupMdEditor(content, filename?)` from `test/helpers/editor-fixture.ts`, placed directly beside `createStartedEditor` (not merged into it). Both markdown test files import it; their local copies and the now-unused `Editor` / `createStartedEditor` imports are removed. `createStartedEditor` is unchanged. Initialization order is preserved verbatim: require markdown → require find-file → `createBuffer` → conditional `set-buffer-filename`.

## Consequences

- Removes the duplication; one source of truth for the markdown-test fixture.
- `createStartedEditor` semantics are untouched — no blast radius to its other callers.
- Verified behavior-preserving: `bun run typecheck` clean, both markdown suites green (63/0), and the verify-gate Workflow returned **PASS** against CHORE-46's completion criteria (every criterion met, codex constraints honored).
