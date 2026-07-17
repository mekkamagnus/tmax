# Feature: Vim Operator × Motion Composition Parity

## Feature Description

This spec closes the largest remaining vim-parity gap in tmax: **operators (`d`/`c`/`y`) do not compose with arbitrary motions.** Today `vim-operator-apply` (in `src/tlisp/core/commands/operators.tlisp`) is a hardcoded combo *allowlist* — pressing `d` followed by any motion not in `{d,w,l,$,G,gg}` (plus `f/t/F/T` and `d/c`-text-objects) returns `"Unsupported operator: <combo>"`. In real vim, `d{any-motion}` works universally.

Concretely, these daily-driver combos **fail today** and will work after this spec:

- **Back-word / end-of-word:** `db de dW dB dE` (and `cb ce cW cB cE`, `yb ye yW yB yE`)
- **Line motions:** `dj dk` (linewise — delete/change/yank current + next/prev line)
- **Column motions:** `d0 d^ d_` (and `c`/`y` variants; `d$`/`c$`/`y$` already work)
- **Paragraph:** `d{ d}` (and `c`/`y` variants)
- **Bracket match:** `d%` (and `c%`/`y%`)
- **Yank to last/first line:** `yG ygg cG cgg` (`dG`/`dgg` already work)
- **Yank + text objects:** `yiw yaw yi" yi' ya) ya{ ya[ ya< yit` — currently `y` has **zero** text-object branches (only `d`/`c` do)
- **Substitute:** `s` (substitute char = `cl`) and `S` (substitute line = `cc`) are **not bound at all**
- **Visual text objects:** `viw vaw vi" va(` — `i`/`a` are unbound in visual mode, so selection cannot be grown to a text object

This spec is the direct follow-up to [SPEC-067](SPEC-067-vim-parity-implementation.md). SPEC-067 bound every core *single* normal-mode key; SPEC-069 fixes the *composition* layer that sits on top of those keys, which SPEC-067's line 307 explicitly deferred (text objects on `y`, `g~`/`gu`/`gU` on motions). It implements the fix recommended at the end of the SPEC-067 audit: **make `vim-operator-apply` fall back to "run the motion, operate on the resulting region" instead of an allowlist**, unify `y`-text-objects with `d`/`c` in one stroke, and add the cheap missing keys (`s`/`S`, visual text-objects).

## User Story

As a **vim user running tmax as my daily editor**
I want to **use any operator (`d`/`c`/`y`) with any motion or text object the way vim allows**
So that **`db`, `de`, `dj`, `yiw`, `yi"`, `s`, and `viw` work from muscle memory instead of throwing "Unsupported operator" or doing nothing.**

## Problem Statement

`vim-operator-apply` (operators.tlisp:298-326) is structured as:

```lisp
(cond
  ((string= combo "dd") ...) ((string= combo "dw") ...) ... 12 explicit branches ...
  (t (editor-set-status (concat "Unsupported operator: " combo))))
```

This means tmax hardcodes the ~12 operator+motion combos it supports and rejects everything else. The consequences:

1. **Yank text-objects are entirely missing.** The text-object dispatch (`vim-operator-apply-text-object`, operators.tlisp:170-221) has branches for `diw daw ciw caw di' da' di" da" di) da) di} da} di] da] di< da< dit dat` and all `c` variants — but **no `y` branches**. `y` only works with the four motion combos `yy yw yl y$`. So `yiw` (yank inner word — one of the most common vim commands) does nothing useful.

2. **Common operator+motion combos fail.** `de`, `db`, `dW`, `dj`, `dk`, `d0`, `d%`, `d}`, and all `c`/`y` counterparts hit the `"Unsupported operator"` branch. A user reaching for `de` (delete to end of word) or `dj` (delete two lines) is blocked.

3. **`s`/`S` are unbound.** `s` (substitute char) and `S` (substitute line) are basic vim keys with no binding.

4. **Visual mode can't select text objects.** `i`/`a` are unbound in visual mode, so `viw` (select inner word), `vaw`, `vi"` etc. don't work — the user must expand the selection manually.

The root cause is architectural: the codebase treats each operator+motion combo as a special case instead of implementing vim's actual model — **an operator applied to the text region a motion describes**.

