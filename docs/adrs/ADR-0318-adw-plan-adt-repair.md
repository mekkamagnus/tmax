# ADR-0318 — The adw runner scripts join the typechecked surface

**Issue:** #337 · **Spec:** [SPEC-337](../specs/SPEC-337-adw-plan-adt-regression.md)
**Status:** accepted · **Date:** 2026-11-22

## Context

CHORE-61 (`100c040c`) retired `src/utils/adt.ts` as dead code
("imported by NOBODY") — but `adws/adw-plan.ts:30` imported its
`match`. The contradiction survived because **no typecheck project
covers `adws/`**: the base `tsconfig.json` lists `adws/**/*`, but
the per-project configs the typecheck scripts actually run
(`tsconfig.{src,test,tmax-use,bench}.json`) all omit it. The
breakage only surfaced at runtime — every free-text adw pipeline
died at stage 1 ("probe exited before announcing", three red
cleanup-probe tests on clean main).

## Decisions

1. **The call sites switch on `kind` directly.** The retired
   matcher keyed on `_tag`; `DispatchOutcome` carries BOTH `_tag`
   and `kind`. The repair uses `kind` (the discriminator CHORE-61's
   standardized plain unions use) — two sites: the dispatch event
   construction and the spec-path extraction. The vestigial `_tag`
   fields stay (removing them would touch the constructors; noted
   as out of scope).
2. **`adws/**/*` joins `tsconfig.test.json`'s include.** The root
   cause was the coverage gap, not just the stale import — the same
   class of breakage (a module deleted under an untypechecked
   consumer) would recur. Verified clean across the whole tree;
   zero blast radius. `typecheck:test` (CI's project) now guards
   the runner scripts.

## Consequences

- `bun adws/adw-plan.ts` starts; free-text pipelines work again;
  the SIGTERM/SIGHUP probe tests (exit 143/129) are green.
- Any future adw edit that breaks compilation fails
  `typecheck:test` instead of dying at runtime mid-pipeline.
