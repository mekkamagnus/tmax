# ADR-0312 — #293: PTY via script(1) (node-pty rejected)

- **Status**: Accepted
- **Date**: 2026-11-22
- **Issue**: #293
- **Spec**: SPEC-286

## Context

#293 names node-pty as the PTY mechanism ("the runtime can require
it"). The empirical finding: **node-pty's native read loop never
delivers under Bun** — `pty.spawn` succeeds (a pid is assigned) but
`onData` stays silent forever, under both Bun's ESM and CJS require
paths (Node.js on the same machine works fine after chmod +x on the
prebuilt `spawn-helper`, which bun installs without the exec bit).
tmax runs on Bun; a primitive whose output never arrives is unusable.

## Decision

- **`:pty t` wraps the argv in the platform `script(1)`**: darwin
  `/usr/bin/script -q /dev/null <argv...>`; linux `script -qec
  '<joined>' /dev/null`. Verified under Bun: the child sees a TTY
  (`[ -t 0 ]` true), stdin forwards through script's pty
  (`process-write` → the child's `read`), output streams with
  terminal CRLF. Everything else composes the EXISTING machinery —
  filter streaming, sentinel, `process-write`, and `signal` (whose
  r131b process-GROUP kill reaches script + child together, which is
  exactly the interrupt semantics git needs).
- **node-pty REMOVED** from the dependencies (it also required a
  manual chmod fix that bun installs don't carry).
- The issue's `process-signal` name maps onto the EXISTING `signal`
  op (INT/TERM/KILL accepted) — no new op needed; the ladder lives in
  the remote module.
- **Key overlap**: `p` navigated rows in #286's status buffer; #293
  (the later contract) assigns `p` = pull there. Prev-row remains on
  the exported `stagehand-status-prev`; the #286 key test documents
  the reassignment.
- Output rendering uses the #290 finding (temporary-switch appends —
  `buffer-append-to` is unreliable for streaming).

## Consequences

- **Gate r1 corrections**: Bun's `exitCode` is NULL on signal death —
  `?? 0` reported FALSE SUCCESS for every interrupted run (fixed:
  128+signum via a signal-NAME map — `Number("INT")` is NaN, the
  first parse attempt silently failed); the popup keymap binds every
  printable ASCII char to the verbatim dispatcher (a hex-built char
  table — the reader strips escapes); C-c is bound in the status
  buffer too; the ladder's 1s waits are press-held (a fresh press
  after the wait escalates); success closes the popup in place;
  post-mortem buffers go read-only.
- The PTY allocates script(1)'s DEFAULT size in v1 (the ADR earlier
  claimed the popup's dimensions — corrected; live resize and
  dimension plumbing are recorded follow-ups).
- Credential prompts work: the remote's terminal prompts render in
  the popup and typed input reaches them verbatim.
- The CRLF in PTY output is preserved as-is (it is what a terminal
  shows); consumers strip if needed.
- No live pty resize in v1 (the popup's dimensions at spawn; recorded
  follow-up). Windows remains out of scope.
- If Bun later runs node-pty correctly, migrating is a contained swap
  inside the `:pty t` branch — no T-Lisp surface changes.
