# Bug: Daemon/client socket-path uid-resolution drift (SUDO_UID inconsistency)

## Bug Description
The canonical daemon socket path `/tmp/tmax-<uid>/server` is computed independently at **five** sites with **inconsistent uid resolution**, so under `sudo` (or any uid-mismatch scenario) a client and the daemon can compute *different* paths and silently fail to connect.

- `src/server/server.ts:761-763` and `bin/tmaxclient:52-54` — `process.env.SUDO_UID || userInfo().uid.toString()` (**honors `SUDO_UID`**).
- `src/editor/remote-editor.ts:27` — `userInfo().uid` (**ignores `SUDO_UID`**).
- `tmax-use/src/instance.ts:212-214` and `tmax-use/src/client.ts:39-41` — `process.getuid?.() ?? 501` (**ignores `SUDO_UID`**; the `?? 501` is a macOS-first fallback that is wrong on Linux where the tmax user is not uid 501).

**Expected:** every client and the daemon compute the identical socket path for the same environment.
**Actual:** under `sudo tmax …`, the daemon uses `SUDO_UID` (the real invoking user, e.g. 1000) while a tmax-use client / the remote editor use `getuid()`/`userInfo().uid` (root, 0) → daemon listens on `/tmp/tmax-1000/server`, client dials `/tmp/tmax-0/server` → connection refused / silent failure.

