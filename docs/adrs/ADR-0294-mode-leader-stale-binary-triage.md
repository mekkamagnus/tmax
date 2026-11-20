# ADR-0294 — #299 triage: the [typescript] leader death was a stale binary (#299)

- **Status**: Accepted
- **Date**: 2026-11-21
- **Issue**: #299
- **Spec**: SPEC-268

## Context

Live 2026-11-20: in [typescript] buffers the SPC leader died and command
mode errored `Undefined symbol: editor-dispatch-command-line`;
fundamental buffers were unaffected. Competing causes: stale binary,
module-load failure (the BUG-60 swallow class), typescript-keymap
shadowing.

## Decision

Triage per the issue's protocol, executed with recorded binaries: the
LIVE binary (rebuilt 17:25, after the live session) and an ISOLATED
worktree clean build both pass every scenario — leader arms and consumes
in [typescript] and fundamental in the SAME daemon, `:q` dispatches and
quits, zero module-load errors in stderr. Root cause: **stale/poisoned
binary** (the rapid-successive-build:tmax class already in learnings);
the 17:25 rebuild healed it. Keymap and module-load causes excluded by
the evidence.

The durable regression is the **mode-leader canary**
(test/unit/mode-leader-canary.test.ts): across typescript / markdown /
lisp / fundamental it asserts the leader arms + consumes, command mode
builds + dispatches, and the dispatch symbol resolves — turning both
residual failure classes (keymap shadowing, loadCoreBindings swallow)
red at test time.

## Consequences

- No production code changes: the live binary was already healed by the
  rebuild; the fix class is procedural (clean rebuild on the
  poisoned-binary symptom — already a learnings rule).
- The canary adds ~4 tests, one per shipped mode, and doubles as the
  module-load swallow tripwire for any future .tlisp chain break.