## Solution Statement

Three phases, each independently shippable and testable:

**Phase 1 — General operator × motion (the core fix).** Add `vim-operator-apply-motion`, a generic dispatcher that, given a pending operator and a motion key: (a) captures the cursor start position, (b) runs the motion primitive with the composed count, (c) captures the end position, (d) classifies the motion as **char-wise exclusive**, **char-wise inclusive**, or **linewise**, (e) computes the resulting buffer region, and (f) applies `d`/`y`/`c` generically — mirroring the *existing* `vim-operator-apply-find` pattern (operators.tlisp:109-148), which already does exactly this for `df`/`dt`/`dF`/`dT` and their `y`/`c` variants. Wire it as the `t` (fallback) branch of `vim-operator-apply`, replacing `"Unsupported operator"`. **Keep all existing explicit branches** (`dd dw dl d$ dG dgg yy yw yl y$ cc cw cl c$`) unchanged as the fast path — they encode correct special semantics (notably `dw`/`cw` trailing-whitespace handling) and stay green. The fallback closes every other combo for all three operators.

**Phase 2 — Yank text-objects.** Refactor `vim-operator-apply-text-object` so each text object (word + each delimiter + tag) computes its region once via a shared helper, then applies `d`/`y`/`c` generically through the same region-apply used in Phase 1. This adds the entire `y`-text-object family (`yiw yaw yi" ya) ...`) for free, removes the `d`/`c` duplication (each delimiter currently has separate `delete-inner-X`/`change-inner-X` functions computing the same region), and leaves existing `diw`/`cit`/etc. behavior byte-identical.

**Phase 3 — Cheap missing keys.** Bind `s` and `S` in normal mode, and bind `i`/`a` in visual mode to grow the selection to a text object (reusing the Phase 2 region helper).

All work is T-Lisp only. **No new TypeScript primitive is required** and no new dependency is added: Phase 1 captures cursor positions via the existing `cursor-line`/`cursor-column` primitives and runs existing motion primitives (`word-next`, `word-end`, `word-next-WORD`, `word-previous`, `line-first-non-blank`, `vim-match-bracket`, `paragraph-next`/`-previous`, `cursor-move`); Phases 2-3 reuse the same region-apply. This follows the project rule that T-Lisp owns all editor logic and TypeScript only provides raw primitives.

## Relevant Files

Use these files to implement the feature:

### Existing Files to Modify

- **`src/tlisp/core/commands/operators.tlisp`** — The central file. (1) Add `vim-apply-region` (generic d/y/c over a `(start-line start-col end-line end-col wise)` region), `vim-motion-region` (capture start, run motion, capture end, classify + normalize), and the motion classification table (char-exclusive / char-inclusive / linewise). (2) Wire `vim-operator-apply-motion` as the `t` fallback in `vim-operator-apply` (operators.tlisp:298-326), replacing the `"Unsupported operator"` status. (3) Refactor `vim-operator-apply-text-object` (operators.tlisp:170-221) to compute each region once and dispatch through `vim-apply-region`, adding the `y` family. Export the new helpers so Phase 3 and tests can reach them.
- **`src/tlisp/core/commands/edit-commands.tlisp`** — Locate (or add) the `delete-inner-word` / `change-inner-word` / `delete-inner-paren` / … region logic that Phase 2 extracts into shared region helpers (`text-object-region`). If these functions live in another file (they are referenced by operators.tlisp but not defined there — find the `defun`s), modify them in place to delegate to the new region helper.
- **`src/tlisp/core/bindings/normal.tlisp`** — Bind `s` (substitute char) and `S` (substitute line). `s` → `(progn (vim-delete-char (vim-count-consume 1)) (editor-set-mode "insert"))`; `S` → `(vim-change-line-range (vim-count-consume 1))` (same as `cc`).
- **`src/tlisp/core/bindings/visual.tlisp`** — Bind `i` and `a` to enter visual text-object selection: `(visual-begin-text-object "i")` / `(visual-begin-text-object "a")`, reusing the Phase 2 `text-object-region` helper to set the selection.
- **`src/tlisp/core/commands/vim-dispatch.tlisp`** — Only if the visual text-object pending state needs a new dispatch route (mirror how `vim-dispatch-text-object` routes the class key for operators). Read to confirm; modify only if needed.

