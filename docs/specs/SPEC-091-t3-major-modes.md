# Feature: T3 Major modes — xml, c, cpp, java, sql (`#154`)

## Feature Description

Five T3 major modes from `docs/modes.md` are missing (❌). Registration-only,
same pattern as T1 (#150) and T2 (#152): extensions + best-effort indent hints,
full electric behavior deferred to Phase 1.5 (#149/#151).

- **xml-mode** — `.xml`, `.xsd`, `.xsl`, `.svg`, `.plist`. Tag indent.
- **c-mode** — `.c`, `.h`. Brace blocks.
- **cpp-mode** — `.cpp`, `.cc`, `.cxx`, `.hpp`, `.hh`, `.hxx`. Brace blocks.
- **java-mode** — `.java`. Brace blocks.
- **sql-mode** — `.sql`. Statements.

Unlike T1/T2, the syntax tokenizer (`src/syntax/language-registry.ts`) **does**
support `c`, `cpp` (and `h`), so c-mode and cpp-mode pass a real `syntax-language`
and get font-lock highlighting on activation. xml/java/sql have no tokenizer → `nil`.

## User Story

As a tmax user editing systems/data files,
I want `.xml`/`.c`/`.cpp`/`.java`/`.sql` files recognized, indented, and (for
C/C++) syntax-highlighted,
So that the right mode activates without manual setup.

## Problem Statement

These extensions fall back to `fundamental-mode`. `docs/modes.md` marks all five
T3 (low frequency), S/M/L complexity, blockers: Phase 1.5 (full behavior) or
none (sql). Registration is the deliverable.

## Solution Statement

Add five mode files modeled on `typescript-mode.tlisp`. c/cpp pass a real
`syntax-language` (`"c"` / `"cpp"`); xml/java/sql pass `nil`. Best-effort indent
regexes (brace-block for c/cpp/java; tag for xml; flat for sql). Wire into
startup via `(require-module editor/modes/…)` in `normal.tlisp`.

Indent rules:
- **c** / **cpp** / **java** — `'("\\{$")` / `'("^\\s*}")`.
- **xml** — `'(">$")` / `'("^\\s*</")` (best-effort tag heuristic, like html).
- **sql** — `'()` / `'()` (statements, no nested-block indent heuristic shipped).

## Relevant Files

- `src/tlisp/core/modes/xml-mode.tlisp`, `c-mode.tlisp`, `cpp-mode.tlisp`,
  `java-mode.tlisp`, `sql-mode.tlisp` (NEW).
- `src/tlisp/core/bindings/normal.tlisp` — 5 `require-module` lines.
- `test/unit/t3-major-modes.test.ts` (NEW).

## Implementation Plan

### Phase 1: mode files
- Five `*-mode.tlisp` files (`defmodule` + `major-mode-register` + `provide`); c/cpp with syntax-language, others nil.

### Phase 2: startup wiring
- 5 `(require-module editor/modes/…)` lines in `normal.tlisp`.

### Phase 3: tests
- `t3-major-modes.test.ts`: each mode in `(major-mode-list)`, `auto-mode-detect`
  per extension, `(major-mode-set)` activates without error; c/cpp activation sets
  the syntax language (highlighting on).

## Acceptance Criteria

- [ ] xml-mode registered (`.xml`/`.xsd`/`.xsl`/`.svg`/`.plist`); detect each.
- [ ] c-mode registered (`.c`/`.h`); detect; syntax-language `c`.
- [ ] cpp-mode registered (`.cpp`/`.cc`/`.cxx`/`.hpp`/`.hh`/`.hxx`); detect; syntax-language `cpp`.
- [ ] java-mode registered (`.java`); detect.
- [ ] sql-mode registered (`.sql`); detect.
- [ ] All five appear in `(major-mode-list)`.
- [ ] `(major-mode-set NAME)` activates each without error (c/cpp set syntax language; xml/java/sql nil → no `syntax-set-language` call).
- [ ] Each mode loaded at startup (required from `normal.tlisp`).
- [ ] `bun run typecheck` clean; `t3-major-modes.test.ts` passes; `core-bindings.test.ts` loads clean.

## Validation Commands

- `bun run typecheck`
- `bun test test/unit/t3-major-modes.test.ts`
- `bun test test/unit/core-bindings.test.ts`

## Notes

- c/cpp get real font-lock (tokenizers exist); xml/java/sql registration-only.
- Full electric/tag-text-object behavior is Phase 1.5 (#149/#151, ROADMAP §1.9).
