# ADR-0276: One CLI surface — src/main.ts owns the tmax CLI; the compiled binary is a drop-in

- **Status**: Accepted (verify-gate pending; landed pending CI green)
- **Date**: 2026-11-14
- **Issue**: [#250](https://github.com/mekkamagnus/tmax/issues/250)
- **Spec**: [SPEC-250](../specs/SPEC-250-binary-drop-in-cli.md)
- **Supersedes**: the CLI portion of `bin/tmax` / `bin/tmaxclient` (both now thin execs)

## Context

ADR-0271 adopted the single-binary build but deferred distribution: the
binary bundled `src/main.ts`, which knew only the embedded-Steep path —
the actual `tmax` CLI (15+ flags, daemon ping/wait/stale-lock choreography,
workspace routing, client/trt delegation) lived in 365 lines of bash
(`bin/tmax`) plus a 1,021-line client script (`bin/tmaxclient`). Running the
binary as `tmax` was impossible: `dist/tmax -e '(+ 1 2)'` hung in the TUI.

## Decision

**Move the CLI into the entry point, layer by layer, behavior-faithful:**

1. `src/client/rpc-client.ts` — the JSON-RPC client library (`TmaxClient`,
   key-sequence parsers), moved verbatim out of the client script.
2. `src/client/cli.ts` — `runTmaxClient(argv)`, the client CLI verbatim
   (terminal `process.exit` semantics preserved by design — every route
   through it ends the process, exactly like the bash `exec` it replaces).
3. `src/cli/exec-target.ts` — the dual-runtime spawn layer: source runs
   spawn `bun <entry.ts>`; the compiled binary (`/$bunfs`) re-execs itself
   via `process.execPath` with internal flags (`--tui-client`) that main.ts
   routes in-process of the child. Daemon and TUI children use the same
   targets, preserving the TUI's process-isolation design (own raw-mode,
   SIGINT cleanup).
4. `src/cli/launcher.ts` — the bash launcher ported: typed arg parser
   (end-of-opts, shift-modes, loud unknown-flag errors per BUG-41, missing-
   value errors per I6), `waitForDaemon` (25×200ms ping + dead-pid lock
   removal), `ensureDaemon` (mktemp log with the BUG-35 trailing-X template,
   tail-20 on failure), diagnostic passthrough (#47), `--stop` (#69:
   graceful → SIGTERM fallback → always clean socket/lock), sweep
   delegation to `sweep.ts`, `--test` in-process via `TmaxClient` (no
   bash-output quoting), and the attach routes (workspace create/attach,
   last-workspace persistence SPEC-040, files-through-daemon #52/BUG-34) via
   the client CLI's `--tui` mode — which opens files through the daemon
   BEFORE spawning the TUI child.
5. `src/main.ts` is THE tmax CLI: `--version` before routing (must print
   even with a live daemon), then `runLauncher` → `'daemon'`
   (`runDaemonMode`, extracted) | `'embedded'` (existing editor path,
   unchanged).

`bin/tmax` and `bin/tmaxclient` collapse to thin execs over the TS entries —
source runs keep identical behavior and keep running repo code (learnings
rule). Plus: the sweep never classifies or signals itself (`dist/tmax --sweep`
matches its own command line; a cron/nohup sweep reaping itself as an orphan
would be catastrophic).

## Alternatives considered

- **Keep bash + ship the binary with a wrapper**: two CLI surfaces forever,
  drift between them, unfixable flag gaps in the binary. Rejected (the
  long-term goal is binary-first operation, then distribution).
- **Re-exec bin/* from the binary**: a compiled binary has no bin/ scripts
  and no source tree; only in-process routing works. Rejected.

## Consequences

- `bun run build:tmax` now produces a complete `tmax`: verified live from
  the binary — `--version/--help/--sweep`, `-e` auto-start (binary
  self-exec daemon), `--ping/--workspaces/--capture/--stop`, `--test`
  (107/107 trt), files+daemon TUI attach in a real TTY (edit, `:w`
  write-back), and the embedded no-daemon fallback.
- The CLI becomes unit-testable (`test/unit/cli-launcher.test.ts` pins the
  bash-parity arg semantics).
- Adding a flag now means editing launcher.ts once — not bash + TS.
- Distribution (ADR-0271's deferred item) unblocks: one artifact to ship.

## Verification

- Source-mode matrix (bin/tmax): auto-start + eval, ping, workspaces, stop
  + socket cleanup, sweep, help, version.
- Binary-mode matrix (dist/tmax): the same plus trt 107/107, TUI attach +
  edit + `:w` in tmux, embedded fallback.
- `bun run typecheck` clean; `bun run test:unit` 3,616/0 after updating two
  layout pins (bin/tmax doc-text → launcher.ts; `daemonMode` →
  `runDaemonMode`); tmax-use e2e + verify-gate per the spec.
