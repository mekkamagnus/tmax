# Unified Keymap-First Normal-Mode Dispatch

## Status

Accepted

## Context

tmax had two overlapping normal-mode key-dispatch systems:

1. **T-Lisp keymap** — a flat hashmap of `key → command`, populated by `(key-bind ...)`. Source of truth for which-key discovery via `keymap-prefix-p` / `keymap-prefix-bindings`.
2. **Vim dispatch state machine** (`vim-dispatch.tlisp`) — a hand-written router that handled counts, operators, find-char, prefix chains, AND ~18 stateless single keys (`h`/`j`/`k`/`l`/`w`/`b`/`e`/`0`/`$`/`_`/`i`/`G`/`C-f`/etc.).

`normal-handler.ts` called `vimDispatch` **first**. If it returned truthy, the keymap was never consulted. Consequences:

- ~18 keys were registered in BOTH systems; the keymap entries were unreachable dead code.
- Which-key could not see the vim-dispatch-only keys — bindings were invisible to the popup.
- Three special cases papered over the split: a space-key which-key scheduling block, a `schedulePrefixWhichKey` call after vim dispatch, and a `SPC ` fallback path.
- Adding a binding required deciding which system owned it.
- `vim-dispatch-single` was ~50 lines of hardcoded `key → command` mappings duplicating what `key-bind` already expressed.

## Decision

Collapse the two systems into one. **The keymap is the single source of truth for binding lookup.** The state machine shrinks to only what genuinely needs state: counts, operators, find-char.

### Dispatch order in `normal-handler.ts`

```
On every normal-mode key:
1. C-g / Escape → cancel which-key + pending state, return
2. find-pending? → vim-dispatch-find-target, return
3. operator-pending? → vim-dispatch-operator-key, return
4. Build lookupKey from currentPrefix + normalizedKey
5. Digit 1-9 (or 0 when count active) → feed count state machine, return
6. keymap-prefix-p(lookupKey)? → schedule which-key, set prefix, return
7. keymap-ref(lookupKey)? → execute command, return
8. Else: "Unbound key"
```

The state machine runs **only** when it's actively pending or when the key is a state-machine trigger (digit/operator/find). Everything else hits the keymap.

### Count handling: per-binding consume

`(vim-count-consume default)` returns the active count (or `default` if none), then resets state. Each count-consuming binding calls it in its own expression:

```lisp
(key-bind "j" "(cursor-move (+ (cursor-line) (vim-count-consume 1)) (cursor-column))" "normal")
(key-bind "h" "(cursor-move (cursor-line) (- (cursor-column) (vim-count-consume 1)))" "normal")
```

This moves count logic out of the dispatcher and into the binding — the dispatcher no longer needs to know which keys consume counts.

### Prefix dispatch

`g` / `z` / `C-w` / `SPC` become plain keymap prefixes. The handler detects them via `keymap-prefix-p` and tracks the pending prefix in `state.whichKeyPrefix` (already existed). The T-Lisp prefix state functions (`vim-begin-prefix`, `vim-reset-prefix`, `vim-prefix-pending-p`, `vim-current-prefix`, `vim-dispatch-prefix-key`) were deleted.

The `operator-g` sub-state (for `dgg`) stays inside the operator state machine via `vim-operator-g-pending` — when operator is pending and `g` arrives, it enters a one-key sub-state that only accepts a second `g`.

### Operator and find-char dispatch

`d`/`y`/`c` enter operator-pending via `(vim-begin-operator "d")`. `f`/`t`/`F`/`T` enter find-pending via `(vim-begin-find direction till-p)`. These keys are bound in the keymap but the bound commands just set up pending state — the next key arrives, the handler routes to the state machine (steps 2-3), and the state machine completes the operation.

`vim-operator-apply` (the cond chain that resolves `dd`/`dw`/`d$`/`dG`/`dgg`/`yy`/`cc`/...) stays in T-Lisp and is unchanged.

### What was deleted

- `vim-dispatch-single`, `vim-dispatch-digit`, `vim-dispatch-key` from `vim-dispatch.tlisp` (~50 lines of duplicated key mappings)
- `vim-begin-prefix`, `vim-reset-prefix`, `vim-prefix-pending-p`, `vim-current-prefix`, `vim-dispatch-prefix-key` from `motions.tlisp` (parallel prefix state)
- `vimDispatch`, `schedulePrefixWhichKey`, and the space-key special-case block from `normal-handler.ts`
- ~18 dead `(key-bind ...)` entries in `normal.tlisp` became live bindings (they had been shadowed by vim-dispatch)

### What stayed

- `vim-count-*` primitives (count state)
- `operators.tlisp` (operator state machine, `vim-operator-apply` cond)
- Find-char state (`vim-begin-find`, `vim-dispatch-find-target`, `vim-repeat-find`, etc.)
- `vim-gg` (count-conditional jump)

## Consequences

### Benefits

1. **One source of truth** — every binding lives in `normal.tlisp` as `(key-bind ...)`. Which-key discovers them all.
2. **Dead code eliminated** — ~50 lines of `vim-dispatch-single` removed; the 18 "dead duplicate" bindings are now the live ones.
3. **Handler is a thin router** — `normal-handler.ts` shrunk to a single dispatch function with a clear 7-step order. No special cases.
4. **Adding a binding is one line** — `(key-bind "x" "(my-command)" "normal")`. No dispatcher edits.
5. **Count-aware bindings are self-documenting** — the binding expression shows whether and how count is consumed.
6. **Enables operator+find-char chaining** — the unified dispatch model is what made ADR-0090 possible: operators and find-char live in their own state machines, and the handler routes between them cleanly.

### Costs

1. **Count logic distributed** — instead of one place that handles counts, every count-consuming binding must call `(vim-count-consume N)`. Forgetting it silently breaks count support for that key. Mitigated by convention: copy a sibling binding.
2. **Two-layer dispatch** — the handler is in TypeScript, the bindings are in T-Lisp. Debugging a key that doesn't work requires checking both layers (handler routing + keymap contents).
3. **Subtle dispatch order** — pending-state check must come before digit check (so `3dw` works: `3` builds count, `d` enters operator-pending, `w` is routed to the state machine, not the keymap). The handler's step ordering is load-bearing.
4. **`0` dual-purpose** — `0` is a digit when count is active, otherwise the "go to column 0" motion. The handler must check `vim-count-active-p` before treating `0` as a digit.

### Testing

- `test/unit/vim-dispatch.test.ts` rewritten to exercise keys through the handler instead of the deleted `vim-dispatch-key` function.
- `test/unit/which-key-popup.test.ts` covers prefix popups for `z`/`g`/`C-w`/`SPC`/`SPC x`.
- Full suite: 2291 pass / 0 fail.

### Related

- [CHORE-23](../specs/CHORE-23-unify-key-dispatch.md) — chore spec
- [ADR-0082](ADR-0082-vim-count-aware-dispatch.md) — count-aware dispatch (predecessor; covered the count half)
- [ADR-0086](ADR-0086-which-key-per-instance-state.md) — which-key per-instance state (made the unified popup path possible)
- [ADR-0087](ADR-0087-keymap-mutable-set.md) — keymap mutation performance
- [ADR-0090](ADR-0090-operator-find-char-chaining.md) — operator+find-char (follow-on that depended on this dispatch model)
