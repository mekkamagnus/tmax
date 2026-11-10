# ADR-0275: M-x membership is declared interactive only — the key-bound arm is retired

- **Status**: Accepted (verify-gate PASS on retry 1; landed pending CI green)
- **Date**: 2026-11-11
- **Issue**: [#249](https://github.com/mekkamagnus/tmax/issues/249)
- **Spec**: [SPEC-249](../specs/SPEC-249-mx-interactive-only.md)

## Context

SPEC-115 made `(interactive)` the marker for M-x command-hood but kept a
migration crutch: `isCommand = interactive OR key-bound`. At #249 time the M-x
source table had 234 entries — 116 declared interactive, **118 arriving only
via the key-bound arm**, ~27 of which were internal key plumbing
(`vim-mark-begin-set`, `visual-enter-char-mode`, `editor-handle-space`,
`macro-handle-q`, `*-impl` helpers…) leaking into M-x. Emacs parity says a
command is what declares `(interactive)`; being bound to a key is not
command-hood.

## Decision

1. **Tighten**: `isCommand = fn.interactive === true ||
   TS_COMMAND_NAMES.has(name)`. The key-bound arm is removed. `bindingsByCommand`
   survives (it feeds the `bindings` annotation field).
2. **Migrate genuine commands** — every key-bound function a user could
   meaningfully invoke by name (motions, edits, buffer/file/window/tab ops,
   help/info/man/dired operations, export, search, mode toggles): 79 defuns
   across 20 files gain `(interactive)` as the first body form (the SPEC-115
   idiom; the bulk edit is line-based and multi-line-docstring-aware).
3. **TS_COMMAND_NAMES** (15): TS builtins cannot carry a declaration form, so
   command-hood for them is a set consulted wherever `fn.interactive` is read.
   A set — not mutating registered values — because registration order varies
   (tab-ops registers ~1,600 lines after the main API loop; a marking loop
   right after the API loop silently missed tab-next/tab-prev). Includes 3
   names where a TS builtin SHADOWS a declaring defun
   (`apropos-documentation`, `split-window-below/right`): the table collects
   the visible global — the builtin — so the defun's marker never reaches
   those entries.
4. **Expose the flag**: every candidate hashmap entry carries
   `interactive` (boolean), and `command-detail-interactive-p` (T-Lisp) now
   requires it — the predicate finally lives up to its name, as defense in
   depth beside the `trt-`/`should-` exclusion.

27 internal names drop out of M-x; key dispatch is untouched (keymap
resolution never consulted `isCommand` — pinned by a test: `v`, `:`, `m` all
still work for non-command plumbing).

## Consequences

- M-x table: 234 → **207** (116 declared + 79 migrated + 12 TS-marked, with
  the 3 shadowed names counted via the set). Never empty (the filter-empty
  fallback stays); `describe-function`'s full table unchanged (~1,240).
- Future commands MUST declare `(interactive)` to appear in M-x — the
  declaration is now load-bearing, not documentation.
- A builtin shadowing a declaring defun is an invisible trap (the defun's
  marker is unreachable): the 3 known cases are in TS_COMMAND_NAMES; the
  "declared-but-not-filtered = 0" invariant test catches regressions.
- Migration cost was real but one-time; the classification (Emacs-parity
  criterion: user-meaningfully-invokable by name) is recorded in the spec.

## Verification

- `test/unit/mx-interactive-only.test.ts` (6): no plumbing in the table; 16
  spot-checked genuine commands present; every entry `interactive=true`;
  T-Lisp guard agrees with the table; full-table parity for
  describe-function; key dispatch unaffected (`v`/`:`/`m`).
- Mutation-proven: restoring the key-bound arm fails exactly the no-plumbing
  test.
- Diagnostic harness (headless editor): `declared=195 filtered=207
  declaredButNotFiltered=0`; all 15 TS names present.
- `bun run typecheck` clean; `bun run test:unit` 3,610/0 (runs 2–3; run 1
  had 1 unidentified transient failure that did not reproduce).
