# SPEC-286 — Stagehand push/pull over a PTY (#293)

## Goal

Stagehand T1: `P` push / `p` pull against credential-bound remotes —
the process runs under a REAL pseudo-terminal so git/ssh prompts work,
streaming into a popup the user can type at.

## Design

- **The primitive**: `make-process ... :pty t` wraps the argv in the
  platform `script(1)` (`/usr/bin/script -q /dev/null <argv...>` on
  darwin; `script -qec '<joined>' /dev/null` on linux) — the child
  sees a TTY (`[ -t 0 ]` → true, tested); stdin forwards through
  script's pty (`process-write` reaches the child's `read`, tested);
  output carries terminal CRLF. Signals reach the child through the
  process GROUP (the existing detached spawn + `signal`'s -pid kill).
  **node-pty was tried and REJECTED**: it installs and spawns under
  Bun, but its native read loop never delivers (onData stays silent)
  — recorded in the ADR; the dependency was removed.
- **The module** `src/tlisp/core/stagehand/remote.tlisp` (loads from
  `bindings/normal.tlisp`; status binds `P`/`p` lazily). NOTE: `p`
  previously navigated rows in the status buffer (#286) — the LATER
  issue owns the overlapping key; prev-row stays on the exported
  `stagehand-status-prev` (the #286 key test updated accordingly).
- **The flow**: `P`/`p` refuse when no repo / when a remote run is
  live; otherwise spawn `git push|pull` at the project root with
  `:pty t`, streaming into the `*Stagehand-Remote*` popup (the
  capture geometry: `split-window-below`, focus down, switch). Input:
  the exported `stagehand-remote-input` writes keys VERBATIM via
  `process-write` (Enter → a newline); the editor interprets nothing.
- **Cancellation — C-c ONLY**, the escalation ladder, each step a
  FRESH press (no automatic escalation; the user is the trigger):
  1st → SIGINT; still alive + 2nd → SIGTERM; 3rd → SIGKILL. Delivered
  via the existing `signal` op (the issue's `process-signal` name
  maps onto it — the r131b group-kill semantics serve). **No
  worktree-untouched guarantee** — git owns the interrupt outcome;
  the observable contract: `interrupted`-family status, process dead,
  the popup retained post-mortem.
- **`q` closes AFTER exit only**: during a run `q` is PTY input
  (verbatim to the remote; the popup does NOT close — tested). exit 0
  → `pushed`/`pulled` + the status-buffer refresh; exit ≠ 0 → the
  popup RETAINS the output with the exit status until `q`
  (post-mortem).
- Windows is out of scope (darwin/linux per the issue).

## Completion criteria

- [x] `:pty t`: TTY visibility ([ -t 0 ] true), bidirectional IO
      (stdin forwarded + verified by the child), signals via the
      trap-logging fixture (INT + TERM observed; KILL ends it), and
      the three-press ladder (SIGINT aborts a sleeping push; the
      remote untouched — asserted on the remote's actual refs)
- [x] Push/pull against a LOCAL BARE remote (file://): streaming into
      the popup, exit 0 → pushed/pulled + refresh (the remote's refs
      verified), exit ≠ 0 (a diverged remote) → post-mortem retained
      + q closes; q-during-run is input (popup stays open, process
      stays live); a second P while running refuses
- [x] The no-repository refusal; the manual ssh-passphrase repro
      documented below (automated credential testing out of scope,
      recorded)

## Manual credential repro (documented, not automated)

```
ssh-keygen -t ed25519 -f /tmp/i293key -N 'passphrase'
# a scratch remote over ssh://user@localhost/... (or a git+ssh host);
# add the key to the agent WITHOUT the passphrase, then:
#   in tmax: SPC g → P → the remote prompts for the passphrase in
#   the popup → type it (verbatim input) → Enter → the push proceeds.
```
