# Feature: Daemon Render Cache & Frame Capture

## Feature Description
Add a `--capture` CLI flag that asks the daemon to render the current editor state and return the result as either raw ANSI text (with colors intact) or HTML. This provides a reliable way to inspect the editor's visual state without relying on `tmux capture-pane` (which strips ANSI colors) or `screencapture` (which fails on GPU-rendered terminals).

## User Story
As a developer demoing or debugging tmax
I want to capture the current editor frame with colors preserved
So that I can inspect rendering, take screenshots via browser, or share visual state

## Problem Statement
- `tmux capture-pane` strips all ANSI escape codes, making it impossible to verify syntax highlighting colors
- `screencapture -R` fails to capture iTerm2's GPU-rendered content (produces solid blue)
- There is no way to inspect the rendered output of the editor from outside the terminal session
- No ANSI-to-HTML converter exists in the codebase

## Solution Statement
Add a JSON-RPC `capture` method to the daemon that re-renders the current `EditorState` using the same rendering pipeline the TUI client uses, then returns the ANSI lines. Add an ANSI-to-HTML converter for the `--capture-html` variant. Wire both through `tmaxclient` and the `tmax` CLI.

Memory is **on-demand only** — no persistent cache. The daemon re-renders when `--capture` is called, returns the result, and discards it.

## Relevant Files

### Existing Files
- `src/server/server.ts` — Daemon JSON-RPC handler; add `capture` method
- `src/server/serialize.ts` — State serialization; used as reference for what's available
- `src/client/tui-client.ts` — Client-side render function; reuse its pipeline server-side
- `src/frontend/render/buffer-lines.ts` — `renderBufferLines()` with highlight span support
- `src/frontend/render/status-line.ts` — Status line renderer
- `src/frontend/render/command-input.ts` — Command line renderer
- `src/frontend/render/minibuffer.ts` — Minibuffer renderer
- `src/frontend/render/tab-bar.ts` — Tab bar renderer
- `src/syntax/highlight-buffer.ts` — `computeHighlightSpans()` for syntax colors
- `src/frontend/frontends/steep/style.ts` — `style()`, `fg()`, `bg()` ANSI generators
- `bin/tmax` — Shell CLI; add `--capture` and `--capture-html` flags
- `bin/tmaxclient` — Node CLI; add `--capture` and `--capture-html` handling

### New Files
- `src/render/capture-frame.ts` — Standalone render function that takes `EditorState` + dimensions and returns ANSI `string[]`
- `src/render/ansi-to-html.ts` — Converts ANSI escape sequences to HTML with inline styles

## Implementation Plan

### Phase 1: Standalone Capture Renderer
Extract the render pipeline from `tui-client.ts` into a reusable function that doesn't depend on terminal I/O.

### Phase 2: ANSI-to-HTML Converter
Build a regex-based ANSI-to-HTML converter that handles 24-bit colors, 256-color, and text attributes.

### Phase 3: Daemon Integration
Wire the capture renderer into the daemon as a `capture` JSON-RPC method.

### Phase 4: CLI Integration
Add `--capture` and `--capture-html` flags to `tmaxclient` and `tmax`.

## Step by Step Tasks

### Create `src/render/capture-frame.ts`
- Import `renderBufferLines`, `renderStatusLine`, `renderCommandInput`, `renderMinibuffer`, `renderTabBarAnsi` from existing render modules
- Import `computeHighlightSpans` for syntax colors
- Import `getVisibleViewportTop` for viewport calculation
- Define `captureFrame(state: EditorState, width: number, height: number): string[]` that mirrors the `render()` function from `tui-client.ts` but returns strings instead of writing to terminal
- The function should compute highlight spans, render buffer lines, status line, command input/minibuffer, and tab bar — exactly as the client does

