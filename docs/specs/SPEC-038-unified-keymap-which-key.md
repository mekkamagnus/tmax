# Feature: Unified T-Lisp Keymap System with Emacs-style Which-Key

**Depends on:** BUG-11 (which-key C-g cancellation and binding completeness fix)

### Prerequisites (must pass before implementation)

1. **BUG-11 fix** — Ensures C-g correctly resets T-Lisp vim prefix state and g-prefix bindings are complete. This spec builds on that corrected baseline.

## Feature Description

Adopt the Emacs keymap architecture: all key bindings, dispatch logic, and which-key display owned by T-Lisp data structures and functions. TypeScript provides only raw primitives (key normalization, timer scheduling, terminal rendering). This eliminates the dual-source binding problem (BUG-11 class), moves all editor logic into T-Lisp per the project architecture rule, and delivers a proper popup-based which-key display.

Four phases, each independently shippable: (1) per-instance which-key state, (2) unified T-Lisp keymaps, (3) live which-key from keymaps, (4) popup overlay rendering.

## User Story

As a tmax user and customizer,
I want all key bindings to live in introspectable T-Lisp data structures,
So that which-key always shows accurate bindings, new modes can define their own keymaps, and the dispatch path has a single source of truth.

## Problem Statement

The current system has two disconnected binding sources:

- **TypeScript `keyMappings` Map** — populated by `(key-bind ...)` calls from T-Lisp binding files. Used for C-c, SPC, and mode-specific bindings via `resolveMapping()` in `normal-handler.ts`.
- **T-Lisp `vim-dispatch-key` cond chains** — handles hjkl, operators, prefixes (z/g/C-w), counts, and find. The `vim-prefix-bindings` function returns a separate hardcoded alist for which-key display.

This split causes: binding staleness (BUG-11), non-introspectable bindings, 130 lines of dispatch routing in `normal-handler.ts`, and status-line-only which-key that can't display 7+ bindings.

## Solution Statement

1. Make which-key state per-editor instance (not module singleton) for multi-frame correctness.
2. Build T-Lisp keymap data structures that own all bindings — each mode gets a keymap hashmap with bindings, prefix-table, and parent chain.
3. Redirect `(key-bind ...)` to write into T-Lisp keymaps; migrate vim prefix dispatch from cond chains to keymap lookups.
4. Which-key reads bindings live from keymaps at display time — eliminates separate alists and staleness bugs.
5. Render which-key as a popup overlay on the bottom rows of the viewport with aligned columns.

## Architecture Constraints

| Area | Governing Doc | Rule |
|------|--------------|------|
| Editor logic ownership | `CLAUDE.md` §Project Overview, `src/editor/CLAUDE.md` | T-Lisp owns ALL editor logic. TypeScript provides primitives ONLY. |
| Handler responsibility | `src/editor/CLAUDE.md` | `handlers/*.ts` are mode dispatch routing that sends keys to T-Lisp. No logic. |
| TypeScript primitives scope | `src/editor/CLAUDE.md` | Only add TypeScript code when T-Lisp literally cannot compute something: terminal dimensions, timer scheduling, raw byte normalization. |
| T-Lisp command pattern | `src/tlisp/CLAUDE.md` | Define functions that call TS primitives, add `(key-bind ...)` in same file, end with `(provide "name")`. |
| T-Lisp state management | `src/tlisp/CLAUDE.md` | State machines, command dispatch, key sequences, count logic stay in T-Lisp. |
| Test validation | `CLAUDE.md` §8, `rules/testing.md` | Run `bun run typecheck:src`, `bun run typecheck:test`, `bun run build`, and `bun test` before reporting complete. |
| T-Lisp hashmap immutability | `src/tlisp/stdlib.ts` | `hashmap-set` returns a new map (immutable). Keymaps need a `keymap-mutable-set!` primitive for performance. |
| Render testing | `CLAUDE.md` §8 | Terminal UI changes must pass `bun run test:ui:renderer`; renderer tests send real keys and inspect captured output. |

## Relevant Files

### Existing Files to Modify

