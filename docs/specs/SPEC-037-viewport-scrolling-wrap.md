# Feature: Horizontal Scrolling and Word Wrap

**Depends on:** BUG-10 (markdown mode detection, merged), existing `auto-fill-mode` stub

### Prerequisites (must pass before implementation)

1. **Existing `viewportTop` vertical scroll** — horizontal scroll mirrors the same state/render pattern
2. **`auto-fill-mode` minor mode** — already toggles `config.wordWrap`; spec wires it to the renderer
3. **`z` prefix dispatcher in `motions.tlisp`** — horizontal scroll commands extend the existing `zt`/`zz`/`zb` pattern

## Feature Description

Lines longer than the terminal width are currently truncated with `...` and there is no way to see or navigate past the visible area. The `wordWrap` config field exists but the renderer ignores it, making `auto-fill-mode` a visual no-op.

This spec adds two display capabilities: **horizontal scrolling** (a `viewportLeft` offset with Vim-style `zl`/`zh`/`zs`/`ze` commands and auto-scroll) and **word wrap** (long lines wrap across multiple screen rows when `config.wordWrap` is true). The two modes are mutually exclusive — wrap forces `viewportLeft` to 0.

## User Story

As a developer editing long lines (code, prose, JSON, logs)
I want to scroll horizontally and toggle word wrap
So that I can read and edit content that extends past the terminal width

## Problem Statement

Long lines are truncated with `...` at the terminal width boundary. There is no `viewportLeft` state, no horizontal scroll offset in the renderer, no horizontal scroll keybindings, and the `wordWrap` config flag is never read during rendering.

## Solution Statement

1. Add `viewportLeft` to `EditorState`, `Window`, and `Frame` with get/set T-Lisp primitives
2. Update `renderSingleWindow` to slice lines from `viewportLeft` with `«`/`»` indicators
3. Add auto-scroll that clamps `viewportLeft` to keep the cursor visible
4. Wire `zl`/`zh`/`zs`/`ze` into the existing z-prefix dispatcher in `motions.tlisp`
5. Add a word-wrap render path that activates on `config.wordWrap`, mapping logical lines to screen rows
6. Update `docs/srs.md` with user stories

## Architecture Constraints

| Area | Governing Doc | Rule |
|------|--------------|------|
| Editor logic vs primitives | `src/editor/CLAUDE.md` | TypeScript provides display primitives only; scroll commands and keybindings live in T-Lisp |
| T-Lisp command pattern | `src/tlisp/CLAUDE.md` | New commands go in `src/tlisp/core/commands/*.tlisp`, use `(key-bind ...)` in same file |
| Rendering pipeline | `src/frontend/render/buffer-lines.ts` | All rendering goes through `renderSingleWindow`; both frontends (Steep, TUI) share it |
| CJK character width | `buffer-lines.ts` `charWidth()` | Characters >127 count as width 2; all slicing must use visual width, not string length |
| State serialization | `src/server/server.ts`, `Frame` type | `viewportLeft` must propagate through frame state, `getEditorState()`, and `setState()` |

## Relevant Files

### Existing Files to Modify

| File | Change | Constraints |
|------|--------|-------------|
| `src/core/types.ts` | Add `viewportLeft: number` to `EditorState`, `Window`, `Frame` | Must default to 0; `Validators.editorConfig` unchanged |
| `src/editor/editor.ts` | Init `viewportLeft: 0`, add getter/setter in `EditorStateAccess`, propagate in get/setState | Follow `viewportTop` pattern exactly (lines 137, 292, 2322, 2543) |
| `src/editor/api/jump-ops.ts` | Add `viewport-left-get`, `viewport-left-set` primitives | Follow `viewport-top-get`/`viewport-top-set` pattern; clamp >= 0 |
| `src/frontend/render/buffer-lines.ts` | Add `viewportLeft` param to `renderSingleWindow`; add `getVisibleViewportLeft`; add word-wrap render branch | CJK-aware via `charWidth()`; wrap and scroll are mutually exclusive |
| `src/client/tui-client.ts` | Subtract `viewportLeft` from terminal cursor column | Line 89: `cursorCol` calculation |
| `src/steep/assam.ts` | Subtract `viewportLeft` from terminal cursor column | Line 69: `cursorCol` calculation |
| `src/tlisp/core/commands/motions.tlisp` | Add `scroll-column-left/right`, `scroll-cursor-start/end`; wire `zl`/`zh`/`zs`/`ze` into z-prefix dispatcher; update `vim-prefix-bindings` | Editor logic in T-Lisp per `src/tlisp/CLAUDE.md` |
| `docs/srs.md` | Add US-1.21.1, US-1.21.2 with acceptance criteria | Follow existing user story format |

