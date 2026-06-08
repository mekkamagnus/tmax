# RFC-009: Elm Purity Gap Analysis

**Status:** PROPOSED
**Created:** 2026-06-08
**Updated:** 2026-06-08
**Author:** tmax Design Team
**Follows from:** RFC-008 (Assam ↔ Bubble Tea Gap Analysis), Design Decision #3
**Aligned with:** [technical-vision.md](../technical-vision.md) — Pillars A (Purity), B (Steep Independence), D (Ecosystem Sustainability)
**Tradeoff analysis:** [elm-purity-tradeoff-analysis.md](../memos/elm-purity-tradeoff-analysis.md)

## Table of Contents
- [Abstract](#abstract)
- [Vision Alignment](#vision-alignment)
- [Motivation](#motivation)
- [What Elm Purity Means](#what-elm-purity-means)
- [What tmax Has Now](#what-tmax-has-now)
- [Gap Analysis](#gap-analysis)
- [What Purity Would Cost](#what-purity-would-cost)
- [What Purity Would Gain](#what-purity-would-gain)
- [Recommended Path](#recommended-path)
- [Design Decisions](#design-decisions)

---

## Abstract

RFC-008 acknowledges that tmax's Assam uses Elm architecture as an organizational pattern, not a purity guarantee. The `update()` function wraps `editor.handleKey()`, which mutates T-Lisp state internally. This RFC analyzes the full gap between ideal Elm purity and tmax's actual implementation, cataloging every mutation point across 93 files and ~37,000 lines of editor, T-Lisp, and core code.

The conclusion: full Elm purity should be pursued incrementally. tmax is still in alpha — a rewrite is acceptable and the priority is the best long-term architecture, not short-term cost avoidance. Steep will eventually become its own standalone library, and tmax serves as its pressure test. Generic, pure interfaces are an asset, not overengineering. This RFC recommends a phased approach ordered by deliverable value: registries into state first (prerequisite), then setter closures → return-state (enables snapshot testing), then persistent T-Lisp environments (unblocks Loom when development starts), then async → Cmd (deferred until the Cmd system exists).

A companion [tradeoff analysis](../memos/elm-purity-tradeoff-analysis.md) evaluates the cost estimates and benefit weighting. Key findings: the performance overhead of purity is negligible (proven by the already-pure buffer layer), the real cost is ~17,500 lines (not 15,000 — the RFC missed ~2,500 lines of cascading changes), and the recommended phase ordering prioritizes deliverable value over architectural layering.

---

## Vision Alignment

This RFC is evaluated against the principles in [technical-vision.md](../technical-vision.md). Every gap and phase below is assessed through the vision's decision framework:

1. **Consistent with the vision?** Yes — purity is Pillar A.
2. **Consistent with the purity phases?** Yes — this RFC defines those phases.
3. **Generic enough for Steep?** Gaps are separated into Steep-layer (framework must solve) and tmax-layer (application must solve).
4. **Acceptable in alpha?** Yes — the vision explicitly states rewrites are acceptable.
5. **Simplest correct option?** The phased approach is the simplest path to full correctness.

### Pillar mapping

| Gap | Pillar A: Purity | Pillar B: Steep Independence | Pillar C: Editor Completeness | Pillar D: Ecosystem Sustainability |
|-----|:-:|:-:|:-:|:-:|
| A: Setter closures | Closes dominant mutation | Required for generic `update` API | — | — |
| B: T-Lisp environment | Closes last mutation | — | — | Required for Loom package isolation |
| C: Module registries | Prerequisite for all phases | Required for complete state snapshots | — | — |
| D: Async isolation | Correctness fix | Cmd system is Steep-layer infrastructure | Blocks reliable async editor features | — |
| E: Init mutation | — | — | — | Loom packages load during init |

### Steep-layer vs tmax-layer gaps

A key distinction the vision introduces: not all gaps are equal. Some are **Steep-layer** — they affect the framework's API and must be solved generically. Others are **tmax-layer** — they affect how tmax uses Steep, and the fix is tmax-specific.

| Gap | Layer | Implication |
|-----|-------|-------------|
| A: Setter closures | **tmax-layer** | The return-state pattern is how tmax wires its ops into Steep's `update`. Steep's API (`defineRaw` contract) must support it, but the 120 ops functions are tmax code. |
| B: T-Lisp environment | **tmax-layer** | Persistent environments are a T-Lisp implementation detail. Steep doesn't know about T-Lisp. But the pattern (immutable state) informs Steep's `Model` contract. |
| C: Module registries | **tmax-layer** | Moving registries into `EditorState` is purely tmax's business. Steep just requires that all state is in the model. |
| D: Async isolation | **Steep-layer** | The Cmd system is Steep infrastructure. Assam must provide `AsyncCmd`, `BatchCmd`, etc. This must be generic — any Steep app needs it, not just tmax. |
| E: Init mutation | **tmax-layer** | How tmax constructs its initial state. Steep's `init()` returns `(Model, Cmd)` — tmax must fit its init sequence into that contract. |

**This distinction affects phasing:** tmax-layer gaps (C, A) should be solved first because they deliver practical value (snapshot testing, complete state) without depending on unbuilt infrastructure. Steep-layer gaps (D) are deferred until the Cmd system exists. The tradeoff analysis shows that async mutations are limited to 7 `await` expressions for infrequent operations — the gap is real but not blocking.

---

## Motivation

RFC-008's Assam program requires `update(msg, model) => { model, cmds }` to be synchronous. But tmax's `editor.handleKey()` is async and mutates state through setter closures, T-Lisp environment mutation, and module-scoped registries. This creates three practical problems:

1. **Testing.** You cannot snapshot `update(input) => output` because the output depends on hidden mutable state (kill ring, registers, undo history, T-Lisp environment).
2. **Debugging.** State transitions are invisible. There is no replay log, no time-travel debugging, no way to inspect "what changed" after a keypress.
3. **Cmd system integrity.** The Cmd system (RFC-008 Gap 3) assumes update is a pure function that returns new state. If update mutates shared state, Cmd results can see stale or corrupted state.

The technical vision adds a fourth reason the original RFC didn't consider:

4. **Loom package isolation (Pillar D).** Loom packages (RFC-010) are T-Lisp code that runs in the shared environment. Without environment persistence (Gap B), a misbehaving package permanently corrupts the global environment. Pure state isolation makes packages testable in sandboxes and safe to load/unload. The vision says "the package manager benefits from the same purity and testability goals as the rest of the system."

Understanding the exact mutation surface tells us what to fix, what to leave alone, and what the tradeoffs are.

---

## What Elm Purity Means

In the Elm architecture, `update` is a pure function:

```
update : Msg -> Model -> (Model, Cmd Msg)
```

Properties:

1. **No hidden state.** All state flows through the `Model` argument and return value. No module-scoped variables, no singletons, no closures over mutable references.
2. **Referential transparency.** Calling `update(msg, model)` always produces the same `(model', cmds)` for the same inputs. This enables replay, snapshot testing, and time-travel debugging.
3. **Side effects via Cmd.** All I/O, network, timers, and async operations are described as `Cmd` values. The runtime executes them and delivers results as new `Msg`s. Update never touches the real world.
4. **Structural sharing.** New model values share unchanged subtrees with the old model via persistent data structures. This makes `update` O(changes) rather than O(state).

In TypeScript, property 4 is optional (GC handles copying). Properties 1-3 are the essential ones.

---

## What tmax Has Now

### Mutation audit summary

| Subsystem | Files | Lines | Mutation pattern | Severity |
|-----------|-------|-------|-----------------|----------|
| Editor state via setter closures | `editor.ts`, `tlisp-api.ts`, 16 `api/*-ops.ts` | ~4,400 | 50+ `defineRaw()` closures call setter functions that mutate `Editor.state` | Critical |
| T-Lisp environment | `evaluator.ts`, `environment.ts` | ~4,770 | `env.define()`, `env.set()` mutate `Map<string, TLispValue>` in place | Critical |
| Module-scoped registries | 6 files (kill-ring, evil-integration, undo-redo, visual-ops, yank-ops, delete-ops, macro-recording) | ~600 | `let` variables at module scope holding mutable state | Medium |
| T-Lisp interpreter | `interpreter.ts`, `module-registry.ts` | ~300 | `builtinsEnv.define()` during init, `ModuleRegistry.register()` at runtime | Low (init-time) |
| Test/suite registries | `evaluator.ts` (module scope) | ~15 | `testRegistry`, `suiteRegistry`, `currentSuite` as module `let` vars | Low (dev-only) |
| Buffer layer | `buffer.ts` | ~530 | **Already pure.** `FunctionalGapBuffer` and `FunctionalTextBufferImpl` return new instances on every operation. | None |

### Mutation pattern #1: Setter closures (the dominant pattern)

The `TlispEditorState` bridge in `editor.ts` (lines 199-260) creates getter/setter pairs:

```typescript
// editor.ts line 232
cursorLine: {
  get: () => this.state.cursorPosition.line,
  set: (v: number) => {
    this.state.cursorPosition.line = v;
    this.currentWindow.cursorLine = v;
  },
},
```

These setters are passed to every ops module via `createEditorAPI()` in `tlisp-api.ts`. Each T-Lisp API function (e.g., `buffer-insert`, `cursor-move`, `editor-set-mode`) calls the setters imperatively:

```typescript
// api/buffer-ops.ts (buffer-insert)
const newBuf = state.currentBuffer.insert(text, line, col);  // pure — returns new buffer
setCurrentBuffer(newBuf);  // impure — mutates Editor.state via setter
```

The functional buffer result is immediately sunk into a mutable reference. This pattern repeats across all 16 ops modules (~40+ setter calls).

**Could it be pure?** Yes. Each function could return `{ buffer: newBuf, cursorLine: newLine, cursorCol: newCol, ... }` instead of calling setters. The caller would assemble the new state. But this requires changing the return type of every T-Lisp API function from `Either<Error, Value>` to `Either<Error, { value: Value, state: Partial<EditorState> }>`.

**How many call sites:** ~50 defineRaw closures in `tlisp-api.ts`, plus 16 ops modules with ~120 exported functions.

### Mutation pattern #2: T-Lisp environment mutation

The `TLispEnvironmentImpl` uses a mutable `Map<string, TLispValue>`:

```typescript
// environment.ts line 48
define(name: string, value: TLispValue): void {
  this.bindings.set(name, value);  // mutates in place
}

set(name: string, value: TLispValue): void {
  // walks parent chain, mutates first env containing name
  this.bindings.set(name, value);
}
```

Every `defun`, `defvar`, `defmacro`, `set!`, and module definition mutates this map. A pure architecture would use persistent maps (e.g., Hamt maps) and return new environments.

**How many call sites:** `define()` is called ~150+ times during initialization (builtins + stdlib) and at runtime for every user `defun`/`defvar`. `set()` is called on every `(set! var val)` evaluation.

### Mutation pattern #3: Module-scoped registries

Six module-scoped `let` variables hold mutable state that is not part of `Editor.state`:

| Registry | File | State held |
|----------|------|-----------|
| Kill ring | `api/kill-ring.ts` | `items: string[]`, `maxSize: number` |
| Evil registers | `api/evil-integration.ts` | `registerStorage: string[]` (38 entries), `unnamedRegister: string` |
| Undo/redo history | `api/undo-redo-ops.ts` | `history: BufferSnapshot[]`, `currentIndex: number` |
| Visual selection | `api/visual-ops.ts` | `visualSelection: { start, end }` |
| Macro recording | `api/macro-recording.ts` | `isRecording`, `currentRegister`, `recordedKeys`, `macros` Map |
| Yank/delete registers (legacy) | `api/yank-ops.ts`, `api/delete-ops.ts` | Single string each |

**Could it be pure?** Yes. Each could be a field on `EditorState` (or a sub-object like `EditorState.registers`). This is the lowest-cost purity improvement.

---

## Gap Analysis

### Gap A: Setter closures obscure state transitions

**What purity requires:** Every state transition is explicit in the return value of `update`. You can trace `model_in → model_out` by reading one function.

**What tmax does:** State transitions are scattered across setter calls in 16 ops modules. After `editor.handleKey("j")` returns, the caller (Assam's update) has no idea what changed — it must call `editor.getEditorState()` to snapshot the entire state and diff.

**Impact on Assam:** Assam's `update` cannot be the source of truth for state transitions. It delegates to `editor.handleKey()` and then snapshots. The Elm separation is organizational, not semantic.

**Cost to fix:** Changing all 120 ops functions from imperative setters to returning partial state objects. Estimated ~3,000 lines changed across `tlisp-api.ts` and all `api/*-ops.ts` files.

### Gap B: T-Lisp environment mutation breaks snapshot isolation

**What purity requires:** The model snapshot captures all state. Snapshotting at any point gives a complete, restorable picture.

**What tmax does:** The T-Lisp environment (`bindings` Map) is mutable and not part of `EditorState`. After `editor.handleKey()` evaluates a `(defun ...)` or `(set! ...)`, the environment has changed permanently. Rolling back the `EditorState` snapshot does not roll back the T-Lisp environment.

**Impact on Assam:** No time-travel debugging. No replay from checkpoint. Snapshot testing cannot reproduce T-Lisp state changes.

**Impact on Loom (Pillar D):** Loom packages are T-Lisp code loaded at init-time and on-demand. Without persistent environments, a package's `(defun ...)` and `(defvar ...)` calls permanently mutate the global environment. There is no way to:
- Test a package in isolation (sandbox with its own environment)
- Roll back a failed package load
- Unload a package (can't undo environment mutations)
- Snapshot editor state before/after package activation

This is a blocking concern for Loom's viability. The package manager cannot be safe without environment isolation.

**Cost to fix:** Replacing `Map<string, TLispValue>` with a persistent map data structure and threading environments through all eval functions. Estimated ~5,000 lines changed across `evaluator.ts`, `environment.ts`, `interpreter.ts`, `module-registry.ts`.

### Gap C: Module-scoped registries are invisible to state management

**What purity requires:** All state is in the model. No hidden mutable references outside the model.

**What tmax does:** Kill ring, registers, undo history, visual selection, and macro state live as module-scoped `let` variables. They are not included in `EditorState` snapshots.

**Impact on Assam:** `editor.getEditorState()` does not capture these. If Assam's diff renderer or batching system depends on complete state, it will miss these. Undo/redo, kill-ring-yank, and macro playback are invisible to state management.

**Cost to fix:** Moving each registry into `EditorState` as a named field. Estimated ~1,500 lines changed across the 6 registry files and `editor.ts`.

### Gap D: Async mutations during update

**What purity requires:** Update is synchronous. No concurrent state changes during a single update cycle.

**What tmax does:** `editor.handleKey()` is async because some commands do file I/O (save, load) and T-Lisp evaluation can trigger async operations. While an async handleKey is awaiting, new keypresses can arrive and trigger overlapping state mutations.

**Impact on Assam:** RFC-008's batching system (Gap 10) assumes synchronous updates. If `update` is async, `processQueue()` cannot drain the queue synchronously.

**Cost to fix:** All async operations in handleKey would move to the Cmd system (RFC-008 Gap 3). The update function itself becomes synchronous. Estimated ~2,000 lines changed in `editor.ts` command handlers and `tlisp-api.ts` async functions.

### Gap E: Init-time mutation is acceptable but undocumented

**What purity requires:** Even init-time mutation should be explicit (return initial state, don't construct it via side effects).

**What tmax does:** `editor.start()` calls `ensureCoreBindingsLoaded()`, `loadInitFile()`, `loadSavedMacros()`, `createBuffer("*scratch*")` — all of which mutate state. This is acceptable because it happens once, before the event loop starts. But it's not captured in Assam's `init()` function cleanly.

**Impact on Assam:** Low. Init mutation is a one-time cost. The resulting state is what matters.

**Impact on Loom (Pillar D):** Moderate. Loom packages load during init (and on-demand later). If init-time mutations aren't captured as a state transition, Loom can't snapshot "before package" vs "after package" — which is essential for package isolation and testing. Once Gap B is solved (persistent environments), the init sequence should return an initial environment rather than mutating one in place.

**Cost to fix:** Minimal for documentation now. After Gap B is solved, the init sequence should be refactored to return initial state instead of mutating it (~500 lines). This is a Phase 3 follow-up, not a separate phase.

---

## What Purity Would Cost

### Full purity: estimated effort

| Gap | Description | Direct lines | Cascading lines | Total | Files | Risk |
|-----|-------------|:---:|:---:|:---:|:---:|------|
| A | Setter closures → return state objects | ~3,000 | ~1,300 | ~4,300 | 18 | High — touches every T-Lisp API function |
| B | Persistent T-Lisp environment | ~5,000 | ~600 | ~5,600 | 4 | High — rewrites eval/apply core; blocks Loom |
| C | Registries into EditorState | ~1,500 | ~200 | ~1,700 | 8 | Low — straightforward lift |
| D | Async → Cmd system | ~2,000 | ~500 | ~2,500 | 3 | Medium — depends on unbuilt Cmd system |
| E | Init-time refactoring | ~500 | — | ~500 | 2 | Low — Phase 3 follow-up |
| | **Total** | **~12,000** | **~2,600** | **~14,600** | **~25** | |

Plus ~3,500 lines of new tests. Grand total: **~18,100 lines** across 30+ files, representing ~45% of the editor/tlisp/core codebase.

### Cascading changes (not in original estimate)

The original RFC counted direct code changes but missed downstream consumers of the mutated APIs:

| Phase | Direct work | Cascading changes | Lines |
|-------|-------------|-------------------|-------|
| C: Registries | Move 6 registries into EditorState | Frame sync refactor (CHORE-19 pattern: `syncFrameToEditor → execute → syncEditorToFrame` needs updating) | ~200 |
| D: Async → Cmd | Move 7 await expressions to Cmds | Mode handler state collection (each mode handler collects/merges returned state) | ~500 |
| A: Setter closures | Change 120 ops functions to return-state | T-Lisp test updates (tests checking `getEditorState()` after eval) | ~800 |
| B: Persistent env | Thread environments through eval/apply | Module registry refactor (`require`/`provide` + plugin isolation) | ~600 |
| B: Persistent env | — | Daemon handler updates (frame sync needs state-merge pattern) | ~400 |

### Risk assessment

- **Gap A (setter closures):** Every ops module would need its return type changed. The `defineRaw()` contract would change from `(args) => Either<Error, Value>` to `(args) => Either<Error, { value: Value, state: Partial<EditorState> }>`. This is a breaking change to the T-Lisp API contract. Every user-facing T-Lisp function is affected.
- **Gap B (persistent environment):** The evaluator is the most complex subsystem (~4,700 lines). Rewriting it to thread environments through every eval call changes the fundamental execution model. Tail-call optimization, macro expansion, and module loading all depend on the current mutable environment pattern.
- **Gap C (registries):** Low risk. Straightforward refactor — move module-scoped `let` into `EditorState` fields.
- **Gap D (async → Cmd):** Medium risk. **Blocked** — requires Cmd system to exist first (RFC-008 Gap 3 is specified but not implemented). Only 7 `await` expressions for infrequent operations (file save, file load, init). The gap is real but low urgency.

### The performance tradeoff is a phantom

The tradeoff analysis ([memo](../memos/elm-purity-tradeoff-analysis.md)) demonstrates that the "purity over performance" framing is misleading — there is no meaningful performance tradeoff at tmax's scale:

- The buffer layer is already purely functional and handles the highest-frequency allocation path (every character typed). V8's generational GC handles short-lived objects efficiently.
- EditorState is 33 fields of shallow references. Copying is `{ ...state, field: newValue }` — the same pattern React uses at 60fps.
- The T-Lisp environment has ~200 bindings at steady state. A HAMT with 200 entries has depth 2. `(set! x val)` creates ~2 nodes.
- State is kilobytes, not megabytes. GC pauses for objects this size are typically <5ms.

**The real tradeoff is development time, not runtime performance.** ~18,100 lines of purity refactoring is ~18,100 lines not spent on editor features. The phase ordering below optimizes for delivering practical value (snapshot testing, Loom isolation) at the lowest coordination cost.

---

## What Purity Would Gain

| Benefit | Requires | Pillar | Value | Honesty check |
|---------|----------|--------|-------|---------------|
| Snapshot testing (assert update(msg, state) = newState) | Gap A + C | A | **High** | Delivers immediately. Makes 1,878 existing tests simpler and enables pure state assertions. Worth Phases 1+2 alone. |
| Loom package isolation (sandbox, load/unload, test) | Gap B + E | D | **High** | Blocking concern. Without persistent environments, packages corrupt global state. Hard requirement for RFC-010. |
| Complete state snapshots for daemon/client | Gap A + C | B | **High** | Daemon currently syncs individual fields. Pure state transitions enable full model diffs and "what did this buffer look like N keystrokes ago." |
| Explicit state transitions (trace state_in → state_out) | Gap A | A | **Medium** | Debugging aid. Current setter pattern is traceable via grep — incremental improvement, not transformative. |
| Async correctness via Cmd | Gap D | A + B | **Medium** | Theoretical concern. Editor serializes keypresses, so concurrent mutations are rare. More about architectural cleanliness than fixing observable bugs. Architectural cleanliness matters for Steep, but doesn't justify blocking other phases. |
| Steep library viability (pure interfaces for external consumers) | Gap A + B + C + D | B | **Medium** | Steep has no consumer besides tmax. Pure interfaces are the right goal, but citing "external consumers" inflates the urgency. |
| Stateless server rendering (daemon sends state, client renders) | Gap A + C | B | **Medium** | Daemon/client already works. This formalizes it. |
| Time-travel debugging | Gap A + B + C | A | **Aspirational** | No one is building one. No implementation plan, no consumer. The architecture should enable it, but it should not drive phase ordering. |
| Replay from checkpoint | Gap A + B + C | A | **Aspirational** | Daemon/client handles reconnection. A replay system needs a message log, stepping UI, and diff viewer — none planned. |

**Phase ordering (by deliverable value, not architectural layering):**

1. **Gap C (registries)** — low risk, high enabler, prerequisite for everything (~1,700 lines total)
2. **Gap A (setter closures)** — closes dominant mutation, enables snapshot testing (~4,300 lines total)
3. **Gap B (persistent environment)** — unblocks Loom when development starts (~5,600 lines total)
4. **Gap D (async → Cmd)** — deferred until Cmd system exists (~2,500 lines total)
5. **Gap E (init refactoring)** — Phase 3 follow-up (~500 lines total)

This ordering delivers snapshot testing after Phases 1+2 (~6,000 lines), defers the unbuilt Cmd dependency, and waits for concrete Loom requirements before tackling the highest-risk evaluator rewrite.

---

## Recommended Path

### Phased approach: ordered by deliverable value

tmax is in alpha. Rewrites are acceptable — the priority is the best long-term architecture, not preserving existing code. Steep will become its own library, and pure interfaces make it viable for consumers beyond tmax.

The tradeoff analysis ([memo](../memos/elm-purity-tradeoff-analysis.md)) changes the phase ordering from the original "Steep-layer first" approach. The Cmd system doesn't exist yet (RFC-008 Gap 3 is specified but not implemented), and async mutations are limited to 7 `await` expressions for infrequent operations. Starting with Gap D means building on infrastructure that doesn't exist, deferring practical value (snapshot testing) for architectural correctness.

The phases below are ordered by **what delivers usable value at the lowest coordination cost**. Each phase is independently valuable and testable.

### Phase 1: Registries into state (Gap C)

**Effort:** ~1,700 lines (1,500 direct + 200 frame sync). **Risk:** Low. **Value:** High enabler.

Add these fields to `EditorState`:

```typescript
interface EditorState {
  // ... existing fields ...
  killRing: { items: string[]; maxSize: number };
  registers: { evil: string[]; unnamed: string; yank: string; delete: string };
  undoHistory: { snapshots: BufferSnapshot[]; index: number };
  visualSelection: { start: Position; end: Position } | null;
  macroState: {
    isRecording: boolean;
    currentRegister: string;
    recordedKeys: string[];
    macros: Map<string, string[]>;
  };
}
```

Remove the module-scoped `let` variables. Replace with getter/setter pairs on the same `TlispEditorState` bridge that already exists.

**Cascading change:** Frame sync (CHORE-19 pattern) needs updating because `syncFrameToEditor → execute → syncEditorToFrame` touches registry state that was previously invisible.

**Why:** This makes `editor.getEditorState()` a complete snapshot — prerequisite for every subsequent phase. Lowest risk, highest enabler. The tradeoff analysis identifies this as "obviously correct and cheap."

**When:** Now. Can proceed in parallel with RFC-008 second pass.

### Phase 2: Setter closures → return-state objects (Gap A)

**Effort:** ~4,300 lines (3,000 direct + 1,300 cascading). **Risk:** High. **Value:** High.

Change every T-Lisp API function from imperative setters to returning partial state objects:

```typescript
// Before (Phase 1)
const newBuf = state.currentBuffer.insert(text, line, col);
setCurrentBuffer(newBuf);  // mutates via setter

// After (Phase 2)
return { buffer: newBuf, cursorLine: newLine, cursorCol: newCol };
// caller assembles new state
```

The `defineRaw()` contract changes from `(args) => Either<Error, Value>` to `(args) => Either<Error, { value: Value, state: Partial<EditorState> }>`. This is a breaking change to every ops module (~120 functions, 50 `defineRaw()` closures).

**Cascading changes:**
- T-Lisp test updates — tests checking `getEditorState()` after eval (~800 lines)
- Mode handler state collection — each mode handler collects/merges returned state (~500 lines)

**Why:** This makes `update(msg, model) => { model, cmds }` a true pure function. Combined with Phase 1, it enables snapshot testing — the most practical purity benefit. The vision says "explicitness over convenience" — setter closures are convenient, return-state objects are explicit.

**What Phases 1+2 deliver together (~6,000 lines):**
- Snapshot testing: `assert update(msg, state).model === expectedState`
- Complete state snapshots for daemon/client (full model diffs instead of field-by-field sync)
- The foundation for time-travel debugging and replay (when someone builds them)

**When:** After Phase 1 is stable. The project is in alpha, so this breaking change is acceptable now and expensive later.

### Phase 3: Persistent T-Lisp environment (Gap B + E)

**Effort:** ~6,100 lines (5,000 direct + 600 module registry + 500 init refactor). **Risk:** High. **Value:** High (unblocks Loom).

Replace `Map<string, TLispValue>` with a persistent map data structure (e.g., HAMT). Thread new environments through all eval/apply functions instead of mutating in place.

**Cascading changes:**
- Module registry refactor — `require`/`provide` + plugin isolation (~600 lines)
- Daemon handler updates — frame sync needs state-merge pattern (~400 lines)
- Init sequence refactoring — `editor.start()` returns initial state instead of mutating (~500 lines)

**Why:** Closes the last mutation gap. Enables Loom package isolation — the blocking concern for RFC-010.

**Loom impact (Pillar D):** Persistent environments are a hard requirement for Loom. Without them:
- Packages cannot be sandboxed during testing
- Failed package loads cannot be rolled back
- Package uninstall cannot undo environment mutations
- The package manager cannot snapshot state before/after activation

**When:** After Phase 2 is stable. **Coordinate with RFC-010 (Loom) design** — the environment model informs the package isolation model, and Loom's concrete requirements may change the implementation approach. Do not start this phase in isolation.

### Phase 4: Async → Cmd system (Gap D)

**Effort:** ~2,500 lines (2,000 direct + 500 mode handler updates). **Risk:** Medium. **Value:** Medium.

**Blocked until:** The Cmd system exists (RFC-008 Gap 3 is implemented).

Move all async operations in `editor.handleKey()` to the Cmd system:
- `file-save` → `AsyncCmd(() => writeFile(...), toMsg)`
- `file-load` → `AsyncCmd(() => readFile(...), toMsg)`
- Daemon RPC calls → `AsyncCmd(() => rpc(...), toMsg)`

**Why deferred:** The tradeoff analysis shows that async mutations are limited to 7 `await` expressions for infrequent operations (file save, file load, init). The editor serializes keypresses, so concurrent mutations are rare in practice. This is more about architectural cleanliness (Steep-layer correctness) than fixing observable bugs. Deferring until the Cmd system exists avoids building on infrastructure that doesn't exist.

**When:** After RFC-008 Gap 3 (Cmd system) is implemented and after Phase 3 is stable.

### What not to pursue now

- **Full purity in one shot:** The phased approach lets each change stabilize before the next. Rushing all phases into one PR would make debugging regressions nearly impossible.
- **Structural sharing (Elm property 4):** TypeScript's GC handles copying adequately. The tradeoff analysis proves this — EditorState is 33 shallow references, object spread is <1μs. Persistent data structures for the model are premature optimization until profiling shows a bottleneck. Properties 1-3 (no hidden state, referential transparency, side effects via Cmd) are the essential ones.
- **Loom-specific isolation before Phase 3:** Package sandboxing depends on persistent environments. Building sandboxing on top of mutable environments would create a false abstraction that Phase 3 would invalidate. Wait for Phase 3, then build Loom on the right foundation.
- **Time-travel debugging or replay now:** No consumer, no implementation plan. The architecture should enable these, but they should not drive phase ordering or justify urgency.

### Opportunity cost

~6,000 lines for Phases 1+2 (snapshot testing + complete state) is the sweet spot: practical value at manageable cost. Phases 3-4 (~8,600 lines) are larger and should be timed against editor feature work (Pillar C: search/replace, window management, LSP integration).

| Option | Ships | Deferred |
|--------|-------|----------|
| Phases 1+2 now | Snapshot testing, complete state snapshots | T-Lisp env mutation, Cmd system, Loom isolation |
| Phases 1-3 now | + Loom isolation, full purity | Search/replace, window management, LSP (~8,600 lines of feature work displaced) |
| Phases 1-4 now | + Async correctness | All feature work (~17,100 lines displaced) |

### What not to pursue now

- **Full purity in one shot:** The phased approach lets each change stabilize before the next. Rushing all phases into one PR would make debugging regressions nearly impossible.
- **Structural sharing (Elm property 4):** TypeScript's GC handles copying adequately. Persistent data structures for the model are premature optimization until profiling shows a bottleneck. The vision says "purity over performance" — but structural sharing is a performance optimization, not a purity requirement. Properties 1-3 (no hidden state, referential transparency, side effects via Cmd) are the essential ones.
- **Loom-specific isolation before Phase 3:** Package sandboxing depends on persistent environments. Building sandboxing on top of mutable environments would create a false abstraction that Phase 3 would invalidate. Wait for Phase 3, then build Loom on the right foundation.

---

## Design Decisions

1. **Full Elm purity is the long-term goal.** tmax is in alpha and Steep will become a standalone library. Pure interfaces are not overengineering — they are the product. The phased approach (registries → setter closures → persistent environments → async/Cmd) reaches full purity incrementally with manageable risk at each step.

2. **Buffer purity is already proven.** The buffer layer (`FunctionalGapBuffer`, `FunctionalTextBufferImpl`) is already purely functional. This proves the pattern works in production. The tradeoff analysis confirms the performance overhead is negligible — V8's GC handles short-lived objects efficiently even on the hottest path (every character typed).

3. **Order by deliverable value, not by architectural layer.** The original "Steep-layer first" ordering put async/Cmd before setter closures. The tradeoff analysis shows this is wrong: the Cmd system doesn't exist, async mutations are limited to 7 infrequent operations, and setter closures deliver snapshot testing immediately. Start with what delivers value at lowest cost (C → A), defer what depends on unbuilt infrastructure (D), time the highest-risk work to concrete requirements (B when Loom starts).

4. **Async isolation is architectural cleanliness, not an urgent correctness fix.** The editor serializes keypresses. Concurrent mutations are rare in practice. This matters for Steep's framework API and should be done, but it doesn't justify blocking phases that deliver practical value now.

5. **T-Lisp environment mutability is temporary.** The mutable environment pattern is idiomatic for Lisp interpreters, but it's the last mutation gap. Phase 3 addresses it once Phases 1 and 2 are stable. The alpha status makes this rewrite acceptable.

6. **Steep's independence justifies generic purity, but not premature urgency.** Steep will be its own library. Pure `update(msg, model) => { model, cmds }` is the right interface. But citing "external consumers" to inflate urgency is dishonest — Steep has no consumer besides tmax. Build the right interfaces, but don't let hypothetical consumers override practical value.

7. **Persistent environments are a blocking prerequisite for Loom.** The package manager (RFC-010, Pillar D) cannot be safe without environment isolation. Phase 3 should be coordinated with RFC-010 design — the environment model informs the package model.

8. **Cost estimates must include cascading changes.** The original RFC counted direct line changes but missed ~2,600 lines of downstream updates (frame sync, mode handlers, T-Lisp tests, module registry, daemon handlers). Future estimates should audit consumers of the changed API, not just the API itself.

9. **Time-travel debugging and replay are aspirational.** They should be enabled by the architecture but should not drive phase ordering or justify urgency. No implementation plan exists, no consumer exists, and no one is building either feature.

---

## Impact on RFC-008

This RFC updates RFC-008's Design Decision #3 from:

> "Elm as organizational pattern, not purity guarantee."

to:

> "Elm purity is the long-term goal, pursued incrementally. Phase 1 (registries into state) makes snapshots complete. Phase 2 (setter closures → return-state) enables snapshot testing. Phase 3 (persistent T-Lisp environment) unblocks Loom. Phase 4 (async → Cmd) awaits the Cmd system. Phase ordering is by deliverable value, not architectural layering."

No changes to RFC-008's gap specifications, target APIs, or recommended sequence. Phase 1 can proceed independently of RFC-008. Phase 4 (async → Cmd) depends on RFC-008 Gap 3 being implemented first.

## Impact on RFC-010 (Loom)

RFC-010 (Loom Package Manager) depends on Phase 3 (persistent T-Lisp environments). Loom should not be implemented with mutable environments — package isolation, sandboxing, and safe load/unload all require environment persistence. The recommended sequence:

1. RFC-009 Phases 1-2 now (registries + setter closures → snapshot testing)
2. RFC-009 Phase 3 + RFC-010 design in parallel (environment model informs package model; concrete Loom requirements may change the implementation approach)
3. RFC-010 implementation after Phase 3 is stable
4. RFC-009 Phase 4 (async → Cmd) when the Cmd system exists

Phases 1-2 are independent of Loom and should proceed immediately. Phase 3 is Loom's foundation — do not start it without coordinating with RFC-010 design.
