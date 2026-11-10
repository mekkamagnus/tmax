# SPEC-243 — Daemon reacts to `process.on("memoryPressure")`

**Status:** in progress (branch `issue-243`); lands on main only after
verify-gate PASS + CI green (ADR-0270)
**Issue:** [#243](https://github.com/mekkamagnus/tmax/issues/243)
**Base:** `main` @ `7a166c4`

## Goal

Register Bun 1.4's OS memory-pressure notification (`process.on("memoryPressure")`,
levels `"warning" | "critical"` per bun-types) in the daemon and drop
re-derivable caches when it fires, so the OS reclaims daemon memory before it
kills the long-running process. Complements the runtime's own 1.4.4 memory
reduction.

## Ground truth

- The daemon (`TmaxServer`) holds one editor → one T-Lisp interpreter. The
  interpreter's parse cache (#234, LRU-256 of ASTs) is the large re-derivable
  allocation; `clearParseCache()` already exists and its docstring names this
  issue ("Hook for memory-pressure wiring (#243)").
- Bun types (`node_modules/bun-types/overrides.d.ts`): listener receives
  `level: "warning" | "critical"`.
- Registration site: `startSocket()` already registers SIGTERM/SIGINT there.

## Decision

1. **Drop re-derivable caches only.** On any memoryPressure event (either
   level — the parse cache costs ~5 µs/form to rebuild, so dropping early is
   harmless), clear the interpreter parse cache. Never touch user state
   (workspace/buffer snapshots are persisted save data, not caches).
2. **Wiring**: `TmaxServer` gains `handleMemoryPressure(level)` (public, for
   direct testing) + an auto-bound class-property handler registered in
   `startSocket()` next to SIGTERM/SIGINT and removed in `shutdown()` — test
   servers in one process must not accumulate listeners. The handler body is
   defensive: optional-chained accessors, try/catch around the clear — a
   memory-pressure hook must never throw.
3. **Observability**: each event is recorded via
   `editor.logDaemonEvent('memory-pressure', …)` (the SPEC-047 daemon event
   buffer) with the level and the number of dropped parses.
4. **Considered, not adopted** (recorded in ADR): clearing the
   ModuleRegistry export cache (one array, self-invalidating — negligible
   reclaim) and the *Messages* log-store render cache (small strings, lazy
   re-render already). The issue's "buffer snapshots" are persisted user
   state, explicitly NOT droppable.

## Completion Criteria

1. `startSocket()` registers a `"memoryPressure"` listener (both Bun levels
   handled) that clears the interpreter parse cache; `shutdown()` removes the
   listener.
2. The handler is safe: no editor / empty caches / either level never throws
   (defensive body), and the event is logged to the daemon event buffer.
3. Tests pin the behavior: (a) primed parse cache is emptied by
   `process.emit("memoryPressure", "critical")` through the real registered
   wiring; (b) listener count returns to baseline after `shutdown()`;
   (c) direct `handleMemoryPressure("warning")` on a fresh server is a no-op
   that does not throw.
4. `git diff main..issue-243` touches only: `src/server/server.ts`, the new
   test file, spec/ADR/index docs. (The working tree's `docs/rfcs/index.md`
   edit is the user's, never staged.)
5. Verification green: typecheck:src + typecheck:test clean;
   `bun test test/unit/server-memory-pressure.test.ts` green;
   `bun test test/unit/server-daemon-hardening.test.ts` still green
   (same-file-family socket semantics untouched);
   `bun test test/unit/interpreter-parse-cache.test.ts` still green.
