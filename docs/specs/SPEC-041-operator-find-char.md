# Feature: Operator + Find-Char Combinations (`df<char>`, `dt<char>`, `dF<char>`, `dT<char>` and `y`/`c` equivalents)

**Depends on:** CHORE-23 (unified keymap dispatch — surfaced this gap), the find-char state machine in `src/tlisp/core/commands/motions.tlisp`, the operator state machine in `src/tlisp/core/commands/operators.tlisp`.

### Prerequisites (must pass before implementation)

1. **CHORE-23** — confirmed the operator state machine's cond chain (`vim-operator-apply`) has no operator+find-char cases; `df<char>` reports `Unsupported operator: df`. The find-char and operator state machines individually work; this spec wires them together.

## Feature Description

tmax supports operator+motion combinations for word/line/char motions (`dw`, `dd`, `d$`, `dG`, `dgg`, …) and find-char as a standalone motion (`fx` jumps to next `x`, `;` repeats). It does NOT support operator+find-char: pressing `df<char>` while an operator is pending should delete from the cursor through the next occurrence of `<char>`, matching Vim. Same for `dt`/`dF`/`dT` and the `y` (yank) and `c` (change) equivalents.

Today, with operator `d` pending and `f` pressed, `vim-dispatch-operator-key` calls `vim-operator-apply("f")`, which falls through the cond chain to `(editor-set-status (concat "Unsupported operator: df"))`. The find-char state machine never starts.

## User Story

As a tmax user editing prose or code
I want `df<char>` to delete up to and including the next `<char>` on the line
So that I can chop a substring in two keystrokes without counting columns or switching to visual mode

Same story for `dt<char>` (delete up to but not including), `dF<char>` / `dT<char>` (backward), and `yf`/`yt`/`yF`/`yT` (yank) and `cf`/`ct`/`cF`/`cT` (change).

## Problem Statement

- `vim-dispatch-operator-key` (operators.tlisp lines 120–141) treats `f`/`t`/`F`/`T` as ordinary motion keys and hands them straight to `vim-operator-apply`.
- `vim-operator-apply` (lines 92–118) has a fixed cond chain with no cases for `df`/`dt`/`dF`/`dT`/`yf`/`yt`/`yF`/`yT`/`cf`/`ct`/`cF`/`cT`. It falls through to "Unsupported operator".
- The find-char state machine (`vim-begin-find`, `vim-find-pending-p`, `vim-dispatch-find-target` in motions.tlisp) is a separate pending state — there's no mechanism to chain "operator pending → find pending → return to operator with the resolved target".

## Solution Statement

When an operator is pending and the user presses `f`/`t`/`F`/`T`:

