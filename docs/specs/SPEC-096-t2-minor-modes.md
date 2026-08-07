# Feature: T2 Minor modes — indent-tabs (functional) + 6 registered (`#153`)

## Feature Description

`#153` lists 7 T2 minor modes. **indent-tabs-mode** is fully functional here
(per-buffer tabs-vs-spaces); the other 6 ship as **registered toggles** whose
behavior is a separate subsystem effort (transparently deferred).

- **indent-tabs-mode** — FUNCTIONAL. When active, Tab inserts a literal `\t`
  (overriding the global `expand-tabs`); when inactive, Tab falls back to the
  global expand-tabs behavior (#144 spaces-or-tab). Critical for go (tabs) vs
  typescript/python (spaces). Uses the per-buffer minor-mode system
  (`minor-mode-active-p`) — no new buffer-state plumbing.
- **font-lock-mode** — REGISTERED. Per-buffer syntax highlighting needs a
  render-path change (the client's `computeHighlightSpans` is global); deferred.
- **subword-mode** — REGISTERED. Needs a subword-aware word-motion TS primitive.
- **highlight-changes-mode** — REGISTERED. Needs change-tracking since last save.
- **auto-save-mode** — REGISTERED. Needs timer hooks + recovery-file design.
- **abbrev-mode** — REGISTERED. Needs an abbrev-table subsystem.
- **flymake-mode** — REGISTERED. Needs an external-linter integration.

## User Story

As a tmax user editing go (tabs) vs typescript (spaces),
I want a per-buffer toggle that makes Tab insert tabs,
So that each buffer's indentation matches its language convention.

## Problem Statement

#144 added a GLOBAL expand-tabs toggle. Per-buffer tab style (go=tabs,
typescript=spaces in the same session) needs a per-buffer flag. The minor-mode
system is already per-buffer (`minor-mode-active-p`), so indent-tabs-mode
consults it — no new buffer-state plumbing (mirrors overwrite/electric-pair from
#149). The other 6 modes each need a distinct subsystem (render / primitive /
timers / tables / linter), out of scope here.

## Solution Statement

- **indent-tabs-mode** — `define-minor-mode` + buffer/global toggle (line-numbers
  pattern). `insert-tab` (insert-entries.tlisp) checks
  `(minor-mode-active-p "indent-tabs")` FIRST: if active → `(buffer-insert "\t")`;
  else → the existing global expand-tabs logic. Default off → insert behavior
  unchanged.
- The other 6 — `define-minor-mode` + toggle only (registered; behavior deferred).

Wire all 7 into startup via `(require-module editor/modes/…)` in `normal.tlisp`.

## Relevant Files

- `src/tlisp/core/modes/{indent-tabs,font-lock,subword,highlight-changes,auto-save,abbrev,flymake}-mode.tlisp` (NEW).
- `src/tlisp/core/commands/insert-entries.tlisp` — insert-tab consults indent-tabs.
- `src/tlisp/core/bindings/normal.tlisp` — 7 require-module lines.
- `test/unit/t2-minor-modes.test.ts` (NEW).

## Acceptance Criteria

- [ ] All 7 modes appear in `(minor-mode-list-all)`.
- [ ] indent-tabs-mode: `(indent-tabs-mode t)` then `(insert-tab)` inserts a literal `\t`; `(indent-tabs-mode nil)` restores the global expand-tabs behavior.
- [ ] Default insert-tab unchanged when indent-tabs is off (regression — core-bindings/vim-bindings-smoke green).
- [ ] The 6 registered modes: `(minor-mode-toggle NAME)` flips `(minor-mode-active-p NAME)`.
- [ ] `bun run typecheck` clean; `t2-minor-modes.test.ts` passes.

## Validation Commands

- `bun run typecheck`
- `bun test test/unit/t2-minor-modes.test.ts`
- `bun test test/unit/core-bindings.test.ts`

## Notes

- The 6 registered modes' behavior is deferred (each is a distinct subsystem).
  This mirrors the #149 T1 pattern (functional subset + registered toggles).
- indent-tabs overrides the global expand-tabs when active; it does NOT change
  expand-tabs itself (so other code reading expand-tabs is unaffected).