### New Files

| File | Purpose | Constraints |
|------|---------|-------------|
| None required | All changes fit existing files | — |

## Implementation Phases

### Phase 1: Horizontal Scroll State and Primitives — wire `viewportLeft` into types, editor state, and T-Lisp API

**Constraint checkpoint:** Before starting this phase, verify:
- [ ] `EditorState`, `Window`, `Frame` interfaces are understood (read `src/core/types.ts`)
- [ ] `viewportTop` getter/setter pattern in `EditorStateAccess` is understood (read `src/editor/editor.ts` lines 290-293)
- [ ] `viewport-top-get`/`viewport-top-set` primitive pattern is understood (read `src/editor/api/jump-ops.ts` lines 590-613)

#### Step 1: Add `viewportLeft` to core types

**User story:** As a developer, I want a horizontal scroll offset stored in editor state, so that the renderer knows which column to display from.

**Description:** Add `viewportLeft: number` to `EditorState`, `Window`, and `Frame` interfaces.

**MUST:**
- Default to `0` everywhere (backward compatible)
- Mirror the `viewportTop` field placement in each interface

**MUST NOT:**
- Add any rendering logic in this step
- Change `Validators.editorConfig` or `EditorConfig`

**Convention source:** `src/core/types.ts` — `viewportTop` field placement pattern

**Acceptance criteria:**
- [ ] `EditorState` has `viewportLeft?: number` field
- [ ] `Window` has `viewportLeft: number` field
- [ ] `Frame` has `viewportLeft: number` field
- [ ] `bun run typecheck:src` passes with zero errors

#### Step 2: Initialize and expose `viewportLeft` in editor

**User story:** As a T-Lisp command author, I want get/set access to the horizontal scroll offset, so that I can write scroll commands.

**Description:** Initialize `viewportLeft: 0` in editor state, add getter/setter to `EditorStateAccess`, propagate through `getEditorState()` and `setState()`.

**MUST:**
- Follow the exact `viewportTop` pattern for getter/setter (lines 292-293)
- Include `viewportLeft` in state serialization and deserialization