1. Stash the pending operator (don't clear it) and enter find-pending state instead of calling `vim-operator-apply`.
2. Capture the operator and a "find resumption" flag in module state so the find-completion handler knows to return to the operator rather than just move the cursor.
3. When the find target is dispatched and the cursor lands on the resolved character, re-enter `vim-operator-apply` with a synthetic motion representing the find result — e.g., motion `"f"`, `"t"`, `"F"`, `"T"` — plus the captured target char.
4. Extend the cond chain in `vim-operator-apply` to handle these motions by computing the deletion/yank/change range from the current cursor to the resolved target.

Concrete design (sketch — implementation may choose a cleaner decomposition):

```lisp
;; New module globals in operators.tlisp (or motions.tlisp)
(defvar vim-pending-operator-for-find nil)
(defvar vim-pending-find-type nil)       ; "f" | "t" | "F" | "T"
(defvar vim-pending-find-target nil)     ; the char

;; In vim-dispatch-operator-key, before the apply:
(if (member key '("f" "t" "F" "T"))
    (progn
      (set! vim-pending-operator-for-find vim-pending-operator)
      (set! vim-pending-find-type key)
      (vim-reset-operator)         ; clear operator-pending so find can take over
      (vim-begin-find key))        ; enter find-pending state
  ... existing dispatch ...)

;; After find resolves (in vim-dispatch-find-target, when
;; vim-pending-operator-for-find is set):
;;   1. compute the target cursor coords
;;   2. call (vim-operator-apply-find <operator> <find-type> <start-coords> <end-coords>)
;;   3. clear vim-pending-operator-for-find et al
```

The range semantics:
- `df<char>`: delete from cursor (inclusive) through target char (inclusive).
- `dt<char>`: delete from cursor (inclusive) through char before target.
- `dF<char>`: delete backward from cursor through target char (inclusive).
- `dT<char>`: delete backward from cursor through char after target.
- Same range semantics for `y` (yank to register, no delete) and `c` (delete then enter insert).

Count interaction: `2df<char>` deletes through the 2nd `<char>` to the right. The operator count multiplies the find iteration count (mirrors how `2dw` works). Find-char already supports count for plain `2f<char>`.

## Architecture Constraints

| Area | Governing Doc | Rule |
|------|--------------|------|
| T-Lisp ownership | `src/tlisp/CLAUDE.md` | All operator+find state and dispatch logic lives in T-Lisp. TypeScript primitives only provide buffer range delete/yank/replace. |
| Editor layer | `src/editor/CLAUDE.md` | `normal-handler.ts` already routes operator-pending keys to `vim-dispatch-operator-key` and find-pending keys to `vim-dispatch-find-target`. The chained dispatch stays inside T-Lisp — no handler changes. |
| Surgical changes | `CLAUDE.md` §3 | Touch only `operators.tlisp` and `motions.tlisp`. Don't refactor the existing cond chain beyond adding the find cases. |

## Relevant Files

### Existing Files to Modify

| File | Change | Constraints |
|------|--------|-------------|
| `src/tlisp/core/commands/operators.tlisp` | Extend `vim-operator-apply` cond with `df`/`dt`/`dF`/`dT`/`yf`/`yt`/`yF`/`yT`/`cf`/`ct`/`cF`/`cT` cases. Add module globals to remember the pending operator across the find sub-state. Optionally factor a `vim-operator-apply-find` helper. | T-Lisp owns operator state. |
| `src/tlisp/core/commands/motions.tlisp` | In `vim-dispatch-find-target`, detect when an operator is chained and re-enter the operator state machine instead of just moving the cursor. Or expose a "compute find target without applying" helper that `operators.tlisp` can call. | Don't break standalone `f`/`t`/`F`/`T`/`;`/`,` semantics. |

### New Files

| File | Purpose | Constraints |
|------|---------|-------------|
| — | — | No new files. Logic fits in the two existing operator/find modules. |

## Implementation Phases

### Phase 1: Wire `f`/`t`/`F`/`T` into the operator state machine

**Constraint checkpoint:** Before starting, verify:
- [ ] `vim-dispatch-operator-key` is the only entry point for keys pressed while an operator is pending.
- [ ] `vim-begin-find` can be called while operator state is non-empty (it should clear and replace, or the operator state must be stashed first).

#### Step 1: Detect find-char keys during operator pending

**User story:** As a user with `d` pending, when I press `f`, I want the editor to ask me for the find target instead of reporting "Unsupported operator: df".

**Description:** In `vim-dispatch-operator-key`, before the existing dispatch, check whether `key` is one of `"f"`/`"t"`/`"F"`/`"T"`. If so: stash `vim-pending-operator` into a new global, reset operator state, then call `(vim-begin-find key)` to enter find-pending state. Return `t`.

**MUST:**
- `df` no longer reports "Unsupported operator: df".
- After `df`, the find-pending state is active (verifiable via `(vim-find-pending-p)`).
- Standalone `f`/`t`/`F`/`T` (no operator) is unaffected.

**MUST NOT:**
- Lose the operator — it must be remembered across the find sub-state.
- Break `dd`/`dw`/`d$`/`dG`/`dgg` etc.

**Acceptance criteria:**
- [ ] Pressing `d` then `f` enters find-pending state.
- [ ] `(vim-find-pending-p)` returns `t` after `df`.
- [ ] Pressing `Escape` during the find sub-state cancels both find AND the stashed operator.

#### Step 2: Re-enter operator after find target resolves

**User story:** As a user, after `df<char>`, the deletion range should run from the original cursor through the target char (inclusive).

**Description:** In `vim-dispatch-find-target`, after the find resolves (cursor moved to target), check whether an operator is stashed. If so: compute the start/end coords of the affected range (using the pre-find cursor as one endpoint and the resolved cursor as the other, adjusted for inclusive/exclusive by find type), call the appropriate delete/yank/change primitive, clear the stashed operator, and skip the default "just move the cursor" behavior.

**MUST:**
- `df<char>` deletes from pre-find cursor through target char (inclusive).
- `dt<char>` deletes through the char before the target.
- `dF<char>` / `dT<char>` delete backward with the same endpoint semantics.
- `yf`/`yt`/`yF`/`yT` yank the same range without deleting.
- `cf`/`ct`/`cF`/`cT` delete and enter insert mode.
- Count `2df<char>` deletes through the 2nd occurrence of `<char>`.

**MUST NOT:**
- Change standalone find-char (`f`/`t`/`F`/`T`/`;`/`,`) behavior.
- Mutate `vim-pending-operator` while it's stashed — restore or clear it cleanly.

**Acceptance criteria:**
- [ ] `df<char>` deletes inclusive of target char.
- [ ] `dt<char>` deletes up to but not including target char.
- [ ] `cf<char>` deletes the range and enters insert mode.
- [ ] `yf<char>` sets the register without deleting.
- [ ] `2df<char>` deletes through the 2nd `<char>`.

### Phase 2: Tests + demo

**Constraint checkpoint:** Before starting, verify:
- [ ] Phase 1 passes manual tests.

#### Step 1: Add unit tests

**User story:** As a maintainer, I want regression tests for operator+find-char so the wiring cannot silently break.

**Description:** Add tests in `test/unit/vim-dispatch.test.ts` (or a new `test/unit/operator-find-char.test.ts`) covering: each operator × each find type (4×3 = 12 combos), count multiplication, Escape-cancellation, and the standalone-find-char no-regression case.

**Acceptance criteria:**
- [ ] All 12 combos tested with a representative buffer.
- [ ] Count test (`2df<char>`) passes.
- [ ] Cancellation test (`df<Escape>` clears both find and operator) passes.
- [ ] Standalone `f`/`;`/`,` still pass.

#### Step 2: Add a demo

**User story:** As a user watching the demo reel, I want to see `df<char>` work so I know it's a supported combo.

**Description:** Add a `demos/operator-find-char.yaml` exercising `df`/`dt`/`cf`/`yf` with assertions on buffer content and register state.

**Acceptance criteria:**
- [ ] Demo runs cleanly via `python demos/demo-runner.py demos/operator-find-char.yaml`.
- [ ] Demo exercises all four operators × at least one find type each.

## Acceptance Criteria

1. `df<char>`, `dt<char>`, `dF<char>`, `dT<char>` all delete the correct range (inclusive/exclusive per find type and direction).
2. `yf<char>`, `yt<char>`, `yF<char>`, `yT<char>` yank the correct range without modifying the buffer.
3. `cf<char>`, `ct<char>`, `cF<char>`, `cT<char>` delete the range and enter insert mode.
4. Count multiplication works: `2df<char>` reaches the 2nd occurrence.
5. Escape during the find sub-state cancels both find and the stashed operator.
6. Standalone find-char (`f`/`t`/`F`/`T`/`;`/`,`) is unchanged.
7. `bun run typecheck:src` passes with zero errors.
8. `bun test` passes with zero regressions.

## Validation Commands

- `bun run typecheck:src` — zero type errors
- `bun test test/unit/vim-dispatch.test.ts` — operator tests pass
- `bun test test/unit/operators.test.ts` (if it exists) — operator unit tests pass
- `bun test` — full suite, zero regressions
- Manual: `tmax /tmp/find-test.txt` → type a row like `hello world`, cursor at col 0, press `df<space>` → expected: `world` remains, `hello ` deleted. Try `dt<space>` → expected: ` world` remains, `hello` deleted. Try `yf<o>` then `p` → expected: `hello` yanked and pasted after the original `o`. Try `cf<l>` → expected: deletion runs through first `l`, cursor in insert mode at the second `l`.

## Design Decisions

| Decision | Rationale | Alternative rejected |
|----------|-----------|---------------------|
| Stash-and-resume (operator → find → operator) | Reuses the existing find-char state machine; the only new wiring is the resumption | Reimplement find inside the operator cond — duplicates find logic, drifts from standalone find |
| Add find cases to the existing `vim-operator-apply` cond | Matches the existing pattern (`dw`/`dd`/…); the cond is already the dispatch table | Generalize to "operator on arbitrary range" — over-engineered, the cond is small and readable |
| Compute range in T-Lisp, call existing delete/yank/change primitives | Primitives already exist; T-Lisp owns the range math (consistent with how `vim-delete-line-range` works) | Add a new "delete-find-range" TypeScript primitive — pushes logic into the wrong layer per `src/editor/CLAUDE.md` |

**Deferred to follow-up:**
- Visual-mode operator+find (`v3df<char>` style) — depends on visual-mode handler adopting the same keymap-first pattern (CHORE-23 follow-up).
- `;`/`,` as operator motions (e.g., `d;` deletes to the next find target from the last find). Tricky because `;` semantically depends on the last standalone find, not the current operator context.

## Edge Cases

- Operator + find + count: `3df<char>` deletes through the 3rd `<char>`. The operator count multiplies find iterations; verify `vim-count-current` is consulted inside the resumed operator, not consumed by `vim-begin-find`.
- Find target not present: `df<z>` on a line with no `z` should be a no-op (cursor unchanged, operator cleared, status message "find: z not found").
- Backward find with operator at column 0: `dF<char>` when the target is to the left of column 0 — no-op (nothing to delete).
- `dt<char>` at end of line: if `<char>` is the last char, deletes through end of line.
- Escape mid-find: must clear `vim-pending-operator-for-find` and `vim-pending-find-type`/`target` alongside the find state.
