# Feature: Full Vim Editing & Motions

## Feature Description
Complete the Vim editing model so tmax is usable as a daily driver. The current editor has basic hjkl navigation, insert/Escape mode switching, and a small TypeScript-side operator-pending implementation. This spec replaces that TypeScript editing logic with a T-Lisp-owned Vim dispatcher and fills the missing motions, operators, insert-mode entries, and insert-mode editing regressions.

**Target frontend:** Steep (default). Ink is secondary.

## User Story
As a developer using tmax as my daily editor
I want full Vim motions, operators, counts, prefixes, and insert-mode commands
So that I can edit text efficiently without reaching for another editor

## Problem Statement
1. **Insert mode is broken for basic operations**: the user reports that Enter and Backspace do not work while in insert mode. Steep sends `\n` and `\x7f`, and the insert handler appears to normalize them correctly, so this needs an automated regression test through the Steep/editor input path.
2. **Normal-mode dispatch is not composable**: the current keymap lookup handles one normalized key at a time. Literal bindings such as `gg`, `zt`, or `gt` do not work unless the frontend sends the whole sequence as one key.
3. **Operator-pending state is in TypeScript**: `normal-handler.ts` owns `pendingNormalOperator`, count accumulation, and hardcoded `d`/`y` dispatch. Per `rules/editor.md`, this belongs in T-Lisp.
4. **Missing insert-mode entries**: `a`, `A`, `I`, `o`, `O` are not implemented as normal-mode Vim commands.
5. **Missing single-key commands**: `D`, `C`, `Y`, `J`, and verified T-Lisp bindings for `x`, `p`, `P`.
6. **Missing motions and prefixes**: `gg`, `f/t/F/T`, `;/,`, `%`, `{/}`, and `zt/zz/zb`.
7. **Counts are incomplete**: `3dd`, `5j`, `2fw`, `5gg`, and operator+count combinations are not consistently handled.

## Architecture Principle: Maximum T-Lisp

Following the Emacs C/Lisp split (see `rules/editor.md`, `src/editor/Claude.md`, `src/tlisp/Claude.md`):

**Every implementation decision must pass this checklist:**
1. Can this be expressed as T-Lisp composing existing primitives? Do it in T-Lisp.
2. Can this be a T-Lisp function calling one factual primitive? Do it in T-Lisp.
3. Is this a raw factual query or mutation that T-Lisp cannot compute efficiently? Add a TypeScript primitive.

**TypeScript owns only factual primitives:**
- Raw buffer operations: insert text at position, delete range, read line, read text range
- Cursor operations: get/set position
- Viewport operations: get/set top row, terminal height
- Character scanning: find char position, find matching bracket, find paragraph boundary
- Thin mode routing from frontend key input into T-Lisp

**T-Lisp owns all editor logic:**
- `vim-dispatch-key`
- Operator-pending state (`d`, `y`, `c`)
- Prefix state (`g`, `z`, `f`, `t`, `F`, `T`)
- Count accumulation and consumption
- Command composition (`D`, `C`, `Y`, `J`, `a`, `A`, `I`, `o`, `O`)
- Mode transitions
- All Vim decisions and key semantics

## Solution Statement
1. Add a T-Lisp normal-mode dispatcher, `(vim-dispatch-key key)`, that receives every normal-mode keypress and owns pending state, prefix state, counts, and Vim command dispatch.
2. Make `normal-handler.ts` a thin router: normalize key, call `(vim-dispatch-key "...")`, and fall back to legacy keymaps only when the dispatcher returns nil.
3. Use T-Lisp globals for Vim state with supported syntax: `defvar` and `set!`, not `setq`.
4. Add T-Lisp command libraries for insert entries, edit commands, operators, motions, counts, and visual enhancements.
5. Add TypeScript primitives only when T-Lisp needs a factual operation it cannot compute from existing primitives.
6. Add automated tests for Steep insert-mode input, dispatcher state, counts, operators, and motions.

## Relevant Files