### Existing Files to Read (patterns to follow, not modify)

- **`src/tlisp/core/commands/operators.tlisp:109-148`** (`vim-operator-apply-find`) — **The template for the generic region-apply.** It already computes `low`/`high` columns then branches `d` → `buffer-delete-range` + `set-register`, `y` → `buffer-get-range` + `set-register`, `c` → `buffer-replace-range` + `cursor-move` + `editor-set-mode "insert"`. Phase 1 generalizes this from "single-line find columns" to "arbitrary (possibly multiline, possibly linewise) region."
- **`src/editor/api/word-ops.ts`** (`word-next`, `word-previous`, `word-end`, `word-next-WORD`, `word-previous-WORD`, `word-end-WORD`, `word-previous-end`) and **`src/editor/api/line-ops.ts`** (`line-first-column`, `line-last-column`, `line-first-non-blank`) — The motion primitives Phase 1 invokes. Each moves the cursor and takes a count; confirm signatures before writing the dispatch table.
- **`src/editor/api/buffer-ops.ts`** (`buffer-get-range`, `buffer-delete-range`) and **`src/editor/api/replace-ops.ts`** (`buffer-replace-range`) — The region primitives `vim-apply-region` composes. All take `(start-line start-col end-line end-col …)`.
- **`src/tlisp/core/commands/motions.tlisp`** — `vim-match-bracket` (for `d%`), `paragraph-next`/`paragraph-previous` (for `d}`/`d{`), `vim-G`/`vim-gg` signatures (linewise fallback for `yG`/`cG`/`ygg`/`cgg`).
- **`src/tlisp/core/commands/operators.tlisp:282-296`** (`vim-change-line-range`) and **`:270-280`** (`vim-delete-to-last-line`/`-first-line`) — The linewise patterns `vim-apply-region` reuses for linewise motions (`j`/`k`/`{`/`}`/`G`/`gg`).

### New Files

- **`test/unit/vim-operator-motion.test.ts`** — Operator × motion combos via real keypresses: `db de dW dB dE dj dk d0 d^ d_ d{ d} d% yG ygg cG` and the `c`/`y` counterparts of each; counts (`2db`, `d2e`, `3dj`); undo round-trips; inclusivity assertions (`de` includes the end char, `db` does not, `dj` is linewise).
- **`test/unit/vim-yank-text-objects.test.ts`** — `yiw yaw yi" yi' ya) ya{ ya[ ya< yit` via real keypresses: register `"` receives the right text, the buffer is unchanged, and the cursor lands at the region start (vim yank semantics). Includes count (`y3iw`) and undo (no-op for `y`).
- **`test/unit/vim-substitute.test.ts`** — `s` (delete char + insert), `3s` (three chars), `S` (clear line + insert = `cc`), undo round-trips.
- **`test/unit/vim-visual-text-objects.test.ts`** — `viw vaw vi" va(` select the correct region (assert selection start/end or the result of `d`/`y` on it), and `viw` growth from mid-word.
- **`tmax-use/playbooks/vim-operator-motion.yaml`** — E2e playbook driving `de db dj d% yiw yi" s` and a count combo through the real daemon/client stack, with `expect` on every step (`buffer_contains`, `cursor_line`/`cursor_column`, `mode`).

### Existing Files to Extend

- **`test/unit/vim-bindings-smoke.test.ts`** — Add `s`, `S`, and a representative new operator+motion combo to the smoke net so future regressions are caught.
- **`docs/specs/SPECS_INDEX.md`** (or `docs/specs/index.md`) — Add SPEC-069 to the index, noting it builds on SPEC-067.

## Implementation Plan

### Phase 1: Foundation — generic operator × motion

Build the region-apply primitive and the motion classifier, wire them as the fallback in `vim-operator-apply`. This is the highest-leverage change: it closes the majority of missing combos (`db/de/dW/dj/dk/d0/d}/d%/…` and all `c`/`y` counterparts) without touching any working explicit branch.

### Phase 2: Core — unify yank text-objects

Extract shared region helpers from the existing `delete-inner-X`/`change-inner-X` functions, route the text-object dispatch through `vim-apply-region`, and add the `y` family. Behavior for existing `d`/`c` text-objects must stay identical (verified by the existing tests staying green).

