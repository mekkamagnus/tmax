# Operator + Find-Char Chaining via Stash-and-Resume

## Status

Accepted

## Context

tmax supports Vim-style operator+motion combinations (`dw`, `dd`, `d$`, `dG`, `dgg`) and find-char as a standalone motion (`fx` jumps to next `x`, `;` repeats). The two state machines lived in separate modules (`operators.tlisp` and `motions.tlisp`) with no mechanism to chain them.

Pressing `df<char>` fell through to `(vim-operator-apply "f")`, which has no `df` case in its cond chain. The user saw `Unsupported operator: df`. The same gap existed for `dt`/`dF`/`dT` and the `y` (yank) / `c` (change) variants — 12 combos total.

Reimplementing find inside the operator cond was rejected because it would duplicate the find-char logic (count handling, till/inclusive variants, direction, last-find state for `;`/`,`) and cause drift from standalone find.

## Decision

Implement operator+find-char via a **stash-and-resume** pattern that reuses the existing find-char state machine as-is.

### State added to `operators.tlisp`

```lisp
(defvar vim-pending-operator-for-find nil)       ; "d" | "y" | "c"
(defvar vim-pending-operator-for-find-count 1)   ; pre-operator count
```

These hold the operator and its prefix count while find-char owns the pending state.

### Dispatch flow

1. **`vim-dispatch-operator-key`** (operators.tlisp:228) — when `f`/`t`/`F`/`T` arrives while an operator is pending, route to `vim-operator-begin-find` instead of `vim-operator-apply`.

2. **`vim-operator-begin-find`** (operators.tlisp:60) — stash the operator and its count, call `vim-reset-operator` to clear operator-pending state (this is why reset runs BEFORE the stash is populated — `vim-reset-operator` clears the stash as part of its contract), then call `vim-begin-find` to enter find-pending state.

3. **`vim-dispatch-find-target`** (motions.tlisp:60) — when the find target resolves, check `vim-operator-find-pending-p`. If true, delegate to `vim-operator-apply-find`; otherwise perform the default cursor-move.

4. **`vim-operator-apply-find`** (operators.tlisp:77) — compute the affected range using `find-char-position` directly, apply the appropriate `d`/`y`/`c` primitive, clear the stash, reset count.

### Range computation

Single formula covers all four find variants:

```lisp
(let ((target-col (nth 1 position)))
  (let ((low (min start-col target-col)))
    (let ((high (+ (max start-col target-col) 1))))
      ...))
```

`find-char-position` already adjusts the column for `t`/`T` (returns the adjacent column, not the target's column). This makes the same `low..high` formula work for inclusive (`f`/`F`) and exclusive (`t`/`T`) variants — the adjacent-column behavior of `t`/`T` naturally excludes the target.

### Count semantics

The total find iteration count is `operator-count × motion-count`:

```lisp
(let ((total-count (* operator-count motion-count)))
  (find-char-position char direction till-p total-count))
```

`2df<char>` finds the 2nd occurrence. `3df<char>` finds the 3rd. This mirrors how `2dw` works (operator count multiplies motion iteration).

### Operator application

Reuses the existing buffer primitives — no new TypeScript layer:
- `d`: `buffer-delete-range` + `set-register`
- `y`: `buffer-get-range` + `set-register` (no buffer mutation)
- `c`: `buffer-replace-range` with empty string + `cursor-move` to range start + `editor-set-mode "insert"`

Undo history uses `(undo-begin)` / `(undo-commit combo)` with a combo string like `"df"` / `"dT"` built by `vim-operator-find-combo`.

### Files touched

| File | Change |
|------|--------|
| `src/tlisp/core/commands/operators.tlisp` | Added globals, `vim-operator-begin-find`, `vim-operator-apply-find`, `vim-operator-find-combo`, helper predicates; routed `f`/`t`/`F`/`T` in `vim-dispatch-operator-key` |
| `src/tlisp/core/commands/motions.tlisp` | Single change: `vim-dispatch-find-target` delegates to `vim-operator-apply-find` when stash is set |

No TypeScript changes. No new primitives.

## Consequences

### Benefits

1. **Reuse over duplication** — the find-char state machine is the single source of truth for find behavior (count, till/inclusive, last-find state for `;`/`,`). Operator chaining only adds the stash + resume hook.
2. **Surgical** — two files modified, ~80 lines added. No refactor of the existing operator cond chain.
3. **Range math is uniform** — one formula works for all four find variants because `find-char-position` already normalizes `t`/`T` to the adjacent column.
4. **Standalone find-char unchanged** — `f`/`t`/`F`/`T`/`;`/`,` work exactly as before when no operator is pending. The stash check is a single `if` in `vim-dispatch-find-target`.

### Costs

1. **Cross-module coupling** — `motions.tlisp` calls into `operators.tlisp` via late binding. This works because T-Lisp resolves function symbols at call time, but it means the dependency isn't visible at module load. A future rename of `vim-operator-apply-find` could silently break `motions.tlisp`.
2. **Subtle ordering invariant** — `vim-operator-begin-find` must call `vim-reset-operator` BEFORE populating the stash, because `vim-reset-operator` clears the stash as part of "clear all operator state". The function's docstring records this. Forgetting the order silently loses the operator.
3. **No `;`/`,` as operator motions** — `d;` (delete to last find target) is intentionally deferred. It requires reasoning about whether `;` after an operator should reuse the standalone last-find or start a new one. Tricky semantics; out of scope.

### Testing

21 unit tests in `test/unit/operator-find-char.test.ts` cover all 12 operator×find combos, count multiplication (`2df`, `3df`), Escape cancellation, char-not-found no-op, and standalone find-char no-regression. Full suite: 2291 pass / 0 fail.

### Related

- [SPEC-041](../specs/SPEC-041-operator-find-char.md) — feature spec
- [ADR-0023](ADR-0023-delete-operator.md) — delete operator
- [ADR-0024](ADR-0024-yank-copy-operator.md) — yank operator
- [ADR-0027](ADR-0027-change-operator.md) — change operator
- [ADR-0082](ADR-0082-vim-count-aware-dispatch.md) — count-aware dispatch (the unified keymap that surfaced this gap)
