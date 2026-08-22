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
   chokepoint, from ATTACHED-FRAME provenance.** `computeResolverKind`
   (pure, exported, unit-tested): `keypress` with a frameId the daemon
   knows → "interactive"; frameless/unknown-frame keypresses and `eval`
   → "headless"; everything else preserves ("unknown" = embedded
   startup). Method-name self-declaration alone is NOT trust (gate
   round-1 catch: any same-uid process can write a raw keypress
   JSON-RPC). There is deliberately NO T-Lisp setter
   (`confirmation-resolver-kind` is read-only).
2. **Enforcement lives at the PRIMITIVE, layered with the wrapper.**
   `ConfirmationService.resolve()` refuses headless resolvers under the
   default `interactive-only` policy — the request stays pending, the
   attempt audited. The wrapper (`fikra-approval-answer` +
   `fikra-approval-resolve-guard`) enforces the same policy at the UI
   layer and provides the user-visible denial message. A bypass of
   either layer alone is insufficient (gate catch: the raw
   `confirmation-resolve` op was an open bypass).
3. **The escape hatch is provenance-checked in both layers.**
   `confirmation-set-resolve-policy "permissive"` and
   `fikra-set-approval-guard` both REFUSE headless callers — an
   eval-reachable agent cannot unlock its own approvals; init.tlisp
   (startup) and interactive contexts can, deliberately.
4. **Denial leaves the prompt pending.** A headless resolve returns
   denied without settling the parked mediate — the subprocess stays
   parked (until the daemon timeout rejects or an interactive client
   answers). Never a silent settle.
5. **Correlation is the minted one-time token + scope liveness.** The
   service validates token authenticity (forged/stale/cross-source,
   Phase 0). Fikra validates scope liveness — the scope must name the
   current thread + live turn + mid-turn status — and rejects dead
   correlations BEFORE any prompt. The scope travels to the registered
   handler (mechanism extension: 4th handler arg).
6. **Residual boundary is same-uid (documented, not hidden).** A
   determined same-uid process can connect-frame then send attached
   keypresses, emulating a TUI. Same-uid is the RFC's stated boundary for
   ALL tmax RPC; the default policy blocks the trivial surfaces (eval,
   frameless keypress), and presence requirements are the guard
   override's territory.
7. **The bridge is generic and disposable.** `tmax-mcp-confirmation`
   carries source+token in argv (written into the `--mcp-config` by the
   adapter — the token never transits model-controlled space), defaults
   to the standard daemon socket, and maps every failure to a REJECTED
   tool call (the agent proceeds safe, never hangs).
8. **Capability-gated, not assumed.** `--permission-prompt-tool` is
   probed; the recorded claude 2.1.195 surface lacks it, so claude
   degrades to L1 + turn-boundary review. The wiring is complete and
   pinned behind the probe; a future CLI gaining the hook lights it up
   with no code change.
9. **`always` is durable**: writes #219's thread trust, which the claude
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
