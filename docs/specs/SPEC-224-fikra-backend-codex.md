# SPEC-224: Fikra backend-codex adapter

**Issue:** #224 (fikra-p5 / RFC-027 §D4)
**Status:** Implemented 2026-08-22

## Goal

The second backend: OpenAI Codex CLI, per adapter contract v2 —
`codex exec --json`, sandbox presets, resume, capability probing,
normalization to FAEP, and the #222-hardened per-thread turn pattern.

## Design

`src/tlisp/core/fikra/backend-codex.tlisp` (new):

- **RECORDED EVENT SHAPES** (codex-cli 0.147.0, `codex exec --json`,
  captured live 2026-08-22 — the #219 recorded-surface discipline):
  `thread.started`→session (the resume handle), `item.completed
  agent_message`→text-delta, `item.started command_execution`→tool-call,
  `item.completed command_execution`→tool-result (ok by exit_code),
  `item.completed file_change{changes[]}`→file-change (one per path);
  `turn.*` ignored (our turn lifecycle owns the thread; the process exit
  is authoritative); item type `error` skipped (plugin/config noise in
  the captured transcripts).
- **ENGINE GAP FOUND + WORKED AROUND**: `json-read-from-string` returns
  NIL for backslash escapes (`\n`, `\"`) — real codex output is full of
  them (`aggregated_output`). `fikra-codex-json-sanitize` (a manual
  char scanner — no regex, no nested string-escape quoting) flattens
  escape pairs and real control chars to spaces per extracted line
  (content-preserving for FAEP summaries). Split-then-sanitize order:
  structural newlines stay line boundaries in the raw process path.
- **L1 flags**: from fikra/modes' recorded 0.147 surface (#219's
  correction of this issue's pre-recording matrix — all four modes
  express; `--approve-for-me` IS auto). Args: `exec [--json
  --skip-git-repo-check <mode-flags>] <prompt>`; resume: `exec resume
  <thread-id> --json … <prompt>`.
- **Capabilities**: session-resume t, sandbox-presets t,
  interactive-approvals nil (L1 + turn-boundary review only — Codex L2
  needs the app-server protocol, deferred).
- **Turn pattern** (the #222-hardened claude shape): per-thread process/
  accumulator maps, pid→thread dispatch (unknown pids DROP; entries
  resident), thread-routed emits, background sentinels settle their own
  thread without stealing focus, per-thread abort.

## Completion Criteria

- [x] Normalization pinned against every recorded shape: session (the
      resume handle), text-delta, tool-call, tool-result ok AND fail
      (exit-code flip), file-change per path, error-noise skipped,
      turn.* ignored, non-JSON → nil (pinned).
- [x] Escaped content (`\n` inside aggregated_output) normalizes via the
      sanitizer (pinned — the raw-backslash form).
- [x] Full L1 matrix via the effective mode: read-only / workspace-write /
      workspace-write+approve-for-me / bypass (pinned); first-turn +
      resume arg shapes (pinned).
- [x] Capabilities: session-resume + sandbox-presets t;
      interactive-approvals nil (pinned).
- [x] Registry + switcher: codex registers; the switcher accepts it when
      probed; the forced seam always works (keyless) (pinned).
- [x] A recorded transcript streams end-to-end into the thread's OWN log
      with the session id recorded in thread state (pinned).
- [x] typecheck green; fikra-codex 11/11 (incl. the escaped-quote hex-transport pin + the background session-id pin); the batch suites green.

## Gate round — the transport + parity findings (all fixed)

- **THE READER BOUNDARY (HIGH)**: interpolating process chunks into
  T-Lisp string literals let the READER strip backslash escapes — an
  escaped quote in any command/output became a REAL quote inside the
  JSON and the parse DROPPED the whole event (fixtures only had `\n`,
  so it was unpinned). The transport now HEX-ENCODES chunks (hex chars
  are reader-safe) and a new pure `hex-decode` stdlib op restores the
  exact bytes — pinned with an escaped-quote payload through the real
  filter path.
- **Background session-id loss** (the #222 bar): the filter recorded the
  resume handle only when its thread was FOCUSED — background turns now
  record via `fikra-thread-set-session-id-for` (pinned: a background
  turn's session id survives a focus switch).

## Notes

- The issue's original fallback matrix (auto DEGRADES; --ask-for-approval)
  predated the #219 recording — the recorded surface governs; this spec's
  matrix is the as-built truth.
- Live CLI probes were run for shape capture (three `codex exec` runs);
  the TESTS are keyless (checked-in recorded lines).
