# Feature: Unify Key Dispatch — Keymap-First Architecture

**Depends on:** SPEC-038 (unified keymap + which-key), BUG-12 (keymap nested prefix fix)

### Prerequisites (must pass before implementation)

1. **SPEC-038** — established the T-Lisp keymap as the binding registry and wired which-key discovery through `keymap-prefix-p` / `keymap-prefix-bindings`.
2. **BUG-12** — fixed `keymap-set-key` to support nested prefixes (e.g. `SPC x f`), unblocking the removal of the parallel vim-dispatch prefix system.

## Feature Description

tmax currently has two overlapping key-dispatch systems in normal mode: a T-Lisp keymap (flat hashmap of `key → command`) and a Vim dispatch state machine (`vim-dispatch.tlisp`) that hardcodes ~40 single-key mappings alongside its genuine state-machine logic for counts, operators, find-char, and prefixes. `normal-handler.ts` calls `vimDispatch` first; whenever it returns truthy the keymap is never consulted, leaving ~18 dead duplicate bindings in `normal.tlisp` and forcing three special cases in the handler (space-key which-key, post-vim which-key, fallback path).

This chore collapses the two systems into one. The keymap becomes the single source of truth for binding lookup. The state machine shrinks to only what genuinely needs state: counts, operators, find-char. Prefixes (`g`/`z`/`C-w`/`SPC`) become keymap-only.

## User Story

As a tmax developer
I want one key-dispatch system instead of two overlapping ones
So that bindings are discoverable via which-key, dead code is eliminated, and the dispatch path is easy to reason about

## Problem Statement

- ~18 keys (`h`, `j`, `k`, `l`, `w`, `b`, `e`, `0`, `$`, `_`, `i`, `G`, `C-f`, etc.) are registered in BOTH systems; the keymap entries are unreachable dead code.
- The handler has three special cases to paper over the split: space-key which-key scheduling, `schedulePrefixWhichKey` after vim dispatch, and a `SPC ` fallback block.
- Adding a new binding requires deciding which system owns it; which-key can't see vim-dispatch-only keys.
- `vim-dispatch-single` is ~50 lines of hardcoded `key → command` mappings that duplicate what `key-bind` already expresses.

## Solution Statement

1. Add `(vim-count-consume default)` to `vim-counts.tlisp` so bindings can consume counts without the dispatcher inlining count logic.
2. Move all stateless and count-consuming keys into `normal.tlisp` as live `(key-bind ...)` entries.
3. Rewrite `normal-handler.ts` to a keymap-first dispatch order: pending-state check → keymap prefix → keymap ref → digit → operator/find entry.
4. Delete `vim-dispatch-single`, `vim-dispatch-digit`, `vim-dispatch-key`, and the prefix state functions from `motions.tlisp`.
5. Keep the operator state machine (`operators.tlisp`), find-char state, and count primitives unchanged.

## Architecture Constraints

| Area | Governing Doc | Rule |
|------|--------------|------|
| T-Lisp ownership | `src/tlisp/CLAUDE.md` | All editor logic (dispatch, state machines, key sequences) lives in T-Lisp; TypeScript only provides primitives. |
| Editor layer | `src/editor/CLAUDE.md` | `handlers/*.ts` are thin routers — no logic, no binding definitions. |
| Keymap as source of truth | SPEC-038 | All bindings registered via `(key-bind ...)`; which-key discovers them via `keymap-prefix-p` / `keymap-prefix-bindings`. |
| Surgical changes | `CLAUDE.md` §3 | Touch only what the unify requires; don't refactor adjacent code. |
| Verify before reporting | `CLAUDE.md` §8 | Run typecheck + full test suite; manually verify in the running editor. |

## Relevant Files

### Existing Files to Modify

