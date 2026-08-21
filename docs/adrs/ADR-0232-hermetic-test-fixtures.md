# Hermetic test fixtures for environment-dependent tests

## Status

Accepted (2026-08-21, #198 item 1 / [SPEC-198a](../specs/SPEC-198a-hermetic-file-completion.md))

## Context

CI (post hang-fix, ~5-minute runs) failed fast on tests that assert the
machine's environment: `file-completion.test.ts` asserted the CHECKOUT's cwd
listing ("src", "package.json"), which differs on runners. The
halt-on-first-failing-batch unit runner then masked every later suite.

## Decision

Environment-dependent tests run against a temp fixture created in `beforeAll`
(mkdtemp + the exact entries the assertions reference), `process.chdir` into
it for the file's duration, and restore cwd + remove the fixture
unconditionally in `afterAll`. Bun's per-file test worker isolation makes the
chdir safe; no cross-file parallelism shares the process.

## Consequences

- The file-completion batch passes identically on any machine; test-bun can
  proceed past it on runners (the "short tail" of remaining env-dependent
  tests surfaces one per CI run — each gets the same treatment).
- New rule of thumb for this board: a test that reads the ambient filesystem
  (cwd listing, $HOME, /tmp residue) is a #198-family defect, not a flake.
- #198 items 2 (playbook runner failures — need CI evidence) and 3
  (key-bind-enhancements behavioral decision — needs the user) remain open.
