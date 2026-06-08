# Chore: Fix cursor rendering — block cursor instead of full-line highlight

## Chore Description
The editor has two cursor display bugs:

1. **Full-line white bar instead of block cursor**: Both the BufferView React components and the steep/TUI renderer highlight the entire current line with a white background (`bg: white, fg: black`). This creates a long white bar spanning the full editor width instead of showing a single-character block cursor at the cursor's column position, like nvim.

2. **Invisible cursor in command/minibuffer input**: The CommandInput components render the cursor as a white-on-white space (`color="white" backgroundColor="white"`), making it invisible. When the user enters `:` command mode, no cursor is visible.

**Expected behavior**: A solid block cursor at the exact cursor position (line + column) in the buffer, and a visible cursor in the command input — like nvim in a typical terminal.

## Relevant Files

### Ink frontend (React/Ink components)
- `src/frontend/components/BufferView.tsx` — Renders buffer lines; applies full-line `backgroundColor="white"` to cursor line (line 100-101). Must split line at cursor column and invert only the character at that position.
- `src/frontend/frontends/ink/components/BufferView.tsx` — Duplicate of the above for the ink frontend submodule. Same fix needed.
- `src/frontend/components/CommandInput.tsx` — Renders command input; cursor is `<Text color="white" backgroundColor="white"> </Text>` on line 171 — invisible. Must render a visible block cursor.
- `src/frontend/frontends/ink/components/CommandInput.tsx` — Duplicate for ink submodule. Same fix needed.

### Steep/TUI frontend (ANSI rendering)
- `src/frontend/render/buffer-lines.ts` — Renders buffer lines via ANSI. Lines 150 and 155 apply `style(padded, { fg: "black", bg: "white" })` to the entire current line. Must render only a block cursor at the column position.
- `src/frontend/render/command-input.ts` — Renders command input via ANSI. Line 9 uses `style(" ", { fg: "white", bg: "white" })` — invisible cursor. Must render visible cursor.
- `src/frontend/frontends/steep/index.ts` — Calls `screen.hideCursor()` on line 57. The steep frontend positions the real terminal cursor via `screen.moveTo()` but hides it. Should show the terminal cursor instead (it's already positioned correctly).

## Step by Step Tasks

### Fix steep/TUI frontend (ANSI renderers) — foundational change

- **`src/frontend/render/buffer-lines.ts`**: In `renderSingleWindow()`, remove the full-line white background highlight for the current line. Instead, when `isCurrentLine && lineNumber === cursorLine`, split the line content at the cursor column and apply inverted styling (`fg: black, bg: white`) to only the single character at the cursor column position. All other characters on the line render normally.
  - Handle edge cases: cursor at column 0, cursor past end of line (render a space with inverted colors), empty line content (render inverted space at cursor).

- **`src/frontend/render/command-input.ts`**: Change the cursor from `style(" ", { fg: "white", bg: "white" })` to `style(" ", { fg: "black", bg: "white" })` (or render an inverted block character) so it's visible as a solid white block.

- **`src/frontend/frontends/steep/index.ts`**: Change `screen.hideCursor()` (line 57) to `screen.showCursor()` so the real terminal cursor is visible and positioned at the correct buffer position.

### Fix Ink frontend React components

- **`src/frontend/components/BufferView.tsx`**: In `renderLines()`, remove the full-line `backgroundColor="white"` on the cursor line. Instead, split the line at `cursorPosition.column` and render three segments: text before cursor (normal), the character at cursor position (inverted: `backgroundColor="white" color="black"`), and text after cursor (normal). Handle edge cases: cursor at end of line or beyond (render an inverted space).

- **`src/frontend/frontends/ink/components/BufferView.tsx`**: Apply the exact same fix as above.

- **`src/frontend/components/CommandInput.tsx`**: Change the cursor from `<Text color="white" backgroundColor="white"> </Text>` to `<Text color="black" backgroundColor="white"> </Text>` to render a visible solid white block cursor.

- **`src/frontend/frontends/ink/components/CommandInput.tsx`**: Apply the exact same fix as above.

### Validation

- Run `bunx tsc --noEmit` to verify zero type errors.
- Run `bun test` to verify all existing tests pass.
- Run the UI test `test/ui/tests/05-command-mode-cursor-focus.test.sh` to verify command mode cursor behavior still works.

## Validation Commands
- `bunx tsc --noEmit` — Zero type errors after all changes
- `bun test` — All existing tests pass with no regressions
- `bash test/ui/tests/05-command-mode-cursor-focus.test.sh` — Command mode cursor focus test passes

## Notes
- The cursor column position is already tracked in `cursorPosition.column` in the EditorState — it's just not being used for rendering currently.
- For the BufferView, when the cursor is at a position past the end of the line content, render an inverted space character to represent the block cursor (same as vim behavior on empty lines).
- The steep frontend already positions the real terminal cursor correctly via `screen.moveTo(cursorRow, cursorCol)` — it just needs to be shown instead of hidden.
- Both `src/frontend/components/` and `src/frontend/frontends/ink/components/` contain near-identical copies of BufferView.tsx and CommandInput.tsx. Both sets must be fixed.
