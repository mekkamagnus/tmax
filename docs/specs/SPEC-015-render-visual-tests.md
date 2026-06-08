# Feature: Render Visual Tests

## Feature Description
Add two test suites that prove syntax highlighting colors actually reach the rendered output end-to-end:
1. **Visual assertions** — verify that token types produce the correct 24-bit ANSI codes in `captureFrame` output, proving the full pipeline (tokenizer → highlighter → spans → render) works
2. **Daemon parity** — verify that the daemon's `capture` JSON-RPC method produces the same rendered output as the local `captureFrame` function, preventing silent render drift between client and server

## User Story
As a developer working on the tmax rendering pipeline
I want automated tests that verify colors reach the screen
So that syntax highlighting regressions are caught before shipping

## Problem Statement
- Current highlighter tests only check `HighlightSpan` style objects — they never verify ANSI escape codes are actually emitted
- No test proves the daemon's `capture` method renders correctly
- If the render pipeline breaks (spans not passed, colors not applied), no existing test catches it

## Solution Statement
Write a visual assertion test suite that calls `captureFrame` with known buffer content for each language, then asserts the output contains the correct `38;2;R;G;Bm` ANSI codes for each token type. Write a daemon parity test that starts a daemon, connects a frame, opens a file, calls `capture` via JSON-RPC, and compares the result to a local `captureFrame` call.

## Relevant Files

### Existing Files
- `src/render/capture-frame.ts` — `captureFrame()` function under test
- `src/render/ansi-to-html.ts` — `ansiToHtml()` and `ansiLinesToHtmlDocument()` for HTML verification
- `src/syntax/types.ts` — `defaultDarkTheme` with hex color mappings
- `src/syntax/languages/lisp.ts` — Lisp/T-Lisp rules (keyword, builtin, boolean, number, string, comment, punctuation)
- `src/syntax/languages/typescript.ts` — TypeScript rules (keyword, type, boolean, number, string, decorator, comment)
- `src/syntax/languages/python.ts` — Python rules
- `src/syntax/languages/go.ts` — Go rules
- `src/syntax/languages/c.ts` — C rules
- `src/syntax/highlight-buffer.ts` — `computeHighlightSpans()` bridge
- `src/frontend/frontends/steep/style.ts` — `style()`, `hexToRGB()` for color conversion
- `src/core/buffer.ts` — `FunctionalTextBufferImpl.create()` for test buffers
- `src/server/server.ts` — daemon with `capture` JSON-RPC method

### New Files
- `test/unit/render-visual.test.ts` — Visual assertion tests for all token types across languages
- `test/unit/daemon-capture-parity.test.ts` — Daemon parity tests comparing local vs daemon capture

## Implementation Plan

### Phase 1: Visual Assertion Tests
Create a test suite that exercises the full render pipeline for each supported language, asserting that specific ANSI color codes appear in the output for each token type.

### Phase 2: Daemon Parity Tests
Create a test suite that starts a daemon, connects a frame, sends content, and compares the daemon's capture output against local rendering.

## Step by Step Tasks

### Create `test/unit/render-visual.test.ts`

- Import `captureFrame`, `ansiToHtml`, `FunctionalTextBufferImpl`, `defaultDarkTheme`, `hexToRGB`
- Create a helper `makeVisualState(content, filename)` that builds an `EditorState` with a real buffer
- Create a helper `hexToAnsiSeq(hex)` that converts `#RRGGBB` to the ANSI regex pattern `38;2;R;G;Bm`

#### T-Lisp/Lisp visual tests
- Test `defun` keyword renders with `#c678dd` (purple, bold)
- Test `;; comment` renders with `#5c6370` (dim gray)
- Test `"string"` renders with `#98c379` (green)
- Test `42` number renders with `#d19a66` (orange)
- Test `nil` boolean renders with `#d19a66` (orange)
- Test `car` builtin renders with `#e5c07b` (yellow)
- Test `(` parenthesis renders with `#abb2bf` (light gray)

#### TypeScript visual tests
- Test `function` keyword renders with `#c678dd`
- Test `// comment` renders with `#5c6370`
- Test `"hello"` string renders with `#98c379`

#### HTML output verification
- For each test above, also verify `ansiToHtml` produces the correct `rgb(R,G,B)` inline style
- Verify the HTML document contains `<span style="color:rgb(...)">` for each colored token

#### Theme coverage sweep
- Iterate over all entries in `defaultDarkTheme` that have a hex `fg` color
- For each, verify the ANSI output contains the matching `38;2;R;G;Bm` sequence when that token type is rendered

### Create `test/unit/daemon-capture-parity.test.ts`

- Create a helper that starts a daemon process (`bun src/main.tsx --daemon`), waits for the socket, connects via JSON-RPC
- Create a helper that sends `connect-frame`, then `open` with file content, then `capture`
- Test: local `captureFrame` output matches daemon `capture` output for the same editor state
- Test: daemon `capture` with `format: "html"` produces valid HTML with colored spans
- Clean up daemon process after each test

### Validation
- `bun run typecheck` — zero type errors
- `bun test` — all tests pass, zero failures (including new tests)

## Testing Strategy

### Unit Tests
- `render-visual.test.ts` — 15-20 tests covering all token types for T-Lisp, spot checks for TypeScript, HTML verification, theme sweep
- `daemon-capture-parity.test.ts` — 3-4 tests comparing local vs daemon rendering

### Edge Cases
- Token at column 0 (start of line)
- Multiple tokens on same line (e.g., `(defun foo` has keyword + punctuation)
- Empty line (no tokens, no colors)
- File with no extension (no highlighting)
- Very long line with many tokens

## Acceptance Criteria
1. Every token type in `defaultDarkTheme` that has a hex `fg` color has a test verifying its ANSI code appears in `captureFrame` output
2. ANSI codes in captured output match the hex values in the theme exactly
3. Daemon `capture` output matches local `captureFrame` output for the same state
4. All existing 1838 tests still pass
5. `bun run typecheck` passes with zero errors

## Validation Commands
- `bun run typecheck` — Zero type errors
- `bun test test/unit/render-visual.test.ts` — Visual assertion tests pass
- `bun test test/unit/daemon-capture-parity.test.ts` — Daemon parity tests pass
- `bun test` — Full suite passes with zero failures

## Notes
- Keep daemon parity tests short — start daemon, one capture, compare, stop. Avoid long-running daemon processes in test.
- The theme sweep test is a safety net: if someone changes a color in `defaultDarkTheme`, the test failure message shows exactly which token type broke.
- No new source code needed — this spec only adds tests.
