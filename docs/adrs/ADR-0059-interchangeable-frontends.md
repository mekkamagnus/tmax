# ADR 059: Interchangeable Frontend Architecture

**Date**: 2026-06-02
**Status**: Accepted

## Context

The original tmax architecture (ADR-003) used React/Deno-ink as the rendering frontend, running inside the main process. This created several problems:

1. The frontend was tightly coupled to the Editor — React components directly accessed editor state
2. Running the full React rendering pipeline added startup latency and dependency weight
3. The daemon/client split (ADR-058) requires a thin client that connects remotely, not a full editor in every process
4. Different use cases need different frontends: TUI for terminals, Ink for richer rendering, Steep for experimental work

The core architecture principle remains T-Lisp-first (ADR-003) — TypeScript handles I/O and rendering while T-Lisp handles logic. But the rendering layer needed to be pluggable.

## Decision

1. Separate frontends into `src/frontend/frontends/` with each frontend as an independent module:
   - **Ink** (`frontends/ink/`) — React/Deno-ink based with components (BufferView, StatusLine, CommandInput, Editor) and hooks (useEditorState, useTerminalDimensions)
   - **Steep** (`frontends/steep/`) — Experimental alternative with screen, input, and style modules
   - **TUI** (`src/client/tui-client.ts`) — Direct ANSI escape sequence rendering, no framework dependency

2. Add a shared render layer in `src/frontend/render/` with common helpers:
   - `buffer-lines.ts` — converts buffer content to renderable lines
   - `status-line.ts` — formats the status line
   - `command-input.ts` — formats command input display

3. Add a serialization layer (`src/server/serialize.ts`) that converts EditorState to/from JSON for network transport. All frontends communicate with the daemon through this serialized format.

4. The TUI client (`tui-client.ts`) is the default frontend. It polls the daemon for state every 200ms and renders using raw ANSI escape sequences. No React, no Ink, no Deno — just TypeScript and a terminal.

5. A `Frontend` interface (`frontends/types.ts`) defines the contract: `start()`, `stop()`, `render(state)`, `onInput(callback)`.

## Consequences

### Positive

- Users can choose the frontend that fits their environment — TUI for bare terminals, Ink for richer rendering
- The TUI client has zero framework dependencies — runs on plain Bun with just the `net` module
- Adding a new frontend (web, IDE extension, etc.) requires implementing the `Frontend` interface
- Shared render helpers prevent duplication of line-wrapping, status formatting, etc.
- The serialization layer isolates frontends from Editor internals — they only see JSON

### Negative

- The Ink frontend still depends on React and Deno, creating a split dependency tree. A pure-Bun TUI is simpler but less feature-rich.
- The Steep frontend is scaffolding only — not functional yet. This creates dead code until it's implemented.
- The 200ms polling interval in the TUI client introduces visible latency. A push-based protocol (e.g., daemon broadcasts state changes) would be more responsive but more complex.

### Neutral

- The `Frontend` interface is minimal (4 methods). More complex frontends may need extensions for features like multi-window layouts, but the current scope is single-viewport.
- The serialization layer flattens Map objects to arrays for JSON compatibility. This is lossy for Map-specific features (iteration order guarantees) but sufficient for display purposes.
