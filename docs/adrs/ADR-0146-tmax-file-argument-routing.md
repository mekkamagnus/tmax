# ADR-0146 — `tmax <file>` routes the file through the daemon (#52)
## Status: Accepted
## Context
When a daemon was running and `~/.config/tmax/last-workspace` existed, `tmax
somefile.txt` exec'd the TUI on the **last** workspace and silently dropped
`somefile.txt` — the user landed in a different buffer. `bin/tmax:301` resumed
last-workspace whenever there was no `-w` flag, with no file-argument check; and
`bin/tmaxclient`'s `--tui` branch parsed positional filenames but discarded them.
The no-daemon path (`bun src/main.ts <file>`, embedded editor) already worked.

## Decision
1. **`bin/tmax`** — gate last-workspace persistence on `FILES` being empty
   (SPEC-040 scopes persistence to the bare-`tmax` case). When files ARE given
   and a daemon is running, route them through it: `exec tmaxclient -s SOCKET
   --tui "${FILES[@]}"`. The embedded-editor fallback remains only for the
   no-daemon case.
2. **`bin/tmaxclient`** — in `--tui` mode, open positional files via the
   `openFile` RPC **before** spawning the TUI, so the buffer is present when the
   TUI attaches.
3. **`TmaxClient.openFile`** — now **throws** on RPC failure (was
   `process.exit(1)`), so callers decide: the non-TUI open loop exits non-zero if
   any open failed; the `--tui` path is **best-effort per file** (one bad file
   logs + is skipped; the TUI still attaches with the rest).

## Consequences
- `tmax <file>` no longer drops the filename when a daemon + last-workspace are
  present (verified by `bash -x` trace: routes to `tmaxclient --tui <file>`).
- Bare `tmax` still resumes last-workspace; `tmax <file>` with no daemon still
  opens the embedded editor (both regressions preserved).
- `openFile`'s contract changed (throws vs exits); both in-repo callers updated.
  Out-of-scope (documented in spec Notes): `src/client/tui-client.ts` itself
  accepts no file arg (the RPC-before-attach approach makes the buffer present
  regardless); no automated launcher test (`bin/` is outside the tsconfig roots,
  so validation is empirical).
- Reachability nuance: the daemon `open` handler turns nonexistent / EACCES
  paths into empty buffers (like `:e newfile`), so the new catches fire only for
  genuine connection/RPC failures — intended.

Spec: [BUG-34](../specs/BUG-34-tmax-file-argument.md). Issue: #52.
Verify-gate: PASS (after resolving the first gate's GAP-1: the staged
unreachable `try/catch`).