| File | Change | Constraints |
|------|--------|-------------|
| `src/tlisp/core/commands/vim-counts.tlisp` | Add `(vim-count-consume default)` — returns count if active else `default`, resets state | T-Lisp owns count logic |
| `src/tlisp/core/bindings/normal.tlisp` | Make all stateless + count-consuming keys live bindings using `(vim-count-consume 1)`; add bindings for keys currently only in vim-dispatch (`a`, `A`, `I`, `o`, `O`, `x`, `D`, `C`, `Y`, `J`, `p`, `P`, `d`, `y`, `c`, `f`, `t`, `F`, `T`, `;`, `,`, `%`, `{`, `}`) | Bindings live in `core/bindings/*.tlisp` |
| `src/editor/handlers/normal-handler.ts` | Rewrite dispatch order to keymap-first; remove `vimDispatch`, `schedulePrefixWhichKey`, space-key special case | Handler is a thin router — no logic |
| `src/tlisp/core/commands/vim-dispatch.tlisp` | Delete `vim-dispatch-single`, `vim-dispatch-digit`, `vim-dispatch-key`; keep digit-value helper if operators need it | State machine owns only pending states |
| `src/tlisp/core/commands/motions.tlisp` | Delete prefix state functions (`vim-begin-prefix`, `vim-reset-prefix`, `vim-prefix-pending-p`, `vim-current-prefix`, `vim-dispatch-prefix-key`); keep scroll functions, find-char, `vim-gg` | T-Lisp owns motions |

### New Files

| File | Purpose | Constraints |
|------|---------|-------------|
| — | — | No new files; this is a consolidation |

## Implementation Phases

### Phase 1: Count primitive — add `vim-count-consume` with default

**Constraint checkpoint:** Before starting this phase, verify:
- [ ] `vim-count-consume` (no-arg) already exists in `vim-counts.tlisp` line 35
- [ ] Count primitives follow the `defmodule`/`export` pattern

#### Step 1: Add `(vim-count-consume default)`

**User story:** As a binding author, I want a count primitive that returns a default when no count is active, so that bindings like `j` can be written as `(cursor-move (+ (cursor-line) (vim-count-consume 1)) ...)` without inlining conditional logic.

**Description:** Extend `vim-count-consume` to accept an optional default argument. When no count is active, return the default instead of 1.

**MUST:**
- Preserve existing `(vim-count-consume)` (no-arg) behavior — returns count or 1, resets state.
- New `(vim-count-consume default)` returns count-or-default, resets state.

**MUST NOT:**
- Change the return value of the no-arg form.
- Add a separate function — extend the existing one.

**Convention source:** `src/tlisp/CLAUDE.md` — command library pattern.

**Acceptance criteria:**
- [ ] `(vim-count-consume)` with no active count returns `1`
- [ ] `(vim-count-consume 5)` with no active count returns `5`
- [ ] `(vim-count-consume 1)` with count `3` active returns `3`
- [ ] After consume, count state is reset

### Phase 2: Bindings — make all keys live in `normal.tlisp`

**Constraint checkpoint:** Before starting this phase, verify:
- [ ] Phase 1's `vim-count-consume` works
- [ ] `key-bind` registers into both flat bindings AND nested prefix-table (BUG-12)

#### Step 1: Update count-consuming motion bindings

**User story:** As a user, I want `10j` to move down 10 lines, so that I can navigate quickly.

**Description:** Update `h`/`j`/`k`/`l` in `normal.tlisp` to use `(vim-count-consume 1)`. Verify `w`/`b`/`e`/`-`/`+`/`x`/`p`/`P`/`G` already consume counts (they do, via existing inline pattern or `vim-gg`).

**MUST:**
- `h`/`j`/`k`/`l` honor count: `10j` moves 10 lines.
- `G` with count jumps to that line; without count jumps to last line.

**MUST NOT:**
- Break the existing `w`/`b`/`e` count behavior.

**Convention source:** SPEC-038 — bindings in `normal.tlisp`.

**Acceptance criteria:**
- [ ] `h`/`j`/`k`/`l` respect count
- [ ] `0` (line-first-column + viewport reset from BUG-12) still works
- [ ] `$`/`_` work without count

#### Step 2: Add stateless bindings currently only in vim-dispatch

**User story:** As a user, I want `x`, `D`, `J`, `p`, etc. to work through the keymap, so that which-key can discover them.

