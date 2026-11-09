# SPEC-234 — Evaluator command-source parse reuse

Issue: #234 — every dispatch re-parses command source; cache the parse
Status: implementing
Date: 2026-11-10

## Goal

`TLispInterpreterImpl.execute` re-tokenizes + re-parses its source string on every call. Command dispatch (keybinding bodies, M-x expressions) executes the same strings repeatedly. Cache successful parses so repeat dispatches skip parse entirely — without changing evaluation semantics.

## Re-measured cost model (Bun 1.4.4, fresh evidence per codex review)

The perf-arc lore that parse is "~95% of eval cost" overstates it, but parse **does dominate** small-form dispatch. Micro-benchmarks (bare interpreter, 50k-iteration loops, min of alternating same-process runs, succeeding evaluations):

- `(progn (+ 1 2) (+ 3 4))` (binding-body shape): execute 6.2–6.9µs, of which parse ≈ 5.1µs → **~80%**
- `(progn (sim-move 1 2) (+ 3 4))` (user-fn shape): execute 17.8µs, parse ≈ 4.9µs → **~27%**

Parse is a fixed ~4–9µs per dispatch; the cache removes it on repeat dispatches. Measurement gotchas that produced wrong numbers along the way (documented so they aren't repeated): unbound-symbol probes measure the error path (parse share misreads 11%); a load-average-12 host swings single probes ±7× — same-process interleaved pre/post code (git-show'd pre-change copy imported alongside the new one) plus reporting machine load is the reliable method.

## Design

- **Cache**: `Map<string, ParsedForm[]>` inside the interpreter (per-editor lifetime, dies with the session). **Key = sourceName + '\0' + source string** — string identity, not a hand-rolled hash (Map hashes internally; spans embed source attribution so different sourceNames must not share entries). Successful non-empty parses only; `Left` (syntax errors) is not cached.
- **LRU bound 256** entries via Map insertion-order (delete+re-insert on hit; evict oldest key past the cap). Command bodies are a few dozen strings; the bound keeps unbounded user evals (M-x expressions) from growing the cache.
- **Macros are safe by construction**: only the *unexpanded* parse is cached; macro expansion happens at eval, so redefining a macro changes the next dispatch's expansion — no stale replay.
- **AST sharing is safe because T-Lisp has no in-place value mutation**: no rplaca/nconc/vector-set-style primitives exist (grep-verified); the evaluator builds fresh values (22 fresh-construction sites, zero writes into `.value` nodes); TCO wraps expr nodes in `TailCall` results without mutating them; `quote` returning an AST node as a value is safe because nothing can mutate it. Guard: the full 3,543-test suite + editor/integration suites.
- **memoryPressure (#243)**: `clearParseCache()` is the drop hook; #243 wires `process.on("memoryPressure")` to call it.
- **Both** `execute` and `executeAsync` go through the cache.

## Completion criteria

1. `bun run typecheck` green; full `bun run test:unit` green solo (evaluator change → broad regression per learnings).
2. New unit tests (`interpreter-parse-cache.test.ts`): repeated execute re-EVALUATES (same source, different results after state change); distinct sources don't collide; macro redefinition after a cached parse takes effect on the next dispatch; syntax errors aren't cached (same error twice); sourceName keying separates entries; LRU evicts past the cap; `clearParseCache()` empties it.
3. Micro-benchmark (same-process interleaved pre/post, min-of-runs): repeat-dispatch cost drops ~78–82% (cache hit ≈1.1–1.5µs vs ≈6.2µs re-parse, load-12 host); numbers + methodology recorded in the ADR (target was ≥25%).
4. `bun run test:integration` green; CI green on the branch (covers tmax-use).
5. ADR-0261 + index line, including the corrected cost model (the 95% lore is dead).

## Out of scope

Eval-phase optimizations (symbol lookup, builtin dispatch dominate remaining cost), buffer-text AST caches (`caches.ts` already has them), memoryPressure wiring (#243), M-x completions orchestration (#236).
