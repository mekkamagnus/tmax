# ADR 0001: SPEC-035 Daily Drivers and Deno Removal

**Date**: 2026-06-02
**Status**: Accepted

## Context

The tmax editor (v0.2.0) had six categories of editor functionality that Emacs users consider essential for daily use, but were missing from tmax:

1. **Syntax highlighting** — no tokenization or colorization of source code
2. **Incremental search** — no isearch (Emacs-style character-by-character search with live matching)
3. **Query replace** — no interactive find-and-replace
4. **Auto-indentation** — no language-aware indent calculation
5. **Dired** — no built-in directory editor / file manager
6. **Major modes** — no file-type-specific behavior switching

Additionally, the codebase still contained Deno remnants from a prior migration to Bun — `Deno.exit()`, `Deno.remove()`, `Deno.stdin.isTerminal`, "Deno-ink" comments in the frontend layer, and stale conversion documentation.

The design principle guiding this work follows the Emacs model: TypeScript exposes only fine-grained I/O primitives (e.g., `write-file-content`, `buffer-modified-p`), while all user-visible commands (`save-buffer`, `find-file`, `isearch-forward`) are composed in T-Lisp from those primitives. The test for whether a function belongs in TypeScript vs. T-Lisp is: "would an Emacs user want to advise or override this function?"

## Decision

### 1. Add granular TypeScript primitives (Phase 0)

Extend the T-Lisp API with low-level primitives so higher-level commands can be composed in T-Lisp:

- **`src/editor/api/buffer-ops.ts`**: 8 new functions — `buffer-filename`, `set-buffer-filename`, `buffer-modified-p`, `set-buffer-modified-p`, `buffer-get-line-indent`, `buffer-set-line-indent`, `buffer-previous-non-blank-line`, `buffer-line-matches`
- **`src/editor/api/file-ops.ts`**: Rewritten with 10 real implementations replacing stubs — `write-file-content` (async fire-and-forget), `read-file-content` (sync via `fs.readFileSync`), `file-exists-p`, `file-modtime`, `file-stat`, `file-copy`, `make-backup-file`, `file-remove`, `file-mkdir`, `read-dir`
- **`src/editor/api/hook-ops.ts`** (new): `add-hook`, `remove-hook`, `run-hooks`, `hook-list`

### 2. Build syntax highlighting engine (Phase 1)

Create a regex-based tokenizer and highlighter pipeline consumed by the rendering layer:

- **`src/syntax/tokenizer.ts`**: Priority-ordered regex tokenizer with longest-match-wins
- **`src/syntax/highlighter.ts`**: Maps tokens to ANSI highlight spans via configurable theme
- **`src/syntax/languages/`**: Language rules for TypeScript, Python, Lisp, Go
- **`src/editor/api/syntax-ops.ts`**: T-Lisp API for `syntax-set-language`, `syntax-tokenize-line`, `syntax-highlight-line`, etc.
- **`src/frontend/render/buffer-lines.ts`**: Extended `renderBufferLines` to apply `HighlightSpan[]` per line, with cursor-line highlighting taking priority over syntax bg

### 3. Add incremental search, query replace, auto-indent, major modes, dired (Phases 2–6)

Each feature follows the same pattern: TypeScript primitives in `src/editor/api/`, T-Lisp command composition in `src/tlisp/core/commands/`, mode definitions in `src/tlisp/core/modes/`, indent rules in `src/tlisp/core/indent/`.

| Feature | TypeScript API | T-Lisp commands |
|---|---|---|
| Incremental search | `search-ops.ts` (+7 functions) | `isearch.tlisp` |
| Query replace | `replace-ops.ts` (new, 8 functions) | `replace.tlisp` |
| Auto-indent | `indent-ops.ts` (new, 5 functions) | `indent.tlisp` + 4 rule files |
| Major modes | `major-mode-ops.ts` (new, 7 functions) | 5 mode definitions |
| Dired | `dired-ops.ts` (new, 7 functions) | `dired.tlisp` |

### 4. Wire new modules into editor lifecycle

- All new API modules registered in `src/editor/tlisp-api.ts`
- Editor auto-detects major mode on file open via `major-mode-auto-detect`
- `recomputeHighlights()` called after buffer modifications
- T-Lisp command/mode/indent files loaded at editor init alongside core bindings
- New binding files loaded optionally — missing files don't force fallback to minimal bindings

### 5. Fix pre-existing test failures (46 → 0)

Root causes spanned multiple subsystems:

- **T-Lisp evaluator**: `defvar` leaked into global environment across test isolation boundaries; `assert-type` didn't evaluate quoted type expressions; `false` not parsed as boolean; setup/teardown bodies evaluated too early
- **Normal-mode handler**: Added count-aware command dispatch for `x`, `dd`, `dw`, `yy`, `yl`, `p`, `P` with pending-operator state
- **Yank/paste**: Fixed linewise register detection, EOF paste placement, character paste-before offset
- **Fuzzy completion**: Tightened scoring so `file-save` wins over `file-stat` for `fs` input; literal prefix ties show match list
- **Test framework**: Fixed async `done` callback shape, nested suite recursion, fixture shorthand parsing

### 6. Remove all Deno remnants

- Replaced `Deno.exit()` → `process.exit()`, `Deno.stdin.isTerminal` → `process.stdin.isTTY`, `Deno.addSignalListener` → `process.on`, `Deno.remove()` → `fs.promises.unlink()` across 14 scripts
- Replaced all "Deno-ink" comments with "Ink" across 5 frontend files
- Updated debug reporter to show `Bun.version` instead of `Deno.version`
- Updated help text, README, docs/examples from `deno` to `bun` equivalents
- Deleted stale `TEST_CONVERSION_GUIDE.md` and `TEST_CONVERSION_SUMMARY.md`
- Changed all script shebangs from `#!/usr/bin/env deno run --allow-read --allow-write` to `#!/usr/bin/env bun`

## Consequences

### Positive

- **1531 tests pass, 0 fail** — up from 1231 pass / 46 fail baseline, net +300 tests with zero regressions
- All six daily-driver features now have working T-Lisp APIs and command composition
- Codebase is fully Bun-native — zero `Deno.*` API calls or `deno` references in active code
- Major modes auto-detect on file open and display in the status line
- Syntax highlighting renders through the existing `renderBufferLines` pipeline with ANSI styles
- The granular primitive pattern is established: future commands follow the same TypeScript-primitive + T-Lisp-composition model

### Negative

- Some T-Lisp command files (`isearch.tlisp`, `replace.tlisp`, `dired.tlisp`) are compositional stubs — the full interactive UX (live highlighting in isearch, y/n/all prompt loop in replace) requires further handler integration
- `recomputeHighlights()` uses `executeCommand` to call `syntax-highlight-line` per visible line — not yet optimized for large files
- `evalTlisp` callback in `major-mode-ops.ts` is stubbed to return nil — mode activation hooks don't yet run real T-Lisp expressions
- The 36 new files increase the module surface that needs to load correctly at editor init

### Neutral

- New T-Lisp files load optionally alongside core bindings — tests with mock filesystems don't fail when mode/command files are absent
- The `indent-ops.ts` WeakMap storage means indent rules are tied to buffer object identity — buffer switches preserve rules per-buffer
- Async file operations (`write-file-content`) use fire-and-forget pattern: status updates appear in `.then()` callback, not as return values
