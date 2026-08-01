# Bug: --init-file is ignored in daemon mode (the primary runtime)

## Bug Description
`--init-file FILE` is parsed in `main.ts:82-85` but was **dead in daemon mode**:
the daemon branch constructed `new TmaxServer()` with no init file path, and
`startEditor()` called `loadInitFilePublic(undefined)` — loading the default
XDG `~/.config/tmax/init.tlisp` instead of the user's explicit `--init-file`.
The documented `tmax --init-file ./my-config.tlisp` silently loaded the wrong
config. The `bin/tmax` launcher also neither parsed nor forwarded `--init-file`,
and `src/server/server.ts`'s entry point ignored it.

## Problem Statement
`--init-file FILE` must be honored in daemon mode (the primary runtime): the
daemon loads THAT file, and its effects (bindings, vars) are live.

## Solution Statement
Thread `initFilePath` end-to-end:
1. **`TmaxServer`** — new `initFilePath?` ctor arg (4th), stored and used by
   `startEditor` → `loadInitFilePublic(this.initFilePath)` (was `undefined`).
2. **`main.ts`** — daemon branch and embedded-server branch pass `initFilePath`.
3. **`src/server/server.ts` entry** (`import.meta.main`) — parse `--init-file`
   from argv and pass it to `new TmaxServer(...)` (so `bun src/server/server.ts
   --init-file cfg`, as used by `bin/tmax ensure_daemon`, honors it).
4. **`bin/tmax`** — parse `--init-file FILE` and forward it both to
   `ensure_daemon` (the daemon invocation) and to the embedded `src/main.ts`.

Codex APPROVE-WITH-CONCERNS honored: thread into `TmaxServer` AND through to
`loadInitFilePublic` (not just the Editor ctor, which `startEditor` would
overwrite); test via the `bin/tmax` launcher with isolated socket/HOME.

## Steps to Reproduce
```bash
echo '(defvar tmax-init-marker "custom")' > /tmp/cfg.tlisp
tmax --daemon --init-file /tmp/cfg.tlisp        # today: loads DEFAULT init, not /tmp/cfg.tlisp
tmax -e '(tmax-init-marker)'                     # today: Undefined symbol
```

## Root Cause Analysis
`startEditor` hardcoded `loadInitFilePublic(undefined)`; `loadInitFile(undefined)`
resolves to the default XDG path and overwrites `currentInitFile`. The daemon
branch never passed the parsed `initFilePath` through, so the flag was parsed
then discarded.

## Relevant Files
- `src/server/server.ts` — `initFilePath` ctor arg + field; `startEditor` uses it; entry parses `--init-file`.
- `src/main.ts` — daemon + embedded branches pass `initFilePath`.
- `bin/tmax` — parse `--init-file`; forward to `ensure_daemon` + embedded `main.ts`.
- `test/integration/init-file-daemon.test.ts` — boot a `TmaxServer` with an `initFilePath`, assert a defvar from the init file is live via the eval RPC.

## Step by Step Tasks
### Task 1 — TmaxServer threads initFilePath
**AC**: `new TmaxServer(socket, test, editor, initFilePath)` → `startEditor` calls `loadInitFilePublic(initFilePath)`.
### Task 2 — entry points pass it
**AC**: `main.ts` (daemon + embedded) and `src/server/server.ts` entry pass `--init-file`.
### Task 3 — bin/tmax forwards it
**AC**: `bin/tmax --init-file cfg` forwards to the daemon (ensure_daemon) and the embedded editor.
### Task 4 — regression test
**AC**: `test/integration/init-file-daemon.test.ts` boots `TmaxServer(.., initFilePath=cfg)` and a `defvar` from cfg is live via eval; verify-gate PASS.

## Validation Commands
- `bun run typecheck:src && bun run typecheck:test`
- `bun test test/integration/init-file-daemon.test.ts` — green.
- (empirical) `bin/tmax --help` exits 0; `tmax --init-file /tmp/cfg.tlisp` daemon path loads cfg.

## Notes
- A dedicated `(init-file-path)` query primitive does not exist today; the test uses a `defvar` marker from the init file as the "init file honored" signal (equivalent to the codex key-binding criterion).
