# SPEC-214: Adapter contract v2 + Claude agent backend rewrite

**Issue:** #214 (fikra-p1 / RFC-027 §D3, §D4, §Phase 1)
**Status:** Implemented 2026-08-22

## Goal

Rewrite the adapter registry to contract v2 (capabilities + start-turn +
abort) and replace the one-shot `claude --print` backend with the agent
edition: process-per-turn + session resume + JSONL→FAEP normalization.

## Design

**adapter.tlisp (contract v2)**: backends provide
`fikra-backend-<name>-{available-p, capabilities, start-turn, abort}`.
Registry dispatches via funcall string paths (no intern). Capabilities are
LIST-shaped `("cap" value)` alists (T-Lisp has no dotted pairs — `cons`
requires a list second arg, documented in #206/#212 and hit again here).
`fikra-backend-capable-p` normalizes to t/nil. Legacy `chat` method bridges
to start-turn until #216 rebinds callers.

**backend-claude.tlisp (agent edition)**:
- available-p: `command -v claude`.
- capabilities: session-resume=t (interactive-approvals probed for real in
  #220; sandbox-presets nil — Claude has no sandbox flags).
- args (pure, fixture-tested): `--print --output-format stream-json
  --verbose --permission-mode default` + `--resume <sid>` when the thread
  has a session + `-p <message>`.
- **Normalization is SEPARABLE and pure**: `fikra-backend-claude-normalize
  line` → FAEP events list. Flat dispatch, one helper per wire type
  (system→session; assistant→text-delta/tool-call via a block fold;
  user→tool-result ok/fail; result→NOTHING — the sentinel owns turn-end).
  Per-tool summaries: Bash→command, Edit/Write/Read→path.
- **Line accumulation**: chunks are arbitrary — `fikra-backend-claude-
  line-events chunk` drains complete lines through a recursion (no `while`
  macro in T-Lisp) and keeps the partial remainder in the accumulator.
- start-turn: thread turn-begin → make-process with `:cwd` = thread root,
  serialized filter (per #208) → line-events → ONE FAEP batch per chunk
  (coalescing); session events record the resume handle via #213's setter.
- sentinel: AUTHORITATIVE turn-end (§D3) — exit 0→completed else error;
  abort: SIGTERM → interrupted. ABORT GUARD (gate round-1 catch): abort
  marks aborted-locally BEFORE signaling; the SIGTERM'd process's sentinel
  SKIPS turn-end — no double turn-end, interrupted is never overridden by
  error (pinned via the abort-sim seam).

## Completion Criteria

- [x] Contract v2: capabilities/capable-p/start-turn/abort; register/set/
      current round-trip; unavailable backend refused (pinned).
- [x] args fixtures: first turn has no --resume; resume turn carries the
      session id right of --resume (pinned).
- [x] Normalization fixtures (recorded stream-json shapes, no claude
      spawn): system/init→session; assistant text→text-delta; tool_use→
      tool-call with Bash/Edit summaries; mixed blocks in order;
      tool_result ok/fail; result→no events; unparseable→nil; empty text
      dropped (all pinned).
- [x] Chunk splitting: a JSON object split across chunks reassembles;
      multiple complete lines in one chunk flow in order (pinned).
- [x] Filter→FAEP integration (no process): feeding the filter a chunk
      emits a FAEP batch AND records the session id in thread state
      (pinned via the log + session-id readback).
- [x] Abort→sentinel interaction: abort ends interrupted; the sentinel
      does NOT end again — pinned BOTH via abort-sim AND via a REAL
      subprocess (spawn /bin/sleep through the module's own
      make-process/sentinel plumbing, SIGTERM it, assert exactly ONE
      turn-end and status stays interrupted). Non-tool_result blocks in
      user messages ignored (pinned). Dead argv binding + dead defvar
      removed.
- [x] typecheck all projects green; suites green (backend-claude 12,
      fikra-mode 11 updated to the v2 protocol, thread 9, event 9,
      primitives, process-ops 5 solo — 2 process-ops tests flake under
      6-suite parallel load, clean solo; noted, pre-existing pattern).

## Notes

- nil stringifies as "null" across the TS bridge (t→"true", nil→"null")
  — test expectations use "null", and capable-p normalizes to explicit
  t/nil so callers can distinguish.
- Live claude smoke (two turns resuming one session) is the #215 replay
  harness's opt-in playbook — never required for CI.
