# Feature: `transpose-chars` + `capitalize-word` / `upcase-word` / `downcase-word`

## Goals

- Add `transpose-chars` — swap the character at point with the character immediately before it (Emacs `C-t` / vim `xp`-equivalent at the primitive level) — as a TypeScript primitive.
- Add word-level case operations `capitalize-word` / `upcase-word` / `downcase-word` that transform the word at (or just after) point, reusing the existing word-boundary logic in `word-ops.ts` / `text-utils.ts`. Case ops today exist only at region level (`visual-lowercase` / `visual-uppercase`).
- Bind `C-t` (transpose), `M-c` (capitalize), `M-u` (upcase), `M-l` (downcase) — the standard Emacs bindings — and make all four commands discoverable in `M-x` via docstrings.
- Keep the primitives consistent with the immutable-buffer + `setBuffer` mutation pattern used by `visual-ops.ts` so undo/redo treats each as one step.

## Completion Criteria (Definition of Done)

- [ ] `(transpose-chars)` with the cursor on `b` in `ab|cd` produces `acbd` with the cursor on the `c` (i.e. the char at point and the char before it swap, and point advances one); at the start of a line it transposes with the previous line's last char (Emacs behavior) — eval-31.
- [ ] `(upcase-word)` with the cursor on `hello` in `hello world` produces `HELLO world` and lands point after the uppercased word — eval-31.
- [ ] `(downcase-word)` on `HELLO` produces `hello`; `(capitalize-word)` on `hello` produces `Hello` — eval-31.
- [ ] All three word-case ops operate on the word at point if point is on a word char, otherwise on the next word forward (Emacs semantics), using the word boundaries already defined by `isWordChar` in `text-utils.ts:14` — eval-31.
- [ ] `C-t`, `M-c`, `M-u`, `M-l` are bound in normal and insert modes and invoke the corresponding commands; all four commands appear in `M-x` completion (they carry docstrings) — eval-31.
- [ ] The word-case ops are undoable as a single step (immutable `buffer.replace` → `setBuffer`, mirroring `visual-ops.ts:459`) — verified by `u` reverting one word-case op — eval-31.
- [ ] `bun run typecheck:src`, `bun run typecheck:test`, `bun run typecheck` all pass; the unit test for `transpose-chars` (mid-line, start-of-line, end-of-line) and the word-case ops (on-word vs between-words) passes.

## Description

Two small but conspicuous code-editing affordances are missing from tmax: **character transposition** and **word-level case changes**. The alpha audit (`alpha-audit-2026-08-01`) noted that case operations exist only at the visual-region layer (`visual-lowercase` / `visual-uppercase` in `src/editor/api/visual-ops.ts:409` / `:472`) — there is no way to uppercase the single word at point without first entering visual mode and selecting it. And there is no transpose primitive at all.

This feature adds both as TypeScript primitives in a new `src/editor/api/case-ops.ts` (transpose lives there too since it is a small char-level mutation that shares the immutable-buffer pattern), registers them through the declarative contribution registry, binds the standard Emacs keys, and exposes them through `M-x`.

## User Story

As a **developer typing code or prose in tmax**
I want **to swap two adjacent characters with one keystroke and to change the case of the word at point without entering visual mode**
So that **I can fix typos (`teh`→`the` style transpositions) and normalize identifiers (`someVar`→`SOMEVAR` for a constant) quickly, the way Emacs users do with `C-t` / `M-c` / `M-u` / `M-l`.**

## Problem Statement

From the 2026-08-01 alpha audit (`alpha-audit-2026-08-01` memory) and direct source inspection:

- **No transpose primitive.** `rg "transpose" src/editor/api` returns nothing. There is no `C-t` binding in `src/tlisp/core/bindings/normal.tlisp` or `insert.tlisp`. So a user who swaps two letters must delete, move, and retype by hand.
- **Case ops are region-only.** The only case operations are `visual-lowercase` (`visual-ops.ts:409`) and `visual-uppercase` (`visual-ops.ts:472`), both of which require an active visual selection and exit to normal mode after one use. There is **no `capitalize-word`** anywhere, and no way to uppercase just the word under the cursor without selecting it.
- **No word-case bindings.** `M-c`, `M-u`, `M-l` are unbound; none of these names appear in `M-x` completion.