| File | Change | Constraints |
|------|--------|-------------|
| `src/editor/utils/which-key.ts` | Convert module singleton to per-instance factory; later remove `findBindingsForPrefixWithDocs` | `src/editor/CLAUDE.md`: handlers are routing only |
| `src/editor/editor.ts` | Update `key-bind` defineRaw to dual-write into T-Lisp keymaps; add `whichKeyPopup` state field | `src/editor/CLAUDE.md`: `defineRaw()` wrappers expose state to T-Lisp |
| `src/editor/handlers/normal-handler.ts` | Simplify to thin router — normalize key → call T-Lisp dispatch → handle timer | `src/editor/CLAUDE.md`: mode dispatch routing, no logic |
| `src/tlisp/core/commands/motions.tlisp` | Replace `vim-dispatch-prefix-key` cond chains with keymap lookups; remove `vim-prefix-bindings` | `src/tlisp/CLAUDE.md`: command library pattern |
| `src/tlisp/core/commands/vim-dispatch.tlisp` | `vim-dispatch-single` prefix keys (`g`, `z`, `C-w`) write to keymap prefix-tables | `src/tlisp/CLAUDE.md`: command library pattern |
| `src/tlisp/core/bindings/normal.tlisp` | No changes needed — already calls `(key-bind ...)` which redirects transparently | No changes required |
| `src/tlisp/stdlib.ts` | Add `keymap-mutable-set!` primitive for in-place hashmap mutation | `src/tlisp/CLAUDE.md`: TS provides primitives only |
| `src/frontend/render/buffer-lines.ts` | Overlay which-key popup on bottom rows when active | `rules/ui-testing.md`: renderer tests required |
| `src/core/types.ts` | Add `whichKeyPopup` field to `EditorState` | — |
| `test/unit/which-key-popup.test.ts` | Update to per-instance state; add keymap live-binding tests | `rules/testing.md` |
| `test/unit/command-documentation-preview.test.ts` | Update to per-instance state | `rules/testing.md` |

### New Files

| File | Purpose | Constraints |
|------|---------|-------------|
| `src/editor/utils/which-key-state.ts` | Per-editor which-key state factory replacing module singleton | `src/editor/CLAUDE.md`: primitives only |
| `src/tlisp/core/keymaps.tlisp` | Unified keymap module — mode keymap variables, `keymap-ref`, `keymap-set-key`, `keymap-prefix-p`, `current-keymap` | `src/tlisp/CLAUDE.md`: use `(defmodule ...)` / `(export ...)` / `(provide ...)` |
| `src/tlisp/core/modes/which-key-mode.tlisp` | Which-key minor mode — `define-minor-mode` registration, toggle function, activation hooks | `src/tlisp/core/modes/line-numbers-mode.tlisp`: reference minor mode pattern |
| `src/frontend/render/which-key-overlay.ts` | Popup overlay renderer — aligned columns, max height, ANSI styling | `rules/ui-testing.md`: renderer tests required |
| `test/unit/keymap.test.ts` | T-Lisp keymap data structure tests | `rules/testing.md` |

## Implementation Phases

### Phase 1: Per-instance Which-Key State — Eliminate module singleton

**Constraint checkpoint:** Before starting this phase, verify:
- [ ] BUG-11 fix is merged and all tests pass
- [ ] No other code imports from `which-key.ts` besides `normal-handler.ts`, `editor.ts`, and test files

#### Step 1: Create per-instance which-key state factory

**User story:** As a developer, I want which-key state per editor instance so that multi-frame daemon usage doesn't cross-contaminate state.

**Description:** Extract the module-level `WhichKeyState` from `which-key.ts` into a factory function that returns bound methods. Each Editor instance creates its own state.

**MUST:**
- Return an object with `{ getState, schedule, deactivate, reset, isActive }` methods bound to private per-instance state
- Editor creates state during construction and exposes it via a getter
- `normal-handler.ts` reads state from the editor parameter instead of importing module functions

**MUST NOT:**
- Change the scheduling behavior (timeout, callback pattern)
- Change how `state.whichKeyActive` / `state.whichKeyPrefix` / `state.whichKeyBindings` work on `EditorState`

**Convention source:** `src/editor/CLAUDE.md` — handlers receive state from editor, no module-level mutable state

**Acceptance criteria:**
- [ ] All 30 which-key tests pass
- [ ] All 16 doc-preview tests pass
- [ ] `bun run typecheck:src` passes
- [ ] `bun run build` succeeds
- [ ] No module-level mutable state in which-key system (grep for module-level `let`/`var` in which-key files)