**MUST NOT:**
- Add scroll commands in this step (that's Phase 3)

**Convention source:** `src/editor/editor.ts` — `viewportTop` initialization, accessors, and serialization pattern

**Acceptance criteria:**
- [ ] Editor initial state includes `viewportLeft: 0`
- [ ] `EditorStateAccess` exposes `viewportLeft` getter and setter
- [ ] `getEditorState()` output includes `viewportLeft`
- [ ] `setState()` restores `viewportLeft`
- [ ] `bun run typecheck:src` passes

#### Step 3: Add T-Lisp primitives `viewport-left-get` and `viewport-left-set`

**User story:** As a T-Lisp user, I want to read and write the horizontal viewport offset, so that commands can control horizontal scrolling.

**Description:** Add two primitives to `jump-ops.ts` following the `viewport-top-get`/`viewport-top-set` pattern.

**MUST:**
- `viewport-left-set` must clamp to `>= 0`
- Follow exact argument validation pattern of existing viewport primitives

**MUST NOT:**
- Implement scroll commands (those are T-Lisp in Phase 3)

**Convention source:** `src/editor/api/jump-ops.ts` lines 590-613

**Acceptance criteria:**
- [ ] `(viewport-left-get)` returns current offset as number
- [ ] `(viewport-left-set 10)` sets offset to 10, returns 10
- [ ] `(viewport-left-set -5)` clamps to 0
- [ ] `bun run typecheck:src` passes

### Phase 2: Horizontal Scroll Rendering — make the renderer offset lines and auto-scroll

**Constraint checkpoint:** Before starting this phase, verify:
- [ ] `renderSingleWindow` signature and line rendering loop understood (read `buffer-lines.ts` lines 191-277)
- [ ] `sliceToVisualWidth` and `fitToWidth` understood (CJK-aware slicing)
- [ ] Cursor positioning in both frontends understood (`assam.ts` line 69, `tui-client.ts` line 89)

#### Step 4: Update `renderSingleWindow` for horizontal scroll offset

**User story:** As a user, I want to see the portion of long lines starting from the scroll offset, so that I can read content past the right edge.

**Description:** Add `viewportLeft` parameter to `renderSingleWindow`. Slice each line from that offset. Show `«` indicator when scrolled right, `»` when line extends past right edge.

**MUST:**
- Use `sliceToVisualWidth`-style CJK-aware slicing for offset
- Show `«` (1 char) at line start when `viewportLeft > 0`, reducing content width by 1
- Show `»` (1 char) at line end when line extends past visible area, reducing content width by 1
- Pass `viewportLeft` from state through `renderBufferLines`

**MUST NOT:**
- Change behavior when `viewportLeft === 0` (no regression for existing truncation)
- Handle word wrap in this step (that's Phase 4)

**Convention source:** `src/frontend/render/buffer-lines.ts` — `fitToWidth`, `sliceToVisualWidth`, `charWidth`

**Acceptance criteria:**
- [ ] When `viewportLeft = 0`, rendering is identical to current behavior
- [ ] When `viewportLeft = 40`, lines show content starting from visual column 40
- [ ] `«` appears at left edge when `viewportLeft > 0`
- [ ] `»` appears at right edge when line extends past visible area
- [ ] CJK characters offset correctly (double-width)
- [ ] `bun run typecheck:src` passes

#### Step 5: Add auto-scroll for horizontal viewport

**User story:** As a user, I want the viewport to follow the cursor horizontally, so that the cursor never disappears off-screen.

**Description:** Add `getVisibleViewportLeft` that clamps `viewportLeft` to keep `cursorColumn` in the visible range. Call it from `renderBufferLines`.

**MUST:**
- If `cursorColumn < viewportLeft`, set `viewportLeft = cursorColumn`
- If `cursorColumn >= viewportLeft + contentWidth`, set `viewportLeft = cursorColumn - contentWidth + 1`
- Return the clamped value (caller updates state)

**MUST NOT:**
- Mutate state inside the render function (return the value, let caller update)

**Convention source:** `getVisibleViewportTop` pattern in `buffer-lines.ts` lines 63-76

**Acceptance criteria:**
- [ ] Cursor at column 0 with `viewportLeft = 10` auto-scrolls to `viewportLeft = 0`
- [ ] Cursor at column 100 with `viewportLeft = 0` in 80-wide terminal auto-scrolls to `viewportLeft = 21`
- [ ] Cursor within visible range leaves `viewportLeft` unchanged
- [ ] `bun run typecheck:src` passes

#### Step 6: Update cursor positioning in frontends

**User story:** As a user, I want the terminal cursor at the correct screen position when horizontally scrolled, so that typing appears where I expect.

**Description:** Subtract `viewportLeft` from the terminal cursor column in both `assam.ts` and `tui-client.ts`.

**MUST:**
- Clamp terminal cursor column to `[0, width - 1]` after subtracting offset

**MUST NOT:**
- Change the `cursorPosition.column` in state (only the terminal render position)

**Convention source:** `assam.ts` line 69, `tui-client.ts` line 89

**Acceptance criteria:**
- [ ] With `viewportLeft = 20` and cursor at column 25, terminal cursor renders at column 5
- [ ] Terminal cursor never renders at negative column
- [ ] `bun run typecheck:src` passes

### Phase 3: Horizontal Scroll Commands — T-Lisp commands and keybindings

**Constraint checkpoint:** Before starting this phase, verify:
- [ ] z-prefix dispatcher pattern understood (`motions.tlisp` `vim-dispatch-prefix-key`, line 170-175)
- [ ] `vim-prefix-bindings` understood for which-key display (line 200-204)
- [ ] `terminal-width-get` primitive exists (verify in `jump-ops.ts`)

#### Step 7: Add horizontal scroll T-Lisp commands

**User story:** As a user, I want to scroll the viewport horizontally with `zl`/`zh`/`zs`/`ze`, so that I can navigate long lines without moving the cursor.

**Description:** Add four scroll functions in `motions.tlisp` and wire them into the z-prefix dispatcher.

**MUST:**
- `scroll-column-left` — increase `viewportLeft` by half terminal width
- `scroll-column-right` — decrease `viewportLeft` by half terminal width (clamp >= 0)
- `scroll-cursor-start` — set `viewportLeft` to `cursorColumn`
- `scroll-cursor-end` — set `viewportLeft` to `max(0, cursorColumn - contentWidth + 1)`
- Wire: `zl` → `scroll-column-left`, `zh` → `scroll-column-right`, `zs` → `scroll-cursor-start`, `ze` → `scroll-cursor-end`
- Add all four to `vim-prefix-bindings` for which-key display

**MUST NOT:**
- Add TypeScript primitives for scroll logic — this is T-Lisp owned editor logic

**Convention source:** `src/tlisp/CLAUDE.md` — command library pattern; `motions.tlisp` `scroll-cursor-top/center/bottom`

**Acceptance criteria:**
- [ ] `zl` scrolls viewport right by half screen width
- [ ] `zh` scrolls viewport left by half screen width
- [ ] `zs` scrolls so cursor column is at left edge
- [ ] `ze` scrolls so cursor column is at right edge
- [ ] Which-key shows `l`, `h`, `s`, `e` bindings under `z` prefix
- [ ] `bun run typecheck:src` passes

### Phase 4: Word Wrap Display — wrap long lines when `config.wordWrap` is true

**Constraint checkpoint:** Before starting this phase, verify:
- [ ] `config.wordWrap` exists in `EditorConfig` (read `src/core/types.ts` line 165)
- [ ] `auto-fill-mode` toggles `wordWrap` (read `src/editor/api/minor-mode-ops.ts` line 74)
- [ ] `wrapAnsi` in `src/steep/oolong/wrap.ts` is word-based (unsuitable for code)

#### Step 8: Add word-wrap render path

**User story:** As a user with `auto-fill-mode` active, I want long lines to wrap across screen rows, so that I can read all content without scrolling.

**Description:** Add a wrap branch in `renderSingleWindow` that splits logical lines into multiple screen rows when `config.wordWrap` is true.

**MUST:**
- Use character-based wrapping (not word-based) at the content width boundary
- Track logical-line to screen-row mapping for correct cursor placement
- Force `viewportLeft = 0` when wrapping (mutually exclusive with horizontal scroll)
- Only wrap visible viewport lines (performance)
- Account for CJK double-width characters at wrap boundary

**MUST NOT:**
- Mutate buffer content (this is visual wrapping only)
- Use `wrapAnsi` from oolong (word-based, wrong for code)

**Convention source:** `src/frontend/render/buffer-lines.ts` — `charWidth`, `fitToWidth`, `sliceToVisualWidth`

**Acceptance criteria:**
- [ ] With `wordWrap = true`, a 200-char line in 80-wide terminal renders across 3 screen rows
- [ ] Cursor on a wrapped line appears at the correct screen row and column
- [ ] `j`/`k` move by logical line (skip multiple screen rows for wrapped lines)
- [ ] Toggling `wordWrap` off restores truncation behavior
- [ ] `viewportLeft` is 0 when wrap is active
- [ ] CJK characters wrap correctly (don't split mid-character)
- [ ] `bun run typecheck:src` passes

#### Step 9: Update cursor positioning for wrapped lines

**User story:** As a user, I want the terminal cursor at the correct screen row when viewing wrapped lines, so that my position is visually accurate.

**Description:** Adjust cursor row calculation in `assam.ts` and `tui-client.ts` to account for wrapped lines adding extra screen rows.

**MUST:**
- Compute cursor screen row by counting wrapped rows from `viewportTop` to cursor line

**MUST NOT:**
- Change `cursorPosition.line` (logical line) — only the terminal render row

**Convention source:** `assam.ts` line 68, `tui-client.ts` line 88

**Acceptance criteria:**
- [ ] Cursor on a wrapped logical line renders at the correct screen row
- [ ] Cursor on an unwrapped line renders at the same row as before (no regression)
- [ ] `bun run typecheck:src` passes

### Phase 5: Tests and Documentation — validate everything works, update SRS

**Constraint checkpoint:** Before starting this phase, verify:
- [ ] All previous phases pass `bun run typecheck:src`
- [ ] Test patterns understood (read `test/unit/render-visual.test.ts`)

#### Step 10: Write tests

**User story:** As a maintainer, I want automated tests for horizontal scroll and word wrap, so that regressions are caught.

**Description:** Add unit tests for horizontal scroll rendering, auto-scroll, word-wrap rendering, cursor placement, and T-Lisp primitives.

**MUST:**
- Test horizontal scroll: offset slicing, `«`/`»` indicators, auto-scroll
- Test word wrap: line splitting, cursor placement, CJK boundary
- Test T-Lisp primitives: `viewport-left-get`/`viewport-left-set`
- Test mutual exclusivity: wrap forces `viewportLeft = 0`

**MUST NOT:**
- Skip CJK edge cases

**Convention source:** `rules/testing.md`, `test/unit/render-visual.test.ts`

**Acceptance criteria:**
- [ ] Horizontal scroll offset rendering test passes
- [ ] Auto-scroll clamp test passes
- [ ] Word-wrap multi-row rendering test passes
- [ ] Cursor placement on wrapped line test passes
- [ ] CJK wrap boundary test passes
- [ ] `viewport-left-get`/`viewport-left-set` primitive test passes
- [ ] `bun test` passes with zero failures

#### Step 11: Update SRS documentation

**User story:** As a stakeholder, I want the SRS to reflect the new capabilities, so that feature tracking is accurate.

**Description:** Add US-1.21.1 (Horizontal Scrolling) and US-1.21.2 (Word Wrap Display) to Phase 1 of `docs/srs.md`.

**MUST:**
- Follow existing user story format (As a / I want / So that, Acceptance Criteria with status markers)
- Mark as ✅ Implemented

**MUST NOT:**
- Change any existing user story statuses

**Convention source:** `docs/srs.md` — existing user story format

**Acceptance criteria:**
- [ ] US-1.21.1 present with acceptance criteria matching implementation
- [ ] US-1.21.2 present with acceptance criteria matching implementation
- [ ] Both marked ✅ Implemented

## Acceptance Criteria

1. Given a 200-char line in an 80-column terminal, when I press `zl`, the viewport scrolls right by half screen width and `«` appears at left edge
2. Given a scrolled viewport, when I press `zh`, the viewport scrolls left by half screen width (clamped to 0)
3. Given I press `zs`, the viewport scrolls so cursor column is at the left edge
4. Given I press `ze`, the viewport scrolls so cursor column is at the right edge
5. Given the cursor moves past the right edge, the viewport auto-scrolls to keep the cursor visible
6. Given the cursor moves past the left edge, the viewport auto-scrolls to keep the cursor visible
7. Given `auto-fill-mode` is active, when I view a long line, it wraps across multiple screen rows instead of truncating
8. Given word wrap is active, when I press `j`/`k`, cursor moves by logical line (not screen row)
9. Given word wrap is active, when the cursor is on a wrapped line, the terminal cursor renders at the correct screen row and column
10. Given word wrap is toggled on, `viewportLeft` is forced to 0
11. All existing tests pass with zero regressions

## Validation Commands

- `bun run typecheck` — Zero TypeScript errors across entire project
- `bun run typecheck:src` — Zero source type errors
- `bun run typecheck:test` — Zero test type errors
- `bun test` — All tests pass, zero failures
- `bun run test:daemon` — Daemon integration tests pass
- `bun run test:ui:renderer` — Renderer UI tests pass

## Design Decisions

| Decision | Rationale | Alternative rejected |
|----------|-----------|---------------------|
| Character-based wrap for code | Code has no word boundaries; word-based wrapping breaks indentation and structure | Word-based wrapping (suitable for prose only) |
| Mutual exclusivity (wrap vs scroll) | A wrapped line has infinite effective width — horizontal scroll is meaningless | Allowing both simultaneously (complex, confusing UX) |
| `«`/`»` scroll indicators | Vim uses `<`/`>` but `«`/`»` are more visually distinct in a terminal | `$` at line end (already used for vim end-of-line) |
| `viewportLeft` on `EditorState` (not just `Window`) | Single-window path reads from `EditorState` directly, matching `viewportTop` pattern | Window-only storage would require refactoring the single-window render path |
| Half-screen scroll amount for `zl`/`zh` | Vim convention; provides meaningful scroll without losing context | Full-screen (too disorienting), quarter-screen (too slow) |

**Deferred to follow-up:**
- `zL`/`zH` (full-screen horizontal scroll)
- `g$`/`g0` (end/beginning of screen line)
- Soft word wrap with word-boundary awareness for prose modes
- `wrapAnsi` reuse for Markdown rendering in editor buffers

## Edge Cases

- Empty buffer with word wrap enabled — no lines to wrap, render `~` tildes normally
- Lines exactly at terminal width — no wrapping or truncation needed
- Lines one character past terminal width — wrap to 2 screen rows or show `»`
- CJK character at the wrap boundary — don't split mid-character, wrap before it
- Horizontal scroll offset greater than line length — show empty content with `«` indicator
- Word wrap toggle mid-session — switch from truncation to wrap and back without losing cursor position
- Multi-window splits — each window can have its own `viewportLeft`
- Block cursor rendering on a line that starts at `viewportLeft > 0` — cursor column must be offset correctly
- Syntax highlight spans crossing the `viewportLeft` boundary — spans must be clamped to visible range
