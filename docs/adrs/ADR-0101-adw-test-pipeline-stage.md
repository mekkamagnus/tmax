# adw-test Pipeline Stage — Test as a First-Class Stage

## Status

Accepted

## Context

The adw pipeline (ADR-0094) ran `bun run typecheck:src` and `bun run test:unit` only as silent gates *inside* patch-review (`patch-reviewer.ts:runGates`). This had three problems:

1. **Test failures were buried.** A failing unit test produced the same surface as a spec violation — the operator read the audit verdict to discover a simple typo in a test. There was no dedicated stage, no resolve loop, no structured artifact.
2. **No e2e in the pipeline.** tmax-use playbooks (`tmax-use/playbooks/*.yaml`) and TypeScript e2e tests (`tmax-use/tests/*.tmax-use.ts`) were never run by the pipeline. The build could "pass" while every visual playbook was red.
3. **No self-healing.** A flaky or genuinely-broken test failed the whole pipeline. The existing build↔patch loop only fixed spec gaps, not test failures.

SPEC-063 specified a dedicated test stage; this ADR records the architectural decisions once the stage was implemented and verified end-to-end on workspace `01KVPRP6Y1` (BUG-16) and `01KVNYP3P5` (SPEC-063).

## Decision

Add a **fifth pipeline stage** between build and patch-review:

```
plan → spec-review → build → test → patch-review
```

The test stage (`adws/adw-test.ts` + `adws/adws-modules/tester.ts`) has two sequential tracks:

1. **Unit track** — runs `bun run test:unit`, parses output, and on failure dispatches a focused `claude -p` resolve per failing test, then reruns the full suite. Caps at 2 resolve-then-rerun iterations.
2. **E2e track** — runs only after unit passes. Invokes `bun run test:tmax-use`, which globs `tmax-use/playbooks/*.yaml` + `tmax-use/tests/*.tmax-use.ts`. Same 2-iteration resolve loop.

Key decisions:

- **Unit gates e2e.** If the unit track ends `ok: false`, the e2e track does not run; `e2eSkipped: true` is recorded.
- **Verdict vocabulary reuses patch-review's `pass`/`gaps`.** A `gaps` verdict does **not** hard-stop the pipeline — patch-review still runs and sees `agents/{id}/tester/results.json` as audit input. This matches how patch-review already treats `gaps` (release to completed with unresolved issues, optionally loop-retry).
- **Track failures return `Right`, not `Left`.** Only spawn/claude-missing/write failures return `Left`. This preserves the `Right`/`Left` boundary: a failing test is a stage outcome, not a stage error.
- **The in-audit gates stay.** `patch-reviewer.ts:runGates` still runs typecheck + unit inside patch-review at audit time (the tree may have changed between the test stage and patch-review). The test stage's `results.json` is additional context, not a replacement for live gates.
- **Dependency-injected module, CLI dispatcher.** `tester.ts` imports no `child_process`; it uses injected `run`/`runRaw`/`runCapture`. The dispatcher (`adw-test.ts`) is structurally a sibling of `adw-patch-review.ts` (same `parseArgs` → `runTest()` → `main()` → `import.meta.main` shape, same `<id> <pass|gaps> <spec-path>` stdout contract).

## Consequences

**Easier:** Test failures are self-healed within the pipeline; the build↔patch loop no longer wastes retries on a broken test. Patch-review sees `results.json` and weighs test state alongside spec compliance. The e2e track (tmax-use) is now part of CI, not a manual step.

**Harder:** The pipeline wall-time grows by ~12-20 min per test-stage invocation (the suite is ~777s — see ADR-0104 for the timeout that bounds it). The resolve loop dispatches LLM calls that can themselves stall or misfire; without a stall detector (ADR-0105, proposed) a hung resolve hangs the stage.

**Related:** SPEC-063 (the spec), ADR-0094 (pipeline architecture — now 5-stage), ADR-0102 (tmax-use as sole e2e, which this stage exercises), ADR-0103 (the BUG-16 socket-leak fix that made the unit suite runnable), ADR-0104 (the wall-clock timeout + tree-kill that bounds the stage).
