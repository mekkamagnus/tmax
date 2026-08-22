# ADR-0245: Fikra L2 approvals — interactive-frames-only resolution

**Date:** 2026-08-22
**Status:** Accepted
**Issue:** #220
**Spec:** SPEC-220

## Context

RFC-027 §D5 L2 + §Security: mid-turn approvals need the subprocess to ask
and the user to answer in `*Fikra*`. The deferred-confirmation mechanism
(#210) is generic and policy-free. The security threat: an agent with
Bash access can spawn `tmaxclient --eval "(confirmation-resolve ...)"` and
approve its own pending request. The RFC's default policy:
interactive-frames-only — headless clients cannot resolve; `always`
requires an interactive client unconditionally.

## Decision

1. **The resolver-kind FACT is stamped TS-side, at the daemon dispatch
   chokepoint.** `server.ts processRequest` stamps
   `confirmationService.resolverHint`: frame-scoped `keypress` →
   "interactive", `eval` → "headless". There is deliberately NO T-Lisp
   setter (`confirmation-resolver-kind` is read-only): eval-reachable
   code must not be able to self-mark interactive. The guard itself is
   T-Lisp (`fikra-approval-resolve-guard`) so users can override it — via
   `fikra-set-approval-guard`, a deliberate setter (module defvars are
   not setq-able cross-module), never an accident.
2. **Denial leaves the prompt pending.** A headless resolve returns
   denied without settling the parked mediate — the subprocess stays
   parked (until the daemon timeout rejects or an interactive client
   answers). Never a silent settle.
3. **Correlation is the minted one-time token + scope liveness.** The
   service validates token authenticity (forged/stale/cross-source,
   Phase 0). Fikra validates scope liveness — the scope must name the
   current thread + live turn + mid-turn status — and rejects dead
   correlations BEFORE any prompt. The scope travels to the registered
   handler (mechanism extension: 4th handler arg).
4. **The bridge is generic and disposable.** `tmax-mcp-confirmation`
   carries source+token in argv (written into the `--mcp-config` by the
   adapter — the token never transits model-controlled space), defaults
   to the standard daemon socket, and maps every failure to a REJECTED
   tool call (the agent proceeds safe, never hangs).
5. **Capability-gated, not assumed.** `--permission-prompt-tool` is
   probed; the recorded claude 2.1.195 surface lacks it, so claude
   degrades to L1 + turn-boundary review. The wiring is complete and
   pinned behind the probe; a future CLI gaining the hook lights it up
   with no code change.
6. **`always` is durable**: writes #219's thread trust, which the claude
   adapter promotes to `--allowedTools` on every subsequent turn.

## Consequences

- Remote approval works through an ATTACHED TUI (including SSH) — the
  t3code-parity feature — but never through the eval surface an agent
  child process can drive.
- The daemon's single-editor-per-process model makes the process-wide
  resolverHint safe (serialized dispatch; no interleaving).
- Trust writes are FAEP-audited (permission-response events), never
  silent.
- Turn-boundary review (checkpoints) remains the always-on net.
