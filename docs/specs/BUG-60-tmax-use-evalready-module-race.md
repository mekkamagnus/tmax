# Bug: tmax-use `evalReady` gate does not wait for T-Lisp module load → intermittent "Undefined symbol" under load

> ## ⚠️ ROOT-CAUSE CORRECTION (verify-gate finding, 2026-08-03) — supersedes the async-race framing below
>
> The **async-race premise of this spec is DISPROVEN.** `server.ts start()` is sequential —
> `await startEditor()` (which synchronously runs `loadCoreBindings` → the `(require-module …)`
> chain via synchronous `interpreter.execute`; `loadModuleFromDisk` returns `Either`, not a
> `Promise`) runs **before** `await startSocket()` (`server.ts:1055-1058`). The socket file
> therefore **cannot appear until `find-file` is already registered** — there is no race between
> `evalReady` and module load on the spawned-daemon path.
>
> The **real root cause** of the observed `Undefined symbol: find-file` is `loadCoreBindings`
> **swallowing module-load errors** (`src/editor/runtime/binding-runtime.ts:148-159`: on a required-
> binding load failure it `console.warn`s + `loadFallbackBindings()` + sets `coreBindingsLoaded(true)`
> regardless). A parse error in a required `.tlisp` left `find-file` undefined while the daemon
> started normally. The specific observed instance was the **`find-file.tlisp` stray-paren parse
> error during SPEC-071..085 work, fixed in `a448b70`** — so *that* flake is already gone.
>
> **Re-scoped fix (the actual remaining work):** make `loadCoreBindings` **fail loud** (or surface a
> clear error to eval clients) when a **required command module** fails to load — instead of silent
> fallback — so a future `.tlisp` parse error produces a clear start failure, not a cryptic
> `Undefined symbol` later. Plus a regression test (a `.tlisp` with a syntax error in a required
> binding → daemon start fails clearly). Keep the keymap fallback (intentional resilience); only
> required **command** modules should fail-loud.
>
> A `moduleReady`-gate approach (`instance.ts` poll for `find-file`) was implemented + **rejected by
> the verify-gate** as wrong-target: it would mask the symptom (timeout vs Undefined symbol) for the
> `find-file` case but does not fix the swallowed-error root cause, and the race it targets does not
> exist (the gate succeeds on the first poll for any correctly-started daemon). Not landed.

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
