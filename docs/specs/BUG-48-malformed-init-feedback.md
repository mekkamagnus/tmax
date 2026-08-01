# Bug: malformed init.tlisp silently swallowed (no user feedback)

## Bug Description
A syntactically broken `~/.config/tmax/init.tlisp` was discarded with zero user
feedback: `loadInitFile` called `evalCode(initContent)` and discarded the returned
`Either` (the interpreter does not throw on parse errors). The *Messages* buffer
stayed clean, the status line showed nothing, and the daemon log falsely reported
"Loaded init file." A user-typo'd config is the single most likely real-world load
failure.

## Problem Statement
A malformed init file must produce a visible diagnostic without crashing startup.

## Solution Statement
In `binding-runtime.ts:loadInitFile`, capture the `evalCode` result and on `Left`:
surface via `setStatusMessage("Init file error: <message>")` (user-facing status
line — codex: route through a durable user-facing callback, not merely the internal
log which is disabled without `DEBUG=tmax`). On `Right`: log "Loaded" as before.

Codex APPROVE-WITH-CONCERNS: route Left through a user-facing callback (DONE via
setStatusMessage); make success messages stop claiming "Loaded" on Left (DONE —
the "Loaded" log now only fires on Right).

## Relevant Files
- `src/editor/runtime/binding-runtime.ts:239-253` — capture result, surface Left.

## Step by Step Tasks
### Task 1 — surface errors
**AC**: a malformed init file sets the status message to "Init file error: ..." + the daemon stays alive.
### Task 2 — don't falsely claim "Loaded"
**AC**: the "Loaded init file" log only fires when evalCode returns Right.
### Task 3 — Validate
typecheck clean + empirical verification + verify-gate PASS.

## Validation Commands
- `bun run typecheck:src`
- Start daemon with a malformed `--init-file` → daemon alive + status line shows the error.

## Notes
- The internal `initLog` requires `DEBUG=tmax` to be visible; `setStatusMessage` is the user-facing surface.
- The literal-`~` fallback branch (line 235) is #74's scope, not touched here.