#### Step 2: Backwards-compatible re-export

**User story:** As a developer, I want the transition to be seamless so that no other files break.

**Description:** Keep `src/editor/utils/which-key.ts` as a re-export wrapper during this phase. Other files continue importing from the old path.

**MUST:**
- `which-key.ts` re-exports the same function signatures from `which-key-state.ts`
- `resetWhichKeyState()` in tests still works (delegates to editor instance)

**MUST NOT:**
- Break any existing import paths

**Convention source:** `rules/testing.md` — test commands must work unchanged

**Acceptance criteria:**
- [ ] All existing tests pass without any test file changes (except `resetWhichKeyState` call pattern)

#### Step 3: Register which-key as a formal minor mode

**User story:** As a user, I want to toggle which-key via `(which-key-mode)` like other minor modes, so it integrates with the standard mode system and shows its lighter in the status line.

**Description:** Replace the ad-hoc `(which-key-enable)` / `(which-key-disable)` T-Lisp API with a proper minor mode registered via `define-minor-mode`. The existing minor mode infrastructure (`src/editor/api/minor-mode-ops.ts`, `src/editor/mode-state.ts`, `src/tlisp/core/modes/`) already provides toggle functions, lighter strings, and activation/deactivation hooks.

**MUST:**
- Create `src/tlisp/core/modes/which-key-mode.tlisp` using the `define-minor-mode` pattern (see `line-numbers-mode.tlisp` as reference)
- Register with `(define-minor-mode "which-key" "Show available key bindings after prefix pause" "WK" t)` — lighter `"WK"`, enabled by default
- Replace `which-key-enable` / `which-key-disable` API with `(which-key-mode)` toggle (optional arg: positive = enable, zero/negative = disable, nil = toggle)
- Keep `(which-key-timeout N)` as a standalone setting (not part of mode toggle)
- Activation hook enables which-key timeout; deactivation hook sets timeout to 0
- Mode state is per-buffer (each buffer can independently enable/disable which-key)

**MUST NOT:**
- Remove `(which-key-active)` or `(which-key-timeout)` API — still needed for queries
- Change the scheduling or display behavior
- Add key bindings to the minor mode keymap (which-key has no keys of its own)

**Convention source:** `src/tlisp/core/modes/line-numbers-mode.tlisp` — reference minor mode pattern; `src/editor/api/minor-mode-ops.ts` — `define-minor-mode` registration

**Acceptance criteria:**
- [ ] `(which-key-mode)` toggles which-key on/off for current buffer
- [ ] `(which-key-mode 1)` enables, `(which-key-mode 0)` disables
- [ ] `"WK"` lighter appears in status line when which-key is active
- [ ] `(which-key-enable)` and `(which-key-disable)` still work as backwards-compatible aliases
- [ ] Per-buffer: disabling in one buffer doesn't affect other buffers
- [ ] All which-key tests pass

---

### Phase 2: Unified T-Lisp Keymaps — Single source of truth for all bindings

**Constraint checkpoint:** Before starting this phase, verify:
- [ ] Phase 1 complete — per-instance state working, which-key is a minor mode
- [ ] `defkeymap`, `keymap-define-key`, `keymap-lookup` already exist in `stdlib.ts` (lines 615-760)
- [ ] `KeymapSync` bridge and `keymap-ops.ts` API exist (currently unused by dispatch)

#### Step 4: Add `keymap-mutable-set!` TypeScript primitive

**User story:** As a T-Lisp keymap developer, I need in-place mutation so that loading 100+ bindings doesn't copy the hashmap each time.

**Description:** T-Lisp's `hashmap-set` is immutable (returns new map). Add a primitive that directly mutates the Map inside a hashmap value, safe because keymap hashmaps are owned by one variable.

**MUST:**
- Mutate the existing hashmap's internal `Map<string, TLispValue>` in place
- Only work on hashmap values (type check)
- Be exposed as a T-Lisp builtin `(keymap-mutable-set! keymap key value)`

**MUST NOT:**
- Mutate any hashmap that isn't a keymap (no general-purpose mutable hashmap)
- Bypass the T-Lisp value type system

