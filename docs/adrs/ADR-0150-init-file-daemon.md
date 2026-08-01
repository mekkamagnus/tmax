# ADR-0150 — --init-file is honored in daemon mode (#56)
## Status: Accepted
## Context
`--init-file FILE` was parsed in `main.ts` but **dead in daemon mode** (the
primary runtime): the daemon branch built `new TmaxServer()` with no init path,
and `startEditor()` hardcoded `loadInitFilePublic(undefined)` — loading the
default `~/.config/tmax/init.tlisp` and overwriting `currentInitFile`. The
documented `tmax --init-file ./my-config.tlisp` silently loaded the wrong config.
`bin/tmax` neither parsed nor forwarded the flag, and `src/server/server.ts`'s
entry point ignored it.

## Decision
Thread `initFilePath` end-to-end:
1. **`TmaxServer`** — 4th ctor arg `initFilePath?`, stored and used by
   `startEditor` → `loadInitFilePublic(this.initFilePath)` (codex: thread to
   `loadInitFilePublic`, not just the Editor ctor which `startEditor` overwrites).
2. **`src/server/server.ts` entry** — parse `--init-file` from argv →
   `new TmaxServer(socket, false, undefined, initFilePath)`.
3. **`src/main.ts`** — daemon + embedded branches pass `initFilePath`.
4. **`bin/tmax`** — parse `--init-file FILE` (shift_mode), forward it in
   `ensure_daemon` (daemon_args array) and the embedded `src/main.ts` exec;
   document it in `--help`; add the missing-value terminal guard (parity with
   `-e`/`-w`).

## Consequences
- `tmax --init-file cfg` (daemon + embedded) now loads `cfg`; the default init is
  only used when no `--init-file` is given. Verified by an integration test
  (TmaxServer ctor: a defvar from the init file is live via eval; absent without)
  and the end-to-end launcher (`bin/tmax --init-file cfg -e marker` → the value).
- No regression to the default-init path (loads `~/.config/tmax/init.tlisp` when
  no flag is given).
- Non-blocking note: the bash launcher parse/forward path has no in-suite
  automated test (bin/ is outside the tsconfig roots); validated empirically.

Spec: [BUG-38](../specs/BUG-38-init-file-daemon.md). Issue: #56.
Verify-gate: PASS.
