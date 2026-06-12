# Which-Key Per-Instance State

## Status

Accepted

## Context

The which-key popup used a module-level singleton for its state. With the introduction of multi-workspace support (ADR-0081), multiple editor instances could exist simultaneously, each needing independent which-key state. The singleton pattern caused state corruption when workspaces were switched or multiple frames were active.

## Decision

Extract all which-key state management into a per-instance `WhichKeyState` class:

- `which-key.ts` becomes a thin facade that delegates to a module-level `WhichKeyHandle`
- The facade retains backward-compatible exports (`scheduleWhichKey`, `deactivateWhichKey`, `resetWhichKeyState`, `isWhichKeyActive`)
- `getGlobalWhichKeyHandle()` provides access to the per-instance state for multi-frame scenarios
- `formatWhichKeyBindings` helper remains in the facade for rendering

The TUI client (`tui-client.ts`) now renders the which-key popup overlay at the bottom of the buffer area, overlaid on top of existing content.

## Consequences

- **Easier**: Multi-frame/multi-workspace scenarios have independent which-key state. The popup renders correctly in the TUI without conflicts.
- **Harder**: Callers must be aware of the per-instance handle instead of calling free functions. The backward-compatible facade hides this for existing callers but new code should use the handle directly.