**Convention source:** `src/editor/CLAUDE.md` — TS provides primitives when T-Lisp cannot compute

**Acceptance criteria:**
- [ ] `(keymap-mutable-set! my-kmap "j" "(cursor-move)")` stores without copying
- [ ] Subsequent `(keymap-lookup my-kmap "j")` returns the stored value
- [ ] `bun run typecheck:src` passes

#### Step 5: Create unified keymap module in T-Lisp

**User story:** As a T-Lisp developer, I want first-class keymap data structures so that I can introspect, compose, and query bindings.

**Description:** Create `src/tlisp/core/keymaps.tlisp` with mode-specific keymap variables and operations. Each keymap is a hashmap with `"bindings"`, `"prefix-table"`, and `"parent"` keys.

**MUST:**
- Define `normal-keymap`, `insert-keymap`, `visual-keymap`, `command-keymap` as module variables
- Implement `keymap-ref (keymap key)` — lookup binding, follow parent chain
- Implement `keymap-set-key (keymap key command)` — bind a key; if key contains space (e.g., `"z t"`), create prefix entry
- Implement `keymap-prefix-p (keymap key)` — check if key has sub-keymap in prefix-table
- Implement `keymap-all-bindings (keymap)` — return `((key command) ...)` list
- Implement `keymap-prefix-bindings (keymap prefix)` — return sub-bindings for a prefix
- Implement `current-keymap ()` — return keymap for current `(editor-mode)`
- Use `(defmodule editor/keymaps ...)` / `(export ...)` / `(provide "keymaps")` pattern

**MUST NOT:**
- Depend on any TypeScript-side keymap state
- Use `hashmap-set` (immutable) for binding storage — use `keymap-mutable-set!` instead

**Convention source:** `src/tlisp/CLAUDE.md` — command library pattern with defmodule/export/provide

**Acceptance criteria:**
- [ ] `(keymap-set-key normal-keymap "j" "(cursor-move ...)")` stores the binding
- [ ] `(keymap-ref normal-keymap "j")` returns the command string
- [ ] `(keymap-prefix-p normal-keymap "z")` returns `t` after `(keymap-set-key normal-keymap "z t" ...)`
- [ ] `(keymap-all-bindings normal-keymap)` returns all bindings as `((key command) ...)`
- [ ] `(current-keymap)` returns correct keymap for each editor mode
- [ ] `test/unit/keymap.test.ts` passes

#### Step 6: Dual-write — `(key-bind ...)` stores into both TS Map and T-Lisp keymaps

**User story:** As a binding file author, I want `(key-bind ...)` to store into T-Lisp keymaps transparently so that existing `.tlisp` files don't need changes.

**Description:** Update the `key-bind` defineRaw in `editor.ts` to write into both the TypeScript Map (old path, for backwards compatibility) and the T-Lisp keymap (new path).

**MUST:**
- After writing to TypeScript Map, also call `(keymap-set-key <mode>-keymap "<key>" "<command>")` via the interpreter
- Multi-key bindings like `"C-c c"` automatically create prefix entries in the keymap's prefix-table
- Handle the case where mode keymaps haven't been initialized yet (deferred write)

**MUST NOT:**
- Change any `.tlisp` binding files (`normal.tlisp`, `insert.tlisp`, etc.)
- Remove the TypeScript Map write (needed during transition)
- Break existing `(key-bind ...)` behavior

**Convention source:** `src/editor/CLAUDE.md` — `defineRaw()` wrappers expose state to T-Lisp

**Acceptance criteria:**
- [ ] `(key-bind "z t" "(scroll-cursor-top)" "normal")` creates `"z"` prefix in `normal-keymap`'s prefix-table
- [ ] `(keymap-prefix-p normal-keymap "z")` returns `t` after loading bindings
- [ ] `(keymap-prefix-bindings normal-keymap "z")` returns all 7 z sub-bindings
- [ ] Existing binding files load without errors or changes
- [ ] All 2074+ existing tests pass

#### Step 7: Migrate vim prefix dispatch to keymap lookups

**User story:** As a user pressing z, g, or C-w, I want the dispatch to use the same keymap that which-key reads so there's one source of truth.

