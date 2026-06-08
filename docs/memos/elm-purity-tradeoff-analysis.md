# Tradeoff Analysis: Purity Over Performance in RFC-009

**Date:** 2026-06-08
**Evaluates:** [RFC-009](../rfcs/RFC-009-elm-purity-gap-analysis.md) — Elm Purity Gap Analysis

## The Question

RFC-009 proposes ~15,000 lines changed across 25 files to achieve full Elm purity in four phases. The vision document endorses "purity over performance" as a project principle. Is the tradeoff real? Is the cost estimate honest? Are the benefits weighted correctly?

**Short answer: purity costs less than the RFC estimates, but delivers less than it promises.** The performance overhead is negligible (proven by the already-pure buffer layer). The real costs are architectural coordination, not runtime. The benefits are real but should be weighted honestly: snapshot testing and Loom isolation are high-value; time-travel debugging and replay are aspirational with no current consumer.

## The Performance Tradeoff Is a Phantom

The buffer layer (`FunctionalGapBuffer`, `FunctionalTextBufferImpl`) is already purely functional. Every character typed allocates a new buffer instance — the hottest path in the editor. It works fine. V8's generational GC handles short-lived objects efficiently. If the highest-frequency allocation path can be pure without perceptible latency, everything else can too.

What each phase actually costs at runtime:

| Phase | Allocation per keystroke | Measurable impact |
|-------|--------------------------|-------------------|
| 1: Registries into state | One shallow copy of EditorState (33 fields) | None — object spread is <1μs |
| 2: Async → Cmd | Cmd object instead of Promise | One extra message round-trip per async op |
| 3: Setter closures → return-state | One small object per state transition | None — same allocation, just explicit |
| 4: Persistent T-Lisp env | ~2 new HAMT nodes per define/set | Negligible — log₃₂(200) ≈ 1.3 |

The 33-field EditorState copy is `{ ...state, cursorPosition: newPos }` — 33 references, no deep cloning. This is what React does on every setState, at 60fps, in applications far more complex than a text editor.

The T-Lisp environment has ~200 bindings at steady state. A HAMT with 200 entries has depth 2. During init, 104 `define()` calls create ~200 nodes total. At runtime, `(set! x val)` creates ~2 nodes. Trivial.

None of the conditions where purity overhead matters apply: state is small (kilobytes, not megabytes), persistent structures are shallow (flat key-value maps, not deep nesting), and GC pauses for objects this size are typically <5ms.

**The "purity over performance" framing in the vision is misleading — there is no meaningful performance tradeoff to make.** Purity is free here. The real tradeoff is development time.

## What Purity Actually Costs: Coordination, Not Runtime

### The setter-closure contract is the load-bearing wall

27 mutating closures in `tlisp-api.ts` call 14 setters in the editor bridge. Changing from imperative setters to return-state objects touches every ops module. The RFC estimates ~3,000 lines, which is accurate for the TypeScript side, but misses cascading changes:

- **T-Lisp test files** — tests that check `editor.getEditorState()` after eval need updating when the evaluation contract changes from "mutates state, returns value" to "returns state + value"
- **Daemon frame sync** — CHORE-19 just made all RPC handlers frame-aware using `syncFrameToEditor → execute → syncEditorToFrame`. If `execute` returns state instead of mutating, the pattern becomes `syncFrameToEditor → execute → merge returned state → syncEditorToFrame`
- **Mode handlers** — every mode handler calls T-Lisp functions via the setter pattern and must collect/merge returned state

### The T-Lisp evaluator is the high-risk surface

Threading environments through every eval/apply call (~4,700 lines) changes the signature of every function in the evaluator. Tail-call optimization, macro expansion, and module loading all thread through the environment. The RFC correctly identifies this as highest-risk but underestimates the cascading impact on `ModuleRegistry`, `require`/`provide`, and plugin isolation.

### The cost estimate is conservative

| What the RFC counts | Lines | What it misses | Lines |
|---------------------|-------|----------------|-------|
| Phase 1: Registries into state | ~1,500 | Frame sync refactor | ~200 |
| Phase 2: Async → Cmd | ~2,000 | Mode handler state collection | ~500 |
| Phase 3: Setter closures → return-state | ~3,000 | T-Lisp test updates | ~800 |
| Phase 4: Persistent T-Lisp env | ~5,000 | Module registry refactor | ~600 |
| New tests | ~3,500 | Daemon handler updates | ~400 |
| **Total** | **~15,000** | **Undocumented** | **~2,500** |

Realistic total: **~17,500 lines** across 30+ files.

## What Purity Actually Delivers

### High-value (pay off during development)

