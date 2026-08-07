# Feature: Markdown mode gaps — comma-leader dispatch + indent rules (`#157`)

## Feature Description

`#157` lists 7 markdown-mode gaps. This lands the **two highest-impact,
self-contained correctness fixes** and transparently defers the rest (filed as
follow-ups):

- **Gap 6 (comma-leader dispatch) — FIXED.** The markdown major-mode keymap binds
  `, b`/`, i`/`, h` etc. (the markdown leader), but pressing `,` executed the
  *global* `vim-repeat-find-reverse` binding (`,`) before the major-mode leader
  could form — so NONE of the `,`-prefixed markdown bindings ever dispatched.
  Root cause: `isMajorModePrefix` treated `,` as a "complete binding" because
  `lookupMajorModeBinding` fell through to the global binding. Fix: a key is a
  "complete major-mode binding" only if the major mode defines it *specifically*;
  a global/mode-only binding must not shadow a major-mode leader prefix.
- **Gap 1 (markdown indent rules) — FIXED.** `markdown-mode` registered with
  empty indent rules. Added list-item + blockquote increase heuristics (best-effort,
  like the other modes' indent regexes); with #149's electric-indent (default ON)
  these now fire on Enter.

**Deferred to follow-ups (out of scope here):**
- Gap 2 — markdown text objects (`cit`, `da`, `iH`/`aH`) — operator/text-object integration.
- Gap 3 — `read-string` interactive prompt (sync stub returns `""`) — minibuffer integration.
- Gap 4 — `markdown-export-dispatch` (no-op) — export pipeline.
- Gap 5 — `markdown-preview` in-TUI renderer (Oolong, SPEC-021) — separate subsystem.
- Gap 7 — `markdown-promote/demote-heading` line-shift bug — TS primitive (separate fix).

## User Story

As a tmax user editing markdown,
I want the `,`-prefixed markdown bindings (bold/italic/heading/…) to actually
dispatch, and list/blockquote lines to indent sensibly on Enter,
So that the markdown major mode is usable.

## Problem Statement

The entire markdown `,`-leader keymap was dead on arrival: `,` was swallowed by
the global `vim-repeat-find-reverse`. And markdown had no indent rules. Both are
self-contained fixes (keymap dispatch precedence + a mode registration).

## Solution Statement

- **Gap 6**: in `src/editor/handlers/normal-handler.ts`, `isMajorModePrefix` now
  checks whether the major mode defines `lookupKey` *specifically*
  (`m.majorMode === majorMode`) before treating it as a complete binding. A
  global/mode-only binding (`,` → repeat-find-reverse) no longer excludes the key
  from being a major-mode prefix. Effect: in markdown mode, `,` starts the leader
  (`, b` → bold); in other modes `,` is still repeat-find-reverse (no regression —
  only modes with `,`-prefixed bindings are affected).
- **Gap 1**: `src/tlisp/core/modes/markdown-mode.tlisp` `major-mode-register`
  gains increase rules for list items (`^\\s*[-*+]\\s`, `^\\s*\\d+\\.\\s`) and
  blockquotes (`>\\s*$`); decrease left empty (markdown dedent is manual).

## Relevant Files

- `src/editor/handlers/normal-handler.ts` — `isMajorModePrefix` specificity fix.
- `src/tlisp/core/modes/markdown-mode.tlisp` — indent rules.
- `test/unit/markdown-comma-leader.test.ts` (NEW).

## Implementation Plan

### Phase 1: comma-leader dispatch (gap 6)
- `isMajorModePrefix`: replace the `lookupMajorModeBinding` exclusion with a
  major-mode-*specific* binding check.

### Phase 2: markdown indent rules (gap 1)
- `markdown-mode.tlisp`: add list/blockquote increase rules to `major-mode-register`.

### Phase 3: tests
- `, b` in a markdown buffer dispatches `markdown-toggle-bold` (wraps selection/word in `**`).
- `,` in a non-markdown buffer still runs `vim-repeat-find-reverse` (regression).
- Markdown indent: a line after a list item indents on Enter.

## Acceptance Criteria

- [ ] In a markdown buffer, pressing `, b` dispatches `markdown-toggle-bold` (not `vim-repeat-find-reverse` / "Unbound key").
- [ ] In a non-markdown buffer, `,` still dispatches `vim-repeat-find-reverse` (no regression).
- [ ] `markdown-mode` is registered with non-empty list/blockquote indent-increase rules; `(auto-mode-detect "x.md")` → `markdown`.
- [ ] Existing key-bindings / vim-bindings-smoke / major-mode dispatch tests stay green (no regression in `] h`/`g h`/`z c` major-mode prefixes).
- [ ] `bun run typecheck` clean; `markdown-comma-leader.test.ts` passes.

## Validation Commands

- `bun run typecheck`
- `bun test test/unit/markdown-comma-leader.test.ts`
- `bun test test/unit/core-bindings.test.ts test/unit/vim-bindings-smoke.test.ts`

## Notes

- Gaps 2, 3, 4, 5, 7 are deferred (enhancements / separate subsystems / TS-primitive
  fixes) — tracked as follow-ups, not force-fit here. The two gaps landed are the
  correctness fixes that make the markdown major mode actually usable.