**Description:** Replace the `vim-dispatch-prefix-key` cond chains in `motions.tlisp` with keymap lookups. Remove the `vim-prefix-bindings` function (replaced by `keymap-prefix-bindings`).

**MUST:**
- Replace each prefix's cond block with `keymap-prefix-bindings` lookup
- Preserve exact behavior for all existing prefix sequences (zt, zz, zb, zl, zh, zs, ze, gg, gt, gT, gh, gO, gx, gb, C-w s/v/w/q/+/-/>/<)
- Remove `vim-prefix-bindings` from `motions.tlisp` — it's dead code after this step
- Remove `vim-prefix-bindings` from the module export list

**MUST NOT:**
- Change how `vim-begin-prefix` / `vim-reset-prefix` / `vim-pending-prefix` work
- Change the `vim-dispatch-key` state machine priority order (find > prefix > operator > digit > single)
- Change operator+prefix interaction (e.g., `dgg`)

**Convention source:** `src/tlisp/CLAUDE.md` — command library pattern

**Acceptance criteria:**
- [ ] `zt` scrolls to top, `zz` centers, `zb` to bottom
- [ ] `gg` jumps to first line, `gt` next tab, `gT` prev tab
- [ ] `C-w s` splits window, `C-w w` switches window
- [ ] All z/g/C-w prefix bindings work identically to before
- [ ] `vim-prefix-bindings` function removed from codebase
- [ ] All vim prefix tests pass

#### Step 8: Simplify `normal-handler.ts` to thin router

**User story:** As a developer, I want the normal handler to be a thin router that delegates all logic to T-Lisp.

**Description:** Refactor `handleNormalMode` to: normalize key → call T-Lisp dispatch → handle structured result (handled / not-handled / prefix-pending). Remove `hasLegacyPrefix`, `findBindingsForPrefixWithDocs` usage.

**MUST:**
- `handleNormalMode` becomes: C-g check → call `(dispatch-key "<key>")` → inspect result → schedule which-key timer if prefix-pending
- T-Lisp returns structured result indicating dispatch outcome
- Remove `hasLegacyPrefix` function (keymap prefix-table replaces it)
- Remove `findBindingsForPrefixWithDocs` call (T-Lisp provides bindings)

**MUST NOT:**
- Remove `resolveMapping` and `keyMappings` — keep as fallback during Phase 2 transition
- Change key normalization (that stays in TypeScript)
- Change how timers work (TypeScript still owns `setTimeout`)

**Convention source:** `src/editor/CLAUDE.md` — handlers are mode dispatch routing, no logic

**Acceptance criteria:**
- [ ] `normal-handler.ts` is under 50 lines (down from 130+)
- [ ] No binding lookup or prefix detection logic in TypeScript
- [ ] All 2074+ existing tests pass
- [ ] `bun run typecheck:src` passes

---

### Phase 3: Live Which-Key from Keymaps — Eliminate staleness bugs

**Constraint checkpoint:** Before starting this phase, verify:
- [ ] Phase 2 complete — all bindings in T-Lisp keymaps, dispatch using keymap lookups
- [ ] `normal-handler.ts` is thin router, no binding discovery in TypeScript

#### Step 9: Which-key computes bindings from live keymaps

**User story:** As a user, I want which-key to always show accurate bindings derived from the live keymap, even after custom bindings are added at runtime.

**Description:** Create `which-key-compute-bindings` T-Lisp function that reads from `current-keymap`'s prefix-table. Replace both which-key code paths (legacy and vim prefix) with a single call to this function.

**MUST:**
- Create `(which-key-compute-bindings prefix)` in T-Lisp that reads from `(current-keymap)`'s prefix-table
- Replace `maybeScheduleVimPrefixWhichKey`'s T-Lisp queries (`vim-prefix-pending-p`, `vim-current-prefix`, `vim-prefix-bindings`) with a single call to `which-key-compute-bindings`
- Replace `findBindingsForPrefixWithDocs` call (for legacy C-c/SPC prefixes) with the same function
- Both paths now use identical code — no legacy/vim split

**MUST NOT:**
- Change the timeout or scheduling behavior
- Keep any hardcoded binding lists

**Convention source:** `src/tlisp/CLAUDE.md` — command library pattern; `src/editor/CLAUDE.md` — handlers are routing only

