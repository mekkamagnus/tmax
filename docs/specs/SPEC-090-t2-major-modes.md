# Feature: T2 Major modes — text, conf, css, html, rust, dockerfile (`#152`)

## Feature Description

Six T2 major modes from `docs/modes.md` are missing (❌). Each ships as a
registration-only major mode (extensions + best-effort indent hints), the same
pattern as the T1 modes (#150 / SPEC-089). Full electric-indent/show-paren
behavior is Phase 1.5-dependent (tracked by #149/#151), identical to how
typescript/python/go/lisp ship today.

- **text-mode** — `.txt`. Prose parent (no indent rules).
- **conf-mode** — `.conf`, `.ini`, `.cfg`, `.properties`. `[section]`, `key=value`.
- **css-mode** — `.css`, `.scss`, `.less`. Brace-delimited blocks.
- **html-mode** — `.html`, `.htm`. Tag-aware indent (best-effort).
- **rust-mode** — `.rs`. Brace blocks (`fn`/`impl`/`match`).
- **dockerfile-mode** — `.dockerfile` + the `Dockerfile` filename (no extension)
  via an auto-mode regexp rule.

## User Story

As a tmax user editing config/web/systems files,
I want `.txt`/`.conf`/`.css`/`.html`/`.rs`/`Dockerfile` files to be recognized
and indented sensibly,
So that the right mode activates without manual setup.

## Problem Statement

These extensions/filenames currently fall back to `fundamental-mode`.
`docs/modes.md` marks all six as T2, S/M complexity, blockers: none (text/conf/
dockerfile) or Phase 1.5 (css/html/rust full behavior). Registration is the
deliverable; the infrastructure (`major-mode-register`, auto-detect-on-open,
indent engine) already exists.

The syntax tokenizer (`src/syntax/language-registry.ts`) supports only
c/clj/clojure/cpp/go/h/javascript/jsx/lisp/markdown/python/tlisp/tsx/typescript —
none of the T2 languages — so all six modes pass `nil` for `syntax-language`
(keeps `major-mode-set` error-free; same approach as #150).

`Dockerfile` has no extension, so extension rules cannot catch it;
`detectAutoMode` tests regexp rules against the full filename (`auto-mode.ts`),
so a `[Dd]ockerfile` regexp rule covers `Dockerfile` and variants.

## Solution Statement

Add six mode files under `src/tlisp/core/modes/` modeled on `typescript-mode.tlisp`,
each `(major-mode-register NAME EXTENSIONS nil INCREASE DECREASE)` with best-effort
indent regexes. `dockerfile-mode.tlisp` additionally calls
`(auto-mode-add "[Dd]ockerfile" "dockerfile" "regexp")`. Wire all six into
startup via `(require-module editor/modes/…)` in `normal.tlisp`.

Indent rules (increase = prev-line match → indent next; decrease = current-line
match → dedent):
- **text** / **conf** / **dockerfile** — `'()` / `'()` (flat grammars).
- **css** / **rust** — `'("\\{$")` / `'("^\\s*}")`.
- **html** — `'(">$")` / `'("^\\s*</")` (best-effort tag heuristic).

## Relevant Files

- `src/tlisp/core/modes/text-mode.tlisp`, `conf-mode.tlisp`, `css-mode.tlisp`,
  `html-mode.tlisp`, `rust-mode.tlisp`, `dockerfile-mode.tlisp` (NEW).
- `src/tlisp/core/bindings/normal.tlisp` — 6 `require-module` lines.
- `test/unit/t2-major-modes.test.ts` (NEW).

## Implementation Plan

### Phase 1: mode files
- Create the six `*-mode.tlisp` files (`defmodule` + `major-mode-register` + `provide`; dockerfile adds the regexp auto-rule).

### Phase 2: startup wiring
- Add 6 `(require-module editor/modes/…)` lines to `normal.tlisp`.

### Phase 3: tests
- `t2-major-modes.test.ts`: each mode in `(major-mode-list)`, `auto-mode-detect`
  for each extension (+ `Dockerfile` for dockerfile-mode), `(major-mode-set)` activates without error.

## Testing Strategy

### Unit Tests
- Registry presence, extension auto-detect, `Dockerfile` filename detect, activation.

### Edge Cases
- Multi-extension variants (`.scss`, `.htm`, `.properties`).
- `Dockerfile` (no extension) and `Dockerfile.dev`.
- Unknown extension → `fundamental`.

## Acceptance Criteria

- [ ] text-mode registered (`.txt`); `auto-mode-detect "notes.txt"` → `text`.
- [ ] conf-mode registered (`.conf`/`.ini`/`.cfg`/`.properties`); detect each.
- [ ] css-mode registered (`.css`/`.scss`/`.less`); detect each.
- [ ] html-mode registered (`.html`/`.htm`); detect each.
- [ ] rust-mode registered (`.rs`); detect.
- [ ] dockerfile-mode registered (`.dockerfile` + `Dockerfile` filename via regexp); detect both `Dockerfile` and `image.dockerfile`.
- [ ] All six appear in `(major-mode-list)`.
- [ ] `(major-mode-set NAME)` activates each without error (nil syntax-language → no `syntax-set-language` call).
- [ ] Each mode loaded at startup (required from `normal.tlisp`).
- [ ] `bun run typecheck` clean; `t2-major-modes.test.ts` passes; `core-bindings.test.ts` loads clean.

## Validation Commands

- `bun run typecheck`
- `bun test test/unit/t2-major-modes.test.ts`
- `bun test test/unit/core-bindings.test.ts`

## Notes

- No syntax highlighting for these six (no tokenizer) — consistent with
  registration-only status. css/html/rust full behavior is Phase 1.5 (#149/#151).
- Buffer-local / electric-indent behavior depends on #149.