**Description:** Add `(key-bind ...)` entries for: `a`, `A`, `I`, `o`, `O` (insert entries), `x`, `D`, `C`, `Y`, `J` (delete/change/yank/join), `p`, `P` (paste), `%`, `{`, `}` (bracket/paragraph). Each bound to the command it currently calls in `vim-dispatch-single`.

**MUST:**
- Every key currently handled by `vim-dispatch-single` gets a `key-bind` entry.
- Operator keys (`d`/`y`/`c`) and find-char keys (`f`/`t`/`F`/`T`) bound to their state-machine entry commands.
- `;`/`,` bound to `vim-repeat-find` / `vim-repeat-find-reverse`.

**MUST NOT:**
- Change the behavior of any key — this is a 1:1 migration.

**Convention source:** SPEC-038.

**Acceptance criteria:**
- [ ] `x` deletes a char, `D` deletes to line end, `J` joins lines
- [ ] `dd`/`dw`/`yy`/`cc` operators work
- [ ] `fx`/`tx`/`Fx`/`Tx` find-char works, `;`/`,` repeat
- [ ] `%` jumps to matching bracket, `{`/`}` jump paragraphs

### Phase 3: Handler — keymap-first dispatch

**Constraint checkpoint:** Before starting this phase, verify:
- [ ] All keys from Phase 2 are bound in the keymap
- [ ] `keymap-prefix-p` correctly detects `g`/`z`/`C-w`/`SPC`/`SPC x` (BUG-12)

#### Step 1: Rewrite `handleNormalMode` dispatch order

**User story:** As a developer, I want the handler to consult the keymap before the state machine, so that there's one dispatch path.

**Description:** Reorder `normal-handler.ts`:
1. If state machine is pending (operator/find/count-being-built): route to it, return.
2. Build `lookupKey` from `currentPrefix` + `normalizedKey`.
3. `keymap-prefix-p(lookupKey)` → schedule which-key, set prefix, return.
4. `keymap-ref(lookupKey)` → execute command, return.
5. Digit `1-9` → feed count state machine, return.
6. Operator/find trigger → enter pending state, return.
7. Else: "Unbound key".

**MUST:**
- Pending state check comes first so `dw`, `fx` complete correctly.
- Which-key popup fires for `g`/`z`/`C-w`/`SPC`/`SPC x` via the keymap prefix path.
- `C-g` cancels any pending state + which-key.

**MUST NOT:**
- Call `vim-dispatch-key` (it will be deleted in Phase 4).
- Keep `schedulePrefixWhichKey` or the space-key special case.

**Convention source:** `src/editor/CLAUDE.md` — handler is a thin router.

**Acceptance criteria:**
- [ ] `hjkl`, `10j`, `dw`, `yy`/`p`, `fx`/`;`, `zt`/`zz`/`zb` all work
- [ ] `SPC x f` opens find-file
- [ ] Which-key popup appears for `z`, `g`, `C-w`, `SPC`, `SPC x`
- [ ] `C-g` cancels pending operator/find/which-key

### Phase 4: Cleanup — delete dead vim-dispatch code

**Constraint checkpoint:** Before starting this phase, verify:
- [ ] Phase 3 handler passes all manual tests
- [ ] No code references the functions about to be deleted

#### Step 1: Delete dead dispatcher functions

**User story:** As a developer, I want dead code removed, so that the codebase reflects the new architecture.

**Description:** Delete from `vim-dispatch.tlisp`: `vim-dispatch-single`, `vim-dispatch-digit`, `vim-dispatch-key`, `vim-key-digit-value` (if unused). Delete from `motions.tlisp`: `vim-begin-prefix`, `vim-reset-prefix`, `vim-prefix-pending-p`, `vim-current-prefix`, `vim-dispatch-prefix-key`. Update export lists.

**MUST:**
- Grep confirms zero references to deleted functions before deletion.
- `operators.tlisp` still works (it may reference `vim-dispatch-operator-key` — keep that or inline its logic).

**MUST NOT:**
- Delete `vim-count-*`, operator state, or find-char state.

**Convention source:** `CLAUDE.md` §3 — surgical changes; remove orphans your changes created.

