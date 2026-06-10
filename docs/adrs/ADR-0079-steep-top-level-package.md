# Steep as a Top-Level Package

## Status

Accepted

## Context

Steep — tmax's Elm-Architecture styling and rendering framework — lived under `src/frontend/frontends/steep/`. It was buried two levels deep in a directory whose name (`frontends`, plural) implied it sat alongside other frontends as a peer, not as a reusable framework.

In practice, Steep was being used by more than the frontend layer:

- The markdown renderer needed its styling primitives (matcha).
- The render pipeline integration (assam) was used outside `src/frontend/`.
- A new markdown renderer (oolong) was being added that depended on Steep's styling API.

Having Steep nested under `src/frontend/frontends/` meant every non-frontend consumer imported across the frontend boundary, which conflated "frontend as rendering target" with "Steep as a styling library." The naming also blocked introducing Steep as a separately versioned package later.

## Decision

Promote Steep from `src/frontend/frontends/steep/` to a top-level `src/steep/` package.

The package is split into three modules by responsibility:

- `src/steep/matcha.ts` — ANSI styling primitives. No editor dependencies.
- `src/steep/assam.ts` — render pipeline integration. Bridges Steep's view model to terminal output.
- `src/steep/oolong.ts` — markdown renderer with theme support. The newest module; depends on matcha.

`src/steep/input.ts` (keyboard input handling) moves alongside them.

All imports across `src/frontend/render/`, `src/main.tsx`, and the markdown commands are updated to the new paths.

## Consequences

- **Clear separation of concerns.** `src/frontend/` is now exclusively the frontend layer (Steep, Ink as adapter, render integration). `src/steep/` is the styling framework that the frontend layer happens to use.
- **Steep can be extracted later.** With the package at top level, a future decision to publish Steep as a standalone library is mechanical — it has no upward dependencies on `src/editor/` or `src/frontend/`.
- **Markdown rendering is first-class.** The oolong module sits next to its styling dependencies, which makes the markdown-rendering story cohesive instead of split across directories.
- **Tradeoff: import-path churn.** Every file that imported Steep needed updating. The change is mechanical but touches many files — future relocations should batch with other refactors to avoid repeated diff noise.
- **No runtime behavior change.** This is a pure module reorganization; tests and functionality are unaffected.
