# Test Isolation — Unit Tests Must Not Write to the Real agents/ Directory

## Status

Accepted

## Context

The adw orchestrator unit tests (`test/unit/adw-pipeline.test.ts`, `test/unit/adw-pipeline-loop.test.ts`) exercise `runPipeline` with mocked subprocess deps but point the module's `AGENTS_DIR` constant at the **real** `process.cwd() + "/agents"` directory rather than a per-test temp directory. The test files even acknowledge this in a comment (`adw-pipeline.test.ts:5` — "state files written by runPipeline (which uses the real AGENTS_DIR — these [are left behind]").

Consequence observed on 2026-06-23: a single full-suite run of `bun run test:unit` had littered **1,149 fake workspace directories** into the real `agents/` folder. Each fake workspace carries a bogus spec path (`/abs/spec.md`) and description (`"add a feature"`), and `status: failed`. This:

- Pollutes `agents/` with test garbage that accumulates across every suite run (1,149 dirs grew over weeks of local development; CI runs would compound it).
- Confuses operational status checks — a human or watchdog scanning `agents/*/adw-state.json` for stale workspaces sees 1,149 false positives.
- Can collide with real workspace ids (ULID-timestamp collisions are unlikely but the namespace is shared).
- Undermines test hermeticity — a test's outcome can depend on leftover state from a prior run.

This is the same class of bug as BUG-16 (server tests leaking sockets into `/tmp`): tests that exercise real I/O paths without isolating the filesystem. BUG-16 fixed the server tests; this ADR establishes the policy and BUG-17 fixes the pipeline tests.

## Decision

**Unit tests that exercise filesystem-writing code paths must use a per-test temp directory, never the real project `agents/` (or any other production) directory.** Concretely:

1. **`mkdtempSync(join(tmpdir(), "<test-name>-"))` in `beforeEach`** (or `beforeAll` for read-only suites), producing an isolated `AGENTS_DIR` for that test run.
2. **`rmSync(tmpDir, { recursive: true, force: true })` in `afterEach` / `afterAll`** so nothing leaks even if the test crashes.
3. **Inject the temp dir** into the module under test via the existing dependency-injection seam (`PipelineDeps`, `TesterDeps`, etc.) rather than monkey-patching a module-level `AGENTS_DIR` constant. The orchestrator already accepts injected deps; the tests were bypassing the seam by writing state via a helper that hardcodes the real path.
4. **No test may call `runPipeline` / `runTest` / `runBuild` against the real `agents/`.** The dependency-injected `AGENTS_DIR` (or equivalent) is the only sanctioned path.

The reference pattern already exists in the suite: `test/unit/builder.test.ts:24` does it correctly (`tmp = mkdtempSync(join(tmpdir(), "builder-test-"))`). The pipeline tests must match it.

## Consequences

**Easier:** `agents/` stays clean — no test garbage, no false positives in status scans, no namespace collision risk. Tests become hermetic: a test's outcome depends only on its inputs, not on leftover state. The watchdog (SPEC-066) can trust `agents/*/adw-state.json` scans without filtering out test fixtures.

**Harder:** Each test that writes state must set up and tear down a temp dir — a few lines of boilerplate per test file. The dependency-injection seam must actually be used (some tests currently reach into module internals via a shared `AGENTS_DIR` constant; those need rewiring to the injected path). Slightly slower suite startup (temp-dir creation), but negligible (~ms per test).

**Related:** BUG-17 (the fix implementing this policy for the pipeline tests), BUG-16 / ADR-0103 (the server-test socket-leak fix — same bug class, different subsystem), ADR-0101 (the test stage that runs the suite and would propagate the leak into CI), SPEC-066 (the watchdog whose `classifyWorkspace` scan would be polluted by the fake workspaces).
