# Bug: tmax-use `evalReady` gate does not wait for T-Lisp module load → intermittent "Undefined symbol" under load

## Goals

- Make playbook runs reliably find T-Lisp commands (`find-file`, `save-buffer`, `replace-string`, …) on the **first** eval, even under concurrent daemon load.
- Replace the vague "environmental concurrent-daemon-load" flakiness with a concrete, fixable gate.

## Completion Criteria (Definition of Done)

- [ ] A `moduleReady` gate (or an upgraded `evalReady`) waits until a command defined through `normal.tlisp`'s `(require-module …)` chain resolves — e.g. polls `(if (boundp 'find-file) "MODULES-UP" "WAIT")` until `"MODULES-UP"` — not merely `(+ 1 1)`.
- [ ] `eval-22` / `eval-24` / `eval-36` no longer intermittently fail with `Undefined symbol: find-file` when several playbooks run near-concurrently.
- [ ] A cold-start regression (open a file + call a module-defined command) passes on 20 consecutive fresh daemon starts.
- [ ] `bun run typecheck` + `bun run test:tmax-use` pass.

## Bug Description

`tmax-use/src/instance.ts` (the `evalReady` retry around line 159–165) declares the daemon "ready" as soon as `client.eval('(+ 1 1)')` returns `'2'`. That only proves the **interpreter core** is up — it does **not** prove that `src/tlisp/core/bindings/normal.tlisp`'s `(require-module editor/commands/…)` chain has finished defining commands like `find-file`, `save-buffer`, `replace-string`. That chain loads asynchronously after the core.

Under concurrent daemon load (parallel playbook runs / an agent fleet), the module load loses the race against `evalReady`, so the first real playbook eval hits `Undefined symbol: find-file` (or `save-buffer`, `replace-string`, …). This was observed repeatedly during SPEC-071..085 implementation and is the **concrete root cause** of the "environmental concurrent-daemon-load" condition recorded in `bug24-audit-2026-07-19` memory — it is a missing harness gate, not vague I/O flakiness.

## Problem Statement

`evalReady` (instance.ts:159) polls `(+ 1 1)` only. There is no gate for module/command availability. Reproducer: run several `tmax-use` playbooks in one CLI invocation (or back-to-back under load); a subset fail at their first `(find-file …)` with `Undefined symbol`, then pass when re-run with a warm daemon. The same playbook passes reliably when the module chain is known-loaded.

## Solution Statement

Add a `moduleReady` step after `evalReady` in the instance start path: poll a predicate that requires the `normal.tlisp` require-module chain to have completed — e.g. `client.eval('(if (boundp (quote find-file)) "MODULES-UP" "WAIT")')` until the result is `"MODULES-UP"` (same `retry(count, interval)` shape as `evalReady`). This makes the readiness gate reflect the thing playbooks actually depend on.

## Relevant Files

- `tmax-use/src/instance.ts` — `evalReady` (≈line 159–165) and the start path that chains `socketReady → evalReady → new TmaxInstance`; add `moduleReady` here.
- `src/tlisp/core/bindings/normal.tlisp` — the `(require-module editor/commands/…)` chain whose completion must be gated.

## Severity / Notes

- **Priority:** medium-high. This is the single biggest source of tmax-use unreliability and blocks trusting "every which way" full-suite runs. Fixing it converts a class of intermittent failures into deterministic ones.
