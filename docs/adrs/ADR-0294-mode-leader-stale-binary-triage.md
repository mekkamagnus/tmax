# ADR-0294 — #299 triage: the [typescript] leader death was a stale binary (#299)

- **Status**: Accepted
- **Date**: 2026-11-20
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
(test/unit/mode-leader-canary.test.ts): across a representative 13 of
the 22+ registered file-backed modes (typescript / markdown / lisp /
text / go / python / json / yaml / rust / html / css / sql / shell) it
asserts the leader arms + consumes, command mode builds + dispatches,
and the dispatch symbol resolves — turning both residual failure classes
(keymap shadowing, loadCoreBindings swallow) red at test time.

## Consequences

- No production code changes: the live binary was already healed by the
  rebuild; the fix class is procedural (clean rebuild on the
  poisoned-binary symptom — already a learnings rule).
- The canary adds 13 tests (a representative mode spread, not an
  exhaustive enumeration) and doubles as the module-load swallow
  tripwire for any future .tlisp chain break.
- Epistemics: the stale-binary attribution is inferential — the
  poisoned artifact was never captured (the 17:25 rebuild preceded
  triage), so the A/B compared two healthy binaries; the naming rests
  on the issue's decision rule as written plus the learnings precedent
  with the identical symptom signature (partial binding load, rebuild
  healed) and 3/3 same-session non-reproduction.