### Existing Files to Modify
- `src/editor/handlers/normal-handler.ts`: remove operator/count/prefix logic; route normal-mode keys to `(vim-dispatch-key key)` first.
- `src/editor/handlers/insert-handler.ts`: verify Enter, Backspace, and Tab behavior; only change if the regression test proves a bug.
- `src/editor/api/buffer-ops.ts`: add only factual primitives needed by T-Lisp, such as range insert/delete/replace.
- `src/editor/api/cursor-ops.ts`: add only factual cursor helpers if current get/set primitives are insufficient.
- `src/editor/api/jump-ops.ts`: add factual scanning primitives for find-char and bracket matching.
- `src/editor/api/line-ops.ts`: keep line navigation primitives factual; do not add high-level Vim commands here.
- `src/editor/editor.ts`: register new primitive ops and load the new T-Lisp command files.
- `src/tlisp/core/bindings/normal.tlisp`: either bind normal-mode Vim keys to the dispatcher or let `normal-handler.ts` call the dispatcher before keymap fallback.
- `src/tlisp/core/bindings/visual.tlisp`: add visual-mode Vim enhancements.

### New Files
- `src/tlisp/core/commands/vim-dispatch.tlisp`: central normal-mode dispatcher and pending state.
- `src/tlisp/core/commands/vim-counts.tlisp`: count helpers.
- `src/tlisp/core/commands/insert-entries.tlisp`: `a`, `A`, `I`, `o`, `O`.
- `src/tlisp/core/commands/edit-commands.tlisp`: `D`, `C`, `Y`, `J`, verified `x`, `p`, `P` wrappers if needed.
- `src/tlisp/core/commands/operators.tlisp`: `d`, `y`, `c` operator dispatch.
- `src/tlisp/core/commands/motions.tlisp`: `gg`, `f/t/F/T`, `;/,`, `%`, `{/}`, `zt/zz/zb`.
- `src/editor/api/motion-ops.ts`: factual paragraph/sentence boundary primitives, if not better placed in `jump-ops.ts`.

## Implementation Plan

### Phase 1: Insert Mode Regression
Add automated coverage for the user-reported insert-mode bug before changing behavior.

Required checks:
- Starting without a file creates a usable default buffer.
- Steep maps Enter to `\n` and Backspace to `\x7f`.
- `editor.handleKey("i")`, text input, `editor.handleKey("\n")`, and `editor.handleKey("\x7f")` produce the expected buffer content.
- Tab inserts a tab in insert mode.

### Phase 2: T-Lisp Normal Dispatcher
Create `(vim-dispatch-key key)` as the single normal-mode Vim entrypoint.

Responsibilities:
- Cancel pending state on `C-g` or Escape.
- Accumulate counts for digits, with Vim's special `0` behavior.
- If a find-char prefix is pending, consume the next arbitrary key as the search target.
- If a `g` or `z` prefix is pending, dispatch the second key.
- If an operator (`d`, `y`, `c`) is pending, dispatch the motion key.
- Otherwise dispatch single-key normal commands.
- Return truthy when handled and nil when the legacy keymap fallback should run.

The normal handler may do only routing:
1. Normalize the key.
2. Execute `(vim-dispatch-key <normalized-key>)`.
3. If the result is nil, run existing keymap fallback for non-Vim bindings.

### Phase 3: T-Lisp Count State
Implement count state in T-Lisp, not TypeScript.

Required helpers:
- `(vim-count-active-p)`
- `(vim-count-add-digit digit)`
- `(vim-count-current)` returns count or default `1`.
- `(vim-count-consume)` returns count or `1`, then resets.
- `(vim-count-reset)`

Use `defvar` and `set!`:

```lisp
(defvar vim-count 0)
(defvar vim-count-active nil)
```

### Phase 4: Insert-Mode Entry Commands
Create `insert-entries.tlisp` with commands composed from primitives:
- `insert-append`: move one char right, then enter insert mode.
- `insert-append-line`: move to end of line, then enter insert mode.
- `insert-line-start`: move to first non-blank, then enter insert mode.
- `open-line-below`: insert newline below current line, move to it, enter insert mode.
- `open-line-above`: insert newline above current line, move to it, enter insert mode.