So the gap is at the T-Lisp/M-x layer: the word-boundary machinery exists (`text-utils.ts` `findWordStart`/`findWordEnd`, `isWordChar`), but no editor command exposes case changes at word granularity, and transposition does not exist at all.

## Solution Statement

Add the primitives in a new `src/editor/api/case-ops.ts`, registering one contribution (`name: "case"`) in `buildEditorAPIContributions()`:

1. **`transpose-chars`** — read the cursor line/column and the buffer text. If `column > 0`, swap `line[column-1]` with `line[column]` via a single `buffer.replace` over the 2-char range and advance point by one. If at column 0 (start of line) and not on the first line, transpose the last char of the previous line with the first char of the current line (Emacs `C-t` cross-line behavior). No-op (with a `message`) on an empty/single-char buffer.
2. **`capitalize-word` / `upcase-word` / `downcase-word`** — each: locate the word at point (if `isWordChar(char-at-point)`, that word; otherwise scan forward with the same `isWordChar` skip used in `word-ops.ts:299`/`:315` to the next word), compute its bounds via `findWordStart`/`findWordEnd` from `text-utils.ts`, apply the case transform (`toUpperCase` / `toLowerCase` / capitalize-first-only), and `buffer.replace` the word range → `setBuffer`. Land point after the transformed word (so repeated `M-u` advances word by word, Emacs-style). All three share a private helper that resolves the target word range and the transform function.

The mutation model matches `visual-ops.ts`: read `currentBuffer`, call the immutable `buffer.replace(range, newText)`, and push the result through `setBuffer` so undo groups it as one step.

**Binding:** `C-t` in normal + insert modes; `M-c` / `M-u` / `M-l` in normal + insert modes. `C-t` is **not** a `C-x` chord, so it does not collide with SPEC-067's `C-x` decrement assignment (the SPEC-067 constraint forbids `C-x <key>` chords only; `C-t` is a distinct `C-` key). No `C-x` bindings are introduced.

## Relevant Files

Use these files to implement the feature:

- **`src/editor/api/case-ops.ts`** *(NEW)* — `createCaseOps(access, setBuffer, setCursorLine, setCursorColumn)` returning `transpose-chars`, `capitalize-word`, `upcase-word`, `downcase-word`. Reuse `isWordChar`, `findWordStart`, `findWordEnd` from `text-utils.ts:14`/`:153`/`:43`; mutate via the immutable `buffer.replace` + `setBuffer` pattern from `visual-ops.ts:446-459`.
- **`src/editor/api/text-utils.ts`** — already exports `isWordChar` (line 14), `findWordStart` (line 153), `findWordEnd` (line 43). No change needed; cited as the word-boundary source of truth so case-ops does not reinvent boundaries.
- **`src/editor/api/visual-ops.ts`** — `visual-lowercase` (line 409) / `visual-uppercase` (line 472). Cited as the precedent for immutable `buffer.getText`/`buffer.replace`/`setBuffer`; case-ops mirrors this structure at word granularity.
- **`src/editor/api/word-ops.ts`** — `createWordOps` (line 506). Cited for the `isWordChar`-based "skip non-word chars to the next word" scan (lines 299, 315) that the word-case ops reuse to resolve the target word when point is between words.
- **`src/editor/tlisp-api.ts`** — `buildEditorAPIContributions()` (line 124). Insert `{ name: "case", factory: (ctx) => createCaseOps(ctx.access, ctx.setCurrentBuffer, ctx.setCursorLine, ctx.setCursorColumn) }` beside the `visual` contribution (line 404).
- **`src/tlisp/core/bindings/normal.tlisp`** — add `(key-bind "C-t" "(transpose-chars)" "normal")`, `(key-bind "M-c" "(capitalize-word)" "normal")`, `(key-bind "M-u" "(upcase-word)" "normal")`, `(key-bind "M-l" "(downcase-word)" "normal")`. (Place near the existing `M-y` yank-pop binding at line 201.)
- **`src/tlisp/core/bindings/insert.tlisp`** — add the same four bindings in insert mode so `C-t`/`M-c`/`M-u`/`M-l` work while typing (Emacs users expect them in insert/text mode).
- **`src/tlisp/core/commands/edit-commands.tlisp`** *(extend, or a new `case-commands.tlisp`)* — add thin T-Lisp wrappers with docstrings if needed; the TS primitives already carry the logic, so a docstring-bearing `(defun upcase-word () "Uppercase the word at point." (upcase-word))` alias may be unnecessary — confirm during implementation whether `M-x` completion reads primitive docstrings or only `defun` docstrings, and add `defun` wrappers in this file if primitives alone are not discoverable.
- **`src/editor/api/documentation.ts`** — add `DocumentationEntry` records for `transpose-chars`, `capitalize-word`, `upcase-word`, `downcase-word` (matches the existing entry style at lines 30-44).
- **`test/unit/editor.test.ts`** (or a focused `test/unit/case-ops.test.ts`) — unit coverage for `transpose-chars` (mid-line / start-of-line cross-line / end-of-line no-op) and the three word-case ops (on-word vs between-words vs last-word-on-line).

