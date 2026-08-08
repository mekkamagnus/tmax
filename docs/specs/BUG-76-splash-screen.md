# Bug: Splash screen is editable buffer text, not a vim-style read-only intro

## Bug Description

When tmax starts with no file, the `*scratch*` buffer shows a splash screen. This screen is **editable buffer text** — the user can accidentally modify/delete it. The "clear on first keystroke" logic is **broken** (references a non-existent `buffer-delete-line` function). The user wants a vim-style intro: app name + version + help hints, read-only, clears on any key.

**Expected:** A read-only splash screen (similar to vim's intro) showing app name, version, and key bindings. Visible but not editable. Clears on the first keystroke.

**Actual:** Editable text in the `*scratch*` buffer. The clear-on-first-keystroke logic is broken (`buffer-delete-line` doesn't exist). The user can accidentally edit the splash text.

## Problem Statement

The splash screen is regular buffer content in the `*scratch*` buffer (which is not in the `readonlyBuffers` set). It should be either:
1. A read-only special buffer that clears on first key, OR
2. A render overlay (not buffer content at all) that disappears on first key.

The simplest approach that fits tmax's architecture: make the splash a **read-only buffer** and clear it on the first keystroke by replacing its content with empty text (using existing primitives like `buffer-delete-range`).

## Solution Statement

1. **Make the splash buffer read-only** when it contains the splash text.
2. **Fix the clear logic**: on first keystroke, remove the read-only flag, clear the buffer text (using `buffer-delete-range`, not the non-existent `buffer-delete-line`), then process the keystroke normally.
3. **Improve the splash content**: centered text with app name, version, and a "Press any key to continue" hint (vim-style).

## Steps to Reproduce

1. `tmax` (no file argument)
2. The `*scratch*` buffer shows the splash text
3. Press `x` — the splash text should clear and the keystroke should be processed. Instead, the splash stays (or the keystroke edits the splash text).
4. Try typing in the splash — it's editable (should be read-only).

## Root Cause Analysis

1. **Splash is buffer text** (not an overlay) — `TextBufferImpl.SPLASH_TEXT` is inserted into `*scratch*` as regular content (`src/core/buffer.ts:143-154`).
2. **`*scratch*` is not read-only** — the `readonlyBuffers` set in `tlisp-api.ts:163` only includes `*Messages*`, `*daemon*`, etc.
3. **Clear logic is broken** — `insert-handler.ts:38-39` calls `buffer-delete-line` which doesn't exist. The condition check (`string-prefix-p "  tmax" (buffer-text)`) also uses `buffer-text` which returns the full buffer content — correct, but the deletion fails silently.
4. The splash shows `Version 0.0.0` (hardcoded) instead of the actual version (0.2.0).

## Relevant Files

- `src/core/buffer.ts` (lines 143-154) — `SPLASH_TEXT` constant (the splash content)
- `src/editor/handlers/insert-handler.ts` (lines 33-39) — the broken splash-clear logic on first keystroke
- `src/editor/handlers/normal-handler.ts` — needs the same splash-clear for normal-mode keys (currently only insert mode clears it)
- `src/editor/editor.ts` (lines 2917-2942) — `showSplashIfEmpty()` creates the splash
- `src/editor/tlisp-api.ts` (line 163) — `readonlyBuffers` set definition

### New Files
- None needed — the fix is surgical changes to existing files.

## Step by Step Tasks

### Task 1: Fix the splash text content (vim-style)

**User Story**: As a tmax user, I want a clean, informative splash screen showing the app name, version, and key hints, so I know what I'm looking at and how to get started.

- Update `TextBufferImpl.SPLASH_TEXT` in `src/core/buffer.ts` to include:
  - Centered app name + tagline
  - Version (read from package.json or a constant — not hardcoded wrong)
  - Key hints (similar to vim's intro: "type :help for help, :q to quit")
  - "Press any key to continue" hint at the bottom
- The sentinel for detection: first line starts with "  tmax" (already the case)

**Acceptance Criteria**:
- [ ] Splash text shows app name, version 0.2.0, key bindings, and a "press any key" hint
- [ ] The first line still starts with "  tmax" (for the detection sentinel)

### Task 2: Make the splash buffer read-only on creation

**User Story**: As a tmax user, I want the splash screen to be read-only, so I can't accidentally edit it before it clears.

- In `showSplashIfEmpty()` (editor.ts), after creating the splash buffer, set it read-only: `(buffer-set-read-only t)` for `*scratch*` while the splash is showing.
- Store a flag `splashActive: boolean` on the editor to track that the splash is showing.

**Acceptance Criteria**:
- [ ] When the splash is visible, `*scratch*` is read-only (mutation refused)
- [ ] After the splash clears, `*scratch*` is editable again

### Task 3: Fix the clear-on-first-keystroke logic

**User Story**: As a tmax user, I want the splash to clear when I press any key, so I can start editing immediately.

- In `insert-handler.ts`, replace the broken `buffer-delete-line` logic with:
  1. Check if `splashActive` (or detect via the "  tmax" sentinel in buffer text)
  2. Clear read-only: `(buffer-set-read-only nil)`
  3. Delete all splash text: use `buffer-delete-range` from (0,0) to (lastLine, endOfLine)
  4. Set `splashActive = false`
  5. Then process the keystroke normally
- In `normal-handler.ts`, add the SAME clear logic (so pressing any normal-mode key also clears the splash — like vim).

**Acceptance Criteria**:
- [ ] Pressing any key in normal mode clears the splash and processes the key
- [ ] Pressing any key in insert mode clears the splash and processes the key
- [ ] The splash text is fully removed (not partially deleted)
- [ ] After clearing, `*scratch*` is editable

## Validation Commands

- `bun run typecheck`
- `bun test test/unit/core-bindings.test.ts test/unit/vim-bindings-smoke.test.ts`
- Manual: `tmax` → see splash → press `i` → splash clears, insert mode works → type text → editable

## Notes

- The broken `buffer-delete-line` reference is documented in BUG-70 and BUG-72 but was never fixed.
- The current splash uses `Version 0.0.0` (wrong) — it should be `0.2.0` or read from package.json.
- Vim's intro screen is a temporary display overlay (not buffer content). tmax's architecture uses buffers for everything, so making the `*scratch*` buffer read-only during splash + clearing on first key is the pragmatic approach.
- The splash-clear logic should live in BOTH insert-handler and normal-handler (currently only insert-handler has it, and it's broken).
- `showSplashIfEmpty()` only shows the splash if the buffer is empty AND no filename — this is correct and should be preserved.
