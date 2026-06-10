# Bug: Emoji/wide characters break line rendering alignment

## Bug Description
Lines containing emoji characters (✅, ❌, 🎯, etc.) display with broken formatting in the TUI. The terminal renders these characters as 2-column wide glyphs, but the renderer uses `string.length` (1 char = 1 column) for all width calculations. This causes:
- Lines with emoji to extend past the right edge of the viewport
- Subsequent lines to be offset or misaligned
- Truncation happening at the wrong visual position

## Problem Statement
Two functions in `buffer-lines.ts` treat all characters as single-column width:
1. `fitToWidth(text, width)` — uses `text.length` and `text.padEnd(width)` which counts code units, not display columns
2. `padAnsiToWidth(text, width)` — uses `visible.length` which also ignores wide characters

Additionally, the block cursor rendering in `renderWithBlockCursorAnsi` advances `visiblePos++` for every non-ANSI character regardless of display width, so cursor positioning is also wrong on lines with emoji.

## Solution Statement
Add a `stringWidth` helper that counts visual display columns (treating codepoints > 127 as 2-column wide — a safe approximation for CJK, emoji, and other wide glyphs). Use it in `fitToWidth`, `padAnsiToWidth`, `renderWithBlockCursorAnsi`, and the multi-window cell padding logic.

## Steps to Reproduce
1. Open `docs/ROADMAP.md` in the tmax TUI: `bun run start docs/ROADMAP.md`
2. Observe lines like `- ✅ Modal editing` — the content after the emoji shifts right
3. Lines overflow the viewport width and wrap or truncate incorrectly

## Root Cause Analysis
JavaScript `string.length` counts UTF-16 code units. Characters like ✅ (U+2705) are a single code unit but render as 2 terminal columns. The renderer assumes 1 code unit = 1 column everywhere:

- `fitToWidth` line 35: `text.padEnd(width)` pads based on `.length`, not visual width
- `fitToWidth` line 37: `text.slice(0, width)` truncates by code unit index, not column
- `padAnsiToWidth` line 101: `visible.length >= width` compares code units to column count
- `padAnsiToWidth` line 102: `" ".repeat(width - visible.length)` under-pads for wide chars
- `renderWithBlockCursorAnsi` line 139: `visiblePos++` increments by 1 per char regardless of width
- Multi-window line 307: `cell.width - stripped.length` assumes 1 char = 1 column

## Relevant Files

- `src/frontend/render/buffer-lines.ts` — contains `fitToWidth`, `padAnsiToWidth`, `renderWithBlockCursorAnsi`, and the multi-window padding logic. All need to use visual width instead of `.length`.
- `src/frontend/render/gutter.ts` — gutter rendering; uses `fitToWidth` internally, may need adjustment.
- `src/render/capture-frame.ts` — frame capture for tests; may also use width calculations.

### New Files

- None needed — the `stringWidth` helper can be a private function in `buffer-lines.ts`.

## Step by Step Tasks

### Add stringWidth helper

**User Story**: As a developer, I want a visual-width calculator so that all rendering code accounts for wide characters.

- Add a `stringWidth(str: string): number` function in `buffer-lines.ts` that counts 2 columns for any codepoint > 127 (covers CJK, emoji, etc.) and 1 column for ASCII. Iterate over codepoints using `for...of` or spread.
- Export it for reuse if needed.

**Acceptance Criteria**:
- [ ] `stringWidth("hello")` returns 5
- [ ] `stringWidth("✅")` returns 2
- [ ] `stringWidth("- ✅ done")` returns 9

### Fix fitToWidth

**User Story**: As a user viewing files with emoji, I want lines to fit within the viewport without overflow.

- Replace `text.length` comparisons with `stringWidth(text)` in `fitToWidth`
- Change truncation to slice by visual position (iterate codepoints, accumulating width, until hitting the limit)
- Change padding to use `width - stringWidth(text)` spaces

**Acceptance Criteria**:
- [ ] `fitToWidth("✅ ok", 5)` truncates correctly (e.g. "✅ o…")
- [ ] `fitToWidth("hi", 5)` returns "hi   " (padded to 5 columns)
- [ ] Lines with emoji in ROADMAP.md no longer overflow the viewport

### Fix padAnsiToWidth

**User Story**: As a user, I want syntax-highlighted lines with emoji to be correctly padded.

- Replace `visible.length` with `stringWidth(visible)` in `padAnsiToWidth`
- Use `stringWidth` for the padding calculation

**Acceptance Criteria**:
- [ ] Highlighted lines with emoji pad to the correct visual width
- [ ] No visual gaps or overflow on highlighted lines

### Fix renderWithBlockCursorAnsi

**User Story**: As a user, I want the block cursor to appear at the correct column on lines with emoji.

- Change `visiblePos++` to `visiblePos += charWidth(text[i])` where `charWidth` returns 2 for wide chars and 1 for ASCII
- Ensure the split point is at the correct visual position

**Acceptance Criteria**:
- [ ] Block cursor appears directly on the emoji character when positioned there
- [ ] Block cursor on a character after an emoji is visually correct

### Fix multi-window cell padding

**User Story**: As a user with split windows, I want cell content to pad correctly even with emoji.

- In the multi-window loop (line ~307), replace `stripped.length` with `stringWidth(stripped)` for padding calculation

**Acceptance Criteria**:
- [ ] Split windows display emoji-containing content without overflow

### Write regression tests

**User Story**: As a developer, I want automated tests to prevent this bug from recurring.

- Add unit tests for `stringWidth` helper
- Add tests for `fitToWidth` with emoji input
- Add tests for `padAnsiToWidth` with emoji input

**Acceptance Criteria**:
- [ ] New tests pass
- [ ] All existing tests continue to pass

### Run Validation Commands

**Acceptance Criteria**:
- [ ] `bun run typecheck:src` passes
- [ ] `bun run typecheck:test` passes
- [ ] `bun test test/unit/` — 0 failures
- [ ] Visual check: open `docs/ROADMAP.md` in TUI and verify ✅/❌ emoji lines render correctly

## Validation Commands
- `bun run typecheck:src` — typecheck source
- `bun run typecheck:test` — typecheck tests
- `bun test test/unit/` — full test suite, must be 0 failures
- `bun run start docs/ROADMAP.md` — visual verification that emoji lines are aligned

## Notes
- This is a display-only bug — no data corruption or editor logic is affected.
- The `stringWidth` approximation (codepoint > 127 → 2 columns) is a pragmatic simplification. Full Unicode width handling (e.g., `wcwidth`) would require an external dependency, which conflicts with the project's zero-dependency policy.
- Some combining characters and variation selectors may need special handling in the future, but the current fix addresses the immediate emoji issue.
