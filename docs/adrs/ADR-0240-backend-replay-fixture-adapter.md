# backend-replay: the keyless-CI fixture adapter

## Status

Accepted (2026-08-22, #215 / [SPEC-215](../specs/SPEC-215-backend-replay.md))

## Context

FAEP/threads/backends need deterministic CI tests — no network, keys, or
CLI installs — and the BUG-60 swallowed-parse-error failure mode needs a
guard (a broken .tlisp module must fail tests, not ship silently).

## Decision

`fikra/backend-replay` loads a fixture of raw JSONL lines (the exact wire
shapes backend-claude normalizes) split into chunks on `###` separators.
start-turn feeds the next chunk through backend-claude's REAL line
accumulator (reset via a test seam) — the identical-pipeline guarantee:
replay exercises the same drain, normalize, FAEP batch emission, and
session-id recording the live filter runs. Turns are synchronous
(begin → feed → end completed); past-fixture turns end empty. The
module-load guard covers BOTH layers: parseProgram for parse, and a fresh
editor's require-module per module for LOAD — the layer where the BUG-60
stray-paren class actually fails.

## Consequences

- #216 (chat UI), #219 (L1 fixture matrices), #220 (approval replay tests)
  build keyless suites on this backend.
- The guard's first run surfaced a test-harness fact worth remembering:
  10 editor spins exceed bun's 5s per-test default — the guard runs at 20s.
- The fixture driver ignores its message argument by design (fixtures
  carry the turns) — #216 must not rely on replay for message plumbing.
