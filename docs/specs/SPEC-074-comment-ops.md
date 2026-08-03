# Feature: `comment-dwim` / `comment-region` / `uncomment-region` — line + region commenting

## Goals

- Provide line-level comment toggling (`comment-toggle-line`) and region-level comment/uncomment (`comment-region` / `uncomment-region`) as TypeScript primitives, driven by a per-major-mode comment-syntax table, so a code editor can comment code the way every peer editor can.
- Expose one user-facing T-Lisp command, `comment-dwim` ("do what I mean"): comment the active region when in visual mode, otherwise toggle the current line — mirroring Emacs `M-x comment-dwim` semantics.
- Bind `comment-dwim` to `M-;` and make it discoverable in `M-x` completion (it gets a docstring, satisfying `command-detail-interactive-p`).
- Keep the comment syntax mode-driven, not hardcoded: extend the major-mode layer with an optional `commentSyntax` field so each mode (lisp → `;`, ts/c/go → `//`, python/shell → `#`) declares its own prefix.

## Completion Criteria (Definition of Done)

- [ ] `(comment-toggle-line)` prepends the active major mode's comment prefix to the cursor's line when it is not already a comment, and removes the prefix (plus one leading space) when it is — eval-25.
- [ ] `comment-dwim` in visual mode comments every line in the selection using the mode prefix (e.g. selecting 3 lines of a `.ts` buffer and invoking `comment-dwim` → all 3 gain `// `) and exits to normal mode — eval-25.
- [ ] `comment-dwim` on an already-commented visual region un-comments every line (removes the prefix), the inverse of the previous criterion — eval-25.
- [ ] `comment-dwim` in normal mode (no active selection) behaves exactly like `(comment-toggle-line)` — eval-25.
- [ ] A buffer in `fundamental` mode (no comment syntax) renders a clear `message` ("No comment syntax for major mode 'fundamental'") and makes no buffer mutation, rather than inserting a literal `nil`/empty prefix — eval-25.
- [ ] A `.tlisp`/`.lisp` buffer uses `;` as the prefix; a `.ts`/`.c`/`.go` buffer uses `//`; a `.py`/`.sh` buffer uses `#` — verified by switching modes and toggling — eval-25.
- [ ] `comment-dwim` appears in `M-x` completion (it carries a docstring), and `M-;` is bound in normal and visual modes — eval-25.
- [ ] `bun run typecheck:src`, `bun run typecheck:test`, and `bun run typecheck` all pass; the relevant unit test for `comment-toggle-line` (single line, toggle on then off, mode-without-syntax path) passes.

## Description

tmax is a code editor that today has **no comment primitives at all** — conspicuous for a tool whose primary job is editing source. There is no `(comment-...)` function in the T-Lisp API, no `M-;` binding, and no per-mode comment-syntax field. This feature adds the missing layer end to end: a comment-syntax entry on `MajorModeConfig`, three TypeScript primitives (`comment-toggle-line`, `comment-region`, `uncomment-region`) in a new `src/editor/api/comment-ops.ts`, registration through the declarative contribution registry, a T-Lisp `comment-dwim` command that picks region-vs-line based on editor state, and an `M-;` binding.

`comment-dwim` ("do what I mean") is the single command users actually press: if a visual selection is active it comments (or, if every selected line is already commented, un-comments) the region; otherwise it toggles the line at point. This is the Emacs `comment-dwim` contract and what users expect from `M-;` / `gc` in peer editors.

## User Story

As a **developer editing source in tmax**
I want **to comment and uncomment lines and regions with one keystroke (`M-;`) that respects the file's language**
So that **I can disable code, leave notes, and toggle blocks without hand-typing `;`/`//`/`#` prefixes or counting which mode I'm in.**

## Problem Statement

The 2026-08-01 alpha audit (`alpha-audit-2026-08-01` memory) catalogued the conspicuously missing code-editing affordances. Commenting is the most glaring: there is **no comment primitive at the T-Lisp/M-x layer** at all. Concretely:

- `rg "comment" src/editor/api` returns nothing — no `comment-ops.ts`, no `comment-*` primitive.
- `MajorModeConfig` (`src/editor/mode-state.ts:48-57`) carries `syntaxLanguage`, indent rules, and `keymap`, but **no comment-syntax field**, so even if a primitive existed it would have no per-mode prefix to insert.
- The default mode registrations seed `syntaxLanguage` + indent rules only; none seed a comment prefix.
- `M-;` is unbound; there is no `comment-dwim`/`comment-line` in `M-x` completion.