### Phase 3: Integration — `s`/`S` and visual text-objects

Bind the two missing normal-mode keys and the two missing visual-mode text-object prefixes, reusing Phase 2's region helper. Add tmax-use e2e coverage across all three phases.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Confirm motion primitive signatures and inclusivity rules

- Read `src/editor/api/word-ops.ts` and `src/editor/api/line-ops.ts`; record each motion primitive's exact arg list and whether it takes a count.
- Read `src/tlisp/core/commands/motions.tlisp` for `vim-match-bracket`, `paragraph-next`, `paragraph-previous`, `vim-G`, `vim-gg` signatures.
- Decide and document the motion classification table (this is the design core). For each motion the fallback must support, record `{primitive call with total-count, wise: char|line, inclusive: bool}`:
  - **char-exclusive:** `h` `(cursor-move … -count)`, `l` (covered by explicit `dl`, but include for completeness), `w` `(word-next count)` (explicit `dw` takes precedence; fallback covers `yw`? — `yw` is explicit, so not needed; but include for `c`? `cw` explicit — leave to explicit), `b` `(word-previous count)`, `W` `(word-next-WORD count)`, `B` `(word-previous-WORD count)`, `0` `(line-first-column)`, `^`/`_` `(line-first-non-blank)`.
  - **char-inclusive:** `e` `(word-end count)`, `E` `(word-end-WORD count)`, `%` `(vim-match-bracket)`, `$` `(line-last-column)` (explicit `d$`/`c$`/`y$` take precedence).
  - **linewise:** `j` `(cursor-move (+ line count) col)`, `k` `(cursor-move (- line count) col)`, `{` `(paragraph-previous)`, `}` `(paragraph-next)`, `G` `(vim-G [count])`, `gg` `(vim-gg [count])` (explicit `dG`/`dgg` take precedence; fallback covers `yG cG ygg cgg`).
