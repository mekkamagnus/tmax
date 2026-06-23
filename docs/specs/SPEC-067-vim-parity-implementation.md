# Feature: Vim Parity — Bind + Test Every Core Vim Normal-Mode Key

## Feature Description

This spec closes the vim-parity gap by **binding every core vim normal-mode key** and **testing each one thoroughly** with both a unit test (real editor, real keypresses) and a tmax-use e2e playbook. It replaces the roadmap-shaped SPEC-044, which spec-review correctly rejected as a non-implementable retrospective.

The codebase already has substantial vim infrastructure — operators (d/y/c), motions (word/line/paragraph/find), text objects, visual modes, marks, macros, repeat, replace mode, jumplist, and indent commands exist as T-Lisp command files. But many core vim keys are **not bound** in `src/tlisp/core/bindings/normal.tlisp`, so they only work via M-x / T-Lisp eval, not via the actual keystroke. Other keys are genuinely missing (toggle case `~`, search next/prev `n`/`N`, scroll-to-cursor `zt`/`zz`/`zb`, window jumps `H`/`M`/`L`, increment/decrement `C-a`/`C-x`).

This spec has three tracks:
1. **Bind already-implemented features** (marks `m{a-z}`/`` `{a-z} ``, macros `q{a-z}`/`@{a-z}`, replace-char `r{char}`, replace-mode `R`, repeat-last-change `.`, search next/prev `n`/`N`, indent `>>`/`<<`, go-to-first-line `gg`, go-to-last-insert `gi`, jumplist back/forward `C-o`/`C-i`). These have T-Lisp command files and unit tests — they just need key bindings added + the tests extended to verify the binding works.
2. **Implement genuinely-missing features** (toggle-case `~`, scroll-to-cursor `zt`/`zz`/`zb`/`z.`, window-position jumps `H`/`M`/`L`, increment/decrement `C-a`/`C-x`). These need T-Lisp command implementations + bindings + tests.
3. **Thorough test coverage** — every key bound or implemented in this spec gets a unit test that sends real keypresses and asserts on end state, plus a tmax-use e2e playbook that drives the key through the actual daemon/client stack.

## User Story

As a **vim user running tmax as my daily editor**
I want to **press every core vim normal-mode key and have it do what vim does**
So that **my muscle memory works without surprises, and every key is verified by both a unit test and an e2e playbook.**

## Problem Statement

Two problems:

1. **Feature-not-bound.** Many vim features are implemented as T-Lisp commands with passing unit tests but are **not reachable via the vim keystroke** — they're only callable via M-x or eval. A vim user pressing `gg` to go to the first line gets nothing; they'd have to know `(vim-gg)` exists and eval it. The feature works but is invisible to the user. The existing tests prove the command works but don't prove the binding works.

2. **Feature-missing.** Several core vim keys have no implementation at all: toggle-case (`~`), scroll-to-cursor (`zt`/`zz`/`zb`/`z.`), window-position jumps (`H`/`M`/`L`), numeric increment/decrement (`C-a`/`C-x`). A vim user pressing these gets nothing.

The old SPEC-044 documented this as a retrospective audit/roadmap but was not structured as an implementation spec. Codex correctly rejected it ("not a clean implementation spec ... non-executable ... stale repository assumptions"). This spec replaces it with a concrete, testable, forward-looking plan.

## Solution Statement

Three tracks, executed in order:

**Track 1 — Bind already-implemented features (no new logic).** Add key bindings in `src/tlisp/core/bindings/normal.tlisp` for the features whose T-Lisp commands already exist and have passing unit tests. The bindings are one-liners: `(key-bind "gg" "(vim-gg)" "normal")` etc. Extend the existing unit tests to also send the key sequence (not just eval the command) and verify the end state.

**Track 2 — Implement genuinely-missing features (new T-Lisp).** Write T-Lisp commands for: `toggle-case` (`~`), `scroll-cursor-top`/`scroll-cursor-center`/`scroll-cursor-bottom` (`zt`/`zz`/`zb`), `window-jump-top`/`window-jump-middle`/`window-jump-bottom` (`H`/`M`/`L`), `increment-number`/`decrement-number` (`C-a`/`C-x`). Each gets a new command in `src/tlisp/core/commands/`, a binding, and a unit test.

**Track 3 — tmax-use e2e playbooks.** Author playbooks in `tmax-use/playbooks/` that drive each implemented key through the real daemon/client stack. Every key bound or implemented in this spec appears in at least one playbook step with an `expect` assertion on cursor position, buffer text, or mode.

The spec updates testing to use tmax-use exclusively (per ADR-0102 — the Python UI harness is gone).

## Relevant Files

Use these files to implement the feature:

### Existing Files to Modify

- **`src/tlisp/core/bindings/normal.tlisp`** — The key-binding registry. Track 1 adds ~15 one-liner bindings here; Track 2 adds ~10 more for the new features. This is the central file.
- **`src/tlisp/core/commands/motions.tlisp`** — Add `vim-gg`, `vim-gi` (go to last insert position), `scroll-cursor-top/center/bottom`, `window-jump-top/middle/bottom` here. Existing motions file is the pattern.
- **`src/tlisp/core/commands/edit-commands.tlisp`** — Add `toggle-case`, `increment-number`, `decrement-number` here. These are edit operations on buffer text.
- **`src/tlisp/core/commands/isearch.tlisp`** — Already has search infrastructure; wire `n`/`N` (search next/previous) to it. Verify the command exists; if not, add it.
- **`src/tlisp/core/commands/operators.tlisp`** — Verify `r{char}` (replace-char operator) and `R` (replace mode) wiring is complete; bind if missing.
- **`src/tlisp/core/commands/marks.tlisp`** — Already exists (139 lines). Bind `m{a-z}` (set mark), `` `{a-z} `` (jump to mark), `` `{a-z}{a-z} `` (jump to mark line). Verify mark-set/mark-jump signatures match the binding.
- **`src/tlisp/core/commands/macros.tlisp`** — Already exists (134 lines). Bind `q{a-z}` (record macro), `@{a-z}` (play macro).
- **`src/tlisp/core/commands/repeat.tlisp`** — Already exists (209 lines). Bind `.` (repeat last change).
- **`src/tlisp/core/commands/vim-replace.tlisp`** — Already exists (106 lines). Bind `r{char}` (single-char replace) and `R` (replace mode).
- **`src/tlisp/core/commands/indent-ops.tlisp`** — Already exists (276 lines). Bind `>>` (indent right), `<<` (indent left).
- **`src/tlisp/core/commands/jumplist.tlisp`** — Already exists (126 lines). Bind `C-o` (jumplist back), `C-i` (jumplist forward).
- **`src/tlisp/stdlib.ts`** — If any new T-Lisp primitive is needed (e.g., viewport scroll control for `zt`/`zz`/`zb`, number parsing for `C-a`/`C-x`), expose it here. Check `src/editor/api/` for existing viewport/scroll API first — prefer using what exists.

### Existing Unit Test Files to Extend

Every existing test below should be extended to also send the real keypress sequence (not just eval the command), verifying the binding works end-to-end:

- **`test/unit/marks.test.ts`** — Add keypress-based tests for `ma`, `` `a ``, `` `a`a ``.
- **`test/unit/macros.test.ts`** / **`test/unit/macro-recording.test.ts`** — Add keypress-based tests for `qa...q`, `@a`.
- **`test/unit/repeat-change.test.ts`** — Add keypress test for `.` (dot-repeat).
- **`test/unit/replace-mode.test.ts`** — Add keypress tests for `r{char}` and `R`.
- **`test/unit/indent-ops.test.ts`** — Add keypress tests for `>>`, `<<`.
- **`test/unit/jumplist.test.ts`** — Add keypress tests for `C-o`, `C-i`.

### New Files

- **`test/unit/vim-toggle-case.test.ts`** — Unit tests for `~` (toggle case of char under cursor, advance cursor).
- **`test/unit/vim-scroll-cursor.test.ts`** — Unit tests for `zt`/`zz`/`zb`/`z.` (scroll so cursor line is at top/center/bottom of viewport).
- **`test/unit/vim-window-jumps.test.ts`** — Unit tests for `H`/`M`/`L` (jump to top/middle/bottom visible line).
- **`test/unit/vim-increment-number.test.ts`** — Unit tests for `C-a`/`C-x` (increment/decrement the number under cursor).
- **`test/unit/vim-gg-gi.test.ts`** — Unit tests for `gg` (go to first line) and `gi` (go to last insert position). May fold into existing motion tests if cleaner.
- **`test/unit/vim-search-next-prev.test.ts`** — Unit tests for `n`/`N` (search next/previous). May fold into existing `search-navigation.test.ts`.
- **`test/unit/vim-bindings-smoke.test.ts`** — A single comprehensive test file that sends EVERY key bound in `normal.tlisp` (before and after this spec) and asserts it doesn't crash + produces a non-error state. This is the regression-catch-all: no future binding removal goes undetected.
- **`tmax-use/playbooks/vim-parity-motions.yaml`** — E2e playbook: h/j/k/l, w/b/e, 0/$, gg/G, _, f/F/t/T, %, {/}, H/M/L, C-o/C-i. Asserts cursor positions.
- **`tmax-use/playbooks/vim-parity-edit.yaml`** — E2e playbook: x/dD/cc/yY/p, r{char}, R, ~, >>/<<, J, C-a/C-x, .. Asserts buffer text after each.
- **`tmax-use/playbooks/vim-parity-advanced.yaml`** — E2e playbook: marks (m{a}/`{a}), macros (qa...q/@a), search (*/#/n/N), scroll (zt/zz/zb), visual (v/V/C-v + operators). Asserts end states.

## Implementation Plan

### Phase 1: Bind already-implemented features (Track 1)

Add key bindings for features whose T-Lisp commands exist and have passing unit tests. No new logic — just wiring + test extension to verify the binding.

### Phase 2: Implement genuinely-missing features (Track 2)

Write T-Lisp commands for the ~10 missing keys, each with a binding and a new unit test file. These need actual logic (toggle case, viewport scroll, number parsing).

### Phase 3: tmax-use e2e playbooks (Track 3)

Author 3 playbooks that drive every implemented key through the real daemon/client stack with `expect` assertions.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Audit + document the exact gap (Track 1 prep)

- Read `src/tlisp/core/bindings/normal.tlisp` and list every key currently bound.
- For each feature in Track 1 (marks, macros, replace-char, replace-mode, repeat, search-next/prev, indent, gg, gi, jumplist), find the exact T-Lisp function name and signature by reading the corresponding command file.
- Verify the function is exposed in the T-Lisp environment (grep `tlisp-api.ts` or `stdlib.ts` for the API it depends on).
- If a function exists but is named differently than the vim convention expects, note the actual name for the binding (e.g., if it's `(go-to-first-line)` not `(vim-gg)`, use the actual name).
- If a Track 1 feature is NOT actually implemented (command file exists but the function is a stub or missing), move it to Track 2.

### Step 2: Bind Track 1 features

- In `src/tlisp/core/bindings/normal.tlisp`, add bindings for each Track 1 key:
  - `r` → single-char replace (two-key: `r` then the replacement char). Wire to the existing replace-char operator.
  - `R` → replace mode entry. Wire to `(editor-set-mode "replace")` or the existing vim-replace entry.
  - `gg` → go to first line (vim-count-aware: `5gg` goes to line 5).
  - `gi` → go to last insert position and enter insert mode.
  - `n` → search next (forward).
  - `N` → search previous (backward).
  - `>` → indent-right operator prefix (`>>` indents current line).
  - `<` → indent-left operator prefix (`<<` dedents current line).
  - `m` → set-mark prefix (two-key: `m` then mark char `a-z`).
  - `` ` `` → jump-to-mark prefix (two-key: `` ` `` then mark char).
  - `q` → macro-record prefix (two-key: `q` then register `a-z`).
  - `@` → macro-play prefix (two-key: `@` then register `a-z`).
  - `.` → repeat last change.
  - `C-o` → jumplist back.
  - `C-i` → jumplist forward.
- Multi-key sequences (prefix keys like `g`, `m`, `` ` ``, `q`, `@`, `>`, `<`) require the existing prefix-key dispatch mechanism — check how `SPC` and `C-x` prefixes work and match that pattern.

### Step 3: Extend Track 1 unit tests with keypress verification

- For each Track 1 feature, extend the existing unit test file to add at least 2 tests that send the real keypress sequence and assert on end state:
  - **Marks:** `press(editor, "ma")` then move, then `press(editor, "`a")` → assert cursor returns to marked position.
  - **Macros:** `press(editor, "qa")` → record → `press(editor, "q")` → stop → `press(editor, "@a")` → assert replay.
  - **Replace-char:** `press(editor, "rX")` → assert char under cursor changed to X, cursor didn't move.
  - **Replace-mode:** `press(editor, "R")` → assert mode is replace → type chars → assert overwrite behavior.
  - **Repeat:** make a change (`press(editor, "x")`) → `press(editor, ".")` → assert the change repeated.
  - **Search-next:** search for a word → `press(editor, "n")` → assert cursor at next match.
  - **Indent:** `press(editor, ">>")` → assert current line indented; `press(editor, "<<")` → assert dedented.
  - **gg/gi:** `press(editor, "gg")` → assert cursor at line 0; `press(editor, "5gg")` → assert line 4.
  - **Jumplist:** make a jump → `press(editor, "C-o")` → assert cursor at prior position; `press(editor, "C-i")` → forward.
- Every test must use the real `editor.handleKey()` path (the `press()` helper pattern from existing tests), not `(executeTlisp)`.

### Step 4: Implement Track 2 features — toggle-case (`~`)

- In `src/tlisp/core/commands/edit-commands.tlisp`, add `(toggle-case)`:
  - Get the char under cursor.
  - If uppercase → lowercase it; if lowercase → uppercase it; else leave unchanged.
  - Replace the char in the buffer.
  - Advance cursor by one column (vim behavior).
- Bind `"~"` in `normal.tlisp`.
- Create `test/unit/vim-toggle-case.test.ts`:
  - lowercase → uppercase, uppercase → lowercase, non-alpha unchanged.
  - cursor advances after toggle.
  - count-prefix: `3~` toggles 3 chars.
  - undo round-trip.

### Step 5: Implement Track 2 — scroll-to-cursor (`zt`/`zz`/`zb`/`z.`)

- Check `src/editor/api/` for an existing viewport-scroll API (viewport-top-set, viewport-left-set are used elsewhere).
- In `src/tlisp/core/commands/motions.tlisp`, add:
  - `(scroll-cursor-top)` — set viewport so cursor line is at the top of the screen.
  - `(scroll-cursor-center)` — set viewport so cursor line is centered.
  - `(scroll-cursor-bottom)` — set viewport so cursor line is at the bottom.
- Bind `"zt"`, `"zz"`, `"zb"` (prefix `z` dispatch). Optionally `"z."` (center + cursor to first non-blank).
- Create `test/unit/vim-scroll-cursor.test.ts`:
  - Each scroll command on a tall file (> viewport height lines) verifies the viewport-top changed correctly.
  - `zt` → cursor line is viewport-top; `zz` → cursor line is viewport-top + height/2; `zb` → cursor line is viewport-top + height - 1.

### Step 6: Implement Track 2 — window-position jumps (`H`/`M`/`L`)

- In `src/tlisp/core/commands/motions.tlisp`, add:
  - `(window-jump-top)` — move cursor to the first visible line (viewport-top).
  - `(window-jump-middle)` — move cursor to the middle visible line.
  - `(window-jump-bottom)` — move cursor to the last visible line.
- Bind `"H"`, `"M"`, `"L"`.
- Create `test/unit/vim-window-jumps.test.ts`:
  - On a file taller than the viewport, after scrolling, `H`/`M`/`L` land on the correct visible line.

### Step 7: Implement Track 2 — increment/decrement number (`C-a`/`C-x`)

- In `src/tlisp/core/commands/edit-commands.tlisp`, add:
  - `(increment-number [count])` — find the number under or after the cursor on the current line, parse it (decimal), add count (default 1), replace it in the buffer.
  - `(decrement-number [count])` — same, subtract count.
  - Vim semantics: searches forward on the line for the next number if cursor isn't on one. Handles negative numbers. Cursor lands on the last digit of the new number.
- Bind `"C-a"`, `"C-x"`.
- Create `test/unit/vim-increment-number.test.ts`:
  - cursor on `42` → `C-a` → `43`; `C-x` → `41`; `5C-a` → `47`.
  - cursor before a number → searches forward.
  - negative number handling.
  - no number on line → no-op (or error, match vim).
  - undo round-trip.

### Step 8: The comprehensive bindings smoke test

- Create `test/unit/vim-bindings-smoke.test.ts`:
  - Iterate over every key bound in `normal.tlisp` (parse the file or hardcode the list).
  - For each key, set up a small buffer, send the key (or key sequence for prefixes), and assert: no exception thrown, editor remains in a valid state (mode is one of the known modes, cursor is within buffer bounds).
  - This is the regression safety net — if any binding breaks, this test catches it even if the feature-specific test was removed.

### Step 9: tmax-use e2e playbook — motions (`vim-parity-motions.yaml`)

- Create `tmax-use/playbooks/vim-parity-motions.yaml`:
  - Setup: a 10-line file with known content (numbers, words, parens).
  - Steps drive: `h`/`j`/`k`/`l`, `w`/`b`/`e`, `0`/`$`/`_`, `gg`/`G`, `f`/`F`/`t`/`T`, `%`, `{`/`}`, `H`/`M`/`L`, `C-o`/`C-i`.
  - Each step has `expect: { cursor_line: N, cursor_column: M }` assertions.
  - Uses `keys:` for real keypresses (not `eval:`) so the binding path is exercised.

### Step 10: tmax-use e2e playbook — edit operations (`vim-parity-edit.yaml`)

- Create `tmax-use/playbooks/vim-parity-edit.yaml`:
  - Setup: a file with text and numbers.
  - Steps drive: `x`, `dd`, `cc`, `yy`, `p`, `r{char}`, `R`, `~`, `>>`, `<<`, `J`, `C-a`, `C-x`, `.`.
  - Each step asserts on `buffer_contains:` or `line_text:`.

### Step 11: tmax-use e2e playbook — advanced (`vim-parity-advanced.yaml`)

- Create `tmax-use/playbooks/vim-parity-advanced.yaml`:
  - Marks: `ma`, move, `` `a `` → assert cursor back.
  - Macros: `qa`, record edits, `q`, `@a` → assert replay.
  - Search: `*`, `n`, `N`, `#` → assert cursor at matches.
  - Scroll: `zt`, `zz`, `zb` → assert viewport state (via `screen_contains:` if viewport isn't directly assertable).
  - Visual: `v` + motion + `d`; `V` + motion + `y`; `C-v` + block + `d`.

### Step 12: SPECS_INDEX + Validation

- Add SPEC-067 to `docs/specs/SPECS_INDEX.md`.
- Mark SPEC-044 as superseded by SPEC-067 (add a one-line note at the top of SPEC-044: "Superseded by SPEC-067 — kept as a historical roadmap.").
- Run every Validation Command. All must pass.

## Testing Strategy

### Unit Tests

Every key bound or implemented gets a unit test in `test/unit/`:

**Track 1 (bindings for existing features):** extend the existing test file (marks, macros, repeat, replace-mode, indent-ops, jumplist, search-navigation) with keypress-based tests that verify the binding path works — not just the eval path.

**Track 2 (new features):** new test files (vim-toggle-case, vim-scroll-cursor, vim-window-jumps, vim-increment-number, vim-gg-gi, vim-search-next-prev). Each test:
- Sets up a real Editor via `createStartedEditor()`.
- Sends keys via `editor.handleKey()` (the `press()` helper).
- Asserts on buffer text (`bufferText()`), cursor position (`cursor-line`/`cursor-column`), and mode.
- Includes count-prefix tests (`3~`, `5C-a`, `2dd`).
- Includes undo round-trips.

**Comprehensive smoke:** `vim-bindings-smoke.test.ts` sends every bound key and asserts no crash + valid state. The regression-catch-all.

### Integration Tests (tmax-use e2e)

Three playbooks in `tmax-use/playbooks/`:

- **`vim-parity-motions.yaml`** — all motion keys (h/j/k/l, w/b/e, 0/$/_, gg/G, f/F/t/T, %, {/}, H/M/L, C-o/C-i). Asserts `cursor_line` + `cursor_column` after each.
- **`vim-parity-edit.yaml`** — all edit keys (x, dd, cc, yy, p, r, R, ~, >>, <<, J, C-a, C-x, .). Asserts `buffer_contains` / `line_text`.
- **`vim-parity-advanced.yaml`** — marks, macros, search, scroll, visual. Asserts `cursor_line`, `buffer_contains`, `screen_contains`.

Each playbook uses `keys:` (not `eval:`) so the binding → dispatch → command path is exercised end-to-end through the real daemon/client stack.

### Edge Cases

- **Prefix-key timeout:** `g` with no follow-up key — should time out or cancel, not hang.
- **Count-prefix + new keys:** `5gg`, `3~`, `2C-a` — counts must propagate.
- **Empty buffer:** every key on an empty buffer — no crash, valid state.
- **Last line / last column:** motions and edits at buffer boundaries.
- **`~` on non-alpha char:** no-op, cursor still advances.
- **`C-a` on a line with no number:** no-op or error (match vim — vim does nothing).
- **`C-a` on negative number:** `-5` → `C-a` → `-4` (increment toward zero).
- **Visual mode + new operators:** `v` + `~` (toggle case of selection), `V` + `>>` (indent selection).
- **Replace mode at end of line:** `R` then typing past the line end — extends the line.
- **Marks across buffers:** `ma` in buffer A, switch to buffer B, `` `a `` — should jump back to A at the mark (if cross-buffer marks are supported; if not, document the limitation).
- **Macro replay with count:** `3@a` replays macro `a` three times.

## Acceptance Criteria

1. **Every Track 1 key is bound:** `r`, `R`, `gg`, `gi`, `n`, `N`, `>`, `<`, `m`, `` ` ``, `q`, `@`, `.`, `C-o`, `C-i` are all bound in `normal.tlisp` and reachable via real keypresses (not just eval). Verified by keypress-based unit tests.
2. **Every Track 2 feature is implemented + bound:** `~` (toggle-case), `zt`/`zz`/`zb`/`z.` (scroll-cursor), `H`/`M`/`L` (window-jumps), `C-a`/`C-x` (increment/decrement). Each has a new T-Lisp command, a binding, and a unit test file.
3. **Count-prefix works on all new keys:** `5gg` → line 5; `3~` → toggle 3 chars; `5C-a` → add 5; `2>>` → indent 2 lines. Verified by unit tests.
4. **Every implemented key has a unit test:** no key is bound without a test that sends the real keypress and asserts on end state. The comprehensive `vim-bindings-smoke.test.ts` covers every key in `normal.tlisp` as a regression net.
5. **3 tmax-use e2e playbooks exist and pass:** `vim-parity-motions.yaml`, `vim-parity-edit.yaml`, `vim-parity-advanced.yaml`. Each uses `keys:` (not `eval:`) and has `expect` assertions on every step.
6. **No regressions:** `bun run test:unit` passes with all existing tests + the new ones. `bun run test:tmax-use` passes including the 3 new playbooks.
7. **Typecheck/build pass:** `bun run typecheck:src`, `bun run typecheck:test`, `bun run typecheck`, `bun run build` all exit 0.
8. **SPEC-044 marked superseded:** a one-line note at the top of SPEC-044 points to SPEC-067.
9. **No Python testing references:** the spec and its tests use tmax-use exclusively (per ADR-0102). No `test:ui`, `run_python_suite`, `tmax_harness`, or `uv run pytest` references anywhere in the new code or tests.

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bun run typecheck:src` — Source typecheck, zero errors.
- `bun run typecheck:test` — Test typecheck, zero errors.
- `bun run typecheck` — Full project typecheck, zero errors.
- `bun run build` — Build succeeds.
- `bun test test/unit/vim-toggle-case.test.ts test/unit/vim-scroll-cursor.test.ts test/unit/vim-window-jumps.test.ts test/unit/vim-increment-number.test.ts test/unit/vim-gg-gi.test.ts test/unit/vim-search-next-prev.test.ts test/unit/vim-bindings-smoke.test.ts` — All new Track 2 + smoke tests pass.
- `bun test test/unit/marks.test.ts test/unit/macros.test.ts test/unit/repeat-change.test.ts test/unit/replace-mode.test.ts test/unit/indent-ops.test.ts test/unit/jumplist.test.ts test/unit/search-navigation.test.ts` — Extended Track 1 tests pass (including the new keypress-based assertions).
- `bun run test:unit` — Full unit suite passes, no regressions.
- `bun run test:tmax-use` — tmax-use e2e suite passes, including the 3 new playbooks (`vim-parity-motions`, `vim-parity-edit`, `vim-parity-advanced`).
- `bin/tmax-use test tmax-use/playbooks/vim-parity-motions.yaml tmax-use/playbooks/vim-parity-edit.yaml tmax-use/playbooks/vim-parity-advanced.yaml` — Run the 3 new playbooks directly.

## Notes

- **This spec replaces SPEC-044.** SPEC-044 was a retrospective roadmap/audit document that spec-review correctly rejected as non-implementable ("not a clean implementation spec ... stale repository assumptions ... cites removed validation infrastructure"). SPEC-044 is kept as a historical document with a "superseded by SPEC-067" note; SPEC-067 is the forward-looking implementation spec.
- **No Python testing.** Per ADR-0102, the Python UI harness is gone. All e2e testing is tmax-use + playbooks. The spec explicitly requires `keys:`-based playbook steps (not `eval:`) so the full binding → dispatch → command → daemon path is exercised.
- **Track 1 is mostly binding work, not logic.** The T-Lisp command files (marks.tlisp, macros.tlisp, repeat.tlisp, vim-replace.tlisp, indent-ops.tlisp, jumplist.tlisp) already exist with passing unit tests — but those tests call the command via `(executeTlisp)`, not via real keypresses. Track 1 adds the bindings AND extends the tests to verify the binding path. This catches the "feature works via eval but not via keypress" gap that the old SPEC-044 missed.
- **Prefix-key dispatch.** Several vim keys are prefixes: `g` (gg, gi, g_, g~, etc.), `z` (zt, zz, zb, z.), `m` (ma, mb, ...), `` ` `` (`` `a ``, `` `b `` ...), `q` (qa, qb, ...), `@` (@a, @b, ...), `>` (>>), `<` (<<). The existing prefix mechanism (used by `SPC`, `C-x`, `C-h`) must handle these. Check `editor.ts`'s `handleKey` / `vim-dispatch.tlisp` for the prefix dispatch pattern and match it.
- **Viewport API for scroll commands.** `zt`/`zz`/`zb` need viewport control. Check `src/editor/api/` — `viewport-top-set` and `viewport-left-set` are already used (see the `0` binding). The scroll commands compose these with the cursor's line and the viewport height.
- **Number parsing for C-a/C-x.** Vim's `C-a` finds the next number on the current line (searching forward from cursor), parses it as decimal (including negative), increments, and replaces. The cursor lands on the last digit. This needs a T-Lisp primitive or composition of existing buffer-text + string primitives. Keep it simple — decimal only (vim also supports hex/octal via `nrformats`, but that's out of scope for this spec).
- **The smoke test is the safety net.** `vim-bindings-smoke.test.ts` sends every key in `normal.tlisp` and asserts no crash + valid state. It's deliberately coarse (no feature-specific assertions — those live in the feature tests). Its value is catching regressions: if a binding is accidentally removed or a command starts throwing, the smoke test fails even if the specific feature test was deleted.
- **Test thoroughness requirement.** "All implemented vim keys must be tested thoroughly" means: every key gets at least 2 keypress-based unit tests (basic case + edge case), a count-prefix test where applicable, an undo round-trip, and inclusion in a tmax-use playbook. The smoke test is additive — it doesn't replace the feature-specific tests.
- **Out of scope:** hex/octal number formats for `C-a`/`C-x`, `g~`/`gU`/`gu` (case operators on motions), `=` (auto-format), tags (`C-]`/`C-t`), spell-check, folding (`zf`/`zd`/`za`), command-line window (`q:`), complex registers (`"ay`, `"ap`). These are vim features too, but this spec focuses on the core daily-driver keys. A follow-up spec can cover them.
