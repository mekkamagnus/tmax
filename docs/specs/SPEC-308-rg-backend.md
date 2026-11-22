# SPEC-308 — The rg search backend (async make-process, streaming, backend selection)

## Goal

Implement RFC-031 §2.2's primary search backend on #307's
generation-scoped producer interface: a T-Lisp `grep-rg-run` that
provisionally registers a generation, spawns `rg --json --smart-case`
via `make-process` (argv — no shell), streams match events through the
pure TS primitive `rg-event->hit` into `grep-buffer-append-hit`, maps
exit codes (0 done / 1 no-matches / ≥2 error — 128+N = signal-killed),
and selects backends per the `auto | rg | grep` matrix with TS
`exec-lookup` detection (Bun.which; cached per session).

## Normative contract (from the issue)

- **Output protocol**: one hit per MATCH EVENT; column = FIRST
  submatch's start as a UTF-8 code-point count +1 (1-based editor
  columns); empty submatches → column 1; invalid offset → column 1 +
  `degraded-text`. `rg-event->hit` returns a hashmap with EXACTLY
  `hit` (hashmap file/line/col/text, or nil for non-match events) and
  `flag` (`nil` | `undecodable-path` | `malformed` | `degraded-text`).
- **Base64 `bytes` fields**: undecodable PATHS are excluded + counted
  (`undecodable-path`); undecodable LINES degrade to replacement-char
  text, are APPENDED, and count as malformed (`degraded-text`).
- **Diagnostics aggregation**: at completion, `done (N undecodable
  paths, M unparseable lines)` (omitted when zero) — on done,
  no-matches AND error completions; on error, diagnostics follow the
  stderr message.
- **stderr**: buffered per run (routed to T-Lisp via
  `make-process :stderr-filter`); exit ≥2 with stderr → the complete
  `error` message carries it; empty stderr → `rg exited <code> (no
  stderr)`.
- **Provisional protocol**: register (generation-guarded callbacks) →
  spawn; spawn failure — including an executable vanished between
  detection and spawn — rolls the generation back (prior content
  restored; the named error on the status line). The evaluator throws
  a builtin's `Either.left`, so the spawn is wrapped in
  `condition-case` (otherwise the rollback branch is dead code).
- **Process discipline**: streaming chunk→line buffering (partial
  final line flushed at the sentinel); killed/superseded runs drop
  (generation guards + the pid guard); re-run/quit kills the prior
  process BEFORE spawning (one choke point: `grep-rg-kill-prior`).
- **The spawn→setq race**: a chunk can beat the `setq` of the pid —
  unregistered-pid chunks stash PID-ATTRIBUTED and replay on
  registration; STRANGER pids' chunks drop (every spawn has a fresh
  pid — a killed predecessor's straggler can never be ours).

## Completion criteria

- [x] `rg-event->hit` tests: plain, colon-path, Unicode path/line,
      MULTI-SUBMATCH single event, empty-submatches, base64 path
      (excluded+flagged) vs base64 lines (decoded/replacement),
      malformed line, byte→char column, invalid-offset fallback
- [x] Diagnostics aggregation on done and error paths
- [x] Provisional protocol: immediate-output (stash/replay) fixture;
      spawn-failure rollback restores prior results (a REAL vanished
      executable — condition-case catches the thrown
      `Either.left`)
- [x] Matrix rows incl. vanished-executable; dash-prefixed
      pattern+dir vs REAL rg; late-output-after-kill dropped; exit 1
      = no-matches; empty-stderr error

## Implementation map

- `src/editor/api/grep-ops.ts` — `rg-event->hit` + `exec-lookup`.
- `src/tlisp/core/commands/grep.tlisp` — `grep-rg-run`,
  `grep-rg-filter`, `grep-rg-stderr-filter`, `grep-rg-sentinel`,
  `grep-rg-replay-pending`, `grep-rg-kill-prior`,
  `grep-backend-available-p`, the selection matrix, per-run state
  reset.
- `src/editor/tlisp-api.ts` — `make-process :stderr-filter` routing
  (the serialized hex-encode chain) + the 128+N signal-aware exit
  code.
- Tests: `test/unit/grep-rg.test.ts` (protocol matrix + stash/replay
  + condition-case), `test/unit/grep-backend.test.ts` (live rg:
  streaming, exits, rollback, stderr, dash/Unicode fixtures, matrix).

## Out of scope

- The `grep` fallback backend (#309 — the matrix's named pending
  error), scope commands (#310), the consult layer (#311).
