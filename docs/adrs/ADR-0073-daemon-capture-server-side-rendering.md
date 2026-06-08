# Daemon Capture: Server-Side Rendering

## Status

Accepted

## Context

The daemon drives a TUI client over a Unix socket, but had no way to inspect what the editor looks like without attaching a terminal. `tmux capture-pane` strips ANSI colors. Taking screenshots of iTerm2 fails when GPU rendering is active. There was no mechanism to produce a faithful visual representation of the editor state for testing, debugging, or documentation.

## Decision

Add a `capture` JSON-RPC method to the daemon that renders the current frame server-side and returns the result in ANSI or HTML format. Two new modules:

- `src/render/capture-frame.ts` — Pure function `captureFrame(state, width, height): string[]` that mirrors the TUI client's render loop but returns ANSI strings instead of writing to a terminal. Includes syntax highlighting spans.
- `src/render/ansi-to-html.ts` — Converts ANSI escape sequences (24-bit, 256-color, bold, dim) to HTML with inline styles and One Dark background.

CLI flags: `tmaxclient --capture` (ANSI) and `tmaxclient --capture-html` (HTML).

The capture renders fresh on each call with zero persistent memory. When no TUI is connected, it renders the daemon's internal editor state.

## Consequences

- Visual testing can now assert specific ANSI color codes reach rendered output without tmux.
- HTML capture enables browser-based review, screenshot diffs, and documentation generation.
- The capture pipeline exercises the same render path as the live TUI, so visual regressions are caught early.
- Adding new render features (tab bar, minibuffer, splits) automatically updates capture output.