## Problem Statement
`SUDO_UID` is honored by the daemon and `tmaxclient` but ignored by three other socket-path sites. This is a latent correctness bug (sudo'd daemon/client mismatch) and a duplication hazard. Unifying the uid source is a **behavior change** for the three non-conforming sites (they will begin honoring `SUDO_UID`), so this is a bug spec, not a pure refactor — it refactors GitHub issue #10 (+ the 5th copy, issue #38) per the codex review that flagged the sudo-semantics change.

## Solution Statement
Introduce one shared `defaultSocketPath()` helper in a neutral, dependency-free module (`src/core/socket-path.ts`) and route all five sites through it. The helper resolves uid exactly as the **daemon** does today — `TMAX_SOCKET` env wins; otherwise `process.env.SUDO_UID || userInfo().uid` — so the daemon's `SUDO_UID` semantics are preserved and the three non-conforming sites are corrected to match. Add a unit test asserting: all sites return the same path for a given env, `TMAX_SOCKET` overrides, and `SUDO_UID` is honored when set.

## Steps to Reproduce
1. On a POSIX system, run the daemon under sudo: `sudo TMAX_SOCKET= tmax --daemon` → binds `/tmp/tmax-<SUDO_UID>/server` (the real user's uid).
2. From a tmax-use client (which uses `getuid()`), attempt to connect without `TMAX_SOCKET` set → it targets `/tmp/tmax-0/server` (root).
3. The socket paths differ → connection fails (or a stray second daemon is launched).
(On macOS the `?? 501` fallback in tmax-use masks this for the non-sudo case but is itself wrong on Linux.)

## Root Cause Analysis
`SUDO_UID` resolution is duplicated and inconsistent. `server.ts:762` and `bin/tmaxclient:53` correctly prefer `SUDO_UID` (so a sudo'd daemon binds on the real user's socket, not root's). The other three sites (`remote-editor.ts:27`, `instance.ts:213`, `client.ts:40`) never consult `SUDO_UID` — `remote-editor.ts` uses `userInfo().uid` and the two tmax-use sites use `getuid() ?? 501`. Under `sudo`, `userInfo().uid`/`getuid()` return 0 (root) while `SUDO_UID` holds the real user → path divergence. The `?? 501` fallback additionally encodes a macOS-only assumption.

## Relevant Files
Use these files to fix the bug:
- `src/core/socket-path.ts` — **new** shared `defaultSocketPath()` (the single source of truth; no upstream deps).
- `src/server/server.ts:761-763` — replace inline computation with the helper.
- `bin/tmaxclient:52-54` — replace inline computation with the helper.
- `src/editor/remote-editor.ts:27` — replace inline computation with the helper (this is the site that currently ignores `SUDO_UID`).
- `tmax-use/src/instance.ts:212-214` — replace inline computation with the helper (drops the `?? 501` fallback).
- `tmax-use/src/client.ts:39-41` — replace inline computation with the helper.

### New Files
- `src/core/socket-path.ts` — exports `defaultSocketPath(): string` and (for tests) a `resolveUid()` that returns `process.env.SUDO_UID || String(userInfo().uid)`.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### Task 1 — Create the shared socket-path helper

**User Story**: As a maintainer, I want one `defaultSocketPath()` so that the daemon and every client agree on the socket location.

- Create `src/core/socket-path.ts` exporting `defaultSocketPath()`: return `process.env.TMAX_SOCKET` if set, else `/tmp/tmax-${resolveUid()}/server`.
- Export `resolveUid()` returning `process.env.SUDO_UID || String(userInfo().uid)` (preserving the daemon's current `SUDO_UID` precedence).
- No imports beyond `node:os`/`'os'`; no upstream project deps.

**Acceptance Criteria**:
- [ ] `defaultSocketPath()` honors `TMAX_SOCKET` when set.
- [ ] `defaultSocketPath()` honors `SUDO_UID` when set (even with no `TMAX_SOCKET`).
- [ ] Falls back to `userInfo().uid` otherwise.

### Task 2 — Route all five sites through the helper

**User Story**: As a developer, I want every socket-path computation to call the helper so there is no drift.

- `src/server/server.ts:761-763`, `bin/tmaxclient:52-54`, `src/editor/remote-editor.ts:27`, `tmax-use/src/instance.ts:212-214`, `tmax-use/src/client.ts:39-41` — replace each inline computation with `defaultSocketPath()` (imported from the shared module; adjust the relative import path per file).
- Remove the local `uid = …` lines and the `?? 501` fallback.
- Preserve each site's existing `TMAX_SOCKET` short-circuit behavior (the helper does this).

**Acceptance Criteria**:
- [ ] No inline `/tmp/tmax-${uid}/server` computation remains at any of the five sites (grep clean).
- [ ] `bin/tmaxclient` (a dev script) imports the helper from `../src/core/socket-path.ts`.
- [ ] Both tmax-use sites import from `../../src/core/socket-path.ts`.

### Task 3 — Add a unit test pinning the resolution

**User Story**: As a QA engineer, I want a test that prevents this drift from recurring.

- Add `test/unit/socket-path.test.ts` covering: `TMAX_SOCKET` override; `SUDO_UID` honored (with and without `TMAX_SOCKET`); fallback to `userInfo().uid`; the path shape `/tmp/tmax-<uid>/server`.
- Save/restore `process.env.TMAX_SOCKET` / `SUDO_UID` around each case.

**Acceptance Criteria**:
- [ ] Test asserts `SUDO_UID` is preferred over `userInfo().uid`.
- [ ] Test asserts `TMAX_SOCKET` overrides everything.
- [ ] Env vars restored after the test (no leakage).

### Task 4 — Validate the fix

**User Story**: As a maintainer, I want green typecheck + tests confirming the fix with zero regressions.

- Run the validation commands below.

**Acceptance Criteria**:
- [ ] `bun run typecheck` clean.
- [ ] `bun test test/unit/socket-path.test.ts` passes.
- [ ] Daemon + tmax-use smoke still connect on the canonical socket.

## Validation Commands
Execute every command to validate the bug is fixed with zero regressions.
- `bun run typecheck` — tsc clean across all projects (the new module + all 5 import sites).
- `bun test test/unit/socket-path.test.ts` — the resolution test passes.
- `rg -n "/tmp/tmax-\\\$\{" src/ bin/tmaxclient tmax-use/src/` — only the shared helper defines the path template; the five call sites no longer do.
- `bun run test:adw` — adw slice green (it spawns daemons/clients via these paths).

## Notes
- This is the behavior-change counterpart to refactor issue #10 (and #38, the 5th copy). Codex review of #10 flagged that unifying the uid source changes sudo resolution for the three non-conforming sites — that change is the *fix* here (aligning them with the daemon), and is captured as an intentional behavior change in this bug spec.
- `bin/tmax` (bash) computes its own socket path (`SOCKET="${TMAX_SOCKET:-/tmp/tmax-${TMAX_UID}/server}"`, `TMAX_UID="$(id -u)"`) — out of scope; it already agrees with the daemon in the common case and is a different language.
- Do NOT change the daemon's `SUDO_UID` precedence — that is the correct, preserved behavior; the fix is making everyone else match it.
