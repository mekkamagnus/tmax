# SPEC-208: make-process :cwd / :env + serialized filter dispatch

**Issue:** #208 (fikra-p0 / RFC-027 §D3, §D7, §Phase 0)
**Status:** Implemented 2026-08-21

## Goal

Upgrade `make-process` (src/editor/tlisp-api.ts) with the two capabilities
fikra threads need: spawn in a given working directory with a merged
environment, and guaranteed arrival-order dispatch of filter/sentinel evals.
Unblocks Phase 1 (project-root cwd) and Phase 4 (worktree cwd).

## Completion Criteria

- [x] `:cwd <string>` sets the process working directory (verified: `/bin/pwd`
      in a tmpdir reports the dir; macOS realpath normalization handled).
- [x] `:env` takes a T-Lisp list of `("KEY" "VALUE")` pairs MERGED over the
      inherited environment (merge, not replace — PATH lookups must survive;
      verified: custom var visible AND `${PATH:+PATH-OK}` fires).
- [x] Validation: non-string `:cwd`, non-list `:env`, malformed pairs → errors.
- [x] Filter dispatch serialized per process: every chunk's evalTlisp runs to
      completion before the next chunk's eval begins; the sentinel runs after
      ALL filter evals (pinned: sentinel records the chunk count it observed ≥2
      and the joined chunk sequence is exactly in-order).
- [x] A throwing filter eval is logged (logProgram error) and does not kill
      the stream or the sentinel (pinned: chunk 2's filter throws; chunks 1
      and 3 recorded; sentinel ran).
- [x] `bun run typecheck` (all projects) green; targeted blast-radius suites
      green (evaluator ×6, core ×3, fikra ×2, comint, buffer-append: 176/176).

## Discovered and fixed en route: keyword self-evaluation

The issue body's expected call shape `(make-process :command ...)` could
NEVER work: the evaluator had no keyword-symbol rule, so every unquoted
`:command` died with `UndefinedSymbol` before reaching the primitive —
including the existing fikra backend-claude adapter (latent breakage).
Fixed at the language level (CL semantics): symbols starting with `:` self-
evaluate (src/tlisp/evaluator.ts, evalSymbol). Blast radius verified green
(see above); the change also unbreaks `http-request` kwarg callers.

## Tests

`test/unit/process-ops.test.ts` — 5 tests (cwd, env-merge, validation,
serialized ordering + sentinel-last, throwing-filter resilience).

## Notes

- Pre-existing failures during verification (chore44-baseline-inventory ×3,
  markdown-module-boundaries) are stash-attributed to main and filed under
  #227's drift family — not caused by this change.
