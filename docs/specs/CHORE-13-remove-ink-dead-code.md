# Chore: Remove Ink frontend and dead code

## Chore Description
Remove the unused Ink/React frontend, its duplicate code in `main.tsx`, and orphaned type files. The active rendering paths are: (1) `tui-client.ts` for daemon mode and (2) `SteepFrontend` for standalone mode — both use ANSI render functions from `src/frontend/render/`. The Ink path was never production-ready and is completely dead.

## Relevant Files

Files to **delete entirely**:
- `src/frontend/frontends/ink/` — entire directory (InkFrontend class + components + hooks, never imported)
- `src/frontend/components/` — entire directory (React/Ink components, only reachable from dead Ink path)
- `src/frontend/hooks/` — entire directory (React hooks, only reachable from dead Ink path)
- `src/frontend/types.ts` — React/Ink type definitions, never imported by any live code
- `src/frontend/ink-adapter.ts` — never imported anywhere
- `src/frontend/input.ts` — never imported anywhere

Files to **edit**:
- `src/main.tsx` — Remove ink import (`import { render } from 'ink'`), remove `Editor` component import, remove the `--ink` flag handling block (lines 365-413), remove help text references to `--ink`. Keep SteepFrontend path.
- `src/frontend/frontends/types.ts` — Keep this file; `SteepFrontend` implements the `Frontend` interface from it.

## Step by Step Tasks

### Delete dead Ink frontend directory

- Remove `src/frontend/frontends/ink/` (entire directory: index.tsx, ink-adapter.ts, components/, hooks/)

### Delete dead React component directory

- Remove `src/frontend/components/` (entire directory: Editor.tsx, BufferView.tsx, StatusLine.tsx, CommandInput.tsx, MinibufferView.tsx, TabBar.tsx)

### Delete dead React hooks directory

- Remove `src/frontend/hooks/` (entire directory: useEditorState.ts, useTerminalDimensions.ts)

### Delete dead type and adapter files

- Remove `src/frontend/types.ts`
- Remove `src/frontend/ink-adapter.ts`
- Remove `src/frontend/input.ts`

### Clean up main.tsx

- Remove `import { render } from 'ink'` (line 8)
- Remove `import { Editor } from './frontend/components/Editor.tsx'` (line 9)
- Remove `--ink` from help text (lines 161, 169)
- Remove the `useInk` / `if (useInk)` block (lines 365-413) — the entire Ink rendering path
- Keep the `SteepFrontend` else branch as the only frontend path (remove the `else` since there's no `if` anymore)

### Run validation

- Run typecheck and test suite

## Validation Commands
```bash
bun run typecheck       # Zero type errors
bun run test:ui         # 24/24 tests pass
bun run test:daemon     # All daemon tests pass
```

## Notes
- `src/frontend/frontends/types.ts` must stay — `SteepFrontend` implements its `Frontend` interface
- `src/frontend/frontends/steep/` must stay — it's the active standalone frontend
- `src/frontend/render/` must stay — ANSI render functions used by both `tui-client.ts` and `SteepFrontend`
- `main.tsx` can be renamed to `main.ts` after removing the Ink/JSX imports, but that's out of scope for this chore
