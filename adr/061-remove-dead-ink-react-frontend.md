# Remove Dead Ink/React Frontend

## Status

Accepted

## Context

The project originally supported three interchangeable frontends: TUI (ANSI), Ink (React), and Steep. The architecture was designed around a React component tree with `ink` for terminal rendering (`src/frontend/components/*.tsx`, `src/frontend/frontends/ink/`).

After the daemon/client architecture was introduced (ADR 058), all actual editor rendering moved to the native ANSI TUI client (`src/client/tui-client.ts`). The React/Ink components became dead code — they were never imported or used in any active code path. `src/main.tsx` retained 131 lines of React-specific entry logic that was also unreachable.

The dead code confused navigation, bloated the codebase by ~2,500 lines, and gave the misleading impression that React was an active dependency.

## Decision

Delete the entire React/Ink frontend layer:

- `src/frontend/components/*.tsx` (6 files)
- `src/frontend/frontends/ink/**` (8 files)
- `src/frontend/hooks/*.ts` (2 files)
- Simplify `src/main.tsx` to remove the React entry path

The `src/frontend/render/` directory (ANSI rendering functions used by the TUI client) and `src/frontend/` directory itself are retained — they contain active rendering logic.

## Consequences

- ~2,500 lines of dead code removed.
- No React or Ink dependency remains in the active codebase.
- `src/frontend/` is now purely ANSI rendering utilities, not a multi-frontend abstraction layer.
- Future frontends should follow the daemon/client pattern (connect via JSON-RPC, render locally) rather than embedding in the editor process.
