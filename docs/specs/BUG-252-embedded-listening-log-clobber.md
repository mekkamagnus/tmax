# Embedded startup: the async "listening" log clobbers the TUI's first rendered line

## Bug Description

`tmax file.md` with no daemon (the embedded single-process path): the first
frame renders, then **`tmax server listening on …` appears where line 1 of the
file should be** — with the gutter (` 1 │tmax server listening …`). One
keystroke repaints and everything is correct. Codex's independent #250
verification hit this as its only FAIL ("initial capture showed the daemon
log instead of codex was here"), and scored startup/first-paint 4.5/10.

## Problem Statement

`src/main.ts`'s embedded path calls `server.startSocket()` **fire-and-forget**
(`.catch(...)` only). `startSocket`'s listen callback runs `console.log("tmax
server listening on …")` asynchronously — typically landing AFTER
`SteepFrontend.run()` has painted the first frame and positioned the hardware
cursor at **L1 C1 (row 0, col 0)**. The log therefore prints at the cursor,
overwriting the first rendered line of the file. The gutter and everything
else stay correct — which is exactly why it reads as "the daemon log replaced
my file's first line."

Verified live: buffer state over the socket is correct (`buffer-text` =
file); the rendered frame shows the log line; one repaint fixes it.

## Solution Statement

1. `TmaxServer.startSocket(quiet = false)` — suppress the banner when the
   TUI owns the screen; `src/main.ts`'s embedded path passes `true`.
   Foreground `--daemon` keeps the banner (it owns the terminal).
2. `waitForDaemon` poll 200ms → 50ms (5s budget, 100 attempts): the bash-era
   200ms granularity added up to a fifth of a second of dead time before a
   freshly spawned (fast-booting) daemon answers.
3. `--ping`'s no-daemon message now names the socket it probed and how to
   start (codex: "clear but minimal").

Measured after: **binary embedded first-paint 0.43s** (×2 runs, identical);
cold `tmax -e` ≈ 1.3s; warm 0.14s. (Codex's "30 seconds" was its own
harness's approval pauses, not tmax.)

## Completion Criteria

- [x] Embedded `tmax file.md`: the file's first line is the first rendered
      line; zero occurrences of the listening banner in the pane (verified in
      a real TTY, source + binary).
- [x] Foreground `tmax --daemon` still prints the listening banner.
- [x] Unit test: `startSocket(true)` logs nothing; `startSocket(false)`
      logs the banner exactly once.
- [x] waitForDaemon: 100 × 50ms budget (same 5s ceiling).
- [x] `--ping` failure names the socket + start hint.
- [x] typecheck clean; unit suite green; binary rebuilt + live-verified.
- [ ] Codex re-verification: the full 5-step matrix re-run + UX re-score.

## Relevant Files

- `src/server/server.ts` (startSocket quiet), `src/main.ts` (embedded call)
- `src/cli/launcher.ts` (poll), `src/client/cli.ts` + `rpc-client.ts` (ping)
- `test/unit/server-quiet-socket.test.ts` (new)

Status: implemented pending codex re-verification.