**Snapshot testing** (Phase 1 + 3):
```typescript
const result = update(keypress("j"), state);
expect(result.model.cursorPosition.line).toBe(state.cursorPosition.line + 1);
expect(result.model).toMatchSnapshot();
```
The current test suite (1,878 tests) constructs editor instances and asserts on `getEditorState()` after operations. Snapshot testing makes "what changed after this keypress?" trivial. Worth Phase 1 + 3 alone.

**Loom package isolation** (Phase 4):
Persistent environments enable `with-isolated-env(lambda () (load-package "foo"))` — sandbox, snapshot before/after, rollback on failure. Hard requirement for a viable package manager. Without it, a misbehaving package permanently corrupts the global environment.

**Complete state snapshots for daemon/client** (Phase 1 + 3):
The daemon syncs frame state by copying individual fields. Pure state transitions enable sending the entire model diff. Simplifies frame sync and enables "what did this buffer look like N keystrokes ago" without tmux.

### Medium-value (nice to have, not blocking)

**Async correctness via Cmd** (Phase 2): Prevents concurrent state corruption. Real issue in theory, but the editor serializes keypresses, so concurrent mutations are rare. More about architectural cleanliness than fixing observable bugs.

**Explicit state transitions** (Phase 3): Tracing `state_in → state_out` in one function return is a debugging aid. But the current setter pattern is also traceable — each setter is a named function findable with grep. Incremental improvement, not transformative.

### Low-value (aspirational, no current consumer)

**Time-travel debugging**: No one is building one. Steep has no consumer besides tmax. The architecture should enable it, but it shouldn't be cited as a reason to prioritize purity work now.

**Replay from checkpoint**: The daemon/client architecture already handles reconnection. A replay system needs a message log, a stepping UI, and a diff viewer — none planned.

## The Phase Ordering Is Wrong

The RFC orders: D (async) → C (registries) → A (setters) → B (T-Lisp env), justified by "Steep-layer" classification of async.

The problem: the Cmd system doesn't exist yet (RFC-008 Gap 3 is specified but not implemented). Async operations in handleKey are limited to 7 `await` expressions for infrequent operations (file save, file load, init). The async gap doesn't block other phases.

**Recommended reorder:**

1. **Registries into state** — low risk, high enabler (~1,500 lines)
2. **Setter closures → return-state** — closes dominant mutation, enables snapshot testing (~3,000 lines)
3. **Persistent T-Lisp env** — unblocks Loom when development starts (~5,000 lines)
4. **Async → Cmd** — defer until Cmd system is built (~2,000 lines)

This delivers snapshot testing and Loom isolation sooner and defers the infrastructure dependency.

## The Unspoken Tradeoff: Opportunity Cost

17,500 lines of purity refactoring is 17,500 lines not spent on editor features. Current gaps: no search/replace, no window splitting in production, no macro persistence, no LSP integration.

The vision says "framework quality over feature velocity." Right principle for a library. But tmax is also an editor that needs users. An editor with perfect purity but no search/replace is an architectural showcase, not a tool people use.

| Option | Ships in 3 months | Deferred |
|--------|-------------------|----------|
| Pursue purity (all phases) | Pure update, snapshot tests, Loom isolation | Search/replace, window management, LSP |
| Pursue features (Pillar C) | Complete vim/Emacs parity, daily-driver usability | Purity debt accumulates |
| **Hybrid: Phase 1 + 3 only** | Snapshot testing, complete state snapshots | T-Lisp env mutation, Cmd system, Loom |

## Recommendation

Pursue Phase 1 and Phase 3 now (~4,500 lines). Delivers snapshot testing and complete state snapshots — the most practical benefits at the lowest coordination cost. Phase 4 (persistent T-Lisp env) waits until Loom development starts, when requirements are concrete. Phase 2 (async → Cmd) waits until the Cmd system exists.

## Where RFC-009 Gets It Right

- Phased approach — each phase independently valuable and testable
- Buffer purity as proof — existing pure buffer proves the pattern works under real load
- Registries into state first — obviously correct and cheap
- Loom blocking concern — persistent environments are a hard requirement for package isolation
- The gap analysis itself — thorough, honest audit of mutation patterns

## Where RFC-009 Gets It Wrong

- **Phase ordering** — async before setters, but setters deliver more value and don't depend on the unbuilt Cmd system
- **Benefit inflation** — time-travel debugging and replay cited as high-value with no implementation plan or consumer
- **Cost underestimate** — misses ~2,500 lines of cascading changes (daemon, mode handlers, tests)
- **Frame architecture blind spot** — CHORE-19 frame sync uses the exact mutation patterns being eliminated
- **Performance framing** — "purity over performance" implies a tradeoff that doesn't exist. The real tradeoff is development time vs. architectural debt
