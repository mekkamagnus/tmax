# Feature: occur — list all matches in a navigable buffer

## Goals

- Give users an Emacs/Vim `:vimgrep`-style **listing buffer** of every line that matches a search pattern, so they can scan all hits at once instead of hopping one at a time with `n`/`N`.
- Make each listed line **jumpable** back to its source buffer and line number (1-indexed `linenr:` prefix in the `*Occur*` buffer; `RET` jumps the cursor there).
- Reuse the existing match-finding primitive (`search-find-all-matches`) and the existing buffer/jump primitives so no new search engine is introduced — only the listing + navigation glue.

## Completion Criteria (Definition of Done)

- [ ] `(occur "PATTERN")` from M-x or a keybinding builds a new (or reused) buffer named `*Occur*` containing every line in the current buffer that contains `PATTERN`, each prefixed with its 1-indexed source line number (e.g. `  12: const foo = ...`) — eval-33.
- [ ] The `*Occur*` buffer's first line is a header naming the source buffer and pattern (`6 matches for "PATTERN" in source-buffer:`), and the status line reports the match count on completion — eval-33.
- [ ] On the `*Occur*` buffer, pressing `RET` on any match line switches back to the source buffer and moves the cursor to that match's line (verified by reading `(buffer-line)` + `(buffer-current)` after the jump) — eval-33.
- [ ] Calling `(occur "PATTERN")` again with a different pattern refreshes the existing `*Occur*` buffer in place (does not stack up duplicate `*Occur*` buffers) — eval-33.
- [ ] A pattern that matches nothing produces an empty `*Occur*` body (header reports `0 matches`) and a status-line message `Pattern 'X' not found`, with no error thrown — eval-33.
- [ ] `occur` is discoverable in M-x completion (it has a docstring and/or a binding), and is bound to `SPC s o` in normal mode (SPEC-067: no `C-x` prefix) — eval-33.

## Description

`occur` is the classic Emacs command that, given a pattern, gathers every line containing it into a dedicated listing buffer and lets the user jump from any entry back to the source. tmax already finds matches (`search-find-all-matches` in `src/editor/api/search-ops.ts:651` returns `(line column)` pairs) and can read lines (`buffer-line` in `src/editor/api/buffer-ops.ts:165`, `buffer-lines` in `buffer-ops.ts:209`) and jump by line (`jump-to-line` in `src/editor/api/jump-ops.ts:167`). What is missing is the **listing buffer** that ties those primitives together: a temp buffer, an annotated line per match, and a `RET` binding that jumps to the recorded source line.

This spec adds exactly that glue as a T-Lisp command library, mirroring the existing `buffers.tlisp` / `isearch.tlisp` command-library pattern (`defmodule` + exported `defun`s + `key-bind` + `provide`), backed by one small TypeScript primitive to set the source buffer + line on each entry.

## User Story

As a **developer scanning a large file for every occurrence of a symbol**,
I want **a single buffer listing all matching lines with their line numbers, where pressing RET on any entry jumps me back to that line in the source file**,
so that **I can review all hits at a glance and navigate to the one I care about without mashing `n` repeatedly.**

## Problem Statement

The prior alpha audit (2026-08-01) catalogued search as **partial at the listing/navigation layer**: tmax has first-class single-match navigation (`/`, `?`, `n`, `N`, `*`, `#` via `search-ops.ts`) and even returns all match positions (`search-find-all-matches`), but there is **no buffer that aggregates the matches into a navigable view**. Concretely, today a user who wants "show me every line containing `TODO`" must press `n` once per hit and cannot see them side by side, and the match data returned by `search-find-all-matches` (raw `(line col)` pairs) is not surfaced as anything the user can move through. `occur` is the standard answer to that gap and was flagged as a missing search affordance.

## Solution Statement

Implement `occur` as a **T-Lisp command library** (`src/tlisp/core/commands/occur.tlisp`) following the `buffers.tlisp` pattern, backed by one new TypeScript API module `src/editor/api/occur-ops.ts` wired into the editor in `src/editor/tlisp-api.ts` next to `createSearchOps`.