**Acceptance criteria:**
- [ ] `rg "vim-dispatch-single|vim-dispatch-digit|vim-dispatch-key"` returns zero matches in `src/`
- [ ] `rg "vim-begin-prefix|vim-dispatch-prefix-key|vim-prefix-pending-p"` returns zero matches in `src/`
- [ ] Module exports updated to remove deleted symbols

### Phase 5: Tests — update for new dispatch model

**Constraint checkpoint:** Before starting this phase, verify:
- [ ] Phases 1-4 complete
- [ ] Existing tests identify what needs updating

#### Step 1: Update `vim-dispatch.test.ts`

**User story:** As a developer, I want tests to validate the new dispatch model, so that regressions are caught.

**Description:** The existing `test/unit/vim-dispatch.test.ts` tests `vim-dispatch-key` directly. Since that function is deleted, rewrite tests to exercise keys through the handler or through `(keymap-ref (current-keymap) "key")` lookups.

**MUST:**
- Test count consumption (`10j` moves 10 lines).
- Test operator pending (`dd`, `dw`).
- Test find-char pending (`fx`, `;`).
- Test keymap bindings for all migrated keys.

**MUST NOT:**
- Test deleted functions.

**Convention source:** `rules/testing.md`.

**Acceptance criteria:**
- [ ] `bun test test/unit/vim-dispatch.test.ts` passes
- [ ] `bun test test/unit/which-key-popup.test.ts` passes
- [ ] `bun test test/unit/normal-mode*.test.ts` passes

## Acceptance Criteria

1. `rg "vim-dispatch-single|vim-dispatch-digit|vim-dispatch-key"` returns zero matches in `src/`
2. `rg "vim-begin-prefix|vim-dispatch-prefix-key|vim-prefix-pending-p|vim-current-prefix"` returns zero matches in `src/`
3. `normal-handler.ts` has no `vimDispatch` function, no `schedulePrefixWhichKey`, no space-key special-case block
4. `vim-dispatch.tlisp` contains at most the operator/find pending helpers (or is deleted entirely)
5. Which-key popup appears for `z`, `g`, `C-w`, `SPC`, `SPC x` (nested)
6. All existing normal-mode key behaviors preserved: `hjkl`, `10j`, `dw`, `yy`/`p`, `fx`/`;`, `zt`/`zz`/`zb`, `SPC x f`, `gg`/`G`, `0`/`$`/`_`
7. `bun run typecheck:src` passes with zero errors
8. `bun test` passes with zero regressions

## Validation Commands

- `bun run typecheck:src` — zero type errors
- `bun test test/unit/vim-dispatch.test.ts` — dispatch tests pass
- `bun test test/unit/which-key-popup.test.ts` — which-key tests pass
- `bun test test/unit/normal-mode*.test.ts` — normal mode tests pass
- `bun test` — full suite, zero regressions
- Manual: `tmax somefile.txt` — verify `hjkl`, `10j`, `dw`, `yy`/`p`, `fx`/`;`, `zt`/`zz`/`zb`, `SPC x f`, `gg`/`G`, `0`/`$`/`_`, and which-key popups for `z`/`g`/`C-w`/`SPC`/`SPC x`

## Design Decisions

| Decision | Rationale | Alternative rejected |
|----------|-----------|---------------------|
| Keymap-first dispatch (consult keymap before state machine) | One source of truth for bindings; which-key discovers everything | Keep vim-dispatch-first and add keymap fallback — preserves the overlap and special cases |
| `(vim-count-consume default)` in each binding | Bindings stay self-contained; count logic not inlined in dispatcher | Keep count logic in dispatcher — requires dispatcher to know which keys consume counts |
| Prefixes (`g`/`z`/`C-w`/`SPC`) as keymap-only | Handler's `whichKeyPrefix` already tracks prefix state; removes parallel state | Keep prefix state machine in T-Lisp — duplicates keymap structure |
| Keep operator + find-char state machines | These genuinely need pending state (await next key) | Fully stateless operators — would require different UX |
| Keep `operators.tlisp` hardcoded motion cond | Operators need motions, not arbitrary commands; the cond lists valid combos | Generalize to "apply operator to any motion" — over-engineered for current needs |

