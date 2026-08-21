# make-process :cwd/:env and serialized filter dispatch; keyword self-evaluation

## Status

Accepted (2026-08-21, #208 / [SPEC-208](../specs/SPEC-208-make-process-upgrades.md))

## Context

fikra threads must spawn backends in a specific working directory (project
root now, worktree roots in Phase 4) with a controlled environment, and the
FAEP pipeline depends on chunk evals running in arrival order. `make-process`
had neither: no cwd/env control, and filter evals were fired without awaiting
— two chunks' evals could overlap whenever evalTlisp is async. Writing the
tests exposed a third, older break: unquoted keyword arguments (`:command`)
died with UndefinedSymbol because the evaluator had no keyword rule — the
documented call shape, including fikra's own backend-claude adapter, could
never have run.

## Decision

- `make-process` gains `:cwd <string>` and `:env (("KEY" "VALUE") ...)`.
  Environment entries MERGE over the inherited environment — full
  replacement would break PATH lookups for thin commands.
- Filter evals are serialized per process on a promise chain with backpressure
  (the reader awaits the chain before the next chunk's eval); the sentinel
  chains after ALL filters; a rejected filter eval is logged via logProgram
  and does not kill the stream.
- Language rule (src/tlisp/evaluator.ts): symbols starting with `:`
  self-evaluate, per Common Lisp keyword semantics.

## Consequences

- The documented `:key value` kwarg shape now actually works; fikra's
  backend-claude adapter is un-broken at the call-shape level.
- Keyword symbols can no longer be used as ordinary variable names — none
  exist in the codebase (grep-verified), and CL semantics make the surprise
  minimal.
- `http-request` kwarg callers benefit from the same fix.
