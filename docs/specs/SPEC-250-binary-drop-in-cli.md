# The compiled binary is a drop-in `tmax` — the CLI surface moves into src/main.ts

## Goal

`dist/tmax` (ADR-0271 build path) behaves exactly like `bin/tmax`: the full
flag surface, the daemon startup choreography, workspace/file/TUI routing —
so `tmax` can run entirely off the binary (#250, prerequisite for the deferred
distribution story). The bash launcher collapses to a thin exec; one CLI
surface, owned by the TS entry point, unit-testable.

## Problem Statement

The `tmax` CLI lived in `bin/tmax` (365 lines of bash: flags, ping/wait/
stale-lock choreography, workspace routing, delegation to `tmaxclient`/trt)
and `bin/tmaxclient` (1,021-line bun script: the JSON-RPC client class + CLI).
`src/main.ts` implemented only the embedded-Steep path + `--version`/
`--daemon`/`--help`. The compiled binary bundled main.ts — so `dist/tmax -e
'(+ 1 2)'` treated `-e` as a filename and hung in the TUI (observed at #244).

## Solution Statement

Layered extraction, behavior-faithful:

1. **`src/client/rpc-client.ts`** — `TmaxClient` (JSON-RPC over unix socket)
   + key-sequence parsers, moved verbatim from bin/tmaxclient (named to dodge
   the `.gitignore` `tmax-*` artifact rule).
2. **`src/client/cli.ts`** — `runTmaxClient(argv)`: the tmaxclient CLI moved
   verbatim; `process.exit` semantics preserved (every route is terminal).
   `bin/tmaxclient` is a thin shim over it.
3. **`src/cli/exec-target.ts`** — spawn targets that work in BOTH runtimes:
   source spawns `bun <entry.ts>`; the compiled binary (`/$bunfs`) re-execs
   ITSELF (`process.execPath`) with internal flags main.ts routes
   (`--tui-client`). Daemon children spawn the same way.
4. **`src/cli/launcher.ts`** — `runLauncher(argv)`: the bash launcher ported
   (typed arg parser incl. end-of-opts/shift-modes/unknown-flag errors;
   `waitForDaemon` 25×200ms with dead-pid lock removal; `ensureDaemon` with
   mktemp log + tail-on-failure; diagnostic passthrough; --stop with graceful
   + SIGTERM fallback + always-clean socket/lock; sweep delegation to
   `sweep.ts`'s exported main; `--test` in-process via TmaxClient (no output
   quoting hacks); workspace create/attach + last-workspace persistence +
   files-through-daemon routing via the client CLI's `--tui` mode — which
   opens files through the daemon BEFORE spawning the TUI child, the exact
   bash flow). Returns `'embedded' | 'daemon'` for the two in-process paths.
5. **`src/main.ts`** — THE tmax CLI: routes `--tui-client` (internal) to the
   TUI main, `--version` BEFORE the launcher (must print even with a daemon
   running), then `runLauncher`; `'daemon'` → `runDaemonMode` (extracted);
   `'embedded'` → the existing embedded-Steep path unchanged.
   `bin/tmax` = `exec bun src/main.ts "$@"`.

Also: sweep never classifies or signals ITSELF (`dist/tmax --sweep` matches
its own command line — a nohup/cron-launched sweep reaping itself as an
orphan would be catastrophic).

## Completion Criteria

- [x] `dist/tmax --version`, `--help` (full usage), `--sweep` (dry-run) work.
- [x] `dist/tmax -e '(+ 40 2)'` with NO daemon auto-starts one (binary
      self-exec) and prints `42`.
- [x] `dist/tmax --ping`, `--workspaces`, `--capture`, `--stop` (graceful +
      socket/lock cleanup) work against the binary's daemon.
- [x] `dist/tmax --test` runs the trt suite in-process: 107/107, exit 0.
- [x] Files + running daemon: `dist/tmax FILE` opens the file THROUGH the
      daemon and attaches the TUI (binary self-exec `--tui-client`), verified
      in a real tmux TTY incl. live editing, `:w` write-back, mode line.
- [x] Embedded fallback: no daemon → single-process editor (embedded Steep)
      opens the file, verified in a real TTY.
- [x] `bin/tmax`/`bin/tmaxclient` are thin execs over the TS entries; source
      runs keep full behavior (same matrix verified source-mode).
- [x] Arg parser unit tests (bash-parity pins: flags, end-of-opts, shift-mode
      errors, unknown-flag errors, dev-flag passthrough) + exec-target tests.
- [x] `bun run typecheck` clean; `bun run test:unit` green (2 stale
      layout-pins updated: bin/tmax text → launcher.ts, daemonMode →
      runDaemonMode).
- [x] tmax-use e2e green: **62/62, exit 0** (solo run; the first batch run had
      2 timing failures caused by a concurrent `build:tmax` on the same host —
      both pass solo, the known concurrent-load gotcha).
- [x] Verify-gate: GAPS round 1 (TUI attach didn't block — tmux masked it; daemon cwd + trt unhandled rejection) → fixed 9b2c22e → PASS retry 1 (verifier re-probed live).
- [ ] CI green (post-push).

## Relevant Files

- `src/cli/launcher.ts`, `src/cli/exec-target.ts` (new)
- `src/client/rpc-client.ts`, `src/client/cli.ts` (new; moved from bin/)
- `src/client/tui-client.ts` (main exported), `src/main.ts` (routing)
- `bin/tmax`, `bin/tmaxclient` (thin execs)
- `src/server/sweep.ts` (self-exclusion)
- `test/unit/cli-launcher.test.ts` (new)

## Notes

- `--dev/--no-tty/--version/-v` pass through the launcher's unknown-flag
  error to main.ts (embedded-editor concerns, not launcher verbs).
- Discovered during live verification, deferred (pre-existing machinery, NOT
  this diff): the sweep's SIGTERM→SIGKILL escalation failed to reap two
  real orphans (a SIGTERM-ignoring daemon + a tmux wrapper) despite
  reporting them reaped; manual `kill -9` worked instantly. Filed separately.
- The daemon auto-restores the last workspace on fresh start (by design,
  SPEC-040) — a fresh test daemon replays prior buffers; use `--clean` to
  skip.

Status: implemented pending gate (verify-gate + CI).