Only add factual TypeScript primitives if needed:
- `buffer-insert-at-position`
- `buffer-insert-line-at`
- `buffer-delete-range`
- `buffer-replace-range`

### Phase 5: Single-Key Normal Commands
Create `edit-commands.tlisp`:
- `vim-delete-char` for `x`
- `vim-delete-to-line-end` for `D`
- `vim-change-to-line-end` for `C`
- `vim-yank-to-line-end` for `Y`
- `vim-join-lines` for `J`
- `vim-paste-after` for `p`
- `vim-paste-before` for `P`

`J` should be T-Lisp composition over factual buffer primitives, not a high-level TypeScript command.

### Phase 6: Operator Dispatch
Create `operators.tlisp` with T-Lisp-owned pending operator state:

```lisp
(defvar vim-pending-operator nil)
```

Required behavior:
- Pressing `d`, `y`, or `c` sets `vim-pending-operator`.
- The next key dispatches the operator+motion combination.
- Supported combinations:
  - `dd`, `dw`, `d$`, `dG`, `dgg`
  - `yy`, `yw`, `y$`
  - `cc`, `cw`, `c$`
- Operator+count works:
  - `3dd`
  - `d3w`
  - `3dw`
  - `2cc`

TypeScript must not contain the operator decision tree after this phase.

### Phase 7: Prefix Dispatch
Use the same T-Lisp state system for prefixes:

```lisp
(defvar vim-pending-prefix nil)
```

Required behavior:
- `g` then `g` -> `jump-to-first-line`
- `5gg` -> jump to line 5
- `g` then `t` -> `tab-next`
- `g` then `T` -> `tab-prev`
- `z` then `t` -> `scroll-cursor-top`
- `z` then `z` -> `scroll-cursor-center`
- `z` then `b` -> `scroll-cursor-bottom`

Do not rely on literal key bindings like `"gg"` or `"zt"` unless the key dispatch system explicitly supports multi-key strings.

### Phase 8: Find-Char Dispatch
Add factual TypeScript primitives:
- `find-char-position` with arguments `(char direction till-p count)`, returning a position or nil.
- Last-find state accessors only if storing this in T-Lisp is insufficient.

T-Lisp owns:
- `f`, `t`, `F`, `T` prefix setup.
- Consuming the following arbitrary character key.
- `;` repeat.
- `,` reverse repeat.
- Count handling, e.g. `2fw`.

### Phase 9: Bracket and Paragraph Motions
Add factual primitives:
- `match-bracket-position`: returns the matching bracket position or nil.
- `paragraph-boundary-position`: returns next/previous blank-line boundary.

T-Lisp owns:
- `%` command: call primitive, then move cursor if a position is returned.
- `{` and `}` commands: call primitive, then move cursor.

### Phase 10: Scroll Alignment
Expose factual viewport primitives if missing:
- `viewport-top-get`
- `viewport-top-set`
- `terminal-height-get`

T-Lisp owns:
- `scroll-cursor-top`
- `scroll-cursor-center`
- `scroll-cursor-bottom`
- Dispatch through `z` prefix.

### Phase 11: Visual Mode Enhancements
In T-Lisp:
- `visual-change`: compose `visual-delete` and `(editor-set-mode "insert")`.
- `visual-swap-anchor`: use a primitive only if visual anchor/cursor state cannot already be read and set from T-Lisp.

Add visual bindings:
- `c` -> `visual-change`
- `o` -> `visual-swap-anchor`

### Phase 12: Remove TypeScript Vim Logic
Remove or bypass these TypeScript-owned decisions:
- `pendingNormalOperator`
- normal-mode count accumulation
- hardcoded `x`, `p`, `P`, `d`, `y` dispatch in `normal-handler.ts`
- hardcoded two-key prefix handlers for Vim motions

