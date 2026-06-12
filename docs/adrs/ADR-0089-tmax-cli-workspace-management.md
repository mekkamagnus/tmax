# tmax CLI Workspace Management

## Status

Accepted

## Context

The `tmax` launcher script had no workspace awareness — it always connected to the daemon's default (single) editor state. With multi-workspace support (ADR-0081), users needed CLI access to create, list, switch, and kill workspaces.

## Decision

Add workspace management flags to `bin/tmax`:

- `-w`/`--workspace NAME` — connect to (or create with `new:` prefix) a named workspace
- `--workspaces` — list all workspaces
- `--workspace-kill NAME` — delete a workspace
- Missing-argument validation for all value-taking flags
- Last-workspace persistence: if no `-w` flag is given and `~/.config/tmax/last-workspace` exists, the launcher reconnects to the previously used workspace automatically
- The `-e` eval path forwards the workspace flag when both are supplied

## Consequences

- **Easier**: Users can manage workspaces entirely from the CLI without needing T-Lisp commands. The `new:` prefix convention provides a concise way to create-and-connect in one step.
- **Harder**: The launcher script is more complex. The last-workspace persistence means users may unexpectedly reconnect to a previous workspace if they don't specify `-w`.