So a tmax user editing Lisp or TypeScript today cannot comment code through the editor at all — they must type the prefix by hand.

## Solution Statement

Add the comment layer as **TypeScript primitives + a T-Lisp command**, matching the established split (`src/editor/CLAUDE.md`: TS provides buffer/cursor primitives, T-Lisp composes the user-facing command):

1. **Comment-syntax on the mode.** Extend `MajorModeConfig` in `src/editor/mode-state.ts` with an optional `commentSyntax?: string` field (e.g. `";"`, `"//"`, `"#"`). Seed it on the built-in mode registrations so lisp → `;`, ts/c/c++/go/java → `//`, python/shell → `#`. Add a `(major-mode-comment-syntax)` T-Lisp accessor (cheap read of the current mode's config) so the T-Lisp layer can ask "what prefix applies here" without a new TS primitive for the decision.
2. **Primitives in `comment-ops.ts`.** New `src/editor/api/comment-ops.ts` exporting `createCommentOps(access, setBuffer, setCursorLine)` returning a `Map` with:
   - `comment-toggle-line` — read `major-mode-get` → look up `commentSyntax`; if absent, `(message ...)` and return nil; else read `(buffer-line (cursor-line))`, and either strip the prefix (if the trimmed line starts with it) or prepend `prefix + " "` via `buffer-replace-range`.
   - `comment-region START-LINE END-LINE` / `uncomment-region START-LINE END-LINE` — iterate the line range, prepending or stripping the prefix per line through `buffer-replace-range` (reusing the same primitive the replace flow uses at `replace-ops.ts:204`).
   - `comment-region-active-p` — non-nil when in visual mode with a selection (so `comment-dwim` can branch).
3. **`comment-dwim` in T-Lisp.** A new `src/tlisp/core/commands/comment.tlisp` defines `(comment-dwim)` with a docstring (so it shows in `M-x`): if `(comment-region-active-p)` then determine whether every selected line is already commented → call `comment-region` or `uncomment-region`, exit visual mode; else `(comment-toggle-line)`.
4. **Binding + registration.** Bind `M-;` to `(comment-dwim)` in **both** normal and visual modes in `src/tlisp/core/bindings/normal.tlisp` and `visual.tlisp`. Register the `comment-ops` factory as a new contribution (`name: "comment"`) in `buildEditorAPIContributions()` in `src/editor/tlisp-api.ts`, beside the `major-mode` contribution. Document the new primitives in `documentation.ts`.

**SPEC-067 note:** `M-;` (Meta-semicolon) is a Meta binding, not a `C-x` chord, so it does not collide with the SPEC-067 vim-decrement assignment of `C-x`. No `C-x <key>` bindings are introduced.

## Relevant Files

Use these files to implement the feature:

- **`src/editor/mode-state.ts`** — `MajorModeConfig` (lines 48-57). Add `commentSyntax?: string;` after `keymap?`. Pure type change; single source of truth for the per-mode prefix.
- **`src/editor/auto-mode.ts`** / the built-in mode registrations (the `fundamental`/`markdown`/language seeds that set `syntaxLanguage` + indent rules) — add `commentSyntax` to each seeded mode: `";"` for lisp/clojure, `"//"` for ts/c/cpp/go/java, `"#"` for python/shell, `nil` for `fundamental`/`markdown`. (Locate the seed site via `rg "major-mode-register" src`.)
- **`src/editor/api/comment-ops.ts`** *(NEW)* — `createCommentOps(access, setBuffer, setCursorLine)` returning `comment-toggle-line`, `comment-region`, `uncomment-region`, `comment-region-active-p`. Mirror the structure of `visual-ops.ts` (immutable `buffer.replace` → `setBuffer`) and read the prefix through the major-mode state.
- **`src/editor/api/major-mode-ops.ts`** — add `(major-mode-comment-syntax)` (lines 48-357): a read returning `createString(config.commentSyntax ?? "")` for the current mode, modeled on `major-mode-get` (lines 197-204).
- **`src/editor/tlisp-api.ts`** — `buildEditorAPIContributions()` (line 124). Insert a new `{ name: "comment", factory: (ctx) => createCommentOps(ctx.access, ctx.setCurrentBuffer, ctx.setCursorLine) }` contribution beside the `major-mode` block (line 588). The registry's cross-contribution duplicate detection (`registry.ts:78`) will catch any name clash at construction.
- **`src/tlisp/core/commands/comment.tlisp`** *(NEW)* — `(defmodule editor/commands/comment (export comment-dwim))`. Define `comment-dwim` with a docstring; load it alongside the other command libraries.
- **`src/tlisp/core/bindings/normal.tlisp`** — add `(key-bind "M-;" "(comment-dwim)" "normal")` (Meta binding; does not touch the SPEC-067 `C-x` decrement at line 224).
- **`src/tlisp/core/bindings/visual.tlisp`** — add `(key-bind "M-;" "(comment-dwim)" "visual")`.
- **`src/editor/api/documentation.ts`** — add `DocumentationEntry` records for `comment-toggle-line`, `comment-region`, `uncomment-region`, `comment-dwim` (matches the existing `buffer-save` entry style at lines 30-44).
- **`test/unit/editor.test.ts`** (or a focused `test/unit/comment-ops.test.ts`) — unit coverage for `comment-toggle-line` (toggle on, toggle off, no-syntax mode), `comment-region`, `uncomment-region`.

### New Files

- `src/editor/api/comment-ops.ts`
- `src/tlisp/core/commands/comment.tlisp`
- *(optional)* `test/unit/comment-ops.test.ts` if the editor test file grows too large.

## Implementation Plan

1. **Type + seed** — add `commentSyntax?: string` to `MajorModeConfig`; seed it on the built-in mode registrations. Verify: `bun run typecheck:src`.
2. **Accessor** — add `major-mode-comment-syntax` to `major-mode-ops.ts` returning the current mode's prefix (or `""`).
3. **Primitives** — create `comment-ops.ts` with `comment-toggle-line` (read line via `buffer-line`, branch on prefix presence, mutate via `buffer-replace-range`), `comment-region`/`uncomment-region` (loop the range), and `comment-region-active-p` (visual-mode + selection check, mirroring the `visualSelection` read in `visual-ops.ts:423`).
4. **Register** — add the `comment` contribution in `tlisp-api.ts`.
5. **Command** — write `comment.tlisp` defining `comment-dwim` with a docstring; branch on `comment-region-active-p`.
6. **Bind** — `M-;` in normal + visual bindings.
7. **Document** — add the four entries in `documentation.ts`.
8. **Test** — unit tests for the three primitives + the no-syntax path.
9. **Verify** — run the full validation suite + the eval-25 playbook.

## Test Plan

- **Assigned playbook: `eval-25`** (`tmax-use/playbooks/eval-25-comment-ops.yaml`, authored separately). Key assertions:
  - `M-;` on an uncommented line in a `.ts` buffer prepends `// `; `M-;` again removes it.
  - Visual-select 3 lines, `M-;` → all 3 commented; `M-;` again → all 3 un-commented; editor returns to normal mode.
  - In a `fundamental` buffer, `M-;` produces the "No comment syntax..." message and leaves the buffer unchanged.
  - `M-x comment-dwim` is offered by completion and runs the same logic.
  - A `.tlisp` buffer uses `;`, a `.py` buffer uses `#` (mode-driven prefix).
- **Unit:** `comment-toggle-line` toggle-on / toggle-off / no-syntax-mode; `comment-region` over a multi-line range; `uncomment-region` is the exact inverse of `comment-region`.
- **Integration:** the eval-25 daemon-driven playbook exercises the real `M-;` binding end to end through a live session.

## M-x Discoverability

A function appears in `M-x` completion IFF it has a docstring OR a keybinding, per `command-detail-interactive-p` in `src/tlisp/core/commands/execute-extended-command.tlisp:15-19`. `comment-dwim` satisfies **both** (docstring in `comment.tlisp` + `M-;` binding), so it is guaranteed to appear. The TS primitives (`comment-toggle-line`, `comment-region`, `uncomment-region`, `comment-region-active-p`) are intentionally **not** given docstrings (they are building blocks, not user commands) — they will therefore NOT clutter `M-x` completion, which is the desired behavior. Each user-facing command introduced here MUST keep its docstring so it remains discoverable.
