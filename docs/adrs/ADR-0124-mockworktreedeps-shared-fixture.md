# ADR-0124 — Shared mockWorktreeDeps test fixture (#35)
## Status: Accepted
## Context: mockWorktreeDeps was duplicated with drift across 3 adw test files (path "/mock" vs "/mock/worktree").
## Decision: Factory `createMockWorktreeDeps()` in test/helpers/adw-test-fixture.ts returning a fresh object per call (no shared mutable state). Unified path to "/mock/worktree". pipeline-loop's mockWorktreeDepsConfigurable left local (not duplicated).
## Consequences: Removes ~40 lines of duplication; closes drift; codex APPROVE; typecheck clean + 58/0 tests.