The T-Lisp layer owns the user-facing flow:
1. `(occur pattern)` — find the current (source) buffer name + all match lines via the existing `search-find-all-matches` and `buffer-line`; (re)create the `*Occur*` buffer; write a header (`<n> matches for "<pattern>" in <source-buffer>:`) then one annotated line per match (`<linenr>: <text>`); switch to it.
2. `(occur-jump)` — read the line-number prefix from the current `*Occur*` line, switch back to the recorded source buffer, and call `(jump-to-line <linenr>)`.

The thin TS primitive (`occur-ops.ts`) holds the **source-buffer-name ↔ occur-buffer mapping** so `occur-jump` knows where to return (a module-internal map keyed by occur-buffer name, mirroring how `buffer-ops.ts` carries `buffers`). It also exposes `occur-set-source` (record source buffer name when `*Occur*` is built) and `occur-source-get` (return it for the jump). Everything else — line iteration, string formatting, jumping — is composed from existing primitives, per the `src/editor/CLAUDE.md` rule that TypeScript here provides primitives only and editor logic lives in T-Lisp.

The `*Occur*` buffer is a normal named buffer (created via `buffer-create`), not one of the reserved special buffers (`*scratch*`, `*Messages*`, `*daemon*` per `src/editor/CLAUDE.md`). It is rebuilt in place when `occur` is invoked again, so it never duplicates.

`RET` in the `*Occur*` buffer is bound via a normal-mode `key-bind` (SPEC-067: no `C-x` prefix — `RET` is a plain key, not an Emacs chord). The command is also reachable through M-x via `SPC ; occur`.

## Relevant Files

READ before implementing — these paths and the plan are grounded in the current source:

- **`src/editor/api/search-ops.ts`** — `search-find-all-matches` (line 651) already iterates the current buffer and returns a list of `(line column)` pairs; `occur` will call it for the match lines (it returns line numbers, which is all `occur` needs for the prefix).
- **`src/editor/api/buffer-ops.ts`** — `buffer-create` (line 69), `buffer-switch` (line 88), `buffer-current` (line 111, returns the current buffer's name), `buffer-line` (line 165, reads line N), `buffer-lines` (line 209), `buffer-line-count` (line 238), `buffer-insert` (line 259, inserts at cursor), `buffer-insert-at-position` (line 356, inserts at an explicit line/col — useful for building the `*Occur*` body without moving the cursor). `occur-ops.ts` follows this module's `createBufferOps` signature shape (factory returning `Map<string, TLispFunctionImpl>`).
- **`src/editor/api/jump-ops.ts`** — `jump-to-line` (line 167, `{count}G` semantics) — `occur-jump` calls it after switching back to the source buffer.
- **`src/editor/tlisp-api.ts`** — the API wiring point: `createSearchOps`, `createBufferOps` are instantiated here; the new `createOccurOps` is added alongside them. (Confirmed: `searchOps` and `bufferOps` are constructed and merged in this file.)
- **`src/tlisp/core/commands/buffers.tlisp`** — the command-library template to mirror: `defmodule` + exported `defun`s (e.g. `switch-to-buffer`) + `provide`. The `*Occur*` creation mirrors `switch-buffer-accept`'s `(buffer-create name)` / `(buffer-switch name)` dance.
- **`src/tlisp/core/commands/isearch.tlisp`** — secondary template showing the `(key-bind "/" "(isearch-forward)" "normal")` + docstring-per-function convention that makes a command M-x-discoverable.
- **`src/tlisp/core/commands/execute-extended-command.tlisp:15-19`** — `command-detail-interactive-p`: a function appears in M-x IFF it has a non-empty docstring OR a keybinding. `occur` therefore needs a docstring (and gets a binding too).
- **`src/editor/CLAUDE.md`** — reserves `*scratch*`/`*Messages*`/`*daemon*` as special buffers; `*Occur*` is NOT in that set, so it is a plain user buffer (not undeletable). Cited so the implementer does not add it to the special-buffer guard.

### New Files

- **`src/editor/api/occur-ops.ts`** — thin TS primitive module exporting `createOccurOps(access, buffers, setCurrentBuffer, setCursorLine)` returning a `Map<string, TLispFunctionImpl>` with `occur-set-source` / `occur-source-get` (and optionally `occur-buffer-name`). Holds the occur-buffer→source-buffer name map. No search logic.
- **`src/tlisp/core/commands/occur.tlisp`** — T-Lisp command library: `(occur pattern)`, `(occur-jump)`, plus `(key-bind "RET" "(occur-jump)" "normal")` scoped to the `*Occur*` buffer via a buffer-local check, and `(key-bind "o" "(occur \"\" ...)" ...)` via `SPC s o` plumbing in the normal keymap. Ends with `(provide "occur")`.

## Implementation Plan

### Phase 1 — TS primitive (`occur-ops.ts`)

1. Create `src/editor/api/occur-ops.ts` exporting `createOccurOps(access, buffers, setCurrentBuffer, setCursorLine)`. Internal state: a `Map<string, string>` from occur-buffer name → source-buffer name (defaults to `"*Occur*" → ""`).
2. Implement two primitives:
   - `occur-set-source (occur-buf-name source-buf-name)` — records the mapping; returns the occur-buf-name.
   - `occur-source-get (&optional occur-buf-name)` — returns the recorded source buffer name for the occur buffer (default: the current buffer if it is `*Occur*`, else look up `*Occur*`), or nil if none.
3. Register the module in `src/editor/tlisp-api.ts` next to `createSearchOps`/`createBufferOps`, passing the shared `buffers` map so the occur buffer and source buffer share the same buffer store.

### Phase 2 — T-Lisp command library (`occur.tlisp`)

4. Create `src/tlisp/core/commands/occur.tlisp` with `(defmodule editor/commands/occur (export occur occur-jump) ...)`.
5. `(occur pattern)`:
   - Capture `(buffer-current)` as `source` and `(buffer-line-count)` as `nlines`.
   - If `pattern` is empty, fall back to `(search-pattern-get)` (reuse last search, like `search-next` does). If still empty, message + return.
   - Build the match list: iterate line numbers `0..nlines-1`, read each via `(buffer-line i)`, test with `string-contains` (or `string-match` if a regex is desired — start with literal substring to match `search-find-all-matches` semantics). Collect `(linenr text)` pairs.
   - Create or reuse `*Occur*` via the `buffers.tlisp` pattern: if `(member "*Occur*" (buffer-list))` is nil, `(buffer-create "*Occur*")`; else `(buffer-switch "*Occur*")`. Clear its contents (delete the whole range) so a re-run does not append.
   - `(occur-set-source "*Occur*" source)`.
   - Insert the header: `(format "%d matches for \"%s\" in %s:" count pattern source)` then a newline, then for each match `(format "%4d: %s\n" (1+ linenr) text)`. Use 1-indexed line numbers in the prefix (Emacs convention; `jump-to-line` takes 1-indexed `{count}G`).
   - `(buffer-switch source)` is NOT called yet — switch TO `*Occur*` so the user lands on the listing: `(buffer-switch "*Occur*")`, `(cursor-move 1 0)` (land on first match, below header), and `(editor-set-mode "normal")`.
   - Status: `(message (format "%d matches" count))`.
6. `(occur-jump)`:
   - Only act when `(buffer-current)` is `"*Occur*"`. Read the current line text via `(buffer-line (cursor-line))`; parse the leading `<digits>:` with `string-match` to get `linenr`; if no prefix, message and return.
   - `source ← (occur-source-get)`; `(buffer-switch source)`; `(jump-to-line linenr)`; `(recenter)` if available, else just `(cursor-move linenr 0)`.
7. Bindings (SPEC-067: NO `C-x` chords):
   - `(key-bind "RET" "(occur-jump)" "normal")` — but `RET` already has a normal-mode meaning, so scope it: `occur-jump` itself checks `(string= (buffer-current) "*Occur*")` and no-ops otherwise (keeps the existing `RET` behavior intact in other buffers; the binding lives in the library and is harmless because of the guard).
   - `SPC s o` → `(occur (search-pattern-get))` or prompt: per the SPC-prefix machinery (`editor-space-prefix-active-p`), wire `(key-bind "o" "(occur-prompt)" "normal")` behind the `SPC s` prefix. Provide `(occur-prompt)` that reads a pattern via `completing-read`/`read-from-minibuffer` (mirror `find-file.tlisp`'s `completing-read` use) then calls `occur`.
8. End the file with `(provide "occur")` and add it to the core command-file load list wherever `isearch.tlisp` / `buffers.tlisp` are loaded (search the repo for the load glob — typically the editor's core-bindings/command loader).

### Phase 3 — Discoverability + tests

9. Give every exported `defun` a docstring (so `command-detail-interactive-p` admits `occur`/`occur-jump` to M-x even without the binding).
10. Add a unit test for the `occur-ops.ts` primitive (set/get source mapping) under `test/unit/`.
11. Add integration coverage via the eval-33 playbook (see Test Plan).

## Test Plan

- **eval-33** (e2e playbook, to be authored in `tmax-use/playbooks/eval-33-occur.yaml`): open a fixture file with several matching lines; `(occur "TARGET")`; assert the `*Occur*` buffer exists, contains the header with the right count, and lists each matching line with its 1-indexed prefix; from the `*Occur*` buffer move to a match line, press `RET` (or `(occur-jump)`), and assert the cursor landed on the matching line in the source buffer (`(buffer-current)` returns the source name; `(buffer-line)` matches). Also assert: a no-match pattern yields a `0 matches` header + `Pattern 'X' not found` status; a second `occur` with a new pattern refreshes the same `*Occur*` buffer (no duplicate `*Occur*` in `(buffer-list)`).
- **Unit**: `test/unit/occur-ops.test.ts` (new) — `occur-set-source` then `occur-source-get` round-trips the source name; `occur-source-get` on an un-set buffer returns nil.
- **Validation commands** (run all, zero regressions): `bun run typecheck:src`, `bun run typecheck:test`, `bun run typecheck`, `bun run build`, `bun run test:unit`, `bun run test:tmax-use` (which drives eval-33).

## M-x Discoverability

A function appears in M-x completion **IFF it has a docstring OR a keybinding**, per `command-detail-interactive-p` in `src/tlisp/core/commands/execute-extended-command.tlisp:15-19` (it checks `(> (length documentation) 0)` OR `(not (null bindings))`). Therefore:

- `occur` and `occur-jump` MUST each get a docstring (so they are M-x-discoverable even before the binding is added), and `occur` additionally gets the `SPC s o` binding (and `occur-jump` gets the `*Occur*`-scoped `RET` binding). The TS primitives `occur-set-source` / `occur-source-get` are not user commands and intentionally omit docstrings so they stay out of M-x.

## Notes

- **No new search engine.** `occur` reuses `search-find-all-matches` / `buffer-line` / `jump-to-line`; the only new TS code is the source-buffer bookkeeping primitive.
- **1-indexed line numbers** in the `*Occur*` prefix match `jump-to-line`'s `{count}G` convention and Emacs `occur` output, so a user can also type `12G` to jump to source line 12 directly.
- **SPEC-067 reminder:** `C-x` is the vim decrement prefix, not an Emacs-style prefix. This spec uses `SPC s o` and a scoped `RET` only — no `C-x` chords.
- **Buffer name collision:** `*Occur*` is a plain buffer, not reserved. If a user already has a buffer literally named `*Occur*`, `occur` reuses/overwrites it (Emacs does the same); this is documented behavior, not a bug.