**Acceptance criteria:**
- [ ] Adding `(key-bind "g n" "(my-command)" "normal")` at runtime immediately shows in g-prefix which-key
- [ ] Changing a binding updates which-key display without restart
- [ ] No hardcoded binding alists remain in the codebase (grep for `vim-prefix-bindings`)
- [ ] Single code path for all which-key binding computation
- [ ] All which-key tests pass

#### Step 10: Clean up dead code

**User story:** As a developer, I want no dead keymap/which-key code so the codebase is clean.

**Description:** Remove all functions and data structures made obsolete by the unified keymap system.

**MUST:**
- Remove `findBindingsForPrefixWithDocs` from `which-key.ts`
- Remove `findBindingsForPrefix` from `which-key.ts`
- Remove `hasLegacyPrefix` from `normal-handler.ts`
- Remove `vim-prefix-bindings` from `motions.tlisp` (if not already removed)
- Remove `maybeScheduleVimPrefixWhichKey` from `normal-handler.ts` (replaced by unified path)

**MUST NOT:**
- Remove `scheduleWhichKey`, `deactivateWhichKey`, `formatWhichKeyBindings` — still used for scheduling and display
- Remove `KeymapSync` class — still used for keymap registration

**Convention source:** `CLAUDE.md` §3 — remove orphans created by changes

**Acceptance criteria:**
- [ ] `grep -r "findBindingsForPrefix\|hasLegacyPrefix\|maybeScheduleVimPrefixWhichKey\|vim-prefix-bindings" src/` returns no matches
- [ ] All tests pass
- [ ] `bun run typecheck:src` passes

---

### Phase 4: Popup Overlay Rendering — Proper display for 7+ bindings

**Constraint checkpoint:** Before starting this phase, verify:
- [ ] Phase 3 complete — which-key reads from live keymaps, no hardcoded alists
- [ ] `MinibufferRenderView` / `MinibufferRenderRow` types in `core/types.ts` serve as reference for popup rendering

#### Step 11: Add popup overlay state and renderer

**User story:** As a user with 7+ bindings on a prefix, I want a readable popup overlay instead of a cramped status line.

**Description:** Add `whichKeyPopup` to `EditorState`, create a popup renderer, and overlay it on the bottom rows of the viewport.

**MUST:**
- Add `whichKeyPopup: { rows: string[][], height: number } | null` to `EditorState` in `core/types.ts`
- Create `src/frontend/render/which-key-overlay.ts` — takes popup data and viewport dimensions, returns ANSI-formatted rows with aligned columns
- Column width from widest binding; max popup height = terminal height - 4
- Update `buffer-lines.ts` to overlay popup on bottom rows when `whichKeyPopup` is set
- When which-key activates, format bindings into rows and set `whichKeyPopup`
- When which-key deactivates (any key press), clear `whichKeyPopup`
- Status line is no longer overwritten by which-key text

**MUST NOT:**
- Modify `status-line.ts` rendering logic
- Block key input while popup is visible (popup is purely visual)
- Use more than terminal height - 4 rows for the popup

**Convention source:** `src/frontend/render/minibuffer.ts` — closest existing popup pattern; `rules/ui-testing.md` — renderer tests required

**Acceptance criteria:**
- [ ] Which-key popup shows as overlay on bottom rows of viewport
- [ ] Bindings display in aligned columns (key left-aligned, description left-aligned)
- [ ] Popup clears immediately on any key press
- [ ] Popup works for both legacy (C-c, SPC) and vim prefix (z, g, C-w) bindings
- [ ] Status line shows normal content (not which-key text) when popup is visible
- [ ] `bun run test:ui:renderer` passes

#### Step 12: Update tests and validate end-to-end

**User story:** As a developer, I want comprehensive tests for the popup so regressions are caught.

**Description:** Update which-key tests to check popup data instead of status message. Run full validation suite.

**MUST:**
- Update `test/unit/which-key-popup.test.ts` to assert on `whichKeyPopup` state instead of `statusMessage` containing "Which-key:"
- Add renderer tests that verify popup overlay output
- Run full validation commands

**MUST NOT:**
- Remove existing test coverage — only update assertions to match new output

**Convention source:** `rules/testing.md` — TDD workflow; `rules/ui-testing.md` — renderer tests

