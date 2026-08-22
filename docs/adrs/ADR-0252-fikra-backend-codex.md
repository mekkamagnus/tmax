# ADR-0252: Fikra backend-codex — recorded shapes, per-line JSON sanitization

**Date:** 2026-08-22
**Status:** Accepted
**Issue:** #224
**Spec:** SPEC-224

## Context

The second backend (Codex CLI) joins the adapter registry. #222 hardened
the claude adapter's turn pattern (per-thread state, pid dispatch, routed
emits); #219 recorded the actual 0.147 flag surface, correcting this
issue's pre-recording fallback matrix.

## Decision

1. **Record the wire shapes before writing the normalizer** (the #219
   discipline): three live `codex exec --json` runs captured every event
   type we map. Fixtures in the tests ARE those recorded lines — CI needs
   no CLI.
2. **Per-line JSON sanitization over an engine fix**: T-Lisp's
   `json-read-from-string` rejects backslash escapes (returns NIL) — real
   codex output is full of them. A manual char-scanner flattens escape
   pairs and real control chars per EXTRACTED line: structural newlines
   stay line boundaries (split first, sanitize per line), string-internal
   ones flatten. Content-preserving enough for FAEP summaries; a proper
   JSON reader fix is engine work for another day.
3. **The #222 turn pattern is the backend template**: per-thread maps,
   pid→thread dispatch with unknown-pid DROP + resident entries,
   thread-routed emits, background sentinels settling their own thread.
   New backends copy this shape — cross-thread isolation is inherited.
4. **Turn lifecycle ownership stays ours**: codex's turn.started/
   turn.completed events are ignored; the PROCESS EXIT (our sentinel) is
   the authoritative turn end — one owner, no double-end.
5. **Capabilities are honest**: interactive-approvals nil (Codex L2 needs
   the app-server protocol — deferred), sandbox-presets t, session-resume
   t (thread.started's thread_id IS the resume handle).

## Consequences

- Backend switching to codex works today (probe + registry + forced
  seam); L1 runtime modes translate per the recorded surface.
- The sanitizer means summaries lose exact whitespace of escaped content
  — acceptable for FAEP rendering; the full fidelity fix rides an engine
  JSON-reader upgrade.
- A latent #223 note: plan capture uses json-read on OUR json-encode
  output — multi-line plan text embeds `\n` escapes and those lines
  currently drop from capture. Same sanitizer treatment is the fix when
  observed in practice.