Allowed TypeScript behavior:
- key normalization
- T-Lisp dispatcher invocation
- fallback for legacy non-Vim keymaps
- error/status plumbing

### Phase 13: Tests
Add tests covering:
- Insert-mode Enter, Backspace, and Tab from the Steep/editor key path.
- Dispatcher state reset on cancel.
- Counts: `3dd`, `5j`, `2fw`, `5gg`.
- Insert entries: `a`, `A`, `I`, `o`, `O`.
- Single-key commands: `x`, `D`, `C`, `Y`, `J`, `p`, `P`.
- Operators: `dd`, `dw`, `d$`, `cc`, `cw`, `c$`, `yy`, `yw`, `y$`.
- Prefixes and motions: `gg`, `gt`, `gT`, `f/t/F/T`, `;/,`, `%`, `{/}`, `zt/zz/zb`.
- Architecture regression: normal handler no longer contains an operator/count decision tree.

## Testing Strategy

### Unit Tests
- Test T-Lisp command functions via `editor.executeCommand()` or `interpreter.execute()`.
- Test normal-mode key sequences via `editor.handleKey()` so dispatcher state is exercised.
- Test factual primitives directly for scanning and range operations.

### Integration Tests
- Use the existing UI/tmux harness where available for Steep end-to-end input.
- Prioritize Steep. Ink should continue to pass smoke tests but is not the primary frontend for this feature.

### Edge Cases
- Insert mode in an empty buffer.
- `dd` on the last line.
- `cc` on an empty line.
- `J` on the last line.
- `f{char}` when the char does not exist on the current line.
- `%` on a non-bracket character.
- `5gg` jumps to line 5.
- `0` moves to first column when no count is active, but contributes to counts after a non-zero digit.
- Operator+count+motion combinations: `3dw`, `d3w`, `2cc`.

## Acceptance Criteria
1. Insert mode: Enter inserts newline, Backspace deletes character, Tab inserts tab.
2. Starting tmax without a file still creates an editable buffer.
3. `a`, `A`, `I`, `o`, `O` all enter insert mode at the correct cursor position.
4. `x` deletes the character under cursor.
5. `D` deletes to end of line, `C` changes to end of line, `Y` yanks to end of line.
6. `J` joins current line with the next line.
7. `p` and `P` paste from the yank/delete register.
8. `dd`, `dw`, `d$` delete the correct range.
9. `cc`, `cw`, `c$` delete and enter insert mode.
10. `yy`, `yw`, `y$` yank the correct range.
11. `gg` jumps to first line; `5gg` jumps to line 5; `G` still jumps to last line.
12. `f/t/F/T` find characters on the current line; `;` and `,` repeat/reverse.
13. `%` jumps to a matching bracket.
14. `{` and `}` jump between paragraphs.
15. `zt`, `zz`, and `zb` align the viewport.
16. Count prefix works for motions, operators, and find-char.
17. Normal-mode Vim operator/count/prefix decisions live in T-Lisp, not `normal-handler.ts`.
18. All existing tests pass and typecheck passes.

## Validation Commands
- `bunx tsc --noEmit`
- `bun test`
- `bun run start test/unit/editor.test.ts`
- `bun run start -- --ink`

## Notes
- TypeScript is allowed to route keys into T-Lisp. It is not allowed to decide what `d`, `3`, `g`, `z`, `f`, or `$` mean in Vim normal mode.
- T-Lisp examples must use supported forms such as `defvar` and `set!`. Do not use `setq` unless it is added to the interpreter first.
- Do not bind multi-key strings like `"gg"` or `"zt"` as the primary implementation unless key dispatch is explicitly changed to buffer key sequences. The dispatcher should consume one key at a time and use T-Lisp pending state.
- Keep TypeScript primitive names factual. Prefer `find-char-position` over `find-char`, `match-bracket-position` over `match-bracket`, and `buffer-replace-range` over `join-lines`.
- Manual testing is useful, but the insert-mode bug must be protected by automated tests because it is already user-visible.