### Create `src/render/ansi-to-html.ts`
- Parse ANSI escape sequences: `\x1b[38;2;R;G;Bm` (24-bit fg), `\x1b[48;2;R;G;Bm` (24-bit bg), `\x1b[38;5;Nm` (256 fg), `\x1b[48;5;Nm` (256 bg), `\x1b[1m` (bold), `\x1b[2m` (dim), `\x1b[22m` (bold off), `\x1b[0m` (reset)
- Convert each sequence to an HTML `<span style="...">` element
- Build a full HTML document with dark background, monospace font, and line padding
- Export `ansiToHtml(lines: string[]): string` and `ansiLinesToHtmlDocument(lines: string[], width: number, height: number): string`

### Add `capture` JSON-RPC method to daemon
- In `src/server/server.ts`, add a `capture` method handler
- Accept params: `{ format: "ansi" | "html" }` (default: "ansi")
- Call `captureFrame(editorStateToJson(...), width, height)` using the editor's state and stored terminal dimensions from the frame observability struct
- If format is "html", run through `ansiToHtml`
- Return `{ lines: string[], width, height }` for ANSI or `{ html: string }` for HTML

### Add `--capture` and `--capture-html` to `tmaxclient`
- In `bin/tmaxclient`, parse `--capture` and `--capture-html` flags
- Send `capture` JSON-RPC request with appropriate format
- For `--capture`: write raw ANSI to stdout (redirectable to a file)
- For `--capture-html`: write HTML to a temp file and print the path, or write to stdout

### Add `--capture` and `--capture-html` to `tmax` CLI
- In `bin/tmax`, add `--capture` and `--capture-html` flags
- Ensure daemon is running, then delegate to `tmaxclient --capture` / `tmaxclient --capture-html`

### Write tests
- Unit test for `captureFrame()`: verify it returns the right number of lines, includes ANSI codes when syntax highlighting is active
- Unit test for `ansiToHtml()`: verify 24-bit colors, 256-color, bold, reset all convert correctly
- Unit test for the full pipeline: editor state → capture → HTML output contains `<span>` elements with correct RGB colors

### Validation
- Run `bun run typecheck` — zero type errors
- Run `bun test` — zero failures
- Run `tmax --capture > /tmp/frame.ansi` — verify the file contains ANSI escape codes
- Run `tmax --capture-html > /tmp/frame.html && open /tmp/frame.html` — verify browser shows colored syntax
- Run `bun run test:daemon` — daemon tests pass

## Testing Strategy

### Unit Tests
- `test/unit/capture-frame.test.ts` — Test `captureFrame()` with known editor state
- `test/unit/ansi-to-html.test.ts` — Test ANSI-to-HTML conversion for all supported escape sequences

### Integration Tests
- Extend daemon test harness to test `capture` JSON-RPC method

### Edge Cases
- Empty buffer
- Buffer with no filename (no language detection → no highlighting)
- Very long lines that get truncated
- Multi-window layout
- Minibuffer active during capture
- Block cursor rendering in captured output

## Acceptance Criteria
1. `tmax --capture` writes ANSI output with syntax highlighting escape codes intact
2. `tmax --capture-html` writes a standalone HTML file that renders correctly in a browser with colors
3. No persistent memory overhead — rendering happens on demand only
4. All existing tests pass (1813+)
5. `bun run typecheck` passes with zero errors

## Validation Commands
- `bun run typecheck` — Zero type errors
- `bun test` — All tests pass, zero failures
- `bun src/main.tsx --daemon &` then `bun bin/tmaxclient --capture` — Returns ANSI frame
- `bun bin/tmaxclient --capture-html` — Returns HTML with colored spans
- `bun run test:daemon` — Daemon integration tests pass

## Notes
- The 256-color palette values for named colors (e.g., "green", "blue") can be resolved to RGB for HTML output by looking up the xterm-256 color table
- Future enhancement: `--capture-gif` or frame streaming for demo recording
- The `capture` method uses the frame's stored terminal dimensions; if no frame is connected, fall back to 80x24