- Verify the inclusivity model against vim: exclusive = the landing char is NOT in the region; inclusive = it IS; linewise = whole lines `[start-line, end-line]`. Note the backward-motion normalization: for `db` the cursor moves backward, so the region is `[landing-col, start-col)` exclusive of start (cursor's original char stays) — capture before/after and normalize to `(min, max)` then apply the inclusivity rule to the correct edge.

### Step 2: Implement `vim-apply-region` (generic d/y/c over a region)

- In `operators.tlisp`, add `(vim-apply-region operator start-line start-col end-line end-col wise)`:
  - Normalize the region so start ≤ end (swap if needed). For `wise = "line"`, snap columns to `[0 … line-length]` spanning whole lines.
  - `(if (string= operator "y") nil (undo-begin))`.
  - `d`: `(set-register "\"" (buffer-get-range …))` then `(buffer-delete-range …)`; linewise uses the existing `vim-delete-line-range` style (include the trailing newline in the register).
  - `y`: `(set-register "\"" (buffer-get-range …))` — **no buffer mutation**; leave cursor at the region start (vim: yank returns cursor to start of yanked text).
  - `c`: `(set-register "\"" (buffer-get-range …))`, `(buffer-replace-range … "")` (or for linewise, collapse to one empty line), `(cursor-move start-line start-col)`, `(editor-set-mode "insert")`.
  - `(if (string= operator "y") nil (undo-commit "motion"))`, then `(vim-maybe-apply-register)`.
- Mirror `vim-operator-apply-find` (operators.tlisp:131-147) closely — it is the proven template, just single-line. Multiline handling and the `wise` parameter are the only additions.

### Step 3: Implement `vim-motion-region` + motion classification table

- Add `(vim-motion-region motion-key count)`:
  - Capture `(start-line (cursor-line))` and `(start-col (cursor-column))`.
  - Dispatch on `motion-key` to run the right primitive with `count` (the table from Step 1).
  - Capture `(end-line (cursor-line))` and `(end-col (cursor-column))`.
  - Look up `wise` and `inclusive` for `motion-key`.
  - For char-wise: adjust the end edge by inclusivity (inclusive → include `end-col`; exclusive → region ends at `end-col`, i.e. delete up to but not including the landing char for forward motions; for backward motions the excluded edge is `start-col`). Normalize ordering.
  - Return `(start-line start-col end-line end-col wise)` (a list or multiple values — match whatever the codebase prefers; see how `find-char-position` returns data).
- Add the classification table as a `cond` inside `vim-motion-region` (one row per supported motion key with its primitive call + `wise` + `inclusive`).

### Step 4: Wire the fallback into `vim-operator-apply`

- In `vim-operator-apply` (operators.tlisp:298-326), keep all existing explicit `cond` branches (`dd dw dl d$ dG dgg yy yw yl y$ cc cw cl c$`) **unchanged and first**.
- Replace the `(t (editor-set-status (concat "Unsupported operator: " combo)))` branch with: if `motion` is in the classification table, call `(vim-motion-region motion total-count)` → `vim-apply-region operator …`; otherwise keep the "Unsupported" status for genuinely-unknown motions.
- `total-count` already exists via `(vim-operator-total-count)` (the product of the pre-operator count and any digits typed between operator and motion).
- `gg` is two keystrokes; the operator-pending `g` prefix is already handled by `vim-operator-g-pending` (operators.tlisp:330-348) which calls `(vim-operator-apply "gg")` — so `gg` reaches the fallback as motion `"gg"`. Add `gg` to the classification table (linewise, primitive `(vim-gg)` with count).

### Step 5: Phase 1 unit tests — operator × motion

- Create `test/unit/vim-operator-motion.test.ts` using the `createStartedEditor()` + `press()` pattern from existing tests (real `editor.handleKey` path). Cases (each for `d`, and a representative subset for `c` and `y`):
  - `de` on `"aa bb cc"` from col 0 → deletes `"aa"` inclusive of the `a` at col 1 (buffer becomes `" bb cc"` or `"a bb cc"` per vim `de` — assert the exact vim-correct result; `de` is inclusive so `"aa"` is removed leaving `" bb cc"`).
  - `db` from col 3 on `"aa bb cc"` → deletes back to col 0 exclusive → `"bb cc"`.
  - `dW`, `dB`, `dE` on punctuation clusters.
  - `dj` from line 0 → deletes lines 0 and 1 (linewise). `dk` from line 2 → deletes lines 1 and 2.
  - `d0` and `d^`/`d_` from mid-line.
  - `d%` on a line with `(...)` → deletes through the matching paren (inclusive).
  - `d}` / `d{` over a paragraph gap.
  - `yG`, `cG`, `ygg`, `cgg` (the explicit path only covers `dG`/`dgg`).
  - Count composition: `2db`, `d2e`, `3dj`, `y3G`.
  - Undo round-trip for each mutating op; `y` is a no-op on the buffer.
  - Inclusivity spot-checks: `de` includes end char, `dw` (explicit) does not, `dj` is linewise.
- Verify each expected result against real vim first (run the same keys in vim if available, or reason from `:help motion.txt`), so the assertions encode vim-correct semantics, not tmax's current behavior.

### Step 6: Phase 2 — extract text-object region helpers

- Find where `delete-inner-word`, `change-inner-word`, `delete-inner-paren`, … are defined (referenced by operators.tlisp but not defined there — grep `defun delete-inner-word` etc.). Read each pair (`delete-inner-X` / `change-inner-X`) and identify the shared region computation (start/end line+col) they both use.
- Add `(text-object-region class-char inner-or-around count)` → returns `(start-line start-col end-line end-col wise)` for each supported class (`w ' " ( ) { } [ ] < > t`). For word it honors `count` (`d2iw`); for delimiters count is accepted but typically no-op (match vim).
- Rewrite the existing `delete-inner-X`/`change-inner-X` (and `delete-around-X`/`change-around-X`) to delegate: compute region via `text-object-region`, then delete/change. This removes duplication and guarantees the region logic is identical for `d`/`c`/`y`.

### Step 7: Phase 2 — route text-object dispatch through `vim-apply-region` + add `y`

- Rewrite `vim-operator-apply-text-object` (operators.tlisp:170-221): instead of a 30-branch `cond` over combo strings, compute the region once via `text-object-region class-char inner-or-around count`, then call `(vim-apply-region operator … wise)`. The `y` case now works automatically (Phase 1's `vim-apply-region` handles it).
- Preserve the `undo-begin`/`undo-commit` + `vim-record-change` wrapping and the `vim-maybe-apply-register` call exactly as today (operators.tlisp:183, 218-220) so dot-repeat and undo behave identically for existing `d`/`c` combos.
- Create `test/unit/vim-yank-text-objects.test.ts`: `yiw yaw yi" yi' ya) ya{ ya[ ya< yit` — assert register `"` text, buffer unchanged, cursor at region start; `y3iw` count; the existing `diw`/`cit`/`daw` behavior is covered by re-running the pre-existing text-object tests (they must stay green unmodified).

### Step 8: Phase 3 — bind `s` and `S`

- In `src/tlisp/core/bindings/normal.tlisp`:
  - `(key-bind "s" "(progn (vim-delete-char (vim-count-consume 1)) (editor-set-mode \"insert\"))" "normal")` — substitute char; `vim-delete-char` already yanks to `"`.
  - `(key-bind "S" "(vim-change-line-range (vim-count-consume 1))" "normal")` — substitute line (identical to `cc`).
- Confirm `s`/`S` are not already shadowed by another prefix in the normal handler (the SPEC-067 audit confirmed they are unbound).
- Create `test/unit/vim-substitute.test.ts`: `s` deletes one char and enters insert (type a replacement, Esc, assert); `3s` deletes three chars then insert; `S` clears the line content and enters insert (assert == `cc`); undo round-trips.

### Step 9: Phase 3 — visual text-objects

- In `src/tlisp/core/bindings/visual.tlisp`, bind `i` and `a`:
  - `(key-bind "i" "(visual-begin-text-object \"i\")" "visual")`
  - `(key-bind "a" "(visual-begin-text-object \"a\")" "visual")`
- Implement `(visual-begin-text-object inner-or-around)`: it needs the *next* key (the class `w`/`"`/`(`/…). Check how the operator text-object pending state collects its class key (`vim-dispatch-text-object`, operators.tlisp:223+) and mirror it for visual: set a `vim-text-object-pending` flag, route the next key, then compute the region via `text-object-region` (from Step 6) and set the visual selection start/end to that region. Read `src/tlisp/core/commands/vim-dispatch.tlisp` and the visual-mode handler to find where to hook the pending route.
- Create `test/unit/vim-visual-text-objects.test.ts`: `viw` from mid-word selects the whole word; `vaw` includes trailing whitespace; `vi"` inside a string selects inner content; `va(` selects including the parens; then `d`/`y` on the selection behaves correctly.

### Step 10: Extend the smoke test + tmax-use e2e playbook

- Extend `test/unit/vim-bindings-smoke.test.ts` with `s`, `S`, and one representative new combo (e.g. `de`, `yiw`) so the regression net covers the new surface.
- Create `tmax-use/playbooks/vim-operator-motion.yaml`: a small file with words, punctuation, and a paragraph gap; steps drive `de`, `db`, `dj`, `d%`, `yiw`, `yi"`, `s` (with a typed replacement), and one count combo (`2db`), each with `keys:` (not `eval:`) and an `expect` (`buffer_contains` / `line_text` / `cursor_line` / `cursor_column` / `mode`). Every step has an `expect`.

### Step 11: Index + Validation

- Add SPEC-069 to `docs/specs/index.md` (and `SPECS_INDEX.md` if it is the active index), cross-referencing SPEC-067.
- Run every Validation Command. All must pass with zero regressions before the spec is considered done.

## Testing Strategy

### Unit Tests

Every new capability gets keypress-based unit tests on the real `editor.handleKey` path (the `press()` helper used across `test/unit/`), never via raw `(executeTlisp)`:

- **`vim-operator-motion.test.ts`** — every Phase-1 motion for `d`, a representative subset for `c`/`y`, counts, undo, inclusivity.
- **`vim-yank-text-objects.test.ts`** — the full `y` text-object family; register contents, buffer-unchanged, cursor-at-start.
- **`vim-substitute.test.ts`** — `s`, `3s`, `S`, undo.
- **`vim-visual-text-objects.test.ts`** — `viw vaw vi" va(` + operation on the selection.
- **Regression:** the existing text-object tests (whatever covers `diw`/`cit`/`daw`/…) MUST pass unmodified after Phase 2's refactor — that is the proof the refactor preserved behavior.

### Integration Tests (tmax-use e2e)

One playbook, `tmax-use/playbooks/vim-operator-motion.yaml`, drives the new combos through the real daemon/client stack with `keys:` steps and `expect` assertions on every step. This exercises the full binding → operator-pending → motion → region-apply → daemon path, complementing the unit tests (which exercise the synchronous in-process path).

### Edge Cases

- **Backward motions:** `db`, `dB`, `dh`, `c{` — region normalization when the cursor moves left/up; ensure the cursor's original char is excluded correctly per vim exclusive semantics.
- **Inclusivity at boundaries:** `de` at the last char of a word; `dE` over punctuation; `d%` when cursor is on the closing bracket.
- **Motion that doesn't move:** e.g. `d` + a motion that lands on the same cell (e.g. `dl` at a position where `l` is a no-op at EOL) — must be a no-op or single-char, no crash.
- **Count composition:** `2d3w` = delete 6 words (operator count × motion count); `d2j` = 3 lines linewise; `y3G` yanks to line 3.
- **Linewise cursor placement:** after `dj`/`dk`/`dG`, cursor lands on the first non-blank of the remaining line (vim linewise rule).
- **Yank cursor placement:** after every `y{motion}` and `y{text-object}`, cursor returns to the region start (not the motion target).
- **Multiline char-wise:** `d` + a motion that crosses a newline (e.g. `de` when the word ends exactly at EOL and the next char is a newline) — assert the exact vim result.
- **Empty / single-char / single-line buffer:** every new combo must not crash and must leave a valid state (mode known, cursor in bounds).
- **Undo grouping:** each operator application is one undo step (existing `undo-begin`/`undo-commit` discipline preserved); `u` after `de` restores fully. `y` must NOT open an undo group (it does not mutate).
- **Dot-repeat:** `.` after `de` repeats the delete-to-end-of-word; verify `vim-record-change` is still called for the fallback path (it is today for explicit branches).
- **Interaction with explicit branches:** `dw`/`dd`/`cc`/`d$`/`dG`/`dgg` still take the explicit path (not the fallback) — assert their results are unchanged.

## Acceptance Criteria

1. **Every Phase-1 operator × motion combo works for `d`, and the `c`/`y` counterparts for a representative subset:** `db de dW dB dE dj dk d0 d^ d_ d{ d} d%` and the `c`/`y` forms — verified by `vim-operator-motion.test.ts`. The `"Unsupported operator: …"` status no longer appears for any classified motion.
2. **Yank text-objects work:** `yiw yaw yi" yi' ya) ya{ ya[ ya< yit` set the unnamed register to the correct text, leave the buffer unchanged, and land the cursor at the region start — verified by `vim-yank-text-objects.test.ts`.
3. **Existing text-object behavior is unchanged:** the pre-existing `diw`/`daw`/`ciw`/`caw`/`di"`/`cit`/… tests pass unmodified after the Phase-2 refactor (the refactor is behavior-preserving for `d`/`c`).
4. **`s` and `S` are bound and correct:** `s` deletes one char and enters insert; `3s` deletes three; `S` behaves like `cc` — verified by `vim-substitute.test.ts`.
5. **Visual text-objects work:** `viw vaw vi" va(` select the correct region and subsequent `d`/`y` operate on it — verified by `vim-visual-text-objects.test.ts`.
6. **Count composition is correct:** `2db`, `d2e`, `3dj`, `y3iw`, `y3G` behave per vim (operator-count × motion-count) — verified across the new test files.
7. **No regressions in explicit branches:** `dd dw dl d$ dG dgg yy yw yl y$ cc cw cl c$ df{char} dt{char} diw cit` produce byte-identical results to before — verified by the full existing `test:unit` suite passing.
8. **Typecheck/build pass:** `bun run typecheck:src`, `bun run typecheck:test`, `bun run typecheck`, `bun run build` all exit 0.
9. **Full suites green:** `bun run test:unit` and `bun run test:tmax-use` (including the new `vim-operator-motion` playbook) pass.
10. **Index updated:** SPEC-069 is listed in `docs/specs/index.md`, cross-referenced to SPEC-067.
11. **No Python testing references:** all new testing uses tmax-use + bun (per ADR-0102); no `uv run pytest`, `test:ui`, `run_python_suite`, or `tmax_harness` anywhere in the new code or tests.

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bun run typecheck:src` — Source typecheck, zero errors.
- `bun run typecheck:test` — Test typecheck, zero errors.
- `bun run typecheck` — Full project typecheck, zero errors.
- `bun run build` — Build succeeds.
- `bun test test/unit/vim-operator-motion.test.ts test/unit/vim-yank-text-objects.test.ts test/unit/vim-substitute.test.ts test/unit/vim-visual-text-objects.test.ts` — All new unit tests pass.
- `bun test test/unit/vim-bindings-smoke.test.ts` — Extended smoke net passes (new keys covered).
- `bun run test:unit` — Full unit suite passes with **zero regressions** (this is the proof that Phase 2's text-object refactor preserved `d`/`c` behavior and Phase 1's fallback didn't disturb the explicit branches).
- `bun run test:tmax-use` — tmax-use e2e suite passes, including the new `vim-operator-motion` playbook.
- `bin/tmax-use test tmax-use/playbooks/vim-operator-motion.yaml` — Run the new playbook directly through the real daemon/client stack.

## Notes

- **This spec builds on [SPEC-067](SPEC-067-vim-parity-implementation.md), it does not replace it.** SPEC-067 bound every core *single* normal-mode key; SPEC-069 fixes the *composition* layer (operator × motion × text-object) that sits on top. SPEC-067's "Out of scope" (line 307) explicitly listed `g~`/`gU`/`gu` on motions and complex registers — `y` text-objects were not enumerated there but were never implemented (an oversight the SPEC-067 audit caught); SPEC-069 closes that and the broader operator-motion gap.
- **The generic pattern already exists — generalize, don't invent.** `vim-operator-apply-find` (operators.tlisp:109-148) already computes a region and dispatches `d`/`y`/`c` generically. Phase 1 is literally "lift that pattern from single-line-find to arbitrary regions." This keeps the change surgical and idiomatic to the file.
- **Keep the explicit branches.** `dw`/`cw` have famously special trailing-whitespace semantics in vim, and `dd`/`cc`/`yy`/`d$`/`dG`/`dgg` are well-tested. The new generic path is the *fallback*, so these keep their exact current behavior and tests. Do not route them through the new code.
- **No new TypeScript primitive, no new dependency.** Phase 1 captures positions via existing `cursor-line`/`cursor-column` and runs existing motion primitives. This is deliberate: it follows the project rule that T-Lisp owns all editor logic and TS only provides raw primitives (`src/tlisp/CLAUDE.md`). If an implementer finds a motion truly cannot be captured this way, add the smallest possible primitive and document it here — but the design intent is zero new TS surface.
- **Inclusivity is the subtle part.** The motion classification table (Step 1) is the design's load-bearing artifact. Get `de` inclusive / `db` exclusive / `dj` linewise right, and the rest follows. Verify each entry against real vim (`:help motion.txt`) before encoding the assertion, so tests pin vim-correct behavior, not tmax's prior behavior.
- **Dot-repeat (`.`) must keep working.** The explicit branches call `vim-record-change`; the fallback must too (Step 4) so `de` then `.` repeats. The Phase-2 text-object rewrite must preserve the `vim-record-change` call (operators.tlisp:219) for `d`/`c`.
- **Undo grouping.** Mutating operators (`d`/`c`) are wrapped in `undo-begin`/`undo-commit`; `y` is NOT (it doesn't mutate). Preserve this exactly in `vim-apply-region` so `u` after a `de`/`dj`/`yiw` sequence undoes the deletes but treats the yank as a no-op.
- **Optional follow-ups (out of scope here):** `g~`/`gu`/`gU` + motion/object (e.g. `g~iw`) — once `vim-apply-region` and `text-object-region` exist, case-operators-on-motion become a thin addition (a 4th operator branch applying a case transform instead of delete/yank). A future spec can add them by reusing this spec's region machinery. Complex registers (`"ay`/`"ap`) and `gq`/`gw` formatting remain deferred as in SPEC-067.
