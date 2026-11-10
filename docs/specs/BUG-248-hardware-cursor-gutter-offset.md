# Bug: hardware cursor sits gutter-width cells left of the drawn cursor when line numbers are shown (visible as a second "ghost" cursor)

## Bug Description

With the `line-numbers` minor mode (`Ln`) active, the editor shows TWO cursors:
the white **drawn block cursor** painted into the frame at the true text
position, and the **hardware terminal cursor** positioned via `moveTo` — which
lands exactly one gutter width (4 cells for a <100-line buffer, ` N │`) to the
LEFT of the drawn cursor. The terminal's native cursor (greenish in the
reporting user's theme) is then visible as a "little greenish ghost cursor a
couple of characters behind the actual cursor".

Both frontends are affected: embedded Steep (`bin/tmax <file>`) and the
daemon TUI client.

## Problem Statement

Every rendered buffer line is `gutter + content`
(`src/frontend/render/buffer-lines.ts`, `renderBufferLines*` — lines pushed as
`gutter + rendered`), and the drawn block cursor sits at
`gutterCells + contentCol`. But `getCursorScreenOffset`
(`src/frontend/render/buffer-lines.ts:89`) returns a **content-relative**
column, and both call sites feed it straight to `moveTo` adding the tab-bar
offset to the row and nothing to the column:

- `src/steep/assam.ts:75-78` — `screen.moveTo(cursorRow + tabBarHeight, cursorCol)`
- `src/client/tui-client.ts:136-139` — identical

So with a gutter on screen the hardware cursor is misplaced by
`gutterDisplayWidth` cells. Additionally both callers pass the full terminal
`width` as `contentWidth`, while the render path fits content to
`cw = Math.max(1, width - gw)` — the horizontal-scroll clamp in
`getVisibleViewportLeft` therefore fires one gutter late.

Headless evidence (pre-fix, cursor line 0 col 6, 2-line buffer):

```
line-numbers ON:   drawn cursor screen col 10, hardware col 6 → 4 cells apart
line-numbers OFF:  drawn col 6, hardware col 6 → aligned
```

Live session (read-only `bin/tmaxclient --eval`): `line-numbers` active,
6-line buffer ⇒ gutter = 4 cells.

## Solution Statement

Fix inside `getCursorScreenOffset` — it already receives `state`, and it has
exactly the two affected callers, so both frontends are fixed at once:

1. Compute the gutter exactly as the render path does:
   `gutterConfigFromState(state.activeMinorModes, state.config)` +
   `gutterDisplayWidth(getLineCount(state), cfg)`.
2. Clamp the horizontal viewport against the gutter-reduced content width
   (`Math.max(1, contentWidth - gw)`), mirroring the render path's `cw`.
3. Return the **absolute screen column**: `gw + Math.max(0, cursorColumn - viewportLeft)`.

Gutter off (`Ln` absent, no line numbers) → `gw = 0` → behavior byte-identical
to today; all existing tests run gutter-off and stay green.

## Steps to Reproduce

1. `bun run start <file>` (embedded Steep) or the TUI client.
2. Ensure `Ln` is active (default minor modes include it; or `M-x line-numbers-mode`).
3. Place the cursor mid-line and look: the terminal-native cursor blinks on
   the line-number gutter, 4 cells left of the white block cursor.

## Completion Criteria

- [ ] With `line-numbers` active, `getCursorScreenOffset(state, …).col` equals
      the screen column of the drawn block cursor in the rendered frame
      (parity GATE in the style of `wiki-link-display.test.ts:190`), for at
      least: cursor at line start, cursor mid-line, cursor at end of line.
- [ ] With the gutter off, returned columns are unchanged (existing
      `wiki-link-display` / `viewport-scroll-wrap` assertions stay green).
- [ ] The horizontal-scroll clamp uses the gutter-reduced content width.
- [ ] `bun run typecheck:src`, `typecheck:test`, `typecheck` clean.
- [ ] New regression test red before the fix, green after (mutation-proven:
      reverting the fix makes exactly the new assertions fail).
- [ ] `bun run test:unit` green.

## Relevant Files

- `src/frontend/render/buffer-lines.ts` — `getCursorScreenOffset` (fix site),
  render paths (reference for the contract)
- `src/steep/assam.ts`, `src/client/tui-client.ts` — callers (unchanged)
- `src/frontend/render/gutter.ts` — `gutterDisplayWidth`, `gutterConfigFromState`
- `test/unit/cursor-gutter-alignment.test.ts` — new regression test

## Notes

- Not the cause (verified): the SPEC-119 wiki `mapCol` transform — it is
  applied identically in both paths (`getCursorScreenOffset` recomputes the
  same spans/transform as the render path); the reported offset is structural
  (constant gutter width), not content-dependent.
- Related but out of scope: with `wordWrap` on, the cursor's visual ROW can
  span multiple screen rows; the hardware row math here stays line-based.
  That is a separate pre-existing concern, not part of this fix.

Status: RESOLVED pending CI green — implemented at issue-248 (9d402ac);
typecheck clean, unit suite 3,595/0, verify-gate PASS round 1 (verifier
re-ran typecheck + the mutation proof independently).
