# Feature: trt — Test Explorer UI & Pilot Migration (RFC-001 0.5.4 + migration)

> **Backlink.** Implements the Test Explorer UI portion of
> [RFC-001](../rfcs/RFC-001-trt-framework.md) (Improvement #4) and the **pilot
> migration** of T-Lisp-behavior bun suites to `.test.tlisp`. Depends on
> [SPEC-049](SPEC-049-trt-runtime-testing.md) (core), and the migrations benefit from
> [SPEC-050](SPEC-050-trt-fixtures-suites-parametrized.md) (suites). This is the **final**
> of five specs that together implement RFC-001: SPEC-049 → SPEC-050 → SPEC-051 →
> SPEC-052 → **SPEC-053 (this)**. **RFC-001 flips to fully IMPLEMENTED when this spec
> lands.**

## Feature Description

Two outcomes:

1. **Test Explorer UI** — a buffer-based `*Test Explorer*` (hierarchical tree, per-file/
   per-suite pass counts, keybindings, jump-to-test-definition, real-time status). This is
   the in-editor face of `trt` (RFC Imp. #4). It is an **editor-only deliverable** — it
   runs inside a live daemon session, not from `bin/trt`.
2. **Pilot migration** — move the four T-Lisp-behavior bun suites (`orderless`,
   `vertico`/`marginalia`, `completion`, `completion-runtime`) from bun to `.test.tlisp`,
   proving the framework SPEC-049 built is where real T-Lisp behavior tests belong. TS
   primitives stay bun (boundary principle).

After this spec, RFC-001 is fully implemented.

## User Story

As a **tmax user/developer**
I want to **browse, run, and jump to tests from an interactive `*Test Explorer*` buffer,
and have my real T-Lisp-behavior suites running natively under `trt`**
So that **interactive test-driven editing is first-class and the boundary between
TS-primitive tests and T-Lisp-behavior tests is cleanly drawn.**

## Problem Statement

1. **No Explorer.** RFC-001 Imp. #4 specifies a buffer UI with a tree, pass counts, and
   jump-to-definition. Nothing like it exists today; running tests is CLI-only.
2. **Behavior tests in the wrong language.** Four bun suites
   (`test/unit/orderless-tlisp.test.ts`, `vertico-marginalia-tlisp.test.ts`,
   `tlisp-completion-framework.test.ts`, `tlisp-completion-runtime.test.ts`) drive
   `interpreter.execute(...)` and re-assert T-Lisp results in TypeScript. Per the boundary
   principle these are **migration candidates**: they don't import TS primitives, they
   re-assert T-Lisp behavior. They should be `.test.tlisp`.

## Solution Statement

- `explorer.tlisp` — the `*Test Explorer*` buffer: tree view of files/suites/tests with
  live pass/fail counts, keybindings (R/r/RET/TAB/f/q), jump-to-test-definition, real-time
  status from the result store. Reads the structured results SPEC-049 provides.
- Migration: port each of the four suites to a `.test.tlisp` equivalent, confirm `bin/trt`
  green and equivalent to the bun version, then **delete the bun file** with equivalence
  stated.

## RFC-001 → SPEC mapping (this spec's rows)

| RFC-001 improvement | RFC tier |
|---|---|
| 0.5.4 Test Explorer UI — Imp. #4 | SHOULD |
| Pilot migration (T-Lisp behavior → `.test.tlisp`) | — |

## Relevant Files

### New Files
- `src/tlisp/core/trt/explorer.tlisp` — `*Test Explorer*` buffer rendering + keybindings.
- `test/tlisp/orderless.test.tlisp` — migrated from `orderless-tlisp.test.ts`.
- `test/tlisp/vertico.test.tlisp` — migrated from `vertico-marginalia-tlisp.test.ts`.
- `test/tlisp/completion.test.tlisp` — migrated from `tlisp-completion-framework.test.ts`.
- `test/tlisp/completion-runtime.test.tlisp` — migrated from
  `tlisp-completion-runtime.test.ts`.
- `test/tlisp/trt-explorer.test.tlisp` — self-test for the Explorer (open, run a suite,
  jump to a failing definition).

### Existing files to change
- `src/tlisp/trt/bootstrap.ts` — load `explorer.tlisp` at startup.
- `rules/testing.md` — document the migration pattern + boundary diagnostic; fix
  `docs/ROADMAP.md:377` fully (the `test:trt` claim is already corrected by SPEC-049;
  this spec finishes the "all T-Lisp behavior migrated" promise).

### Removed (on migration completion)
- `test/unit/orderless-tlisp.test.ts`
- `test/unit/vertico-marginalia-tlisp.test.ts`
- `test/unit/tlisp-completion-framework.test.ts`
- `test/unit/tlisp-completion-runtime.test.ts`

> **Boundary check.** Confirm each of these four is a *migration candidate* before
> deleting: it must drive `interpreter.execute(...)` and assert T-Lisp results, **not**
> import a TS primitive (`TLispParser`, `tokenize`, …). If any imports a TS primitive, it
> stays bun — do not migrate it. State the check explicitly per file in the migration log.

## Implementation Plan

Two phases: the Explorer first (it's a UI over the existing result store), then the
migrations (which can use the Explorer to verify).

## Step by Step Tasks

### Test Explorer (RFC Imp. #4 / 0.5.4)
- [ ] **1.1 `explorer.tlisp`** — `*Test Explorer*` buffer: hierarchical tree
  (file → suite → test) with per-node pass counts; keybindings R (run all), r (run
  selected), RET (jump to definition), TAB (expand/collapse), f (filter by status), q
  (quit); real-time status from `trt-results`.
- [ ] **1.2 Jump-to-definition** — RET on a test opens its `.test.tlisp` at the test's
  definition (uses source-location data from the registry).
- [ ] **1.3 `test/tlisp/trt-explorer.test.tlisp`** — open the buffer, run a suite, see
  counts update, jump to a failing test definition.
- [ ] **1.4 `bootstrap.ts`** — load `explorer.tlisp`.

### Pilot migration (T-Lisp behavior → `.test.tlisp`)
- [ ] **2.1 Migrate `orderless-tlisp.test.ts` → `orderless.test.tlisp`** (confirm
  boundary: `interpreter.execute`-driven, no TS-primitive import).
- [ ] **2.2 Migrate `vertico-marginalia-tlisp.test.ts` → `vertico.test.tlisp`.**
- [ ] **2.3 Migrate `tlisp-completion-framework.test.ts` → `completion.test.tlisp`.**
- [ ] **2.4 Migrate `tlisp-completion-runtime.test.ts` → `completion-runtime.test.tlisp`.**
- [ ] **2.5 For each migrated suite:** confirm `bin/trt` green + equivalence to the bun
  version, then **delete the bun file** with equivalence stated in the migration log.
  TS-primitive suites stay bun (boundary).
- [ ] **2.6** Update `rules/testing.md` with the migration pattern + the boundary
  diagnostic; finalize `docs/ROADMAP.md`.

## Testing Strategy

- **Explorer self-test** (T-Lisp): open/run/jump in a daemon session.
- **Migration equivalence:** for each port, run the old bun version and the new `.test.tlisp`
  and confirm identical pass/fail sets before deleting the bun file.
- **Boundary audit:** each of the four sources must be verified as
  `interpreter.execute`-driven (not a TS-primitive test) before deletion.

## Acceptance Criteria

1. **Explorer.** `*Test Explorer*` renders a hierarchical tree with live pass counts,
   supports R/r/RET/TAB/f/q, and jumps to test definitions — all in `explorer.tlisp`.
2. **Pilot migration complete.** `orderless`, `vertico`, `completion`, `completion-runtime`
   run as `.test.tlisp` under `trt`, equivalent to their former bun versions; bun files
   deleted with equivalence + boundary check stated per file.
3. **Boundary respected.** No `.test.tlisp` imports or re-tests a TS primitive; the
   `tokenizer`/`parser`/`evaluator`/`stdlib`/`macros`/`tail-call`/`hashmap`/`quasiquote`
   bun suites remain untouched.
4. **RFC-001 closed.** Its Status changes to **IMPLEMENTED**, referencing SPEC-049–053.
5. **AI-observable preserved.** The Explorer reads from the same structured result store;
   no stdout-only observation introduced.
6. **No regressions:** `bun run typecheck`, `bun test` (with the four behavior suites
   removed and re-homed), `bun run test:daemon`, `bun run test:ui:renderer`, `bin/trt` all
   pass.

## Validation Commands

- `bun run typecheck` — TS clean.
- `bin/trt test/tlisp/trt-explorer.test.tlisp` — Explorer self-test green.
- `bin/trt test/tlisp/orderless.test.tlisp test/tlisp/vertico.test.tlisp test/tlisp/completion.test.tlisp test/tlisp/completion-runtime.test.tlisp` —
  four migrated suites green, equivalent to former bun versions.
- `bun test` — bun suite unchanged except the four removed files; TS-primitive suites
  (`tokenizer`/`parser`/`evaluator`/`stdlib`) still pass.
- `bun run test:daemon` — daemon boots; Explorer opens.
- `bun run test:ui:renderer` — renderer E2E unchanged.

## Notes

- **This spec closes RFC-001.** It's last on purpose: the Explorer is most useful once the
  framework it visualizes is complete, and the pilot migration proves the framework is
  ready for real behavior tests.
- **Explorer is editor-only.** It runs in a live daemon session (a buffer), not from
  `bin/trt`. CI uses `bin/trt --json`; humans use the Explorer. Both read the same result
  store.
- **Migration is the proof.** Migrating four real suites — and stating per-file
  equivalence + the boundary check — is what demonstrates the SPEC-049 rewrite is sound in
  practice, not just self-consistent.
- **Out of scope:** migrating the remaining ~49 `interpreter.execute`-driven bun suites
  (beyond the pilot four). The pilot establishes the pattern; further migrations are
  ongoing work, not a gate on RFC-001 closure.
