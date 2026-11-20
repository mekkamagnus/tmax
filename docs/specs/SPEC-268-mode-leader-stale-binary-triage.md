# SPEC-268 — SPC leader dead in [typescript] buffers: triage (#299)

## Goal

Execute #299's triage protocol (hypotheses: stale binary | module-load
failure | keymap shadowing) and close with a named root cause + a
behavioral regression.

## Triage evidence (recorded 2026-11-20)

| Check | Live binary (main dist/tmax, 17:25, sha 0169cbc7…) | Clean worktree binary (isolated build, sha 1dc64244…) |
|---|---|---|
| [typescript] SPC leader | arms ("SPC-") + `a` consumed — 3/3 fresh-daemon attempts | arms + consumes |
| [typescript] `:q` Enter | dispatches; daemon exits cleanly | dispatches; daemon exits cleanly |
| Fundamental buffer, same daemon | arms + consumes | arms + consumes |
| Module-load errors (stderr) | 0 ("Core bindings and init file loaded") | 0 |

Per the issue's own decision rule — the failure VANISHES on the clean
binary AND no module-load errors are present — the root cause is NAMED:
**stale/poisoned binary** (the learnings' rapid-successive-build:tmax
class; the 2026-11-20 live session predates the 17:25 rebuild that healed
the live system). Keymap shadowing is excluded (the [typescript] chain
loads — modeline + syntax + leader all active); module-load failure is
excluded (zero stderr errors, symbol resolves, dispatch works).

## Completion criteria

- [x] Triage executed with recorded binaries/mtimes/shas + clean rebuild
      in an ISOLATED worktree; the same-daemon A/B documented in the issue
- [x] Root cause NAMED with evidence (stale binary) + its regression filed
- [x] A behavioral regression test lands: the mode-leader canary
      (test/unit/mode-leader-canary.test.ts) — leader arms + consumes,
      `:` builds + Enter dispatches, and the
      `editor-dispatch-command-line` symbol resolves, across typescript /
      markdown / lisp / fundamental. Guards BOTH residual failure classes
      (keymap shadowing and the loadCoreBindings swallow).
