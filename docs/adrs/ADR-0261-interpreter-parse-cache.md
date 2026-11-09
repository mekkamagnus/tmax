# Cache successful parses in the T-Lisp interpreter

## Status

Accepted (2026-11-10) — resolves #234 / SPEC-234. Child of the bun-v1.4.4-upgrade cluster (#233, landed).

## Context

`TLispInterpreterImpl.execute` re-tokenized and re-parsed its source string on every call. Command dispatch re-executes the same strings constantly — keybinding bodies fire on every key press, M-x expressions on every filter keystroke — so every dispatch paid a fixed parse cost for source that never changes.

The perf-arc lore ("parse is ~95% of eval cost") overstated it, but fresh measurement confirms parse **dominates small-form dispatch**: for the binding-body shape `(progn (+ 1 2) (+ 3 4))`, execute ≈ 6.2–6.9µs of which parse ≈ 5.1µs (~80%); for a user-fn call shape, ~27%. Parse is a fixed ~4–9µs per dispatch, removable on repeat.

Safety was the real question, and it resolved cleanly: **T-Lisp has no in-place value mutation.** There are no rplaca/nconc/vector-set-style primitives (grep-verified, zero hits), the evaluator constructs fresh values at all 22 result-construction sites and never writes into parsed nodes, and TCO wraps expr nodes in `TailCall` results without mutating them. So sharing parsed ASTs across executes is safe — even `quote` returning an AST node as a value, because nothing can mutate it. Macros are safe by construction too: only the *unexpanded* parse is cached; expansion happens at eval, so redefining a macro changes the very next dispatch.

## Decision

**Per-interpreter LRU parse cache, 256 entries, keyed by `sourceName + "\0" + source`.**

- `parseProgramCached` (private) fronts both `execute` and `executeAsync`. Cache hits LRU-refresh (delete + re-insert so Map insertion order tracks recency); misses parse, then store only successful **non-empty** parses (syntax errors and empty programs are never cached). Over the cap, the oldest entry evicts.
- The `\0` separator makes the key unambiguous (a space separator would let `("a b", "c")` collide with `("a", "b c")`).
- `clearParseCache()` / `parseCacheSize()` are exposed (optional members on `TLispInterpreter` — the impl is the sole implementer). `clearParseCache` is the drop hook #243's memory-pressure wiring will call.
- Bounded at 256: command bodies are a few dozen strings, so real workloads sit far below the cap; the bound exists so unbounded user evals (M-x expressions) can't grow the cache indefinitely.

Pinned by `test/unit/interpreter-parse-cache.test.ts` (10 tests): cache hits still RE-EVALUATE (accumulators advance on repeat dispatch, sync and async), distinct sources don't collide, macro redefinition after a cached parse takes effect on the next dispatch, syntax errors and empty programs are never cached, sourceName participates in the key, LRU caps at 256 with evicted sources re-parsing correctly, and `clearParseCache` empties it.

## Benchmark evidence (and how not to measure)

Same-process interleaved pre/post (a `git show`-recovered pre-change interpreter imported alongside the new one), min-of-runs, on a load-average-12 host:

- repeat dispatch, binding-body shape: **≈6.2µs (re-parse) → ≈1.1–1.5µs (hit) — ~78–82% reduction**
- user-fn shape: 17.8µs → ≈3µs
- cache-miss overhead vs pre-change execute: negligible (miss ≈ 6.3µs steady-state below the cap; eviction churn at the pinned cap ≈ +2µs)

Methodology notes worth keeping: unbound-symbol probes measure the error path, not eval (parse share misreads 11%); this host swings single probes ±7× under load — one run showed pre-change execute at a "false-cheap" 1.0µs (scheduler dip), which would have "disproven" the whole premise. Same-process interleaving + reporting machine load is the reliable method.

## Consequences

- Repeat command dispatch (keys, M-x) drops its parse cost entirely; the remaining per-dispatch cost is eval (symbol lookup, builtin dispatch) — the next optimization target if needed.
- Parsed ASTs are shared across executes of the same source. Any future primitive that mutates values in place (rplaca-style) would break this contract — the parse-cache tests plus the evaluator suite are the tripwire.
- Module loads and one-shot evals see no benefit but pay only a key-concat + Map probe (~0.1µs).
- #243 (memoryPressure) gets its cache-drop hook; wiring is that issue's scope.
- Gates: `bun run typecheck` (4 projects) ✅; new `interpreter-parse-cache.test.ts` 10/10 ✅ (25 expects — the LRU-refresh test is mutation-proven: removing the refresh delete/re-insert lines makes it fail); full `bun run test:unit` solo ✅ — **55/55 batches passed, 0 fail, exit 0** (population includes the new file; #233's baseline was 3,543 tests / 54 batches); `bun run test:integration` solo ✅ — **82/82 pass, 0 fail** (10.42s); CI green on `issue-234` (run cited in the issue close comment). The cluster's codex review lives on parent issue #233.