### New Files

- `src/editor/api/case-ops.ts`
- *(optional)* `src/tlisp/core/commands/case-commands.tlisp` if `defun` wrappers are needed for `M-x` discoverability.
- *(optional)* `test/unit/case-ops.test.ts`.

## Implementation Plan

1. **Primitives** — create `case-ops.ts`: `transpose-chars` (2-char swap, advance point, cross-line at col 0) and a shared `transformWordAtPoint(transform)` helper driving `capitalize-word`/`upcase-word`/`downcase-word`. Verify: `bun run typecheck:src`.
2. **Register** — add the `case` contribution in `tlisp-api.ts` beside `visual`.
3. **Bindings** — `C-t` / `M-c` / `M-u` / `M-l` in normal + insert.
4. **Discoverability** — confirm whether `M-x` completion surfaces bare primitives; add `defun` wrappers with docstrings in `edit-commands.tlisp` (or a new file) if not.
5. **Document** — add the four entries in `documentation.ts`.
6. **Test** — unit tests for transpose (3 cases) + word-case (on-word, between-words, end-of-line).
7. **Verify** — full validation suite + eval-31 playbook.

## Test Plan

- **Assigned playbook: `eval-31`** (`tmax-use/playbooks/eval-31-transpose-and-word-case.yaml`, authored separately). Key assertions:
  - `C-t` mid-line swaps the two chars around point and advances point; `C-t` at col 0 transposes across the line boundary.
  - `M-u` on `hello` → `HELLO`; `M-l` on `HELLO` → `hello`; `M-c` on `hello` → `Hello`; point lands after the word each time.
  - `M-u` between words (point on whitespace) uppercases the **next** word forward.
  - `u` undoes one word-case op as a single step.
  - All four appear in `M-x` completion.
- **Unit:** `transpose-chars` mid-line / start-of-line (cross-line) / single-char-buffer no-op; each word-case op on-word, between-words, and at the last word of the buffer (no following word).
- **Integration:** the eval-31 daemon-driven playbook exercises the real `C-t`/`M-c`/`M-u`/`M-l` bindings through a live session.

## M-x Discoverability

A function appears in `M-x` completion IFF it has a docstring OR a keybinding, per `command-detail-interactive-p` in `src/tlisp/core/commands/execute-extended-command.tlisp:15-19`. All four commands here satisfy **at least** the keybinding leg (`C-t`/`M-c`/`M-u`/`M-l` are bound), so they are guaranteed to appear in `M-x` completion regardless of whether the primitive-vs-`defun` docstring path is used. Implementation Step 4 confirms whether a docstring is additionally needed; if so, each `defun` wrapper MUST get one so discoverability does not regress if a binding is later removed.