**Acceptance criteria:**
- [ ] All which-key tests pass with popup assertions
- [ ] Renderer test validates ANSI output of popup overlay
- [ ] `bun test` — full suite passes
- [ ] `bun run typecheck:src` — zero errors
- [ ] `bun run build` — succeeds
- [ ] `bun run test:ui:renderer` — passes

## Acceptance Criteria

1. Zero hardcoded binding alists in the codebase — all bindings read from live T-Lisp keymaps
2. `normal-handler.ts` is under 50 lines — thin router that delegates to T-Lisp
3. `(key-bind ...)` stores into T-Lisp keymaps; TypeScript Map is a derived cache
4. Which-key popup renders as overlay with aligned columns, not status line text
5. Adding `(key-bind "g n" "(my-command)" "normal")` to `init.tlisp` shows in g-prefix which-key immediately
6. All existing tests pass with zero regressions
7. `bun run typecheck:src` passes
8. `bun run build` succeeds
9. `bun run test:ui:renderer` passes

## Validation Commands

- `bun test test/unit/which-key-popup.test.ts` — all which-key tests pass
- `bun test test/unit/command-documentation-preview.test.ts` — doc-preview tests pass
- `bun test test/unit/keymap.test.ts` — new keymap data structure tests pass
- `bun run typecheck:src` — zero TypeScript errors in source
- `bun run typecheck:test` — zero TypeScript errors in tests
- `bun run build` — build compiles without errors
- `bun test` — full test suite passes (2074+ tests)
- `bun run test:ui:renderer` — renderer tests pass

## Design Decisions

| Decision | Rationale | Alternative rejected |
|----------|-----------|---------------------|
| Keymaps as T-Lisp hashmaps with prefix-table | Hashmaps already exist in T-Lisp; prefix-table enables prefix detection without scanning all bindings | Separate alist per prefix — would need manual sync, same staleness problem |
| `keymap-mutable-set!` primitive | T-Lisp's `hashmap-set` copies on every write; 100+ bindings during load would create 100+ throwaway maps | Immutable keymaps with copy-on-write — unnecessary allocation for a single-owner data structure |
| Dual-write during Phase 2 transition | Allows incremental rollout without breaking anything; TypeScript Map and T-Lisp keymaps coexist | Big-bang cutover — high risk, hard to debug if dispatch breaks |
| Popup overlay instead of status-line text | 7+ bindings don't fit in a single status line; aligned columns are more readable | Multi-line status messages — would conflict with status line rendering |
| `normal-handler.ts` as thin router | Per `src/editor/CLAUDE.md`: handlers are routing only, no logic | Keep some logic in TS — violates architecture rule, perpetuates dual-source problem |
| Which-key as formal minor mode | Follows existing `define-minor-mode` pattern (line-numbers, auto-fill); gives per-buffer toggle, lighter string, activation hooks | Keep ad-hoc `(which-key-enable)`/`(which-key-disable)` API — works but doesn't integrate with mode system, no status-line lighter |

**Deferred to follow-up:**
- Keymap inheritance chain for minor modes → major mode → global (parent field exists but not yet used by dispatch)
- Keymap replacement rules (Emacs `which-key-replacement-alist` equivalent)
- Pagination for >50 bindings in popup
- `key-resolution.ts` priority system integration (modal > minor > major > global)
- Keymap persistence / export to `.tlisp` files

## Edge Cases

- Keymap with no bindings (empty keymap) — `current-keymap` returns nil, which-key doesn't activate
- Prefix key that is also bound as a command (`g` is both a prefix and `gg` is a valid command) — prefix-table handles this: `g` has sub-binding `g`, dispatch resolves correctly
- Circular parent references in keymap hierarchy — T-Lisp functions must detect and error, not infinite loop
- Very large number of bindings (>50) exceeding popup height — popup truncates to max height with "..." indicator
- Key bound in multiple modes (same key, different commands for normal vs visual) — each mode keymap is independent
- Major-mode-specific bindings overriding global bindings — deferred to follow-up (parent chain)
- Buffer switch while which-key popup is showing — popup clears immediately, new buffer's keymap takes effect
- `(key-bind ...)` called before keymaps module loaded — deferred write or no-op (keymaps initialized during `loadCoreBindings`)
