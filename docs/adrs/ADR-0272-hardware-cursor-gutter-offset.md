# ADR-0272: Hardware cursor offset includes the line-number gutter

- **Status**: Accepted (verify-gate PASS round 1; landed pending CI green)
- **Date**: 2026-11-11
- **Issue**: [#248](https://github.com/mekkamagnus/tmax/issues/248)
- **Spec**: [BUG-248](../specs/BUG-248-hardware-cursor-gutter-offset.md)

## Context

tmax draws two cursors. The frame renderer paints an inverted **block cursor**
into the current line (`renderWithBlockCursor*`), and each frontend separately
positions the **hardware terminal cursor** via `moveTo` using
`getCursorScreenOffset`. When the `line-numbers` minor mode is active, every
rendered line is `gutter + content` — the gutter is `gutterWidth + 1` visible
cells (` N │`): 4 cells for buffers under 100 lines, 5 for 100–999.

`getCursorScreenOffset` returned a **content-relative** column, and both
callers (`src/steep/assam.ts:75-78`, `src/client/tui-client.ts:136-139`) added
the tab-bar offset to the row but nothing to the column. The hardware cursor
therefore sat exactly one gutter width LEFT of the drawn block cursor — to the
user, "a little greenish ghost cursor a couple of characters behind the actual
cursor" (the terminal-theme-colored native cursor next to the white drawn
block). A secondary defect: both callers pass the full terminal width as
`contentWidth`, while the render path fits content to `width - gw`, so the
horizontal-scroll clamp in `getVisibleViewportLeft` fired one gutter late.

Headless A/B (cursor line 0 col 6): gutter on → drawn col 10 vs hardware col 6
(4 cells apart); gutter off → aligned. Live session confirmed read-only
(`line-numbers` active, 6-line buffer ⇒ 4-cell gutter).

## Decision

Fix inside `getCursorScreenOffset` (`src/frontend/render/buffer-lines.ts`), the
single shared source of both frontends' hardware-cursor position:

1. Compute the gutter exactly as the render path does —
   `gutterConfigFromState(state.activeMinorModes, state.config)` +
   `gutterDisplayWidth(getLineCount(state), cfg)`.
2. Clamp the horizontal viewport against the gutter-reduced content width
   (`Math.max(1, contentWidth - gw)`), mirroring the render path's `cw`.
3. Return the **absolute screen column**: `gw + max(0, cursorColumn − viewportLeft)`.

Gutter off ⇒ `gw = 0` ⇒ byte-identical to the previous behavior; all
pre-existing tests run gutter-off and were expected (and verified) to stay
green. The two callers are unchanged.

## Alternatives considered

- **Offset at each call site** (`assam.ts`, `tui-client.ts`): duplicated
  gutter derivation in two frontends, drift-prone — the exact class of
  divergence that caused the bug. Rejected.
- **Subtract the gutter when rendering the drawn cursor instead**: would
  desynchronize the drawn cursor from the content it highlights. Rejected.

## Consequences

- The function's `col` is now an **absolute screen column** (gutter
  included), matching its name; its `contentWidth` parameter is interpreted as
  the full row width and internally reduced by the gutter. Both existing
  callers already passed full width, so no call-site change was needed.
- Parity pinned by a GATE test
  (`test/unit/cursor-gutter-alignment.test.ts`) in the style of the SPEC-119
  gate: the hardware column must equal the drawn block cursor's screen column
  located in the rendered ANSI line, at line start / mid-line / EOL, at two
  gutter widths (4 and 5 cells), plus the right-edge clamp case. Mutation-proven:
  reverting the fix makes exactly the 4 gutter-dependent tests fail.
- Out of scope, documented in the spec: with `wordWrap` on, the cursor's
  visual ROW can span multiple screen rows; the row math stays line-based
  (pre-existing, unobserved in this report).

## Verification

- `bun run typecheck:src` / `typecheck:test` / `typecheck` — clean.
- `bun run test:unit` — 3,595 tests, 0 fail (165 s).
- New suite: 5 pass; red on pre-fix code for exactly the gutter-dependent
  assertions (mutation-proven via `git show c96be41:…` restore).
