# Python UI Harness Removal — tmax-use as Sole E2e

## Status

Accepted

## Context

The project had **two overlapping e2e systems** covering the same editor behavior in two languages:

1. **tmax-use** (TypeScript, SPEC-061) — headless-first, playbook-driven (`tmax-use/playbooks/*.yaml`), TypeScript test format (`tmax-use/tests/*.tmax-use.ts`), zero Python.
2. **The legacy Python UI harness** (`test/ui/`) — 25 Python test files, a 13-module `tmax_harness` package, `run_python_suite.py`, a `uv`/`pytest` toolchain the rest of the project doesn't use, and 4 `package.json` scripts (`test:daemon`, `test:ui`, `test:ui:renderer`, `test:ui:helpers`) plus `rules/ui-testing.md` and CI jobs pointing at it.

SPEC-061 originally positioned tmax-use as "complementary" to the Python harness. Once tmax-use was functional (24 playbooks covering the same editor behaviors), the duplication became pure cost: two runners, two assertion vocabularies, a Python toolchain, and a documented unit-suite hang (BUG-16) that was partly caused by Python-harness-era server-test patterns.

## Decision

**Delete the Python UI harness entirely; tmax-use + its playbooks is the sole e2e mechanism.** SPEC-063 Phase 4 specified the removal; this ADR records it as a standing architectural decision.

Removed:
- The entire `test/ui/` tree (25 Python tests, the `tmax_harness` package, `run_python_suite.py`, `pyproject.toml`, `uv.lock`, `.venv/`, `run-tests.sh`, `start-ui-test.sh`, the 4 docs).
- `rules/ui-testing.md` (path-scoped rule for `test/ui/**/*` — dead once the directory is gone).
- The 4 `package.json` scripts (`test:daemon`, `test:ui`, `test:ui:renderer`, `test:ui:helpers`).
- Live references in `AGENTS.md`, `CLAUDE.md`, `README.md`, `.github/workflows/ci.yml`, and the two `.zcode` patch-review/spec-loop skills.

Kept:
- `demos/demo-runner.py` and the `/demo` skill — a visual demo tool, not a test harness.
- Historical specs and ADRs that *document* past harness decisions — they record history, not current behavior, and are not rewritten.

The `/bug`, `/feature`, `/chore` SDLC skills now carry **only** the tmax-use option (the outdated `cd app/server && uv run pytest` line is deleted, not left as a fallback). Every new spec produced by these skills instructs the implementer to author a tmax-use playbook alongside unit tests.

No per-test migration was done — tmax-use's 24 existing playbooks already cover the same editor behaviors the 25 Python tests did. If a coverage gap surfaces post-removal, a separate spec adds the missing playbook.

## Consequences

**Easier:** One e2e language (TypeScript), one runner, one assertion vocabulary, one toolchain (`bun`). The adw test stage (ADR-0101) exercises a single e2e track. New specs get a consistent "author a playbook" instruction from the skills. The Python toolchain (`uv`, `pytest`, `.venv`) is gone from the repo.

**Harder:** If tmax-use has a coverage gap vs the old Python suite, it surfaces as a regression in production rather than as a CI failure. Mitigation: the playbooks are auditable in `tmax-use/playbooks/`; gaps are filed as new specs. Daemon-RPC edge-case tests that lived in `test:daemon` are not directly replaced — if dedicated daemon-RPC tests are wanted, they belong as `tmax-use/tests/*.tmax-use.ts` TypeScript tests (per SPEC-061), not a reconstituted Python suite.

**Related:** SPEC-063 (Phase 4 specifies the removal), SPEC-061 (tmax-use runner contract — now the sole e2e), ADR-0101 (the test stage that exercises tmax-use in CI).
