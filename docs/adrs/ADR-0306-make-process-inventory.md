# ADR-0306 — #294: the process-primitive inventory (as-built)

- **Status**: Accepted
- **Date**: 2026-11-22
- **Issue**: #294 (tracker)
- **Spec**: SPEC-280

## Context

#294 was specced as "build async make-process". The premise was wrong:
the primitive already exists — landed with RFC-027 Phase 0 and hardened
by the fikra FAEP stream (serialized per-process filters, generation
guards, sentinel-driven turn ends). This ADR records the verified
as-built surface and the REAL gaps, each routed to its own issue.

## The as-built surface (verified in `src/editor/tlisp-api.ts`)

- **`make-process`** (line ~1594): argv command + args; `:cwd`, `:env`
  kwargs; a `:filter` callback receiving CHUNKED STDOUT only (NOT
  line-buffered, and NOT stderr — stderr drains into the exit-tail,
  never the filter; the fikra backend's filter itself reassembles
  lines from raw chunks, the #208 serialized-filter contract); a
  `:sentinel` callback (exit-code + pid, fired on the filter chain
  CAPTURED AT PROCESS EXIT — a bounded drain, not a wait for all
  evals: straggler chunks keep flowing through the serialized chain
  AFTER the sentinel by design). Returns the per-editor PROCESS-TABLE
  handle (an internal id, not the OS pid).
- **`process-write`** (line ~1754): stdin writes (table-handle, data).
- **Signals**: kill via the signal surface; the generation-guard
  discipline (a stale pid is never signaled) is #308's contract.

**Live consumer**: `fikra/backend-claude.tlisp` spawns the CLI per
turn and streams its JSONL through the filter — the primitive is
production-exercised daily.

## The verified gaps

- ❌ **PTY allocation** (`:pty t` for credential/TTY-bound programs
  like ssh/sudo) — MISSING → **#293** owns it.
- ❌ **Filesystem watching** (a `Bun.watch` exposure to T-Lisp —
  RFC-028/logseq-mode wants buffer revert-on-change) — MISSING →
  **#329 (FILED)**, no current consumer beyond the RFC's want.
- ❌ **Process groups / signal variety** — NOT verified as needed by
  any current consumer → **recorded as "no consumer; do not build"**
  (YAGNI; revisit when a real consumer appears).

## Decision

#294 lands as this inventory + the follow-up filings + the
dependency-reference corrections on #293/#295/#297 (the tracking
issue's chain assumed a build that isn't needed). **Nothing else is
implemented here** — the tracker's whole point is that the primitive
exists and the gaps are enumerated with owners.