**Deferred to follow-up:**
- Generalized operator+motion composition (e.g., `d` + any motion via text objects)
- Migrating markdown-mode `z`/`g` bindings to use the same keymap path (currently works but hasn't been audited)
- Visual-mode handler applying the same keymap-first pattern

## Edge Cases

- `0` dual-purpose: digit when count active, motion when not — handler must check `vim-count-active-p` before treating `0` as a digit.
- `dgg` operator+prefix: operator state machine's `operator-g` sub-state must still work after prefix functions are deleted from `motions.tlisp`.
- Escape/C-g cancellation: must clear operator-pending, find-pending, count, and which-key state.
- Count before operator (`3dw`): `vim-operator-count` captures the pre-operator count; verify the multiplication still works after handler rewrite.
- Keys that exist in both `normal.tlisp` and other files (`C-w` in `windows.tlisp`, `gt`/`gT` in `tabs.tlisp`): ensure no duplicate-registration warnings after migration.

## Patch Review Findings

Review performed after implementation. Each finding has been verified against the merged code.

### HIGH

None. The refactor meets its stated acceptance criteria: `rg "vim-dispatch-single|vim-dispatch-digit|vim-dispatch-key"` and `rg "vim-begin-prefix|vim-dispatch-prefix-key|vim-prefix-pending-p|vim-current-prefix"` both return zero matches in `src/`, `normal-handler.ts` no longer references `vimDispatch`/`schedulePrefixWhichKey`/the space-key special case, and the unified-keymap demo plus full test suite pass.

### MEDIUM

**M-1: Operator+find-char combinations are unsupported (pre-existing, surfaced by demo audit).**

`src/tlisp/core/commands/operators.tlisp` `vim-operator-apply` (the cond chain starting at line 101) handles these combos: `dd`, `dw`, `dl`, `d$`, `dG`, `dgg`, `yy`, `yw`, `yl`, `y$`, `cc`, `cw`, `cl`, `c$`. There are no cases for `df<char>`, `dt<char>`, `dF<char>`, `dT<char>` (or the `y`/`c` equivalents). Pressing `df<char>` today reports `Unsupported operator: df`.

This is **not** a CHORE-23 regression — the same gap existed before the refactor — but CHORE-23 is the natural place to record it because the demo audit (`demos/unified-keymap.yaml`) exposed it. Fix: extend the cond chain (or have `vim-dispatch-operator-key` route `f`/`t`/`F`/`T` into the find-char state machine and re-enter the operator on find completion). This is genuinely new behavior and should be filed as its own spec (e.g., `FEATURE-operator-find-char`) rather than tacked onto CHORE-23.

### LOW

**L-1: Header comment dispatch order is out of sync with the actual code.**

`src/editor/handlers/normal-handler.ts` lines 5–11 document this order:

```
1. Pending state ...
2. Keymap prefix ...
3. Keymap binding ...
4. Digit 1-9 ...
5. C-g/Escape ...
6. Else → "Unbound key"
```

But the actual code in `handleNormalMode` does this:

1. C-g/Escape (line 39)
2. Pending state (lines 54–65: find-pending then operator-pending)
3. Digit 1-9 / count-active `0` (lines 81–90)
4. Keymap prefix (lines 92–106)
5. Keymap binding (lines 108–120)
6. Unbound (lines 122–128)

The re-ordering is intentional and correct — `C-g` must run first so it cancels a pending state without that state's dispatch path swallowing the key, and digits must be checked before keymap lookup so count building doesn't get shadowed by a hypothetical binding. The comment just never caught up. Fix the comment to match the code (and explain *why* `C-g` and digits are checked early).

**L-2: `runCommand` and `executeCommand` are byte-identical helpers.**

`src/editor/handlers/normal-handler.ts` lines 151–160 (`runCommand`) and 162–171 (`executeCommand`) have identical bodies — same `try`/`catch`, same EDITOR_QUIT_SIGNAL re-throw, same status-message-on-error path. The only difference is the parameter name (`command` vs `tLispCmd`), and both parameters hold a T-Lisp source string. Delete one and route both call sites (line 56 and 62 for pending dispatch, line 113 for keymap binding) through the survivor. No behavior change.
